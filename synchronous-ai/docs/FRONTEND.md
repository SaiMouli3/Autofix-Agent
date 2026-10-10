# Frontend

React 18 + TypeScript + Vite, TanStack Query for server state, React Router for URL state.
Every screen reads from and writes to the real API — there is no mock or demo data in the app.
Mocks exist only in `frontend/e2e/ui-states.mocked.spec.ts`, which is clearly labelled as mocked.

## Design system

Tokens live at the top of `src/styles.css`:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F7F7F5` | app background |
| `--surface` / `--surface-2` | `#FFFFFF` / `#F1F2EF` | panels / secondary fills |
| `--ink` / `--muted` | `#202321` / `#6B706B` | primary / secondary text (muted darkened from `#737873` for AA contrast) |
| `--border` | `#E4E6E1` | dividers |
| `--accent` | `#C65D32` | primary actions, selection |
| `--success` `--warning` `--danger` `--info` | `#27845A` `#9A6417` `#C44848` `#4776A8` | status (warning darkened from `#B7791F` for contrast) |

Inter Variable and JetBrains Mono Variable are self-hosted via `@fontsource-variable` (no external
font requests). A 4 px spacing grid and 6–10 px radii are used. No gradients, glass effects or emoji.

Reusable components (`src/components/ui.tsx`): `Status` (colour + symbol + text, never colour
alone), `Tag`, `Empty`, `Alert`, `ErrorState` (distinct 403 / 404 / retryable states), `Skeleton`,
`Dialog` (focus trap, Escape, focus restore), `useConfirm` (optional type-to-confirm), `Menu` (arrow
keys), `Tabs`, `Pager`, `SearchField`, `SortHeader`, `KV`, toasts and an `ErrorBoundary`. Charts
(`charts.tsx`) are hand-rolled SVG with axis titles, units, gridlines and a data-table alternative.

### Agent identity — "dots and bots"

`BotMark` renders a small bot face per agent (deterministic from the agent id, or chosen in the
wizard). Idle agents show two eyes; while an execution runs the eyes become three pulsing dots
(the familiar "thinking" indicator); attention states add a corner marker. The mark is always
paired with a text status, and the animation stops under `prefers-reduced-motion`.

## Layout

Three regions: primary navigation, the agent list (search, status filter, grouping by category or
team, per-user pins, unread markers driven by the SSE stream) and the workspace. The sidebar
collapses (persisted per browser) and becomes a drawer below 760 px (Escape closes it). The agent
workspace has a header (model id, status, active task, actions), a conversation/task thread with
inline approvals and execution summaries, a composer, and a collapsible right panel with the
live activity timeline and agent details.

Routes are code-split with `React.lazy`. Filters, sort, pagination and tabs live in the URL so views
are shareable.

## Security

The browser never receives provider or integration credentials; forms post keys once and the API
returns only fingerprints. Sessions use HttpOnly cookies plus a CSRF header. Only UI preferences
(sidebar collapse, pins, time windows) are stored in `localStorage`. All permission checks in the
UI are cosmetic — the backend enforces RBAC on every request.

## Backend capabilities the UI deliberately does not fake

| Requested | Status | What the UI does |
|---|---|---|
| Pause / resume a running execution | Not supported by the orchestrator | Offers **Cancel execution** only |
| Organization switching | Single organization per deployment | Organization shown, no switcher |
| Actual (invoiced) cost | Not available from providers' APIs | Costs labelled **estimate**, computed from published rates |
| Integration "connected" | Requires a successful live test | A saved credential alone shows **Untested** |

**Attachments.** The composer accepts documents (PDF, Word, Excel, CSV, text, Markdown, JSON, HTML,
YAML, XML; up to `SCA_MAX_UPLOAD_BYTES`) and images (PNG, JPG, WebP, GIF; up to 10 MB) through the
📎 button, drag and drop, or paste (screenshots). Files upload immediately (`POST /api/attachments`,
type checked against the content) and are linked to the task on submit (`attachment_ids`, at most
10). When the task starts, they are copied into the workspace under `attachments/`, document text is
extracted (with a `.txt` copy) and included in the agent's first message as untrusted data (20,000
characters per document, 60,000 in total; the rest is in the `.txt` file), and images are sent to
vision-capable models (downscaled to at most 1568 px) or described as unavailable otherwise. Sent
attachments appear under the message and download with the task's permissions; unsent uploads are
visible only to their uploader and are purged after a day.

**Deleting an agent** (agent menu → *Delete agent*, type the name to confirm) is permanent:
`DELETE /api/agents/{id}` removes its versions, tasks, sessions, schedules and workspace files.
The API refuses (409) while it has active tasks or pending approvals. Usage records and the
hash-chained audit log are kept (`agent.deleted`), and agents that could delegate to it get a new
configuration version without it. To keep history, **Disable** the agent instead.

## Tests

```bash
npm run typecheck
npm run build
npm run test:ui          # mocked UI states: empty, 500 + retry, 401 redirect, viewer role,
                         # 403 state, approval confirmation, dialog focus, Ctrl+K, mobile drawer
EXP_LABS_API_KEY=… ../scripts/e2e.sh   # real end-to-end flow against a fresh instance
```
