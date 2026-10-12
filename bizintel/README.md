# BizIntel — business discovery & company intelligence

A client-configurable B2B research workspace. Users pick a location and radius, discover real businesses, research their official websites, extract published contact details, build evidence-backed company profiles, score fit against configurable criteria, organize leads, draft outreach and export to CSV/XLSX.

Nothing in the UI is fabricated: every number, status and claim comes from the database or a live provider. There are no demo fixtures.

## Quick start

```bash
cd bizintel
cp .env.example .env      # add keys (see "Providers")
npm install
npm run dev               # API on :8787, web on http://localhost:5173
```

Production:

```bash
npm run build             # typecheck + web bundle into dist/web
npm start                 # API + static web on :8787
```

Requires Node 22.13+ (uses the built-in `node:sqlite`). Data lives in `data/` (SQLite + export files) and is gitignored.

Checks: `npm run typecheck`, `npm run lint`, `npm test`.

## Deploying to Render

`render.yaml` at the repository root is a Render Blueprint for this app:
- one Node web service rooted at `bizintel/`
- a 1 GB persistent disk at `/var/data` for the SQLite database and exports (a disk requires a paid instance)
- a health check on `/api/health`

1. Merge this app into the branch Render deploys, or select this branch when creating the Blueprint.
2. In Render, choose **New → Blueprint** and pick this repository.
3. When prompted, fill in the secret values: `TAVILY_API_KEY`, `LLM_API_KEY`, `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD` and `BIZINTEL_USER_AGENT`.

**Always set `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` on a public URL.** The app has no sign-in. Without them, anyone with the link can run searches on your Tavily and model credits.

## Architecture

```
src/shared/   Types, industry taxonomy and domain helpers shared by API and UI
src/server/   Fastify API, SQLite (node:sqlite), background job lanes
  providers/  Photon, Nominatim, Overpass, Tavily, OpenAI-compatible LLM, status registry
  research/   Crawler, HTML extraction, researcher (grounded evidence), scoring, outreach
  jobs/       Search pipeline, research jobs, exports (CSV/XLSX streaming)
  repo/       Data access
src/web/      React 18 + TypeScript + Vite + Tailwind (design tokens in styles/tokens.css)
  components/ ui/ (design system), layout/ (shell), business/, search/, company/
  pages/      One lazy-loaded module per route
tests/        Vitest unit tests (extraction, grounding, scoring, dedupe, CSV safety)
```

### Search pipeline (background job, cancellable)

1. **Resolve location**: the user always picks a geocoder suggestion explicitly; low-confidence matches need confirmation.
2. **Discover**: OpenStreetMap via Overpass (radius query, mirror failover). If every mirror fails it falls back to Nominatim and records a "results may be incomplete" note on the search.
3. **Dedupe**: collapses the same place mapped twice and keeps the closest N.
4. **Identify websites** (Standard/Deep): a web search is accepted only when the domain contains a distinctive token of the business name, never a directory or social site.
5. **Enrich contacts**: respects robots.txt and crawls a bounded number of key pages (home, contact, about, services…). It extracts `mailto:`/`tel:` links, visible addresses and phone numbers, and schema.org data.
6. **Research**: the LLM gets only the retrieved text and must cite a URL plus a verbatim excerpt for each claim. Any claim whose excerpt is not found in the cited document is downgraded to *hypothesis*.
7. **Analyze opportunities**: a deterministic, explainable score built from workspace-configured weights.
8. **Prepare results**.

Results appear in the table as soon as discovery finishes, so one slow website never blocks the rest. Per-search caps on model and web-search calls bound cost.

## Providers

| Provider | Purpose | Credential | Status |
|---|---|---|---|
| Photon (OSM) | Location autocomplete | none | working |
| Nominatim (OSM) | Reverse geocoding, fallback discovery | none (1 req/s policy) | working |
| Overpass (OSM) | Radius business discovery | none | working (mirror failover) |
| Built-in crawler | Official website pages | none | working |
| Tavily | Website lookup, third-party sources, extraction fallback | `TAVILY_API_KEY` | working |
| Language model | Summaries, evidence classification, opportunities, outreach | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (optional `LLM_TEMPERATURE`) | working — tested with Experiential Labs (`https://api.experientiallabs.ai/v1`, model `claude-haiku-5.5`) |

Without a language model, research still extracts published facts and contacts. Reports are then labelled "extraction only".

Set `BIZINTEL_USER_AGENT` to identify your deployment to OSM services. Their usage policies require it.

## Not yet implemented / needs a decision

- **Authentication and multiple workspaces**: the app runs as a single local workspace. The sidebar shows "Local user · no sign-in configured" instead of a fake profile. Adding SSO/auth also enables per-user permissions on qualification overrides and per-workspace export isolation.
- **Commercial data providers** (Google Places, Foursquare, company-size/firmographic data, email verification): not wired up. They would plug in behind the provider interfaces in `src/server/providers/`.
- **Email sending**: intentionally absent. Drafts can be copied or exported only.
- **Notifications**: omitted, because no notification system exists yet.

## API surface (selected)

`GET /api/overview` · `GET /api/geocode?q=` · `POST /api/searches` · `GET /api/searches/:id` · `POST /api/searches/:id/cancel` · `POST /api/searches/:id/retry-failed` · `GET /api/businesses` (filters, sort, server-side paging) · `GET /api/businesses/:id/{contacts,pages,evidence,report,opportunity,activity,notes}` · `POST /api/research` · `POST /api/businesses/:id/qualification` · `GET|POST /api/lists…` · `POST /api/outreach/drafts/generate` · `POST /api/exports` · `GET /api/exports/:id/download` · `GET /api/providers` · `POST /api/providers/:key/test` · `GET|PUT /api/config`
