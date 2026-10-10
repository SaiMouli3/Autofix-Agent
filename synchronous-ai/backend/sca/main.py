"""FastAPI application entry point."""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

os.environ.setdefault("OPENHANDS_SUPPRESS_BANNER", "1")

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from sca import __version__  # noqa: E402
from sca.config import get_settings  # noqa: E402
from sca.security.ratelimit import limiter  # noqa: E402
from sca.services import oauth  # noqa: E402
from sca.security.redaction import redact_text  # noqa: E402


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {"ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"), "level": record.levelname,
                   "logger": record.name, "msg": redact_text(record.getMessage())}
        for key in ("request_id", "path", "status", "duration_ms", "method"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        if record.exc_info:
            payload["exc"] = redact_text(self.formatException(record.exc_info))[-4000:]
        return json.dumps(payload)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(os.environ.get("SCA_LOG_LEVEL", "INFO"))
    for noisy in ("LiteLLM", "litellm", "httpx", "openhands", "mcp", "fastmcp", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def run_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    here = Path(__file__).resolve().parent.parent
    cfg = Config(str(here / "alembic.ini"))
    cfg.set_main_option("script_location", str(here / "alembic"))
    cfg.set_main_option("sqlalchemy.url", get_settings().resolved_database_url)
    command.upgrade(cfg, "head")


def create_app() -> FastAPI:
    configure_logging()
    s = get_settings()
    from sca.runtime.platform_mcp import build_app as build_mcp

    mcp_app = build_mcp()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if os.environ.get("SCA_AUTO_MIGRATE", "1") == "1":
            run_migrations()
        orch = None
        if s.start_workers:
            from sca.orchestrator.dispatcher import get_orchestrator

            orch = get_orchestrator()
            orch.start()
        async with mcp_app.lifespan(app):
            yield
        if orch is not None:
            orch.stop()

    app = FastAPI(title="Synchronous Consulting AI", version=__version__, lifespan=lifespan,
                  docs_url=None if s.is_production else "/api/docs", redoc_url=None,
                  openapi_url=None if s.is_production else "/api/openapi.json")

    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=True,
                       allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["content-type", "x-csrf-token",
                                                                                     "idempotency-key"])
    access = logging.getLogger("sca.access")

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        path = request.url.path
        if not s.public_base_url and not s.is_production:
            oauth.request_origin.set(f"{request.url.scheme}://{request.url.netloc}")
        if path.startswith("/api/") and not path.startswith("/api/hooks/"):
            ip = request.client.host if request.client else "?"
            if not limiter.allow(f"api:{ip}", s.rate_limit_api_per_min):
                return JSONResponse({"detail": "rate limit exceeded"}, status_code=429)
        t0 = time.monotonic()
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if not path.startswith("/api/docs"):
            response.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
            )
        if s.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if path.startswith("/api/") and path != "/api/stream":
            access.info("request", extra={"request_id": rid, "path": path, "method": request.method,
                                          "status": response.status_code,
                                          "duration_ms": int((time.monotonic() - t0) * 1000)})
        return response

    from sca.api import (
        admin,
        agents,
        attachments,
        approvals,
        auth,
        dashboard,
        integrations,
        knowledge,
        providers,
        schedules,
        tasks,
        websearch,
    )

    for r in (auth, agents, attachments, tasks, approvals, providers, integrations, knowledge, schedules, admin, dashboard, websearch):
        app.include_router(r.router)
    app.include_router(integrations.oauth_router)

    app.mount("/mcp/platform", mcp_app)

    static_dir = Path(os.environ.get("SCA_STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
    if static_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            if full_path.startswith(("api/", "mcp/")):
                return JSONResponse({"detail": "not found"}, status_code=404)
            candidate = (static_dir / full_path).resolve()
            if full_path and candidate.is_file() and str(candidate).startswith(str(static_dir.resolve())):
                return FileResponse(candidate)
            return FileResponse(static_dir / "index.html")

    return app


app = create_app()
