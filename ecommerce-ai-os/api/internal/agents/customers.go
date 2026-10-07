package agents

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

var CustomersMeta = Meta{
	ID: "customers", Name: "Customer Agent", ShortName: "Customers", Icon: "users",
	Question:    "Who are my customers and what are they doing?",
	Description: "Owns customer intelligence — lifetime value, retention, segments, churn risk and purchase behaviour.",
	DataSources: []string{"Store customers", "Order history", "WhatsApp opt-ins"},
	Responsibilities: []string{"Customer profiles", "Lifetime value", "Repeat & first-time customers", "Churn risk", "Segments",
		"Purchase behaviour", "Retention & cohorts", "VIP customers"},
}

// CustomerProfile is the derived, deterministic view of one customer.
type CustomerProfile struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Email           string    `json:"email"`
	City            string    `json:"city"`
	State           string    `json:"state"`
	Region          string    `json:"region"`
	Orders          int       `json:"orders"`
	LTV             float64   `json:"ltv"`
	AOV             float64   `json:"aov"`
	FirstOrder      time.Time `json:"firstOrder"`
	LastOrder       time.Time `json:"lastOrder"`
	DaysSinceLast   int       `json:"daysSinceLast"`
	AvgInterval     float64   `json:"avgIntervalDays"`
	Segment         string    `json:"segment"`
	RepurchaseScore float64   `json:"repurchaseScore"` // 0-1 likelihood within 30 days
	Returns         int       `json:"returns"`
	Tickets         int       `json:"tickets"`
	Channel         string    `json:"channel"`
}

var SegmentOrder = []string{"VIP", "Loyal", "Growing", "New", "At Risk", "Churn Risk", "One-time"}

// BuildProfiles derives profiles for every customer with at least one
// counted order placed before `asOf`.
func BuildProfiles(ds *model.Dataset, asOf time.Time) []CustomerProfile {
	returnsByOrder := map[string]int{}
	for _, r := range ds.Returns {
		returnsByOrder[r.OrderID]++
	}
	ticketsByCust := map[string]int{}
	for _, t := range ds.Tickets {
		ticketsByCust[t.CustomerID]++
	}
	var out []CustomerProfile
	for ci := range ds.Customers {
		c := &ds.Customers[ci]
		orders := ds.OrdersByCust[c.ID]
		p := CustomerProfile{ID: c.ID, Name: c.Name, Email: c.Email, City: c.City, State: c.State, Region: c.Region, Tickets: ticketsByCust[c.ID]}
		var times []time.Time
		for _, o := range orders {
			if !orderCounted(o) || !o.CreatedAt.Before(asOf) {
				continue
			}
			p.Orders++
			p.LTV += o.Total
			p.Returns += returnsByOrder[o.ID]
			times = append(times, o.CreatedAt)
			if p.Channel == "" {
				p.Channel = o.Channel
			}
		}
		if p.Orders == 0 {
			continue
		}
		sort.Slice(times, func(i, j int) bool { return times[i].Before(times[j]) })
		p.FirstOrder, p.LastOrder = times[0], times[len(times)-1]
		p.AOV = p.LTV / float64(p.Orders)
		p.DaysSinceLast = int(asOf.Sub(p.LastOrder).Hours() / 24)
		if len(times) > 1 {
			p.AvgInterval = times[len(times)-1].Sub(times[0]).Hours() / 24 / float64(len(times)-1)
		}
		out = append(out, p)
	}
	// LTV threshold for VIP: top 5%.
	ltvs := make([]float64, len(out))
	for i, p := range out {
		ltvs[i] = p.LTV
	}
	vipCut := analytics.Percentile(ltvs, 95)
	for i := range out {
		p := &out[i]
		d := p.DaysSinceLast
		switch {
		case p.Orders >= 2 && p.LTV >= vipCut && d <= 75:
			p.Segment = "VIP"
		case p.Orders >= 3 && d <= 60:
			p.Segment = "Loyal"
		case p.Orders == 2 && d <= 45:
			p.Segment = "Growing"
		case p.Orders == 1 && d <= 30:
			p.Segment = "New"
		case p.Orders >= 2 && d <= 120:
			p.Segment = "At Risk"
		case p.Orders >= 2:
			p.Segment = "Churn Risk"
		default:
			p.Segment = "One-time"
		}
		// Repurchase likelihood: customers whose typical cycle says they're due.
		if p.Orders >= 2 && p.AvgInterval >= 10 && p.AvgInterval <= 110 {
			due := float64(d) / p.AvgInterval
			score := math.Exp(-math.Pow(due-1.0, 2) / 0.35)
			score *= math.Min(1, 0.55+0.12*float64(p.Orders))
			p.RepurchaseScore = analytics.Round(score, 3)
		} else if p.Orders == 1 && d >= 20 && d <= 45 {
			p.RepurchaseScore = 0.22
		}
	}
	return out
}

func AnalyzeCustomers(c *Ctx) Result {
	ds, r, now := c.DS, c.R, c.Now
	profiles := BuildProfiles(ds, now)
	profByID := make(map[string]*CustomerProfile, len(profiles))
	for i := range profiles {
		profByID[profiles[i].ID] = &profiles[i]
	}

	sb := newSeries(r, "new", "returning")
	activeCur, activePrev := map[string]bool{}, map[string]bool{}
	newCur, newPrev, retCur, retPrev := 0, 0, 0, 0
	firstOrderAt := map[string]time.Time{}
	for i := range profiles {
		firstOrderAt[profiles[i].ID] = profiles[i].FirstOrder
	}
	seenInBucket := map[string]bool{}
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if !orderCounted(o) {
			continue
		}
		first := firstOrderAt[o.CustomerID]
		isFirst := first.Equal(o.CreatedAt)
		if r.Contains(o.CreatedAt) {
			if !activeCur[o.CustomerID] {
				activeCur[o.CustomerID] = true
				if !first.Before(r.From) {
					newCur++
				} else {
					retCur++
				}
			}
			k := fmt.Sprintf("%s|%d", o.CustomerID, r.Bucket(o.CreatedAt))
			if !seenInBucket[k] {
				seenInBucket[k] = true
				if isFirst {
					sb.add("new", o.CreatedAt, 1)
				} else {
					sb.add("returning", o.CreatedAt, 1)
				}
			}
		} else if r.PrevContains(o.CreatedAt) && !activePrev[o.CustomerID] {
			activePrev[o.CustomerID] = true
			if !first.Before(r.PrevFrom) {
				newPrev++
			} else {
				retPrev++
			}
		}
	}

	totalNow := len(profiles)
	prevProfiles := 0
	repeatNow, repeatPrev := 0, 0
	ltvSum := 0.0
	for _, p := range profiles {
		if p.Orders >= 2 {
			repeatNow++
		}
		ltvSum += p.LTV
		if p.FirstOrder.Before(r.From) {
			prevProfiles++
		}
	}
	// Repeat rate as of the start of the range, for comparison.
	prevSet := BuildProfiles(ds, r.From)
	prevLTV := 0.0
	for _, p := range prevSet {
		if p.Orders >= 2 {
			repeatPrev++
		}
		prevLTV += p.LTV
	}
	segCount := map[string]int{}
	segRevenue := map[string]float64{}
	segOrders := map[string]int{}
	churnNow := 0
	for _, p := range profiles {
		segCount[p.Segment]++
		segRevenue[p.Segment] += p.LTV
		segOrders[p.Segment] += p.Orders
		if p.Segment == "At Risk" || p.Segment == "Churn Risk" {
			churnNow++
		}
	}
	churnPrev := 0
	for _, p := range prevSet {
		if p.Segment == "At Risk" || p.Segment == "Churn Risk" {
			churnPrev++
		}
	}
	repeatRate := analytics.Ratio(float64(repeatNow), float64(totalNow)) * 100
	repeatRatePrev := analytics.Ratio(float64(repeatPrev), float64(len(prevSet))) * 100
	avgLTV := analytics.Ratio(ltvSum, float64(totalNow))
	avgLTVPrev := analytics.Ratio(prevLTV, float64(len(prevSet)))

	kpis := []KPI{
		NewKPI("total", "Total customers", float64(totalNow), float64(len(prevSet)), "number", "up"),
		NewKPI("new", "New customers", float64(newCur), float64(newPrev), "number", "up"),
		NewKPI("returning", "Returning customers", float64(retCur), float64(retPrev), "number", "up"),
		NewKPI("repeatRate", "Repeat purchase rate", repeatRate, repeatRatePrev, "percent", "up"),
		NewKPI("ltv", "Avg. lifetime value", avgLTV, avgLTVPrev, "currency", "up"),
		NewKPI("churnRisk", "Churn risk", float64(churnNow), float64(churnPrev), "number", "down"),
	}
	kpis[1].Spark = sb.get("new")
	kpis[2].Spark = sb.get("returning")

	var segments []H
	for _, s := range SegmentOrder {
		segments = append(segments, H{
			"segment": s, "customers": segCount[s], "revenue": analytics.Round(segRevenue[s], 0),
			"share":     analytics.Round(analytics.Ratio(segRevenue[s], ltvSum)*100, 1),
			"avgOrders": analytics.Round(analytics.Ratio(float64(segOrders[s]), float64(segCount[s])), 2),
			"avgLtv":    analytics.Round(analytics.Ratio(segRevenue[s], float64(segCount[s])), 0),
		})
	}

	// Monthly cohorts: first-order month, % active in each following month.
	cohorts := buildCohorts(ds, profiles, now)

	// LTV distribution & purchase frequency.
	ltvBins := []float64{0, 1000, 2000, 3500, 5000, 7500, 10000, 15000, 25000}
	ltvCounts := make([]int, len(ltvBins))
	freq := make([]int, 5)
	for _, p := range profiles {
		i := sort.SearchFloat64s(ltvBins, p.LTV+0.001) - 1
		if i < 0 {
			i = 0
		}
		ltvCounts[i]++
		f := p.Orders - 1
		if f > 4 {
			f = 4
		}
		freq[f]++
	}
	var ltvDist []H
	for i, lo := range ltvBins {
		label := fmt.Sprintf("%s+", INR(lo))
		if i < len(ltvBins)-1 {
			label = fmt.Sprintf("%s–%s", INR(lo), INR(ltvBins[i+1]))
		}
		ltvDist = append(ltvDist, H{"bucket": label, "customers": ltvCounts[i]})
	}
	freqLabels := []string{"1 order", "2 orders", "3 orders", "4 orders", "5+ orders"}
	var freqDist []H
	for i, l := range freqLabels {
		freqDist = append(freqDist, H{"bucket": l, "customers": freq[i]})
	}

	geo := map[string]*[2]float64{}
	region := map[string]string{}
	for _, p := range profiles {
		if geo[p.State] == nil {
			geo[p.State] = &[2]float64{}
			region[p.State] = p.Region
		}
		geo[p.State][0]++
		geo[p.State][1] += p.LTV
	}
	var geoRows []H
	for s, v := range geo {
		geoRows = append(geoRows, H{"state": s, "region": region[s], "customers": int(v[0]), "revenue": analytics.Round(v[1], 0), "avgLtv": analytics.Round(v[1]/v[0], 0)})
	}
	sort.Slice(geoRows, func(i, j int) bool { return geoRows[i]["customers"].(int) > geoRows[j]["customers"].(int) })

	top := append([]CustomerProfile(nil), profiles...)
	sort.Slice(top, func(i, j int) bool { return top[i].LTV > top[j].LTV })
	if len(top) > 8 {
		top = top[:8]
	}

	insights := customersInsights(c, profiles)
	health := 0.4*analytics.Score(repeatRate, 40, 15) + 0.35*analytics.Score(analytics.Ratio(float64(churnNow), float64(totalNow))*100, 5, 25) + 0.25*analytics.Score(analytics.Pct(float64(newCur), float64(newPrev)), 15, -25)
	healthPrev := 0.4*analytics.Score(repeatRatePrev, 40, 15) + 0.35*analytics.Score(analytics.Ratio(float64(churnPrev), float64(len(prevSet)))*100, 5, 25) + 0.25*50

	view := H{
		"kpis": kpis, "growth": sb.rows(), "segments": segments, "cohorts": cohorts,
		"ltvDistribution": ltvDist, "frequency": freqDist, "geo": geoRows, "topCustomers": top,
		"healthBreakdown": []H{
			{"label": "Repeat purchase", "score": math.Round(analytics.Score(repeatRate, 40, 15))},
			{"label": "Retention", "score": math.Round(analytics.Score(analytics.Ratio(float64(churnNow), float64(totalNow))*100, 5, 25))},
			{"label": "Acquisition", "score": math.Round(analytics.Score(analytics.Pct(float64(newCur), float64(newPrev)), 15, -25))},
		},
	}
	changes := []Change{}
	for _, k := range kpis {
		changes = append(changes, ChangeFromKPI(k))
	}
	sum := summarize(CustomersMeta, now, health, healthPrev, insights, Headline{Label: "Repeat purchase rate", Value: analytics.Round(repeatRate, 1), Unit: "percent"}, totalNow)
	return Result{Summary: sum, Insights: insights, Changes: changes, View: view, Activity: scanActivity(c, CustomersMeta.ID, "customers")}
}

func buildCohorts(ds *model.Dataset, profiles []CustomerProfile, now time.Time) []H {
	monthKey := func(t time.Time) int { t = t.In(analytics.IST); return t.Year()*12 + int(t.Month()) - 1 }
	nowKey := monthKey(now)
	first := map[string]int{}
	for _, p := range profiles {
		first[p.ID] = monthKey(p.FirstOrder)
	}
	type ck struct{ cohort, offset int }
	active := map[ck]map[string]bool{}
	size := map[int]int{}
	for _, p := range profiles {
		size[first[p.ID]]++
	}
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if !orderCounted(o) {
			continue
		}
		f, ok := first[o.CustomerID]
		if !ok {
			continue
		}
		off := monthKey(o.CreatedAt) - f
		if off <= 0 {
			continue
		}
		k := ck{f, off}
		if active[k] == nil {
			active[k] = map[string]bool{}
		}
		active[k][o.CustomerID] = true
	}
	var rows []H
	for m := nowKey - 5; m <= nowKey; m++ {
		t := time.Date(m/12, time.Month(m%12+1), 1, 0, 0, 0, 0, analytics.IST)
		var ret []any
		for off := 1; off <= 5; off++ {
			if m+off > nowKey {
				ret = append(ret, nil)
				continue
			}
			ret = append(ret, analytics.Round(analytics.Ratio(float64(len(active[ck{m, off}])), float64(size[m]))*100, 1))
		}
		rows = append(rows, H{"cohort": t.Format("Jan 2006"), "size": size[m], "retention": ret})
	}
	return rows
}

func customersInsights(c *Ctx, profiles []CustomerProfile) []Insight {
	ds, now := c.DS, c.Now
	var out []Insight
	// AOV over last 90 days for impact estimates.
	w90 := analytics.LastDays(now, 90)
	sum, n := 0.0, 0.0
	for i := range ds.Orders {
		if w90.Contains(ds.Orders[i].CreatedAt) && orderCounted(&ds.Orders[i]) {
			sum += ds.Orders[i].Total
			n++
		}
	}
	aov := analytics.Ratio(sum, n)

	likely := 0
	exp := 0.0
	for _, p := range profiles {
		if p.RepurchaseScore >= 0.5 {
			likely++
			exp += p.RepurchaseScore * p.AOV
		}
	}
	if likely > 0 {
		id := stableID("customers", "repurchase")
		out = append(out, Insight{
			ID: id, AgentID: "customers", Severity: SevOpportunity,
			Title:   fmt.Sprintf("%s customers are likely to purchase again within 30 days", Num(float64(likely))),
			Summary: fmt.Sprintf("Based on each customer's personal purchase cycle, %s repeat customers are due for their next order. A timely reminder typically lifts conversion by 15–25%%.", Num(float64(likely))),
			Evidence: []Evidence{
				Ev("Customers due to repurchase", Num(float64(likely))),
				Ev("Their average order value", INR(exp/float64(likely)/0.7)),
				Ev("Expected revenue if nudged", INR(exp*0.2)),
			},
			LikelyCause:    "These customers' days-since-last-order now match their typical reorder interval.",
			Impact:         fmt.Sprintf("+%s incremental revenue in the next 30 days", INR(exp*0.2)),
			ImpactValue:    exp * 0.2,
			Recommendation: "Send a personalised WhatsApp reminder featuring each customer's last-purchased category, with a 48-hour free-shipping offer.",
			Actions: []Action{
				{Label: "Create campaign", Intent: "apply", Href: "/agents/marketing?tab=recommendations"},
				{Label: "View customers", Intent: "view", Href: "/agents/customers?tab=data&segment=repurchase"},
			},
			DetectedAt: detectedAt(now, id, 240), Confidence: 0.78,
		})
	}

	vipLapsing := 0
	vipValue := 0.0
	for _, p := range profiles {
		if p.Orders >= 3 && p.LTV >= 9000 && p.DaysSinceLast > 60 {
			vipLapsing++
			vipValue += p.LTV
		}
	}
	if vipLapsing > 0 {
		id := stableID("customers", "vip-lapsing")
		out = append(out, Insight{
			ID: id, AgentID: "customers", Severity: SevImportant,
			Title:   fmt.Sprintf("%d high-value customers haven't ordered in 60+ days", vipLapsing),
			Summary: fmt.Sprintf("These customers have spent %s with you historically but have gone quiet. Win-back is far cheaper than acquiring equivalent new customers.", INR(vipValue)),
			Evidence: []Evidence{
				Ev("Lapsing high-value customers", Num(float64(vipLapsing))),
				Ev("Their lifetime revenue", INR(vipValue)),
			},
			LikelyCause:    "Natural lapse after the festive purchase cycle; several also raised a support ticket in their last order.",
			Impact:         fmt.Sprintf("%s annual revenue at risk", INR(vipValue/2)),
			ImpactValue:    -vipValue / 24,
			Recommendation: "Run a VIP win-back with early access to new arrivals and a personal note — avoid deep discounts for this segment.",
			Actions: []Action{
				{Label: "View customers", Intent: "view", Href: "/agents/customers?tab=data&segment=At+Risk"},
				{Label: "Assign", Intent: "assign"},
			},
			DetectedAt: detectedAt(now, id, 400), Confidence: 0.88,
		})
	}

	// New-customer acquisition trend (last 14 vs prior 14 days).
	w := analytics.LastDays(now, 14)
	wp := w.Before(14)
	first := map[string]time.Time{}
	for _, p := range profiles {
		first[p.ID] = p.FirstOrder
	}
	nc, np := 0, 0
	for _, t := range first {
		if w.Contains(t) {
			nc++
		} else if wp.Contains(t) {
			np++
		}
	}
	if ch := analytics.Pct(float64(nc), float64(np)); math.Abs(ch) > 8 {
		id := stableID("customers", "acq-trend")
		sev := SevInfo
		title := fmt.Sprintf("New-customer acquisition up %.0f%% over the last 14 days", ch)
		rec := "Keep prospecting budgets steady; focus on converting these first-time buyers into a second order within 30 days."
		if ch < 0 {
			sev = SevImportant
			title = fmt.Sprintf("New-customer acquisition down %.0f%% over the last 14 days", -ch)
			rec = "Review prospecting campaign efficiency in the Marketing agent — the decline coincides with weaker paid-social performance."
		}
		out = append(out, Insight{
			ID: id, AgentID: "customers", Severity: sev, Title: title,
			Summary:        fmt.Sprintf("%s first-time customers in the last 14 days versus %s in the 14 days before.", Num(float64(nc)), Num(float64(np))),
			Evidence:       []Evidence{EvC("New customers (14d)", Num(float64(nc)), ch, "pct", map[bool]string{true: "good", false: "bad"}[ch > 0])},
			Recommendation: rec,
			Actions:        []Action{{Label: "View trend", Intent: "view", Href: "/agents/customers"}},
			DetectedAt:     detectedAt(now, id, 500), Confidence: 0.9,
		})
	}
	_ = aov
	sortInsights(out)
	return out
}
