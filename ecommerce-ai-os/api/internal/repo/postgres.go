package repo

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

//go:embed migrations/*.sql
var migrations embed.FS

var ist = time.FixedZone("IST", 5*3600+1800)

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(ctx context.Context, url string) (*Postgres, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 16
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}
	p := &Postgres{pool: pool}
	return p, p.migrate(ctx)
}

func (p *Postgres) migrate(ctx context.Context) error {
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	for _, e := range entries {
		sql, err := migrations.ReadFile("migrations/" + e.Name())
		if err != nil {
			return err
		}
		if _, err := p.pool.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("migration %s: %w", e.Name(), err)
		}
	}
	return nil
}

func (p *Postgres) Close()                         { p.pool.Close() }
func (p *Postgres) Ping(ctx context.Context) error { return p.pool.Ping(ctx) }

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (p *Postgres) CreateOrgUser(ctx context.Context, orgName string, u model.User) (*model.User, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	orgID := NewID("org")
	if _, err := tx.Exec(ctx, `INSERT INTO organizations (id, name) VALUES ($1, $2)`, orgID, orgName); err != nil {
		return nil, err
	}
	u.ID, u.OrgID, u.Email, u.CreatedAt = NewID("usr"), orgID, strings.ToLower(u.Email), time.Now()
	if u.Role == "" {
		u.Role = "owner"
	}
	_, err = tx.Exec(ctx, `INSERT INTO users (id, org_id, name, email, password_hash, role, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		u.ID, u.OrgID, u.Name, u.Email, u.PasswordHash, u.Role, u.CreatedAt)
	if err != nil {
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" {
			return nil, ErrConflict
		}
		return nil, err
	}
	return &u, tx.Commit(ctx)
}

const userCols = `id, org_id, name, email, password_hash, role, created_at`

func scanUser(row pgx.Row) (*model.User, error) {
	var u model.User
	if err := row.Scan(&u.ID, &u.OrgID, &u.Name, &u.Email, &u.PasswordHash, &u.Role, &u.CreatedAt); err != nil {
		return nil, notFound(err)
	}
	return &u, nil
}

func (p *Postgres) UserByEmail(ctx context.Context, email string) (*model.User, error) {
	return scanUser(p.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE email = $1`, strings.ToLower(email)))
}

func (p *Postgres) UserByID(ctx context.Context, id string) (*model.User, error) {
	return scanUser(p.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id = $1`, id))
}

func (p *Postgres) Org(ctx context.Context, id string) (*model.Organization, error) {
	var o model.Organization
	err := p.pool.QueryRow(ctx, `SELECT id, name, created_at FROM organizations WHERE id = $1`, id).Scan(&o.ID, &o.Name, &o.CreatedAt)
	if err != nil {
		return nil, notFound(err)
	}
	return &o, nil
}

const storeCols = `id, org_id, name, platform, business_type, currency, seeded_at, created_at`

func scanStore(row pgx.Row) (model.Store, error) {
	var s model.Store
	err := row.Scan(&s.ID, &s.OrgID, &s.Name, &s.Platform, &s.BusinessType, &s.Currency, &s.SeededAt, &s.CreatedAt)
	return s, err
}

func (p *Postgres) StoresByOrg(ctx context.Context, orgID string) ([]model.Store, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+storeCols+` FROM stores WHERE org_id = $1 ORDER BY created_at`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Store
	for rows.Next() {
		s, err := scanStore(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (p *Postgres) StoreForOrg(ctx context.Context, orgID, storeID string) (*model.Store, error) {
	s, err := scanStore(p.pool.QueryRow(ctx, `SELECT `+storeCols+` FROM stores WHERE id = $1 AND org_id = $2`, storeID, orgID))
	if err != nil {
		return nil, notFound(err)
	}
	return &s, nil
}

func (p *Postgres) StoreByID(ctx context.Context, storeID string) (*model.Store, error) {
	s, err := scanStore(p.pool.QueryRow(ctx, `SELECT `+storeCols+` FROM stores WHERE id = $1`, storeID))
	if err != nil {
		return nil, notFound(err)
	}
	return &s, nil
}

func nz(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// CreateStore persists the store and its full dataset in one transaction
// using COPY for the large tables.
func (p *Postgres) CreateStore(ctx context.Context, s model.Store, ds *model.Dataset) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO stores (`+storeCols+`) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		s.ID, s.OrgID, s.Name, s.Platform, s.BusinessType, s.Currency, s.SeededAt, s.CreatedAt); err != nil {
		return err
	}
	id := s.ID
	copyRows := func(table string, cols []string, n int, row func(i int) []any) error {
		rows := make([][]any, n)
		for i := 0; i < n; i++ {
			rows[i] = append([]any{id}, row(i)...)
		}
		_, err := tx.CopyFrom(ctx, pgx.Identifier{table}, append([]string{"store_id"}, cols...), pgx.CopyFromRows(rows))
		if err != nil {
			return fmt.Errorf("copy %s: %w", table, err)
		}
		return nil
	}
	day := func(t time.Time) time.Time {
		t = t.In(ist)
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	}

	steps := []func() error{
		func() error {
			return copyRows("products", []string{"id", "sku", "name", "category", "price", "cost", "supplier", "launched_at"}, len(ds.Products), func(i int) []any {
				x := ds.Products[i]
				return []any{x.ID, x.SKU, x.Name, x.Category, x.Price, x.Cost, x.Supplier, x.LaunchedAt}
			})
		},
		func() error {
			return copyRows("customers", []string{"id", "name", "email", "phone", "city", "state", "region", "created_at"}, len(ds.Customers), func(i int) []any {
				x := ds.Customers[i]
				return []any{x.ID, x.Name, x.Email, x.Phone, x.City, x.State, x.Region, x.CreatedAt}
			})
		},
		func() error {
			return copyRows("marketing_campaigns", []string{"id", "channel", "name", "objective", "status", "daily_budget", "started_at"}, len(ds.Campaigns), func(i int) []any {
				x := ds.Campaigns[i]
				return []any{x.ID, x.Channel, x.Name, x.Objective, x.Status, x.DailyBudget, x.StartedAt}
			})
		},
		func() error {
			return copyRows("orders", []string{"id", "number", "customer_id", "created_at", "status", "payment_method", "subtotal", "discount", "shipping_fee", "total", "campaign_id", "channel"}, len(ds.Orders), func(i int) []any {
				x := ds.Orders[i]
				return []any{x.ID, x.Number, x.CustomerID, x.CreatedAt, x.Status, x.PaymentMethod, x.Subtotal, x.Discount, x.ShippingFee, x.Total, nz(x.CampaignID), x.Channel}
			})
		},
		func() error {
			var items []model.OrderItem
			for _, o := range ds.Orders {
				for _, it := range o.Items {
					it.OrderID = o.ID
					items = append(items, it)
				}
			}
			return copyRows("order_items", []string{"order_id", "product_id", "qty", "unit_price", "unit_cost"}, len(items), func(i int) []any {
				x := items[i]
				return []any{x.OrderID, x.ProductID, x.Qty, x.UnitPrice, x.UnitCost}
			})
		},
		func() error {
			return copyRows("shipments", []string{"order_id", "courier", "state", "region", "shipped_at", "promised_at", "delivered_at", "ndr_attempts", "status", "cost"}, len(ds.Shipments), func(i int) []any {
				x := ds.Shipments[i]
				return []any{x.OrderID, x.Courier, x.State, x.Region, x.ShippedAt, x.PromisedAt, x.DeliveredAt, x.NDRAttempts, x.Status, x.Cost}
			})
		},
		func() error {
			return copyRows("returns", []string{"id", "order_id", "product_id", "qty", "reason", "status", "created_at"}, len(ds.Returns), func(i int) []any {
				x := ds.Returns[i]
				return []any{x.ID, x.OrderID, x.ProductID, x.Qty, x.Reason, x.Status, x.CreatedAt}
			})
		},
		func() error {
			return copyRows("refunds", []string{"id", "order_id", "return_id", "amount", "reason", "created_at"}, len(ds.Refunds), func(i int) []any {
				x := ds.Refunds[i]
				return []any{x.ID, x.OrderID, nz(x.ReturnID), x.Amount, x.Reason, x.CreatedAt}
			})
		},
		func() error {
			return copyRows("reviews", []string{"id", "product_id", "customer_id", "order_id", "rating", "title", "body", "source", "sentiment", "themes", "response", "created_at"}, len(ds.Reviews), func(i int) []any {
				x := ds.Reviews[i]
				return []any{x.ID, x.ProductID, x.CustomerID, x.OrderID, int16(x.Rating), x.Title, x.Body, x.Source, x.Sentiment, x.Themes, x.Response, x.CreatedAt}
			})
		},
		func() error {
			return copyRows("support_tickets", []string{"id", "customer_id", "order_id", "product_id", "channel", "category", "subject", "message", "priority", "status", "escalated", "created_at", "first_response_at", "resolved_at"}, len(ds.Tickets), func(i int) []any {
				x := ds.Tickets[i]
				return []any{x.ID, x.CustomerID, nz(x.OrderID), nz(x.ProductID), x.Channel, x.Category, x.Subject, x.Message, x.Priority, x.Status, x.Escalated, x.CreatedAt, x.FirstResponseAt, x.ResolvedAt}
			})
		},
		func() error {
			var cs []model.Ticket
			for _, t := range ds.Tickets {
				if t.IsComplaint {
					cs = append(cs, t)
				}
			}
			return copyRows("complaints", []string{"ticket_id", "cluster_key"}, len(cs), func(i int) []any { return []any{cs[i].ID, cs[i].ClusterKey} })
		},
		func() error {
			return copyRows("inventory", []string{"product_id", "warehouse", "on_hand", "reserved", "reorder_point", "lead_time_days", "updated_at"}, len(ds.Inventory), func(i int) []any {
				x := ds.Inventory[i]
				return []any{x.ProductID, x.Warehouse, x.OnHand, x.Reserved, x.ReorderPoint, x.LeadTimeDays, x.UpdatedAt}
			})
		},
		func() error {
			return copyRows("inventory_snapshots", []string{"date", "units", "value", "restocked", "stockouts", "low_stock"}, len(ds.InvHistory), func(i int) []any {
				x := ds.InvHistory[i]
				return []any{day(x.Date), x.Units, x.Value, x.Restocked, x.Stockouts, x.LowStock}
			})
		},
		func() error {
			return copyRows("marketing_metrics", []string{"campaign_id", "date", "spend", "impressions", "clicks"}, len(ds.CampMetrics), func(i int) []any {
				x := ds.CampMetrics[i]
				return []any{x.CampaignID, day(x.Date), x.Spend, x.Impressions, x.Clicks}
			})
		},
		func() error {
			return copyRows("traffic_daily", []string{"date", "channel", "sessions", "product_views", "add_to_cart", "checkout"}, len(ds.Traffic), func(i int) []any {
				x := ds.Traffic[i]
				return []any{day(x.Date), x.Channel, x.Sessions, x.ProductView, x.AddToCart, x.Checkout}
			})
		},
		func() error {
			return copyRows("competitors", []string{"id", "name", "domain", "rating"}, len(ds.Competitors), func(i int) []any {
				x := ds.Competitors[i]
				return []any{x.ID, x.Name, x.Domain, x.Rating}
			})
		},
		func() error {
			return copyRows("competitor_prices", []string{"competitor_id", "product_id", "title", "price", "list_price", "rating", "in_stock", "captured_at"}, len(ds.CompPrices), func(i int) []any {
				x := ds.CompPrices[i]
				return []any{x.CompetitorID, x.ProductID, x.Title, x.Price, x.ListPrice, x.Rating, x.InStock, x.CapturedAt}
			})
		},
		func() error {
			return copyRows("financial_metrics", []string{"date", "opex", "payment_failures", "failed_amount"}, len(ds.Finance), func(i int) []any {
				x := ds.Finance[i]
				return []any{day(x.Date), x.Opex, x.PaymentFailures, x.FailedAmount}
			})
		},
		func() error {
			return copyRows("news", []string{"id", "title", "source", "url", "published_at", "category", "relevance", "impact", "summary", "why_it_matters", "recommendation", "related_entity"}, len(ds.News), func(i int) []any {
				x := ds.News[i]
				return []any{x.ID, x.Title, x.Source, x.URL, x.PublishedAt, x.Category, x.Relevance, x.Impact, x.Summary, x.WhyItMatters, x.Recommendation, x.RelatedEntity}
			})
		},
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func istDay(t time.Time) time.Time { return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, ist) }

func ptrStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// LoadDataset reads every business table for a store.
func (p *Postgres) LoadDataset(ctx context.Context, s model.Store) (*model.Dataset, error) {
	ds := &model.Dataset{Store: s, Now: s.SeededAt}
	q := func(sql string, scan func(pgx.Rows) error) error {
		rows, err := p.pool.Query(ctx, sql, s.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			if err := scan(rows); err != nil {
				return err
			}
		}
		return rows.Err()
	}
	err := errors.Join(
		q(`SELECT id, sku, name, category, price, cost, supplier, launched_at FROM products WHERE store_id=$1 ORDER BY id`, func(r pgx.Rows) error {
			var x model.Product
			x.StoreID = s.ID
			err := r.Scan(&x.ID, &x.SKU, &x.Name, &x.Category, &x.Price, &x.Cost, &x.Supplier, &x.LaunchedAt)
			ds.Products = append(ds.Products, x)
			return err
		}),
		q(`SELECT id, name, email, phone, city, state, region, created_at FROM customers WHERE store_id=$1`, func(r pgx.Rows) error {
			var x model.Customer
			err := r.Scan(&x.ID, &x.Name, &x.Email, &x.Phone, &x.City, &x.State, &x.Region, &x.CreatedAt)
			ds.Customers = append(ds.Customers, x)
			return err
		}),
		q(`SELECT id, channel, name, objective, status, daily_budget, started_at FROM marketing_campaigns WHERE store_id=$1 ORDER BY id`, func(r pgx.Rows) error {
			var x model.Campaign
			err := r.Scan(&x.ID, &x.Channel, &x.Name, &x.Objective, &x.Status, &x.DailyBudget, &x.StartedAt)
			ds.Campaigns = append(ds.Campaigns, x)
			return err
		}),
	)
	if err != nil {
		return nil, err
	}
	orderIdx := map[string]int{}
	err = errors.Join(
		q(`SELECT id, number, customer_id, created_at, status, payment_method, subtotal, discount, shipping_fee, total, campaign_id, channel FROM orders WHERE store_id=$1 ORDER BY created_at`, func(r pgx.Rows) error {
			var x model.Order
			var camp *string
			err := r.Scan(&x.ID, &x.Number, &x.CustomerID, &x.CreatedAt, &x.Status, &x.PaymentMethod, &x.Subtotal, &x.Discount, &x.ShippingFee, &x.Total, &camp, &x.Channel)
			x.CampaignID = ptrStr(camp)
			orderIdx[x.ID] = len(ds.Orders)
			ds.Orders = append(ds.Orders, x)
			return err
		}),
	)
	if err != nil {
		return nil, err
	}
	err = errors.Join(
		q(`SELECT order_id, product_id, qty, unit_price, unit_cost FROM order_items WHERE store_id=$1`, func(r pgx.Rows) error {
			var x model.OrderItem
			if err := r.Scan(&x.OrderID, &x.ProductID, &x.Qty, &x.UnitPrice, &x.UnitCost); err != nil {
				return err
			}
			if i, ok := orderIdx[x.OrderID]; ok {
				ds.Orders[i].Items = append(ds.Orders[i].Items, x)
			}
			return nil
		}),
		q(`SELECT order_id, courier, state, region, shipped_at, promised_at, delivered_at, ndr_attempts, status, cost FROM shipments WHERE store_id=$1`, func(r pgx.Rows) error {
			var x model.Shipment
			err := r.Scan(&x.OrderID, &x.Courier, &x.State, &x.Region, &x.ShippedAt, &x.PromisedAt, &x.DeliveredAt, &x.NDRAttempts, &x.Status, &x.Cost)
			ds.Shipments = append(ds.Shipments, x)
			return err
		}),
		q(`SELECT id, order_id, product_id, qty, reason, status, created_at FROM returns WHERE store_id=$1 ORDER BY created_at`, func(r pgx.Rows) error {
			var x model.Return
			err := r.Scan(&x.ID, &x.OrderID, &x.ProductID, &x.Qty, &x.Reason, &x.Status, &x.CreatedAt)
			ds.Returns = append(ds.Returns, x)
			return err
		}),
		q(`SELECT id, order_id, return_id, amount, reason, created_at FROM refunds WHERE store_id=$1 ORDER BY created_at`, func(r pgx.Rows) error {
			var x model.Refund
			var ret *string
			err := r.Scan(&x.ID, &x.OrderID, &ret, &x.Amount, &x.Reason, &x.CreatedAt)
			x.ReturnID = ptrStr(ret)
			ds.Refunds = append(ds.Refunds, x)
			return err
		}),
		q(`SELECT id, product_id, customer_id, order_id, rating, title, body, source, sentiment, themes, response, created_at FROM reviews WHERE store_id=$1 ORDER BY created_at`, func(r pgx.Rows) error {
			var x model.Review
			var rating int16
			err := r.Scan(&x.ID, &x.ProductID, &x.CustomerID, &x.OrderID, &rating, &x.Title, &x.Body, &x.Source, &x.Sentiment, &x.Themes, &x.Response, &x.CreatedAt)
			x.Rating = int(rating)
			ds.Reviews = append(ds.Reviews, x)
			return err
		}),
		q(`SELECT t.id, t.customer_id, t.order_id, t.product_id, t.channel, t.category, t.subject, t.message, t.priority, t.status, t.escalated,
		          t.created_at, t.first_response_at, t.resolved_at, c.ticket_id IS NOT NULL, COALESCE(c.cluster_key, '')
		     FROM support_tickets t LEFT JOIN complaints c ON c.store_id = t.store_id AND c.ticket_id = t.id
		    WHERE t.store_id=$1 ORDER BY t.created_at`, func(r pgx.Rows) error {
			var x model.Ticket
			var oid, pid *string
			err := r.Scan(&x.ID, &x.CustomerID, &oid, &pid, &x.Channel, &x.Category, &x.Subject, &x.Message, &x.Priority, &x.Status, &x.Escalated,
				&x.CreatedAt, &x.FirstResponseAt, &x.ResolvedAt, &x.IsComplaint, &x.ClusterKey)
			x.OrderID, x.ProductID = ptrStr(oid), ptrStr(pid)
			ds.Tickets = append(ds.Tickets, x)
			return err
		}),
		q(`SELECT product_id, warehouse, on_hand, reserved, reorder_point, lead_time_days, updated_at FROM inventory WHERE store_id=$1 ORDER BY product_id`, func(r pgx.Rows) error {
			var x model.InventoryItem
			err := r.Scan(&x.ProductID, &x.Warehouse, &x.OnHand, &x.Reserved, &x.ReorderPoint, &x.LeadTimeDays, &x.UpdatedAt)
			ds.Inventory = append(ds.Inventory, x)
			return err
		}),
		q(`SELECT date, units, value, restocked, stockouts, low_stock FROM inventory_snapshots WHERE store_id=$1 ORDER BY date`, func(r pgx.Rows) error {
			var x model.InventorySnapshot
			err := r.Scan(&x.Date, &x.Units, &x.Value, &x.Restocked, &x.Stockouts, &x.LowStock)
			x.Date = istDay(x.Date)
			ds.InvHistory = append(ds.InvHistory, x)
			return err
		}),
		q(`SELECT campaign_id, date, spend, impressions, clicks FROM marketing_metrics WHERE store_id=$1 ORDER BY date, campaign_id`, func(r pgx.Rows) error {
			var x model.CampaignMetric
			err := r.Scan(&x.CampaignID, &x.Date, &x.Spend, &x.Impressions, &x.Clicks)
			x.Date = istDay(x.Date)
			ds.CampMetrics = append(ds.CampMetrics, x)
			return err
		}),
		q(`SELECT date, channel, sessions, product_views, add_to_cart, checkout FROM traffic_daily WHERE store_id=$1 ORDER BY date, channel`, func(r pgx.Rows) error {
			var x model.TrafficDaily
			err := r.Scan(&x.Date, &x.Channel, &x.Sessions, &x.ProductView, &x.AddToCart, &x.Checkout)
			x.Date = istDay(x.Date)
			ds.Traffic = append(ds.Traffic, x)
			return err
		}),
		q(`SELECT id, name, domain, rating FROM competitors WHERE store_id=$1 ORDER BY id`, func(r pgx.Rows) error {
			var x model.Competitor
			err := r.Scan(&x.ID, &x.Name, &x.Domain, &x.Rating)
			ds.Competitors = append(ds.Competitors, x)
			return err
		}),
		q(`SELECT competitor_id, product_id, title, price, list_price, rating, in_stock, captured_at FROM competitor_prices WHERE store_id=$1 ORDER BY captured_at`, func(r pgx.Rows) error {
			var x model.CompetitorPrice
			err := r.Scan(&x.CompetitorID, &x.ProductID, &x.Title, &x.Price, &x.ListPrice, &x.Rating, &x.InStock, &x.CapturedAt)
			ds.CompPrices = append(ds.CompPrices, x)
			return err
		}),
		q(`SELECT date, opex, payment_failures, failed_amount FROM financial_metrics WHERE store_id=$1 ORDER BY date`, func(r pgx.Rows) error {
			var x model.FinancialDaily
			err := r.Scan(&x.Date, &x.Opex, &x.PaymentFailures, &x.FailedAmount)
			x.Date = istDay(x.Date)
			ds.Finance = append(ds.Finance, x)
			return err
		}),
		q(`SELECT id, title, source, url, published_at, category, relevance, impact, summary, why_it_matters, recommendation, related_entity FROM news WHERE store_id=$1 ORDER BY published_at DESC`, func(r pgx.Rows) error {
			var x model.NewsArticle
			err := r.Scan(&x.ID, &x.Title, &x.Source, &x.URL, &x.PublishedAt, &x.Category, &x.Relevance, &x.Impact, &x.Summary, &x.WhyItMatters, &x.Recommendation, &x.RelatedEntity)
			ds.News = append(ds.News, x)
			return err
		}),
	)
	if err != nil {
		return nil, err
	}
	for i := range ds.Orders {
		// keep item order deterministic
		items := ds.Orders[i].Items
		for a := 1; a < len(items); a++ {
			for b := a; b > 0 && items[b].ProductID < items[b-1].ProductID; b-- {
				items[b], items[b-1] = items[b-1], items[b]
			}
		}
	}
	ds.Index()
	return ds, nil
}

func (p *Postgres) InsightStates(ctx context.Context, storeID string) (map[string]InsightState, error) {
	rows, err := p.pool.Query(ctx, `SELECT id, status, assignee, updated_at FROM agent_insights WHERE store_id=$1 AND status <> 'new'`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]InsightState{}
	for rows.Next() {
		var id string
		var st InsightState
		if err := rows.Scan(&id, &st.Status, &st.Assignee, &st.UpdatedAt); err != nil {
			return nil, err
		}
		out[id] = st
	}
	return out, rows.Err()
}

func (p *Postgres) SetInsightState(ctx context.Context, storeID, id string, st InsightState) error {
	tag, err := p.pool.Exec(ctx, `UPDATE agent_insights SET status=$3, assignee=$4, updated_at=now() WHERE store_id=$1 AND id=$2`, storeID, id, st.Status, st.Assignee)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		_, err = p.pool.Exec(ctx, `INSERT INTO agent_insights (store_id, id, agent_id, severity, title, payload, status, assignee, detected_at)
			VALUES ($1,$2,'','','', '{}'::jsonb, $3, $4, now()) ON CONFLICT DO NOTHING`, storeID, id, st.Status, st.Assignee)
	}
	return err
}

// SaveInsights upserts the latest agent findings, preserving user state.
func (p *Postgres) SaveInsights(ctx context.Context, storeID string, ins []SavedInsight) error {
	batch := &pgx.Batch{}
	for _, in := range ins {
		batch.Queue(`INSERT INTO agent_insights (store_id, id, agent_id, severity, title, payload, detected_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
			ON CONFLICT (store_id, id) DO UPDATE SET agent_id=EXCLUDED.agent_id, severity=EXCLUDED.severity, title=EXCLUDED.title,
			payload=EXCLUDED.payload, detected_at=EXCLUDED.detected_at`,
			storeID, in.ID, in.AgentID, in.Severity, in.Title, json.RawMessage(in.Payload), in.DetectedAt)
	}
	return p.pool.SendBatch(ctx, batch).Close()
}

func (p *Postgres) NotificationStates(ctx context.Context, storeID string) (map[string]NotificationState, error) {
	rows, err := p.pool.Query(ctx, `SELECT id, read, dismissed FROM notifications WHERE store_id=$1`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]NotificationState{}
	for rows.Next() {
		var id string
		var st NotificationState
		if err := rows.Scan(&id, &st.Read, &st.Dismissed); err != nil {
			return nil, err
		}
		out[id] = st
	}
	return out, rows.Err()
}

func (p *Postgres) SetNotificationStates(ctx context.Context, storeID string, ids []string, read, dismissed *bool) error {
	batch := &pgx.Batch{}
	for _, id := range ids {
		batch.Queue(`INSERT INTO notifications (store_id, id, read, dismissed) VALUES ($1,$2,COALESCE($3,false),COALESCE($4,false))
			ON CONFLICT (store_id, id) DO UPDATE SET read=COALESCE($3, notifications.read), dismissed=COALESCE($4, notifications.dismissed), updated_at=now()`,
			storeID, id, read, dismissed)
	}
	return p.pool.SendBatch(ctx, batch).Close()
}

func (p *Postgres) AgentSettings(ctx context.Context, storeID string) (map[string]AgentSettings, error) {
	rows, err := p.pool.Query(ctx, `SELECT agent_id, settings FROM agent_settings WHERE store_id=$1`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]AgentSettings{}
	for rows.Next() {
		var id string
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		var s AgentSettings
		if err := json.Unmarshal(raw, &s); err == nil {
			out[id] = s
		}
	}
	return out, rows.Err()
}

func (p *Postgres) SetAgentSettings(ctx context.Context, storeID, agentID string, s AgentSettings) error {
	raw, _ := json.Marshal(s)
	_, err := p.pool.Exec(ctx, `INSERT INTO agent_settings (store_id, agent_id, settings) VALUES ($1,$2,$3)
		ON CONFLICT (store_id, agent_id) DO UPDATE SET settings=EXCLUDED.settings, updated_at=now()`, storeID, agentID, raw)
	return err
}

func (p *Postgres) SetReviewResponse(ctx context.Context, storeID, reviewID, text string) error {
	tag, err := p.pool.Exec(ctx, `UPDATE reviews SET response=$3 WHERE store_id=$1 AND id=$2`, storeID, reviewID, text)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (p *Postgres) AddShopOrder(ctx context.Context, storeID string, o model.Order, newCustomer *model.Customer, sh model.Shipment, stock []model.InventoryItem) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if c := newCustomer; c != nil {
		if _, err := tx.Exec(ctx, `INSERT INTO customers (store_id, id, name, email, phone, city, state, region, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			storeID, c.ID, c.Name, c.Email, c.Phone, c.City, c.State, c.Region, c.CreatedAt); err != nil {
			return fmt.Errorf("insert customer: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO orders (store_id, id, number, customer_id, created_at, status, payment_method, subtotal, discount, shipping_fee, total, campaign_id, channel)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		storeID, o.ID, o.Number, o.CustomerID, o.CreatedAt, o.Status, o.PaymentMethod, o.Subtotal, o.Discount, o.ShippingFee, o.Total, nz(o.CampaignID), o.Channel); err != nil {
		return fmt.Errorf("insert order: %w", err)
	}
	for _, it := range o.Items {
		if _, err := tx.Exec(ctx, `INSERT INTO order_items (store_id, order_id, product_id, qty, unit_price, unit_cost) VALUES ($1,$2,$3,$4,$5,$6)`,
			storeID, o.ID, it.ProductID, it.Qty, it.UnitPrice, it.UnitCost); err != nil {
			return fmt.Errorf("insert order item: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO shipments (store_id, order_id, courier, state, region, shipped_at, promised_at, delivered_at, ndr_attempts, status, cost)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		storeID, sh.OrderID, sh.Courier, sh.State, sh.Region, sh.ShippedAt, sh.PromisedAt, sh.DeliveredAt, sh.NDRAttempts, sh.Status, sh.Cost); err != nil {
		return fmt.Errorf("insert shipment: %w", err)
	}
	for _, inv := range stock {
		if _, err := tx.Exec(ctx, `UPDATE inventory SET on_hand=$3, updated_at=$4 WHERE store_id=$1 AND product_id=$2`,
			storeID, inv.ProductID, inv.OnHand, inv.UpdatedAt); err != nil {
			return fmt.Errorf("update inventory: %w", err)
		}
	}
	return tx.Commit(ctx)
}

func (p *Postgres) AddAction(ctx context.Context, storeID string, a UserAction) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO agent_activity (store_id, id, agent_id, kind, message, insight_id, user_id, at) VALUES ($1,$2,$3,'action',$4,$5,$6,$7)`,
		storeID, a.ID, a.AgentID, a.Kind+"|"+a.Message, a.InsightID, a.UserID, a.At)
	return err
}

func (p *Postgres) Actions(ctx context.Context, storeID string, limit int) ([]UserAction, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := p.pool.Query(ctx, `SELECT id, agent_id, insight_id, user_id, message, at FROM agent_activity WHERE store_id=$1 AND kind='action' ORDER BY at DESC LIMIT $2`, storeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserAction
	for rows.Next() {
		var a UserAction
		var msg string
		if err := rows.Scan(&a.ID, &a.AgentID, &a.InsightID, &a.UserID, &msg, &a.At); err != nil {
			return nil, err
		}
		if k, m, ok := strings.Cut(msg, "|"); ok {
			a.Kind, a.Message = k, m
		} else {
			a.Message = msg
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
