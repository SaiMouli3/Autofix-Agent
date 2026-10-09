# Synchronous Consulting AI

An enterprise multi-agent operations platform. Businesses create persistent, specialized AI
agents, give each one its own model, tools, company knowledge, integrations and policies, assign
them tasks, and watch many agents work **concurrently** from one command center.

Agent execution uses the real **OpenHands Software Agent SDK** (`openhands-sdk`, `openhands-tools`,
`openhands-workspace` 1.53, MIT). This project adds the multi-agent management layer around it:
registry, durable orchestration, governance, knowledge, integrations, approvals, scheduling,
observability and the web UI.

> This directory lives inside the `Autofix-Agent` repository, which does not contain the OpenHands
> monorepo. Rather than vendoring that codebase, the platform depends on the officially published
> OpenHands SDK packages and agent-server image — the same runtime the current OpenHands application
> is built on — and pins their versions. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What you get

| Area | Capabilities |
|---|---|
| Agents | 7-step creation wizard, 8 editable business templates, immutable config versions, draft/active/disabled |
| Execution | Durable DB-backed queue, atomic claims, bounded worker pool, per-agent concurrency, priorities, idempotency keys, timeouts, cancellation, retries with fallback model, crash/restart recovery via leases |
| Runtime | OpenHands `LocalConversation` (dev) or one resource-limited OpenHands agent-server **Docker sandbox per execution** (prod); session continuation |
| Live view | Server-sent events; tool calls, results, approvals, delegation, errors and artifacts — never hidden reasoning |
| Governance | Human approval gates (park conversation → approve/reject → resume), budgets, tool-call limits, four-eyes option |
| Delegation | Agent → agent sub-tasks with allow-lists, depth limits, cycle detection, separate tools/workspace |
| Knowledge | Upload PDF/DOCX/MD/TXT/HTML/CSV/JSON, chunking, hybrid BM25 + embedding retrieval, per-agent access, cited references |
| Integrations | HTTP API gateway (credential injection, SSRF guard, size/time/rate limits, audit), MCP servers, OpenAPI and natural-language import with review |
| Scheduling | One-time, cron (time-zone aware, missed-run policy), HMAC-signed webhooks with replay protection and dedupe |
| Security | Argon2id, server-side sessions, CSRF, RBAC (5 roles), tenant scoping, Fernet-encrypted secrets, redaction, hash-chained audit log |
| Operations | `/healthz`, `/readyz`, `/metrics`, monitoring & usage dashboard, structured JSON logs, retention |

## Quick start (development)

Requirements: Python 3.12+, Node 22+, `tmux` (used by the OpenHands terminal tool).

```bash
# backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
export EXP_LABS_API_KEY=...            # optional: seeds the Experiential Labs provider at first setup
export EXP_LABS_MODEL=claude-sonnet-5.5
uvicorn sca.main:app --port 8000        # migrations run automatically

# frontend (second terminal)
cd frontend
npm ci
npm run dev                             # http://localhost:5173 (proxies /api to :8000)
```

Open the UI, create the organization admin, then in **Settings → Model providers** run
**Test connection**. Create an agent, assign a task in **Chat & tasks**, and watch **Live activity**.

For a single-process setup, `npm run build` and the backend serves `frontend/dist` at `/`.

## Production

```bash
cp .env.example .env      # set SCA_SECRET_KEY, SCA_BOOTSTRAP_TOKEN, POSTGRES_PASSWORD
docker compose up -d --build                                                   # local runtime
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d --build  # sandboxed runtime
```

Read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (TLS, sizing, backups, upgrades) and
[docs/SECURITY.md](docs/SECURITY.md) (threat model and limitations) before exposing it.

## Model providers — Experiential Labs

Experiential Labs exposes an OpenAI-compatible API at `https://api.experientiallabs.ai/v1`
(`GET /models` with tool-support flags and published pricing, `POST /chat/completions` with
`tools`, `POST /embeddings`, `Authorization: Bearer`). It is therefore driven through the existing
OpenHands/LiteLLM OpenAI-compatible adapter with a custom `base_url` — no bespoke client was needed.
The connection test lists models, checks the chosen model advertises tool support, and performs a
real tool-calling completion. Costs shown in the platform are **estimates** from the provider's
published per-token rates. OpenAI, Anthropic and any other OpenAI-compatible endpoint can be added too.

## Tests

```bash
cd backend && pytest -m "not live and not docker"     # 44 offline tests (SQLite; set SCA_DATABASE_URL for Postgres)
EXP_LABS_API_KEY=... pytest -m live                    # 8 tests on the real runtime + real provider
EXP_LABS_API_KEY=... ../scripts/e2e.sh                 # Playwright browser flow (fresh instance)
```

See [docs/TESTING.md](docs/TESTING.md) for coverage and the latest recorded results.

## Repository layout

```
backend/   FastAPI service (sca/): api/, orchestrator/, runtime/, services/, security/, models.py
           alembic/ migrations, tests/
frontend/  React + TypeScript + Vite UI (src/pages, src/components, design system in styles.css)
docs/      architecture, deployment, security, testing
scripts/   e2e.sh
```

Branding (name, logo, colors, legal line) is centralized in `frontend/src/brand.ts`,
`frontend/public/logo.svg` and the CSS tokens at the top of `frontend/src/styles.css`.

## License and attribution

See [NOTICE](NOTICE) and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Synchronous Consulting AI
is not affiliated with OpenHands, OpenAI, Anthropic, xAI or Experiential Labs.
