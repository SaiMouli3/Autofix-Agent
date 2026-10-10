# Testing

| Suite | Command | Needs |
|---|---|---|
| Unit | `pytest tests/test_unit.py` | nothing |
| Offline integration (real server, real OpenHands runtime, DB, workers) | `pytest -m "not live and not docker"` | nothing (set `SCA_DATABASE_URL` to run on PostgreSQL) |
| Live (real runtime + real model provider) | `EXP_LABS_API_KEY=… pytest -m live` | provider key, internet |
| Browser E2E (Playwright, fresh instance) | `EXP_LABS_API_KEY=… scripts/e2e.sh platform.spec salesforce-oauth` | provider key, Chromium |
| **Mocked** UI states (Playwright, no backend) | `cd frontend && npm run test:ui` | Chromium |

Mock providers are used in exactly one place: `tests/test_api.py` starts a tiny OpenAI-compatible
server to **inject failures** (HTTP 401 and 503) and a scripted fallback reply, which a real
provider cannot be made to produce on demand. Everything else runs against the real stack.

The second, clearly separated exception is `frontend/e2e/ui-states.mocked.spec.ts`: it serves the
built bundle and answers `/api` with fixtures copied from real responses, to exercise UI states that
cannot be produced on demand (empty data, HTTP 500 + retry, 401 redirect, viewer role, 403 state,
approval confirmation incl. CSRF header, dialog focus trap, Ctrl+K, mobile drawer). It never
claims anything about backend behaviour.

The third is the OAuth vendor test double used by `backend/tests/test_oauth.py` and
`frontend/e2e/salesforce-oauth.spec.ts`. It is a local server shaped like Salesforce's OAuth/REST
and SAP Gateway's CSRF endpoints, because real vendors cannot be made to expire, rotate or revoke
tokens on demand. The platform side of those tests (UI, API, storage, gateway) is real.

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
selected (risky-tool and no-approval confirmations); configuration persists; task submitted in the
agent workspace composer; live events visible; result
saved and displayed; second agent; both execute concurrently; both histories accessible; a viewer
cannot create agents/tasks or traverse workspaces, anonymous access is refused; the provider key is
absent from the JS/CSS bundle, API responses and the server log.

## Recorded results (2026-10-09, this commit — frontend redesign)

| Suite | Result |
|---|---|
| Unit + offline integration, SQLite | **57 passed** (35.6 s), incl. OAuth sign-in/refresh/rotation/revocation and SAP CSRF against a local vendor test double |
| Connector *Test connection* against live Shopify, Meta Graph and Meta Ads MCP endpoints (invalid token) | all 4 reached the vendor and reported HTTP 401 as failed |
| Browser E2E through the redesigned UI, Experiential Labs | **1 passed** (22.8 s) |
| Browser E2E: Salesforce one-click OAuth via the connector gallery (real platform, vendor test double) | **1 passed** (2.5 s; also standalone on a fresh instance) |
| Live: Salesforce authorize + token endpoints, SAP sandbox (placeholder credentials) | reached the vendors; rejected as `invalid_client_id` / HTTP 401 |
| Mocked UI-state tests | **9 passed** |
| `ruff` (CI error classes) | clean |
| `npm audit --omit=dev --audit-level=high` | passes; 2 moderate in react-router (fix only in v7, see SECURITY.md) |
| Frontend typecheck + production build | clean |
| Provider key in `dist/` or tracked files | not found |

| Unit + offline integration, PostgreSQL 16 | **57 passed** (36.1 s) |

Not re-run for this commit: the live pytest suite (last: 8 passed; agent runtime code unchanged since).

Manually verified (not automated in CI because it needs Docker-in-Docker and the 4.6 GB sandbox
image): a task on the **docker runtime** ran inside a resource-limited OpenHands agent-server
container as the non-root `openhands` user, with no Docker socket present, reached the platform MCP
server for knowledge search, wrote an artifact to the mounted workspace, and the container was
removed afterwards. The production image was also built and started read-only with all
capabilities dropped against PostgreSQL (`/readyz` green, security headers present).

No load or soak testing has been performed; no deployment scale is claimed as validated.
