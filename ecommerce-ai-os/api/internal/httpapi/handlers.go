package httpapi

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/mail"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/agents"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/auth"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/llm"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/repo"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/service"
)

type H = map[string]any

// domain endpoint → owning agent
var domainAgents = map[string]string{
	"orders": "orders", "customers": "customers", "reviews": "reviews", "complaints": "support", "products": "products",
	"inventory": "inventory", "competitors": "pricing", "marketing": "marketing", "finance": "finance", "news": "market",
}

var businessTypes = map[string]bool{"fashion": true, "electronics": true, "beauty": true, "grocery": true, "home": true, "d2c": true, "other": true}

func (s *Server) routes() {
	api := s.App.Group("/api")
	api.Get("/health", s.health)

	authG := api.Group("/auth", s.rateLimit("auth", 20, time.Minute))
	authG.Post("/signup", s.signup)
	authG.Post("/login", s.login)
	authG.Post("/logout", s.logout)
	authG.Post("/forgot", s.forgot)
	authG.Get("/google", s.google)

	p := api.Group("", s.rateLimit("api", 600, time.Minute), s.requireAuth)
	p.Get("/me", s.me)
	p.Get("/stores", s.stores)
	p.Post("/stores", s.createStore)

	st := p.Group("", s.requireStore)
	st.Get("/dashboard", s.cached(s.dashboard))
	st.Get("/agents", s.cached(s.agentList))
	st.Get("/agents/:id", s.cached(s.agentDetail))
	st.Get("/agents/:id/insights", s.agentInsights)
	st.Get("/agents/:id/activity", s.agentActivity)
	st.Patch("/agents/:id/settings", s.updateAgentSettings)
	st.Get("/insights", s.insights)
	st.Patch("/insights/:id", s.updateInsight)
	st.Get("/notifications", s.notifications)
	st.Post("/notifications/read", s.markNotifications(true))
	st.Post("/notifications/dismiss", s.markNotifications(false))
	st.Get("/search", s.search)
	st.Post("/actions", s.createAction)
	st.Get("/actions", s.listActions)

	st.Get("/orders/list", s.list(s.svc.Orders))
	st.Get("/customers/list", s.list(s.svc.Customers))
	st.Get("/customers/:id", s.customer)
	st.Get("/products/list", s.productList)
	st.Get("/products/:id", s.product)
	st.Get("/inventory/list", s.list(s.svc.Inventory))
	st.Get("/reviews/list", s.list(s.svc.Reviews))
	st.Post("/reviews/:id/draft", s.rateLimit("draft", 30, time.Minute), s.draftReview)
	st.Put("/reviews/:id/response", s.saveReview)
	st.Get("/complaints/list", s.list(s.svc.Tickets))
	for path, agentID := range domainAgents {
		st.Get("/"+path, s.cached(s.domain(agentID)))
	}
	st.Post("/ai/chat", s.rateLimit("chat", 30, time.Minute), s.chat)
}

func (s *Server) health(c *fiber.Ctx) error {
	db := "ok"
	if err := s.svc.Repo.Ping(c.UserContext()); err != nil {
		db = "unavailable"
	}
	return c.JSON(H{"status": "ok", "database": db, "cache": s.svc.Cache.Kind(), "llm": s.svc.LLM.Model(), "time": time.Now()})
}

// ---------------------------------------------------------------- auth

type signupReq struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Company  string `json:"company"`
}

func validEmail(e string) bool {
	a, err := mail.ParseAddress(e)
	return err == nil && a.Address == e && len(e) <= 254
}

func (s *Server) signup(c *fiber.Ctx) error {
	var req signupReq
	if err := c.BodyParser(&req); err != nil {
		return Err(400, "invalid_body", "The request body is not valid JSON.", "")
	}
	req.Name, req.Email, req.Company = strings.TrimSpace(req.Name), strings.ToLower(strings.TrimSpace(req.Email)), strings.TrimSpace(req.Company)
	switch {
	case len(req.Name) < 2 || len(req.Name) > 80:
		return Err(422, "invalid_name", "Enter your full name (2–80 characters).", "")
	case !validEmail(req.Email):
		return Err(422, "invalid_email", "Enter a valid work email address.", "")
	case len(req.Password) < 8 || len(req.Password) > 128:
		return Err(422, "weak_password", "Use a password with at least 8 characters.", "")
	}
	if req.Company == "" {
		req.Company = strings.Fields(req.Name)[0] + "'s company"
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		return err
	}
	u, err := s.svc.Repo.CreateOrgUser(c.UserContext(), req.Company, model.User{Name: req.Name, Email: req.Email, PasswordHash: hash})
	if errors.Is(err, repo.ErrConflict) {
		return Err(409, "email_taken", "An account with this email already exists.", "Sign in instead, or reset your password.")
	}
	if err != nil {
		return err
	}
	if err := s.setSession(c, u, true); err != nil {
		return err
	}
	return c.Status(201).JSON(H{"user": u, "stores": []model.Store{}})
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Remember bool   `json:"remember"`
}

func (s *Server) login(c *fiber.Ctx) error {
	var req loginReq
	if err := c.BodyParser(&req); err != nil {
		return Err(400, "invalid_body", "The request body is not valid JSON.", "")
	}
	u, err := s.svc.Repo.UserByEmail(c.UserContext(), strings.TrimSpace(req.Email))
	if err != nil || !auth.CheckPassword(u.PasswordHash, req.Password) {
		return Err(401, "invalid_credentials", "Email or password is incorrect.", "Check your details or reset your password.")
	}
	if err := s.setSession(c, u, req.Remember); err != nil {
		return err
	}
	stores, _ := s.svc.Repo.StoresByOrg(c.UserContext(), u.OrgID)
	return c.JSON(H{"user": u, "stores": nonNil(stores)})
}

func nonNil(s []model.Store) []model.Store {
	if s == nil {
		return []model.Store{}
	}
	return s
}

func (s *Server) logout(c *fiber.Ctx) error {
	c.Cookie(&fiber.Cookie{Name: auth.CookieName, Value: "", Expires: time.Unix(0, 0), HTTPOnly: true, Secure: s.cfg.CookieSecure, SameSite: "Lax", Path: "/"})
	return c.SendStatus(204)
}

func (s *Server) forgot(c *fiber.Ctx) error {
	var req struct {
		Email string `json:"email"`
	}
	if err := c.BodyParser(&req); err != nil || !validEmail(strings.ToLower(strings.TrimSpace(req.Email))) {
		return Err(422, "invalid_email", "Enter a valid email address.", "")
	}
	// Always 202 so the endpoint can't be used to discover accounts.
	if _, err := s.svc.Repo.UserByEmail(c.UserContext(), req.Email); err == nil {
		slog.Info("password reset requested", "email_domain", strings.SplitN(req.Email, "@", 2)[1])
	}
	return c.Status(202).JSON(H{"ok": true})
}

func (s *Server) google(c *fiber.Ctx) error {
	if s.cfg.GoogleClientID == "" {
		return Err(501, "google_not_configured", "Google sign-in isn't enabled for this workspace yet.", "Use email and password, or ask your administrator to configure Google OAuth.")
	}
	return Err(501, "google_pending", "Google sign-in is being set up.", "Use email and password for now.")
}

func (s *Server) me(c *fiber.Ctx) error {
	u := userOf(c)
	org, _ := s.svc.Repo.Org(c.UserContext(), u.OrgID)
	stores, err := s.svc.Repo.StoresByOrg(c.UserContext(), u.OrgID)
	if err != nil {
		return err
	}
	return c.JSON(H{"user": u, "organization": org, "stores": nonNil(stores), "llm": H{"enabled": s.svc.LLM.Enabled(), "model": s.svc.LLM.Model()}})
}

func (s *Server) stores(c *fiber.Ctx) error {
	stores, err := s.svc.Repo.StoresByOrg(c.UserContext(), userOf(c).OrgID)
	if err != nil {
		return err
	}
	return c.JSON(H{"stores": nonNil(stores)})
}

func (s *Server) createStore(c *fiber.Ctx) error {
	var req struct {
		Platform     string `json:"platform"`
		BusinessType string `json:"businessType"`
		Name         string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil {
		return Err(400, "invalid_body", "The request body is not valid JSON.", "")
	}
	req.BusinessType = strings.ToLower(req.BusinessType)
	if !businessTypes[req.BusinessType] {
		return Err(422, "invalid_business_type", "Choose a business type.", "")
	}
	if req.Platform != "demo" {
		return Err(422, "connector_unavailable", fmt.Sprintf("The %s connector isn't available in this preview.", req.Platform), "Start with the Demo Store — you can connect your live store later.")
	}
	if len(req.Name) > 80 {
		return Err(422, "invalid_name", "Store name is too long.", "")
	}
	existing, _ := s.svc.Repo.StoresByOrg(c.UserContext(), userOf(c).OrgID)
	if len(existing) >= 5 {
		return Err(409, "store_limit", "This workspace already has the maximum number of demo stores.", "")
	}
	st, err := s.svc.CreateDemoStore(c.UserContext(), userOf(c).OrgID, req.BusinessType, strings.TrimSpace(req.Name))
	if err != nil {
		return err
	}
	return c.Status(201).JSON(H{"store": st})
}

// ---------------------------------------------------------------- caching

// cached memoises GET responses per store + URL for a short TTL.
func (s *Server) cached(h fiber.Handler) fiber.Handler {
	return func(c *fiber.Ctx) error {
		key := "resp:" + storeOf(c).ID + ":" + c.OriginalURL()
		if b, ok := s.svc.Cache.Get(c.UserContext(), key); ok {
			c.Set("X-Cache", "hit")
			c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSONCharsetUTF8)
			return c.Send(b)
		}
		if err := h(c); err != nil {
			return err
		}
		if c.Response().StatusCode() == 200 {
			s.svc.Cache.Set(c.UserContext(), key, append([]byte(nil), c.Response().Body()...), 45*time.Second)
		}
		c.Set("X-Cache", "miss")
		return nil
	}
}

func (s *Server) report(c *fiber.Ctx) (*agents.Report, error) {
	rk := c.Query("range", "30d")
	if rk == "custom" {
		from, to := c.Query("from"), c.Query("to")
		if _, err := time.Parse("2006-01-02", from); err != nil {
			return nil, Err(422, "invalid_range", "Custom range needs a valid start date.", "")
		}
		if _, err := time.Parse("2006-01-02", to); err != nil {
			return nil, Err(422, "invalid_range", "Custom range needs a valid end date.", "")
		}
	}
	return s.svc.Report(c.UserContext(), storeOf(c), rk, c.Query("from"), c.Query("to"))
}

// ---------------------------------------------------------------- dashboard & agents

func agentCard(sum agents.Summary) H {
	b, _ := json.Marshal(sum)
	var m H
	_ = json.Unmarshal(b, &m)
	return m
}

func (s *Server) dashboard(c *fiber.Ctx) error {
	rep, err := s.report(c)
	if err != nil {
		return err
	}
	st := storeOf(c)
	ds, err := s.svc.Dataset(c.UserContext(), st)
	if err != nil {
		return err
	}
	paused := s.svc.PausedAgents(c.UserContext(), st.ID)
	health, prev, segs := rep.Health()
	var priority []agents.BusinessInsight
	counts := map[string]int{}
	for _, b := range rep.Business {
		if b.Status == "dismissed" || b.Status == "resolved" || paused[b.Sources[0]] {
			continue
		}
		counts[b.Severity]++
		if len(priority) < 7 {
			priority = append(priority, b)
		}
	}
	var cards []H
	for _, sum := range rep.Summaries() {
		cards = append(cards, agentCard(sum))
	}
	return c.JSON(H{
		"range": rep.Range, "store": H{"id": st.ID, "name": st.Name}, "generatedAt": rep.GeneratedAt, "analysisMs": rep.Duration.Milliseconds(),
		"health":   H{"score": health, "prev": prev, "change": health - prev, "label": rep.BusinessRes.Summary.HealthLabel, "segments": segs},
		"kpis":     agents.OverviewKPIs(ds, rep.Range, rep.Results["finance"], rep.Results["marketing"]),
		"trend":    agents.RevenueTrend(ds, rep.Range),
		"priority": priority, "priorityCounts": counts,
		"agents": cards, "business": agentCard(rep.BusinessRes.Summary),
		"activity": rep.Activity(14),
	})
}

func (s *Server) agentList(c *fiber.Ctx) error {
	rep, err := s.report(c)
	if err != nil {
		return err
	}
	var cards []H
	for _, sum := range rep.Summaries() {
		cards = append(cards, agentCard(sum))
	}
	return c.JSON(H{"agents": cards, "business": agentCard(rep.BusinessRes.Summary), "activity": rep.Activity(40)})
}

func (s *Server) agentSettings(c *fiber.Ctx, id string) repo.AgentSettings {
	all, err := s.svc.Repo.AgentSettings(c.UserContext(), storeOf(c).ID)
	if err == nil {
		if cfg, ok := all[id]; ok {
			return cfg
		}
	}
	return repo.DefaultAgentSettings()
}

func (s *Server) agentDetail(c *fiber.Ctx) error {
	id := c.Params("id")
	if id == "insights" {
		return s.insights(c)
	}
	if _, ok := agents.Metas[id]; !ok {
		return Err(404, "agent_not_found", "There is no agent with that ID.", "")
	}
	rep, err := s.report(c)
	if err != nil {
		return err
	}
	res := rep.Results[id]
	activity := res.Activity
	if actions, err := s.svc.Repo.Actions(c.UserContext(), storeOf(c).ID, 50); err == nil {
		for _, a := range actions {
			if a.AgentID == id {
				activity = append(activity, agents.Activity{ID: a.ID, AgentID: id, At: a.At, Kind: "action", Message: a.Message, InsightID: a.InsightID})
			}
		}
		sort.Slice(activity, func(i, j int) bool { return activity[i].At.After(activity[j].At) })
	}
	return c.JSON(H{"range": rep.Range, "summary": res.Summary, "view": res.View, "changes": res.Changes, "insights": res.Insights,
		"activity": activity, "settings": s.agentSettings(c, id)})
}

func (s *Server) domain(agentID string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rep, err := s.report(c)
		if err != nil {
			return err
		}
		res := rep.Results[agentID]
		return c.JSON(H{"range": rep.Range, "summary": res.Summary, "view": res.View, "insights": res.Insights})
	}
}

func (s *Server) agentInsights(c *fiber.Ctx) error {
	rep, err := s.report(c)
	if err != nil {
		return err
	}
	id := c.Params("id")
	if id == "insights" {
		return c.JSON(H{"insights": rep.Business})
	}
	res, ok := rep.Results[id]
	if !ok {
		return Err(404, "agent_not_found", "There is no agent with that ID.", "")
	}
	return c.JSON(H{"insights": res.Insights})
}

func (s *Server) agentActivity(c *fiber.Ctx) error {
	rep, err := s.report(c)
	if err != nil {
		return err
	}
	id := c.Params("id")
	if id == "insights" {
		return c.JSON(H{"activity": rep.BusinessRes.Activity})
	}
	res, ok := rep.Results[id]
	if !ok {
		return Err(404, "agent_not_found", "There is no agent with that ID.", "")
	}
	return c.JSON(H{"activity": res.Activity})
}

func (s *Server) updateAgentSettings(c *fiber.Ctx) error {
	id := c.Params("id")
	if _, ok := agents.Metas[id]; !ok {
		return Err(404, "agent_not_found", "There is no agent with that ID.", "")
	}
	var cfg repo.AgentSettings
	if err := c.BodyParser(&cfg); err != nil {
		return Err(400, "invalid_body", "Settings must be valid JSON.", "")
	}
	switch cfg.Sensitivity {
	case "low", "balanced", "high":
	default:
		return Err(422, "invalid_sensitivity", "Sensitivity must be low, balanced or high.", "")
	}
	switch cfg.Digest {
	case "realtime", "daily", "weekly":
	default:
		return Err(422, "invalid_digest", "Digest must be realtime, daily or weekly.", "")
	}
	st := storeOf(c)
	if err := s.svc.Repo.SetAgentSettings(c.UserContext(), st.ID, id, cfg); err != nil {
		return err
	}
	msg := "Monitoring settings updated"
	if cfg.Paused {
		msg = "Monitoring paused by " + userOf(c).Name
	}
	_ = s.svc.Repo.AddAction(c.UserContext(), st.ID, repo.UserAction{ID: repo.NewID("act"), AgentID: id, UserID: userOf(c).ID, Kind: "settings", Message: msg, At: time.Now()})
	s.svc.InvalidateStore(st.ID)
	return c.JSON(H{"settings": cfg})
}

// ---------------------------------------------------------------- business insights

func (s *Server) insights(c *fiber.Ctx) error {
	rep, err := s.report(c)
	if err != nil {
		return err
	}
	brief, engine := s.svc.Brief(c.UserContext(), storeOf(c), rep)
	groups := map[string]int{}
	for _, b := range rep.Business {
		if b.Status != "dismissed" {
			groups[b.Severity]++
		}
	}
	// What changed: the largest KPI moves across all agents.
	var changes []H
	for _, id := range agents.AgentOrder {
		for _, ch := range rep.Results[id].Changes {
			if ch.Prev == 0 || math.IsInf(ch.Change, 0) {
				continue
			}
			good := (ch.Change > 0) == (ch.Direction == "up")
			if ch.Direction == "neutral" {
				good = true
			}
			changes = append(changes, H{"agentId": id, "label": ch.Label, "cur": ch.Cur, "prev": ch.Prev, "change": ch.Change, "unit": ch.Unit, "good": good,
				"weight": math.Abs(ch.Change) * map[bool]float64{true: 0.4, false: 1}[ch.Unit == "percent" || ch.Unit == "rating"]})
		}
	}
	sort.Slice(changes, func(i, j int) bool { return changes[i]["weight"].(float64) > changes[j]["weight"].(float64) })
	if len(changes) > 8 {
		changes = changes[:8]
	}
	health, prev, segs := rep.Health()
	return c.JSON(H{"range": rep.Range, "summary": rep.BusinessRes.Summary, "brief": brief, "briefEngine": engine, "insights": rep.Business,
		"groups": groups, "changes": changes, "health": H{"score": health, "prev": prev, "segments": segs}, "activity": rep.BusinessRes.Activity})
}

func (s *Server) updateInsight(c *fiber.Ctx) error {
	var req struct {
		Status   string `json:"status"`
		Assignee string `json:"assignee"`
		AgentID  string `json:"agentId"`
		Title    string `json:"title"`
	}
	if err := c.BodyParser(&req); err != nil {
		return Err(400, "invalid_body", "The request body is not valid JSON.", "")
	}
	switch req.Status {
	case "new", "assigned", "dismissed", "resolved":
	default:
		return Err(422, "invalid_status", "Status must be new, assigned, dismissed or resolved.", "")
	}
	if req.Status == "assigned" && strings.TrimSpace(req.Assignee) == "" {
		return Err(422, "assignee_required", "Choose who to assign this to.", "")
	}
	if len(req.Assignee) > 80 || len(req.Title) > 300 {
		return Err(422, "invalid_input", "Input is too long.", "")
	}
	st := storeOf(c)
	id := c.Params("id")
	if err := s.svc.Repo.SetInsightState(c.UserContext(), st.ID, id, repo.InsightState{Status: req.Status, Assignee: req.Assignee}); err != nil {
		return err
	}
	verb := map[string]string{"assigned": "Assigned to " + req.Assignee, "dismissed": "Dismissed", "resolved": "Marked resolved", "new": "Reopened"}[req.Status]
	agentID := req.AgentID
	if _, ok := agents.Metas[agentID]; !ok {
		agentID = "insights"
	}
	_ = s.svc.Repo.AddAction(c.UserContext(), st.ID, repo.UserAction{ID: repo.NewID("act"), AgentID: agentID, InsightID: id, UserID: userOf(c).ID, Kind: req.Status,
		Message: fmt.Sprintf("%s: %s", verb, req.Title), At: time.Now()})
	s.svc.InvalidateStore(st.ID)
	return c.JSON(H{"id": id, "status": req.Status, "assignee": req.Assignee})
}

// ---------------------------------------------------------------- notifications

func (s *Server) notifications(c *fiber.Ctx) error {
	st := storeOf(c)
	rep, err := s.svc.Report(c.UserContext(), st, "30d", "", "")
	if err != nil {
		return err
	}
	states, err := s.svc.Repo.NotificationStates(c.UserContext(), st.ID)
	if err != nil {
		return err
	}
	paused := s.svc.PausedAgents(c.UserContext(), st.ID)
	out := []agents.Notification{}
	unread := 0
	for _, n := range rep.Notifications() {
		ns := states[n.ID]
		if ns.Dismissed || paused[n.AgentID] {
			continue
		}
		n.Read = ns.Read
		if !n.Read {
			unread++
		}
		out = append(out, n)
	}
	return c.JSON(H{"notifications": out, "unread": unread})
}

func (s *Server) markNotifications(read bool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req struct {
			IDs []string `json:"ids"`
			All bool     `json:"all"`
		}
		if err := c.BodyParser(&req); err != nil {
			return Err(400, "invalid_body", "The request body is not valid JSON.", "")
		}
		st := storeOf(c)
		if req.All {
			rep, err := s.svc.Report(c.UserContext(), st, "30d", "", "")
			if err != nil {
				return err
			}
			for _, n := range rep.Notifications() {
				req.IDs = append(req.IDs, n.ID)
			}
		}
		if len(req.IDs) > 500 {
			return Err(422, "too_many", "Too many notifications in one request.", "")
		}
		t := true
		var err error
		if read {
			err = s.svc.Repo.SetNotificationStates(c.UserContext(), st.ID, req.IDs, &t, nil)
		} else {
			err = s.svc.Repo.SetNotificationStates(c.UserContext(), st.ID, req.IDs, &t, &t)
		}
		if err != nil {
			return err
		}
		return c.JSON(H{"ok": true, "updated": len(req.IDs)})
	}
}

// ---------------------------------------------------------------- lists

func parseList(c *fiber.Ctx) service.ListQuery {
	q := service.ListQuery{Sort: c.Query("sort"), Dir: c.Query("dir", "desc"), Q: c.Query("q"), Filters: map[string]string{}}
	q.Page, _ = strconv.Atoi(c.Query("page", "1"))
	q.PageSize, _ = strconv.Atoi(c.Query("pageSize", "25"))
	for _, k := range []string{"status", "courier", "region", "payment", "risk", "product", "customer", "segment", "category", "sentiment", "rating",
		"source", "theme", "unanswered", "channel", "cluster", "complaint", "from", "to", "expand"} {
		if v := c.Query(k); v != "" {
			q.Filters[k] = v
		}
	}
	if c.Query("format") == "csv" {
		q.All = true
	}
	return q
}

func (s *Server) list(fn func(ctx context.Context, st model.Store, q service.ListQuery) (service.ListResult, error)) fiber.Handler {
	return func(c *fiber.Ctx) error {
		q := parseList(c)
		res, err := fn(c.UserContext(), storeOf(c), q)
		if err != nil {
			return err
		}
		if q.All {
			return sendCSV(c, res.Rows)
		}
		return c.JSON(res)
	}
}

func (s *Server) productList(c *fiber.Ctx) error {
	q := parseList(c)
	res, err := s.svc.Products(c.UserContext(), storeOf(c), c.Query("range", "30d"), q)
	if err != nil {
		return err
	}
	if q.All {
		return sendCSV(c, res.Rows)
	}
	return c.JSON(res)
}

func sendCSV(c *fiber.Ctx, rows []service.H) error {
	if len(rows) > 20000 {
		rows = rows[:20000]
	}
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if len(rows) > 0 {
		var cols []string
		for k, v := range rows[0] {
			switch v.(type) {
			case []service.H, []any, service.H:
				continue
			}
			cols = append(cols, k)
		}
		sort.Strings(cols)
		_ = w.Write(cols)
		for _, r := range rows {
			rec := make([]string, len(cols))
			for i, k := range cols {
				switch v := r[k].(type) {
				case nil:
				case time.Time:
					rec[i] = v.Format(time.RFC3339)
				case *time.Time:
					if v != nil {
						rec[i] = v.Format(time.RFC3339)
					}
				case []string:
					rec[i] = strings.Join(v, "; ")
				default:
					rec[i] = fmt.Sprint(v)
				}
				// Neutralise spreadsheet formula injection.
				if len(rec[i]) > 0 && strings.ContainsRune("=+-@", rune(rec[i][0])) {
					if _, err := strconv.ParseFloat(rec[i], 64); err != nil {
						rec[i] = "'" + rec[i]
					}
				}
			}
			_ = w.Write(rec)
		}
	}
	w.Flush()
	c.Set(fiber.HeaderContentType, "text/csv; charset=utf-8")
	c.Set(fiber.HeaderContentDisposition, fmt.Sprintf(`attachment; filename="export-%s.csv"`, time.Now().Format("20060102-1504")))
	return c.Send(buf.Bytes())
}

func (s *Server) product(c *fiber.Ctx) error {
	res, err := s.svc.Product(c.UserContext(), storeOf(c), c.Params("id"))
	if err != nil {
		return Err(404, "product_not_found", "That product doesn't exist in this store.", "")
	}
	return c.JSON(res)
}

func (s *Server) customer(c *fiber.Ctx) error {
	res, err := s.svc.Customer(c.UserContext(), storeOf(c), c.Params("id"))
	if err != nil {
		return Err(404, "customer_not_found", "That customer doesn't exist in this store.", "")
	}
	return c.JSON(res)
}

func (s *Server) search(c *fiber.Ctx) error {
	q := c.Query("q")
	if len(q) > 100 {
		q = q[:100]
	}
	res, err := s.svc.Search(c.UserContext(), storeOf(c), q)
	if err != nil {
		return err
	}
	return c.JSON(res)
}

// ---------------------------------------------------------------- reviews

func (s *Server) draftReview(c *fiber.Ctx) error {
	text, engine, err := s.svc.DraftReviewResponse(c.UserContext(), storeOf(c), c.Params("id"))
	if err != nil {
		return Err(404, "review_not_found", "That review doesn't exist in this store.", "")
	}
	return c.JSON(H{"text": text, "engine": engine})
}

func (s *Server) saveReview(c *fiber.Ctx) error {
	var req struct {
		Text string `json:"text"`
	}
	if err := c.BodyParser(&req); err != nil {
		return Err(400, "invalid_body", "The request body is not valid JSON.", "")
	}
	req.Text = strings.TrimSpace(req.Text)
	if len(req.Text) < 5 || len(req.Text) > 2000 {
		return Err(422, "invalid_response", "Responses must be between 5 and 2,000 characters.", "")
	}
	st := storeOf(c)
	if err := s.svc.SetReviewResponse(c.UserContext(), st, c.Params("id"), req.Text); err != nil {
		return err
	}
	_ = s.svc.Repo.AddAction(c.UserContext(), st.ID, repo.UserAction{ID: repo.NewID("act"), AgentID: "reviews", UserID: userOf(c).ID, Kind: "respond",
		Message: "Published a response to review " + c.Params("id"), At: time.Now()})
	return c.JSON(H{"ok": true})
}

// ---------------------------------------------------------------- actions

var actionKinds = map[string]string{
	"purchase_order": "Purchase order drafted", "budget_shift": "Budget shift applied", "campaign": "Campaign created",
	"investigate": "Investigation opened", "notify_customers": "Customer notification queued",
}

func (s *Server) createAction(c *fiber.Ctx) error {
	var req struct {
		Kind      string `json:"kind"`
		AgentID   string `json:"agentId"`
		InsightID string `json:"insightId"`
		Detail    string `json:"detail"`
	}
	if err := c.BodyParser(&req); err != nil {
		return Err(400, "invalid_body", "The request body is not valid JSON.", "")
	}
	label, ok := actionKinds[req.Kind]
	if !ok {
		return Err(422, "invalid_action", "Unknown action.", "")
	}
	if _, ok := agents.Metas[req.AgentID]; !ok {
		return Err(422, "invalid_agent", "Unknown agent.", "")
	}
	if len(req.Detail) > 300 {
		req.Detail = req.Detail[:300]
	}
	st := storeOf(c)
	a := repo.UserAction{ID: repo.NewID("act"), AgentID: req.AgentID, InsightID: req.InsightID, UserID: userOf(c).ID, Kind: req.Kind,
		Message: strings.TrimSpace(label + ": " + req.Detail), At: time.Now()}
	if err := s.svc.Repo.AddAction(c.UserContext(), st.ID, a); err != nil {
		return err
	}
	s.svc.InvalidateStore(st.ID)
	return c.Status(201).JSON(H{"action": a})
}

func (s *Server) listActions(c *fiber.Ctx) error {
	acts, err := s.svc.Repo.Actions(c.UserContext(), storeOf(c).ID, 50)
	if err != nil {
		return err
	}
	if acts == nil {
		acts = []repo.UserAction{}
	}
	return c.JSON(H{"actions": acts})
}

// ---------------------------------------------------------------- assistant

func (s *Server) chat(c *fiber.Ctx) error {
	var req struct {
		Messages []llm.Message `json:"messages"`
		Range    string        `json:"range"`
	}
	if err := c.BodyParser(&req); err != nil {
		return Err(400, "invalid_body", "The request body is not valid JSON.", "")
	}
	if len(req.Messages) == 0 || len(req.Messages) > 30 {
		return Err(422, "invalid_messages", "Send between 1 and 30 messages.", "")
	}
	for i, m := range req.Messages {
		if m.Role != "user" && m.Role != "assistant" {
			return Err(422, "invalid_role", "Message roles must be user or assistant.", "")
		}
		if len(m.Content) > 4000 {
			req.Messages[i].Content = m.Content[:4000]
		}
	}
	if req.Messages[len(req.Messages)-1].Role != "user" || strings.TrimSpace(req.Messages[len(req.Messages)-1].Content) == "" {
		return Err(422, "empty_question", "Ask a question to get started.", "")
	}
	if req.Range == "" {
		req.Range = "30d"
	}
	reply, err := s.svc.Chat(c.UserContext(), storeOf(c), req.Range, req.Messages)
	if err != nil {
		return err
	}
	return c.JSON(reply)
}
