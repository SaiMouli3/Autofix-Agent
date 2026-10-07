// Package repo is the persistence boundary. Two implementations exist:
// Postgres (production) and an in-memory store (zero-dependency local runs
// and tests). Both enforce the same organization → store scoping.
package repo

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("already exists")
)

type InsightState struct {
	Status    string    `json:"status"`
	Assignee  string    `json:"assignee"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type NotificationState struct {
	Read      bool `json:"read"`
	Dismissed bool `json:"dismissed"`
}

type AgentSettings struct {
	Paused      bool               `json:"paused"`
	Sensitivity string             `json:"sensitivity"` // low | balanced | high
	Notify      map[string]bool    `json:"notify"`      // critical / important / opportunity / market
	Thresholds  map[string]float64 `json:"thresholds"`
	Digest      string             `json:"digest"` // realtime | daily | weekly
}

func DefaultAgentSettings() AgentSettings {
	return AgentSettings{Sensitivity: "balanced", Digest: "realtime",
		Notify:     map[string]bool{"critical": true, "important": true, "opportunity": true, "market": false},
		Thresholds: map[string]float64{}}
}

// UserAction is an action a user took from an insight (assign, create PO...).
type UserAction struct {
	ID        string    `json:"id"`
	AgentID   string    `json:"agentId"`
	InsightID string    `json:"insightId"`
	UserID    string    `json:"userId"`
	Kind      string    `json:"kind"`
	Message   string    `json:"message"`
	At        time.Time `json:"at"`
}

// SavedInsight is the persisted form of an agent finding.
type SavedInsight struct {
	ID         string
	AgentID    string
	Severity   string
	Title      string
	Payload    []byte
	DetectedAt time.Time
}

type Repo interface {
	Close()
	Ping(ctx context.Context) error

	CreateOrgUser(ctx context.Context, orgName string, u model.User) (*model.User, error)
	UserByEmail(ctx context.Context, email string) (*model.User, error)
	UserByID(ctx context.Context, id string) (*model.User, error)
	Org(ctx context.Context, id string) (*model.Organization, error)

	StoresByOrg(ctx context.Context, orgID string) ([]model.Store, error)
	// StoreForOrg returns the store only if it belongs to orgID.
	StoreForOrg(ctx context.Context, orgID, storeID string) (*model.Store, error)
	// StoreByID is for the public storefront only; it bypasses org scoping.
	StoreByID(ctx context.Context, storeID string) (*model.Store, error)
	CreateStore(ctx context.Context, s model.Store, ds *model.Dataset) error
	LoadDataset(ctx context.Context, s model.Store) (*model.Dataset, error)

	InsightStates(ctx context.Context, storeID string) (map[string]InsightState, error)
	SetInsightState(ctx context.Context, storeID, insightID string, st InsightState) error
	SaveInsights(ctx context.Context, storeID string, ins []SavedInsight) error

	NotificationStates(ctx context.Context, storeID string) (map[string]NotificationState, error)
	SetNotificationStates(ctx context.Context, storeID string, ids []string, read, dismissed *bool) error

	AgentSettings(ctx context.Context, storeID string) (map[string]AgentSettings, error)
	SetAgentSettings(ctx context.Context, storeID, agentID string, s AgentSettings) error

	SetReviewResponse(ctx context.Context, storeID, reviewID, text string) error

	// AddShopOrder persists a storefront order: the customer (when new), the
	// order and its items, its shipment, and the decremented stock levels.
	AddShopOrder(ctx context.Context, storeID string, o model.Order, newCustomer *model.Customer, sh model.Shipment, stock []model.InventoryItem) error

	AddAction(ctx context.Context, storeID string, a UserAction) error
	Actions(ctx context.Context, storeID string, limit int) ([]UserAction, error)
}

func NewID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}
