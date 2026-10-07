# E-commerce AI OS

**Your AI operating team for e-commerce.** One dashboard. Specialized AI agents. Your entire business monitored continuously.

Ten specialist agents each own one business domain and continuously turn raw store data into
**monitoring → detection → explanation → recommendation → action**. A Business Insights agent sits on
top, connects their findings across domains, and tells the merchant what to do next.

| Agent | Owns | Core question |
|---|---|---|
| Order & Delivery | orders, fulfilment, shipping, delays, NDR, RTO, cancellations, returns, refunds, courier SLA | Where are my orders and what is going wrong? |
| Customer | profiles, LTV, repeat/new, segments, cohorts, churn risk, repurchase likelihood | Who are my customers and what are they doing? |
| Review & Reputation | ratings, sentiment, themes, negative-review spikes, AI review responses | What are customers publicly saying? |
| Complaint & Support | tickets (WhatsApp/email/chat), SLA, escalations, root-cause clusters | What are customers reporting directly to us? |
| Product Intelligence | product health score, sales, margin, returns, complaints, growth | How are my products actually performing? |
| Inventory | stock, stockouts, low/over/dead stock, velocity, demand forecast, reorder qty | Do I have enough inventory? |
| Pricing & Competitor | competitor prices, discounts, ratings, positioning, persistent price cuts | How should I price? |
| Marketing | spend, ROAS, CAC, CTR, CPC, conversion funnel, campaign & channel performance | Is marketing generating profitable growth? |
| Finance | P&L, gross/net margin, refunds, payment failures, expenses, cash flow | Am I actually making money? |
| Market & News | industry news, competitor announcements, regulation, trends | What is changing outside my business? |
| **Business Insights** | connects → reasons → prioritises → recommends | **What should I do next?** |

## Quick start

### Option A — Docker (everything)

```bash
cd ecommerce-ai-os
docker compose up --build
# open http://localhost:3000  ·  demo login: admin@loomline.in / demo-loomline
```

### Option B — local dev

```bash
# 1) API (Go 1.26). Runs fully in memory if DATABASE_URL / REDIS_URL are unset.
cd ecommerce-ai-os/api
cp .env.example .env          # optional; export the variables you need
go run ./cmd/server            # http://localhost:8080

# 2) Web (Node 22)
cd ../web
npm install
npm run dev                    # http://localhost:3000 (proxies /api → API_URL, default http://localhost:8080)
```

On first start the API seeds a demo workspace: **admin@loomline.in / demo-loomline** (Loomline, a fashion D2C
store). The login page has an "Explore the demo store" shortcut. New sign-ups go through onboarding and can
generate a demo store for any business type (fashion, electronics, beauty, home, grocery, D2C).

### Connecting the AI model

Everything works without an API key: metrics, detection and insights are deterministic, and the assistant
falls back to a grounded rule-based reasoner. To enable LLM reasoning, set these on the **API** (never the web
app). With Docker, put them in `ecommerce-ai-os/.env` (gitignored):

```bash
# Experiential Labs gateway (preferred when set)
EXP_LABS_API_KEY=xpl_...
EXP_LABS_BASE_URL=https://api.experientiallabs.ai/v1
EXP_LABS_MODEL=claude-opus-5-5   # model name as the gateway exposes it
EXP_LABS_PROTOCOL=openai         # openai (/chat/completions) or anthropic (/messages)
```

Or, directly against Anthropic:

```bash
ANTHROPIC_API_KEY=...            # your key
ANTHROPIC_BASE_URL=...           # optional: gateway / labs endpoint
LLM_MODEL=claude-opus-5-5        # default
LLM_EFFORT=low                   # low | medium | high | xhigh | max
```

With a key, the assistant, executive brief and review-response drafts are written by the model from the
agents' structured findings (with citations back to the source insight); the model never computes metrics.

## Architecture

```
Next.js (web)  ──/api proxy──▶  Go Fiber API
                                 ├── httpapi   auth, tenancy, validation, rate limits, response cache
                                 ├── service   orchestration, assistant, briefs, tables/search
                                 ├── agents    10 domain agents + Business Insights agent
                                 │              metrics → rules/anomaly detection → insights → activity
                                 ├── llm       Claude client (reasoning/summarising only) + deterministic fallback
                                 ├── repo      PostgreSQL (or in-memory) — orgs → stores → business data
                                 ├── cache     Redis (or in-memory) — response cache, rate-limit counters
                                 └── seed      realistic demo data generator
```

* **Deterministic first.** Every number (revenue, margins, ROAS, return rates, velocity, forecasts, health
  scores) is computed in Go from raw records. Anomalies use windowed comparisons and significance tests
  (e.g. two-proportion z-tests for return and on-time rates).
* **Agents are independent; the Business Insights agent is not a duplicate.** It only reasons over other
  agents' findings — e.g. Product (return spike) + Reviews (negative surge) + Support (complaint cluster)
  → *"Potential product-quality issue"* with an evidence chain and ₹ impact.
* **Realistic demo data with real relationships.** ~17k orders, ~10k customers, 100 products, ~1.2k reviews,
  ~900 support tickets, 180 days of inventory, campaigns, competitor prices, finance and news. Returns
  reference delivered orders, reviews reference real customers/products, inventory is reconstructed from unit
  sales, campaign revenue is the revenue of attributed orders.
* **Seeded anomalies** (detected, not hard-coded): product return/complaint/review spike, competitor 12% price
  reset, best-seller stockout, Meta campaign ROAS collapse, courier deterioration in one region, payment
  gateway failures. `go test ./internal/agents` verifies each is detected across 6 catalogs × 2 seeds.

### Multi-tenancy & security

* `organizations → stores → business data`; every business table is keyed by `(store_id, id)`.
* The API resolves the store only after verifying it belongs to the caller's organization — another org's
  store ID is indistinguishable from a missing one (tested in `internal/httpapi/api_test.go`).
* bcrypt passwords, HS256 JWT in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production), fixed-window
  rate limits (auth, API, chat), input validation on every write, security headers, CSV formula-injection
  guard on exports. Secrets come only from environment variables; the browser never sees the API URL or keys.

### API

```
POST /api/auth/signup | login | logout | forgot      GET /api/auth/google
GET  /api/me                 GET|POST /api/stores
GET  /api/dashboard          GET /api/agents   GET /api/agents/:id   GET /api/agents/:id/insights|activity
PATCH /api/agents/:id/settings
GET  /api/insights           PATCH /api/insights/:id   (assign / dismiss / resolve)
GET  /api/notifications      POST /api/notifications/read|dismiss
GET  /api/orders | customers | products | inventory | reviews | complaints | marketing | finance | competitors | news
GET  /api/{orders,customers,products,inventory,reviews,complaints}/list   (search, filters, sort, paging, ?format=csv)
GET  /api/products/:id   GET /api/customers/:id   GET /api/search?q=
POST /api/reviews/:id/draft  PUT /api/reviews/:id/response
POST /api/actions            POST /api/ai/chat        GET /api/health
```

All analytical endpoints accept `range=today|yesterday|7d|30d|90d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`.

## Frontend

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · TanStack Query · Zustand ·
React Hook Form + Zod · Recharts · Radix primitives · cmdk · Lucide.

* Command center: business health ring (click a segment → agent), executive KPIs with sparklines and period
  comparison, AI Priority Center, agent grid, live agent activity, revenue vs previous period.
* Every agent page: Overview (domain dashboard), What I found, What changed, Recommendations, Activity,
  Data (server-side tables with search/filters/sort/column visibility/export/row expansion), Settings
  (pause, sensitivity, notification rules).
* Insight drill-down walks Observation → Evidence → Likely cause → Business impact → Recommended action,
  with Investigate / Assign / Dismiss (undo) / Apply actions that are logged to the agent's activity.
* Global AI assistant (⌘/Ctrl J), command palette (⌘/Ctrl K), notification center, light/dark themes tuned
  separately, responsive layouts down to 360px, skeleton/empty/error states throughout.
* Chart colours use a validated colour-blind-safe categorical order; status colours are reserved for state.

## Tests

```bash
cd api && go test ./...          # seed sizes, anomaly detection, auth + tenant isolation
cd web && npx tsc --noEmit && npm run build
```
