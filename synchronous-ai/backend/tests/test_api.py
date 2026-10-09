"""Integration tests against a real running server (offline: no external model calls).

The fake OpenAI-compatible provider below exists only to inject provider failures
(auth errors, outages) and a scripted fallback reply — conditions a real provider
cannot be made to produce on demand.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import threading
import time
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from sqlalchemy import select

from sca.db import session_scope
from sca.models import (
    Agent,
    ApprovalRequest,
    ExecutionSession,
    Membership,
    Organization,
    Schedule,
    Secret,
    Task,
    UsageRecord,
    User,
    utcnow,
)
from sca.security.passwords import hash_password
from tests.conftest import PASSWORD, Api, login_as, make_agent

# --------------------------------------------------------------------------- fake provider


class _FakeProvider(BaseHTTPRequestHandler):
    calls: list[str] = []

    def log_message(self, *a):  # silence
        pass

    def _send(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # /models
        self._send(200, {"data": [{"id": m, "supports_tools": True} for m in ("auth-fail", "flaky", "good")]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        model = body.get("model", "")
        _FakeProvider.calls.append(model)
        if model == "auth-fail":
            return self._send(401, {"error": {"message": "invalid api key", "type": "authentication_error"}})
        if model == "flaky":
            return self._send(503, {"error": {"message": "upstream overloaded", "type": "server_error"}})
        self._send(200, {
            "id": "cmpl-1", "object": "chat.completion", "created": 0, "model": model,
            "choices": [{"index": 0, "finish_reason": "tool_calls", "message": {
                "role": "assistant", "content": None,
                "tool_calls": [{"id": "call_1", "type": "function", "function": {
                    "name": "finish", "arguments": json.dumps({"message": "done by fallback model"})}}]}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        })


@pytest.fixture(scope="module")
def fake_provider(admin):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _FakeProvider)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    r = admin.post("/api/providers", {"name": "Fake", "kind": "openai_compatible",
                                      "base_url": f"http://127.0.0.1:{srv.server_port}/v1",
                                      "default_model": "good", "api_key": "sk-fake-abcdefghijkl"})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    admin.get(f"/api/providers/{pid}/models?refresh=true")
    yield pid
    srv.shutdown()


# --------------------------------------------------------------------------- auth & CSRF


def test_auth_flow_and_csrf(server, admin):
    anon = Api(server)
    assert anon.get("/api/agents").status_code == 401
    assert anon.post("/api/auth/setup", {"org_name": "Other", "name": "Y", "email": "y@x.com",
                                         "password": PASSWORD}).status_code == 409
    assert anon.post("/api/auth/login", {"email": "admin@acme.com", "password": "wrong-Password1"}).status_code == 401
    me = admin.get("/api/auth/me").json()
    assert me["role"] == "org_admin" and me["org"]["name"] == "Acme"
    # Mutations without the CSRF header are rejected even with a valid session cookie.
    r = admin.c.post("/api/teams", json={"name": "No CSRF"})
    assert r.status_code == 403


def test_rbac_enforced_server_side(server, admin, offline_provider):
    for email, role in (("viewer@acme.com", "viewer"), ("operator@acme.com", "operator"),
                        ("approver@acme.com", "approver")):
        r = admin.post("/api/users", {"email": email, "name": role, "role": role, "password": PASSWORD})
        assert r.status_code == 201, r.text
    agent = make_agent(admin, offline_provider, "RBAC Target")
    viewer = login_as(server, "viewer@acme.com")
    operator = login_as(server, "operator@acme.com")
    assert viewer.get("/api/agents").status_code == 200
    assert viewer.post("/api/agents", {"name": "Nope", "config": {}}).status_code == 403
    assert viewer.post(f"/api/agents/{agent['id']}/tasks", {"instructions": "x"}).status_code == 403
    assert operator.post("/api/agents", {"name": "Nope", "config": {}}).status_code == 403
    assert operator.post("/api/providers", {"name": "x", "kind": "openai"}).status_code == 403
    assert viewer.get("/api/audit").status_code == 403
    assert admin.get("/api/audit").status_code == 200


def test_tenant_isolation(server, admin, offline_provider):
    agent = make_agent(admin, offline_provider, "Tenant A Agent")
    with session_scope() as db:
        org = Organization(name="Other Corp", slug="other")
        user = User(email="eve@other.com", name="Eve", password_hash=hash_password(PASSWORD))
        db.add_all([org, user])
        db.flush()
        db.add(Membership(org_id=org.id, user_id=user.id, role="org_admin"))
    eve = login_as(server, "eve@other.com")
    assert eve.get(f"/api/agents/{agent['id']}").status_code == 404
    assert eve.post(f"/api/agents/{agent['id']}/tasks", {"instructions": "steal"}).status_code == 404
    assert all(a["id"] != agent["id"] for a in eve.get("/api/agents").json()["items"])
    assert eve.get("/api/providers").json() == []
    # Cannot reference another tenant's provider in an agent config either.
    r = eve.post("/api/agents", {"name": "Sneaky", "config": {"model": {"provider_id": offline_provider, "model": "m"}}})
    assert r.status_code == 422


# --------------------------------------------------------------------------- agents & tasks


def test_agent_versioning_and_validation(admin, offline_provider):
    a = make_agent(admin, offline_provider, "Versioned")
    assert a["current_version"] == 1
    cfg = a["config"]
    cfg["instructions"] = "Updated instructions"
    r = admin.put(f"/api/agents/{a['id']}", {"config": cfg, "change_note": "tweak"})
    assert r.status_code == 200 and r.json()["current_version"] == 2
    assert len(admin.get(f"/api/agents/{a['id']}/versions").json()) == 2
    assert admin.post("/api/agents", {"name": "Versioned", "config": cfg}).status_code == 409  # unique names
    bad = dict(cfg, tools=["browser"])
    assert admin.put(f"/api/agents/{a['id']}", {"config": bad}).status_code == 422  # tool not enabled here
    self_deleg = dict(cfg, policy={"delegation": {"allowed_agent_ids": [a["id"]]}})
    assert admin.put(f"/api/agents/{a['id']}", {"config": self_deleg}).status_code == 422


def test_idempotent_submission_and_cancel_before_start(admin, offline_provider):
    from sca.services.tasks import submit_task

    a = make_agent(admin, offline_provider, "Idem")
    with session_scope() as db:
        agent = db.get(Agent, a["id"])
        t1, c1 = submit_task(db, agent=agent, instructions="hello", idempotency_key="same-key")
        t1.scheduled_for = utcnow() + timedelta(hours=1)  # keep it queued
        t2, c2 = submit_task(db, agent=agent, instructions="hello", idempotency_key="same-key")
        tid = t1.id
    assert c1 and not c2 and t1.id == t2.id
    r = admin.post(f"/api/tasks/{tid}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert admin.post(f"/api/tasks/{tid}/cancel").status_code == 409


def test_secrets_never_returned_or_stored_in_plaintext(admin, offline_provider):
    body = json.dumps(admin.get("/api/providers").json())
    assert "sk-test-0123456789abcdef" not in body
    with session_scope() as db:
        for sec in db.execute(select(Secret)).scalars():
            assert b"sk-test-0123456789abcdef" not in sec.ciphertext
    assert "sk-test-0123456789abcdef" not in json.dumps(admin.get("/api/audit?page_size=500").json())


# --------------------------------------------------------------------------- execution behaviour


def test_monthly_budget_blocks_execution(admin, offline_provider):
    a = make_agent(admin, offline_provider, "Budgeted", policy={"budget_usd_monthly": 1.0})
    with session_scope() as db:
        db.add(UsageRecord(org_id=db.get(Agent, a["id"]).org_id, agent_id=a["id"], task_id="x", model="m",
                           cost_usd=2.5, cost_source="estimated"))
    t = admin.post(f"/api/agents/{a['id']}/tasks", {"instructions": "do work"}).json()
    r = admin.wait(t["id"], 60)
    assert r["status"] == "failed" and r["error"]["code"] == "budget_exceeded"


def test_provider_auth_failure_is_not_retried(admin, fake_provider):
    a = make_agent(admin, fake_provider, "AuthFail", model="auth-fail", policy={"max_retries": 2, "approval_mode": "never"})
    t = admin.post(f"/api/agents/{a['id']}/tasks", {"instructions": "hi"}).json()
    r = admin.wait(t["id"], 120)
    assert r["status"] == "failed" and r["attempt"] == 0, r
    res = admin.post(f"/api/providers/{fake_provider}/test", {"model": "auth-fail"}).json()["result"]
    assert not res["ok"] and res["error"]["code"] == "auth_failed"


def test_provider_outage_retries_with_fallback_model(admin, fake_provider):
    a = make_agent(admin, fake_provider, "Flaky", model="flaky",
                   policy={"max_retries": 1, "approval_mode": "never"})
    cfg = a["config"]
    cfg["model"]["fallback_model"] = "good"
    assert admin.put(f"/api/agents/{a['id']}", {"config": cfg}).status_code == 200
    t = admin.post(f"/api/agents/{a['id']}/tasks", {"instructions": "hi"}).json()
    r = admin.wait(t["id"], 240, until=("completed", "cancelled", "timed_out"))
    assert r["status"] == "completed" and r["attempt"] == 1, r
    assert r["usage"]["model"] == "good"
    assert "done by fallback model" in admin.get(f"/api/tasks/{t['id']}").json()["result_summary"]
    types = [e["summary"] for e in admin.get(f"/api/tasks/{t['id']}/events").json()]
    assert any("Retry scheduled" in s for s in types)


def test_lease_recovery_requeues_lost_tasks(admin, offline_provider):
    from sca.orchestrator.dispatcher import get_orchestrator

    a = make_agent(admin, offline_provider, "Recovery")
    with session_scope() as db:
        agent = db.get(Agent, a["id"])
        t = Task(org_id=agent.org_id, agent_id=agent.id, agent_version=1, title="lost", instructions="x",
                 status="running", lease_owner="otherhost:999:abc", lease_expires_at=utcnow() - timedelta(minutes=5),
                 max_retries=0, scheduled_for=utcnow() + timedelta(hours=1))
        db.add(t)
        db.flush()
        tid = t.id
    assert get_orchestrator().recover(startup=False) >= 1
    r = admin.get(f"/api/tasks/{tid}").json()
    assert r["status"] == "failed" and r["error"]["code"] == "worker_lost"


def test_watchdog_interrupts_on_timeout():
    import time as _t

    from sca.orchestrator import executor

    class Conv:
        interrupted = False

        def interrupt(self):
            Conv.interrupted = True

    run = executor.LiveRun(task_id="t-timeout", org_id="o", agent_id="a", deadline=_t.monotonic() - 1,
                           budget_usd=None, max_tool_calls=10, conversation=Conv())
    executor.LIVE_RUNS["t-timeout"] = run
    try:
        executor.service_stop_requests()
        assert run.stop_reason == "timed_out" and Conv.interrupted
    finally:
        executor.LIVE_RUNS.pop("t-timeout", None)


# --------------------------------------------------------------------------- approvals


def test_approval_decisions_are_atomic_and_policy_enforced(server, admin, offline_provider):
    a = make_agent(admin, offline_provider, "Approvals")
    me = admin.get("/api/auth/me").json()
    with session_scope() as db:
        agent = db.get(Agent, a["id"])
        t = Task(org_id=agent.org_id, agent_id=agent.id, agent_version=1, title="t", instructions="x",
                 status="waiting_for_approval", requested_by=me["user"]["id"], inline=True,
                 scheduled_for=utcnow() + timedelta(hours=1))
        db.add(t)
        db.flush()
        a1 = ApprovalRequest(org_id=agent.org_id, task_id=t.id, agent_id=agent.id, kind="integration_call", summary="s1")
        a2 = ApprovalRequest(org_id=agent.org_id, task_id=t.id, agent_id=agent.id, kind="integration_call", summary="s2")
        db.add_all([a1, a2])
        db.flush()
        ids = (a1.id, a2.id)
    viewer = login_as(server, "viewer@acme.com")
    assert viewer.post(f"/api/approvals/{ids[0]}/decide", {"decision": "approved"}).status_code == 403
    assert admin.post(f"/api/approvals/{ids[0]}/decide", {"decision": "approved"}).status_code == 200
    assert admin.post(f"/api/approvals/{ids[0]}/decide", {"decision": "rejected"}).status_code == 409
    assert admin.put("/api/org/settings", {"require_distinct_approver": True}).status_code == 200
    try:
        assert admin.post(f"/api/approvals/{ids[1]}/decide", {"decision": "approved"}).status_code == 403
        approver = login_as(server, "approver@acme.com")
        assert approver.post(f"/api/approvals/{ids[1]}/decide", {"decision": "approved"}).status_code == 200
    finally:
        admin.put("/api/org/settings", {"require_distinct_approver": False})


# --------------------------------------------------------------------------- schedules & webhooks


def test_cron_schedule_fires_once_per_slot(admin, offline_provider):
    from sca.services.scheduler import run_due_schedules

    a = make_agent(admin, offline_provider, "Scheduled")
    s = admin.post("/api/schedules", {"agent_id": a["id"], "name": "Daily", "instructions": "report",
                                      "kind": "cron", "cron": "0 9 * * *", "timezone": "Europe/London"}).json()
    assert s["next_run_at"] is not None
    assert admin.post("/api/schedules", {"agent_id": a["id"], "name": "Bad", "instructions": "x",
                                         "kind": "cron", "cron": "nope"}).status_code == 422
    with session_scope() as db:
        db.get(Schedule, s["id"]).next_run_at = utcnow() - timedelta(minutes=1)
    assert run_due_schedules() == 1
    assert run_due_schedules() == 0  # next slot is in the future; no duplicate
    with session_scope() as db:
        n = len(db.execute(select(Task).where(Task.schedule_id == s["id"])).scalars().all())
        assert n == 1 and db.get(Schedule, s["id"]).next_run_at > utcnow()


def test_webhook_requires_valid_signature_and_dedupes(server, admin, offline_provider):
    a = make_agent(admin, offline_provider, "Hooked")
    s = admin.post("/api/schedules", {"agent_id": a["id"], "name": "On ticket", "instructions": "triage",
                                      "kind": "webhook"}).json()
    secret = s["webhook_secret"]
    anon = Api(server)
    body = json.dumps({"ticket": 42}).encode()

    def sign(ts: int) -> str:
        return "sha256=" + hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()

    ts = int(time.time())
    hdr = {"content-type": "application/json", "x-sca-timestamp": str(ts), "x-sca-event-id": "evt-1"}
    assert anon.c.post(f"/api/hooks/{s['id']}", content=body, headers={**hdr, "x-sca-signature": "sha256=bad"}).status_code == 401
    old = {**hdr, "x-sca-timestamp": str(ts - 3600), "x-sca-signature": sign(ts - 3600)}
    assert anon.c.post(f"/api/hooks/{s['id']}", content=body, headers=old).status_code == 401
    r = anon.c.post(f"/api/hooks/{s['id']}", content=body, headers={**hdr, "x-sca-signature": sign(ts)})
    assert r.status_code == 202 and r.json()["status"] == "accepted"
    r2 = anon.c.post(f"/api/hooks/{s['id']}", content=body, headers={**hdr, "x-sca-signature": sign(ts)})
    assert r2.json()["status"] == "duplicate"
    task = admin.get(f"/api/tasks/{r.json()['task_id']}").json()
    assert "<untrusted_data>" in task["instructions"]


# --------------------------------------------------------------------------- artifacts & knowledge


def test_artifact_access_is_confined_to_workspace(server, admin, offline_provider):
    from sca.runtime.sandbox import session_dir

    a = make_agent(admin, offline_provider, "Files")
    with session_scope() as db:
        agent = db.get(Agent, a["id"])
        sess = ExecutionSession(org_id=agent.org_id, agent_id=agent.id, conversation_id="c", runtime="local",
                                workspace_path="")
        db.add(sess)
        db.flush()
        base = session_dir(agent.org_id, agent.id, sess.id)
        sess.workspace_path = str(base)
        sid = sess.id
    (Path(base) / "project" / "report.md").write_text("# Report")
    assert admin.get(f"/api/sessions/{sid}/file", params={"path": "report.md"}).json()["content"] == "# Report"
    for evil in ("../state/x", "../../../../secret.key", "/etc/passwd"):
        assert admin.get(f"/api/sessions/{sid}/file", params={"path": evil}).status_code in (403, 404)
    eve = login_as(server, "eve@other.com")
    assert eve.get(f"/api/sessions/{sid}/file", params={"path": "report.md"}).status_code == 404


def test_knowledge_ingestion_and_retrieval(admin):
    src = admin.post("/api/knowledge/sources", {"name": "Handbook"}).json()
    r = admin.post(f"/api/knowledge/sources/{src['id']}/text",
                   {"title": "pto", "content": "Employees receive 27 days of paid time off per year."})
    assert r.status_code == 202
    for _ in range(30):
        docs = admin.get(f"/api/knowledge/sources/{src['id']}/documents").json()
        if docs[0]["status"] in ("indexed", "failed"):
            break
        time.sleep(0.5)
    assert docs[0]["status"] == "indexed" and docs[0]["chunk_count"] == 1
    hits = admin.post("/api/knowledge/search", {"query": "paid time off days", "source_ids": [src["id"]]}).json()
    assert hits and "27 days" in hits[0]["text"] and hits[0]["document"] == "pto.md"
    bad = admin.c.post(f"/api/knowledge/sources/{src['id']}/documents", files={"file": ("x.exe", b"MZ")},
                       headers={"x-csrf-token": admin.c.cookies.get("sca_csrf")})
    assert bad.status_code == 415


def test_audit_chain_detects_tampering(admin):
    assert admin.get("/api/audit/verify").json()["valid"] is True
    from sca.models import AuditEvent

    with session_scope() as db:
        ev = db.execute(select(AuditEvent).order_by(AuditEvent.id).limit(1)).scalar_one()
        original = ev.action
        ev.action = "tampered"
    try:
        assert admin.get("/api/audit/verify").json()["valid"] is False
    finally:
        with session_scope() as db:
            db.execute(select(AuditEvent).order_by(AuditEvent.id).limit(1)).scalar_one().action = original


def test_concurrent_audit_appends_do_not_deadlock_and_keep_the_chain(admin):
    """Regression: a session that already holds the DB write lock and then appends to the audit
    log must not deadlock with a session appending with a pending write (seen as a login 500)."""
    from sca.models import Team
    from sca.services import audit

    org_id = admin.get("/api/auth/me").json()["org"]["id"]
    errors: list[str] = []

    def writer_then_audit(i: int) -> None:
        try:
            with session_scope() as db:
                db.add(Team(org_id=org_id, name=f"audit-race-w{i}"))
                db.flush()
                time.sleep(0.2)
                audit.record(db, org_id, "test.writer", actor_type="system")
        except Exception as exc:  # noqa: BLE001
            errors.append(repr(exc))

    def pending_then_audit(i: int) -> None:
        try:
            time.sleep(0.05)
            with session_scope() as db:
                db.add(Team(org_id=org_id, name=f"audit-race-p{i}"))
                audit.record(db, org_id, "test.pending", actor_type="system")
        except Exception as exc:  # noqa: BLE001
            errors.append(repr(exc))

    threads = [threading.Thread(target=f, args=(i,)) for i in range(4) for f in (writer_then_audit, pending_then_audit)]
    t0 = time.time()
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert not errors, errors
    assert time.time() - t0 < 10, "appends were serialized behind a lock timeout"
    assert admin.get("/api/audit/verify").json()["valid"] is True


def test_task_listing_sort_filters_and_failure_category(admin, offline_provider):
    from sca.api.tasks import error_category

    a = make_agent(admin, offline_provider, "Sorter")
    with session_scope() as db:
        agent = db.get(Agent, a["id"])
        for i, (status, err) in enumerate([("failed", {"code": "rate_limited"}), ("timed_out", {"code": "timeout"}),
                                           ("completed", None)]):
            db.add(Task(org_id=agent.org_id, agent_id=agent.id, agent_version=1, title=f"t{i}", instructions="x",
                        status=status, error=err, priority=i + 1, scheduled_for=utcnow() + timedelta(hours=1)))
    r = admin.get(f"/api/tasks?agent_id={a['id']}&sort=priority&order=asc").json()
    assert [t["title"] for t in r["items"]] == ["t0", "t1", "t2"]
    cats = {t["title"]: t["error_category"] for t in r["items"]}
    assert cats == {"t0": "provider", "t1": "timeout", "t2": None}
    r = admin.get(f"/api/tasks?agent_id={a['id']}&status=failed,timed_out").json()
    assert r["total"] == 2
    future = (utcnow() + timedelta(days=1)).isoformat()
    assert admin.get("/api/tasks", params={"agent_id": a["id"], "created_after": future}).json()["total"] == 0
    past = (utcnow() - timedelta(days=1)).isoformat()
    assert admin.get("/api/tasks", params={"agent_id": a["id"], "created_after": past}).json()["total"] == 3
    assert admin.get("/api/tasks?sort=bogus").status_code == 422
    assert error_category({"code": "budget_exceeded"}, "failed") == "limit"
    assert error_category(None, "cancelled") == "cancelled"


def test_integration_category_permissions_and_delete(admin, offline_provider):
    a = make_agent(admin, offline_provider, "Integrator")
    i = admin.post("/api/integrations", {"name": "ticketing", "type": "http", "category": "communication",
                                         "config": {"base_url": "https://example.com"}}).json()
    assert i["category"] == "communication"
    r = admin.put(f"/api/integrations/{i['id']}/agents", {"agent_ids": [a["id"]]})
    assert r.status_code == 200 and [x["name"] for x in r.json()["permitted_agents"]] == ["Integrator"]
    cfg = admin.get(f"/api/agents/{a['id']}").json()
    assert i["id"] in cfg["config"]["integrations"] and "integrations" in cfg["config"]["tools"]
    assert cfg["current_version"] == 2
    assert admin.delete(f"/api/integrations/{i['id']}").status_code == 409  # still assigned
    assert admin.put(f"/api/integrations/{i['id']}/agents", {"agent_ids": []}).status_code == 200
    assert admin.delete(f"/api/integrations/{i['id']}").status_code == 200
    assert admin.get(f"/api/integrations/{i['id']}").status_code == 404


def test_document_listing_and_preview(admin):
    src = admin.post("/api/knowledge/sources", {"name": "Preview Source"}).json()
    doc = admin.post(f"/api/knowledge/sources/{src['id']}/text", {"title": "guide", "content": "Step one. Step two."}).json()
    for _ in range(30):
        if admin.get(f"/api/knowledge/documents?source_id={src['id']}").json()["items"][0]["status"] == "indexed":
            break
        time.sleep(0.3)
    listing = admin.get("/api/knowledge/documents?q=guide").json()
    item = next(d for d in listing["items"] if d["id"] == doc["id"])
    assert item["uploaded_by_name"] == "Ada Admin" and item["source_name"] == "Preview Source" and item["type"] == "md"
    pv = admin.get(f"/api/knowledge/documents/{doc['id']}/preview").json()
    assert "Step one" in pv["passages"][0]["text"]


class _Echo(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _reply(self):
        n = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(n) or b"null")
        out = json.dumps({"method": self.command, "path": self.path, "body": body}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    do_GET = do_POST = _reply


def test_connector_catalog_and_gateway_body_controls(admin):
    from sca.db import session_scope
    from sca.models import Integration
    from sca.services.integrations import IntegrationError, call_operation

    cat = {c["key"]: c for c in admin.get("/api/integrations/connectors").json()}
    assert {"shopify_admin", "meta_marketing", "whatsapp_cloud", "meta_ads_mcp"} <= set(cat)
    send = next(o for o in cat["whatsapp_cloud"]["operations"] if o["name"] == "send_text_message")
    assert send["requires_approval"]

    r = admin.post("/api/integrations/connectors/whatsapp_cloud",
                   {"params": {"phone_number_id": "1098765432", "waba_id": "2233445566"},
                    "credential": "EAAG-test-token-0123456789"})
    assert r.status_code == 201, r.text
    wa = r.json()
    assert wa["status"] == "proposed" and wa["category"] == "communication" and wa["has_credential"]
    assert wa["config"]["base_url"] == "https://graph.facebook.com/v26.0"
    assert "EAAG-test-token" not in r.text
    assert admin.post("/api/integrations/connectors/whatsapp_cloud", {"params": {"phone_number_id": "x"}}).status_code == 422
    assert admin.post("/api/integrations/connectors/unknown", {"params": {}}).status_code == 404

    # Gateway semantics the connectors rely on, exercised against a local echo server.
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _Echo)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    cfg = {"base_url": f"http://127.0.0.1:{srv.server_port}", "operations": [
        {"name": "send", "method": "POST", "path": "/messages", "requires_approval": True,
         "fixed_body": {"messaging_product": "whatsapp", "type": "text"}},
        {"name": "q", "method": "POST", "path": "/graphql.json", "graphql": "query"},
        {"name": "lst", "method": "GET", "path": "/items", "default_query": {"fields": "id,name"}},
    ]}
    i = admin.post("/api/integrations", {"name": "echo", "type": "http", "config": cfg}).json()
    assert admin.post(f"/api/integrations/{i['id']}/activate").status_code == 200
    try:
        with session_scope() as db:
            integ = db.get(Integration, i["id"])
            out = call_operation(db, integ, "send", {"to": "447700900123", "text": {"body": "hi"},
                                                     "type": "template", "messaging_product": "sms"})
            assert out["body"]["body"] == {"to": "447700900123", "text": {"body": "hi"},
                                           "type": "text", "messaging_product": "whatsapp"}  # fixed fields win
            out = call_operation(db, integ, "lst", {})
            assert out["body"]["path"] == "/items?fields=id%2Cname"
            out = call_operation(db, integ, "lst", {"fields": "id"})
            assert out["body"]["path"] == "/items?fields=id"  # defaults are overridable
            assert call_operation(db, integ, "q", {"query": "{ shop { name } }"})["ok"]
            with pytest.raises(IntegrationError) as exc:
                call_operation(db, integ, "q", {"query": 'mutation { productDelete(input: {id: "1"}) { deletedProductId } }'})
            assert exc.value.code == "write_not_allowed"
    finally:
        srv.shutdown()


class _SlackLike(BaseHTTPRequestHandler):
    """Answers HTTP 200 with {"ok": false} like Slack does for a bad token."""

    def log_message(self, *a):
        pass

    def do_GET(self):  # noqa: N802
        out = json.dumps({"ok": False, "error": "invalid_auth"}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


def test_connector_suggestions_connected_badge_and_ok_field_health(admin, offline_provider):
    r = admin.post("/api/agents", {"name": "Deal Desk", "category": "Sales", "config": {
        "role": "seller", "model": {"provider_id": offline_provider, "model": "test-model"}, "tools": ["file_editor"]}})
    assert r.status_code == 201, r.text
    cat = {c["key"]: c for c in admin.get("/api/integrations/connectors").json()}
    assert len(cat) >= 23
    suggested = sorted((c for c in cat.values() if c["suggested_rank"] is not None), key=lambda c: c["suggested_rank"])
    assert suggested and all("Deal Desk" in c["suggested_reason"] for c in suggested)
    assert {"salesforce", "gmail"} & {c["key"] for c in suggested}
    assert len({c["vendor"] for c in suggested if c["vendor"] != "Google"}) == len([c for c in suggested if c["vendor"] != "Google"])

    # Adding a connector marks it as added and removes it from the suggestions.
    first = suggested[0]
    params = {p["key"]: p.get("default") or "x" for p in first["params"]}
    i = admin.post(f"/api/integrations/connectors/{first['key']}", {"params": params}).json()
    assert i["connector_key"] == first["key"]
    cat = {c["key"]: c for c in admin.get("/api/integrations/connectors").json()}
    assert cat[first["key"]]["connected"] == [{"id": i["id"], "name": i["name"], "status": "proposed"}]
    assert cat[first["key"]]["suggested_rank"] is None
    admin.delete(f"/api/integrations/{i['id']}")

    # APIs that report auth failures inside a 200 response are not shown as connected.
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _SlackLike)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        s = admin.post("/api/integrations", {"name": "slack-like", "type": "http", "credential": "xoxb-invalid-0000", "config": {
            "base_url": f"http://127.0.0.1:{srv.server_port}", "auth": {"type": "bearer"},
            "health_check_path": "/auth.test", "health_ok_field": "ok"}}).json()
        res = admin.post(f"/api/integrations/{s['id']}/test").json()["result"]
        assert res["ok"] is False and "invalid_auth" in res["detail"]
    finally:
        srv.shutdown()
