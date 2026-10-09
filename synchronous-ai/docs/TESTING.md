# Testing

| Suite | Command | Needs |
|---|---|---|
| Unit | `pytest tests/test_unit.py` | nothing |
| Offline integration (real server, real OpenHands runtime, DB, workers) | `pytest -m "not live and not docker"` | nothing (set `SCA_DATABASE_URL` to run on PostgreSQL) |
| Live (real runtime + real model provider) | `EXP_LABS_API_KEY=… pytest -m live` | provider key, internet |
| Browser E2E (Playwright, fresh instance) | `EXP_LABS_API_KEY=… scripts/e2e.sh` | provider key, Chromium |

Mock providers are used in exactly one place: `tests/test_api.py` starts a tiny OpenAI-compatible
server to **inject failures** (HTTP 401 and 503) and a scripted fallback reply, which a real
provider cannot be made to produce on demand. Everything else runs against the real stack.

## Coverage map

**Unit** — agent config validation and defaults; system-prompt composition incl. injection policy;
RBAC matrix; secret redaction (patterns, nested keys, registered values); Argon2 + password policy;
SSRF guard (metadata, loopback, private, IPv6, schemes, embedded credentials); time-zone-aware cron;
integration config guards (destructive ops forced to approval, credential headers rejected, path
traversal); OpenAPI import (write ops disabled, auth detection, generated validation flags
undeclared path params); chunking bounds.

**Offline integration** — setup/login/CSRF/unauthenticated access; server-side RBAC for viewer,
operator; tenant isolation (cross-org 404s, cannot reference another tenant's provider);
agent versioning, unique names, unavailable tools, self-delegation rejected; idempotent submission
and cancel-before-start; secrets never returned/stored in plaintext/in audit; monthly budget blocks
execution; provider auth failure not retried and classified; **provider outage → retry → fallback
model completes on the real OpenHands runtime**; lease recovery of lost tasks; watchdog timeout
interrupt; approvals atomic + RBAC + four-eyes policy; cron fires once per slot (no duplicates);
webhook signature, replay window, dedupe and untrusted payload wrapping; artifact path traversal and
cross-tenant artifact access blocked; knowledge ingestion + retrieval + unsupported types; audit
chain tamper detection.

**Live** (Experiential Labs, `claude-haiku-5.5`) — two agents execute concurrently on the real
runtime with overlapping windows, correct outputs, artifacts, events and usage; session continuation
retains conversation memory; approval gate parks and resumes; unpermitted tools are unavailable;
tool-call limit enforced; knowledge retrieval with a planted prompt injection (not followed, answer
cited); agent delegation through the HTTP integration gateway; credentials absent from events and
API responses.

**E2E** (Chromium via Playwright, real provider) — the 14-step acceptance flow: sign-in/setup;
provider configured and tested in the UI; agent created through the 7-step wizard; model and tools
selected; configuration persists across reload; task submitted in chat; live events visible; result
saved and displayed; second agent; both execute concurrently; both histories accessible; a viewer
cannot create agents/tasks or traverse workspaces, anonymous access is refused; the provider key is
absent from the JS/CSS bundle, API responses and the server log.

## Recorded results (2026-10-09, this commit)

| Suite | Result |
|---|---|
| Unit + offline integration, SQLite | **44 passed** (28.6 s) |
| Unit + offline integration, PostgreSQL 16 | **44 passed** (31.0 s) |
| Live, Experiential Labs | **8 passed** (61.9 s) |
| Browser E2E, Experiential Labs | **1 passed** (20.8 s) |
| `ruff` (error classes) | clean |
| `pip-audit` | no known vulnerabilities |
| `npm audit --omit=dev` | 0 high/critical; 2 moderate in react-router (fix only in v7, see SECURITY.md) |
| Frontend typecheck + production build | clean |

Manually verified (not automated in CI because it needs Docker-in-Docker and the 4.6 GB sandbox
image): a task on the **docker runtime** ran inside a resource-limited OpenHands agent-server
container as the non-root `openhands` user, with no Docker socket present, reached the platform MCP
server for knowledge search, wrote an artifact to the mounted workspace, and the container was
removed afterwards. The production image was also built and started read-only with all
capabilities dropped against PostgreSQL (`/readyz` green, security headers present).

No load or soak testing has been performed; no deployment scale is claimed as validated.
