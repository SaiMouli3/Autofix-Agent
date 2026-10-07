package agents

import (
	"fmt"
	"math"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

var FinanceMeta = Meta{
	ID: "finance", Name: "Finance Agent", ShortName: "Finance", Icon: "landmark",
	Question:    "Am I actually making money?",
	Description: "Owns financial intelligence — revenue, gross and net profit, margins, refunds, payment failures, expenses and cash flow.",
	DataSources: []string{"Store orders", "Payment gateway", "Ad platforms", "Courier invoices", "Expense ledger"},
	Responsibilities: []string{"Revenue", "Gross profit", "Net profit", "Gross margin", "Net margin", "Refunds",
		"Payment failures", "Expenses", "Cash flow", "Profitability"},
}

const (
	gatewayFee  = 0.02
	codHandling = 30.0
	codLagDays  = 7
)

// PnL is a deterministic profit & loss statement for a window.
type PnL struct {
	GrossSales      float64 `json:"grossSales"`
	Refunds         float64 `json:"refunds"`
	NetRevenue      float64 `json:"netRevenue"`
	COGS            float64 `json:"cogs"`
	GrossProfit     float64 `json:"grossProfit"`
	Shipping        float64 `json:"shipping"`
	Marketing       float64 `json:"marketing"`
	PaymentFees     float64 `json:"paymentFees"`
	Opex            float64 `json:"opex"`
	Expenses        float64 `json:"expenses"`
	NetProfit       float64 `json:"netProfit"`
	GrossMargin     float64 `json:"grossMargin"`
	NetMargin       float64 `json:"netMargin"`
	Orders          float64 `json:"orders"`
	CashIn          float64 `json:"cashIn"`
	CashOut         float64 `json:"cashOut"`
	PaymentFailures float64 `json:"paymentFailures"`
	FailedAmount    float64 `json:"failedAmount"`
	Inventory       float64 `json:"inventoryPurchases"`
}

type pnlAcc struct {
	b    func(time.Time) int // bucket index or -1
	rows []PnL
}

// ComputePnL builds PnL rows for each bucket returned by idx (n buckets).
func ComputePnL(ds *model.Dataset, n int, idx func(time.Time) int) []PnL {
	rows := make([]PnL, n)
	returnedCost := map[string]float64{}
	for _, r := range ds.Returns {
		if o := ds.OrderByID[r.OrderID]; o != nil {
			for _, it := range o.Items {
				if it.ProductID == r.ProductID {
					returnedCost[r.ID] = it.UnitCost * float64(r.Qty)
				}
			}
		}
	}
	for i := range ds.Orders {
		o := &ds.Orders[i]
		s := ds.ShipByOrder[o.ID]
		if b := idx(o.CreatedAt); b >= 0 && orderCounted(o) {
			p := &rows[b]
			p.Orders++
			p.GrossSales += o.Total
			if o.Status != model.OrderRTO {
				p.COGS += orderCOGS(o)
			}
			if s != nil && s.ShippedAt != nil {
				p.Shipping += s.Cost
			}
			if o.PaymentMethod == "prepaid" {
				p.PaymentFees += o.Total * gatewayFee
				p.CashIn += o.Total
			} else if o.Status == model.OrderDelivered || o.Status == model.OrderReturned {
				p.PaymentFees += codHandling
			}
		}
		// COD cash arrives after delivery + remittance lag.
		if o.PaymentMethod == "cod" && s != nil && s.DeliveredAt != nil {
			if b := idx(s.DeliveredAt.Add(codLagDays * 24 * time.Hour)); b >= 0 {
				rows[b].CashIn += o.Total
			}
		}
	}
	for _, r := range ds.Returns {
		if b := idx(r.CreatedAt); b >= 0 {
			rows[b].COGS -= returnedCost[r.ID] * 0.85 // restocked, minus write-off
		}
	}
	for _, rf := range ds.Refunds {
		if b := idx(rf.CreatedAt); b >= 0 {
			rows[b].Refunds += rf.Amount
		}
	}
	for _, m := range ds.CampMetrics {
		if b := idx(m.Date.Add(12 * time.Hour)); b >= 0 {
			rows[b].Marketing += m.Spend
		}
	}
	for _, f := range ds.Finance {
		if b := idx(f.Date.Add(12 * time.Hour)); b >= 0 {
			rows[b].Opex += f.Opex
			rows[b].PaymentFailures += float64(f.PaymentFailures)
			rows[b].FailedAmount += f.FailedAmount
		}
	}
	for _, s := range ds.InvHistory {
		if b := idx(s.Date.Add(12 * time.Hour)); b >= 0 {
			rows[b].Inventory += s.Restocked
		}
	}
	for i := range rows {
		p := &rows[i]
		p.NetRevenue = p.GrossSales - p.Refunds
		p.GrossProfit = p.NetRevenue - p.COGS
		p.Expenses = p.Shipping + p.Marketing + p.PaymentFees + p.Opex
		p.NetProfit = p.GrossProfit - p.Expenses
		p.GrossMargin = analytics.Ratio(p.GrossProfit, p.NetRevenue) * 100
		p.NetMargin = analytics.Ratio(p.NetProfit, p.NetRevenue) * 100
		p.CashIn -= p.Refunds
		p.CashOut = p.Inventory + p.Expenses
	}
	return rows
}

func windowPnL(ds *model.Dataset, from, to time.Time) PnL {
	return ComputePnL(ds, 1, func(t time.Time) int {
		if !t.Before(from) && t.Before(to) {
			return 0
		}
		return -1
	})[0]
}

func AnalyzeFinance(c *Ctx) Result {
	ds, r, now := c.DS, c.R, c.Now
	cur := windowPnL(ds, r.From, r.To)
	prev := windowPnL(ds, r.PrevFrom, r.PrevTo)
	if r.Granularity == "hour" {
		// Daily ledgers (marketing, opex) are pro-rated for intraday ranges.
		frac := r.To.Sub(r.From).Hours() / 24
		dayCur := windowPnL(ds, analytics.StartOfDay(r.From), analytics.StartOfDay(r.From).Add(24*time.Hour))
		dayPrev := windowPnL(ds, analytics.StartOfDay(r.PrevFrom), analytics.StartOfDay(r.PrevFrom).Add(24*time.Hour))
		for _, pair := range []struct{ p, d *PnL }{{&cur, &dayCur}, {&prev, &dayPrev}} {
			pair.p.Marketing = pair.d.Marketing * frac
			pair.p.Opex = pair.d.Opex * frac
			pair.p.Expenses = pair.p.Shipping + pair.p.Marketing + pair.p.PaymentFees + pair.p.Opex
			pair.p.NetProfit = pair.p.GrossProfit - pair.p.Expenses
			pair.p.NetMargin = analytics.Ratio(pair.p.NetProfit, pair.p.NetRevenue) * 100
			pair.p.CashOut = pair.p.Inventory + pair.p.Expenses
		}
	}
	buckets := trendBuckets(r)
	rows := ComputePnL(ds, len(buckets), func(t time.Time) int {
		if i := r.Bucket(t); i < len(buckets) {
			return i
		}
		return -1
	})
	if r.Granularity == "hour" {
		day := windowPnL(ds, analytics.StartOfDay(r.From), analytics.StartOfDay(r.From).Add(24*time.Hour))
		for i := range rows {
			rows[i].Marketing = day.Marketing / 24
			rows[i].Opex = day.Opex / 24
			rows[i].Expenses = rows[i].Shipping + rows[i].Marketing + rows[i].PaymentFees + rows[i].Opex
			rows[i].NetProfit = rows[i].GrossProfit - rows[i].Expenses
			rows[i].NetMargin = analytics.Ratio(rows[i].NetProfit, rows[i].NetRevenue) * 100
			rows[i].CashOut = rows[i].Inventory + rows[i].Expenses
		}
	}
	var trend []H
	for i, b := range buckets {
		p := rows[i]
		trend = append(trend, H{"t": r.Label_(b), "revenue": math.Round(p.NetRevenue), "grossProfit": math.Round(p.GrossProfit), "netProfit": math.Round(p.NetProfit),
			"grossMargin": analytics.Round(p.GrossMargin, 1), "netMargin": analytics.Round(p.NetMargin, 1), "cashIn": math.Round(p.CashIn), "cashOut": math.Round(p.CashOut),
			"netCash": math.Round(p.CashIn - p.CashOut), "refunds": math.Round(p.Refunds), "paymentFailures": p.PaymentFailures})
	}
	spark := func(f func(PnL) float64) []float64 {
		out := make([]float64, len(rows))
		for i, p := range rows {
			out[i] = f(p)
		}
		return out
	}
	kpis := []KPI{
		NewKPI("revenue", "Net revenue", cur.NetRevenue, prev.NetRevenue, "currency", "up"),
		NewKPI("grossProfit", "Gross profit", cur.GrossProfit, prev.GrossProfit, "currency", "up"),
		NewKPI("netProfit", "Net profit", cur.NetProfit, prev.NetProfit, "currency", "up"),
		NewKPI("grossMargin", "Gross margin", cur.GrossMargin, prev.GrossMargin, "percent", "up"),
		NewKPI("netMargin", "Net margin", cur.NetMargin, prev.NetMargin, "percent", "up"),
		NewKPI("refunds", "Refunds", cur.Refunds, prev.Refunds, "currency", "down"),
		NewKPI("expenses", "Operating expenses", cur.Expenses, prev.Expenses, "currency", "down"),
		NewKPI("cashFlow", "Net cash flow", cur.CashIn-cur.CashOut, prev.CashIn-prev.CashOut, "currency", "up"),
	}
	kpis[0].Spark = spark(func(p PnL) float64 { return p.NetRevenue })
	kpis[1].Spark = spark(func(p PnL) float64 { return p.GrossProfit })
	kpis[2].Spark = spark(func(p PnL) float64 { return p.NetProfit })
	kpis[7].Spark = spark(func(p PnL) float64 { return p.CashIn - p.CashOut })
	kpis[6].Hint = "Shipping, marketing, payment fees & overheads"

	expenses := []H{
		{"key": "cogs", "label": "Cost of goods", "value": math.Round(cur.COGS), "prev": math.Round(prev.COGS)},
		{"key": "marketing", "label": "Marketing", "value": math.Round(cur.Marketing), "prev": math.Round(prev.Marketing)},
		{"key": "opex", "label": "Overheads", "value": math.Round(cur.Opex), "prev": math.Round(prev.Opex)},
		{"key": "shipping", "label": "Shipping", "value": math.Round(cur.Shipping), "prev": math.Round(prev.Shipping)},
		{"key": "refunds", "label": "Refunds", "value": math.Round(cur.Refunds), "prev": math.Round(prev.Refunds)},
		{"key": "fees", "label": "Payment fees", "value": math.Round(cur.PaymentFees), "prev": math.Round(prev.PaymentFees)},
	}
	for _, e := range expenses {
		e["shareOfRevenue"] = analytics.Round(analytics.Ratio(e["value"].(float64), cur.GrossSales)*100, 1)
		e["prevShare"] = analytics.Round(analytics.Ratio(e["prev"].(float64), prev.GrossSales)*100, 1)
	}
	// Waterfall from gross sales to net profit.
	waterfall := []H{
		{"label": "Gross sales", "value": math.Round(cur.GrossSales), "kind": "total"},
		{"label": "Refunds", "value": -math.Round(cur.Refunds), "kind": "delta"},
		{"label": "COGS", "value": -math.Round(cur.COGS), "kind": "delta"},
		{"label": "Gross profit", "value": math.Round(cur.GrossProfit), "kind": "subtotal"},
		{"label": "Marketing", "value": -math.Round(cur.Marketing), "kind": "delta"},
		{"label": "Shipping", "value": -math.Round(cur.Shipping), "kind": "delta"},
		{"label": "Overheads", "value": -math.Round(cur.Opex), "kind": "delta"},
		{"label": "Fees", "value": -math.Round(cur.PaymentFees), "kind": "delta"},
		{"label": "Net profit", "value": math.Round(cur.NetProfit), "kind": "total"},
	}
	perOrder := H{
		"aov": math.Round(analytics.Ratio(cur.GrossSales, cur.Orders)), "cogs": math.Round(analytics.Ratio(cur.COGS, cur.Orders)),
		"shipping": math.Round(analytics.Ratio(cur.Shipping, cur.Orders)), "marketing": math.Round(analytics.Ratio(cur.Marketing, cur.Orders)),
		"refunds": math.Round(analytics.Ratio(cur.Refunds, cur.Orders)), "contribution": math.Round(analytics.Ratio(cur.GrossProfit-cur.Shipping-cur.Marketing-cur.PaymentFees, cur.Orders)),
	}
	insights := financeInsights(c, cur, prev)
	health := 0.45*analytics.Score(cur.NetMargin, 14, -5) + 0.3*analytics.Score(cur.GrossMargin, 62, 40) + 0.25*analytics.Score(analytics.Ratio(cur.Refunds, cur.GrossSales)*100, 3, 12)
	healthPrev := 0.45*analytics.Score(prev.NetMargin, 14, -5) + 0.3*analytics.Score(prev.GrossMargin, 62, 40) + 0.25*analytics.Score(analytics.Ratio(prev.Refunds, prev.GrossSales)*100, 3, 12)
	view := H{"kpis": kpis, "trend": trend, "expenses": expenses, "waterfall": waterfall, "perOrder": perOrder, "pnl": cur, "prevPnl": prev,
		"healthBreakdown": []H{
			{"label": "Net margin", "score": math.Round(analytics.Score(cur.NetMargin, 14, -5))},
			{"label": "Gross margin", "score": math.Round(analytics.Score(cur.GrossMargin, 62, 40))},
			{"label": "Refund leakage", "score": math.Round(analytics.Score(analytics.Ratio(cur.Refunds, cur.GrossSales)*100, 3, 12))},
		}}
	changes := []Change{}
	for _, k := range kpis {
		changes = append(changes, ChangeFromKPI(k))
	}
	sum := summarize(FinanceMeta, now, health, healthPrev, insights, Headline{Label: "Net margin", Value: analytics.Round(cur.NetMargin, 1), Unit: "percent"}, len(ds.Orders)+len(ds.Refunds))
	return Result{Summary: sum, Insights: insights, Changes: changes, View: view, Activity: scanActivity(c, FinanceMeta.ID, "finance")}
}

func financeInsights(c *Ctx, cur, prev PnL) []Insight {
	ds, now := c.DS, c.Now
	var out []Insight
	// Revenue vs profit divergence over the last 14 days vs the prior 14.
	sod := analytics.StartOfDay(now)
	a := windowPnL(ds, sod.AddDate(0, 0, -14), sod)
	b := windowPnL(ds, sod.AddDate(0, 0, -28), sod.AddDate(0, 0, -14))
	revCh := analytics.Pct(a.NetRevenue, b.NetRevenue)
	marginCh := a.NetMargin - b.NetMargin
	if marginCh < -1.5 {
		// Which cost line grew most as a share of revenue?
		type line struct {
			label string
			a, b  float64
		}
		lines := []line{
			{"Marketing", a.Marketing, b.Marketing}, {"Refunds", a.Refunds, b.Refunds}, {"Shipping", a.Shipping, b.Shipping},
			{"Cost of goods", a.COGS, b.COGS}, {"Overheads", a.Opex, b.Opex},
		}
		worst, worstD := "", 0.0
		var ev []Evidence
		for _, l := range lines {
			d := analytics.Ratio(l.a, a.GrossSales)*100 - analytics.Ratio(l.b, b.GrossSales)*100
			if d > worstD {
				worst, worstD = l.label, d
			}
		}
		ev = append(ev, EvC("Net revenue (14d)", INR(a.NetRevenue), revCh, "pct", map[bool]string{true: "good", false: "bad"}[revCh >= 0]))
		ev = append(ev, EvC("Net margin", Pct1(a.NetMargin), marginCh, "pts", "bad"))
		for _, l := range lines {
			d := analytics.Ratio(l.a, a.GrossSales)*100 - analytics.Ratio(l.b, b.GrossSales)*100
			if d > 0.5 {
				ev = append(ev, EvC(l.label+" % of sales", Pct1(analytics.Ratio(l.a, a.GrossSales)*100), d, "pts", "bad"))
			}
		}
		title := fmt.Sprintf("Net margin fell %.1f points in the last 14 days", -marginCh)
		if revCh > 0 {
			title = fmt.Sprintf("Revenue is up %.0f%% but net margin fell %.1f points", revCh, -marginCh)
		}
		lost := -marginCh / 100 * a.NetRevenue / 14 * 30
		id := stableID("finance", "margin")
		out = append(out, Insight{
			ID: id, AgentID: "finance", Severity: SevImportant, Title: title,
			Summary:        fmt.Sprintf("Net margin moved from %.1f%% to %.1f%%. The biggest driver is %s, which grew %.1f points as a share of sales.", b.NetMargin, a.NetMargin, lower(worst), worstD),
			Evidence:       ev,
			LikelyCause:    fmt.Sprintf("%s is growing faster than revenue.", worst),
			Impact:         fmt.Sprintf("%s/month of profit lost vs the prior run-rate", INR(lost)),
			ImpactValue:    -lost,
			Recommendation: "Address the cost drivers flagged by the Marketing and Product agents before scaling spend further.",
			Actions:        []Action{{Label: "Investigate", Intent: "investigate", Href: "/agents/finance"}},
			DetectedAt:     detectedAt(now, id, 300), Confidence: 0.88,
		})
	}
	// Payment failure spike (last 3 days vs prior 14).
	var f3, f14, o3, o14 float64
	for _, f := range ds.Finance {
		age := sod.Sub(f.Date).Hours() / 24
		if age <= 2 {
			f3 += float64(f.PaymentFailures)
		} else if age <= 16 {
			f14 += float64(f.PaymentFailures)
		}
	}
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if o.PaymentMethod != "prepaid" {
			continue
		}
		age := sod.Sub(analytics.StartOfDay(o.CreatedAt)).Hours() / 24
		if age <= 2 {
			o3++
		} else if age <= 16 {
			o14++
		}
	}
	rate3 := analytics.Ratio(f3, f3+o3) * 100
	rate14 := analytics.Ratio(f14, f14+o14) * 100
	if rate3-rate14 > 2 {
		lostRev := 0.0
		for _, f := range ds.Finance {
			if sod.Sub(f.Date).Hours()/24 <= 2 {
				lostRev += f.FailedAmount
			}
		}
		id := stableID("finance", "payfail")
		out = append(out, Insight{
			ID: id, AgentID: "finance", Severity: SevImportant,
			Title:   fmt.Sprintf("Payment failure rate jumped to %.1f%%", rate3),
			Summary: fmt.Sprintf("%.0f prepaid payment attempts failed in the last 3 days (%.1f%% vs a %.1f%% baseline), worth %s in attempted orders.", f3, rate3, rate14, INR(lostRev)),
			Evidence: []Evidence{
				EvC("Failure rate (3d)", Pct1(rate3), rate3-rate14, "pts", "bad"),
				Ev("Failed attempts", Num(f3)),
				Ev("Attempted value", INR(lostRev)),
			},
			LikelyCause:    "Gateway-side degradation — failures are spread across products and customers, not tied to any one segment.",
			Impact:         fmt.Sprintf("Up to %s/month in lost prepaid orders if it persists", INR(lostRev/3*30*0.35)),
			ImpactValue:    -lostRev / 3 * 30 * 0.35,
			Recommendation: "Raise a ticket with the payment gateway and enable the backup gateway for UPI and cards; send payment-retry links to failed checkouts.",
			Actions:        []Action{{Label: "Investigate", Intent: "investigate", Href: "/agents/finance#payments"}, {Label: "Assign", Intent: "assign"}},
			DetectedAt:     detectedAt(now, id, 90), Confidence: 0.86,
		})
	}
	// Refund leakage.
	refundRate := analytics.Ratio(a.Refunds, a.GrossSales) * 100
	refundPrev := analytics.Ratio(b.Refunds, b.GrossSales) * 100
	if refundRate-refundPrev > 0.6 {
		id := stableID("finance", "refunds")
		out = append(out, Insight{
			ID: id, AgentID: "finance", Severity: SevInfo,
			Title:          fmt.Sprintf("Refunds now consume %.1f%% of sales", refundRate),
			Summary:        fmt.Sprintf("Refunds were %s over the last 14 days, up from %.1f%% of sales in the prior 14.", INR(a.Refunds), refundPrev),
			Evidence:       []Evidence{EvC("Refunds % of sales", Pct1(refundRate), refundRate-refundPrev, "pts", "bad"), Ev("Refunds (14d)", INR(a.Refunds))},
			Recommendation: "See the Product agent's return-spike finding — fixing the root cause product addresses most of this.",
			Actions:        []Action{{Label: "View returns", Intent: "view", Href: "/agents/orders?tab=data&status=returned"}},
			ImpactValue:    -(refundRate - refundPrev) / 100 * a.GrossSales / 14 * 30,
			Impact:         fmt.Sprintf("%s/month extra refunds", INR((refundRate-refundPrev)/100*a.GrossSales/14*30)),
			DetectedAt:     detectedAt(now, id, 500), Confidence: 0.9,
		})
	}
	_ = cur
	_ = prev
	sortInsights(out)
	return out
}
