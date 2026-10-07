package agents

import (
	"fmt"
	"math"
	"sort"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
)

var MarketingMeta = Meta{
	ID: "marketing", Name: "Marketing Agent", ShortName: "Marketing", Icon: "megaphone",
	Question:    "Is my marketing generating profitable growth?",
	Description: "Owns acquisition and marketing performance — campaigns, spend, ROAS, CAC, CTR, CPC, conversion and attribution.",
	DataSources: []string{"Google Ads", "Meta Ads", "Store analytics", "Email platform", "WhatsApp Business"},
	Responsibilities: []string{"Campaigns", "Advertising", "Meta Ads", "Google Ads", "CAC", "ROAS", "CTR", "CPC",
		"Conversion rate", "Campaign performance", "Marketing spend", "Attribution"},
}

const TargetROAS = 4.0

var channelLabels = map[string]string{"google": "Google", "meta": "Meta", "instagram": "Instagram", "email": "Email", "whatsapp": "WhatsApp", "organic": "Organic", "direct": "Direct"}

type campAgg struct {
	spend, revenue              float64
	impressions, clicks, orders float64
	newCustomers                float64
}

func AnalyzeMarketing(c *Ctx) Result {
	ds, r, now := c.DS, c.R, c.Now
	sb := newSeries(r, "spend", "revenue", "prevSpend", "prevRevenue")
	cur := map[string]*campAgg{}
	prev := map[string]*campAgg{}
	get := func(m map[string]*campAgg, k string) *campAgg {
		if m[k] == nil {
			m[k] = &campAgg{}
		}
		return m[k]
	}
	for _, m := range ds.CampMetrics {
		if r.Contains(m.Date) || (r.Granularity == "hour" && analytics.StartOfDay(m.Date).Equal(analytics.StartOfDay(r.From))) {
			a := get(cur, m.CampaignID)
			a.spend += m.Spend
			a.impressions += float64(m.Impressions)
			a.clicks += float64(m.Clicks)
			if r.Granularity != "hour" {
				sb.add("spend", m.Date, m.Spend)
			}
		} else if r.PrevContains(m.Date) || (r.Granularity == "hour" && analytics.StartOfDay(m.Date).Equal(analytics.StartOfDay(r.PrevFrom))) {
			a := get(prev, m.CampaignID)
			a.spend += m.Spend
			a.impressions += float64(m.Impressions)
			a.clicks += float64(m.Clicks)
		}
	}
	firstOrder := map[string]string{}
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if f, ok := firstOrder[o.CustomerID]; !ok || ds.OrderByID[f].CreatedAt.After(o.CreatedAt) {
			firstOrder[o.CustomerID] = o.ID
		}
	}
	chanCur := map[string]*campAgg{}
	chanPrev := map[string]*campAgg{}
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if !orderCounted(o) {
			continue
		}
		isNew := firstOrder[o.CustomerID] == o.ID
		if r.Contains(o.CreatedAt) {
			ch := get(chanCur, o.Channel)
			ch.revenue += o.Total
			ch.orders++
			if isNew {
				ch.newCustomers++
			}
			if o.CampaignID != "" {
				a := get(cur, o.CampaignID)
				a.revenue += o.Total
				a.orders++
				if isNew {
					a.newCustomers++
				}
				sb.add("revenue", o.CreatedAt, o.Total)
			}
		} else if r.PrevContains(o.CreatedAt) {
			ch := get(chanPrev, o.Channel)
			ch.revenue += o.Total
			ch.orders++
			if o.CampaignID != "" {
				a := get(prev, o.CampaignID)
				a.revenue += o.Total
				a.orders++
				if isNew {
					a.newCustomers++
				}
				sb.add("prevRevenue", c.shiftPrev(o.CreatedAt), o.Total)
			}
		}
	}
	for _, m := range ds.CampMetrics {
		if r.PrevContains(m.Date) && r.Granularity != "hour" {
			sb.add("prevSpend", c.shiftPrev(m.Date), m.Spend)
		}
	}
	sb.set("roas", ratioSeries(sb.get("revenue"), sb.get("spend"), 1))

	tot := func(m map[string]*campAgg) campAgg {
		var t campAgg
		for _, a := range m {
			t.spend += a.spend
			t.revenue += a.revenue
			t.impressions += a.impressions
			t.clicks += a.clicks
			t.orders += a.orders
			t.newCustomers += a.newCustomers
		}
		return t
	}
	tc, tp := tot(cur), tot(prev)
	sessions, sessionsPrev := 0.0, 0.0
	funnel := [4]float64{}
	var allOrders, allOrdersPrev float64
	for _, t := range ds.Traffic {
		inCur := r.Contains(t.Date) || (r.Granularity == "hour" && analytics.StartOfDay(t.Date).Equal(analytics.StartOfDay(r.From)))
		inPrev := r.PrevContains(t.Date) || (r.Granularity == "hour" && analytics.StartOfDay(t.Date).Equal(analytics.StartOfDay(r.PrevFrom)))
		if inCur {
			sessions += float64(t.Sessions)
			funnel[0] += float64(t.Sessions)
			funnel[1] += float64(t.ProductView)
			funnel[2] += float64(t.AddToCart)
			funnel[3] += float64(t.Checkout)
		} else if inPrev {
			sessionsPrev += float64(t.Sessions)
		}
	}
	for _, a := range chanCur {
		allOrders += a.orders
	}
	for _, a := range chanPrev {
		allOrdersPrev += a.orders
	}
	if r.Granularity == "hour" {
		// traffic is daily — scale today's sessions to the elapsed fraction
		frac := r.To.Sub(r.From).Hours() / 24
		sessions *= frac
		for i := range funnel {
			funnel[i] *= frac
		}
		sessionsPrev *= frac
	}
	conv := analytics.Ratio(allOrders, sessions) * 100
	convPrev := analytics.Ratio(allOrdersPrev, sessionsPrev) * 100
	kpis := []KPI{
		NewKPI("spend", "Spend", tc.spend, tp.spend, "currency", "neutral"),
		NewKPI("revenue", "Attributed revenue", tc.revenue, tp.revenue, "currency", "up"),
		NewKPI("roas", "ROAS", analytics.Ratio(tc.revenue, tc.spend), analytics.Ratio(tp.revenue, tp.spend), "ratio", "up"),
		NewKPI("cac", "CAC", analytics.Ratio(tc.spend, tc.newCustomers), analytics.Ratio(tp.spend, tp.newCustomers), "currency", "down"),
		NewKPI("ctr", "CTR", analytics.Ratio(tc.clicks, tc.impressions)*100, analytics.Ratio(tp.clicks, tp.impressions)*100, "percent", "up"),
		NewKPI("cpc", "CPC", analytics.Ratio(tc.spend, tc.clicks), analytics.Ratio(tp.spend, tp.clicks), "currency", "down"),
		NewKPI("conversion", "Conversion rate", conv, convPrev, "percent", "up"),
	}
	kpis[0].Spark = sb.get("spend")
	kpis[1].Spark = sb.get("revenue")
	kpis[2].Spark = sb.get("roas")
	kpis[2].Hint = fmt.Sprintf("Target %.1fx", TargetROAS)

	var campRows []H
	for _, cp := range ds.Campaigns {
		a := get(cur, cp.ID)
		p := get(prev, cp.ID)
		roas := analytics.Ratio(a.revenue, a.spend)
		roasPrev := analytics.Ratio(p.revenue, p.spend)
		campRows = append(campRows, H{"id": cp.ID, "name": cp.Name, "channel": cp.Channel, "channelLabel": channelLabels[cp.Channel], "status": cp.Status,
			"objective": cp.Objective, "dailyBudget": cp.DailyBudget,
			"spend": analytics.Round(a.spend, 0), "revenue": analytics.Round(a.revenue, 0), "roas": analytics.Round(roas, 2), "roasChange": analytics.Round(analytics.Pct(roas, roasPrev), 1),
			"ctr": analytics.Round(analytics.Ratio(a.clicks, a.impressions)*100, 2), "cpc": analytics.Round(analytics.Ratio(a.spend, a.clicks), 1),
			"orders": a.orders, "cac": analytics.Round(analytics.Ratio(a.spend, a.newCustomers), 0), "impressions": a.impressions, "clicks": a.clicks})
	}
	sort.Slice(campRows, func(i, j int) bool { return campRows[i]["spend"].(float64) > campRows[j]["spend"].(float64) })

	chanSpend := map[string]float64{}
	chanSpendPrev := map[string]float64{}
	for _, cp := range ds.Campaigns {
		chanSpend[cp.Channel] += get(cur, cp.ID).spend
		chanSpendPrev[cp.Channel] += get(prev, cp.ID).spend
	}
	var chanRows []H
	for _, ch := range []string{"google", "meta", "instagram", "organic", "email", "whatsapp", "direct"} {
		a := get(chanCur, ch)
		roas := 0.0
		if chanSpend[ch] > 0 {
			roas = a.revenue / chanSpend[ch]
		}
		chanRows = append(chanRows, H{"channel": ch, "label": channelLabels[ch], "spend": analytics.Round(chanSpend[ch], 0), "revenue": analytics.Round(a.revenue, 0),
			"orders": a.orders, "roas": analytics.Round(roas, 2), "share": analytics.Round(analytics.Ratio(a.revenue, tot(chanCur).revenue)*100, 1),
			"revenueChange": analytics.Round(analytics.Pct(a.revenue, get(chanPrev, ch).revenue), 1)})
	}
	funnelRows := []H{
		{"stage": "Sessions", "value": math.Round(funnel[0])},
		{"stage": "Product views", "value": math.Round(funnel[1])},
		{"stage": "Add to cart", "value": math.Round(funnel[2])},
		{"stage": "Checkout", "value": math.Round(funnel[3])},
		{"stage": "Orders", "value": allOrders},
	}
	insights := marketingInsights(c)
	roas := analytics.Ratio(tc.revenue, tc.spend)
	roasPrev := analytics.Ratio(tp.revenue, tp.spend)
	health := 0.5*analytics.Score(roas, TargetROAS*1.4, TargetROAS*0.6) + 0.25*analytics.Score(conv, 3.8, 2.0) + 0.25*analytics.Score(analytics.Pct(analytics.Ratio(tc.spend, tc.newCustomers), analytics.Ratio(tp.spend, tp.newCustomers)), -10, 25)
	healthPrev := 0.5*analytics.Score(roasPrev, TargetROAS*1.4, TargetROAS*0.6) + 0.25*analytics.Score(convPrev, 3.8, 2.0) + 0.25*50
	view := H{
		"kpis": kpis, "trend": sb.rows(), "campaigns": campRows, "channels": chanRows, "funnel": funnelRows, "targetRoas": TargetROAS,
		"healthBreakdown": []H{
			{"label": "Blended ROAS", "score": math.Round(analytics.Score(roas, TargetROAS*1.4, TargetROAS*0.6))},
			{"label": "Site conversion", "score": math.Round(analytics.Score(conv, 3.8, 2.0))},
			{"label": "CAC trend", "score": math.Round(analytics.Score(analytics.Pct(analytics.Ratio(tc.spend, tc.newCustomers), analytics.Ratio(tp.spend, tp.newCustomers)), -10, 25))},
		},
	}
	changes := []Change{}
	for _, k := range kpis {
		changes = append(changes, ChangeFromKPI(k))
	}
	sum := summarize(MarketingMeta, now, health, healthPrev, insights, Headline{Label: "Blended ROAS", Value: analytics.Round(roas, 2), Unit: "ratio"}, len(ds.CampMetrics))
	return Result{Summary: sum, Insights: insights, Changes: changes, View: view, Activity: scanActivity(c, MarketingMeta.ID, "marketing")}
}

func marketingInsights(c *Ctx) []Insight {
	ds, now := c.DS, c.Now
	var out []Insight
	w := analytics.LastDays(analytics.StartOfDay(now), 7)
	b := w.Before(21)
	agg := map[string]*[2]campAgg{}
	for _, m := range ds.CampMetrics {
		wi := -1
		if w.Contains(m.Date) {
			wi = 0
		} else if b.Contains(m.Date) {
			wi = 1
		}
		if wi < 0 {
			continue
		}
		if agg[m.CampaignID] == nil {
			agg[m.CampaignID] = &[2]campAgg{}
		}
		a := &agg[m.CampaignID][wi]
		a.spend += m.Spend
		a.impressions += float64(m.Impressions)
		a.clicks += float64(m.Clicks)
	}
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if o.CampaignID == "" || !orderCounted(o) {
			continue
		}
		wi := -1
		if w.Contains(o.CreatedAt) {
			wi = 0
		} else if b.Contains(o.CreatedAt) {
			wi = 1
		}
		if wi < 0 || agg[o.CampaignID] == nil {
			continue
		}
		agg[o.CampaignID][wi].revenue += o.Total
		agg[o.CampaignID][wi].orders++
	}
	var worst, best string
	worstDrop, bestRoas := 0.0, 0.0
	for id, a := range agg {
		cr := analytics.Ratio(a[0].revenue, a[0].spend)
		br := analytics.Ratio(a[1].revenue, a[1].spend)
		if a[0].spend > 5000 && br > 0 {
			if drop := (br - cr) / br; drop > worstDrop {
				worstDrop, worst = drop, id
			}
		}
		cp := ds.CampaignByID[id]
		if (cp.Channel == "google" || cp.Channel == "meta" || cp.Channel == "instagram") && cr > bestRoas && a[0].spend > 5000 && cr >= br*0.9 {
			bestRoas, best = cr, id
		}
	}
	if worst != "" && worstDrop > 0.25 {
		a := agg[worst]
		cp := ds.CampaignByID[worst]
		cr, br := analytics.Ratio(a[0].revenue, a[0].spend), analytics.Ratio(a[1].revenue, a[1].spend)
		wasted := a[0].spend - a[0].revenue/TargetROAS
		ctrC, ctrB := analytics.Ratio(a[0].clicks, a[0].impressions)*100, analytics.Ratio(a[1].clicks, a[1].impressions)*100
		spendCh := analytics.Pct(a[0].spend/7, a[1].spend/21)
		sev := SevImportant
		if cr < TargetROAS*0.6 {
			sev = SevCritical
		}
		rec := fmt.Sprintf("Cut %s's daily budget by 50%% and refresh creatives", cp.Name)
		if best != "" {
			rec += fmt.Sprintf("; move the freed budget to %s (ROAS %.1fx)", ds.CampaignByID[best].Name, bestRoas)
		}
		rec += "."
		id := stableID("marketing", "roas-drop", worst)
		out = append(out, Insight{
			ID: id, AgentID: "marketing", Severity: sev,
			Title:   fmt.Sprintf("%s · %s ROAS dropped %.0f%%", channelLabels[cp.Channel], cp.Name, worstDrop*100),
			Summary: fmt.Sprintf("ROAS fell from %.1fx to %.1fx over the last 7 days while daily spend rose %.0f%%. CTR declined from %.2f%% to %.2f%%, a classic creative-fatigue pattern.", br, cr, spendCh, ctrB, ctrC),
			Evidence: []Evidence{
				EvC("ROAS (7d)", fmt.Sprintf("%.2fx", cr), -worstDrop*100, "pct", "bad"),
				EvC("Daily spend", INR(a[0].spend/7), spendCh, "pct", "bad"),
				EvC("CTR", fmt.Sprintf("%.2f%%", ctrC), ctrC-ctrB, "pts", "bad"),
				Ev("Orders (7d)", Num(a[0].orders)),
			},
			LikelyCause:    "Creative fatigue on a broad audience plus rising auction costs — spend scaled up after the festive period while conversion intent fell.",
			Impact:         fmt.Sprintf("%s/month of spend below the %.1fx ROAS target", INR(wasted/7*30), TargetROAS),
			ImpactValue:    -wasted / 7 * 30,
			Recommendation: rec,
			Actions: []Action{
				{Label: "Investigate", Intent: "investigate", Href: "/agents/marketing?campaign=" + worst},
				{Label: "Apply budget shift", Intent: "apply"},
			},
			Entity:     &EntityRef{Type: "campaign", ID: worst, Name: cp.Name},
			DetectedAt: detectedAt(now, id, 180), Confidence: 0.9,
		})
	}
	if best != "" {
		a := agg[best]
		cp := ds.CampaignByID[best]
		id := stableID("marketing", "scale", best)
		out = append(out, Insight{
			ID: id, AgentID: "marketing", Severity: SevOpportunity,
			Title:          fmt.Sprintf("%s is your most efficient paid campaign (%.1fx ROAS)", cp.Name, bestRoas),
			Summary:        fmt.Sprintf("Stable performance over 4 weeks with %s in attributed revenue last week. There is room to scale before returns diminish.", INR(a[0].revenue)),
			Evidence:       []Evidence{Ev("ROAS (7d)", fmt.Sprintf("%.2fx", bestRoas)), Ev("Spend (7d)", INR(a[0].spend)), Ev("Orders (7d)", Num(a[0].orders))},
			Impact:         fmt.Sprintf("+%s/month revenue at a 20%% budget increase", INR(a[0].revenue*0.2*0.8/7*30)),
			ImpactValue:    a[0].revenue * 0.16 / 7 * 30,
			Recommendation: "Increase budget by 20% and monitor marginal ROAS daily.",
			Actions:        []Action{{Label: "Apply budget shift", Intent: "apply"}, {Label: "View campaign", Intent: "view", Href: "/agents/marketing?campaign=" + best}},
			Entity:         &EntityRef{Type: "campaign", ID: best, Name: cp.Name},
			DetectedAt:     detectedAt(now, id, 400), Confidence: 0.8,
		})
	}
	sortInsights(out)
	return out
}
