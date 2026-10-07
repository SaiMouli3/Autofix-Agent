package agents

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

var SupportMeta = Meta{
	ID: "support", Name: "Complaint & Support Agent", ShortName: "Support", Icon: "headset",
	Question:    "What problems are customers reporting directly to us?",
	Description: "Owns direct support — tickets across WhatsApp, email and chat, complaints, escalations, SLAs and recurring root causes.",
	DataSources: []string{"Helpdesk tickets", "WhatsApp Business", "Support email", "Live chat"},
	Responsibilities: []string{"Support tickets", "WhatsApp, email & chat", "Complaints", "Escalations", "Unresolved issues",
		"Response time", "Support SLA", "Resolution rate", "Recurring complaints"},
}

const (
	SLAFirstResponseH = 2.0
	SLAResolutionH    = 48.0
)

func TicketSLABreached(t *model.Ticket, now time.Time) bool {
	fr := now
	if t.FirstResponseAt != nil {
		fr = *t.FirstResponseAt
	}
	if fr.Sub(t.CreatedAt).Hours() > SLAFirstResponseH {
		return true
	}
	rs := now
	if t.ResolvedAt != nil {
		rs = *t.ResolvedAt
	}
	return rs.Sub(t.CreatedAt).Hours() > SLAResolutionH
}

type cluster struct {
	Key       string
	Title     string
	Tickets   []*model.Ticket
	ProductID string
}

// ClusterComplaints groups recent complaints by shared underlying issue.
// Tickets carry a raw cluster key from triage; the remaining complaints are
// grouped by category + product.
func ClusterComplaints(ds *model.Dataset, w analytics.Window) []*cluster {
	m := map[string]*cluster{}
	for i := range ds.Tickets {
		t := &ds.Tickets[i]
		if !t.IsComplaint || !w.Contains(t.CreatedAt) {
			continue
		}
		key := t.ClusterKey
		if key == "" {
			key = t.Category + "|" + t.ProductID
			if t.Category == "Delivery delay" || t.Category == "Failed delivery attempt" || t.Category == "Payment issue" {
				key = t.Category
			}
		}
		c := m[key]
		if c == nil {
			c = &cluster{Key: key, ProductID: t.ProductID}
			m[key] = c
		}
		c.Tickets = append(c.Tickets, t)
	}
	var out []*cluster
	for _, c := range m {
		if len(c.Tickets) < 3 {
			continue
		}
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return len(out[i].Tickets) > len(out[j].Tickets) })
	for _, c := range out {
		c.Title = clusterTitle(ds, c)
	}
	return out
}

func clusterTitle(ds *model.Dataset, c *cluster) string {
	switch c.Key {
	case "quality-x":
		p := ds.ProductByID[c.Tickets[0].ProductID]
		sizing := 0
		for _, t := range c.Tickets {
			if t.Category == "Sizing issue" {
				sizing++
			}
		}
		if sizing*3 >= len(c.Tickets) {
			return fmt.Sprintf("%s — sizing runs small / fabric quality", p.Name)
		}
		return fmt.Sprintf("%s — product quality defects", p.Name)
	case "delivery-east-swiftline":
		return "Swiftline delays in the East region"
	}
	t := c.Tickets[0]
	switch t.Category {
	case "Delivery delay", "Failed delivery attempt", "Payment issue":
		return t.Category + " (multiple products)"
	}
	if p := ds.ProductByID[t.ProductID]; p != nil {
		return fmt.Sprintf("%s — %s", p.Name, lower(t.Category))
	}
	return t.Category
}

func AnalyzeSupport(c *Ctx) Result {
	ds, r, now := c.DS, c.R, c.Now
	sb := newSeries(r, "complaints", "inquiries", "resolved", "breaches")
	var cur, prev struct {
		n, open, resolved, escalated, breaches int
		frSum, rsSum                           float64
		frN, rsN                               int
	}
	cats := map[string]int{}
	channels := map[string]*[3]int{} // tickets, within SLA, first-response total minutes
	ageBins := map[string]int{"< 4h": 0, "4–24h": 0, "1–3 days": 0, "3+ days": 0}
	openByChannel := map[string]int{}
	for i := range ds.Tickets {
		t := &ds.Tickets[i]
		// Backlog is a point-in-time view.
		if t.Status != "resolved" {
			age := now.Sub(t.CreatedAt).Hours()
			switch {
			case age < 4:
				ageBins["< 4h"]++
			case age < 24:
				ageBins["4–24h"]++
			case age < 72:
				ageBins["1–3 days"]++
			default:
				ageBins["3+ days"]++
			}
			openByChannel[t.Channel]++
		}
		var bucket *struct {
			n, open, resolved, escalated, breaches int
			frSum, rsSum                           float64
			frN, rsN                               int
		}
		if r.Contains(t.CreatedAt) {
			bucket = &cur
			if t.IsComplaint {
				sb.add("complaints", t.CreatedAt, 1)
			} else {
				sb.add("inquiries", t.CreatedAt, 1)
			}
			cats[t.Category]++
			ch := channels[t.Channel]
			if ch == nil {
				ch = &[3]int{}
				channels[t.Channel] = ch
			}
			ch[0]++
			if !TicketSLABreached(t, now) {
				ch[1]++
			} else {
				sb.add("breaches", t.CreatedAt, 1)
			}
			if t.FirstResponseAt != nil {
				ch[2] += int(t.FirstResponseAt.Sub(t.CreatedAt).Minutes())
			}
			if t.Status == "resolved" {
				sb.add("resolved", t.CreatedAt, 1)
			}
		} else if r.PrevContains(t.CreatedAt) {
			bucket = &prev
		} else {
			continue
		}
		bucket.n++
		if t.Status != "resolved" {
			bucket.open++
		} else {
			bucket.resolved++
		}
		if t.Escalated {
			bucket.escalated++
		}
		if TicketSLABreached(t, now) {
			bucket.breaches++
		}
		if t.FirstResponseAt != nil {
			bucket.frSum += t.FirstResponseAt.Sub(t.CreatedAt).Hours()
			bucket.frN++
		}
		if t.ResolvedAt != nil {
			bucket.rsSum += t.ResolvedAt.Sub(t.CreatedAt).Hours()
			bucket.rsN++
		}
	}
	total := sb.get("complaints")
	inq := sb.get("inquiries")
	all := make([]float64, len(total))
	for i := range all {
		all[i] = total[i] + inq[i]
	}
	sb.set("resolutionRate", ratioSeries(sb.get("resolved"), all, 100))
	frAvg, frPrev := analytics.Ratio(cur.frSum, float64(cur.frN)), analytics.Ratio(prev.frSum, float64(prev.frN))
	rsAvg, rsPrev := analytics.Ratio(cur.rsSum, float64(cur.rsN)), analytics.Ratio(prev.rsSum, float64(prev.rsN))
	kpis := []KPI{
		NewKPI("open", "Open tickets", float64(cur.open), float64(prev.open), "number", "down"),
		NewKPI("resolved", "Resolved tickets", float64(cur.resolved), float64(prev.resolved), "number", "up"),
		NewKPI("firstResponse", "Avg. first response", frAvg, frPrev, "hours", "down"),
		NewKPI("resolution", "Avg. resolution time", rsAvg, rsPrev, "hours", "down"),
		NewKPI("escalations", "Escalations", float64(cur.escalated), float64(prev.escalated), "number", "down"),
		NewKPI("slaBreaches", "SLA breaches", float64(cur.breaches), float64(prev.breaches), "number", "down"),
	}
	kpis[0].Spark = all
	kpis[5].Spark = sb.get("breaches")

	var catRows []H
	for k, v := range cats {
		catRows = append(catRows, H{"category": k, "count": v})
	}
	sort.Slice(catRows, func(i, j int) bool { return catRows[i]["count"].(int) > catRows[j]["count"].(int) })
	var chRows []H
	for k, v := range channels {
		chRows = append(chRows, H{"channel": k, "tickets": v[0], "withinSla": analytics.Round(analytics.Ratio(float64(v[1]), float64(v[0]))*100, 1),
			"avgFirstResponseMin": analytics.Round(analytics.Ratio(float64(v[2]), float64(v[0])), 0), "open": openByChannel[k]})
	}
	sort.Slice(chRows, func(i, j int) bool { return chRows[i]["tickets"].(int) > chRows[j]["tickets"].(int) })
	var ageRows []H
	for _, k := range []string{"< 4h", "4–24h", "1–3 days", "3+ days"} {
		ageRows = append(ageRows, H{"age": k, "count": ageBins[k]})
	}

	clusters := ClusterComplaints(ds, analytics.LastDays(now, 21))
	var clusterRows []H
	for _, cl := range clusters {
		if len(clusterRows) >= 6 {
			break
		}
		clusterRows = append(clusterRows, clusterRow(ds, cl, now))
	}

	insights := supportInsights(c, clusters)
	slaRate := analytics.Ratio(float64(cur.n-cur.breaches), float64(cur.n)) * 100
	slaPrev := analytics.Ratio(float64(prev.n-prev.breaches), float64(prev.n)) * 100
	health := 0.45*analytics.Score(slaRate, 95, 70) + 0.3*analytics.Score(frAvg, 0.5, 4) + 0.25*analytics.Score(analytics.Ratio(float64(cur.escalated), float64(cur.n))*100, 3, 20)
	healthPrev := 0.45*analytics.Score(slaPrev, 95, 70) + 0.3*analytics.Score(frPrev, 0.5, 4) + 0.25*analytics.Score(analytics.Ratio(float64(prev.escalated), float64(prev.n))*100, 3, 20)
	view := H{
		"kpis": kpis, "trend": sb.rows(), "categories": catRows, "channels": chRows, "backlogAge": ageRows,
		"clusters": clusterRows, "sla": H{"firstResponseHours": SLAFirstResponseH, "resolutionHours": SLAResolutionH, "withinSla": analytics.Round(slaRate, 1)},
		"healthBreakdown": []H{
			{"label": "SLA compliance", "score": math.Round(analytics.Score(slaRate, 95, 70))},
			{"label": "Response speed", "score": math.Round(analytics.Score(frAvg, 0.5, 4))},
			{"label": "Escalation control", "score": math.Round(analytics.Score(analytics.Ratio(float64(cur.escalated), float64(cur.n))*100, 3, 20))},
		},
	}
	changes := []Change{}
	for _, k := range kpis {
		changes = append(changes, ChangeFromKPI(k))
	}
	sum := summarize(SupportMeta, now, health, healthPrev, insights, Headline{Label: "Within SLA", Value: analytics.Round(slaRate, 1), Unit: "percent"}, len(ds.Tickets))
	return Result{Summary: sum, Insights: insights, Changes: changes, View: view, Activity: scanActivity(c, SupportMeta.ID, "support")}
}

func clusterRow(ds *model.Dataset, cl *cluster, now time.Time) H {
	open, esc := 0, 0
	channels := map[string]int{}
	var samples []H
	for _, t := range cl.Tickets {
		if t.Status != "resolved" {
			open++
		}
		if t.Escalated {
			esc++
		}
		channels[t.Channel]++
	}
	sorted := append([]*model.Ticket(nil), cl.Tickets...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].CreatedAt.After(sorted[j].CreatedAt) })
	for _, t := range sorted {
		if len(samples) >= 4 {
			break
		}
		samples = append(samples, H{"id": t.ID, "subject": t.Subject, "message": t.Message, "channel": t.Channel, "createdAt": t.CreatedAt, "status": t.Status,
			"customer": ds.CustomerByID[t.CustomerID].Name})
	}
	cause := "Recurring issue reported across multiple customers."
	switch cl.Key {
	case "quality-x":
		cause = "Every ticket references the same product and describes the same defect pattern — consistent with a supplier batch change."
	case "delivery-east-swiftline":
		cause = "Tickets are concentrated on a single courier and region, starting at the same time — a courier network issue, not individual orders."
	}
	name := ""
	if p := ds.ProductByID[cl.ProductID]; p != nil {
		name = p.Name
	}
	return H{"key": cl.Key, "title": cl.Title, "count": len(cl.Tickets), "open": open, "escalated": esc, "channels": channels,
		"rootCause": cause, "samples": samples, "productId": cl.ProductID, "product": name, "category": cl.Tickets[0].Category}
}

func supportInsights(c *Ctx, clusters []*cluster) []Insight {
	ds, now := c.DS, c.Now
	var out []Insight
	reported := 0
	for _, cl := range clusters {
		// Only clusters with a shared root cause (triage key or one product)
		// are reported; generic category buckets are shown in the view only.
		generic := cl.Key == "Delivery delay" || cl.Key == "Failed delivery attempt" || cl.Key == "Payment issue"
		if generic || len(cl.Tickets) < 10 || reported >= 2 {
			continue
		}
		reported++
		row := clusterRow(ds, cl, now)
		id := stableID("support", "cluster", cl.Key)
		sev := SevImportant
		if len(cl.Tickets) >= 25 {
			sev = SevCritical
		}
		var ent *EntityRef
		if p := ds.ProductByID[cl.ProductID]; p != nil && cl.Key == "quality-x" {
			ent = &EntityRef{Type: "product", ID: p.ID, Name: p.Name}
		}
		out = append(out, Insight{
			ID: id, AgentID: "support", Severity: sev,
			Title:   fmt.Sprintf("%d complaints share the same underlying issue", len(cl.Tickets)),
			Summary: fmt.Sprintf("Cluster: %s. %d are still open and %d have been escalated.", cl.Title, row["open"], row["escalated"]),
			Evidence: []Evidence{
				Ev("Complaints in cluster (21d)", Num(float64(len(cl.Tickets)))),
				Ev("Still open", fmt.Sprint(row["open"])),
				Ev("Escalated", fmt.Sprint(row["escalated"])),
			},
			LikelyCause:    row["rootCause"].(string),
			Recommendation: "Fix the root cause once instead of resolving tickets one by one: publish a macro response, and route the cluster to the owning team.",
			Impact:         "Each unresolved complaint raises churn risk for that customer by roughly 2×",
			ImpactValue:    -float64(len(cl.Tickets)) * 2400,
			Actions: []Action{
				{Label: "Open cluster", Intent: "investigate", Href: "/agents/support?cluster=" + cl.Key},
				{Label: "Assign", Intent: "assign"},
			},
			Entity:     ent,
			DetectedAt: detectedAt(now, id, 150), Confidence: 0.88,
		})
	}
	// First-response time trend: last 7 days vs the prior 21.
	w := analytics.LastDays(now, 7)
	wb := w.Before(21)
	var fr [2]float64
	var n [2]float64
	var breaches [2]float64
	for i := range ds.Tickets {
		t := &ds.Tickets[i]
		wi := -1
		if w.Contains(t.CreatedAt) {
			wi = 0
		} else if wb.Contains(t.CreatedAt) {
			wi = 1
		}
		if wi < 0 {
			continue
		}
		n[wi]++
		if t.FirstResponseAt != nil {
			fr[wi] += t.FirstResponseAt.Sub(t.CreatedAt).Hours()
		}
		if TicketSLABreached(t, now) {
			breaches[wi]++
		}
	}
	frC, frB := analytics.Ratio(fr[0], n[0]), analytics.Ratio(fr[1], n[1])
	if ch := analytics.Pct(frC, frB); ch > 15 {
		id := stableID("support", "frt")
		out = append(out, Insight{
			ID: id, AgentID: "support", Severity: SevImportant,
			Title:   fmt.Sprintf("First response time is up %.0f%% this week", ch),
			Summary: fmt.Sprintf("Customers now wait %.1f hours on average for a first reply (was %.1f). Ticket volume rose %.0f%% over the same period.", frC, frB, analytics.Pct(n[0]/7, n[1]/21)),
			Evidence: []Evidence{
				EvC("Avg. first response", fmt.Sprintf("%.1fh", frC), ch, "pct", "bad"),
				EvC("Tickets per day", fmt.Sprintf("%.0f", n[0]/7), analytics.Pct(n[0]/7, n[1]/21), "pct", "bad"),
				Ev("SLA breaches (7d)", Num(breaches[0])),
			},
			LikelyCause:    "Volume from the two complaint clusters is crowding the queue.",
			Recommendation: "Deploy an instant WhatsApp auto-acknowledgement with order status for delivery and sizing tickets.",
			Actions:        []Action{{Label: "View open tickets", Intent: "view", Href: "/agents/support?tab=data&status=open"}},
			DetectedAt:     detectedAt(now, id, 260), Confidence: 0.86,
		})
	}
	sortInsights(out)
	return out
}
