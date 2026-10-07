// Package service orchestrates the repository, the agent layer, caching and
// the language model. HTTP handlers call the service; they hold no business
// logic of their own.
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/agents"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/cache"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/llm"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/repo"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/seed"
)

type Service struct {
	Repo  repo.Repo
	Cache cache.Cache
	LLM   llm.Client

	mu       sync.Mutex
	datasets map[string]*model.Dataset
	loading  map[string]*sync.Mutex
	reports  map[string]*cachedReport
	briefs   map[string]cachedText
}

type cachedReport struct {
	rep *agents.Report
	exp time.Time
}

type cachedText struct {
	text string
	exp  time.Time
}

const reportTTL = 90 * time.Second

func New(r repo.Repo, c cache.Cache, l llm.Client) *Service {
	return &Service{Repo: r, Cache: c, LLM: l, datasets: map[string]*model.Dataset{}, loading: map[string]*sync.Mutex{},
		reports: map[string]*cachedReport{}, briefs: map[string]cachedText{}}
}

// Dataset returns the store's dataset, loading it once and re-anchoring its
// timeline to the present.
func (s *Service) Dataset(ctx context.Context, st model.Store) (*model.Dataset, error) {
	s.mu.Lock()
	if ds, ok := s.datasets[st.ID]; ok {
		s.mu.Unlock()
		return ds, nil
	}
	l, ok := s.loading[st.ID]
	if !ok {
		l = &sync.Mutex{}
		s.loading[st.ID] = l
	}
	s.mu.Unlock()
	l.Lock()
	defer l.Unlock()
	s.mu.Lock()
	if ds, ok := s.datasets[st.ID]; ok {
		s.mu.Unlock()
		return ds, nil
	}
	s.mu.Unlock()
	start := time.Now()
	ds, err := s.Repo.LoadDataset(ctx, st)
	if err != nil {
		return nil, err
	}
	// Re-anchor whole days so seeded data stays current.
	if delta := time.Since(ds.Now); delta > time.Hour {
		ds.Shift(delta.Truncate(24 * time.Hour))
	}
	ds.Now = time.Now()
	slog.Info("dataset loaded", "store", st.ID, "orders", len(ds.Orders), "took", time.Since(start))
	s.mu.Lock()
	s.datasets[st.ID] = ds
	s.mu.Unlock()
	return ds, nil
}

// CreateDemoStore generates and persists a seeded demo store for an org.
func (s *Service) CreateDemoStore(ctx context.Context, orgID, businessType, name string) (*model.Store, error) {
	now := time.Now()
	st := model.Store{ID: repo.NewID("st"), OrgID: orgID, Name: name, Platform: "demo", BusinessType: businessType, Currency: "INR", SeededAt: now, CreatedAt: now}
	ds := seed.Generate(st, now)
	st.Name = ds.Store.Name
	ds.Store = st
	if err := s.Repo.CreateStore(ctx, st, ds); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.datasets[st.ID] = ds
	s.mu.Unlock()
	return &st, nil
}

// Report runs (or returns the cached) agent analysis for a store and range.
func (s *Service) Report(ctx context.Context, st model.Store, rangeKey, from, to string) (*agents.Report, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return nil, err
	}
	// Shallow copy: the shared dataset is read-only; only the clock moves.
	snapshot := *ds
	snapshot.Now = time.Now()
	ds = &snapshot
	r := analytics.ParseRange(rangeKey, from, to, ds.Now)
	key := fmt.Sprintf("%s|%s|%s|%s", st.ID, r.Key, r.From.Format(time.DateOnly), r.To.Format(time.DateOnly))
	s.mu.Lock()
	if c, ok := s.reports[key]; ok && time.Now().Before(c.exp) {
		s.mu.Unlock()
		return c.rep, nil
	}
	s.mu.Unlock()
	rep := agents.Run(ds, r)
	if err := s.applyState(ctx, st.ID, rep); err != nil {
		slog.Warn("apply state", "err", err)
	}
	s.mu.Lock()
	s.reports[key] = &cachedReport{rep: rep, exp: time.Now().Add(reportTTL)}
	s.mu.Unlock()
	if r.Key == "30d" {
		go s.persistInsights(st.ID, rep)
	}
	return rep, nil
}

// InvalidateStore drops cached reports after user actions change state.
func (s *Service) InvalidateStore(storeID string) {
	s.mu.Lock()
	for k := range s.reports {
		if len(k) > len(storeID) && k[:len(storeID)] == storeID {
			delete(s.reports, k)
		}
	}
	s.mu.Unlock()
	s.Cache.DeletePrefix(context.Background(), "resp:"+storeID)
}

// applyState merges persisted user state (dismissed/assigned insights, paused
// agents) into a fresh report.
func (s *Service) applyState(ctx context.Context, storeID string, rep *agents.Report) error {
	states, err := s.Repo.InsightStates(ctx, storeID)
	if err != nil {
		return err
	}
	settings, err := s.Repo.AgentSettings(ctx, storeID)
	if err != nil {
		return err
	}
	set := func(in *agents.Insight) {
		in.Status = "new"
		if st, ok := states[in.ID]; ok {
			in.Status, in.Assignee = st.Status, st.Assignee
		}
	}
	for _, id := range agents.AgentOrder {
		res := rep.Results[id]
		for i := range res.Insights {
			set(&res.Insights[i])
		}
		if cfg, ok := settings[id]; ok && cfg.Paused {
			res.Summary.Status = "paused"
		}
	}
	for i := range rep.Business {
		set(&rep.Business[i].Insight)
	}
	for i := range rep.BusinessRes.Insights {
		set(&rep.BusinessRes.Insights[i])
	}
	return nil
}

func (s *Service) persistInsights(storeID string, rep *agents.Report) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var out []repo.SavedInsight
	add := func(in agents.Insight, payload any) {
		b, _ := json.Marshal(payload)
		out = append(out, repo.SavedInsight{ID: in.ID, AgentID: in.AgentID, Severity: in.Severity, Title: in.Title, Payload: b, DetectedAt: in.DetectedAt})
	}
	for _, in := range rep.AllInsights() {
		add(in, in)
	}
	for _, b := range rep.Business {
		add(b.Insight, b)
	}
	if err := s.Repo.SaveInsights(ctx, storeID, out); err != nil {
		slog.Warn("persist insights", "err", err)
	}
}

// PausedAgents returns the IDs of agents the user has paused.
func (s *Service) PausedAgents(ctx context.Context, storeID string) map[string]bool {
	out := map[string]bool{}
	settings, err := s.Repo.AgentSettings(ctx, storeID)
	if err != nil {
		return out
	}
	for id, cfg := range settings {
		if cfg.Paused {
			out[id] = true
		}
	}
	return out
}

// SetReviewResponse persists a published reply and swaps in a copy of the
// dataset (copy-on-write keeps concurrent analyses race-free).
func (s *Service) SetReviewResponse(ctx context.Context, st model.Store, reviewID, text string) error {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return err
	}
	idx := -1
	for i := range ds.Reviews {
		if ds.Reviews[i].ID == reviewID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return repo.ErrNotFound
	}
	if err := s.Repo.SetReviewResponse(ctx, st.ID, reviewID, text); err != nil {
		return err
	}
	next := *ds
	next.Reviews = append([]model.Review(nil), ds.Reviews...)
	next.Reviews[idx].Response = text
	s.mu.Lock()
	s.datasets[st.ID] = &next
	s.mu.Unlock()
	s.InvalidateStore(st.ID)
	return nil
}
