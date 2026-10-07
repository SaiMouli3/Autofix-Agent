package agents

import (
	"fmt"
	"math"
	"strings"
	"time"
)

var InsightsMeta = Meta{
	ID: "insights", Name: "Business Insights Agent", ShortName: "Business Insights", Icon: "sparkles",
	Question:         "What should I do next?",
	Description:      "The CEO-level layer. Connects findings across every agent, reasons about cause and effect, prioritises by business impact and recommends what to do next.",
	DataSources:      []string{"All agent findings"},
	Responsibilities: []string{"Connect signals across agents", "Root-cause reasoning", "Prioritisation by impact", "Next best actions"},
}

// BusinessInsight is a cross-agent finding with an explicit reasoning chain.
type BusinessInsight struct {
	Insight
	Observation    string   `json:"observation"`
	Chain          []Step   `json:"chain"` // evidence from each contributing agent
	WhyChanged     string   `json:"whyChanged"`
	Category       string   `json:"category"` // what-changed | opportunity | risk
	SourceInsights []string `json:"sourceInsights"`
}

type Step struct {
	AgentID   string `json:"agentId"`
	InsightID string `json:"insightId"`
	Finding   string `json:"finding"`
}

func findInsight(results map[string]*Result, agent string, pred func(Insight) bool) *Insight {
	r := results[agent]
	if r == nil {
		return nil
	}
	for i := range r.Insights {
		if pred(r.Insights[i]) {
			return &r.Insights[i]
		}
	}
	return nil
}

func entityIs(id string) func(Insight) bool {
	return func(in Insight) bool { return in.Entity != nil && in.Entity.ID == id }
}

func firstChange(in *Insight) string {
	for _, e := range in.Evidence {
		if e.Change != nil && e.Unit == "pct" {
			return fmt.Sprintf("%+.0f%%", *e.Change)
		}
	}
	for _, e := range in.Evidence {
		if e.Change != nil {
			return fmt.Sprintf("%+.1f pts", *e.Change)
		}
	}
	return ""
}

// AnalyzeBusiness correlates findings across agents. It never re-derives a
// domain metric — it only reasons over what the domain agents found.
func AnalyzeBusiness(c *Ctx, results map[string]*Result) (Result, []BusinessInsight) {
	now := c.Now
	var out []BusinessInsight
	used := map[string]bool{}

	// 1. Product quality issue = product returns + review surge + complaint cluster.
	if pr := findInsight(results, "products", func(in Insight) bool {
		return in.Severity == SevCritical && in.Entity != nil && in.Entity.Type == "product"
	}); pr != nil {
		pid := pr.Entity.ID
		rv := findInsight(results, "reviews", entityIs(pid))
		sp := findInsight(results, "support", entityIs(pid))
		if rv != nil || sp != nil {
			chain := []Step{{AgentID: "products", InsightID: pr.ID, Finding: pr.Title}}
			ev := []Evidence{}
			for _, e := range pr.Evidence {
				if e.Label == "Returns (14d)" {
					ev = append(ev, EvC("Returns", e.Value, *e.Change, "pct", "bad"))
				}
			}
			srcs := []string{pr.ID}
			if rv != nil {
				chain = append(chain, Step{AgentID: "reviews", InsightID: rv.ID, Finding: rv.Title})
				srcs = append(srcs, rv.ID)
				for _, e := range rv.Evidence {
					if e.Label == "Negative review share" {
						ev = append(ev, EvC("Negative review share", e.Value, *e.Change, "pts", "bad"))
					}
				}
			}
			if sp != nil {
				chain = append(chain, Step{AgentID: "support", InsightID: sp.ID, Finding: sp.Title})
				srcs = append(srcs, sp.ID)
				ev = append(ev, Ev("Complaints in cluster", sp.Evidence[0].Value))
			}
			for _, s := range srcs {
				used[s] = true
			}
			impact := pr.ImpactValue
			if rv != nil {
				impact += rv.ImpactValue
			}
			supplier := ""
			if p := c.DS.ProductByID[pid]; p != nil {
				supplier = p.Supplier
			}
			id := stableID("insights", "quality", pid)
			out = append(out, BusinessInsight{
				Insight: Insight{
					ID: id, AgentID: "insights", Severity: SevCritical,
					Title:    fmt.Sprintf("Potential product-quality issue: %s", pr.Entity.Name),
					Summary:  fmt.Sprintf("Three independent signals point to the same product over the same 14 days: returns are up, negative reviews describe fit and fabric problems, and support is handling a cluster of identical complaints."),
					Evidence: ev, LikelyCause: pr.LikelyCause,
					Impact:         fmt.Sprintf("%s/month estimated revenue impact (refunds + lost conversion)", USD(-impact)),
					ImpactValue:    impact,
					Recommendation: fmt.Sprintf("Investigate the latest supplier batch from %s and pause paid promotion of this product until QC clears it.%s", supplier, map[bool]string{true: " Update size guidance on the listing today.", false: ""}[strings.Contains(pr.LikelyCause, "Size")]),
					Actions: []Action{
						{Label: "Investigate", Intent: "investigate", Href: "/agents/products?product=" + pid},
						{Label: "Assign", Intent: "assign"},
						{Label: "Dismiss", Intent: "dismiss"},
					},
					Entity: pr.Entity, DetectedAt: now.Add(-6 * time.Minute), Confidence: 0.94,
					Sources: []string{"products", "reviews", "support"},
				},
				Observation:    pr.Title,
				Chain:          chain,
				WhyChanged:     "Returns, reviews and complaints moved together on one SKU — consistent with a batch-level defect, not demand or service issues.",
				Category:       "risk",
				SourceInsights: srcs,
			})
		}
	}

	// 2. Delivery: courier collapse + delivery complaint cluster (+ RTO trend).
	if od := findInsight(results, "orders", func(in Insight) bool { return in.Entity != nil && in.Entity.Type == "courier" }); od != nil {
		sp := findInsight(results, "support", func(in Insight) bool { return strings.Contains(in.Summary, od.Entity.ID) })
		rto := findInsight(results, "orders", func(in Insight) bool { return strings.HasPrefix(in.Title, "RTO rate") })
		mk := findInsight(results, "market", func(in Insight) bool {
			return strings.Contains(in.Title, "Logistics") || strings.Contains(in.Summary, "carriers")
		})
		chain := []Step{{AgentID: "orders", InsightID: od.ID, Finding: od.Title}}
		srcs := []string{od.ID}
		ev := append([]Evidence{}, od.Evidence[:2]...)
		if sp != nil {
			chain = append(chain, Step{AgentID: "support", InsightID: sp.ID, Finding: sp.Title})
			srcs = append(srcs, sp.ID)
			ev = append(ev, Ev("Delivery complaints", sp.Evidence[0].Value))
		}
		if rto != nil {
			chain = append(chain, Step{AgentID: "orders", InsightID: rto.ID, Finding: rto.Title})
			srcs = append(srcs, rto.ID)
			ev = append(ev, rto.Evidence[0])
		}
		if mk != nil {
			chain = append(chain, Step{AgentID: "market", InsightID: mk.ID, Finding: mk.Title})
			srcs = append(srcs, mk.ID)
		}
		for _, s := range srcs {
			used[s] = true
		}
		id := stableID("insights", "delivery", od.Entity.ID)
		impact := od.ImpactValue
		if rto != nil {
			impact += rto.ImpactValue * 0.5
		}
		out = append(out, BusinessInsight{
			Insight: Insight{
				ID: id, AgentID: "insights", Severity: SevCritical,
				Title:    fmt.Sprintf("Courier failure is driving delays, complaints and RTO in one region"),
				Summary:  fmt.Sprintf("%s The same window shows delivery complaints and a rising RTO rate%s.", od.Summary, map[bool]string{true: ", and industry news confirms capacity issues in the region", false: ""}[mk != nil]),
				Evidence: ev, LikelyCause: od.LikelyCause,
				Impact:         fmt.Sprintf("%s/month in RTO losses, reshipping and churn risk", USD(-impact)),
				ImpactValue:    impact,
				Recommendation: od.Recommendation,
				Actions: []Action{
					{Label: "Investigate", Intent: "investigate", Href: od.Actions[0].Href},
					{Label: "Assign", Intent: "assign"},
					{Label: "Dismiss", Intent: "dismiss"},
				},
				Entity: od.Entity, DetectedAt: now.Add(-11 * time.Minute), Confidence: 0.9,
				Sources: []string{"orders", "support", "market"},
			},
			Observation:    od.Title,
			Chain:          chain,
			WhyChanged:     "Performance degraded for one courier in one region while other couriers held steady — an isolated network problem.",
			Category:       "risk",
			SourceInsights: srcs,
		})
	}

	// 3. Marketing inefficiency eroding margin.
	if mk := findInsight(results, "marketing", func(in Insight) bool { return in.Severity == SevCritical || in.Severity == SevImportant }); mk != nil {
		fin := findInsight(results, "finance", func(in Insight) bool { return strings.Contains(in.Title, "margin") })
		chain := []Step{{AgentID: "marketing", InsightID: mk.ID, Finding: mk.Title}}
		srcs := []string{mk.ID}
		ev := append([]Evidence{}, mk.Evidence[:2]...)
		if fin != nil {
			chain = append(chain, Step{AgentID: "finance", InsightID: fin.ID, Finding: fin.Title})
			srcs = append(srcs, fin.ID)
			ev = append(ev, fin.Evidence[1])
		}
		for _, s := range srcs {
			used[s] = true
		}
		id := stableID("insights", "marketing-margin")
		out = append(out, BusinessInsight{
			Insight: Insight{
				ID: id, AgentID: "insights", Severity: SevImportant,
				Title:    "Rising ad spend on a fatigued campaign is eroding margin",
				Summary:  mk.Summary,
				Evidence: ev, LikelyCause: mk.LikelyCause,
				Impact: mk.Impact, ImpactValue: mk.ImpactValue,
				Recommendation: mk.Recommendation,
				Actions:        []Action{{Label: "Investigate", Intent: "investigate", Href: mk.Actions[0].Href}, {Label: "Assign", Intent: "assign"}, {Label: "Dismiss", Intent: "dismiss"}},
				Entity:         mk.Entity, DetectedAt: now.Add(-23 * time.Minute), Confidence: 0.86,
				Sources: []string{"marketing", "finance"},
			},
			Observation: mk.Title, Chain: chain,
			WhyChanged: "Spend scaled after the festive peak while purchase intent fell, so each dollar buys fewer orders.",
			Category:   "risk", SourceInsights: srcs,
		})
	}

	// 4. Stockout on a growing product.
	if inv := findInsight(results, "inventory", func(in Insight) bool { return in.Severity == SevCritical }); inv != nil {
		chain := []Step{{AgentID: "inventory", InsightID: inv.ID, Finding: inv.Title}}
		srcs := []string{inv.ID}
		if pr := findInsight(results, "products", entityIs(inv.Entity.ID)); pr != nil {
			chain = append(chain, Step{AgentID: "products", InsightID: pr.ID, Finding: pr.Title})
			srcs = append(srcs, pr.ID)
		}
		for _, s := range srcs {
			used[s] = true
		}
		id := stableID("insights", "stockout", inv.Entity.ID)
		out = append(out, BusinessInsight{
			Insight: Insight{
				ID: id, AgentID: "insights", Severity: SevCritical,
				Title:    fmt.Sprintf("A best-seller is about to stock out: %s", inv.Entity.Name),
				Summary:  inv.Summary,
				Evidence: inv.Evidence, LikelyCause: inv.LikelyCause,
				Impact: inv.Impact, ImpactValue: inv.ImpactValue,
				Recommendation: inv.Recommendation,
				Actions:        []Action{{Label: "Create purchase order", Intent: "apply"}, {Label: "Assign", Intent: "assign"}, {Label: "Dismiss", Intent: "dismiss"}},
				Entity:         inv.Entity, DetectedAt: inv.DetectedAt, Confidence: 0.91,
				Sources: []string{"inventory", "products"},
			},
			Observation: inv.Title, Chain: chain,
			WhyChanged: "Demand accelerated while the replenishment plan stayed on the old run-rate.",
			Category:   "risk", SourceInsights: srcs,
		})
	}

	// 5. Competitor price move on a key product.
	if pc := findInsight(results, "pricing", func(in Insight) bool { return in.Severity == SevMarket }); pc != nil {
		chain := []Step{{AgentID: "pricing", InsightID: pc.ID, Finding: pc.Title}}
		srcs := []string{pc.ID}
		if mk := findInsight(results, "market", func(in Insight) bool { return strings.Contains(in.Title, "cuts prices") }); mk != nil {
			chain = append(chain, Step{AgentID: "market", InsightID: mk.ID, Finding: mk.Title})
			srcs = append(srcs, mk.ID)
		}
		for _, s := range srcs {
			used[s] = true
		}
		id := stableID("insights", "pricing", pc.Entity.ID)
		out = append(out, BusinessInsight{
			Insight: Insight{
				ID: id, AgentID: "insights", Severity: SevImportant,
				Title:    pc.Title,
				Summary:  pc.Summary,
				Evidence: pc.Evidence, LikelyCause: pc.LikelyCause,
				Impact: pc.Impact, ImpactValue: pc.ImpactValue,
				Recommendation: pc.Recommendation,
				Actions:        []Action{{Label: "Review pricing", Intent: "investigate", Href: pc.Actions[0].Href}, {Label: "Assign", Intent: "assign"}, {Label: "Dismiss", Intent: "dismiss"}},
				Entity:         pc.Entity, DetectedAt: pc.DetectedAt, Confidence: pc.Confidence,
				Sources: []string{"pricing", "market"},
			},
			Observation: pc.Title, Chain: chain,
			WhyChanged: "A competitor reset its price permanently — not a short promotion — on a direct substitute.",
			Category:   "what-changed", SourceInsights: srcs,
		})
	}

	// 6. Opportunity: repurchase-ready customers via the highest-ROAS owned channel.
	if cu := findInsight(results, "customers", func(in Insight) bool { return in.Severity == SevOpportunity }); cu != nil {
		chain := []Step{{AgentID: "customers", InsightID: cu.ID, Finding: cu.Title}}
		srcs := []string{cu.ID}
		best := ""
		if m := results["marketing"]; m != nil {
			bestRoas := 0.0
			for _, ch := range m.View["channels"].([]H) {
				if (ch["channel"] == "whatsapp" || ch["channel"] == "email") && ch["roas"].(float64) > bestRoas {
					bestRoas = ch["roas"].(float64)
					best = fmt.Sprintf("%s (%.0fx ROAS)", ch["label"], bestRoas)
				}
			}
		}
		for _, s := range srcs {
			used[s] = true
		}
		id := stableID("insights", "repurchase")
		rec := cu.Recommendation
		if best != "" {
			rec = fmt.Sprintf("Launch a 30-day repurchase journey on %s — your most efficient channel — targeting these customers by their last-purchased category.", best)
		}
		out = append(out, BusinessInsight{
			Insight: Insight{
				ID: id, AgentID: "insights", Severity: SevOpportunity,
				Title:    cu.Title,
				Summary:  cu.Summary,
				Evidence: cu.Evidence, Impact: cu.Impact, ImpactValue: cu.ImpactValue,
				Recommendation: rec,
				Actions:        []Action{{Label: "Create campaign", Intent: "apply"}, {Label: "Assign", Intent: "assign"}, {Label: "Dismiss", Intent: "dismiss"}},
				DetectedAt:     cu.DetectedAt, Confidence: cu.Confidence,
				Sources: []string{"customers", "marketing"},
			},
			Observation: cu.Title, Chain: chain,
			WhyChanged: "Many repeat customers have reached their personal reorder interval at the same time after the festive season.",
			Category:   "opportunity", SourceInsights: srcs,
		})
	}

	// Remaining high-value single-agent findings, promoted as-is.
	for _, aid := range AgentOrder {
		r := results[aid]
		if r == nil {
			continue
		}
		for _, in := range r.Insights {
			if used[in.ID] || in.Severity == SevInfo {
				continue
			}
			if in.Severity == SevMarket && in.AgentID == "market" {
				continue
			}
			cat := "risk"
			if in.Severity == SevOpportunity {
				cat = "opportunity"
			}
			x := in
			x.Sources = []string{in.AgentID}
			out = append(out, BusinessInsight{Insight: x, Observation: in.Title, Chain: []Step{{AgentID: in.AgentID, InsightID: in.ID, Finding: in.Title}},
				WhyChanged: in.LikelyCause, Category: cat, SourceInsights: []string{in.ID}})
		}
	}
	// Prioritise: severity then absolute $ impact.
	plain := make([]Insight, len(out))
	for i := range out {
		plain[i] = out[i].Insight
	}
	order := make([]int, len(out))
	for i := range order {
		order[i] = i
	}
	for i := 1; i < len(order); i++ {
		for j := i; j > 0; j-- {
			a, b := out[order[j-1]], out[order[j]]
			if severityRank[a.Severity] > severityRank[b.Severity] || (severityRank[a.Severity] == severityRank[b.Severity] && math.Abs(a.ImpactValue) < math.Abs(b.ImpactValue)) {
				order[j-1], order[j] = order[j], order[j-1]
			} else {
				break
			}
		}
	}
	sorted := make([]BusinessInsight, len(out))
	for i, k := range order {
		sorted[i] = out[k]
	}
	plain = plain[:0]
	for _, b := range sorted {
		plain = append(plain, b.Insight)
	}
	// Business health = weighted domain health.
	health := 0.0
	wsum := 0.0
	healthPrev := 0.0
	for id, w := range map[string]float64{"orders": 1, "customers": 1, "reviews": 0.7, "support": 0.6, "products": 1, "inventory": 0.8, "marketing": 1, "finance": 1.2} {
		if r := results[id]; r != nil {
			health += r.Summary.Health * w
			healthPrev += r.Summary.HealthPrev * w
			wsum += w
		}
	}
	health /= wsum
	healthPrev /= wsum
	critical := 0
	for _, b := range sorted {
		if b.Severity == SevCritical {
			critical++
		}
	}
	sum := summarize(InsightsMeta, now, health, healthPrev, plain, Headline{Label: "Critical issues", Value: float64(critical), Unit: "number"}, len(results))
	return Result{Summary: sum, Insights: plain, View: H{}, Activity: nil}, sorted
}
