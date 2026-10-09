"""Unit tests: configuration, permissions, redaction, network guard, scheduling, integrations."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from sca.agent_config import AgentConfig, compose_system_suffix
from sca.security import netguard
from sca.security.passwords import hash_password, validate_password_strength, verify_password
from sca.security.rbac import has_permission
from sca.security.redaction import REDACTED, redact, redact_text, register_secret
from sca.services.integrations import proposal_from_openapi, validate_config, validation_report
from sca.services.knowledge import chunk_text
from sca.services.scheduler import next_cron_run


def _cfg(**kw):
    return {"model": {"provider_id": "p1", "model": "m"}, **kw}


# ----------------------------------------------------------------- agent configuration


def test_agent_config_defaults_and_validation():
    cfg = AgentConfig.model_validate(_cfg(tools=["terminal", "file_editor", "terminal"]))
    assert cfg.tools == ["file_editor", "terminal"]  # de-duplicated, sorted
    assert cfg.policy.approval_mode == "risky"
    with pytest.raises(ValidationError):
        AgentConfig.model_validate(_cfg(tools=["rm_rf_tool"]))
    with pytest.raises(ValidationError):
        AgentConfig.model_validate(_cfg(policy={"max_concurrent_tasks": 0}))
    with pytest.raises(ValidationError):
        AgentConfig.model_validate(_cfg(unexpected=True))


def test_system_suffix_contains_profile_and_security_policy():
    cfg = AgentConfig.model_validate(_cfg(role="Analyst", objective="Find facts", constraints=["No PII"],
                                          escalation_conditions=["Legal questions"]))
    text = compose_system_suffix(cfg, "Research", "Acme")
    assert "Analyst" in text and "Find facts" in text and "No PII" in text and "Legal questions" in text
    assert "UNTRUSTED DATA" in text  # prompt-injection policy always present


# ----------------------------------------------------------------- permissions


@pytest.mark.parametrize("role,perm,ok", [
    ("viewer", "agents:read", True), ("viewer", "tasks:create", False), ("viewer", "approvals:decide", False),
    ("operator", "tasks:create", True), ("operator", "agents:write", False),
    ("approver", "approvals:decide", True), ("approver", "tasks:create", False),
    ("agent_admin", "agents:write", True), ("agent_admin", "providers:write", False),
    ("org_admin", "providers:write", True), ("org_admin", "users:write", True),
])
def test_rbac_matrix(role, perm, ok):
    assert has_permission(role, perm) is ok


# ----------------------------------------------------------------- secrets / passwords


def test_redaction_patterns_and_registered_secrets():
    register_secret("my-very-private-value-123")
    text = ("key xpl_0000aaaa1111bbbb2222cccc3333dddd4444eeee and Authorization: Bearer abcdefghijklmnop "
            "and api_key=hunter2hunter2 and my-very-private-value-123")
    out = redact_text(text)
    assert "xpl_0000aaaa" not in out and "abcdefghijklmnop" not in out and "hunter2hunter2" not in out
    assert "my-very-private-value-123" not in out and REDACTED in out
    nested = redact({"headers": {"Authorization": "Bearer zzzzzzzzzzzz"}, "secret_id": "abc", "ok": 1})
    assert nested["headers"]["Authorization"] == REDACTED and nested["secret_id"] == "abc"


def test_password_hashing_and_policy():
    h = hash_password("Correct-Horse-9")
    assert verify_password(h, "Correct-Horse-9") and not verify_password(h, "wrong")
    with pytest.raises(ValueError):
        validate_password_strength("short")
    with pytest.raises(ValueError):
        validate_password_strength("alllowercaseletters")


# ----------------------------------------------------------------- network guard


@pytest.mark.parametrize("url", [
    "http://169.254.169.254/latest/meta-data", "http://metadata.google.internal/", "http://127.0.0.2:8000/",
    "http://localhost/", "http://10.1.2.3/", "http://[::1]/", "file:///etc/passwd", "https://user:pw@example.com/",
])
def test_netguard_blocks_internal_targets(url):
    with pytest.raises(netguard.BlockedTarget):
        netguard.check_url(url)


# ----------------------------------------------------------------- scheduling


def test_cron_next_run_respects_timezone():
    after = datetime(2026, 1, 5, 7, 0, tzinfo=UTC)  # Monday 07:00 UTC = 08:00 Berlin
    nxt = next_cron_run("0 9 * * 1-5", "Europe/Berlin", after)
    assert nxt == datetime(2026, 1, 5, 8, 0, tzinfo=UTC)
    with pytest.raises(ValueError):
        next_cron_run("not a cron", "UTC", after)


# ----------------------------------------------------------------- integrations


def test_integration_config_guards():
    cfg = validate_config("http", {"base_url": "https://api.example.com", "operations": [
        {"name": "remove", "method": "DELETE", "path": "/items/{id}",
         "params_schema": {"type": "object", "properties": {"id": {"type": "string"}}}}]})
    op = cfg["operations"][0]
    assert op["destructive"] and op["requires_approval"]
    with pytest.raises(ValidationError):
        validate_config("http", {"base_url": "https://x", "default_headers": {"Authorization": "Bearer x"}})
    with pytest.raises(ValidationError):
        validate_config("http", {"base_url": "https://x", "operations": [{"name": "a", "path": "http://evil/"}]})


def test_openapi_import_disables_writes_and_reports():
    spec = {"openapi": "3.0.0", "info": {"title": "CRM"}, "servers": [{"url": "https://api.example.com"}],
            "components": {"securitySchemes": {"k": {"type": "apiKey", "in": "header", "name": "X-Key"}}},
            "paths": {"/c/{id}": {"get": {"operationId": "getC", "parameters": [
                {"name": "id", "in": "path", "required": True, "schema": {"type": "string"}}]},
                "delete": {"operationId": "delC"}}}}
    prop = proposal_from_openapi(json.dumps(spec))
    ops = {o["name"]: o for o in prop["config"]["operations"]}
    assert ops["getC"]["enabled"] and not ops["delC"]["enabled"] and ops["delC"]["destructive"]
    assert prop["config"]["auth"] == {"type": "api_key_header", "header_name": "X-Key"}
    report = {c["check"]: c for c in validation_report("http", prop["config"])}
    assert report["schema"]["ok"]
    assert report["op:getC:path_params"]["ok"]
    # The spec never declares {id} for the DELETE operation: the generated checks must flag it.
    assert not report["op:delC:path_params"]["ok"]


def test_chunking_overlaps_and_bounds():
    text = "\n\n".join(f"Paragraph {i} " + ("word " * 80) for i in range(20))
    chunks = chunk_text(text)
    assert len(chunks) > 3 and all(len(c) <= 1400 + 200 for c in chunks)


# ----------------------------------------------------------------- prebuilt connectors


def test_graphql_read_only_guard():
    from sca.services.integrations import is_read_only_graphql

    assert is_read_only_graphql("{ shop { name } }")
    assert is_read_only_graphql('query Q($id: ID!) { product(id: $id) { title } }')
    assert is_read_only_graphql('{ products(query: "title:mutation") { nodes { id } } }')  # inside a string
    assert is_read_only_graphql("# mutation in a comment\n{ shop { name } }")
    assert not is_read_only_graphql('mutation { productDelete(input: {id: "1"}) { deletedProductId } }')
    assert not is_read_only_graphql("query A { a }\nmutation B { b }")  # second operation smuggled in
    assert not is_read_only_graphql("{ shop { name } } mutation X { a }")
    assert not is_read_only_graphql("subscription { orders { id } }")


def test_connectors_instantiate_and_validate():
    from sca.connectors import CONNECTORS, ConnectorError, instantiate, public_catalog

    params = {"shopify_admin": {"shop": "https://Acme-Store.myshopify.com/admin"},
              "meta_marketing": {"ad_account_id": "act_1234567890"},
              "whatsapp_cloud": {"phone_number_id": "1098765432", "waba_id": "2233445566"}}
    for c in CONNECTORS:
        if c["type"] != "http":
            continue
        spec = instantiate(c["key"], params[c["key"]])
        cfg = validate_config("http", spec["config"])
        assert "{{" not in json.dumps(cfg)
        assert all(x["ok"] for x in validation_report("http", spec["config"])), c["key"]
        for op in cfg["operations"]:
            # Every operation that can change external data waits for a human.
            if op["method"] != "GET" and op.get("graphql") != "query":
                assert op["requires_approval"], (c["key"], op["name"])
    shop = instantiate("shopify_admin", params["shopify_admin"])["config"]
    assert shop["base_url"] == "https://acme-store.myshopify.com/admin/api/2026-07"
    meta = instantiate("meta_marketing", params["meta_marketing"])["config"]
    assert meta["health_check_path"].startswith("/act_1234567890?")
    mcp = instantiate("meta_ads_mcp", {})
    assert mcp["type"] == "mcp" and validate_config("mcp", mcp["config"])["url"] == "https://mcp.facebook.com/ads"
    with pytest.raises(ConnectorError):
        instantiate("shopify_admin", {"shop": "evil.com/x?"})
    with pytest.raises(ConnectorError):
        instantiate("meta_marketing", {"ad_account_id": "123", "base_url": "https://evil"})
    with pytest.raises(ConnectorError):
        instantiate("nope", {})
    cat = {c["key"]: c for c in public_catalog()}
    assert cat["shopify_dev_mcp"]["available"] is False  # stdio MCP is off by default
    assert all("shpat_" not in json.dumps(c["config"]) for c in CONNECTORS)
