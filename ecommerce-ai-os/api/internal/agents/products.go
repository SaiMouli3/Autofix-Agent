package agents

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

var ProductsMeta = Meta{
	ID: "products", Name: "Product Intelligence Agent", ShortName: "Products", Icon: "package",
	Question:    "How are my products actually performing?",
	Description: "Owns product-level intelligence — sales, profitability, quality signals from returns, complaints and reviews, and product opportunities.",
	DataSources: []string{"Catalog", "Order items", "Returns", "Reviews", "Support tickets"},
	Responsibilities: []string{"Product performance", "Product sales", "Product quality", "Profitability", "Return patterns",
		"Product complaints", "Review patterns", "Trends", "Opportunities", "Underperformers"},
}

// ProductStats is the deterministic scorecard for one product in a range.
type ProductStats struct {
	ID          string  `json:"id"`
	SKU         string  `json:"sku"`
	Name        string  `json:"name"`
	Category    string  `json:"category"`
	Price       float64 `json:"price"`
	Units       int     `json:"units"`
	Revenue     float64 `json:"revenue"`
	PrevRevenue float64 `json:"prevRevenue"`
	Growth      float64 `json:"growth"`
	GrossProfit float64 `json:"grossProfit"`
	Margin      float64 `json:"margin"`
	Returns     int     `json:"returns"`
	ReturnRate  float64 `json:"returnRate"`
	Rating      float64 `json:"rating"`
	Reviews     int     `json:"reviews"`
	Complaints  int     `json:"complaints"`
	Health      float64 `json:"health"`
	Scores      H       `json:"scores"`
	Stock       int     `json:"stock"`
}

func productMonthlyRevenue(ds *model.Dataset, pid string, now time.Time) float64 {
	w := analytics.LastDays(now, 30)
	s := 0.0
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if !w.Contains(o.CreatedAt) || !orderCounted(o) {
			continue
		}
		for _, it := range o.Items {
			if it.ProductID == pid {
				s += it.UnitPrice * float64(it.Qty)
			}
		}
	}
	return s
}

// ComputeProductStats computes per-product metrics for an arbitrary window.
func ComputeProductStats(ds *model.Dataset, from, to, prevFrom, prevTo time.Time) []ProductStats {
	idx := map[string]int{}
	out := make([]ProductStats, len(ds.Products))
	for i, p := range ds.Products {
		idx[p.ID] = i
		out[i] = ProductStats{ID: p.ID, SKU: p.SKU, Name: p.Name, Category: p.Category, Price: p.Price}
		if inv := ds.InvByProduct[p.ID]; inv != nil {
			out[i].Stock = inv.OnHand
		}
	}
	in := func(t, a, b time.Time) bool { return !t.Before(a) && t.Before(b) }
	delivered := make([]int, len(out))
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if !orderCounted(o) {
			continue
		}
		cur, prev := in(o.CreatedAt, from, to), in(o.CreatedAt, prevFrom, prevTo)
		if !cur && !prev {
			continue
		}
		for _, it := range o.Items {
			s := &out[idx[it.ProductID]]
			rev := it.UnitPrice * float64(it.Qty)
			if cur {
				s.Units += it.Qty
				s.Revenue += rev
				s.GrossProfit += (it.UnitPrice - it.UnitCost) * float64(it.Qty)
				if o.Status == model.OrderDelivered || o.Status == model.OrderReturned {
					delivered[idx[it.ProductID]] += it.Qty
				}
			} else {
				s.PrevRevenue += rev
			}
		}
	}
	for _, r := range ds.Returns {
		if in(r.CreatedAt, from, to) {
			out[idx[r.ProductID]].Returns += r.Qty
		}
	}
	ratingSum := make([]float64, len(out))
	for _, rv := range ds.Reviews {
		if in(rv.CreatedAt, from, to) {
			s := &out[idx[rv.ProductID]]
			s.Reviews++
			ratingSum[idx[rv.ProductID]] += float64(rv.Rating)
		}
	}
	for _, t := range ds.Tickets {
		if t.IsComplaint && t.ProductID != "" && in(t.CreatedAt, from, to) {
			if t.Category == "Sizing issue" || t.Category == "Product quality" || t.Category == "Damaged item" {
				out[idx[t.ProductID]].Complaints++
			}
		}
	}
	revs := make([]float64, len(out))
	for i := range out {
		revs[i] = out[i].Revenue
	}
	sort.Float64s(revs)
	for i := range out {
		s := &out[i]
		s.Growth = analytics.Round(analytics.Pct(s.Revenue, s.PrevRevenue), 1)
		s.Margin = analytics.Round(analytics.Ratio(s.GrossProfit, s.Revenue)*100, 1)
		s.ReturnRate = analytics.Round(analytics.Ratio(float64(s.Returns), math.Max(float64(delivered[i]), float64(s.Units)*0.8))*100, 1)
		if s.Reviews > 0 {
			s.Rating = analytics.Round(ratingSum[i]/float64(s.Reviews), 2)
		}
		// Health sub-scores.
		rank := float64(sort.SearchFloat64s(revs, s.Revenue)) / float64(len(revs)-1)
		sales := 30 + 70*rank
		if s.Growth < -30 {
			sales -= 15
		}
		complaintRate := analytics.Ratio(float64(s.Complaints), float64(s.Units)) * 100
		quality := analytics.Score(complaintRate, 0.5, 8)
		reviews := 60.0
		if s.Reviews >= 2 {
			reviews = analytics.Score(s.Rating, 4.7, 3.0)
		}
		returns := analytics.Score(s.ReturnRate, 3, 22)
		profit := analytics.Score(s.Margin, 68, 35)
		if s.Units == 0 {
			sales, quality, returns = 10, 70, 70
		}
		s.Scores = H{"sales": math.Round(sales), "quality": math.Round(quality), "reviews": math.Round(reviews), "returns": math.Round(returns), "profit": math.Round(profit)}
		s.Health = math.Round(0.25*sales + 0.2*quality + 0.2*reviews + 0.2*returns + 0.15*profit)
		s.Revenue = analytics.Round(s.Revenue, 0)
		s.PrevRevenue = analytics.Round(s.PrevRevenue, 0)
		s.GrossProfit = analytics.Round(s.GrossProfit, 0)
	}
	return out
}

func topBy(stats []ProductStats, n int, less func(a, b ProductStats) bool, filter func(ProductStats) bool) []ProductStats {
	var c []ProductStats
	for _, s := range stats {
		if filter == nil || filter(s) {
			c = append(c, s)
		}
	}
	sort.Slice(c, func(i, j int) bool { return less(c[i], c[j]) })
	if len(c) > n {
		c = c[:n]
	}
	return c
}

func AnalyzeProducts(c *Ctx) Result {
	ds, r, now := c.DS, c.R, c.Now
	stats := ComputeProductStats(ds, r.From, r.To, r.PrevFrom, r.PrevTo)
	minRev := func(s ProductStats) bool { return s.Units >= 8 }
	view := H{
		"top":         topBy(stats, 8, func(a, b ProductStats) bool { return a.Revenue > b.Revenue }, nil),
		"worst":       topBy(stats, 6, func(a, b ProductStats) bool { return a.Health < b.Health }, minRev),
		"fastest":     topBy(stats, 6, func(a, b ProductStats) bool { return a.Growth > b.Growth }, func(s ProductStats) bool { return s.PrevRevenue > 5000 }),
		"declining":   topBy(stats, 6, func(a, b ProductStats) bool { return a.Growth < b.Growth }, func(s ProductStats) bool { return s.PrevRevenue > 5000 }),
		"returnHeavy": topBy(stats, 6, func(a, b ProductStats) bool { return a.ReturnRate > b.ReturnRate }, minRev),
		"highProfit":  topBy(stats, 6, func(a, b ProductStats) bool { return a.GrossProfit > b.GrossProfit }, nil),
	}
	// Category roll-up.
	type cat struct{ rev, gp, units, returns float64 }
	cats := map[string]*cat{}
	var totalRev, totalGP, totalPrev float64
	var totalUnits, totalReturns int
	for _, s := range stats {
		x := cats[s.Category]
		if x == nil {
			x = &cat{}
			cats[s.Category] = x
		}
		x.rev += s.Revenue
		x.gp += s.GrossProfit
		x.units += float64(s.Units)
		x.returns += float64(s.Returns)
		totalRev += s.Revenue
		totalGP += s.GrossProfit
		totalPrev += s.PrevRevenue
		totalUnits += s.Units
		totalReturns += s.Returns
	}
	var catRows []H
	for k, v := range cats {
		catRows = append(catRows, H{"category": k, "revenue": analytics.Round(v.rev, 0), "margin": analytics.Round(analytics.Ratio(v.gp, v.rev)*100, 1),
			"units": v.units, "returnRate": analytics.Round(analytics.Ratio(v.returns, v.units)*100, 1)})
	}
	sort.Slice(catRows, func(i, j int) bool { return catRows[i]["revenue"].(float64) > catRows[j]["revenue"].(float64) })
	view["categories"] = catRows

	// Scatter: margin vs return rate, sized by revenue.
	var scatter []H
	for _, s := range stats {
		if s.Units >= 5 {
			scatter = append(scatter, H{"id": s.ID, "name": s.Name, "margin": s.Margin, "returnRate": s.ReturnRate, "revenue": s.Revenue, "health": s.Health, "category": s.Category})
		}
	}
	view["scatter"] = scatter

	insights := productsInsights(c, stats)
	// Featured product = product in the first insight, else the top seller.
	featured := ""
	for _, in := range insights {
		if in.Entity != nil && in.Entity.Type == "product" {
			featured = in.Entity.ID
			break
		}
	}
	if featured == "" && len(view["top"].([]ProductStats)) > 0 {
		featured = view["top"].([]ProductStats)[0].ID
	}
	for _, s := range stats {
		if s.ID == featured {
			view["featured"] = s
			view["featuredTrend"] = productTrend(c, s.ID)
		}
	}

	avgHealth, n := 0.0, 0.0
	for _, s := range stats {
		if s.Units > 0 {
			avgHealth += s.Health * float64(s.Units)
			n += float64(s.Units)
		}
	}
	avgHealth /= math.Max(n, 1)
	// Penalise when top products are unhealthy.
	health := avgHealth
	for _, s := range view["top"].([]ProductStats)[:3] {
		if s.Health < 65 {
			health -= 6
		}
	}
	prevStats := ComputeProductStats(ds, r.PrevFrom, r.PrevTo, r.PrevFrom.Add(-r.To.Sub(r.From)), r.PrevFrom)
	ph, pn := 0.0, 0.0
	for _, s := range prevStats {
		if s.Units > 0 {
			ph += s.Health * float64(s.Units)
			pn += float64(s.Units)
		}
	}
	healthPrev := ph / math.Max(pn, 1)
	active := 0
	for _, s := range stats {
		if s.Units > 0 {
			active++
		}
	}
	kpis := []KPI{
		NewKPI("revenue", "Product revenue", totalRev, totalPrev, "currency", "up"),
		NewKPI("units", "Units sold", float64(totalUnits), 0, "number", "up"),
		NewKPI("margin", "Gross margin", analytics.Ratio(totalGP, totalRev)*100, 0, "percent", "up"),
		NewKPI("returnRate", "Return rate", analytics.Ratio(float64(totalReturns), float64(totalUnits))*100, 0, "percent", "down"),
		NewKPI("active", "Selling SKUs", float64(active), float64(len(ds.Products)), "number", "up"),
	}
	// Previous-period comparisons for units / margin / returns.
	var pu, pr int
	var pgp, prev float64
	for _, s := range prevStats {
		pu += s.Units
		pr += s.Returns
		pgp += s.GrossProfit
		prev += s.Revenue
	}
	kpis[1] = NewKPI("units", "Units sold", float64(totalUnits), float64(pu), "number", "up")
	kpis[2] = NewKPI("margin", "Gross margin", analytics.Ratio(totalGP, totalRev)*100, analytics.Ratio(pgp, prev)*100, "percent", "up")
	kpis[3] = NewKPI("returnRate", "Return rate", analytics.Ratio(float64(totalReturns), float64(totalUnits))*100, analytics.Ratio(float64(pr), float64(pu))*100, "percent", "down")
	view["kpis"] = kpis
	view["healthBreakdown"] = []H{
		{"label": "Revenue-weighted product health", "score": math.Round(avgHealth)},
		{"label": "Top-seller health", "score": math.Round(health - avgHealth + 100)},
	}
	changes := []Change{}
	for _, k := range kpis {
		changes = append(changes, ChangeFromKPI(k))
	}
	sum := summarize(ProductsMeta, now, analytics.Clamp(health, 0, 100), healthPrev, insights, Headline{Label: "Avg. product health", Value: math.Round(avgHealth), Unit: "score"}, len(ds.Products))
	return Result{Summary: sum, Insights: insights, Changes: changes, View: view, Activity: scanActivity(c, ProductsMeta.ID, "products")}
}

// productTrend returns weekly units, returns and rating for one product over 12 weeks.
func productTrend(c *Ctx, pid string) []H {
	ds, now := c.DS, c.Now
	weeks := 12
	start := analytics.StartOfDay(now).AddDate(0, 0, -7*weeks+1)
	units := make([]float64, weeks)
	rets := make([]float64, weeks)
	rsum := make([]float64, weeks)
	rn := make([]float64, weeks)
	wk := func(t time.Time) int {
		if t.Before(start) {
			return -1
		}
		i := int(t.Sub(start).Hours() / 24 / 7)
		if i >= weeks {
			return -1
		}
		return i
	}
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if w := wk(o.CreatedAt); w >= 0 && orderCounted(o) {
			for _, it := range o.Items {
				if it.ProductID == pid {
					units[w] += float64(it.Qty)
				}
			}
		}
	}
	for _, r := range ds.Returns {
		if r.ProductID == pid {
			if w := wk(r.CreatedAt); w >= 0 {
				rets[w] += float64(r.Qty)
			}
		}
	}
	for _, rv := range ds.Reviews {
		if rv.ProductID == pid {
			if w := wk(rv.CreatedAt); w >= 0 {
				rsum[w] += float64(rv.Rating)
				rn[w]++
			}
		}
	}
	var out []H
	for i := 0; i < weeks; i++ {
		row := H{"t": start.AddDate(0, 0, 7*i).Format("2006-01-02"), "units": units[i], "returns": rets[i],
			"returnRate": analytics.Round(analytics.Ratio(rets[i], units[i])*100, 1)}
		if rn[i] > 0 {
			row["rating"] = analytics.Round(rsum[i]/rn[i], 2)
		}
		out = append(out, row)
	}
	return out
}

func productsInsights(c *Ctx, rangeStats []ProductStats) []Insight {
	ds, now := c.DS, c.Now
	var out []Insight
	// Return-rate spike: returns in the last 14 days vs the 56 days before,
	// normalised by units delivered in the matching windows.
	w := analytics.LastDays(now, 14)
	b := w.Before(56)
	type rr struct{ ret, units [2]float64 }
	m := map[string]*rr{}
	reasons := map[string]map[string]int{}
	for _, r := range ds.Returns {
		wi := -1
		if w.Contains(r.CreatedAt) {
			wi = 0
		} else if b.Contains(r.CreatedAt) {
			wi = 1
		}
		if wi < 0 {
			continue
		}
		if m[r.ProductID] == nil {
			m[r.ProductID] = &rr{}
		}
		m[r.ProductID].ret[wi] += float64(r.Qty)
		if wi == 0 {
			if reasons[r.ProductID] == nil {
				reasons[r.ProductID] = map[string]int{}
			}
			reasons[r.ProductID][r.Reason]++
		}
	}
	// Delivered units shifted by ~5 days (returns follow delivery).
	ws := analytics.Window{From: w.From.Add(-5 * 24 * time.Hour), To: w.To.Add(-5 * 24 * time.Hour)}
	bs := analytics.Window{From: b.From.Add(-5 * 24 * time.Hour), To: b.To.Add(-5 * 24 * time.Hour)}
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if o.Status != model.OrderDelivered && o.Status != model.OrderReturned {
			continue
		}
		wi := -1
		if ws.Contains(o.CreatedAt) {
			wi = 0
		} else if bs.Contains(o.CreatedAt) {
			wi = 1
		}
		if wi < 0 {
			continue
		}
		for _, it := range o.Items {
			if m[it.ProductID] == nil {
				m[it.ProductID] = &rr{}
			}
			m[it.ProductID].units[wi] += float64(it.Qty)
		}
	}
	var worst string
	worstLift := 0.0
	var totRet [2]float64
	for pid, v := range m {
		totRet[0] += v.ret[0]
		totRet[1] += v.ret[1]
		if v.units[0] < 40 || v.ret[0] < 8 {
			continue
		}
		cur := v.ret[0] / v.units[0]
		base := v.ret[1] / math.Max(v.units[1], 1)
		if cur-base > worstLift && analytics.ProportionZ(v.ret[0], v.units[0], v.ret[1], math.Max(v.units[1], 1)) > 2.5 {
			worstLift, worst = cur-base, pid
		}
	}
	if worst != "" {
		v := m[worst]
		p := ds.ProductByID[worst]
		cur := v.ret[0] / v.units[0] * 100
		base := v.ret[1] / math.Max(v.units[1], 1) * 100
		retCountChange := analytics.Pct(v.ret[0]/14, v.ret[1]/56)
		storeRetChange := analytics.Pct(totRet[0]/14, totRet[1]/56)
		contrib := analytics.Ratio(v.ret[0]-v.ret[1]/4, totRet[0]-totRet[1]/4) * 100
		topReason, topN, total := "", 0, 0
		for k, n := range reasons[worst] {
			total += n
			if n > topN {
				topReason, topN = k, n
			}
		}
		contribText := fmt.Sprintf("Store-wide returns are %s versus baseline, so this product stands out against the trend.", map[bool]string{true: "flat or down", false: "up"}[storeRetChange <= 2])
		if storeRetChange > 2 && contrib > 0 {
			contribText = fmt.Sprintf("It accounts for %.0f%% of the store-wide increase in returns.", math.Min(contrib, 100))
		}
		monthly := productMonthlyRevenue(ds, worst, now)
		impact := -(cur - base) / 100 * monthly
		id := stableID("products", "returns", worst)
		out = append(out, Insight{
			ID: id, AgentID: "products", Severity: SevCritical,
			Title:   fmt.Sprintf("%s return rate jumped to %.0f%%", p.Name, cur),
			Summary: fmt.Sprintf("Returns on %s rose %.0f%% over the last 14 days — the return rate is now %.1f%% versus a %.1f%% baseline. %s", p.Name, retCountChange, cur, base, contribText),
			Evidence: []Evidence{
				EvC("Return rate", Pct1(cur), cur-base, "pts", "bad"),
				EvC("Returns (14d)", Num(v.ret[0]), retCountChange, "pct", "bad"),
				Ev("Top reason", fmt.Sprintf("%s (%.0f%%)", topReason, analytics.Ratio(float64(topN), float64(total))*100)),
				EvC("Store-wide returns (daily)", fmt.Sprintf("%.1f/day", totRet[0]/14), storeRetChange, "pct", map[bool]string{true: "bad", false: "neutral"}[storeRetChange > 0]),
			},
			LikelyCause:    fmt.Sprintf("Return reasons are dominated by \"%s\" — a product-specification issue, likely linked to the latest batch from %s.", topReason, p.Supplier),
			Impact:         fmt.Sprintf("%s/month in refunds and reverse logistics", INR(-impact*1.15)),
			ImpactValue:    impact * 1.15,
			Recommendation: fmt.Sprintf("Inspect the latest %s batch against spec%s, and hold the next purchase order until QC sign-off.", p.Supplier, map[bool]string{true: ", update the size guidance on the product page", false: ", pull a sample for quality testing"}[strings.HasPrefix(topReason, "Size")]),
			Actions: []Action{
				{Label: "Investigate", Intent: "investigate", Href: "/agents/products?product=" + worst},
				{Label: "View returns", Intent: "view", Href: "/agents/orders?tab=data&status=returned&product=" + worst},
			},
			Entity:     &EntityRef{Type: "product", ID: worst, Name: p.Name},
			DetectedAt: detectedAt(now, id, 140), Confidence: 0.93,
		})
	}

	// Growth & decline over 28 days vs the previous 28.
	g := ComputeProductStats(ds, now.Add(-28*24*time.Hour), now, now.Add(-56*24*time.Hour), now.Add(-28*24*time.Hour))
	var fast, slow *ProductStats
	for i := range g {
		s := &g[i]
		if s.PrevRevenue < 15000 {
			continue
		}
		if fast == nil || s.Growth > fast.Growth {
			fast = s
		}
		if slow == nil || s.Growth < slow.Growth {
			slow = s
		}
	}
	if fast != nil && fast.Growth > 30 {
		inv := ds.InvByProduct[fast.ID]
		id := stableID("products", "fast", fast.ID)
		daysLeft := 0.0
		if inv != nil && fast.Units > 0 {
			daysLeft = float64(inv.OnHand) / (float64(fast.Units) / 28)
		}
		rec := "Increase visibility in campaigns and merchandising; secure stock for the next 45 days."
		if daysLeft > 0 && daysLeft < 21 {
			rec = fmt.Sprintf("Momentum is strong but stock covers only %.0f days — reorder before scaling promotion.", daysLeft)
		}
		out = append(out, Insight{
			ID: id, AgentID: "products", Severity: SevOpportunity,
			Title:   fmt.Sprintf("%s is your fastest-growing product (+%.0f%%)", fast.Name, fast.Growth),
			Summary: fmt.Sprintf("Revenue grew from %s to %s over the last 28 days with a %.0f%% gross margin.", INR(fast.PrevRevenue), INR(fast.Revenue), fast.Margin),
			Evidence: []Evidence{
				EvC("Revenue (28d)", INR(fast.Revenue), fast.Growth, "pct", "good"),
				Ev("Gross margin", Pct1(fast.Margin)),
				Ev("Stock cover", fmt.Sprintf("%.0f days", daysLeft)),
			},
			Recommendation: rec,
			Impact:         fmt.Sprintf("+%s/month if momentum is sustained", INR(fast.Revenue-fast.PrevRevenue)),
			ImpactValue:    fast.Revenue - fast.PrevRevenue,
			Actions:        []Action{{Label: "View product", Intent: "view", Href: "/agents/products?product=" + fast.ID}},
			Entity:         &EntityRef{Type: "product", ID: fast.ID, Name: fast.Name},
			DetectedAt:     detectedAt(now, id, 500), Confidence: 0.82,
		})
	}
	if slow != nil && slow.Growth < -30 {
		id := stableID("products", "slow", slow.ID)
		out = append(out, Insight{
			ID: id, AgentID: "products", Severity: SevImportant,
			Title:   fmt.Sprintf("%s revenue declined %.0f%%", slow.Name, -slow.Growth),
			Summary: fmt.Sprintf("Revenue fell from %s to %s over the last 28 days. Rating %.1f★, return rate %.1f%%.", INR(slow.PrevRevenue), INR(slow.Revenue), slow.Rating, slow.ReturnRate),
			Evidence: []Evidence{
				EvC("Revenue (28d)", INR(slow.Revenue), slow.Growth, "pct", "bad"),
				Ev("Rating", fmt.Sprintf("%.1f★", slow.Rating)),
			},
			LikelyCause:    "Demand shift — no quality signals (complaints, returns) explain the decline.",
			Recommendation: "Refresh imagery and test a bundle with a best-seller before considering markdowns.",
			ImpactValue:    slow.Revenue - slow.PrevRevenue,
			Impact:         fmt.Sprintf("%s/month revenue lost vs prior period", INR(slow.PrevRevenue-slow.Revenue)),
			Actions:        []Action{{Label: "View product", Intent: "view", Href: "/agents/products?product=" + slow.ID}},
			Entity:         &EntityRef{Type: "product", ID: slow.ID, Name: slow.Name},
			DetectedAt:     detectedAt(now, id, 600), Confidence: 0.76,
		})
	}
	sortInsights(out)
	return out
}
