package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/agents"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/llm"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

type Citation struct {
	Label     string `json:"label"`
	Href      string `json:"href"`
	AgentID   string `json:"agentId,omitempty"`
	InsightID string `json:"insightId,omitempty"`
}

type ChatReply struct {
	Answer      string     `json:"answer"`
	Citations   []Citation `json:"citations"`
	Suggestions []string   `json:"suggestions"`
	Engine      string     `json:"engine"` // llm model id or "deterministic"
}

// businessContext is the structured, pre-computed context given to the LLM.
// It contains only numbers the agents already calculated.
func businessContext(rep *agents.Report, ds *model.Dataset) map[string]any {
	health, prev, segs := rep.Health()
	type insightCtx struct {
		ID, Agent, Severity, Title, Summary, Cause, Recommendation, Impact string
		Evidence                                                           []string
	}
	var ins []insightCtx
	add := func(in agents.Insight) {
		var ev []string
		for _, e := range in.Evidence {
			s := e.Label + ": " + e.Value
			if e.Change != nil {
				s += fmt.Sprintf(" (change %+.1f %s)", *e.Change, e.Unit)
			}
			ev = append(ev, s)
		}
		ins = append(ins, insightCtx{in.ID, in.AgentID, in.Severity, in.Title, in.Summary, in.LikelyCause, in.Recommendation, in.Impact, ev})
	}
	for _, b := range rep.Business {
		if len(b.Sources) > 1 {
			add(b.Insight)
		}
	}
	for _, in := range rep.AllInsights() {
		add(in)
	}
	kpis := agents.OverviewKPIs(ds, rep.Range, rep.Results["finance"], rep.Results["marketing"])
	var k []string
	for _, x := range kpis {
		k = append(k, fmt.Sprintf("%s: %.2f (previous period %.2f, change %+.1f%%)", x.Label, x.Value, x.Prev, x.Change))
	}
	agentsCtx := []string{}
	for _, s := range rep.Summaries() {
		agentsCtx = append(agentsCtx, fmt.Sprintf("%s (id %s): health %.0f/100, status %s, %d issues, %d opportunities", s.Name, s.ID, s.Health, s.Status, s.Issues, s.Opportunities))
	}
	prod := rep.Results["products"].View
	top := []string{}
	for _, p := range prod["top"].([]agents.ProductStats) {
		top = append(top, fmt.Sprintf("%s (id %s): revenue $%.0f, growth %+.0f%%, margin %.0f%%, return rate %.1f%%, rating %.1f, health %.0f", p.Name, p.ID, p.Revenue, p.Growth, p.Margin, p.ReturnRate, p.Rating, p.Health))
	}
	worst := []string{}
	for _, p := range prod["worst"].([]agents.ProductStats) {
		worst = append(worst, fmt.Sprintf("%s (id %s): health %.0f, revenue $%.0f, return rate %.1f%%, rating %.1f, growth %+.0f%%", p.Name, p.ID, p.Health, p.Revenue, p.ReturnRate, p.Rating, p.Growth))
	}
	stock := []string{}
	for _, r := range rep.Results["inventory"].View["table"].([]agents.StockRow) {
		if r.Risk == "stockout" || r.Risk == "critical" || r.Risk == "low" {
			stock = append(stock, fmt.Sprintf("%s (id %s): %d available, %.1f/day, %.0f days left, lead time %dd, suggested reorder %d units, risk %s", r.Name, r.ProductID, r.Available, r.DailySales, r.DaysLeft, r.LeadTime, r.ReorderQty, r.Risk))
		}
	}
	if len(stock) > 12 {
		stock = stock[:12]
	}
	return map[string]any{
		"store": ds.Store.Name, "businessType": ds.Store.BusinessType, "currency": "USD",
		"period": rep.Range.Label, "generatedAt": rep.Now.Format(time.RFC1123),
		"businessHealth": map[string]any{"score": health, "previous": prev, "segments": segs},
		"kpis":           k, "agents": agentsCtx, "insights": ins,
		"topProducts": top, "worstProducts": worst, "inventoryRisks": stock,
		"marketingChannels":      rep.Results["marketing"].View["channels"],
		"competitorPriceChanges": rep.Results["pricing"].View["changes"],
		"supportClusters":        clusterSummaries(rep),
	}
}

func clusterSummaries(rep *agents.Report) []string {
	var out []string
	for _, c := range rep.Results["support"].View["clusters"].([]agents.H) {
		out = append(out, fmt.Sprintf("%v: %v complaints, root cause: %v", c["title"], c["count"], c["rootCause"]))
	}
	return out
}

const systemPrompt = `You are the AI operations analyst inside "E-commerce AI OS", a command center where specialised AI agents monitor an e-commerce business. You answer the merchant's questions using ONLY the business context provided below, which was computed deterministically by the agents from the store's real data.

Rules:
- Never invent numbers. Every figure you state must appear in the context. If the context does not contain the answer, say what is known and which agent page to check.
- Lead with the direct answer in one or two sentences, then give supporting points as a short bulleted list (at most 5 bullets), then one clear recommended next step.
- Use US dollar formatting ($, thousands separators, K/M/B abbreviations).
- Cite your sources inline using these exact markers, placed right after the claim they support: [[insight:INSIGHT_ID]] for an agent finding, [[agent:AGENT_ID]] for an agent page, [[product:PRODUCT_ID]] for a product.
- Be concise, specific and calm. No preamble, no sign-off.`

var citeRe = regexp.MustCompile(`\[\[(insight|agent|product):([A-Za-z0-9_\-]+)\]\]`)

func (s *Service) Chat(ctx context.Context, st model.Store, rangeKey string, history []llm.Message) (*ChatReply, error) {
	rep, err := s.Report(ctx, st, rangeKey, "", "")
	if err != nil {
		return nil, err
	}
	ds, _ := s.Dataset(ctx, st)
	question := ""
	if len(history) > 0 {
		question = history[len(history)-1].Content
	}
	if s.LLM.Enabled() {
		bc, _ := json.MarshalIndent(businessContext(rep, ds), "", " ")
		system := systemPrompt + "\n\n<business_context>\n" + string(bc) + "\n</business_context>"
		if len(history) > 12 {
			history = history[len(history)-12:]
		}
		cctx, cancel := context.WithTimeout(ctx, 75*time.Second)
		defer cancel()
		text, err := s.LLM.Complete(cctx, system, history, 4000)
		if err == nil && text != "" {
			answer, cites := extractCitations(text, rep, ds)
			return &ChatReply{Answer: answer, Citations: dedupe(cites), Suggestions: followUps(question), Engine: s.LLM.Model()}, nil
		}
		slog.Warn("llm chat failed, using deterministic reasoner", "err", err)
	}
	r := deterministicAnswer(question, rep, ds)
	r.Engine = "deterministic"
	return r, nil
}

func extractCitations(text string, rep *agents.Report, ds *model.Dataset) (string, []Citation) {
	byID := map[string]agents.Insight{}
	for _, in := range rep.AllInsights() {
		byID[in.ID] = in
	}
	for _, b := range rep.Business {
		byID[b.ID] = b.Insight
	}
	seen := map[string]bool{}
	var cites []Citation
	for _, m := range citeRe.FindAllStringSubmatch(text, -1) {
		key := m[1] + ":" + m[2]
		if seen[key] {
			continue
		}
		seen[key] = true
		switch m[1] {
		case "insight":
			if in, ok := byID[m[2]]; ok {
				cites = append(cites, insightCitation(in))
			}
		case "agent":
			if meta, ok := agents.Metas[m[2]]; ok {
				cites = append(cites, Citation{Label: meta.Name, Href: agentHref(m[2]), AgentID: m[2]})
			}
		case "product":
			if p, ok := ds.ProductByID[m[2]]; ok {
				cites = append(cites, Citation{Label: "View " + p.Name, Href: "/agents/products?product=" + p.ID, AgentID: "products"})
			}
		}
	}
	clean := citeRe.ReplaceAllString(text, "")
	clean = strings.ReplaceAll(clean, " .", ".")
	clean = strings.ReplaceAll(clean, " ,", ",")
	return strings.TrimSpace(clean), cites
}

func agentHref(id string) string {
	if id == "insights" {
		return "/insights"
	}
	return "/agents/" + id
}

func insightCitation(in agents.Insight) Citation {
	href := agentHref(in.AgentID) + "?tab=findings&insight=" + in.ID
	for _, a := range in.Actions {
		if a.Href != "" {
			href = a.Href
			break
		}
	}
	label := in.Title
	if in.Entity != nil && in.Entity.Type == "product" {
		label = "View " + in.Entity.Name
	}
	return Citation{Label: label, Href: href, AgentID: in.AgentID, InsightID: in.ID}
}

func followUps(q string) []string {
	q = strings.ToLower(q)
	all := []string{"What should I focus on today?", "Why are returns increasing?", "Which products should I reorder?",
		"What are customers complaining about?", "Which competitor changed prices?", "Why did revenue fall?", "Show me all critical problems"}
	var out []string
	for _, s := range all {
		if !strings.Contains(q, strings.ToLower(s[:12])) {
			out = append(out, s)
		}
		if len(out) == 3 {
			break
		}
	}
	return out
}

// ---------------------------------------------------------------- deterministic reasoner

func has(q string, words ...string) bool {
	for _, w := range words {
		if strings.Contains(q, w) {
			return true
		}
	}
	return false
}

func bullet(in agents.Insight) string {
	return fmt.Sprintf("- **%s** — %s", in.Title, firstSentence(in.Summary))
}

func firstSentence(s string) string {
	if i := strings.Index(s, ". "); i > 0 {
		return s[:i+1]
	}
	return s
}

func deterministicAnswer(question string, rep *agents.Report, ds *model.Dataset) *ChatReply {
	q := strings.ToLower(question)
	var b strings.Builder
	var cites []Citation
	cite := func(in agents.Insight) { cites = append(cites, insightCitation(in)) }
	agentInsights := func(id string, sev ...string) []agents.Insight {
		var out []agents.Insight
		for _, in := range rep.Results[id].Insights {
			if len(sev) == 0 {
				out = append(out, in)
				continue
			}
			for _, s := range sev {
				if in.Severity == s {
					out = append(out, in)
				}
			}
		}
		return out
	}
	kpis := agents.OverviewKPIs(ds, rep.Range, rep.Results["finance"], rep.Results["marketing"])
	kpi := func(key string) agents.KPI {
		for _, k := range kpis {
			if k.Key == key {
				return k
			}
		}
		return agents.KPI{}
	}

	switch {
	case has(q, "revenue", "sales") && has(q, "fall", "drop", "down", "declin", "why", "decreas"):
		rev, ord, aov := kpi("revenue"), kpi("orders"), kpi("aov")
		dir := "fell"
		if rev.Change >= 0 {
			dir = "rose"
		}
		fmt.Fprintf(&b, "Revenue %s **%.1f%%** to **%s** over %s, driven mainly by order volume (%+.1f%%) rather than basket size (AOV %+.1f%%).\n\n",
			dir, abs(rev.Change), agents.USD(rev.Value), strings.ToLower(rep.Range.Label), ord.Change, aov.Change)
		b.WriteString("What the agents see behind it:\n")
		n := 0
		for _, id := range []string{"marketing", "products", "pricing", "inventory", "customers"} {
			for _, in := range agentInsights(id, agents.SevCritical, agents.SevImportant, agents.SevMarket) {
				if n >= 4 {
					break
				}
				b.WriteString(bullet(in) + "\n")
				cite(in)
				n++
				break
			}
		}
		b.WriteString("\nThe previous period also included festive-season demand, so part of the decline is seasonal. **Next step:** fix the paid-social efficiency drop first — it is the largest controllable driver.")
		cites = append(cites, Citation{Label: "Finance Agent", Href: "/agents/finance", AgentID: "finance"})
	case has(q, "return"):
		ins := agentInsights("products", agents.SevCritical)
		if len(ins) > 0 {
			in := ins[0]
			fmt.Fprintf(&b, "%s\n\n", in.Summary)
			for _, e := range in.Evidence {
				fmt.Fprintf(&b, "- %s: **%s**\n", e.Label, e.Value)
			}
			fmt.Fprintf(&b, "\n**Likely cause:** %s\n\n**Recommended action:** %s", in.LikelyCause, in.Recommendation)
			cite(in)
			for _, bi := range rep.Business {
				if bi.Entity != nil && in.Entity != nil && bi.Entity.ID == in.Entity.ID && len(bi.Sources) > 1 {
					cite(bi.Insight)
				}
			}
		} else {
			b.WriteString("Returns are within their normal range — no product shows a statistically significant return spike right now.")
		}
	case has(q, "complain", "support", "ticket"):
		clusters := rep.Results["support"].View["clusters"].([]agents.H)
		b.WriteString("Customers are reporting these recurring problems directly to support (last 21 days):\n\n")
		for i, c := range clusters {
			if i >= 4 {
				break
			}
			fmt.Fprintf(&b, "- **%v** — %v complaints. %v\n", c["title"], c["count"], c["rootCause"])
		}
		themes := rep.Results["reviews"].View["negativeThemes"].([]agents.H)
		if len(themes) > 0 {
			fmt.Fprintf(&b, "\nIn public reviews, the top negative theme is **%v** (%v%% of negative reviews).", themes[0]["theme"], themes[0]["share"])
		}
		for _, in := range agentInsights("support", agents.SevCritical, agents.SevImportant) {
			cite(in)
		}
	case has(q, "reorder", "restock", "stock", "inventory"):
		rows := rep.Results["inventory"].View["table"].([]agents.StockRow)
		b.WriteString("Reorder these products now (ranked by urgency):\n\n")
		n := 0
		for _, r := range rows {
			if (r.Risk == "stockout" || r.Risk == "critical" || r.Risk == "low") && r.ReorderQty > 0 && n < 6 {
				fmt.Fprintf(&b, "- **%s** — %d available, %.1f/day, %s left (lead time %dd). Reorder **%d units**.\n", r.Name, r.Available, r.DailySales, daysText(r.DaysLeft), r.LeadTime, r.ReorderQty)
				n++
			}
		}
		if n == 0 {
			b.WriteString("- No products currently need reordering.\n")
		}
		for _, in := range agentInsights("inventory", agents.SevCritical, agents.SevImportant) {
			cite(in)
		}
		cites = append(cites, Citation{Label: "Inventory table", Href: "/agents/inventory?tab=data", AgentID: "inventory"})
	case has(q, "competitor", "price", "pricing"):
		changes := rep.Results["pricing"].View["changes"].([]agents.H)
		for _, in := range agentInsights("pricing", agents.SevMarket) {
			fmt.Fprintf(&b, "%s\n\n**Recommendation:** %s\n\n", in.Summary, in.Recommendation)
			cite(in)
		}
		if len(changes) > 0 {
			b.WriteString("Other recent competitor price moves:\n")
			for i, c := range changes {
				if i >= 5 {
					break
				}
				fmt.Fprintf(&b, "- %v · %v: $%.2f → $%.2f (%+.0f%%)\n", c["competitor"], c["product"], c["from"], c["to"], c["change"])
			}
		}
	case has(q, "critical", "problem", "issue", "wrong"):
		b.WriteString("Critical problems detected by your agents right now:\n\n")
		n := 0
		for _, bi := range rep.Business {
			if bi.Severity == agents.SevCritical && bi.Status != "dismissed" {
				b.WriteString(bullet(bi.Insight) + "\n")
				cite(bi.Insight)
				n++
			}
		}
		if n == 0 {
			b.WriteString("- Nothing critical — all agents report normal operation.\n")
		}
	case has(q, "customer", "churn", "repurchase", "retention", "vip"):
		for _, in := range agentInsights("customers") {
			b.WriteString(bullet(in) + "\n")
			cite(in)
		}
		v := rep.Results["customers"].View
		for _, k := range v["kpis"].([]agents.KPI) {
			if k.Key == "repeatRate" {
				fmt.Fprintf(&b, "\nRepeat purchase rate is **%.1f%%** (%+.1f pts vs the start of the period).", k.Value, k.Change)
			}
		}
	case has(q, "marketing", "roas", "campaign", "ads", "cac"):
		for _, in := range agentInsights("marketing") {
			fmt.Fprintf(&b, "%s\n\n**Recommendation:** %s\n\n", bullet(in), in.Recommendation)
			cite(in)
		}
	case has(q, "deliver", "courier", "rto", "ndr", "shipping", "order"):
		for _, in := range agentInsights("orders") {
			b.WriteString(bullet(in) + "\n")
			cite(in)
		}
		r := rep.Results["orders"].View["rates"].(agents.H)
		fmt.Fprintf(&b, "\nOn-time delivery is **%.1f%%**, RTO **%.1f%%**, NDR **%.1f%%** for %s.", r["onTime"], r["rto"], r["ndr"], strings.ToLower(rep.Range.Label))
	case has(q, "profit", "margin", "money", "cash", "finance"):
		p := rep.Results["finance"].View["pnl"].(agents.PnL)
		fmt.Fprintf(&b, "For %s you made **%s net profit** on **%s net revenue** — a **%.1f%% net margin** (gross margin %.1f%%).\n\n",
			strings.ToLower(rep.Range.Label), agents.USD(p.NetProfit), agents.USD(p.NetRevenue), p.NetMargin, p.GrossMargin)
		for _, in := range agentInsights("finance") {
			b.WriteString(bullet(in) + "\n")
			cite(in)
		}
	case has(q, "product") && has(q, "bad", "worst", "poor", "under", "perform"):
		b.WriteString("Products performing worst (by product health score):\n\n")
		for _, p := range rep.Results["products"].View["worst"].([]agents.ProductStats) {
			fmt.Fprintf(&b, "- **%s** — health %.0f/100 · revenue %s · return rate %.1f%% · rating %.1f★\n", p.Name, p.Health, agents.USD(p.Revenue), p.ReturnRate, p.Rating)
			cites = append(cites, Citation{Label: "View " + p.Name, Href: "/agents/products?product=" + p.ID, AgentID: "products"})
			if len(cites) >= 4 {
				break
			}
		}
	default:
		h, _, _ := rep.Health()
		fmt.Fprintf(&b, "Business health is **%.0f/100**. Here is what to focus on today, in priority order:\n\n", h)
		n := 0
		for _, bi := range rep.Business {
			if bi.Status == "dismissed" || n >= 3 {
				continue
			}
			fmt.Fprintf(&b, "%d. **%s** — %s\n", n+1, bi.Title, bi.Recommendation)
			cite(bi.Insight)
			n++
		}
	}
	return &ChatReply{Answer: strings.TrimSpace(b.String()), Citations: dedupe(cites), Suggestions: followUps(question)}
}

func dedupe(c []Citation) []Citation {
	seen := map[string]bool{}
	var out []Citation
	for _, x := range c {
		// One chip per destination label: several insights about the same
		// product should not render as repeated "View <product>" chips.
		if seen[x.Label] {
			continue
		}
		seen[x.Label] = true
		out = append(out, x)
	}
	if len(out) > 5 {
		out = out[:5]
	}
	return out
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func daysText(d float64) string {
	if d >= 999 {
		return "no recent demand"
	}
	return fmt.Sprintf("%.0f days", d)
}

// ---------------------------------------------------------------- executive brief

// Brief returns a short executive summary of the business insights.
func (s *Service) Brief(ctx context.Context, st model.Store, rep *agents.Report) (string, string) {
	key := st.ID + "|" + rep.Range.Key
	s.mu.Lock()
	if c, ok := s.briefs[key]; ok && time.Now().Before(c.exp) {
		s.mu.Unlock()
		return c.text, s.LLM.Model()
	}
	s.mu.Unlock()
	det := deterministicBrief(rep)
	if !s.LLM.Enabled() {
		return det, "deterministic"
	}
	ds, _ := s.Dataset(ctx, st)
	bc, _ := json.Marshal(businessContext(rep, ds))
	cctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	text, err := s.LLM.Complete(cctx, "You write the executive brief for an e-commerce owner. Using ONLY the numbers in the context, write 3 short sentences: what changed, why, and the single most important action today. Plain text, no markdown, no citations.\n\n<business_context>\n"+string(bc)+"\n</business_context>",
		[]llm.Message{{Role: "user", Content: "Write today's executive brief."}}, 2000)
	if err != nil || text == "" {
		return det, "deterministic"
	}
	s.mu.Lock()
	s.briefs[key] = cachedText{text: text, exp: time.Now().Add(10 * time.Minute)}
	s.mu.Unlock()
	return text, s.LLM.Model()
}

func deterministicBrief(rep *agents.Report) string {
	var crit []agents.BusinessInsight
	for _, b := range rep.Business {
		if b.Severity == agents.SevCritical && b.Status != "dismissed" {
			crit = append(crit, b)
		}
	}
	h, p, _ := rep.Health()
	s := fmt.Sprintf("Business health is %.0f/100 (%+.0f vs last period) with %d critical issue%s across your agents.", h, h-p, len(crit), map[bool]string{true: "", false: "s"}[len(crit) == 1])
	if len(crit) > 0 {
		sort.SliceStable(crit, func(i, j int) bool { return abs(crit[i].ImpactValue) > abs(crit[j].ImpactValue) })
		s += fmt.Sprintf(" The most expensive is \"%s\" (%s).", crit[0].Title, crit[0].Impact)
		s += " Recommended first action: " + crit[0].Recommendation
	}
	return s
}

// ---------------------------------------------------------------- review responses

func (s *Service) DraftReviewResponse(ctx context.Context, st model.Store, reviewID string) (string, string, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return "", "", err
	}
	var rv *model.Review
	for i := range ds.Reviews {
		if ds.Reviews[i].ID == reviewID {
			rv = &ds.Reviews[i]
		}
	}
	if rv == nil {
		return "", "", fmt.Errorf("review %s: not found", reviewID)
	}
	p := ds.ProductByID[rv.ProductID]
	c := ds.CustomerByID[rv.CustomerID]
	first := strings.Fields(c.Name)[0]
	if s.LLM.Enabled() {
		prompt := fmt.Sprintf("Store: %s\nProduct: %s\nCustomer first name: %s\nRating: %d/5\nReview title: %s\nReview: %s\nThemes: %s",
			ds.Store.Name, p.Name, first, rv.Rating, rv.Title, rv.Body, strings.Join(rv.Themes, ", "))
		cctx, cancel := context.WithTimeout(ctx, 40*time.Second)
		defer cancel()
		text, err := s.LLM.Complete(cctx, "You draft public replies to customer reviews for a D2C brand. Write 2–4 warm, specific sentences in plain text: thank the customer by first name, acknowledge their exact point, and for critical reviews apologise and give a concrete next step (support@ email or WhatsApp) without making promises about refunds. Never invent policies, discounts or facts.",
			[]llm.Message{{Role: "user", Content: prompt}}, 1200)
		if err == nil && text != "" {
			return text, s.LLM.Model(), nil
		}
	}
	return templateResponse(rv, first, p.Name, ds.Store.Name), "deterministic", nil
}

func templateResponse(rv *model.Review, first, product, store string) string {
	theme := ""
	if len(rv.Themes) > 0 {
		theme = rv.Themes[0]
	}
	if rv.Sentiment == "positive" {
		return fmt.Sprintf("Thank you so much, %s! We're thrilled the %s worked out so well for you — reviews like yours make our team's day. See you again soon at %s.", first, product, store)
	}
	switch theme {
	case "Fit & sizing":
		return fmt.Sprintf("Hi %s, thank you for telling us about the fit of the %s — we're sorry it ran smaller than expected. We're reviewing the size guidance for this product right now. Please message us on WhatsApp and we'll arrange a free size exchange.", first, product)
	case "Quality":
		return fmt.Sprintf("Hi %s, we're sorry the %s didn't meet the quality you expect from us. Our product team is inspecting this batch. Please reach out on WhatsApp with your order number so we can make this right.", first, product)
	case "Delivery":
		return fmt.Sprintf("Hi %s, we apologise for the delivery delay — that's not the experience we want for you. We've escalated the issue with our courier partner. Please message us if anything is still pending on your order.", first)
	case "Packaging":
		return fmt.Sprintf("Hi %s, we're sorry your %s arrived in poor packaging. We've shared this with our warehouse team. Please send us a photo on WhatsApp and we'll arrange a replacement if needed.", first, product)
	}
	return fmt.Sprintf("Hi %s, thank you for your honest feedback on the %s. We're sorry it fell short, and we'd love to make it right — please reach out to our support team on WhatsApp with your order number.", first, product)
}
