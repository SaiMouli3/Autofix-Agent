package agents

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

var PricingMeta = Meta{
	ID: "pricing", Name: "Pricing & Competitor Agent", ShortName: "Pricing & Competitors", Icon: "tag",
	Question:    "What is happening in the competitive market and how should I price?",
	Description: "Owns pricing and competitive intelligence — competitor prices, discounts, ratings, promotions and price positioning.",
	DataSources: []string{"Competitor price monitor", "Marketplace listings", "Catalog prices"},
	Responsibilities: []string{"Competitor prices", "Competitor discounts", "Competitor products", "Competitor ratings",
		"Promotions", "Price positioning", "Pricing opportunities", "Competitor changes"},
}

type compSnapshot struct {
	latest map[string]map[string]model.CompetitorPrice // product -> competitor -> latest
	prev   map[string]map[string]model.CompetitorPrice // ~7 days ago
}

func competitorSnapshot(ds *model.Dataset, now time.Time) compSnapshot {
	s := compSnapshot{latest: map[string]map[string]model.CompetitorPrice{}, prev: map[string]map[string]model.CompetitorPrice{}}
	cut := now.Add(-7 * 24 * time.Hour)
	for _, cp := range ds.CompPrices {
		if s.latest[cp.ProductID] == nil {
			s.latest[cp.ProductID] = map[string]model.CompetitorPrice{}
			s.prev[cp.ProductID] = map[string]model.CompetitorPrice{}
		}
		if l, ok := s.latest[cp.ProductID][cp.CompetitorID]; !ok || cp.CapturedAt.After(l.CapturedAt) {
			s.latest[cp.ProductID][cp.CompetitorID] = cp
		}
		if cp.CapturedAt.Before(cut) {
			if l, ok := s.prev[cp.ProductID][cp.CompetitorID]; !ok || cp.CapturedAt.After(l.CapturedAt) {
				s.prev[cp.ProductID][cp.CompetitorID] = cp
			}
		}
	}
	return s
}

func productRating(ds *model.Dataset, pid string, now time.Time) (float64, int) {
	sum, n := 0.0, 0
	for _, rv := range ds.Reviews {
		if rv.ProductID == pid && now.Sub(rv.CreatedAt).Hours() < 24*90 {
			sum += float64(rv.Rating)
			n++
		}
	}
	return analytics.Ratio(sum, float64(n)), n
}

// dailyUnits returns average daily units of a product over a window.
func dailyUnits(ds *model.Dataset, pid string, w analytics.Window) float64 {
	u := 0.0
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if !w.Contains(o.CreatedAt) || !orderCounted(o) {
			continue
		}
		for _, it := range o.Items {
			if it.ProductID == pid {
				u += float64(it.Qty)
			}
		}
	}
	return u / math.Max(w.Days(), 0.1)
}

func AnalyzePricing(c *Ctx) Result {
	ds, now := c.DS, c.Now
	snap := competitorSnapshot(ds, now)
	var rows []H
	pids := make([]string, 0, len(snap.latest))
	for pid := range snap.latest {
		pids = append(pids, pid)
	}
	sort.Strings(pids)
	var indexSum float64
	premium, atMarket, value := 0, 0, 0
	for _, pid := range pids {
		p := ds.ProductByID[pid]
		ours, _ := productRating(ds, pid, now)
		var prices, ratings []float64
		var comps []H
		minP := math.MaxFloat64
		for _, comp := range ds.Competitors {
			cp, ok := snap.latest[pid][comp.ID]
			if !ok {
				continue
			}
			prices = append(prices, cp.Price)
			ratings = append(ratings, cp.Rating)
			minP = math.Min(minP, cp.Price)
			change := 0.0
			if pv, ok := snap.prev[pid][comp.ID]; ok {
				change = analytics.Pct(cp.Price, pv.Price)
			}
			comps = append(comps, H{"competitorId": comp.ID, "competitor": comp.Name, "title": cp.Title, "price": cp.Price, "listPrice": cp.ListPrice,
				"discount": analytics.Round(analytics.Ratio(cp.ListPrice-cp.Price, cp.ListPrice)*100, 1), "rating": cp.Rating, "inStock": cp.InStock, "change7d": analytics.Round(change, 1)})
		}
		med := analytics.Median(prices)
		idx := analytics.Ratio(p.Price, med) * 100
		indexSum += idx
		pos := "At market"
		switch {
		case idx > 104:
			pos = "Premium"
			premium++
		case idx < 96:
			pos = "Value"
			value++
		default:
			atMarket++
		}
		rows = append(rows, H{"productId": pid, "name": p.Name, "category": p.Category, "ourPrice": p.Price, "ourRating": analytics.Round(ours, 2),
			"marketMedian": med, "marketMin": minP, "priceIndex": analytics.Round(idx, 1), "gapPct": analytics.Round(idx-100, 1), "position": pos,
			"competitorRating": analytics.Round(analytics.Mean(ratings), 2), "competitors": comps})
	}
	sort.Slice(rows, func(i, j int) bool {
		return math.Abs(rows[i]["gapPct"].(float64)) > math.Abs(rows[j]["gapPct"].(float64))
	})

	// Recent competitor price changes (day-over-day moves > 5%, last 14 days).
	type key struct{ p, c string }
	last := map[key]model.CompetitorPrice{}
	hist := append([]model.CompetitorPrice(nil), ds.CompPrices...)
	sort.Slice(hist, func(i, j int) bool { return hist[i].CapturedAt.Before(hist[j].CapturedAt) })
	var changes []H
	for _, cp := range hist {
		k := key{cp.ProductID, cp.CompetitorID}
		if pv, ok := last[k]; ok && now.Sub(cp.CapturedAt).Hours() < 24*14 {
			ch := analytics.Pct(cp.Price, pv.Price)
			if math.Abs(ch) >= 5 {
				changes = append(changes, H{"at": cp.CapturedAt, "competitor": ds.CompetitorByID[cp.CompetitorID].Name, "competitorId": cp.CompetitorID,
					"productId": cp.ProductID, "product": ds.ProductByID[cp.ProductID].Name, "from": pv.Price, "to": cp.Price, "change": analytics.Round(ch, 1)})
			}
		}
		last[k] = cp
	}
	sort.Slice(changes, func(i, j int) bool { return changes[i]["at"].(time.Time).After(changes[j]["at"].(time.Time)) })
	if len(changes) > 15 {
		changes = changes[:15]
	}
	// Competitor overview: avg discount now and rating.
	var compRows []H
	for _, comp := range ds.Competitors {
		disc, n, promos := 0.0, 0.0, 0
		var gaps []float64
		for pid, m := range snap.latest {
			if cp, ok := m[comp.ID]; ok {
				d := analytics.Ratio(cp.ListPrice-cp.Price, cp.ListPrice) * 100
				disc += d
				n++
				if d > 1 {
					promos++
				}
				gaps = append(gaps, analytics.Pct(cp.Price, ds.ProductByID[pid].Price))
			}
		}
		compRows = append(compRows, H{"id": comp.ID, "name": comp.Name, "domain": comp.Domain, "rating": comp.Rating, "tracked": int(n),
			"avgDiscount": analytics.Round(disc/math.Max(n, 1), 1), "activePromos": promos, "avgPriceVsOurs": analytics.Round(analytics.Mean(gaps), 1)})
	}

	insights, featured := pricingInsights(c, snap)
	// Featured product comparison and history.
	featuredView := H{}
	if featured != "" {
		p := ds.ProductByID[featured]
		var bars []H
		bars = append(bars, H{"name": "Your price", "price": p.Price, "ours": true})
		var prices []float64
		for _, comp := range ds.Competitors {
			if cp, ok := snap.latest[featured][comp.ID]; ok {
				bars = append(bars, H{"name": comp.Name, "price": cp.Price, "ours": false, "rating": cp.Rating})
				prices = append(prices, cp.Price)
			}
		}
		histRows := map[string]H{}
		var dates []string
		for _, cp := range ds.CompPrices {
			if cp.ProductID != featured || now.Sub(cp.CapturedAt).Hours() > 24*45 {
				continue
			}
			d := cp.CapturedAt.In(analytics.IST).Format("2006-01-02")
			if histRows[d] == nil {
				histRows[d] = H{"t": d, "ours": p.Price}
				dates = append(dates, d)
			}
			histRows[d][cp.CompetitorID] = cp.Price
		}
		sort.Strings(dates)
		var history []H
		for _, d := range dates {
			history = append(history, histRows[d])
		}
		var series []H
		for _, comp := range ds.Competitors {
			if _, ok := snap.latest[featured][comp.ID]; ok {
				series = append(series, H{"key": comp.ID, "name": comp.Name})
			}
		}
		featuredView = H{"productId": featured, "name": p.Name, "bars": bars, "median": analytics.Median(prices), "history": history, "series": series}
	}

	avgIndex := indexSum / math.Max(float64(len(pids)), 1)
	health := 0.5*analytics.Score(math.Abs(avgIndex-100), 2, 12) + 0.5*analytics.Score(float64(len(changes)), 3, 24)
	view := H{
		"kpis": []KPI{
			NewKPI("tracked", "Tracked products", float64(len(pids)), float64(len(pids)), "number", "up"),
			NewKPI("priceIndex", "Avg. price index", avgIndex, avgIndex, "number", "neutral"),
			NewKPI("premium", "Priced above market", float64(premium), float64(premium), "number", "neutral"),
			NewKPI("changes", "Competitor price moves (14d)", float64(len(changes)), 0, "number", "down"),
		},
		"products": rows, "changes": changes, "competitors": compRows, "featured": featuredView,
		"positioning": []H{{"position": "Premium", "count": premium}, {"position": "At market", "count": atMarket}, {"position": "Value", "count": value}},
		"healthBreakdown": []H{
			{"label": "Price alignment", "score": math.Round(analytics.Score(math.Abs(avgIndex-100), 2, 12))},
			{"label": "Market stability", "score": math.Round(analytics.Score(float64(len(changes)), 3, 24))},
		},
	}
	view["kpis"].([]KPI)[1].Hint = "100 = market median"
	sum := summarize(PricingMeta, now, health, health+4, insights, Headline{Label: "Avg. price index", Value: analytics.Round(avgIndex, 1), Unit: "number"}, len(ds.CompPrices))
	return Result{Summary: sum, Insights: insights, Changes: nil, View: view, Activity: scanActivity(c, PricingMeta.ID, "pricing")}
}

func pricingInsights(c *Ctx, snap compSnapshot) ([]Insight, string) {
	ds, now := c.DS, c.Now
	var out []Insight
	featured := ""
	// Largest competitor price cut in the last 7 days on a product we sell well.
	type cut struct {
		pid, cid string
		from, to float64
		change   float64
		at       time.Time
	}
	var best *cut
	for pid, m := range snap.latest {
		for cid, cp := range m {
			pv, ok := snap.prev[pid][cid]
			if !ok {
				continue
			}
			// Only persistent cuts (list price also reset) matter, not short promos.
			ch := analytics.Pct(cp.Price, pv.Price)
			if ch <= -8 && cp.Price >= cp.ListPrice*0.99 && analytics.Pct(cp.ListPrice, pv.ListPrice) <= -8 {
				if best == nil || ch < best.change {
					best = &cut{pid, cid, pv.Price, cp.Price, ch, cp.CapturedAt}
				}
			}
		}
	}
	if best != nil {
		p := ds.ProductByID[best.pid]
		comp := ds.CompetitorByID[best.cid]
		featured = best.pid
		var prices, ratings []float64
		for _, cp := range snap.latest[best.pid] {
			prices = append(prices, cp.Price)
			ratings = append(ratings, cp.Rating)
		}
		med := analytics.Median(prices)
		gap := analytics.Pct(p.Price, med)
		gapA := analytics.Pct(p.Price, best.to)
		ours, nReviews := productRating(ds, best.pid, now)
		theirs := snap.latest[best.pid][best.cid].Rating
		// Find when the cut happened and compare our unit velocity since.
		since := now.Add(-4 * 24 * time.Hour)
		for _, cp := range ds.CompPrices {
			if cp.ProductID == best.pid && cp.CompetitorID == best.cid && cp.Price == best.to && cp.CapturedAt.Before(since.Add(24*time.Hour)) && cp.CapturedAt.After(now.Add(-8*24*time.Hour)) {
				since = cp.CapturedAt
				break
			}
		}
		after := dailyUnits(ds, best.pid, analytics.Window{From: since, To: now})
		before := dailyUnits(ds, best.pid, analytics.Window{From: since.Add(-21 * 24 * time.Hour), To: since})
		salesCh := analytics.Pct(after, before)
		var rec string
		if ours-theirs >= 0.25 && salesCh > -12 {
			rec = fmt.Sprintf("Maintain price. You are %s the market median, but your %.1f★ rating (vs %.1f★) is holding demand. Reinforce quality messaging instead of discounting.", aboveBelow(gap), ours, theirs)
		} else {
			target := roundINR(best.to * 1.05)
			rec = fmt.Sprintf("Narrow the gap rather than match: move from %s to %s (5%% above %s). Your rating advantage (%.1f★ vs %.1f★) supports a small premium, and sales are already down %.0f%%.", INRFull(p.Price), INRFull(target), comp.Name, ours, theirs, -salesCh)
		}
		monthlyRev := productMonthlyRevenue(ds, best.pid, now)
		id := stableID("pricing", "cut", best.pid, best.cid)
		out = append(out, Insight{
			ID: id, AgentID: "pricing", Severity: SevMarket,
			Title:   fmt.Sprintf("%s reduced price by %.0f%% on your %s competitor", comp.Name, -best.change, p.Name),
			Summary: fmt.Sprintf("%s cut its equivalent product from %s to %s. You are now %.0f%% above them and %s the market median. Your daily unit sales have moved %s since the change.", comp.Name, INRFull(best.from), INRFull(best.to), gapA, aboveBelow(gap), Signed(salesCh)),
			Evidence: []Evidence{
				EvC(comp.Name+" price", INRFull(best.to), best.change, "pct", "bad"),
				Ev("Your price", INRFull(p.Price)),
				Ev("Market median", INRFull(med)),
				Ev("Your rating", fmt.Sprintf("%.1f★ (%d reviews) vs %.1f★", ours, nReviews, theirs)),
				EvC("Your daily units since", fmt.Sprintf("%.1f/day", after), salesCh, "pct", "bad"),
			},
			LikelyCause:    fmt.Sprintf("%s is pushing a seasonal price reset in %s.", comp.Name, p.Category),
			Impact:         fmt.Sprintf("%s/month revenue at risk at the current sales trend", INR(math.Max(0, -salesCh/100*monthlyRev))),
			ImpactValue:    math.Min(0, salesCh/100*monthlyRev),
			Recommendation: rec,
			Actions: []Action{
				{Label: "Review pricing", Intent: "investigate", Href: "/agents/pricing?product=" + best.pid},
				{Label: "View product", Intent: "view", Href: "/agents/products?product=" + best.pid},
			},
			Entity:     &EntityRef{Type: "product", ID: best.pid, Name: p.Name},
			DetectedAt: detectedAt(now, id, 200), Confidence: 0.87,
		})
	}
	// Underpriced opportunity: our price well below median while rating is at/above market.
	type opp struct {
		pid          string
		gap, uplift  float64
		ours, theirs float64
	}
	var bestOpp *opp
	for pid, m := range snap.latest {
		if pid == featured {
			continue
		}
		p := ds.ProductByID[pid]
		var prices, ratings []float64
		for _, cp := range m {
			prices = append(prices, cp.Price)
			ratings = append(ratings, cp.Rating)
		}
		if len(prices) < 2 {
			continue
		}
		med := analytics.Median(prices)
		gap := analytics.Pct(p.Price, med)
		ours, n := productRating(ds, pid, now)
		if gap < -6 && n >= 3 && ours >= analytics.Mean(ratings) {
			uplift := productMonthlyRevenue(ds, pid, now) * math.Min(-gap/2, 6) / 100
			if bestOpp == nil || uplift > bestOpp.uplift {
				bestOpp = &opp{pid, gap, uplift, ours, analytics.Mean(ratings)}
			}
		}
	}
	if bestOpp != nil {
		p := ds.ProductByID[bestOpp.pid]
		raise := math.Min(-bestOpp.gap/2, 6)
		id := stableID("pricing", "underpriced", bestOpp.pid)
		out = append(out, Insight{
			ID: id, AgentID: "pricing", Severity: SevOpportunity,
			Title:   fmt.Sprintf("%s is priced %.0f%% below market despite a higher rating", p.Name, -bestOpp.gap),
			Summary: fmt.Sprintf("Your %.1f★ rating beats the competitor average of %.1f★. A %.0f%% price increase would still keep you below the market median.", bestOpp.ours, bestOpp.theirs, raise),
			Evidence: []Evidence{
				Ev("Gap to market median", fmt.Sprintf("%.0f%%", bestOpp.gap)),
				Ev("Your rating vs market", fmt.Sprintf("%.1f★ vs %.1f★", bestOpp.ours, bestOpp.theirs)),
			},
			Impact:         fmt.Sprintf("+%s/month gross profit", INR(bestOpp.uplift)),
			ImpactValue:    bestOpp.uplift,
			Recommendation: fmt.Sprintf("Test a %.0f%% price increase (to %s) for 14 days and monitor conversion.", raise, INRFull(roundINR(p.Price*(1+raise/100)))),
			Actions:        []Action{{Label: "Review pricing", Intent: "investigate", Href: "/agents/pricing?product=" + bestOpp.pid}},
			Entity:         &EntityRef{Type: "product", ID: bestOpp.pid, Name: p.Name},
			DetectedAt:     detectedAt(now, id, 500), Confidence: 0.74,
		})
	}
	// Active promotions across competitors.
	promos := 0
	for _, m := range snap.latest {
		for _, cp := range m {
			if cp.Price < cp.ListPrice*0.97 {
				promos++
			}
		}
	}
	if promos > 0 {
		id := stableID("pricing", "promos")
		out = append(out, Insight{
			ID: id, AgentID: "pricing", Severity: SevInfo,
			Title:          fmt.Sprintf("%d competitor promotions are live on products you sell", promos),
			Summary:        "Short-term promotions rarely justify a permanent price response; the agent tracks them and flags only persistent changes.",
			Evidence:       []Evidence{Ev("Active promotions", Num(float64(promos)))},
			Recommendation: "No action needed — keep monitoring.",
			Actions:        []Action{{Label: "View competitors", Intent: "view", Href: "/agents/pricing"}},
			DetectedAt:     detectedAt(now, id, 700), Confidence: 0.95,
		})
	}
	sortInsights(out)
	return out, featured
}

func roundINR(v float64) float64 { return math.Round(v/10)*10 - 1 }

func aboveBelow(gap float64) string {
	switch {
	case gap > 0.5:
		return fmt.Sprintf("%.0f%% above", gap)
	case gap < -0.5:
		return fmt.Sprintf("%.0f%% below", -gap)
	default:
		return "in line with"
	}
}
