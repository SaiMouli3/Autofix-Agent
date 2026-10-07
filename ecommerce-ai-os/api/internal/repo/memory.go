package repo

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

// Memory is a concurrency-safe in-memory repository.
type Memory struct {
	mu       sync.RWMutex
	orgs     map[string]model.Organization
	users    map[string]model.User
	byEmail  map[string]string
	stores   map[string]model.Store
	datasets map[string]*model.Dataset
	insights map[string]map[string]InsightState
	notifs   map[string]map[string]NotificationState
	settings map[string]map[string]AgentSettings
	actions  map[string][]UserAction
}

func NewMemory() *Memory {
	return &Memory{
		orgs: map[string]model.Organization{}, users: map[string]model.User{}, byEmail: map[string]string{},
		stores: map[string]model.Store{}, datasets: map[string]*model.Dataset{},
		insights: map[string]map[string]InsightState{}, notifs: map[string]map[string]NotificationState{},
		settings: map[string]map[string]AgentSettings{}, actions: map[string][]UserAction{},
	}
}

func (m *Memory) Close()                         {}
func (m *Memory) Ping(ctx context.Context) error { return nil }

func (m *Memory) CreateOrgUser(ctx context.Context, orgName string, u model.User) (*model.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	email := strings.ToLower(u.Email)
	if _, ok := m.byEmail[email]; ok {
		return nil, ErrConflict
	}
	org := model.Organization{ID: NewID("org"), Name: orgName, CreatedAt: time.Now()}
	m.orgs[org.ID] = org
	u.ID, u.OrgID, u.Email, u.CreatedAt = NewID("usr"), org.ID, email, time.Now()
	if u.Role == "" {
		u.Role = "owner"
	}
	m.users[u.ID] = u
	m.byEmail[email] = u.ID
	return &u, nil
}

func (m *Memory) UserByEmail(ctx context.Context, email string) (*model.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.byEmail[strings.ToLower(email)]
	if !ok {
		return nil, ErrNotFound
	}
	u := m.users[id]
	return &u, nil
}

func (m *Memory) UserByID(ctx context.Context, id string) (*model.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	u, ok := m.users[id]
	if !ok {
		return nil, ErrNotFound
	}
	return &u, nil
}

func (m *Memory) Org(ctx context.Context, id string) (*model.Organization, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	o, ok := m.orgs[id]
	if !ok {
		return nil, ErrNotFound
	}
	return &o, nil
}

func (m *Memory) StoresByOrg(ctx context.Context, orgID string) ([]model.Store, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var out []model.Store
	for _, s := range m.stores {
		if s.OrgID == orgID {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (m *Memory) StoreForOrg(ctx context.Context, orgID, storeID string) (*model.Store, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.stores[storeID]
	if !ok || s.OrgID != orgID {
		return nil, ErrNotFound
	}
	return &s, nil
}

func (m *Memory) StoreByID(ctx context.Context, storeID string) (*model.Store, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.stores[storeID]
	if !ok {
		return nil, ErrNotFound
	}
	return &s, nil
}

func (m *Memory) CreateStore(ctx context.Context, s model.Store, ds *model.Dataset) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stores[s.ID] = s
	m.datasets[s.ID] = ds
	return nil
}

func (m *Memory) LoadDataset(ctx context.Context, s model.Store) (*model.Dataset, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ds, ok := m.datasets[s.ID]
	if !ok {
		return nil, ErrNotFound
	}
	return ds, nil
}

func (m *Memory) InsightStates(ctx context.Context, storeID string) (map[string]InsightState, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := map[string]InsightState{}
	for k, v := range m.insights[storeID] {
		out[k] = v
	}
	return out, nil
}

func (m *Memory) SetInsightState(ctx context.Context, storeID, id string, st InsightState) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.insights[storeID] == nil {
		m.insights[storeID] = map[string]InsightState{}
	}
	st.UpdatedAt = time.Now()
	m.insights[storeID][id] = st
	return nil
}

func (m *Memory) SaveInsights(ctx context.Context, storeID string, ins []SavedInsight) error {
	return nil
}

func (m *Memory) NotificationStates(ctx context.Context, storeID string) (map[string]NotificationState, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := map[string]NotificationState{}
	for k, v := range m.notifs[storeID] {
		out[k] = v
	}
	return out, nil
}

func (m *Memory) SetNotificationStates(ctx context.Context, storeID string, ids []string, read, dismissed *bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.notifs[storeID] == nil {
		m.notifs[storeID] = map[string]NotificationState{}
	}
	for _, id := range ids {
		st := m.notifs[storeID][id]
		if read != nil {
			st.Read = *read
		}
		if dismissed != nil {
			st.Dismissed = *dismissed
		}
		m.notifs[storeID][id] = st
	}
	return nil
}

func (m *Memory) AgentSettings(ctx context.Context, storeID string) (map[string]AgentSettings, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := map[string]AgentSettings{}
	for k, v := range m.settings[storeID] {
		out[k] = v
	}
	return out, nil
}

func (m *Memory) SetAgentSettings(ctx context.Context, storeID, agentID string, s AgentSettings) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.settings[storeID] == nil {
		m.settings[storeID] = map[string]AgentSettings{}
	}
	m.settings[storeID][agentID] = s
	return nil
}

func (m *Memory) SetReviewResponse(ctx context.Context, storeID, reviewID, text string) error {
	return nil // the service updates the in-memory dataset directly
}

func (m *Memory) AddShopOrder(ctx context.Context, storeID string, o model.Order, newCustomer *model.Customer, sh model.Shipment, stock []model.InventoryItem) error {
	return nil // the service updates the in-memory dataset directly
}

func (m *Memory) AddAction(ctx context.Context, storeID string, a UserAction) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.actions[storeID] = append(m.actions[storeID], a)
	return nil
}

func (m *Memory) Actions(ctx context.Context, storeID string, limit int) ([]UserAction, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	src := m.actions[storeID]
	out := make([]UserAction, 0, len(src))
	for i := len(src) - 1; i >= 0 && (limit <= 0 || len(out) < limit); i-- {
		out = append(out, src[i])
	}
	return out, nil
}
