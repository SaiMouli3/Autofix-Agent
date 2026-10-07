package agents

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

var OrdersMeta = Meta{
	ID: "orders", Name: "Order & Delivery Agent", ShortName: "Orders & Delivery", Icon: "truck",
	Question:    "Where are my orders and what is going wrong?",
	Description: "Owns the full order lifecycle — fulfilment, shipping, delivery, NDR, RTO, cancellations, returns and refunds.",
	DataSources: []string{"Store orders", "Courier tracking", "Returns portal"},
	Responsibilities: []string{"Orders & status", "Fulfilment", "Shipping & delivery", "Delayed orders", "NDR", "RTO", "Cancellations",
		"Returns & refunds", "Courier performance", "Delivery SLA"},
}

// IsDelayed reports whether a shipment missed (or is missing) its promise.
func IsDelayed(s *model.Shipment, now time.Time) bool {
	if s == nil {
		return false
	}
	if s.DeliveredAt != nil {
		return s.DeliveredAt.After(s.PromisedAt)
	}
	return (s.Status == model.OrderShipped || s.Status == model.OrderNDR || s.Status == model.OrderProcessing) && now.After(s.PromisedAt)
}

// OrderRisk scores an order's delivery risk for tables and drill-downs.
func OrderRisk(o *model.Order, s *model.Shipment, now time.Time) string {
	switch o.Status {
	case model.OrderDelivered, model.OrderCancelled, model.OrderReturned:
		return "none"
	case model.OrderRTO:
		return "lost"
	case model.OrderNDR:
		return "high"
	}
	if s != nil && IsDelayed(s, now) {
		if o.Total >= 3000 {
			return "high"
		}
		return "medium"
	}
	if o.PaymentMethod == "cod" && s != nil && (s.Region == "East" || s.Region == "Northeast") {
		return "medium"
	}
	return "low"
}

type courierStat struct {
	shipments, delivered, onTime, ndr, rto int
	transit                                float64
}

func (cs *courierStat) onTimeRate() float64 {
	return analytics.Ratio(float64(cs.onTime), float64(cs.delivered))
}

func AnalyzeOrders(c *Ctx) Result {
	ds, r, now := c.DS, c.R, c.Now
	sb := newSeries(r, "orders", "prevOrders", "delivered", "rto", "rtoCod", "rtoPrepaid", "ndr", "closed", "closedCod", "closedPrepaid", "shipped")

	var cur, prev struct {
		orders, delivered, delayed, ndr, rto, cancelled, returned int
		refunded                                                  float64
		onTime, deliveredWithPromise                              int
	}
	status := map[string]int{}
	couriers := map[string]*courierStat{}
	states := map[string]*courierStat{}
	stateRegion := map[string]string{}
	slaBins := []int{0, 0, 0, 0, 0, 0}
	payment := map[string]*[2]int{"cod": {0, 0}, "prepaid": {0, 0}} // closed, rto

	for i := range ds.Orders {
		o := &ds.Orders[i]
		s := ds.ShipByOrder[o.ID]
		inCur, inPrev := r.Contains(o.CreatedAt), r.PrevContains(o.CreatedAt)
		if inPrev {
			sb.add("prevOrders", c.shiftPrev(o.CreatedAt), 1)
			prev.orders++
			switch o.Status {
			case model.OrderDelivered, model.OrderReturned:
				prev.delivered++
			case model.OrderRTO:
				prev.rto++
			case model.OrderNDR:
				prev.ndr++
			case model.OrderCancelled:
				prev.cancelled++
			}
			if o.Status == model.OrderReturned {
				prev.returned++
			}
			if s != nil && IsDelayed(s, now) {
				prev.delayed++
			}
			if s != nil && s.NDRAttempts > 0 && o.Status != model.OrderNDR {
				prev.ndr++
			}
		}
		if !inCur {
			continue
		}
		cur.orders++
		sb.add("orders", o.CreatedAt, 1)
		status[o.Status]++
		switch o.Status {
		case model.OrderDelivered, model.OrderReturned:
			cur.delivered++
			sb.add("delivered", o.CreatedAt, 1)
		case model.OrderRTO:
			cur.rto++
		case model.OrderCancelled:
			cur.cancelled++
		}
		if o.Status == model.OrderReturned {
			cur.returned++
		}
		if s == nil {
			continue
		}
		if s.NDRAttempts > 0 || o.Status == model.OrderNDR {
			cur.ndr++
			sb.add("ndr", o.CreatedAt, 1)
		}
		if IsDelayed(s, now) {
			cur.delayed++
		}
		if s.ShippedAt != nil {
			sb.add("shipped", o.CreatedAt, 1)
		}
		closed := s.DeliveredAt != nil || s.Status == model.OrderRTO
		if closed {
			sb.add("closed", o.CreatedAt, 1)
			key := "closedPrepaid"
			if o.PaymentMethod == "cod" {
				key = "closedCod"
			}
			sb.add(key, o.CreatedAt, 1)
			payment[o.PaymentMethod][0]++
		}
		if s.Status == model.OrderRTO {
			sb.add("rto", o.CreatedAt, 1)
			if o.PaymentMethod == "cod" {
				sb.add("rtoCod", o.CreatedAt, 1)
			} else {
				sb.add("rtoPrepaid", o.CreatedAt, 1)
			}
			payment[o.PaymentMethod][1]++
		}
		if s.ShippedAt == nil {
			continue
		}
		cs := couriers[s.Courier]
		if cs == nil {
			cs = &courierStat{}
			couriers[s.Courier] = cs
		}
		st := states[s.State]
		if st == nil {
			st = &courierStat{}
			states[s.State] = st
			stateRegion[s.State] = s.Region
		}
		for _, x := range []*courierStat{cs, st} {
			x.shipments++
			if s.NDRAttempts > 0 {
				x.ndr++
			}
			if s.Status == model.OrderRTO {
				x.rto++
			}
			if s.DeliveredAt != nil {
				x.delivered++
				x.transit += s.DeliveredAt.Sub(*s.ShippedAt).Hours() / 24
				if !s.DeliveredAt.After(s.PromisedAt) {
					x.onTime++
				}
			}
		}
		if s.DeliveredAt != nil {
			cur.deliveredWithPromise++
			if !s.DeliveredAt.After(s.PromisedAt) {
				cur.onTime++
			}
			diff := s.DeliveredAt.Sub(s.PromisedAt).Hours() / 24
			switch {
			case diff <= -2:
				slaBins[0]++
			case diff <= -1:
				slaBins[1]++
			case diff <= 0:
				slaBins[2]++
			case diff <= 1:
				slaBins[3]++
			case diff <= 2:
				slaBins[4]++
			default:
				slaBins[5]++
			}
		}
	}
	for _, rf := range ds.Refunds {
		if r.Contains(rf.CreatedAt) {
			cur.refunded += rf.Amount
		} else if r.PrevContains(rf.CreatedAt) {
			prev.refunded += rf.Amount
		}
	}

	sb.set("rtoRate", ratioSeries(sb.get("rto"), sb.get("closed"), 100))
	sb.set("rtoRateCod", ratioSeries(sb.get("rtoCod"), sb.get("closedCod"), 100))
	sb.set("rtoRatePrepaid", ratioSeries(sb.get("rtoPrepaid"), sb.get("closedPrepaid"), 100))
	sb.set("ndrRate", ratioSeries(sb.get("ndr"), sb.get("shipped"), 100))

	kpis := []KPI{
		NewKPI("orders", "Total orders", float64(cur.orders), float64(prev.orders), "number", "up"),
		NewKPI("delivered", "Delivered", float64(cur.delivered), float64(prev.delivered), "number", "up"),
		NewKPI("delayed", "Delayed", float64(cur.delayed), float64(prev.delayed), "number", "down"),
		NewKPI("ndr", "NDR", float64(cur.ndr), float64(prev.ndr), "number", "down"),
		NewKPI("rto", "RTO", float64(cur.rto), float64(prev.rto), "number", "down"),
		NewKPI("cancelled", "Cancelled", float64(cur.cancelled), float64(prev.cancelled), "number", "down"),
		NewKPI("returned", "Returned", float64(cur.returned), float64(prev.returned), "number", "down"),
		NewKPI("refunded", "Refunded", cur.refunded, prev.refunded, "currency", "down"),
	}
	kpis[0].Spark = sb.get("orders")
	kpis[1].Spark = sb.get("delivered")
	kpis[3].Spark = sb.get("ndr")
	kpis[4].Spark = sb.get("rto")

	statusLabels := []struct{ key, label string }{
		{model.OrderDelivered, "Delivered"}, {model.OrderShipped, "In transit"}, {model.OrderProcessing, "Processing"},
		{model.OrderNDR, "NDR"}, {model.OrderRTO, "RTO"}, {model.OrderReturned, "Returned"}, {model.OrderCancelled, "Cancelled"},
	}
	var statusMix []H
	for _, s := range statusLabels {
		statusMix = append(statusMix, H{"status": s.key, "label": s.label, "count": status[s.key]})
	}

	var courierRows []H
	for name, cs := range couriers {
		courierRows = append(courierRows, H{
			"courier": name, "shipments": cs.shipments,
			"onTimeRate":     analytics.Round(cs.onTimeRate()*100, 1),
			"avgTransitDays": analytics.Round(analytics.Ratio(cs.transit, float64(cs.delivered)), 1),
			"ndrRate":        analytics.Round(analytics.Ratio(float64(cs.ndr), float64(cs.shipments))*100, 1),
			"rtoRate":        analytics.Round(analytics.Ratio(float64(cs.rto), float64(cs.shipments))*100, 1),
		})
	}
	sort.Slice(courierRows, func(i, j int) bool { return courierRows[i]["shipments"].(int) > courierRows[j]["shipments"].(int) })

	var stateRows []H
	for name, st := range states {
		stateRows = append(stateRows, H{
			"state": name, "region": stateRegion[name], "shipments": st.shipments,
			"onTimeRate":     analytics.Round(st.onTimeRate()*100, 1),
			"avgTransitDays": analytics.Round(analytics.Ratio(st.transit, float64(st.delivered)), 1),
			"rtoRate":        analytics.Round(analytics.Ratio(float64(st.rto), float64(st.shipments))*100, 1),
		})
	}
	sort.Slice(stateRows, func(i, j int) bool { return stateRows[i]["shipments"].(int) > stateRows[j]["shipments"].(int) })

	slaLabels := []string{"2+ days early", "1 day early", "On time", "1 day late", "2 days late", "3+ days late"}
	var sla []H
	for i, l := range slaLabels {
		sla = append(sla, H{"bucket": l, "count": slaBins[i], "late": i >= 3})
	}

	onTimeRate := analytics.Ratio(float64(cur.onTime), float64(cur.deliveredWithPromise))
	closedAll := float64(payment["cod"][0] + payment["prepaid"][0])
	rtoRate := analytics.Ratio(float64(payment["cod"][1]+payment["prepaid"][1]), closedAll)
	ndrRate := analytics.Ratio(float64(cur.ndr), float64(cur.orders))

	insights := ordersInsights(c)

	health := 0.45*analytics.Score(onTimeRate, 0.95, 0.7) + 0.35*analytics.Score(rtoRate, 0.04, 0.16) + 0.2*analytics.Score(ndrRate, 0.03, 0.12)
	healthPrev := ordersHealthWindow(c, c.Now.Add(-7*24*time.Hour))

	view := H{
		"kpis":      kpis,
		"trend":     sb.rows(),
		"statusMix": statusMix,
		"couriers":  courierRows,
		"states":    stateRows,
		"sla":       sla,
		"payment": []H{
			{"method": "COD", "closed": payment["cod"][0], "rto": payment["cod"][1], "rtoRate": analytics.Round(analytics.Ratio(float64(payment["cod"][1]), float64(payment["cod"][0]))*100, 1)},
			{"method": "Prepaid", "closed": payment["prepaid"][0], "rto": payment["prepaid"][1], "rtoRate": analytics.Round(analytics.Ratio(float64(payment["prepaid"][1]), float64(payment["prepaid"][0]))*100, 1)},
		},
		"rates": H{"onTime": analytics.Round(onTimeRate*100, 1), "rto": analytics.Round(rtoRate*100, 1), "ndr": analytics.Round(ndrRate*100, 1)},
		"healthBreakdown": []H{
			{"label": "On-time delivery", "score": math.Round(analytics.Score(onTimeRate, 0.95, 0.7))},
			{"label": "RTO control", "score": math.Round(analytics.Score(rtoRate, 0.04, 0.16))},
			{"label": "NDR control", "score": math.Round(analytics.Score(ndrRate, 0.03, 0.12))},
		},
	}
	changes := []Change{}
	for _, k := range kpis {
		changes = append(changes, ChangeFromKPI(k))
	}
	sum := summarize(OrdersMeta, now, health, healthPrev, insights, Headline{Label: "On-time delivery", Value: analytics.Round(onTimeRate*100, 1), Unit: "percent"}, cur.orders+len(ds.Shipments))
	return Result{Summary: sum, Insights: insights, Changes: changes, View: view, Activity: scanActivity(c, OrdersMeta.ID, "orders")}
}

func ordersHealthWindow(c *Ctx, end time.Time) float64 {
	from := end.Add(-30 * 24 * time.Hour)
	var delivered, onTime, closed, rto, orders, ndr float64
	for i := range c.DS.Orders {
		o := &c.DS.Orders[i]
		if o.CreatedAt.Before(from) || !o.CreatedAt.Before(end) {
			continue
		}
		orders++
		s := c.DS.ShipByOrder[o.ID]
		if s == nil {
			continue
		}
		if s.NDRAttempts > 0 {
			ndr++
		}
		if s.DeliveredAt != nil && s.DeliveredAt.Before(end) {
			delivered++
			closed++
			if !s.DeliveredAt.After(s.PromisedAt) {
				onTime++
			}
		}
		if s.Status == model.OrderRTO {
			closed++
			rto++
		}
	}
	return 0.45*analytics.Score(onTime/math.Max(delivered, 1), 0.95, 0.7) + 0.35*analytics.Score(rto/math.Max(closed, 1), 0.04, 0.16) + 0.2*analytics.Score(ndr/math.Max(orders, 1), 0.03, 0.12)
}

func ordersInsights(c *Ctx) []Insight {
	ds, now := c.DS, c.Now
	var out []Insight

	// 1. Courier × region deterioration. Shipments are grouped by their
	// promised date so that only shipments with a known SLA outcome count:
	// last 12 days vs the 60 days before. Undelivered overdue shipments are late.
	recent := analytics.LastDays(now, 12)
	base := recent.Before(60)
	type key struct{ courier, region string }
	stats := map[key]*[2]courierStat{}
	for i := range ds.Shipments {
		s := &ds.Shipments[i]
		if s.ShippedAt == nil || s.PromisedAt.After(now) {
			continue
		}
		k := key{s.Courier, s.Region}
		if stats[k] == nil {
			stats[k] = &[2]courierStat{}
		}
		idx := -1
		if recent.Contains(s.PromisedAt) {
			idx = 0
		} else if base.Contains(s.PromisedAt) {
			idx = 1
		}
		if idx < 0 {
			continue
		}
		st := &stats[k][idx]
		st.shipments++
		if s.NDRAttempts > 0 {
			st.ndr++
		}
		if s.Status == model.OrderRTO {
			st.rto++
			continue
		}
		st.delivered++
		if s.DeliveredAt != nil {
			st.transit += s.DeliveredAt.Sub(*s.ShippedAt).Hours() / 24
			if !s.DeliveredAt.After(s.PromisedAt) {
				st.onTime++
			}
		}
	}
	var worst key
	worstDrop, worstZ := 0.0, 0.0
	for k, v := range stats {
		if v[0].delivered < 20 || v[1].delivered < 50 {
			continue
		}
		drop := v[1].onTimeRate() - v[0].onTimeRate()
		// Significance: a two-proportion z-test on late rates.
		z := analytics.ProportionZ(float64(v[0].delivered-v[0].onTime), float64(v[0].delivered), float64(v[1].delivered-v[1].onTime), float64(v[1].delivered))
		if z > 3 && drop > 0.12 && z*drop > worstZ {
			worstZ, worstDrop, worst = z*drop, drop, k
		}
	}
	if worstDrop > 0.1 {
		v := stats[worst]
		// Best alternative courier in the same region (recent window).
		bestAlt, bestRate := "", 0.0
		for k, s := range stats {
			if k.region == worst.region && k.courier != worst.courier && s[0].delivered >= 15 && s[0].onTimeRate() > bestRate {
				bestAlt, bestRate = k.courier, s[0].onTimeRate()
			}
		}
		affected := 0
		clusterTickets := 0
		for i := range ds.Shipments {
			s := &ds.Shipments[i]
			if s.Courier == worst.courier && s.Region == worst.region && recent.Contains(ds.OrderByID[s.OrderID].CreatedAt) && IsDelayed(s, now) {
				affected++
			}
		}
		for _, t := range ds.Tickets {
			if recent.Contains(t.CreatedAt) && (t.Category == "Delivery delay" || t.Category == "Failed delivery attempt") {
				if s := ds.ShipByOrder[t.OrderID]; s != nil && s.Courier == worst.courier && s.Region == worst.region {
					clusterTickets++
				}
			}
		}
		curOT, baseOT := v[0].onTimeRate()*100, v[1].onTimeRate()*100
		ndrCur := analytics.Ratio(float64(v[0].ndr), float64(v[0].shipments)) * 100
		ndrBase := analytics.Ratio(float64(v[1].ndr), float64(v[1].shipments)) * 100
		ndrClause := ""
		if ndrCur > ndrBase+0.5 {
			ndrClause = fmt.Sprintf(", and failed delivery attempts rose from %.1f%% to %.1f%%", ndrBase, ndrCur)
		} else if v[0].delivered > 0 && v[1].delivered > 0 {
			tc, tb := analytics.Ratio(v[0].transit, float64(v[0].delivered)), analytics.Ratio(v[1].transit, float64(v[1].delivered))
			if tc > tb {
				ndrClause = fmt.Sprintf(", with average transit stretching from %.1f to %.1f days", tb, tc)
			}
		}
		sev := SevImportant
		if worstDrop > 0.2 {
			sev = SevCritical
		}
		avgOrder := 0.0
		n := 0.0
		for i := range ds.Orders {
			if recent.Contains(ds.Orders[i].CreatedAt) {
				avgOrder += ds.Orders[i].Total
				n++
			}
		}
		avgOrder /= math.Max(n, 1)
		monthlyShip := float64(v[0].shipments) / 12 * 30
		rtoExtra := math.Max(0, analytics.Ratio(float64(v[0].rto), float64(v[0].shipments))-analytics.Ratio(float64(v[1].rto), float64(v[1].shipments)))
		// RTO losses (forward + reverse shipping, handling) plus cancellation risk on delayed orders.
		impact := -(monthlyShip*rtoExtra*(avgOrder*0.35+140) + float64(affected)/12*30*avgOrder*0.12)
		id := stableID("orders", "courier", worst.courier, worst.region)
		rec := fmt.Sprintf("Temporarily route %s-region shipments away from %s", worst.region, worst.courier)
		if bestAlt != "" {
			rec += fmt.Sprintf(" to %s (%.0f%% on-time in the same region)", bestAlt, bestRate*100)
		}
		rec += ", and proactively notify customers with delayed orders."
		out = append(out, Insight{
			ID: id, AgentID: "orders", Severity: sev,
			Title:   fmt.Sprintf("%s delivery performance collapsed in the %s region", worst.courier, worst.region),
			Summary: fmt.Sprintf("On-time delivery for %s shipments to the %s fell from %.0f%% to %.0f%% over the last 12 days%s. Other couriers in the region are unaffected.", worst.courier, worst.region, baseOT, curOT, ndrClause),
			Evidence: []Evidence{
				EvC("On-time delivery", Pct1(curOT), curOT-baseOT, "pts", "bad"),
				EvC("NDR rate", Pct1(ndrCur), ndrCur-ndrBase, "pts", "bad"),
				Ev("Delayed orders now", Num(float64(affected))),
				Ev("Related support tickets", Num(float64(clusterTickets))),
			},
			LikelyCause:    fmt.Sprintf("Hub congestion on %s's %s network — the drop is isolated to this courier and region; other couriers in the region are unaffected.", worst.courier, worst.region),
			Impact:         fmt.Sprintf("%s/month in RTO losses and reshipping if unresolved", INR(-impact)),
			ImpactValue:    impact,
			Recommendation: rec,
			Actions: []Action{
				{Label: "Investigate", Intent: "investigate", Href: fmt.Sprintf("/agents/orders?tab=data&courier=%s&region=%s", worst.courier, worst.region)},
				{Label: "View delayed orders", Intent: "view", Href: fmt.Sprintf("/agents/orders?tab=data&courier=%s&region=%s&risk=high", worst.courier, worst.region)},
			},
			Entity:     &EntityRef{Type: "courier", ID: worst.courier, Name: worst.courier + " · " + worst.region},
			DetectedAt: detectedAt(now, id, 90), Confidence: 0.92,
		})
	}

	// 2. RTO trend: last 7 days vs previous 21 days, decomposed by payment method.
	w7 := analytics.LastDays(now, 7)
	w21 := w7.Before(21)
	var rto [2][2]float64       // [window][closed, rto]
	var rtoPay [2][2][2]float64 // [window][cod?][closed, rto]
	for i := range ds.Shipments {
		s := &ds.Shipments[i]
		o := ds.OrderByID[s.OrderID]
		wi := -1
		if w7.Contains(o.CreatedAt) {
			wi = 0
		} else if w21.Contains(o.CreatedAt) {
			wi = 1
		}
		if wi < 0 || s.ShippedAt == nil {
			continue
		}
		pi := 0
		if o.PaymentMethod == "cod" {
			pi = 1
		}
		rto[wi][0]++
		rtoPay[wi][pi][0]++
		if s.Status == model.OrderRTO {
			rto[wi][1]++
			rtoPay[wi][pi][1]++
		}
	}
	rCur, rBase := analytics.Ratio(rto[0][1], rto[0][0])*100, analytics.Ratio(rto[1][1], rto[1][0])*100
	if ch := analytics.Pct(rCur, rBase); ch > 8 {
		codCur := analytics.Ratio(rtoPay[0][1][1], rtoPay[0][1][0]) * 100
		codBase := analytics.Ratio(rtoPay[1][1][1], rtoPay[1][1][0]) * 100
		preCur := analytics.Ratio(rtoPay[0][0][1], rtoPay[0][0][0]) * 100
		codShare := analytics.Ratio(rtoPay[0][1][1], rto[0][1]) * 100
		id := stableID("orders", "rto-trend")
		monthly := (rCur - rBase) / 100 * rto[0][0] / 7 * 30
		out = append(out, Insight{
			ID: id, AgentID: "orders", Severity: SevImportant,
			Title:   fmt.Sprintf("RTO rate increased %.0f%% this week", ch),
			Summary: fmt.Sprintf("%.1f%% of shipped orders from the last 7 days are returning to origin versus %.1f%% in the prior three weeks. COD orders account for %.0f%% of RTOs.", rCur, rBase, codShare),
			Evidence: []Evidence{
				EvC("RTO rate (7d)", Pct1(rCur), rCur-rBase, "pts", "bad"),
				EvC("COD RTO rate", Pct1(codCur), codCur-codBase, "pts", "bad"),
				Ev("Prepaid RTO rate", Pct1(preCur)),
				Ev("COD share of RTO", Pct1(codShare)),
			},
			LikelyCause:    "Rising COD refusals at the doorstep, concentrated in regions with weaker courier performance.",
			Impact:         fmt.Sprintf("≈%s extra RTOs per month at the current rate", Num(monthly)),
			ImpactValue:    -monthly * 420,
			Recommendation: "Add OTP/IVR confirmation for COD orders above ₹1,500 and offer a small prepaid incentive in high-RTO regions.",
			Actions: []Action{
				{Label: "Investigate", Intent: "investigate", Href: "/agents/orders?tab=overview#rto"},
				{Label: "View RTO orders", Intent: "view", Href: "/agents/orders?tab=data&status=rto"},
			},
			DetectedAt: detectedAt(now, id, 200), Confidence: 0.84,
		})
	}

	// 3. High-value orders currently delayed.
	var hv []*model.Order
	hvValue := 0.0
	for i := range ds.Orders {
		o := &ds.Orders[i]
		s := ds.ShipByOrder[o.ID]
		if s == nil || s.DeliveredAt != nil || o.Status == model.OrderRTO || o.Status == model.OrderCancelled {
			continue
		}
		if now.After(s.PromisedAt) && o.Total >= 2500 {
			hv = append(hv, o)
			hvValue += o.Total
		}
	}
	if len(hv) > 0 {
		id := stableID("orders", "hv-delayed")
		ndrN := 0
		for _, o := range hv {
			if o.Status == model.OrderNDR {
				ndrN++
			}
		}
		out = append(out, Insight{
			ID: id, AgentID: "orders", Severity: SevImportant,
			Title:   fmt.Sprintf("%d high-value orders are delayed", len(hv)),
			Summary: fmt.Sprintf("%d orders worth %s have passed their promised delivery date and are still undelivered; %d %s stuck in NDR.", len(hv), INR(hvValue), ndrN, map[bool]string{true: "is", false: "are"}[ndrN == 1]),
			Evidence: []Evidence{
				Ev("Orders past SLA", Num(float64(len(hv)))),
				Ev("Order value at risk", INR(hvValue)),
				Ev("Stuck in NDR", Num(float64(ndrN))),
			},
			LikelyCause:    "Courier delays and failed delivery attempts.",
			Impact:         fmt.Sprintf("%s in order value at risk of cancellation or RTO", INR(hvValue)),
			ImpactValue:    -hvValue * 0.3,
			Recommendation: "Escalate these shipments with the courier and send a proactive delay message with a revised ETA.",
			Actions: []Action{
				{Label: "View orders", Intent: "view", Href: "/agents/orders?tab=data&risk=high"},
				{Label: "Assign", Intent: "assign"},
			},
			DetectedAt: detectedAt(now, id, 60), Confidence: 0.97,
		})
	}

	// 4. NDR backlog awaiting re-attempt.
	pendingNDR := 0
	for i := range ds.Orders {
		if ds.Orders[i].Status == model.OrderNDR {
			pendingNDR++
		}
	}
	if pendingNDR > 0 {
		id := stableID("orders", "ndr-pending")
		out = append(out, Insight{
			ID: id, AgentID: "orders", Severity: SevInfo,
			Title:          fmt.Sprintf("%d shipments are awaiting a delivery re-attempt", pendingNDR),
			Summary:        "These customers missed a delivery attempt. Re-attempts within 24 hours convert 2–3× better than later ones.",
			Evidence:       []Evidence{Ev("Pending NDR", Num(float64(pendingNDR)))},
			Recommendation: "Trigger WhatsApp NDR confirmation so customers can pick a re-attempt slot.",
			Actions:        []Action{{Label: "View NDR orders", Intent: "view", Href: "/agents/orders?tab=data&status=ndr"}},
			DetectedAt:     detectedAt(now, id, 300), Confidence: 0.99,
		})
	}
	sortInsights(out)
	return out
}
