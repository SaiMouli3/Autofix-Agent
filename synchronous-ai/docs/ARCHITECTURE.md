# Architecture

## Baseline and strategy

The host repository (`Autofix-Agent`) contained a small Flask e-commerce demo and log-watcher
scripts — not the OpenHands monorepo. The OpenHands project has since split its agent runtime into
the **OpenHands Software Agent SDK** (`openhands-sdk`, `openhands-tools`, `openhands-workspace`) and a
containerized **agent-server**; the OpenHands application itself is built on them. Instead of
vendoring and rebranding the whole monorepo (hundreds of MB, an unrelated single-user product UI),
Synchronous Consulting AI depends on those published runtime packages (pinned to 1.53.0) and the
matching `ghcr.io/openhands/agent-server:1.53.0-python` image, and implements the missing
multi-agent management layer. The agent loop, tools, condenser, confirmation policies, security
analyzer, MCP client and Docker workspace are upstream code, unmodified.

```
 Browser (React SPA)
   │  cookies + CSRF, SSE (/api/stream)
   ▼
 FastAPI app ──────────────────────────────────────────────────────────────┐
   ├─ api/*           REST: auth, agents, tasks, approvals, providers,     │
   │                  integrations, knowledge, schedules, admin, dashboard │
   ├─ orchestrator/                                                        │
   │   dispatcher.py  claim queued tasks atomically → ThreadPool (N)       │
   │                  watchdog: leases, cancel, timeouts, approvals expiry │
   │                  scheduler loop, retention loop                       │
   │   executor.py    build OpenHands Agent + Conversation, run, translate │
   │                  events, approvals (park/resume), usage, artifacts    │
   ├─ runtime/                                                             │
   │   sandbox.py     local workspace dir | Docker agent-server per run    │
   │   platform_mcp   MCP server (/mcp/platform) with governed tools  ◄────┼── agents call back over MCP
   │   translate.py   SDK events → safe activity events (no reasoning)     │    with a per-run token
   ├─ services/       providers, knowledge (RAG), integrations gateway,    │
   │                  audit chain, secrets, scheduler, tasks, retention    │
   └─ security/       argon2, Fernet, RBAC, redaction, SSRF guard, limits  │
   ▼                                                                       │
 SQLite (dev) / PostgreSQL (prod)                                          │
                                                                           │
 Model provider (Experiential Labs, OpenAI-compatible, …) ◄── LLM calls ───┘
```

## Core concepts

* **Agent** — a persistent profile (identity, team, owner, status) with immutable **AgentVersion**
  configs (instructions, model, tools, integrations, knowledge, policies). Tasks pin a version, so
  edits apply only to subsequent executions.
* **Task** — a durable unit of work: instructions, priority, status
  (`queued → running → waiting_for_approval → completed | failed | timed_out | cancelled`),
  attempt/retry counters, timestamps, usage, result summary, error, trace id, idempotency key.
* **Execution session** — an OpenHands conversation + workspace. A task either starts a new session
  or continues one (same files and conversation memory; local runtime).
* **Task events** — redacted, user-safe activity stream persisted per task and pushed over SSE.

## Concurrency model

* The dispatcher polls (and is woken on submissions) for `queued` tasks ordered by priority, and
  claims each with `UPDATE tasks SET status='running' … WHERE id=? AND status='queued'`. Only one
  worker in any process can win, so a task runs at most once even with several API replicas.
* Global concurrency = `SCA_MAX_WORKERS` threads per process; per-agent concurrency =
  `policy.max_concurrent_tasks` (counted from the database, so it holds across replicas).
* Each OpenHands conversation runs synchronously inside its worker thread. Tasks of different
  agents (and of the same agent, within its limit) execute truly in parallel — verified by the
  live and E2E tests, which assert overlapping execution windows.
* Running tasks hold a **lease** renewed every 10 s. If a process dies, the lease expires and the
  task is re-queued (if retries remain) or failed with `worker_lost`. On startup, leases held by dead
  PIDs on the same host are recovered immediately.
* Approval waits do not hold worker slots: the conversation is **parked** in memory (and persisted
  to disk in local mode); the decision re-queues the task and a worker resumes it.
* OpenHands runtime modules are imported once at startup — concurrent first imports from worker
  threads were found to deadlock on Python's module import locks.

## Execution pipeline (executor.py)

1. Load the pinned config; enforce monthly budget; resolve/create the session; build the
   `openhands.sdk.LLM` (credentials decrypted in-process, published pricing attached for cost
   estimation, fallback model on retry after provider failure).
2. Tools: OpenHands `TerminalTool`, `FileEditorTool`, `TaskTrackerTool`, `GrepTool`, `GlobTool`,
   `BrowserToolSet` (opt-in) — only those granted. Platform capabilities (knowledge search, HTTP
   integrations, delegation) are attached as an MCP server with a per-execution bearer token;
   ungranted platform tools are hidden with `filter_tools_regex` **and** re-checked server-side.
   Assigned MCP integrations are attached directly.
3. The agent profile is rendered into `AgentContext.system_message_suffix`, including a fixed
   prompt-injection policy. A summarizing condenser keeps long runs within the context window.
4. Approval mode maps to OpenHands confirmation policies: `never` → `NeverConfirm`, `always` →
   `AlwaysConfirm`, `risky` → `ConfirmRisky` + `LLMSecurityAnalyzer`.
5. `conversation.run()`; every SDK event goes through `translate.py` (drops reasoning content,
   thinking blocks and free-form thoughts), redaction, and is persisted + broadcast.
6. Outcome: completed / failed (classified, retryable or not) / timed_out / cancelled / parked.
   Usage (tokens, requests, tool calls, estimated cost) and artifacts (files changed during the
   run, with SHA-256) are recorded; the platform token is revoked.

## Runtimes

| | `local` | `docker` |
|---|---|---|
| Where tools run | platform process, per-session directory | OpenHands agent-server container per execution |
| Isolation | none — development only | container: `--cpus`, `--memory`, `--pids-limit 512`, `no-new-privileges`, non-root user, no Docker socket, only the session directory mounted |
| Session memory | persisted conversation state (continuable) | workspace files persist; container removed after the run |
| Platform tools | MCP over loopback | MCP via `host.docker.internal` |

## Delegation

`delegate_task(agent_name, objective, context)` creates a child task (`inline=True`, depth+1) for an
agent in the caller's allow-list, rejects self-delegation and cycles (target already in the ancestor
chain), enforces `max_depth`, and executes the child synchronously in the calling thread with its
own config, tools, credentials and workspace — nothing is inherited. A `Delegation` row records
parent, child, agents, objective, permissions, status and result reference.

## Knowledge (RAG)

Upload → `IngestionJob` → extract (pypdf, python-docx, BeautifulSoup, plain text) → paragraph-aware
chunks (1400 chars, 200 overlap) → embeddings via the provider's `/embeddings` (if configured) →
`DocumentChunk`. Search = BM25 (always) blended 60/40 with cosine similarity when every candidate
chunk has an embedding. Results carry source/document/chunk references and are wrapped as
`<untrusted_data>` for the agent. Documents become `indexed` only after chunks are committed.

## Data model

26 tables (see `backend/sca/models.py`, migration `alembic/versions/0001_initial_schema.py`):
organizations, users, memberships, teams, team_members, auth_sessions, secrets, model_providers,
agents, agent_versions, execution_sessions, tasks, task_events, delegations, artifacts,
usage_records, platform_tokens, approval_requests, integrations, knowledge_sources, documents,
document_chunks, ingestion_jobs, schedules, webhook_deliveries, audit_events. Every org-owned row
carries `org_id`; API handlers fetch through `scoped()` which returns 404 for other tenants.
