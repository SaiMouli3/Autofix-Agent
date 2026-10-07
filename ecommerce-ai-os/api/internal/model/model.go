// Package model defines the normalized business entities shared by the
// repository, the seed generator and the agent layer. Every business entity
// is scoped to a Store, and every Store belongs to an Organization.
package model

import "time"

type Organization struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

type User struct {
	ID           string    `json:"id"`
	OrgID        string    `json:"orgId"`
	Name         string    `json:"name"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Store struct {
	ID           string    `json:"id"`
	OrgID        string    `json:"orgId"`
	Name         string    `json:"name"`
	Platform     string    `json:"platform"`
	BusinessType string    `json:"businessType"`
	Currency     string    `json:"currency"`
	SeededAt     time.Time `json:"seededAt"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Product struct {
	ID         string    `json:"id"`
	StoreID    string    `json:"-"`
	SKU        string    `json:"sku"`
	Name       string    `json:"name"`
	Category   string    `json:"category"`
	Price      float64   `json:"price"`
	Cost       float64   `json:"cost"`
	Supplier   string    `json:"supplier"`
	LaunchedAt time.Time `json:"launchedAt"`
}

type Customer struct {
	ID        string    `json:"id"`
	StoreID   string    `json:"-"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Phone     string    `json:"phone"`
	City      string    `json:"city"`
	State     string    `json:"state"`
	Region    string    `json:"region"`
	CreatedAt time.Time `json:"createdAt"`
}

type OrderItem struct {
	OrderID   string  `json:"-"`
	ProductID string  `json:"productId"`
	Qty       int     `json:"qty"`
	UnitPrice float64 `json:"unitPrice"`
	UnitCost  float64 `json:"unitCost"`
}

// Order status lifecycle values.
const (
	OrderProcessing = "processing"
	OrderShipped    = "in_transit"
	OrderDelivered  = "delivered"
	OrderNDR        = "ndr"
	OrderRTO        = "rto"
	OrderCancelled  = "cancelled"
	OrderReturned   = "returned"
)

type Order struct {
	ID            string      `json:"id"`
	StoreID       string      `json:"-"`
	Number        string      `json:"number"`
	CustomerID    string      `json:"customerId"`
	CreatedAt     time.Time   `json:"createdAt"`
	Status        string      `json:"status"`
	PaymentMethod string      `json:"paymentMethod"` // cod | prepaid
	Subtotal      float64     `json:"subtotal"`
	Discount      float64     `json:"discount"`
	ShippingFee   float64     `json:"shippingFee"`
	Total         float64     `json:"total"`
	CampaignID    string      `json:"campaignId"` // attribution, "" = direct/organic
	Channel       string      `json:"channel"`
	Items         []OrderItem `json:"items"`
}

type Shipment struct {
	OrderID     string     `json:"orderId"`
	Courier     string     `json:"courier"`
	State       string     `json:"state"`
	Region      string     `json:"region"`
	ShippedAt   *time.Time `json:"shippedAt"`
	PromisedAt  time.Time  `json:"promisedAt"`
	DeliveredAt *time.Time `json:"deliveredAt"`
	NDRAttempts int        `json:"ndrAttempts"`
	Status      string     `json:"status"`
	Cost        float64    `json:"cost"`
}

type Return struct {
	ID        string    `json:"id"`
	OrderID   string    `json:"orderId"`
	ProductID string    `json:"productId"`
	Qty       int       `json:"qty"`
	Reason    string    `json:"reason"`
	CreatedAt time.Time `json:"createdAt"`
	Status    string    `json:"status"`
}

type Refund struct {
	ID        string    `json:"id"`
	OrderID   string    `json:"orderId"`
	ReturnID  string    `json:"returnId"`
	Amount    float64   `json:"amount"`
	Reason    string    `json:"reason"`
	CreatedAt time.Time `json:"createdAt"`
}

type Review struct {
	ID         string    `json:"id"`
	ProductID  string    `json:"productId"`
	CustomerID string    `json:"customerId"`
	OrderID    string    `json:"orderId"`
	Rating     int       `json:"rating"`
	Title      string    `json:"title"`
	Body       string    `json:"body"`
	Source     string    `json:"source"`
	Sentiment  string    `json:"sentiment"`
	Themes     []string  `json:"themes"`
	CreatedAt  time.Time `json:"createdAt"`
	Response   string    `json:"response"`
}

type Ticket struct {
	ID              string     `json:"id"`
	CustomerID      string     `json:"customerId"`
	OrderID         string     `json:"orderId"`
	ProductID       string     `json:"productId"`
	Channel         string     `json:"channel"`
	Category        string     `json:"category"`
	Subject         string     `json:"subject"`
	Message         string     `json:"message"`
	Priority        string     `json:"priority"`
	Status          string     `json:"status"` // open | pending | resolved
	IsComplaint     bool       `json:"isComplaint"`
	Escalated       bool       `json:"escalated"`
	ClusterKey      string     `json:"clusterKey"`
	CreatedAt       time.Time  `json:"createdAt"`
	FirstResponseAt *time.Time `json:"firstResponseAt"`
	ResolvedAt      *time.Time `json:"resolvedAt"`
}

type InventoryItem struct {
	ProductID    string    `json:"productId"`
	Warehouse    string    `json:"warehouse"`
	OnHand       int       `json:"onHand"`
	Reserved     int       `json:"reserved"`
	ReorderPoint int       `json:"reorderPoint"`
	LeadTimeDays int       `json:"leadTimeDays"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type InventorySnapshot struct {
	Date      time.Time `json:"date"`
	Units     int       `json:"units"`
	Value     float64   `json:"value"`
	Restocked float64   `json:"restocked"` // value of stock received that day
	Stockouts int       `json:"stockouts"`
	LowStock  int       `json:"lowStock"`
}

type Campaign struct {
	ID          string    `json:"id"`
	Channel     string    `json:"channel"`
	Name        string    `json:"name"`
	Objective   string    `json:"objective"`
	Status      string    `json:"status"`
	DailyBudget float64   `json:"dailyBudget"`
	StartedAt   time.Time `json:"startedAt"`
}

type CampaignMetric struct {
	CampaignID  string    `json:"campaignId"`
	Date        time.Time `json:"date"`
	Spend       float64   `json:"spend"`
	Impressions int       `json:"impressions"`
	Clicks      int       `json:"clicks"`
}

type TrafficDaily struct {
	Date        time.Time `json:"date"`
	Channel     string    `json:"channel"`
	Sessions    int       `json:"sessions"`
	ProductView int       `json:"productViews"`
	AddToCart   int       `json:"addToCart"`
	Checkout    int       `json:"checkout"`
}

type Competitor struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Domain string  `json:"domain"`
	Rating float64 `json:"rating"`
}

type CompetitorPrice struct {
	CompetitorID string    `json:"competitorId"`
	ProductID    string    `json:"productId"` // our matched product
	Title        string    `json:"title"`
	Price        float64   `json:"price"`
	ListPrice    float64   `json:"listPrice"`
	Rating       float64   `json:"rating"`
	InStock      bool      `json:"inStock"`
	CapturedAt   time.Time `json:"capturedAt"`
}

type FinancialDaily struct {
	Date            time.Time `json:"date"`
	Opex            float64   `json:"opex"`
	PaymentFailures int       `json:"paymentFailures"`
	FailedAmount    float64   `json:"failedAmount"`
}

type NewsArticle struct {
	ID             string    `json:"id"`
	Title          string    `json:"title"`
	Source         string    `json:"source"`
	URL            string    `json:"url"`
	PublishedAt    time.Time `json:"publishedAt"`
	Category       string    `json:"category"`
	Relevance      int       `json:"relevance"` // 0-100
	Impact         string    `json:"impact"`    // high | medium | low
	Summary        string    `json:"summary"`
	WhyItMatters   string    `json:"whyItMatters"`
	Recommendation string    `json:"recommendation"`
	RelatedEntity  string    `json:"relatedEntity"`
}

// Dataset is the complete business data of one store, loaded into memory for
// deterministic analytics. Indices are built by Index().
type Dataset struct {
	Store       Store
	Now         time.Time
	Products    []Product
	Customers   []Customer
	Orders      []Order
	Shipments   []Shipment
	Returns     []Return
	Refunds     []Refund
	Reviews     []Review
	Tickets     []Ticket
	Inventory   []InventoryItem
	InvHistory  []InventorySnapshot
	Campaigns   []Campaign
	CampMetrics []CampaignMetric
	Traffic     []TrafficDaily
	Competitors []Competitor
	CompPrices  []CompetitorPrice
	Finance     []FinancialDaily
	News        []NewsArticle

	ProductByID    map[string]*Product
	CustomerByID   map[string]*Customer
	OrderByID      map[string]*Order
	ShipByOrder    map[string]*Shipment
	CampaignByID   map[string]*Campaign
	CompetitorByID map[string]*Competitor
	InvByProduct   map[string]*InventoryItem
	OrdersByCust   map[string][]*Order
}

func (d *Dataset) Index() {
	d.ProductByID = make(map[string]*Product, len(d.Products))
	for i := range d.Products {
		d.ProductByID[d.Products[i].ID] = &d.Products[i]
	}
	d.CustomerByID = make(map[string]*Customer, len(d.Customers))
	for i := range d.Customers {
		d.CustomerByID[d.Customers[i].ID] = &d.Customers[i]
	}
	d.OrderByID = make(map[string]*Order, len(d.Orders))
	d.OrdersByCust = make(map[string][]*Order, len(d.Customers))
	for i := range d.Orders {
		o := &d.Orders[i]
		d.OrderByID[o.ID] = o
		d.OrdersByCust[o.CustomerID] = append(d.OrdersByCust[o.CustomerID], o)
	}
	d.ShipByOrder = make(map[string]*Shipment, len(d.Shipments))
	for i := range d.Shipments {
		d.ShipByOrder[d.Shipments[i].OrderID] = &d.Shipments[i]
	}
	d.CampaignByID = make(map[string]*Campaign, len(d.Campaigns))
	for i := range d.Campaigns {
		d.CampaignByID[d.Campaigns[i].ID] = &d.Campaigns[i]
	}
	d.CompetitorByID = make(map[string]*Competitor, len(d.Competitors))
	for i := range d.Competitors {
		d.CompetitorByID[d.Competitors[i].ID] = &d.Competitors[i]
	}
	d.InvByProduct = make(map[string]*InventoryItem, len(d.Inventory))
	for i := range d.Inventory {
		d.InvByProduct[d.Inventory[i].ProductID] = &d.Inventory[i]
	}
}

// Shift moves every timestamp forward by delta so that a dataset seeded in the
// past stays anchored to "today" when it is loaded.
func (d *Dataset) Shift(delta time.Duration) {
	if delta <= 0 {
		return
	}
	sp := func(t *time.Time) {
		if t != nil {
			*t = t.Add(delta)
		}
	}
	d.Now = d.Now.Add(delta)
	for i := range d.Products {
		sp(&d.Products[i].LaunchedAt)
	}
	for i := range d.Customers {
		sp(&d.Customers[i].CreatedAt)
	}
	for i := range d.Orders {
		sp(&d.Orders[i].CreatedAt)
	}
	for i := range d.Shipments {
		s := &d.Shipments[i]
		sp(s.ShippedAt)
		sp(&s.PromisedAt)
		sp(s.DeliveredAt)
	}
	for i := range d.Returns {
		sp(&d.Returns[i].CreatedAt)
	}
	for i := range d.Refunds {
		sp(&d.Refunds[i].CreatedAt)
	}
	for i := range d.Reviews {
		sp(&d.Reviews[i].CreatedAt)
	}
	for i := range d.Tickets {
		t := &d.Tickets[i]
		sp(&t.CreatedAt)
		sp(t.FirstResponseAt)
		sp(t.ResolvedAt)
	}
	for i := range d.Inventory {
		sp(&d.Inventory[i].UpdatedAt)
	}
	for i := range d.InvHistory {
		sp(&d.InvHistory[i].Date)
	}
	for i := range d.Campaigns {
		sp(&d.Campaigns[i].StartedAt)
	}
	for i := range d.CampMetrics {
		sp(&d.CampMetrics[i].Date)
	}
	for i := range d.Traffic {
		sp(&d.Traffic[i].Date)
	}
	for i := range d.CompPrices {
		sp(&d.CompPrices[i].CapturedAt)
	}
	for i := range d.Finance {
		sp(&d.Finance[i].Date)
	}
	for i := range d.News {
		sp(&d.News[i].PublishedAt)
	}
}
