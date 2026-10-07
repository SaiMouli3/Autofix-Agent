package agents

import (
	"fmt"
	"math"
	"sort"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

var ReviewsMeta = Meta{
	ID: "reviews", Name: "Review & Reputation Agent", ShortName: "Reviews", Icon: "star",
	Question:    "What are customers publicly saying about my business?",
	Description: "Owns public feedback — ratings, sentiment, recurring themes, negative review spikes and review responses.",
	DataSources: []string{"Store reviews", "Google Reviews", "Instagram comments"},
	Responsibilities: []string{"Reviews & ratings", "Sentiment", "Review trends", "Negative & positive reviews", "Rating changes",
		"Recurring themes", "Reputation monitoring", "Review responses"},
}

func AnalyzeReviews(c *Ctx) Result {
	ds, r, now := c.DS, c.R, c.Now
	sb := newSeries(r, "count", "ratingSum", "positive", "neutral", "negative")
	var cur, prev struct {
		n, pos, neg, responded int
		sum                    float64
	}
	stars := make([]int, 5)
	themeNeg := map[string]int{}
	themePos := map[string]int{}
	negTotal, posTotal := 0, 0
	type pr struct {
		n   int
		sum float64
		neg int
	}
	byProduct := map[string]*pr{}
	for _, rv := range ds.Reviews {
		if r.PrevContains(rv.CreatedAt) {
			prev.n++
			prev.sum += float64(rv.Rating)
			if rv.Sentiment == "positive" {
				prev.pos++
			} else if rv.Sentiment == "negative" {
				prev.neg++
			}
			if rv.Response != "" {
				prev.responded++
			}
		}
		if !r.Contains(rv.CreatedAt) {
			continue
		}
		cur.n++
		cur.sum += float64(rv.Rating)
		stars[rv.Rating-1]++
		sb.add("count", rv.CreatedAt, 1)
		sb.add("ratingSum", rv.CreatedAt, float64(rv.Rating))
		sb.add(rv.Sentiment, rv.CreatedAt, 1)
		if rv.Response != "" {
			cur.responded++
		}
		switch rv.Sentiment {
		case "positive":
			cur.pos++
			posTotal++
			for _, t := range rv.Themes {
				themePos[t]++
			}
		case "negative":
			cur.neg++
			negTotal++
			for _, t := range rv.Themes {
				themeNeg[t]++
			}
		}
		p := byProduct[rv.ProductID]
		if p == nil {
			p = &pr{}
			byProduct[rv.ProductID] = p
		}
		p.n++
		p.sum += float64(rv.Rating)
		if rv.Sentiment == "negative" {
			p.neg++
		}
	}
	sb.set("avgRating", ratioSeries(sb.get("ratingSum"), sb.get("count"), 1))
	avg, avgPrev := analytics.Ratio(cur.sum, float64(cur.n)), analytics.Ratio(prev.sum, float64(prev.n))
	posPct, posPrev := analytics.Ratio(float64(cur.pos), float64(cur.n))*100, analytics.Ratio(float64(prev.pos), float64(prev.n))*100
	negPct, negPrev := analytics.Ratio(float64(cur.neg), float64(cur.n))*100, analytics.Ratio(float64(prev.neg), float64(prev.n))*100
	respRate := analytics.Ratio(float64(cur.responded), float64(cur.neg)) * 100
	respPrev := analytics.Ratio(float64(prev.responded), float64(prev.neg)) * 100
	kpis := []KPI{
		NewKPI("avgRating", "Average rating", avg, avgPrev, "rating", "up"),
		NewKPI("total", "Total reviews", float64(cur.n), float64(prev.n), "number", "up"),
		NewKPI("positive", "Positive", posPct, posPrev, "percent", "up"),
		NewKPI("negative", "Negative", negPct, negPrev, "percent", "down"),
		NewKPI("responseRate", "Negative reviews answered", math.Min(respRate, 100), math.Min(respPrev, 100), "percent", "up"),
	}
	kpis[0].Spark = sb.get("avgRating")
	kpis[1].Spark = sb.get("count")

	themes := func(m map[string]int, total int) []H {
		var rows []H
		for k, v := range m {
			rows = append(rows, H{"theme": k, "count": v, "share": analytics.Round(analytics.Ratio(float64(v), float64(total))*100, 1)})
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i]["count"].(int) > rows[j]["count"].(int) })
		return rows
	}
	var starRows []H
	for i := 4; i >= 0; i-- {
		starRows = append(starRows, H{"stars": i + 1, "count": stars[i], "share": analytics.Round(analytics.Ratio(float64(stars[i]), float64(cur.n))*100, 1)})
	}
	var prodRows []H
	for pid, p := range byProduct {
		if p.n < 3 {
			continue
		}
		prod := ds.ProductByID[pid]
		prodRows = append(prodRows, H{"productId": pid, "name": prod.Name, "category": prod.Category, "reviews": p.n,
			"avgRating": analytics.Round(p.sum/float64(p.n), 2), "negative": p.neg})
	}
	sort.Slice(prodRows, func(i, j int) bool { return prodRows[i]["avgRating"].(float64) < prodRows[j]["avgRating"].(float64) })
	if len(prodRows) > 10 {
		prodRows = prodRows[:10]
	}
	// Recent reviews for the page (newest first, mix of sentiments).
	recent := make([]model.Review, 0, 12)
	idx := make([]int, len(ds.Reviews))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool { return ds.Reviews[idx[a]].CreatedAt.After(ds.Reviews[idx[b]].CreatedAt) })
	for _, i := range idx {
		if len(recent) >= 12 {
			break
		}
		recent = append(recent, ds.Reviews[i])
	}
	var recentRows []H
	for _, rv := range recent {
		recentRows = append(recentRows, reviewRow(ds, &rv))
	}

	insights := reviewsInsights(c)
	health := 0.55*analytics.Score(avg, 4.5, 3.3) + 0.3*analytics.Score(negPct, 5, 32) + 0.15*analytics.Score(math.Min(respRate, 100), 90, 20)
	healthPrev := 0.55*analytics.Score(avgPrev, 4.5, 3.3) + 0.3*analytics.Score(negPrev, 5, 32) + 0.15*analytics.Score(math.Min(respPrev, 100), 90, 20)
	view := H{
		"kpis": kpis, "trend": sb.rows(), "stars": starRows,
		"sentiment":      []H{{"label": "Positive", "count": cur.pos}, {"label": "Neutral", "count": cur.n - cur.pos - cur.neg}, {"label": "Negative", "count": cur.neg}},
		"negativeThemes": themes(themeNeg, negTotal), "positiveThemes": themes(themePos, posTotal),
		"lowestRated": prodRows, "recent": recentRows,
		"healthBreakdown": []H{
			{"label": "Average rating", "score": math.Round(analytics.Score(avg, 4.5, 3.3))},
			{"label": "Negative share", "score": math.Round(analytics.Score(negPct, 5, 32))},
			{"label": "Response coverage", "score": math.Round(analytics.Score(math.Min(respRate, 100), 90, 20))},
		},
	}
	changes := []Change{}
	for _, k := range kpis {
		changes = append(changes, ChangeFromKPI(k))
	}
	sum := summarize(ReviewsMeta, now, health, healthPrev, insights, Headline{Label: "Average rating", Value: analytics.Round(avg, 2), Unit: "rating"}, len(ds.Reviews))
	return Result{Summary: sum, Insights: insights, Changes: changes, View: view, Activity: scanActivity(c, ReviewsMeta.ID, "reviews")}
}

func reviewRow(ds *model.Dataset, rv *model.Review) H {
	p := ds.ProductByID[rv.ProductID]
	cust := ds.CustomerByID[rv.CustomerID]
	return H{"id": rv.ID, "productId": rv.ProductID, "product": p.Name, "customer": cust.Name, "city": cust.City,
		"rating": rv.Rating, "title": rv.Title, "body": rv.Body, "source": rv.Source, "sentiment": rv.Sentiment,
		"themes": rv.Themes, "createdAt": rv.CreatedAt, "response": rv.Response, "orderId": rv.OrderID}
}

func reviewsInsights(c *Ctx) []Insight {
	ds, now := c.DS, c.Now
	var out []Insight
	w := analytics.LastDays(now, 14)
	base := w.Before(42)
	type agg struct {
		neg, n [2]int
		sum    [2]float64
		themes map[string]int
	}
	byProd := map[string]*agg{}
	totNeg := [2]int{}
	totN := [2]int{}
	totSum := [2]float64{}
	for _, rv := range ds.Reviews {
		wi := -1
		if w.Contains(rv.CreatedAt) {
			wi = 0
		} else if base.Contains(rv.CreatedAt) {
			wi = 1
		}
		if wi < 0 {
			continue
		}
		a := byProd[rv.ProductID]
		if a == nil {
			a = &agg{themes: map[string]int{}}
			byProd[rv.ProductID] = a
		}
		a.n[wi]++
		a.sum[wi] += float64(rv.Rating)
		totN[wi]++
		totSum[wi] += float64(rv.Rating)
		if rv.Sentiment == "negative" {
			a.neg[wi]++
			totNeg[wi]++
			if wi == 0 {
				for _, t := range rv.Themes {
					a.themes[t]++
				}
			}
		}
	}
	// Product with the largest surge in negative reviews (rate per day).
	var worst string
	worstLift := 0.0
	for pid, a := range byProd {
		curRate := float64(a.neg[0]) / 14
		baseRate := float64(a.neg[1]) / 42
		if a.neg[0] >= 6 && curRate-baseRate > worstLift {
			worstLift, worst = curRate-baseRate, pid
		}
	}
	if worst != "" {
		a := byProd[worst]
		p := ds.ProductByID[worst]
		topTheme, topN := "", 0
		themeTotal := 0
		for t, n := range a.themes {
			themeTotal += n
			if n > topN {
				topTheme, topN = t, n
			}
		}
		negShareCur := analytics.Ratio(float64(a.neg[0]), float64(a.n[0])) * 100
		negShareBase := analytics.Ratio(float64(a.neg[1]), float64(a.n[1])) * 100
		avgCur := analytics.Ratio(a.sum[0], float64(a.n[0]))
		avgBase := analytics.Ratio(a.sum[1], float64(a.n[1]))
		// overall negative-review increase driven by this product
		storeNegCh := analytics.Pct(float64(totNeg[0])/14, float64(totNeg[1])/42)
		share := analytics.Ratio(float64(a.neg[0])-float64(a.neg[1])/3, float64(totNeg[0])-float64(totNeg[1])/3) * 100
		id := stableID("reviews", "neg-spike", worst)
		out = append(out, Insight{
			ID: id, AgentID: "reviews", Severity: SevCritical,
			Title:   fmt.Sprintf("Negative reviews for %s surged — %.0f%% now mention %s", p.Name, analytics.Ratio(float64(topN), float64(a.neg[0]))*100, topTheme),
			Summary: fmt.Sprintf("%d negative reviews in the last 14 days (%.0f%% of its reviews vs %.0f%% before). Average rating fell from %.2f to %.2f. Store-wide negative reviews are up %.0f%%, and this product drives %.0f%% of that increase.", a.neg[0], negShareCur, negShareBase, avgBase, avgCur, storeNegCh, math.Min(share, 100)),
			Evidence: []Evidence{
				EvC("Negative review share", Pct1(negShareCur), negShareCur-negShareBase, "pts", "bad"),
				EvC("Average rating", fmt.Sprintf("%.2f★", avgCur), avgCur-avgBase, "", "bad"),
				Ev("Top theme", fmt.Sprintf("%s (%d mentions)", topTheme, topN)),
				EvC("Store-wide negative reviews", fmt.Sprintf("%d in 14d", totNeg[0]), storeNegCh, "pct", "bad"),
			},
			LikelyCause:    fmt.Sprintf("Customers consistently describe %s problems, which points to a product or batch issue rather than service.", topTheme),
			Impact:         "Lower ratings on a top seller reduce product-page conversion by an estimated 8–12%",
			ImpactValue:    -productMonthlyRevenue(ds, worst, now) * 0.1,
			Recommendation: "Respond publicly to each negative review within 24 hours, and share the theme breakdown with the Product team to confirm the root cause.",
			Actions: []Action{
				{Label: "Investigate", Intent: "investigate", Href: "/agents/reviews?tab=data&product=" + worst + "&sentiment=negative"},
				{Label: "Generate responses", Intent: "generate", Href: "/agents/reviews?tab=data&sentiment=negative&unanswered=1"},
			},
			Entity:     &EntityRef{Type: "product", ID: worst, Name: p.Name},
			DetectedAt: detectedAt(now, id, 120), Confidence: 0.9,
		})
	}
	// Unanswered negative reviews.
	unanswered := 0
	for _, rv := range ds.Reviews {
		if rv.Sentiment == "negative" && rv.Response == "" && now.Sub(rv.CreatedAt).Hours() < 24*21 {
			unanswered++
		}
	}
	if unanswered > 0 {
		id := stableID("reviews", "unanswered")
		out = append(out, Insight{
			ID: id, AgentID: "reviews", Severity: SevImportant,
			Title:          fmt.Sprintf("%d negative reviews are awaiting a response", unanswered),
			Summary:        "Public replies to negative reviews within 48 hours recover trust with future shoppers, who read responses as much as the reviews themselves.",
			Evidence:       []Evidence{Ev("Unanswered negative reviews (21d)", Num(float64(unanswered)))},
			Recommendation: "Use AI-drafted responses, then personalise and publish them.",
			Actions:        []Action{{Label: "Generate responses", Intent: "generate", Href: "/agents/reviews?tab=data&sentiment=negative&unanswered=1"}},
			DetectedAt:     detectedAt(now, id, 300), Confidence: 0.99,
		})
	}
	// Overall rating move.
	avgCur, avgBase := analytics.Ratio(totSum[0], float64(totN[0])), analytics.Ratio(totSum[1], float64(totN[1]))
	if d := avgCur - avgBase; math.Abs(d) >= 0.05 {
		id := stableID("reviews", "rating-move")
		sev, title := SevImportant, fmt.Sprintf("Store rating slipped to %.2f★ over the last 14 days", avgCur)
		if d > 0 {
			sev, title = SevInfo, fmt.Sprintf("Store rating improved to %.2f★ over the last 14 days", avgCur)
		}
		out = append(out, Insight{
			ID: id, AgentID: "reviews", Severity: sev, Title: title,
			Summary:        fmt.Sprintf("Average rating moved from %.2f to %.2f across %d recent reviews.", avgBase, avgCur, totN[0]),
			Evidence:       []Evidence{EvC("Average rating (14d)", fmt.Sprintf("%.2f★", avgCur), d, "", map[bool]string{true: "good", false: "bad"}[d > 0])},
			Recommendation: "Track whether the movement is concentrated in a few products — see the lowest-rated products list.",
			Actions:        []Action{{Label: "View rating trend", Intent: "view", Href: "/agents/reviews"}},
			DetectedAt:     detectedAt(now, id, 400), Confidence: 0.85,
		})
	}
	// Positive theme to amplify.
	posThemes := map[string]int{}
	posN := 0
	for _, rv := range ds.Reviews {
		if rv.Sentiment == "positive" && now.Sub(rv.CreatedAt).Hours() < 24*30 {
			posN++
			for _, t := range rv.Themes {
				posThemes[t]++
			}
		}
	}
	best, bestN := "", 0
	for t, n := range posThemes {
		if n > bestN {
			best, bestN = t, n
		}
	}
	if best != "" {
		id := stableID("reviews", "pos-theme", best)
		out = append(out, Insight{
			ID: id, AgentID: "reviews", Severity: SevOpportunity,
			Title:          fmt.Sprintf("Customers love your %s — %.0f%% of positive reviews mention it", lower(best), analytics.Ratio(float64(bestN), float64(posN))*100),
			Summary:        "Real customer language converts better than brand copy in ads and on product pages.",
			Evidence:       []Evidence{Ev("Positive reviews (30d)", Num(float64(posN))), Ev("Mentioning "+lower(best), Num(float64(bestN)))},
			Recommendation: fmt.Sprintf("Feature 3–5 verbatim reviews about %s in product pages and retargeting creatives.", lower(best)),
			Impact:         "Typical lift of 3–6% in retargeting CTR",
			ImpactValue:    0,
			Actions:        []Action{{Label: "View reviews", Intent: "view", Href: "/agents/reviews?tab=data&sentiment=positive"}},
			DetectedAt:     detectedAt(now, id, 600), Confidence: 0.8,
		})
	}
	sortInsights(out)
	return out
}

func lower(s string) string {
	b := []byte(s)
	if len(b) > 0 && b[0] >= 'A' && b[0] <= 'Z' {
		b[0] += 32
	}
	return string(b)
}
