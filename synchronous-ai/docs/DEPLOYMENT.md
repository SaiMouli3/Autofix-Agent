# Deployment, operations, backup and upgrade

## Where work happens

With API-hosted models, **inference runs at the provider** (e.g. Experiential Labs). The platform
server runs the UI, API, orchestration, OpenHands agent loops, tools, sandboxes, knowledge indexing
and the database. Sizing is therefore driven by concurrent executions and what agents do in their
sandboxes (builds, scripts), not by model size.

## Requirements

Measured on the development host (no load testing has been performed; treat these as starting points):

| Component | Observed / required |
|---|---|
| API process (incl. 4 workers, idle-to-light load) | ~350 MB RSS |
| Each local-runtime execution | tmux + shell processes, typically < 200 MB |
| Each Docker sandbox | bounded by the agent's policy (`memory_mb`, default 2048 MB; `cpu_limit`, default 1 core) |
| Images | platform 1.5 GB, `ghcr.io/openhands/agent-server:1.53.0-python` 4.6 GB, postgres 0.4 GB |
| Database | PostgreSQL 14+ (16 tested). SQLite is fine for single-node evaluation |
| Storage | uploads + workspaces + DB; plan GBs per active agent workspace |
| Network egress | model provider API (HTTPS), integrations you configure, container registry (sandbox image) |
| Software | Docker 24+ for the sandbox runtime; `tmux` in the platform image (included) |

A reasonable first production node for ~4–8 concurrent sandboxed executions: 8 vCPU, 32 GB RAM,
100 GB SSD. `SCA_MAX_WORKERS` bounds concurrency per API process.

## Environments

`SCA_ENV=development|test|production`. Production forces secure cookies and HSTS, disables the
OpenAPI docs, requires `SCA_SECRET_KEY`, and only allows HTTPS integration targets. Keep separate
databases, secret keys and provider keys per environment.

## Docker Compose

```bash
cp .env.example .env
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # → SCA_SECRET_KEY
openssl rand -hex 24                                                                      # → SCA_BOOTSTRAP_TOKEN
docker compose up -d --build
docker compose logs -f app
```

The app container runs as a non-root user with a read-only root filesystem, `cap_drop: ALL` and
`no-new-privileges`; state lives in the `appdata` volume (`/data`) and PostgreSQL. Migrations run
automatically at startup (`SCA_AUTO_MIGRATE=0` to disable and run `alembic upgrade head` yourself).

### Sandboxed runtime (recommended for production)

```bash
docker pull ghcr.io/openhands/agent-server:1.53.0-python
DOCKER_GID=$(getent group docker | cut -d: -f3) \
  docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d --build
```

* Every execution starts its own agent-server container with CPU/memory/PID limits; the container
  is removed at the end of the execution. Agents never receive the Docker socket.
* The platform itself needs Docker API access to start sandboxes. Daemon access is root-equivalent
  on that host: use a dedicated sandbox host and `DOCKER_HOST=tcp://…:2376` with TLS client
  certificates rather than mounting the socket where possible.
* Sandboxes call back to the platform MCP endpoint (`/mcp/platform`) using per-execution tokens;
  make port 8000 reachable from the Docker bridge but firewall it from everything else.
* Behind an egress proxy, set `SCA_DOCKER_PROXY_URL` (as reachable from containers) and
  `SCA_DOCKER_CA_BUNDLE` for TLS-intercepting proxies.
* The local runtime executes agent shell commands **inside the platform process's environment**;
  an agent could read platform files and environment variables. Use it only for development.

## TLS and reverse proxy

Terminate TLS in front of the app (nginx, Caddy, Traefik, a cloud load balancer). Requirements:
forward `X-Forwarded-*`, disable response buffering for `/api/stream` (Server-Sent Events) and
allow long-lived connections there. Example (nginx):

```nginx
location /api/stream { proxy_pass http://app:8000; proxy_buffering off; proxy_read_timeout 1h; }
location /           { proxy_pass http://app:8000; client_max_body_size 30m; }
```

Rate limiting inside the app is per process; for multi-replica deployments enforce limits at the
proxy/gateway as well. Restrict `/metrics` to your monitoring network.

## Where files are stored in the cloud

Agent output files (workspaces), uploaded knowledge documents and the development encryption key
live under `SCA_DATA_DIR` (`/data` in the image); everything else is in PostgreSQL. Users never
need server paths: each task's **Files** tab lists its workspace files with **Download**, served by
the API with the same permissions as the task.

`/data` must be a **persistent volume**, or files disappear when the container is replaced:

| Platform | `/data` | Database |
|---|---|---|
| Single VM (Compose) | the `appdata` volume, on the VM disk (back it up / snapshot it) | the `pgdata` volume, or a managed PostgreSQL |
| AWS | EBS volume (one instance) or EFS (several instances / ECS / EKS) | Amazon RDS for PostgreSQL |
| Azure | Managed Disk (one instance) or Azure Files (several) | Azure Database for PostgreSQL |
| Google Cloud | Persistent Disk (one instance) or Filestore (several) | Cloud SQL for PostgreSQL |
| Kubernetes | a PersistentVolumeClaim (ReadWriteMany when replicas > 1) | managed PostgreSQL |

With more than one API replica, `/data` must be **shared** (EFS / Azure Files / Filestore / RWX
PVC), because a task's files are written by whichever replica ran it and read by whichever serves
the download. Object storage (S3, Blob, GCS) is not used directly; mount it only through a
filesystem layer if you must. Container platforms without volumes (for example plain serverless
containers) are not suitable.

## Scaling out

Several API replicas can share one PostgreSQL database: task claims are atomic and leases recover
work from dead replicas. Two caveats: (1) a task parked for approval lives in the memory of the
replica that ran it — in the local runtime any replica can resume it from the shared workspace
volume, in the docker runtime it is lost if that replica restarts (the task then fails cleanly);
(2) SSE notifications are in-process, so other replicas' events arrive via the 2-second DB poll.

## Observability

* `GET /healthz` (liveness), `GET /readyz` (DB, dispatcher, watchdog, Docker when enabled).
* `GET /metrics` — Prometheus text: tasks by status, active/max workers, parked tasks, RSS.
* JSON logs on stdout with request ids; secrets redacted by pattern and by registered value.
* Every task has a `trace_id`; events, audit records and the UI's *Logs & traces* tab correlate on
  task and trace ids.
* Monitoring & Usage page: tokens, estimated cost, durations (p50/p90), failure causes, queue age,
  worker utilization, process/host resources.

## Backup and restore

Back up three things together:

1. **Database** — `pg_dump -Fc -U sca sca > sca-$(date +%F).dump`
   (restore: `pg_restore -c -d sca sca-….dump`). SQLite: stop the app or use `sqlite3 sca.db ".backup …"`.
2. **Data directory** (`/data`): `uploads/` (original documents) and `workspaces/` (agent files,
   local conversation state).
3. **`SCA_SECRET_KEY`** — stored separately (secret manager). Without it, stored provider and
   integration credentials cannot be decrypted; they would have to be re-entered.

Restore: restore the DB and `/data`, start the app with the same `SCA_SECRET_KEY`. Tasks that were
running at backup time are recovered by the lease mechanism (re-queued or marked `worker_lost`).

Verify audit integrity after a restore: *Audit Logs → Verify integrity* (or `GET /api/audit/verify`).

## Key rotation

Set `SCA_SECRET_KEY=new_key,old_key`, restart, and re-save credentials (or rotate them in the UI);
once everything has been re-encrypted, remove the old key. Provider/integration credentials can be
rotated at any time in the UI; the audit log records the fingerprint, never the value.

## Upgrades

1. Back up (above).
2. Pull the new version; read the changelog for migration notes.
3. `docker compose build && docker compose up -d` — Alembic migrations run at startup.
4. If you bump the OpenHands SDK, also bump `SCA_DOCKER_IMAGE` to the matching agent-server tag
   and run `pytest -m live` against a staging provider key before promoting.

## Data retention

Task events older than `SCA_EVENT_RETENTION_DAYS` (90) and audit events older than
`SCA_AUDIT_RETENTION_DAYS` (365) are pruned hourly; expired platform tokens are purged daily.
Deleting a knowledge document removes its file, chunks and embeddings. Workspaces are kept until
removed by an operator (they are the task artifacts).
