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
              "whatsapp_cloud": {"phone_number_id": "1098765432", "waba_id": "2233445566"},
              "salesforce": {"login_host": "https://Acme.my.salesforce.com/"},
              "sap_s4hana": {"host": "my123456-api.s4hana.cloud.sap", "username": "COMM_USER"},  # not resolvable
              "sap_api_sandbox": {},
              "zendesk": {"subdomain": "acme", "email": "ops@acme.com"},
              "jira": {"site": "acme", "email": "ops@acme.com"}}
    for c in CONNECTORS:
        if c["type"] != "http":
            continue
        spec = instantiate(c["key"], params.get(c["key"], {}))
        cfg = validate_config("http", spec["config"])
        assert "{{" not in json.dumps(cfg)
        report = [x for x in validation_report("http", spec["config"]) if not x["ok"]]
        if c["key"] == "sap_s4hana":  # the example tenant host does not exist, so only DNS may fail
            assert [x["check"] for x in report] == ["network_policy"]
        else:
            assert not report, c["key"]
        for op in cfg["operations"]:
            # Every operation that can change external data waits for a human.
            if op["method"] != "GET" and op.get("graphql") != "query" and not op.get("read_only"):
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


def test_salesforce_and_sap_connectors():
    from sca.connectors import instantiate

    sf = validate_config("http", instantiate("salesforce", {"login_host": "test.salesforce.com"})["config"])
    assert sf["auth"]["type"] == "oauth2" and sf["oauth"]["pkce"] and sf["oauth"]["base_url_from_token"] == "instance_url"
    assert sf["oauth"]["token_url"] == "https://test.salesforce.com/services/oauth2/token"
    assert sf["oauth"]["scopes"] == ["api", "refresh_token"]
    ops = {o["name"]: o for o in sf["operations"]}
    assert ops["soql_query"]["method"] == "GET" and ops["soql_query"]["enabled"]
    assert ops["delete_record"]["destructive"] and not ops["delete_record"]["enabled"]
    assert all(o["requires_approval"] for o in sf["operations"] if o["method"] != "GET")
    mcp = validate_config("mcp", instantiate("salesforce_mcp", {"environment": "sandbox"})["config"])
    assert mcp["url"].endswith("/v1/sandbox/sobject-reads") and mcp["oauth"]["scopes"] == ["mcp_api", "refresh_token"]
    sap = validate_config("http", instantiate("sap_s4hana", {"host": "my1-api.s4hana.cloud.sap", "username": "U1"})["config"])
    assert sap["auth"] == {"type": "basic", "header_name": "X-API-Key", "query_name": "api_key", "username": "U1"}
    assert sap["csrf"]["header"] == "X-CSRF-Token"
    upd = next(o for o in sap["operations"] if o["name"] == "update_business_partner")
    assert upd["header_params"] == {"if_match": "If-Match"} and upd["requires_approval"]
    with pytest.raises(ValidationError):  # credentials can never be set from agent arguments
        validate_config("http", {"base_url": "https://x.example.com", "operations": [
            {"name": "x", "path": "/x", "header_params": {"token": "Authorization"}}]})
    with pytest.raises(ValidationError):  # OAuth endpoints must be https
        validate_config("http", {"base_url": "https://x.example.com", "auth": {"type": "oauth2"},
                                 "oauth": {"authorize_url": "http://evil.example.com/a", "token_url": "https://x/t"}})


def test_popular_connectors_catalog_and_argument_checks():
    from sca.connectors import GROUPS, instantiate, public_catalog
    from sca.services.integrations import IntegrationError, _render_path, _validate_args, Operation

    cat = {c["key"]: c for c in public_catalog()}
    for key in ("gmail", "google_calendar", "google_drive", "microsoft_365", "slack", "notion", "hubspot", "jira",
                "github", "github_mcp", "stripe", "stripe_mcp", "zendesk", "airtable"):
        assert key in cat and cat[key]["group"] in GROUPS and cat[key]["popularity"] > 0 and cat[key]["suggest_for"]
    # Stripe is read-only by design; every change operation elsewhere waits for approval.
    assert all(o["read_only"] for o in cat["stripe"]["operations"])
    for c in cat.values():
        for o in c.get("operations") or []:
            assert o["read_only"] or o["requires_approval"], (c["key"], o["name"])
    slack = validate_config("http", instantiate("slack", {})["config"])
    assert slack["oauth"]["scope_separator"] == "," and slack["health_ok_field"] == "ok"
    gmail = validate_config("http", instantiate("gmail", {})["config"])
    assert gmail["oauth"]["extra_authorize_params"]["access_type"] == "offline"
    ms = validate_config("http", instantiate("microsoft_365", {"tenant": "acme.onmicrosoft.com"})["config"])
    assert ms["oauth"]["token_url"] == "https://login.microsoftonline.com/acme.onmicrosoft.com/oauth2/v2.0/token"
    # Declared argument constraints are enforced, and '..' can never walk to another endpoint.
    op = Operation(name="x", path="/repos/{owner}/{repo}", params_schema={"type": "object", "properties": {
        "owner": {"type": "string", "pattern": r"^(?!\.\.?$)[A-Za-z0-9_.-]{1,100}$"}, "repo": {"type": "string"},
        "state": {"type": "string", "enum": ["open", "closed"]}, "n": {"type": "integer", "maximum": 5}}})
    for bad in ({"owner": ".."}, {"owner": "a/b"}, {"state": "all"}, {"n": 9}, {"n": "3"}):
        with pytest.raises(IntegrationError):
            _validate_args(op, bad)
    _validate_args(op, {"owner": "acme", "repo": "api", "state": "open", "n": 3})
    with pytest.raises(IntegrationError):
        _render_path("/repos/{owner}/{repo}", {"owner": "acme", "repo": ".."})


def test_gmail_compose_and_decode():
    import base64

    from sca.services.integrations import IntegrationError, _compose_email, _decode_gmail_message

    draft = _compose_email("gmail_draft", {"to": ["jo@acme.com"], "subject": "Re: pricing", "body": "Hi Jo",
                                           "thread_id": "t1", "in_reply_to": "<m1@mail.gmail.com>"})
    raw = base64.urlsafe_b64decode(draft["message"]["raw"] + "==").decode()
    assert draft["message"]["threadId"] == "t1" and "In-Reply-To: <m1@mail.gmail.com>" in raw and "Hi Jo" in raw
    for bad in ({"to": ["a@x.com\nBcc: evil@x.com"], "subject": "s"}, {"to": ["a@x.com"], "subject": "a\r\nBcc: e@x.com"},
                {"subject": "no recipient"}):
        with pytest.raises(IntegrationError):
            _compose_email("gmail_raw", bad)
    enc = lambda t: base64.urlsafe_b64encode(t.encode()).decode().rstrip("=")  # noqa: E731
    msg = {"id": "m1", "threadId": "t1", "snippet": "Hello", "payload": {
        "headers": [{"name": "From", "value": "Jo <jo@acme.com>"}, {"name": "Subject", "value": "Pricing"}],
        "parts": [{"mimeType": "text/html", "body": {"data": enc("<p>Hello <b>there</b></p><script>x()</script>")}},
                  {"mimeType": "application/pdf", "filename": "quote.pdf", "body": {"size": 1200}}]}}
    out = _decode_gmail_message(msg)
    assert out["from"] == "Jo <jo@acme.com>" and out["subject"] == "Pricing"
    assert out["body"] == "Hello there" and out["attachments"][0]["filename"] == "quote.pdf"


def test_oauth_redirect_uri_sources(monkeypatch):
    from sca.config import get_settings
    from sca.services import oauth

    s = get_settings()
    token = oauth.request_origin.set("http://127.0.0.1:5173")
    try:
        monkeypatch.setattr(s, "public_base_url", "")
        assert oauth.redirect_uri() == "http://127.0.0.1:5173/api/oauth/callback"
        monkeypatch.setattr(s, "public_base_url", "https://agents.example.com/")
        assert oauth.redirect_uri() == "https://agents.example.com/api/oauth/callback"
        # Production never trusts the request's Host header for the callback.
        monkeypatch.setattr(s, "public_base_url", "")
        monkeypatch.setattr(s, "env", "production")
        assert oauth.redirect_uri() == "http://localhost:8000/api/oauth/callback"
    finally:
        oauth.request_origin.reset(token)


def test_oauth_client_id_format_checks():
    from types import SimpleNamespace

    from sca.connectors import instantiate
    from sca.services import oauth

    gmail = instantiate("gmail", {})
    integ = SimpleNamespace(type=gmail["type"], config=gmail["config"])
    for bad in ("GOCSPX-abc123", "my-project-123", "123-abc.apps.googleusercontent.com.json"):
        with pytest.raises(oauth.OAuthError) as e:
            oauth.set_client(None, integ, bad, "s", "u1")  # rejected before anything is stored
        assert e.value.code == "client_id_format"
    with pytest.raises(oauth.OAuthError, match="client secret was pasted"):
        oauth.set_client(None, integ, "GOCSPX-abc123", "s", "u1")
