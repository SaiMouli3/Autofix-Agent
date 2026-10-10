"""Test fixtures: an isolated data dir and a real uvicorn server (with workers) per session.

Live tests (``-m live``) need ``EXP_LABS_API_KEY`` (and optionally ``EXP_LABS_BASE_URL``,
``SCA_TEST_MODEL``) and talk to the real provider. Everything else is offline.
"""

from __future__ import annotations

import os
import socket
import tempfile
import threading
import time
from pathlib import Path

import httpx
import pytest

_TMP = Path(tempfile.mkdtemp(prefix="sca-test-"))


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


PORT = _free_port()
os.environ.update({
    "SCA_ENV": "test",
    "SCA_DATA_DIR": str(_TMP),
    "SCA_INTERNAL_BASE_URL": f"http://127.0.0.1:{PORT}",
    "SCA_MAX_WORKERS": "4",
    "SCA_RATE_LIMIT_AUTH_PER_MIN": "1000",
    "SCA_LEASE_SECONDS": "20",
    "OPENHANDS_SUPPRESS_BANNER": "1",
    "SCA_ALLOWED_PRIVATE_HOSTS": "127.0.0.1",  # the failure-injection provider listens on loopback
    "SCA_LLM_NUM_RETRIES": "0",
})
# Never seed a provider implicitly; live tests create it explicitly.
LIVE_KEY = os.environ.pop("EXP_LABS_API_KEY", "")
LIVE_BASE = os.environ.pop("EXP_LABS_BASE_URL", "") or "https://api.experientiallabs.ai/v1"
LIVE_MODEL = os.environ.get("SCA_TEST_MODEL", "claude-haiku-5.5")

PASSWORD = "Sup3r-Secret-Pass!"


@pytest.fixture(scope="session")
def server():
    import uvicorn

    from sca.main import app

    config = uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="warning", lifespan="on")
    srv = uvicorn.Server(config)
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            if httpx.get(f"http://127.0.0.1:{PORT}/healthz", timeout=1).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.2)
    yield f"http://127.0.0.1:{PORT}"
    srv.should_exit = True
    t.join(timeout=10)


class Api:
    """Small cookie+CSRF-aware client."""

    def __init__(self, base: str):
        self.c = httpx.Client(base_url=base, timeout=120)

    def _h(self, extra=None):
        return {"x-csrf-token": self.c.cookies.get("sca_csrf", ""), **(extra or {})}

    def get(self, path, **kw):
        return self.c.get(path, **kw)

    def post(self, path, json=None, headers=None, **kw):
        return self.c.post(path, json=json, headers=self._h(headers), **kw)

    def put(self, path, json=None):
        return self.c.put(path, json=json, headers=self._h())

    def delete(self, path):
        return self.c.delete(path, headers=self._h())

    def wait(self, task_id: str, timeout: float = 600, until=("completed", "failed", "cancelled", "timed_out",
                                                                "waiting_for_approval")):
        t0 = time.time()
        while time.time() - t0 < timeout:
            r = self.get(f"/api/tasks/{task_id}").json()
            if r["status"] in until:
                return r
            time.sleep(1)
        raise AssertionError(f"task {task_id} did not finish: {r['status']}")


_state: dict = {}


@pytest.fixture(scope="session")
def admin(server) -> Api:
    api = Api(server)
    r = api.post("/api/auth/setup", {"org_name": "Acme", "name": "Ada Admin", "email": "admin@acme.com",
                                    "password": PASSWORD})
    assert r.status_code == 200, r.text
    return api


def login_as(server, email: str, password: str = PASSWORD) -> Api:
    api = Api(server)
    r = api.post("/api/auth/login", {"email": email, "password": password})
    assert r.status_code == 200, r.text
    return api


@pytest.fixture(scope="session")
def offline_provider(admin) -> str:
    """A provider record pointing at an unroutable test endpoint (no network calls are made with it)."""
    r = admin.post("/api/providers", {"name": "Offline", "kind": "openai_compatible",
                                      "base_url": "https://example.com/v1", "default_model": "test-model",
                                      "api_key": "sk-test-0123456789abcdef"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def make_agent(api: Api, provider_id: str, name: str, **cfg) -> dict:
    config = {"role": "tester", "model": {"provider_id": provider_id, "model": cfg.pop("model", "test-model")},
              "tools": cfg.pop("tools", ["file_editor"]), **cfg}
    r = api.post("/api/agents", {"name": name, "category": "Test", "config": config})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture(scope="session")
def live_provider(admin) -> str:
    if not LIVE_KEY:
        pytest.skip("EXP_LABS_API_KEY not set")
    r = admin.post("/api/providers", {"name": "Experiential Labs", "kind": "experiential_labs",
                                      "base_url": LIVE_BASE, "default_model": LIVE_MODEL,
                                      "embedding_model": "text-embedding-3-small", "api_key": LIVE_KEY})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    res = admin.post(f"/api/providers/{pid}/test", {}).json()["result"]
    assert res["ok"], res
    return pid
