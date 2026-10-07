package service

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/agents"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

type H = map[string]any

type ListQuery struct {
	Page     int
	PageSize int
	Sort     string
	Dir      string
	Q        string
	Filters  map[string]string
	All      bool // export: no pagination
}

type Facet struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

type ListResult struct {
	Rows     []H                `json:"rows"`
	Total    int                `json:"total"`
	Page     int                `json:"page"`
	PageSize int                `json:"pageSize"`
	Facets   map[string][]Facet `json:"facets"`
}

func lessAny(a, b any) bool {
	switch x := a.(type) {
	case float64:
		y, _ := b.(float64)
		return x < y
	case int:
		y, _ := b.(int)
		return x < y
	case time.Time:
		y, _ := b.(time.Time)
		return x.Before(y)
	case *time.Time:
		y, _ := b.(*time.Time)
		if x == nil {
			return y != nil
		}
		return y != nil && x.Before(*y)
	case string:
		y, _ := b.(string)
		return strings.ToLower(x) < strings.ToLower(y)
	case bool:
		y, _ := b.(bool)
		return !x && y
	}
	return false
}

func facets(rows []H, keys ...string) map[string][]Facet {
	out := map[string][]Facet{}
	for _, k := range keys {
		m := map[string]int{}
		for _, r := range rows {
			if v, ok := r[k]; ok {
				m[fmt.Sprint(v)]++
			}
		}
		var f []Facet
		for v, c := range m {
			f = append(f, Facet{v, c})
		}
		sort.Slice(f, func(i, j int) bool { return f[i].Count > f[j].Count })
		out[k] = f
	}
	return out
}

// finish applies search, sort and pagination.
func finish(rows []H, q ListQuery, search []string, facetKeys ...string) ListResult {
	if s := strings.ToLower(strings.TrimSpace(q.Q)); s != "" {
		var f []H
		for _, r := range rows {
			for _, k := range search {
				if strings.Contains(strings.ToLower(fmt.Sprint(r[k])), s) {
					f = append(f, r)
					break
				}
			}
		}
		rows = f
	}
	res := ListResult{Total: len(rows), Facets: facets(rows, facetKeys...)}
	if q.Sort != "" {
		desc := q.Dir != "asc"
		sort.SliceStable(rows, func(i, j int) bool {
			if desc {
				return lessAny(rows[j][q.Sort], rows[i][q.Sort])
			}
			return lessAny(rows[i][q.Sort], rows[j][q.Sort])
		})
	}
	if q.All {
		res.Rows, res.Page, res.PageSize = rows, 1, len(rows)
		return res
	}
	if q.PageSize <= 0 || q.PageSize > 100 {
		q.PageSize = 25
	}
	if q.Page <= 0 {
		q.Page = 1
	}
	start := (q.Page - 1) * q.PageSize
	if start > len(rows) {
		start = len(rows)
	}
	end := start + q.PageSize
	if end > len(rows) {
		end = len(rows)
	}
	res.Rows, res.Page, res.PageSize = rows[start:end], q.Page, q.PageSize
	if res.Rows == nil {
		res.Rows = []H{}
	}
	return res
}

func match(q ListQuery, key, val string) bool {
	f, ok := q.Filters[key]
	if !ok || f == "" || f == "all" {
		return true
	}
	for _, opt := range strings.Split(f, ",") {
		if strings.EqualFold(opt, val) {
			return true
		}
	}
	return false
}

func dateFilter(q ListQuery, t time.Time) bool {
	if f := q.Filters["from"]; f != "" {
		if d, err := time.ParseInLocation("2006-01-02", f, analytics.IST); err == nil && t.Before(d) {
			return false
		}
	}
	if f := q.Filters["to"]; f != "" {
		if d, err := time.ParseInLocation("2006-01-02", f, analytics.IST); err == nil && !t.Before(d.AddDate(0, 0, 1)) {
			return false
		}
	}
	return true
}

var statusLabel = map[string]string{
	model.OrderDelivered: "Delivered", model.OrderShipped: "In transit", model.OrderProcessing: "Processing",
	model.OrderNDR: "NDR", model.OrderRTO: "RTO", model.OrderReturned: "Returned", model.OrderCancelled: "Cancelled",
}

func (s *Service) Orders(ctx context.Context, st model.Store, q ListQuery) (ListResult, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return ListResult{}, err
	}
	now := time.Now()
	returnsByOrder := map[string][]model.Return{}
	for _, r := range ds.Returns {
		returnsByOrder[r.OrderID] = append(returnsByOrder[r.OrderID], r)
	}
	rows := make([]H, 0, 2048)
	for i := len(ds.Orders) - 1; i >= 0; i-- {
		o := &ds.Orders[i]
		sh := ds.ShipByOrder[o.ID]
		c := ds.CustomerByID[o.CustomerID]
		courier, region, state := "—", c.Region, c.State
		var promised, delivered *time.Time
		if sh != nil {
			courier = sh.Courier
			p := sh.PromisedAt
			promised = &p
			delivered = sh.DeliveredAt
		}
		risk := agents.OrderRisk(o, sh, now)
		productIDs := make([]string, 0, len(o.Items))
		names := make([]string, 0, len(o.Items))
		for _, it := range o.Items {
			productIDs = append(productIDs, it.ProductID)
			names = append(names, ds.ProductByID[it.ProductID].Name)
		}
		if !match(q, "status", o.Status) || !match(q, "courier", courier) || !match(q, "region", region) ||
			!match(q, "payment", o.PaymentMethod) || !match(q, "risk", risk) || !dateFilter(q, o.CreatedAt) {
			continue
		}
		if pid := q.Filters["product"]; pid != "" && !strings.Contains(strings.Join(productIDs, ","), pid) {
			continue
		}
		if q.Filters["customer"] != "" && q.Filters["customer"] != o.CustomerID {
			continue
		}
		product := names[0]
		if len(names) > 1 {
			product = fmt.Sprintf("%s +%d", names[0], len(names)-1)
		}
		row := H{"id": o.ID, "number": o.Number, "customer": c.Name, "customerId": c.ID, "city": c.City, "product": product, "productIds": productIDs,
			"amount": o.Total, "status": o.Status, "statusLabel": statusLabel[o.Status], "payment": o.PaymentMethod, "courier": courier, "region": region, "state": state,
			"createdAt": o.CreatedAt, "expectedDelivery": promised, "deliveredAt": delivered, "risk": risk, "channel": o.Channel}
		if q.Filters["expand"] != "0" {
			var items []H
			for _, it := range o.Items {
				items = append(items, H{"productId": it.ProductID, "name": ds.ProductByID[it.ProductID].Name, "qty": it.Qty, "price": it.UnitPrice})
			}
			row["items"] = items
			row["discount"] = o.Discount
			row["shippingFee"] = o.ShippingFee
			if sh != nil {
				row["shippedAt"] = sh.ShippedAt
				row["ndrAttempts"] = sh.NDRAttempts
			}
			var rets []H
			for _, r := range returnsByOrder[o.ID] {
				rets = append(rets, H{"id": r.ID, "productId": r.ProductID, "reason": r.Reason, "status": r.Status, "createdAt": r.CreatedAt})
			}
			row["returns"] = rets
		}
		rows = append(rows, row)
	}
	return finish(rows, q, []string{"number", "id", "customer", "product", "city"}, "status", "courier", "region", "payment", "risk"), nil
}

func (s *Service) Customers(ctx context.Context, st model.Store, q ListQuery) (ListResult, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return ListResult{}, err
	}
	profiles := agents.BuildProfiles(ds, time.Now())
	var rows []H
	for _, p := range profiles {
		seg := q.Filters["segment"]
		if seg == "repurchase" {
			if p.RepurchaseScore < 0.5 {
				continue
			}
		} else if !match(q, "segment", p.Segment) {
			continue
		}
		if !match(q, "region", p.Region) {
			continue
		}
		rows = append(rows, H{"id": p.ID, "name": p.Name, "email": p.Email, "city": p.City, "state": p.State, "region": p.Region, "orders": p.Orders,
			"ltv": analytics.Round(p.LTV, 0), "aov": analytics.Round(p.AOV, 0), "firstOrder": p.FirstOrder, "lastOrder": p.LastOrder,
			"daysSinceLast": p.DaysSinceLast, "segment": p.Segment, "repurchaseScore": p.RepurchaseScore, "returns": p.Returns, "tickets": p.Tickets, "channel": p.Channel})
	}
	if q.Sort == "" {
		q.Sort = "ltv"
	}
	return finish(rows, q, []string{"name", "email", "city", "id"}, "segment", "region"), nil
}

func (s *Service) Products(ctx context.Context, st model.Store, rangeKey string, q ListQuery) (ListResult, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return ListResult{}, err
	}
	r := analytics.ParseRange(rangeKey, q.Filters["from"], q.Filters["to"], time.Now())
	stats := agents.ComputeProductStats(ds, r.From, r.To, r.PrevFrom, r.PrevTo)
	var rows []H
	for _, p := range stats {
		if !match(q, "category", p.Category) {
			continue
		}
		rows = append(rows, H{"id": p.ID, "sku": p.SKU, "name": p.Name, "category": p.Category, "price": p.Price, "units": p.Units, "revenue": p.Revenue,
			"growth": p.Growth, "margin": p.Margin, "grossProfit": p.GrossProfit, "returns": p.Returns, "returnRate": p.ReturnRate, "rating": p.Rating,
			"reviews": p.Reviews, "complaints": p.Complaints, "health": p.Health, "stock": p.Stock, "scores": p.Scores})
	}
	if q.Sort == "" {
		q.Sort = "revenue"
	}
	return finish(rows, q, []string{"name", "sku", "category"}, "category"), nil
}

// Product returns the full scorecard and drill-down for one product.
func (s *Service) Product(ctx context.Context, st model.Store, id string) (H, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return nil, err
	}
	p, ok := ds.ProductByID[id]
	if !ok {
		return nil, fmt.Errorf("product %s: not found", id)
	}
	now := time.Now()
	r := analytics.ParseRange("30d", "", "", now)
	var stat agents.ProductStats
	for _, x := range agents.ComputeProductStats(ds, r.From, r.To, r.PrevFrom, r.PrevTo) {
		if x.ID == id {
			stat = x
		}
	}
	reasons := map[string]int{}
	for _, rt := range ds.Returns {
		if rt.ProductID == id && now.Sub(rt.CreatedAt).Hours() < 24*30 {
			reasons[rt.Reason]++
		}
	}
	var reasonRows []H
	for k, v := range reasons {
		reasonRows = append(reasonRows, H{"reason": k, "count": v})
	}
	sort.Slice(reasonRows, func(i, j int) bool { return reasonRows[i]["count"].(int) > reasonRows[j]["count"].(int) })
	var reviews []H
	for i := len(ds.Reviews) - 1; i >= 0 && len(reviews) < 6; i-- {
		if ds.Reviews[i].ProductID == id {
			rv := ds.Reviews[i]
			reviews = append(reviews, H{"id": rv.ID, "rating": rv.Rating, "title": rv.Title, "body": rv.Body, "createdAt": rv.CreatedAt, "sentiment": rv.Sentiment, "customer": ds.CustomerByID[rv.CustomerID].Name})
		}
	}
	var stock *agents.StockRow
	for _, x := range agents.StockRows(ds, now) {
		if x.ProductID == id {
			xx := x
			stock = &xx
		}
	}
	c := &agents.Ctx{DS: ds, R: r, Now: now}
	_ = c
	return H{"product": p, "stats": stat, "returnReasons": reasonRows, "reviews": reviews, "stock": stock, "trend": productWeekly(ds, id, now)}, nil
}

func productWeekly(ds *model.Dataset, pid string, now time.Time) []H {
	weeks := 12
	start := analytics.StartOfDay(now).AddDate(0, 0, -7*weeks+1)
	units := make([]float64, weeks)
	rets := make([]float64, weeks)
	rsum := make([]float64, weeks)
	rn := make([]float64, weeks)
	revenue := make([]float64, weeks)
	wk := func(t time.Time) int {
		if t.Before(start) {
			return -1
		}
		i := int(t.Sub(start).Hours() / 24 / 7)
		if i >= weeks {
			return -1
		}
		return i
	}
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if w := wk(o.CreatedAt); w >= 0 && o.Status != model.OrderCancelled {
			for _, it := range o.Items {
				if it.ProductID == pid {
					units[w] += float64(it.Qty)
					revenue[w] += it.UnitPrice * float64(it.Qty)
				}
			}
		}
	}
	for _, r := range ds.Returns {
		if r.ProductID == pid {
			if w := wk(r.CreatedAt); w >= 0 {
				rets[w] += float64(r.Qty)
			}
		}
	}
	for _, rv := range ds.Reviews {
		if rv.ProductID == pid {
			if w := wk(rv.CreatedAt); w >= 0 {
				rsum[w] += float64(rv.Rating)
				rn[w]++
			}
		}
	}
	var out []H
	for i := 0; i < weeks; i++ {
		row := H{"t": start.AddDate(0, 0, 7*i).Format("2006-01-02"), "units": units[i], "revenue": revenue[i], "returns": rets[i],
			"returnRate": analytics.Round(analytics.Ratio(rets[i], units[i])*100, 1)}
		if rn[i] > 0 {
			row["rating"] = analytics.Round(rsum[i]/rn[i], 2)
		}
		out = append(out, row)
	}
	return out
}

func (s *Service) Inventory(ctx context.Context, st model.Store, q ListQuery) (ListResult, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return ListResult{}, err
	}
	var rows []H
	for _, x := range agents.StockRows(ds, time.Now()) {
		if !match(q, "risk", x.Risk) || !match(q, "category", x.Category) {
			continue
		}
		rows = append(rows, H{"productId": x.ProductID, "sku": x.SKU, "name": x.Name, "category": x.Category, "warehouse": x.Warehouse, "onHand": x.OnHand,
			"reserved": x.Reserved, "available": x.Available, "dailySales": x.DailySales, "trend": x.Trend, "daysLeft": x.DaysLeft,
			"reorderPoint": x.ReorderPoint, "leadTimeDays": x.LeadTime, "reorderQty": x.ReorderQty, "value": x.Value, "risk": x.Risk, "stockoutDate": x.StockoutDate,
			"riskRank": riskRank[x.Risk]})
	}
	if q.Sort == "" {
		q.Sort, q.Dir = "riskRank", "asc"
	}
	return finish(rows, q, []string{"name", "sku", "category"}, "risk", "category"), nil
}

var riskRank = map[string]int{"stockout": 0, "critical": 1, "low": 2, "dead": 3, "overstock": 4, "healthy": 5}

func (s *Service) Reviews(ctx context.Context, st model.Store, q ListQuery) (ListResult, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return ListResult{}, err
	}
	var rows []H
	for i := len(ds.Reviews) - 1; i >= 0; i-- {
		rv := ds.Reviews[i]
		if !match(q, "sentiment", rv.Sentiment) || !match(q, "rating", strconv.Itoa(rv.Rating)) || !match(q, "source", rv.Source) || !dateFilter(q, rv.CreatedAt) {
			continue
		}
		if pid := q.Filters["product"]; pid != "" && pid != rv.ProductID {
			continue
		}
		if th := q.Filters["theme"]; th != "" && !strings.Contains(strings.Join(rv.Themes, ","), th) {
			continue
		}
		if q.Filters["unanswered"] == "1" && rv.Response != "" {
			continue
		}
		p := ds.ProductByID[rv.ProductID]
		c := ds.CustomerByID[rv.CustomerID]
		rows = append(rows, H{"id": rv.ID, "productId": rv.ProductID, "product": p.Name, "customer": c.Name, "city": c.City, "rating": rv.Rating,
			"title": rv.Title, "body": rv.Body, "source": rv.Source, "sentiment": rv.Sentiment, "themes": rv.Themes, "theme": strings.Join(rv.Themes, ", "),
			"createdAt": rv.CreatedAt, "response": rv.Response, "orderId": rv.OrderID, "answered": rv.Response != ""})
	}
	return finish(rows, q, []string{"product", "customer", "title", "body"}, "sentiment", "source", "rating"), nil
}

func (s *Service) Tickets(ctx context.Context, st model.Store, q ListQuery) (ListResult, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return ListResult{}, err
	}
	now := time.Now()
	var rows []H
	for i := len(ds.Tickets) - 1; i >= 0; i-- {
		t := &ds.Tickets[i]
		status := t.Status
		if q.Filters["status"] == "open" && status != "resolved" {
			status = "open"
		}
		if !match(q, "status", status) || !match(q, "category", t.Category) || !match(q, "channel", t.Channel) || !dateFilter(q, t.CreatedAt) {
			continue
		}
		if cl := q.Filters["cluster"]; cl != "" {
			key := t.ClusterKey
			if key == "" {
				key = t.Category
			}
			if key != cl && t.Category+"|"+t.ProductID != cl {
				continue
			}
		}
		if q.Filters["complaint"] == "1" && !t.IsComplaint {
			continue
		}
		var fr, rs float64
		if t.FirstResponseAt != nil {
			fr = t.FirstResponseAt.Sub(t.CreatedAt).Hours()
		}
		if t.ResolvedAt != nil {
			rs = t.ResolvedAt.Sub(t.CreatedAt).Hours()
		}
		c := ds.CustomerByID[t.CustomerID]
		product := ""
		if p := ds.ProductByID[t.ProductID]; p != nil {
			product = p.Name
		}
		orderNumber := ""
		if o := ds.OrderByID[t.OrderID]; o != nil {
			orderNumber = o.Number
		}
		rows = append(rows, H{"id": t.ID, "subject": t.Subject, "message": t.Message, "customer": c.Name, "customerId": c.ID, "channel": t.Channel,
			"category": t.Category, "priority": t.Priority, "status": t.Status, "complaint": t.IsComplaint, "escalated": t.Escalated,
			"createdAt": t.CreatedAt, "firstResponseHours": analytics.Round(fr, 2), "resolutionHours": analytics.Round(rs, 1),
			"slaBreached": agents.TicketSLABreached(t, now), "product": product, "orderNumber": orderNumber, "cluster": t.ClusterKey})
	}
	return finish(rows, q, []string{"subject", "customer", "product", "orderNumber", "id"}, "status", "category", "channel", "priority"), nil
}

// Search powers the command palette.
func (s *Service) Search(ctx context.Context, st model.Store, query string) (H, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return nil, err
	}
	q := strings.ToLower(strings.TrimSpace(query))
	var orders, customers, products []H
	if q == "" {
		return H{"orders": []H{}, "customers": []H{}, "products": []H{}}, nil
	}
	for _, p := range ds.Products {
		if len(products) < 6 && (strings.Contains(strings.ToLower(p.Name), q) || strings.Contains(strings.ToLower(p.SKU), q)) {
			products = append(products, H{"id": p.ID, "name": p.Name, "sku": p.SKU, "category": p.Category, "price": p.Price})
		}
	}
	for _, c := range ds.Customers {
		if len(customers) >= 6 {
			break
		}
		if strings.Contains(strings.ToLower(c.Name), q) || strings.Contains(strings.ToLower(c.Email), q) {
			if len(ds.OrdersByCust[c.ID]) > 0 {
				customers = append(customers, H{"id": c.ID, "name": c.Name, "email": c.Email, "city": c.City})
			}
		}
	}
	for i := len(ds.Orders) - 1; i >= 0 && len(orders) < 6; i-- {
		o := &ds.Orders[i]
		if strings.Contains(strings.ToLower(o.Number), q) || strings.Contains(strings.ToLower(o.ID), q) {
			orders = append(orders, H{"id": o.ID, "number": o.Number, "customer": ds.CustomerByID[o.CustomerID].Name, "amount": o.Total, "status": o.Status, "createdAt": o.CreatedAt})
		}
	}
	return H{"orders": orders, "customers": customers, "products": products}, nil
}

// Customer returns one customer's profile with orders and tickets.
func (s *Service) Customer(ctx context.Context, st model.Store, id string) (H, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return nil, err
	}
	c, ok := ds.CustomerByID[id]
	if !ok {
		return nil, fmt.Errorf("customer %s: not found", id)
	}
	var profile *agents.CustomerProfile
	for _, p := range agents.BuildProfiles(ds, time.Now()) {
		if p.ID == id {
			pp := p
			profile = &pp
		}
	}
	var orders []H
	for _, o := range ds.OrdersByCust[id] {
		orders = append(orders, H{"id": o.ID, "number": o.Number, "amount": o.Total, "status": o.Status, "createdAt": o.CreatedAt, "items": len(o.Items)})
	}
	sort.Slice(orders, func(i, j int) bool {
		return orders[i]["createdAt"].(time.Time).After(orders[j]["createdAt"].(time.Time))
	})
	var tickets []H
	for _, t := range ds.Tickets {
		if t.CustomerID == id {
			tickets = append(tickets, H{"id": t.ID, "subject": t.Subject, "status": t.Status, "createdAt": t.CreatedAt, "category": t.Category})
		}
	}
	return H{"customer": c, "profile": profile, "orders": orders, "tickets": tickets}, nil
}
