package agents

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

var InventoryMeta = Meta{
	ID: "inventory", Name: "Inventory Agent", ShortName: "Inventory", Icon: "boxes",
	Question:    "Do I have enough inventory?",
	Description: "Owns stock and supply — stock levels, stockouts, overstock, dead stock, velocity, demand forecasts and reorder recommendations.",
	DataSources: []string{"Warehouse stock", "Order items", "Purchase orders"},
	Responsibilities: []string{"Inventory levels", "Stockouts", "Low stock", "Overstock", "Dead stock", "Velocity",
		"Demand forecasting", "Reorder recommendations", "Stock allocation", "Inventory risk"},
}

type StockRow struct {
	ProductID    string     `json:"productId"`
	SKU          string     `json:"sku"`
	Name         string     `json:"name"`
	Category     string     `json:"category"`
	Warehouse    string     `json:"warehouse"`
	OnHand       int        `json:"onHand"`
	Reserved     int        `json:"reserved"`
	Available    int        `json:"available"`
	DailySales   float64    `json:"dailySales"`
	Trend        float64    `json:"trend"` // % change of last 14 vs prior 14 days velocity
	DaysLeft     float64    `json:"daysLeft"`
	ReorderPoint int        `json:"reorderPoint"`
	LeadTime     int        `json:"leadTimeDays"`
	ReorderQty   int        `json:"reorderQty"`
	Value        float64    `json:"value"`
	Risk         string     `json:"risk"` // stockout | critical | low | healthy | overstock | dead
	StockoutDate *time.Time `json:"stockoutDate,omitempty"`
}

// StockRows computes the live inventory position of every product.
func StockRows(ds *model.Dataset, now time.Time) []StockRow {
	w28 := analytics.LastDays(now, 28)
	w14 := analytics.LastDays(now, 14)
	w14b := w14.Before(14)
	sold := map[string]*[3]float64{} // 28d, last14, prior14
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if !orderCounted(o) || o.CreatedAt.Before(w28.From) {
			continue
		}
		for _, it := range o.Items {
			s := sold[it.ProductID]
			if s == nil {
				s = &[3]float64{}
				sold[it.ProductID] = s
			}
			q := float64(it.Qty)
			s[0] += q
			if w14.Contains(o.CreatedAt) {
				s[1] += q
			} else if w14b.Contains(o.CreatedAt) {
				s[2] += q
			}
		}
	}
	var out []StockRow
	for _, p := range ds.Products {
		inv := ds.InvByProduct[p.ID]
		if inv == nil {
			continue
		}
		s := sold[p.ID]
		if s == nil {
			s = &[3]float64{}
		}
		// Weighted velocity favours recent demand.
		v := 0.6*(s[1]/14) + 0.4*(s[0]/28)
		avail := inv.OnHand - inv.Reserved
		if avail < 0 {
			avail = 0
		}
		row := StockRow{
			ProductID: p.ID, SKU: p.SKU, Name: p.Name, Category: p.Category, Warehouse: inv.Warehouse,
			OnHand: inv.OnHand, Reserved: inv.Reserved, Available: avail, DailySales: analytics.Round(v, 2),
			Trend: analytics.Round(analytics.Pct(s[1], s[2]), 1), ReorderPoint: inv.ReorderPoint, LeadTime: inv.LeadTimeDays,
			Value: analytics.Round(float64(inv.OnHand)*p.Cost, 0),
		}
		row.DaysLeft = 999
		if v > 0.01 {
			row.DaysLeft = analytics.Round(float64(avail)/v, 1)
			d := now.Add(time.Duration(row.DaysLeft*24) * time.Hour)
			row.StockoutDate = &d
		}
		switch {
		case inv.OnHand == 0:
			row.Risk = "stockout"
		case s[0] <= 1 && inv.OnHand > 50:
			row.Risk = "dead"
		case row.DaysLeft < 7 || row.DaysLeft < float64(inv.LeadTimeDays)*0.5:
			row.Risk = "critical"
		case row.DaysLeft < float64(inv.LeadTimeDays)+5:
			row.Risk = "low"
		case row.DaysLeft > 110:
			row.Risk = "overstock"
		default:
			row.Risk = "healthy"
		}
		if row.Risk == "stockout" || row.Risk == "critical" || row.Risk == "low" {
			need := v*float64(inv.LeadTimeDays+30) - float64(avail)
			row.ReorderQty = int(math.Ceil(math.Max(need, 0)/10) * 10)
		}
		out = append(out, row)
	}
	return out
}

var riskOrder = map[string]int{"stockout": 0, "critical": 1, "low": 2, "dead": 3, "overstock": 4, "healthy": 5}

func AnalyzeInventory(c *Ctx) Result {
	ds, r, now := c.DS, c.R, c.Now
	rows := StockRows(ds, now)
	sort.Slice(rows, func(i, j int) bool {
		if riskOrder[rows[i].Risk] != riskOrder[rows[j].Risk] {
			return riskOrder[rows[i].Risk] < riskOrder[rows[j].Risk]
		}
		return rows[i].DaysLeft < rows[j].DaysLeft
	})
	var value float64
	var units, low, risk, over, dead int
	var deadValue, overValue float64
	for _, x := range rows {
		value += x.Value
		units += x.Available
		switch x.Risk {
		case "low":
			low++
		case "critical", "stockout":
			risk++
		case "overstock":
			over++
			overValue += x.Value
		case "dead":
			dead++
			deadValue += x.Value
		}
	}
	// Previous values from history at range start.
	var prevValue float64
	var prevUnits int
	var prevLow, prevStockouts int
	trend := []H{}
	for _, s := range ds.InvHistory {
		if !s.Date.Before(r.PrevFrom) && s.Date.Before(r.From) {
			prevValue, prevUnits, prevLow, prevStockouts = s.Value, s.Units, s.LowStock, s.Stockouts
		}
		if r.Contains(s.Date) || (r.Granularity == "hour" && analytics.StartOfDay(s.Date).Equal(analytics.StartOfDay(r.From))) {
			trend = append(trend, H{"t": s.Date.Format("2006-01-02"), "value": s.Value, "units": s.Units, "restocked": s.Restocked})
		}
	}
	if len(trend) < 2 { // short ranges: show the last 14 days for context
		trend = trend[:0]
		for _, s := range ds.InvHistory[len(ds.InvHistory)-14:] {
			trend = append(trend, H{"t": s.Date.Format("2006-01-02"), "value": s.Value, "units": s.Units, "restocked": s.Restocked})
		}
	}
	kpis := []KPI{
		NewKPI("value", "Inventory value", value, prevValue, "currency", "neutral"),
		NewKPI("available", "Units available", float64(units), float64(prevUnits), "number", "neutral"),
		NewKPI("low", "Low-stock products", float64(low), float64(prevLow), "number", "down"),
		NewKPI("risk", "Stockout risks", float64(risk), float64(prevStockouts), "number", "down"),
		NewKPI("overstock", "Overstocked", float64(over), 0, "number", "down"),
		NewKPI("dead", "Dead stock", float64(dead), 0, "number", "down"),
	}
	kpis[0].Hint = "Valued at cost"
	kpis[4].Hint = fmt.Sprintf("%s tied up", INR(overValue))
	kpis[5].Hint = fmt.Sprintf("%s tied up", INR(deadValue))

	// Velocity: top movers.
	vel := append([]StockRow(nil), rows...)
	sort.Slice(vel, func(i, j int) bool { return vel[i].DailySales > vel[j].DailySales })
	if len(vel) > 10 {
		vel = vel[:10]
	}
	var velocity []H
	for _, v := range vel {
		velocity = append(velocity, H{"name": v.Name, "productId": v.ProductID, "dailySales": v.DailySales, "trend": v.Trend, "daysLeft": v.DaysLeft, "risk": v.Risk})
	}

	forecast := demandForecast(ds, now)
	// Stockout projection for at-risk products (next 21 days).
	var projected []H
	var atRisk []StockRow
	for _, x := range rows {
		if (x.Risk == "critical" || x.Risk == "low") && len(atRisk) < 4 {
			atRisk = append(atRisk, x)
		}
	}
	for d := 0; d <= 21; d++ {
		row := H{"t": analytics.StartOfDay(now).AddDate(0, 0, d).Format("2006-01-02")}
		for _, x := range atRisk {
			row[x.ProductID] = math.Max(0, math.Round(float64(x.Available)-x.DailySales*float64(d)))
		}
		projected = append(projected, row)
	}
	var projSeries []H
	for _, x := range atRisk {
		projSeries = append(projSeries, H{"key": x.ProductID, "name": x.Name, "reorderPoint": x.ReorderPoint, "leadTime": x.LeadTime})
	}
	riskMix := []H{}
	for _, k := range []string{"stockout", "critical", "low", "healthy", "overstock", "dead"} {
		n := 0
		val := 0.0
		for _, x := range rows {
			if x.Risk == k {
				n++
				val += x.Value
			}
		}
		riskMix = append(riskMix, H{"risk": k, "count": n, "value": analytics.Round(val, 0)})
	}
	insights := inventoryInsights(c, rows)
	riskShare := analytics.Ratio(float64(risk), float64(len(rows))) * 100
	health := 0.45*analytics.Score(riskShare, 1, 10) + 0.3*analytics.Score(analytics.Ratio(deadValue+overValue, value)*100, 8, 40) + 0.25*analytics.Score(analytics.Ratio(float64(low), float64(len(rows)))*100, 5, 25)
	healthPrev := 0.45*analytics.Score(analytics.Ratio(float64(prevStockouts), float64(len(rows)))*100, 1, 10) + 0.3*analytics.Score(analytics.Ratio(deadValue+overValue, value)*100, 8, 40) + 0.25*analytics.Score(analytics.Ratio(float64(prevLow), float64(len(rows)))*100, 5, 25)
	view := H{
		"kpis": kpis, "trend": trend, "velocity": velocity, "forecast": forecast,
		"projection": H{"rows": projected, "series": projSeries}, "riskMix": riskMix, "table": rows,
		"healthBreakdown": []H{
			{"label": "Stockout exposure", "score": math.Round(analytics.Score(riskShare, 1, 10))},
			{"label": "Capital efficiency", "score": math.Round(analytics.Score(analytics.Ratio(deadValue+overValue, value)*100, 8, 40))},
			{"label": "Low-stock control", "score": math.Round(analytics.Score(analytics.Ratio(float64(low), float64(len(rows)))*100, 5, 25))},
		},
	}
	changes := []Change{}
	for _, k := range kpis {
		changes = append(changes, ChangeFromKPI(k))
	}
	sum := summarize(InventoryMeta, now, health, healthPrev, insights, Headline{Label: "Stockout risks", Value: float64(risk), Unit: "number"}, len(rows))
	return Result{Summary: sum, Insights: insights, Changes: changes, View: view, Activity: scanActivity(c, InventoryMeta.ID, "inventory")}
}

// demandForecast returns 60 days of actual daily units plus a 30-day
// forecast from a linear trend with day-of-week seasonality.
func demandForecast(ds *model.Dataset, now time.Time) []H {
	today := analytics.StartOfDay(now)
	start := today.AddDate(0, 0, -59)
	actual := make([]float64, 60)
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if o.CreatedAt.Before(start) || !orderCounted(o) {
			continue
		}
		d := int(analytics.StartOfDay(o.CreatedAt).Sub(start).Hours() / 24)
		if d >= 0 && d < 60 {
			for _, it := range o.Items {
				actual[d] += float64(it.Qty)
			}
		}
	}
	// Today is partial — exclude from the fit.
	fit := actual[:59]
	// Remove the festive spike from the fit using a trimmed series.
	trimmed := make([]float64, len(fit))
	med := analytics.Median(fit)
	for i, v := range fit {
		trimmed[i] = math.Min(v, med*1.35)
	}
	slope, icpt := analytics.LinearTrend(trimmed)
	dow := make([]float64, 7)
	dowN := make([]float64, 7)
	for i, v := range trimmed {
		base := icpt + slope*float64(i)
		if base > 0 {
			wd := int(start.AddDate(0, 0, i).Weekday())
			dow[wd] += v / base
			dowN[wd]++
		}
	}
	for i := range dow {
		if dowN[i] > 0 {
			dow[i] /= dowN[i]
		} else {
			dow[i] = 1
		}
	}
	resid := make([]float64, len(trimmed))
	for i, v := range trimmed {
		resid[i] = v - (icpt+slope*float64(i))*dow[int(start.AddDate(0, 0, i).Weekday())]
	}
	sd := analytics.StdDev(resid)
	var out []H
	for i := 0; i < 59; i++ {
		out = append(out, H{"t": start.AddDate(0, 0, i).Format("2006-01-02"), "actual": actual[i]})
	}
	for k := 0; k < 31; k++ {
		i := 59 + k
		t := start.AddDate(0, 0, i)
		f := (icpt + slope*float64(i)) * dow[int(t.Weekday())]
		band := sd * (1 + float64(k)/30)
		row := H{"t": t.Format("2006-01-02"), "forecast": analytics.Round(f, 1), "low": analytics.Round(math.Max(0, f-1.28*band), 1), "high": analytics.Round(f+1.28*band, 1)}
		if k == 0 {
			row["actual"] = actual[59]
		}
		out = append(out, row)
	}
	return out
}

func inventoryInsights(c *Ctx, rows []StockRow) []Insight {
	ds, now := c.DS, c.Now
	var out []Insight
	for _, x := range rows {
		if x.Risk != "critical" || x.DailySales < 3 {
			continue
		}
		p := ds.ProductByID[x.ProductID]
		dailyRev := x.DailySales * p.Price
		gap := math.Max(0, float64(x.LeadTime)-x.DaysLeft)
		lost := dailyRev * gap
		id := stableID("inventory", "stockout", x.ProductID)
		out = append(out, Insight{
			ID: id, AgentID: "inventory", Severity: SevCritical,
			Title:   fmt.Sprintf("%s will run out of stock in %.0f days", x.Name, x.DaysLeft),
			Summary: fmt.Sprintf("Only %d units available against %.1f units/day of demand (trend %s). Supplier lead time is %d days, so a reorder today still leaves a %.0f-day gap.", x.Available, x.DailySales, Signed(x.Trend), x.LeadTime, gap),
			Evidence: []Evidence{
				Ev("Units available", Num(float64(x.Available))),
				EvC("Daily sales (velocity)", fmt.Sprintf("%.1f/day", x.DailySales), x.Trend, "pct", "neutral"),
				Ev("Projected stockout", x.StockoutDate.In(analytics.IST).Format("Mon, 2 Jan")),
				Ev("Lead time", fmt.Sprintf("%d days", x.LeadTime)),
			},
			LikelyCause:    "Demand accelerated faster than the reorder point assumed; the last replenishment was sized for the earlier sales rate.",
			Impact:         fmt.Sprintf("%s in lost sales during the stockout window", INR(lost)),
			ImpactValue:    -lost,
			Recommendation: fmt.Sprintf("Raise a purchase order for %s units today and request expedited dispatch; throttle discounting on this SKU until stock lands.", Num(float64(x.ReorderQty))),
			Actions: []Action{
				{Label: "Create purchase order", Intent: "apply"},
				{Label: "View product", Intent: "view", Href: "/agents/inventory?tab=data&risk=critical"},
			},
			Entity:     &EntityRef{Type: "product", ID: x.ProductID, Name: x.Name},
			DetectedAt: detectedAt(now, id, 100), Confidence: 0.91,
		})
		break
	}
	for _, x := range rows {
		if x.Risk != "stockout" {
			continue
		}
		p := ds.ProductByID[x.ProductID]
		id := stableID("inventory", "oos", x.ProductID)
		lost := x.DailySales * p.Price * 30
		if x.DailySales < 0.2 {
			continue
		}
		out = append(out, Insight{
			ID: id, AgentID: "inventory", Severity: SevImportant,
			Title:          fmt.Sprintf("%s is out of stock", x.Name),
			Summary:        fmt.Sprintf("Demand of %.1f units/day is going unfulfilled. Back-in-stock alerts can recapture part of this demand.", x.DailySales),
			Evidence:       []Evidence{Ev("Recent demand", fmt.Sprintf("%.1f units/day", x.DailySales)), Ev("Lead time", fmt.Sprintf("%d days", x.LeadTime))},
			Impact:         fmt.Sprintf("%s/month in lost sales", INR(lost)),
			ImpactValue:    -lost,
			Recommendation: fmt.Sprintf("Reorder %s units and enable WhatsApp back-in-stock alerts.", Num(float64(x.ReorderQty))),
			Actions:        []Action{{Label: "Create purchase order", Intent: "apply"}, {Label: "View inventory", Intent: "view", Href: "/agents/inventory?tab=data&risk=stockout"}},
			Entity:         &EntityRef{Type: "product", ID: x.ProductID, Name: x.Name},
			DetectedAt:     detectedAt(now, id, 300), Confidence: 0.99,
		})
	}
	deadN, deadV := 0, 0.0
	for _, x := range rows {
		if x.Risk == "dead" {
			deadN++
			deadV += x.Value
		}
	}
	if deadN > 0 {
		id := stableID("inventory", "dead")
		out = append(out, Insight{
			ID: id, AgentID: "inventory", Severity: SevOpportunity,
			Title:          fmt.Sprintf("%s of working capital is tied up in %d dead-stock SKUs", INR(deadV), deadN),
			Summary:        "These products sold one unit or fewer in the last 28 days while holding significant stock.",
			Evidence:       []Evidence{Ev("Dead-stock SKUs", Num(float64(deadN))), Ev("Value at cost", INR(deadV))},
			Recommendation: "Bundle dead stock with best-sellers or run a clearance collection; release capital toward fast movers.",
			Impact:         fmt.Sprintf("Up to %s cash released", INR(deadV*0.7)),
			ImpactValue:    deadV * 0.25,
			Actions:        []Action{{Label: "View dead stock", Intent: "view", Href: "/agents/inventory?tab=data&risk=dead"}},
			DetectedAt:     detectedAt(now, id, 700), Confidence: 0.95,
		})
	}
	sortInsights(out)
	return out
}
