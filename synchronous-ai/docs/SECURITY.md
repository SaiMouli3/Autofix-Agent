# Security model

## Identity and access

* **Authentication** — email + password, Argon2id hashes (`argon2-cffi`), constant-time login with a
  dummy hash for unknown users, per-IP rate limiting on auth endpoints, password policy (12+ chars,
  3 character classes). First-run setup can require `SCA_BOOTSTRAP_TOKEN`. SSO/OIDC is not yet
  implemented (see *Limitations*).
* **Sessions** — opaque 256-bit tokens in `HttpOnly`, `SameSite=Lax` (and `Secure` in production)
  cookies; only the SHA-256 is stored server-side; server-side revocation (logout, password change
  revokes other sessions, deactivation revokes all).
* **CSRF** — per-session token; every non-GET request must send `X-CSRF-Token` matching the session.
* **RBAC** — roles per organization membership: Organization Administrator, Agent Administrator,
  Agent Operator, Approver, Read-only Viewer (`backend/sca/security/rbac.py`). Every endpoint
  declares the permission it needs; the UI hides controls but the server is authoritative.
* **Tenant isolation** — all organization-owned rows carry `org_id`; handlers load objects through
  `scoped()` and return 404 for other tenants (tested). Agent configs cannot reference another
  tenant's provider, integration, knowledge source or agent.

## Secrets

* Provider and integration credentials and webhook secrets are encrypted with Fernet
  (AES-128-CBC + HMAC-SHA256) under `SCA_SECRET_KEY` (rotation supported). Agent records store only
  references. API responses expose a non-reversible fingerprint, never the value.
* Plaintext is decrypted only inside the backend at the moment of use. Agents never receive
  integration credentials: HTTP integrations are called by the platform gateway, which injects them.
* Redaction runs on logs, task events, audit details and error messages, both by pattern (API key
  shapes, bearer tokens, JWTs, private keys, `password=` …) and by exact value for every credential
  decrypted in the process.
* Tests assert the live provider key never appears in task events, API responses, the frontend
  bundle or the server log.

### Integration OAuth tokens

- **Storage:** OAuth client secrets, access tokens and refresh tokens are held in one Fernet-encrypted
  secret per integration. They are registered for log redaction and are never returned by the API.
  The API reports only connection state, scopes, expiry and a 6-character client-ID hint.
- **Authorization requests:** each uses PKCE S256 and a 256-bit state. Only the state's SHA-256 is
  stored. A state is single-use, expires after 10 minutes, and is bound to the organization and the
  user who started it. Another signed-in user cannot complete it.
- **Endpoints:** token and authorize URLs must be https and pass the outbound network policy. A
  vendor-supplied `instance_url` is checked the same way before it becomes the API host.
- **Refresh:** refreshes are serialized and committed independently, which handles refresh-token
  rotation. `invalid_grant` marks the integration as needing reauthorization instead of retrying forever.
- **Callback URL:** `SCA_PUBLIC_BASE_URL` determines the registered callback URL. In production it
  must be the public https origin.

## Agent containment

* **Tool permissions** — only granted OpenHands tools are instantiated; platform tools are filtered
  from the agent's tool list *and* re-authorized on every call against the pinned agent version and
  a per-execution token (revoked when the execution ends).
* **Sandbox** (docker runtime) — one OpenHands agent-server container per execution, CPU/memory/PID
  limits, `no-new-privileges`, non-root user, no Docker socket, only the session directory mounted.
  The **local runtime is not an isolation boundary** (development only).
* **Execution limits** — iteration cap, tool-call cap, task timeout (watchdog interrupt), per-task
  and monthly budgets on estimated cost, delegation depth/cycle limits, per-agent and global
  concurrency.
* **Approvals** — OpenHands confirmation policies (`always`, `risky` with the LLM security analyzer)
  park the conversation until a human approves or rejects the exact pending action; integration
  write/destructive operations always require approval. Agents have no API access to approvals, so
  an agent can never approve its own action; the four-eyes option additionally prevents the
  requester from approving their own task. Decisions are atomic (first decision wins).
* **Prompt injection** — every agent's system suffix states that tool output, documents, web pages,
  webhook payloads and API responses are untrusted data; platform tools wrap returned content in
  `<untrusted_data>` blocks. This reduces but cannot eliminate injection risk — which is why
  permissions, approvals and the gateway are enforced outside the model. A live test plants an
  injected instruction in a knowledge document and asserts it is not followed.

## Network

* **SSRF guard** for integrations, MCP servers and provider base URLs: http(s) only, no embedded
  credentials, DNS-resolved targets must be public unless explicitly allow-listed
  (`SCA_ALLOWED_PRIVATE_HOSTS`); cloud metadata endpoints are always blocked; redirects are not
  followed; responses are size-limited and time-limited; per-integration rate limits.
* Production refuses plain-HTTP integration targets.
* Security headers: CSP (`default-src 'self'`), `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS in production. File downloads are served with
  `Content-Security-Policy: sandbox` and as attachments.
* Webhooks: HMAC-SHA256 over `timestamp.body`, ±5-minute window, event-id deduplication, payload
  passed to the agent as untrusted data.

## Audit

Append-only `audit_events`, hash-chained per organization (each record includes the previous
record's hash). Recorded: logins/failures, setup, user/role/team changes, provider and integration
changes (credential fingerprints only), agent create/update (tool and policy diffs), task
submission/outcomes/retries/recovery, approvals requested/decided/expired, integration calls,
knowledge searches and document changes, schedule changes and webhook receipts, artifact access.
`GET /api/audit/verify` detects tampering (tested). Retention pruning re-anchors the chain at the
oldest retained record.

## Known limitations

* No SSO/OIDC/SAML or MFA yet — front the app with an identity-aware proxy if required.
* The in-process rate limiter is per replica.
* In the docker runtime the model API key is passed to the sandbox's agent-server (it performs the
  LLM calls). The agent's shell runs as the same user inside that container, so a determined agent
  could read the key from the server process. Use provider keys scoped to this platform, with
  spending limits, and rotate them regularly.
* The `risky` approval mode depends on the model's own risk labels (OpenHands `LLMSecurityAnalyzer`);
  use `always` for agents that touch important systems.
* `network_access=false` disables integrations and MCP servers for an agent; it does not block
  outbound traffic from the terminal tool. Use a dedicated Docker network with egress filtering
  (`SCA_DOCKER_NETWORK`) for that.
* Remaining frontend advisories: `react-router-dom` 6.30.6 has two moderate advisories fixed only
  in v7 (open redirects for untrusted navigation targets; SSR hydration). The app navigates only
  to internal routes and does not use SSR.
