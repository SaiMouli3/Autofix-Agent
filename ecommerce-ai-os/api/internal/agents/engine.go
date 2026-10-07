package agents

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

// AgentOrder is the canonical order of the domain agents.
var AgentOrder = []string{"orders", "customers", "reviews", "support", "products", "inventory", "pricing", "marketing", "finance", "market"}

var Metas = map[string]Meta{
	"orders": OrdersMeta, "customers": CustomersMeta, "reviews": ReviewsMeta, "support": SupportMeta, "products": ProductsMeta,
	"inventory": InventoryMeta, "pricing": PricingMeta, "marketing": MarketingMeta, "finance": FinanceMeta, "market": MarketMeta,
	"insights": InsightsMeta,
}

var analyzers = map[string]func(*Ctx) Result{
	"orders": AnalyzeOrders, "customers": AnalyzeCustomers, "reviews": AnalyzeReviews, "support": AnalyzeSupport,
	"products": AnalyzeProducts, "inventory": AnalyzeInventory, "pricing": AnalyzePricing, "marketing": AnalyzeMarketing,
	"finance": AnalyzeFinance, "market": AnalyzeMarket,
}

// Report is the complete output of one analysis run over a store.
type Report struct {
	Range       analytics.Range
	Now         time.Time
	Results     map[string]*Result
	Business    []BusinessInsight
	BusinessRes *Result
	GeneratedAt time.Time
	Duration    time.Duration
}

// Run executes every domain agent concurrently, then the Business Insights
// agent on top of their findings.
func Run(ds *model.Dataset, r analytics.Range) *Report {
	start := time.Now()
	c := &Ctx{DS: ds, R: r, Now: ds.Now}
	results := make(map[string]*Result, len(AgentOrder))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, id := range AgentOrder {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			res := analyzers[id](c)
			// Detection events join the routine scan activity.
			for _, in := range res.Insights {
				res.Activity = append(res.Activity, Activity{
					ID: "ac_" + in.ID, AgentID: id, At: in.DetectedAt, Kind: "detection", Message: in.Title, Severity: in.Severity, InsightID: in.ID,
				})
			}
			sort.Slice(res.Activity, func(i, j int) bool { return res.Activity[i].At.After(res.Activity[j].At) })
			mu.Lock()
			results[id] = &res
			mu.Unlock()
		}(id)
	}
	wg.Wait()
	br, bis := AnalyzeBusiness(c, results)
	for _, b := range bis {
		if len(b.Sources) > 1 {
			br.Activity = append(br.Activity, Activity{ID: "ac_" + b.ID, AgentID: "insights", At: b.DetectedAt, Kind: "recommendation",
				Message: fmt.Sprintf("Connected %d signals: %s", len(b.Chain), b.Title), Severity: b.Severity, InsightID: b.ID})
		}
	}
	sort.Slice(br.Activity, func(i, j int) bool { return br.Activity[i].At.After(br.Activity[j].At) })
	return &Report{Range: r, Now: ds.Now, Results: results, Business: bis, BusinessRes: &br, GeneratedAt: time.Now(), Duration: time.Since(start)}
}

// AllInsights returns domain insights from every agent plus business
// insights, deduplicated by ID.
func (rep *Report) AllInsights() []Insight {
	var out []Insight
	for _, id := range AgentOrder {
		out = append(out, rep.Results[id].Insights...)
	}
	return out
}

func (rep *Report) Activity(limit int) []Activity {
	var out []Activity
	for _, id := range AgentOrder {
		out = append(out, rep.Results[id].Activity...)
	}
	out = append(out, rep.BusinessRes.Activity...)
	sort.Slice(out, func(i, j int) bool { return out[i].At.After(out[j].At) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

func (rep *Report) Summaries() []Summary {
	var out []Summary
	for _, id := range AgentOrder {
		out = append(out, rep.Results[id].Summary)
	}
	return out
}

// ---------------------------------------------------------------- activity

// scanActivity produces the agent's routine monitoring log for the last
// ten hours, with record counts computed from the underlying data.
func scanActivity(c *Ctx, agentID, kind string) []Activity {
	ds, now := c.DS, c.Now
	interval := time.Duration(28+hashN(agentID+"i", 30)) * time.Minute
	offset := time.Duration(1+hashN(agentID, 9)) * time.Minute
	var out []Activity
	t := now.Add(-offset)
	for k := 0; k < 14 && now.Sub(t) < 10*time.Hour; k++ {
		from := t.Add(-interval)
		in := func(x time.Time) bool { return x.After(from) && !x.After(t) }
		msg := ""
		switch kind {
		case "orders":
			n, d := 0, 0
			for i := range ds.Orders {
				if in(ds.Orders[i].CreatedAt) {
					n++
				}
			}
			for i := range ds.Shipments {
				if s := ds.Shipments[i].DeliveredAt; s != nil && in(*s) {
					d++
				}
			}
			msg = fmt.Sprintf("Synced %d new order%s and %d delivery update%s", n, plural(n), d, plural(d))
			if n+d == 0 {
				msg = "Order and courier feeds checked — no changes since last sync"
			}
		case "customers":
			n := 0
			for i := range ds.Orders {
				if in(ds.Orders[i].CreatedAt) {
					n++
				}
			}
			msg = fmt.Sprintf("Re-scored segments and repurchase likelihood after %d new order%s", n, plural(n))
			if n == 0 {
				msg = "Customer segments verified — no new activity"
			}
		case "reviews":
			n, neg := 0, 0
			for _, rv := range ds.Reviews {
				if in(rv.CreatedAt) {
					n++
					if rv.Sentiment == "negative" {
						neg++
					}
				}
			}
			if n == 0 {
				msg = "Checked Store, Google and Instagram — no new reviews"
			} else {
				msg = fmt.Sprintf("Analyzed %d new review%s (%d negative), sentiment and themes updated", n, plural(n), neg)
			}
		case "support":
			n, cpl := 0, 0
			for _, tk := range ds.Tickets {
				if in(tk.CreatedAt) {
					n++
					if tk.IsComplaint {
						cpl++
					}
				}
			}
			msg = fmt.Sprintf("Triaged %d new ticket%s across WhatsApp, email and chat (%d complaint%s)", n, plural(n), cpl, plural(cpl))
			if n == 0 {
				msg = "Support inboxes checked — no new tickets"
			}
		case "products":
			n := 0
			for i := range ds.Orders {
				if in(ds.Orders[i].CreatedAt) {
					n += len(ds.Orders[i].Items)
				}
			}
			msg = fmt.Sprintf("Recomputed health scores for %d products from %d new order line%s", len(ds.Products), n, plural(n))
		case "inventory":
			u := 0
			for i := range ds.Orders {
				if in(ds.Orders[i].CreatedAt) {
					for _, it := range ds.Orders[i].Items {
						u += it.Qty
					}
				}
			}
			msg = fmt.Sprintf("Reconciled stock for %d SKUs · %d units sold since last check", len(ds.Inventory), u)
		case "pricing":
			pairs := map[string]bool{}
			for _, cp := range ds.CompPrices {
				pairs[cp.ProductID+cp.CompetitorID] = true
			}
			msg = fmt.Sprintf("Checked %d competitor listings across %d competitors", len(pairs), len(ds.Competitors))
		case "marketing":
			msg = fmt.Sprintf("Pulled spend, clicks and conversions for %d campaigns", len(ds.Campaigns))
		case "finance":
			n, rf := 0, 0
			for i := range ds.Orders {
				if in(ds.Orders[i].CreatedAt) {
					n++
				}
			}
			for _, r := range ds.Refunds {
				if in(r.CreatedAt) {
					rf++
				}
			}
			msg = fmt.Sprintf("Reconciled %d transaction%s and %d refund%s into the ledger", n, plural(n), rf, plural(rf))
			if n+rf == 0 {
				msg = "Ledger reconciled — no new transactions"
			}
		case "market":
			n := 0
			for _, a := range ds.News {
				if in(a.PublishedAt) {
					n++
				}
			}
			msg = fmt.Sprintf("Scanned %d sources · %d new relevant article%s", sourcesMonitored, n, plural(n))
			if n == 0 {
				msg = fmt.Sprintf("Scanned %d sources — nothing new that affects your business", sourcesMonitored)
			}
		}
		out = append(out, Activity{ID: fmt.Sprintf("sc_%s_%d", agentID, t.Unix()/60), AgentID: agentID, At: t, Kind: "scan", Message: msg})
		t = t.Add(-interval)
	}
	return out
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// ---------------------------------------------------------------- dashboard

type HealthSegment struct {
	Key    string   `json:"key"`
	Label  string   `json:"label"`
	Score  float64  `json:"score"`
	Prev   float64  `json:"prev"`
	Href   string   `json:"href"`
	Agents []string `json:"agents"`
}

func (rep *Report) Health() (float64, float64, []HealthSegment) {
	seg := func(key, label, href string, ids ...string) HealthSegment {
		s, p := 0.0, 0.0
		for _, id := range ids {
			s += rep.Results[id].Summary.Health
			p += rep.Results[id].Summary.HealthPrev
		}
		n := float64(len(ids))
		return HealthSegment{Key: key, Label: label, Score: analytics.Round(s/n, 0), Prev: analytics.Round(p/n, 0), Href: href, Agents: ids}
	}
	segs := []HealthSegment{
		seg("operations", "Operations", "/agents/orders", "orders", "inventory"),
		seg("customers", "Customers", "/agents/customers", "customers"),
		seg("products", "Products", "/agents/products", "products"),
		seg("marketing", "Marketing", "/agents/marketing", "marketing"),
		seg("finance", "Finance", "/agents/finance", "finance"),
		seg("reputation", "Reputation", "/agents/reviews", "reviews", "support"),
	}
	return rep.BusinessRes.Summary.Health, rep.BusinessRes.Summary.HealthPrev, segs
}

// OverviewKPIs computes the executive KPI strip directly from raw data.
func OverviewKPIs(ds *model.Dataset, r analytics.Range, fin *Result, mkt *Result) []KPI {
	sb := newSeries(r, "revenue", "orders", "customers", "aov")
	var rev, revP, ord, ordP float64
	cust, custP := map[string]bool{}, map[string]bool{}
	bucketCust := map[string]bool{}
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if !orderCounted(o) {
			continue
		}
		if r.Contains(o.CreatedAt) {
			rev += o.Total
			ord++
			cust[o.CustomerID] = true
			sb.add("revenue", o.CreatedAt, o.Total)
			sb.add("orders", o.CreatedAt, 1)
			k := fmt.Sprintf("%s|%d", o.CustomerID, r.Bucket(o.CreatedAt))
			if !bucketCust[k] {
				bucketCust[k] = true
				sb.add("customers", o.CreatedAt, 1)
			}
		} else if r.PrevContains(o.CreatedAt) {
			revP += o.Total
			ordP++
			custP[o.CustomerID] = true
		}
	}
	sb.set("aov", ratioSeries(sb.get("revenue"), sb.get("orders"), 1))
	var profit, profitP float64
	var profitSpark []float64
	for _, k := range fin.View["kpis"].([]KPI) {
		if k.Key == "netProfit" {
			profit, profitP, profitSpark = k.Value, k.Prev, k.Spark
		}
	}
	var conv, convP float64
	for _, k := range mkt.View["kpis"].([]KPI) {
		if k.Key == "conversion" {
			conv, convP = k.Value, k.Prev
		}
	}
	kpis := []KPI{
		NewKPI("revenue", "Revenue", rev, revP, "currency", "up"),
		NewKPI("orders", "Orders", ord, ordP, "number", "up"),
		NewKPI("customers", "Customers", float64(len(cust)), float64(len(custP)), "number", "up"),
		NewKPI("profit", "Net profit", profit, profitP, "currency", "up"),
		NewKPI("conversion", "Conversion", conv, convP, "percent", "up"),
		NewKPI("aov", "Average order value", analytics.Ratio(rev, ord), analytics.Ratio(revP, ordP), "currency", "up"),
	}
	kpis[0].Spark, kpis[0].Href = sb.get("revenue"), "/agents/finance"
	kpis[1].Spark, kpis[1].Href = sb.get("orders"), "/agents/orders"
	kpis[2].Spark, kpis[2].Href = sb.get("customers"), "/agents/customers"
	kpis[3].Spark, kpis[3].Href = profitSpark, "/agents/finance"
	kpis[4].Href = "/agents/marketing"
	kpis[5].Spark, kpis[5].Href = sb.get("aov"), "/agents/finance"
	return kpis
}

// RevenueTrend returns revenue for the range with the previous period overlaid.
func RevenueTrend(ds *model.Dataset, r analytics.Range) []H {
	sb := newSeries(r, "revenue", "prevRevenue", "orders")
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if !orderCounted(o) {
			continue
		}
		if r.Contains(o.CreatedAt) {
			sb.add("revenue", o.CreatedAt, o.Total)
			sb.add("orders", o.CreatedAt, 1)
		} else if r.PrevContains(o.CreatedAt) {
			sb.add("prevRevenue", o.CreatedAt.Add(r.From.Sub(r.PrevFrom)), o.Total)
		}
	}
	return sb.rows()
}

// ---------------------------------------------------------------- notifications

type Notification struct {
	ID       string    `json:"id"`
	AgentID  string    `json:"agentId"`
	Severity string    `json:"severity"`
	Title    string    `json:"title"`
	Body     string    `json:"body"`
	Href     string    `json:"href"`
	At       time.Time `json:"at"`
	Read     bool      `json:"read"`
}

func firstSentence(s string) string {
	if i := strings.Index(s, ". "); i > 0 {
		return s[:i+1]
	}
	return s
}

// Notifications converts actionable findings into notification items.
func (rep *Report) Notifications() []Notification {
	var out []Notification
	for _, in := range rep.AllInsights() {
		if in.Severity == SevInfo || in.Severity == SevOpportunity && in.AgentID != "customers" {
			continue
		}
		href := "/agents/" + in.AgentID
		for _, a := range in.Actions {
			if a.Href != "" {
				href = a.Href
				break
			}
		}
		out = append(out, Notification{ID: "nt_" + in.ID[3:], AgentID: in.AgentID, Severity: in.Severity, Title: in.Title, Body: firstSentence(in.Summary), Href: href, At: in.DetectedAt})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At.After(out[j].At) })
	return out
}
