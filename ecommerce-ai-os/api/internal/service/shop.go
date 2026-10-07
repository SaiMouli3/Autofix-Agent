package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/repo"
)

// Storefront: the public shop reads the same dataset the agents analyze, and
// orders placed there become ordinary orders the agents see.

const (
	freeShippingOver = 35.0
	shippingFee      = 4.99
	maxLineQty       = 10
	maxCartLines     = 20
	lowStockAt       = 10
)

var (
	ErrOutOfStock   = errors.New("out of stock")
	ErrInvalidOrder = errors.New("invalid order")
)

// ShopProduct is a product as shoppers see it: price, rating and availability,
// never cost or supplier.
type ShopProduct struct {
	ID          string  `json:"id"`
	SKU         string  `json:"sku"`
	Name        string  `json:"name"`
	Category    string  `json:"category"`
	Price       float64 `json:"price"`
	Rating      float64 `json:"rating"`
	ReviewCount int     `json:"reviewCount"`
	Sold30      int     `json:"sold30"`
	Available   int     `json:"available"`
	IsNew       bool    `json:"isNew"`
	launched    time.Time
}

type shopIndex struct {
	ds       *model.Dataset
	products []ShopProduct
	byID     map[string]*ShopProduct
}

func (s *Service) shopProducts(ds *model.Dataset) *shopIndex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.shopCache != nil && s.shopCache.ds == ds {
		return s.shopCache
	}
	sold := map[string]int{}
	since := ds.Now.AddDate(0, 0, -30)
	for i := range ds.Orders {
		o := &ds.Orders[i]
		if o.Status == model.OrderCancelled || o.CreatedAt.Before(since) {
			continue
		}
		for _, it := range o.Items {
			sold[it.ProductID] += it.Qty
		}
	}
	sum, cnt := map[string]int{}, map[string]int{}
	for _, r := range ds.Reviews {
		sum[r.ProductID] += r.Rating
		cnt[r.ProductID]++
	}
	idx := &shopIndex{ds: ds, byID: map[string]*ShopProduct{}}
	for _, p := range ds.Products {
		sp := ShopProduct{ID: p.ID, SKU: p.SKU, Name: p.Name, Category: p.Category, Price: p.Price,
			ReviewCount: cnt[p.ID], Sold30: sold[p.ID], IsNew: ds.Now.Sub(p.LaunchedAt) < 45*24*time.Hour, launched: p.LaunchedAt}
		if cnt[p.ID] > 0 {
			sp.Rating = analytics.Round(float64(sum[p.ID])/float64(cnt[p.ID]), 1)
		}
		if inv := ds.InvByProduct[p.ID]; inv != nil {
			sp.Available = max(0, inv.OnHand-inv.Reserved)
		}
		idx.products = append(idx.products, sp)
	}
	for i := range idx.products {
		idx.byID[idx.products[i].ID] = &idx.products[i]
	}
	s.shopCache = idx
	return idx
}

func sortShop(ps []ShopProduct, by string) {
	less := map[string]func(a, b ShopProduct) bool{
		"price_asc":  func(a, b ShopProduct) bool { return a.Price < b.Price },
		"price_desc": func(a, b ShopProduct) bool { return a.Price > b.Price },
		"rating": func(a, b ShopProduct) bool {
			return a.Rating > b.Rating || (a.Rating == b.Rating && a.ReviewCount > b.ReviewCount)
		},
		"new": func(a, b ShopProduct) bool { return a.launched.After(b.launched) },
	}[by]
	if less == nil { // popular
		less = func(a, b ShopProduct) bool { return a.Sold30 > b.Sold30 }
	}
	sort.SliceStable(ps, func(i, j int) bool {
		// In-stock products first, then the requested order.
		if (ps[i].Available > 0) != (ps[j].Available > 0) {
			return ps[i].Available > 0
		}
		return less(ps[i], ps[j])
	})
}

func top(ps []ShopProduct, by string, n int) []ShopProduct {
	out := append([]ShopProduct(nil), ps...)
	if by == "rating" {
		// Only products with enough reviews to be meaningful.
		kept := out[:0]
		for _, p := range out {
			if p.ReviewCount >= 5 {
				kept = append(kept, p)
			}
		}
		out = kept
	}
	sortShop(out, by)
	return out[:min(n, len(out))]
}

// ShopHome returns the storefront landing data.
func (s *Service) ShopHome(ctx context.Context, st model.Store) (H, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return nil, err
	}
	idx := s.shopProducts(ds)
	counts := map[string]int{}
	var cats []string
	for _, p := range idx.products {
		if counts[p.Category] == 0 {
			cats = append(cats, p.Category)
		}
		counts[p.Category]++
	}
	categories := make([]H, 0, len(cats))
	for _, c := range cats {
		categories = append(categories, H{"name": c, "count": counts[c]})
	}
	return H{
		"store":         H{"name": st.Name, "currency": st.Currency, "businessType": st.BusinessType},
		"categories":    categories,
		"bestSellers":   top(idx.products, "popular", 8),
		"topRated":      top(idx.products, "rating", 4),
		"newArrivals":   top(idx.products, "new", 4),
		"states":        shopStates(ds),
		"freeShipping":  freeShippingOver,
		"shippingFee":   shippingFee,
		"productCount":  len(idx.products),
		"reviewCount":   len(ds.Reviews),
		"customerCount": len(ds.Customers),
	}, nil
}

// ShopCatalog lists products with category, search and sort.
func (s *Service) ShopCatalog(ctx context.Context, st model.Store, category, q, sortBy string, page, pageSize int) (H, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return nil, err
	}
	idx := s.shopProducts(ds)
	q = strings.ToLower(strings.TrimSpace(q))
	var out []ShopProduct
	for _, p := range idx.products {
		if category != "" && !strings.EqualFold(p.Category, category) {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(p.Name+" "+p.Category), q) {
			continue
		}
		out = append(out, p)
	}
	sortShop(out, sortBy)
	total := len(out)
	pageSize = min(max(pageSize, 1), 48)
	page = max(page, 1)
	lo := min((page-1)*pageSize, total)
	hi := min(lo+pageSize, total)
	return H{"items": out[lo:hi], "total": total, "page": page, "pageSize": pageSize}, nil
}

// ShopProductDetail returns one product with its reviews and related items.
func (s *Service) ShopProductDetail(ctx context.Context, st model.Store, id string) (H, error) {
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return nil, err
	}
	idx := s.shopProducts(ds)
	p := idx.byID[id]
	if p == nil {
		return nil, repo.ErrNotFound
	}
	var reviews []model.Review
	dist := make([]int, 5)
	for _, r := range ds.Reviews {
		if r.ProductID != id {
			continue
		}
		reviews = append(reviews, r)
		if r.Rating >= 1 && r.Rating <= 5 {
			dist[r.Rating-1]++
		}
	}
	sort.Slice(reviews, func(i, j int) bool { return reviews[i].CreatedAt.After(reviews[j].CreatedAt) })
	shown := make([]H, 0, 20)
	for _, r := range reviews[:min(20, len(reviews))] {
		author := "Verified buyer"
		if c := ds.CustomerByID[r.CustomerID]; c != nil {
			author = shortName(c.Name)
		}
		shown = append(shown, H{"id": r.ID, "rating": r.Rating, "title": r.Title, "body": r.Body, "author": author,
			"createdAt": r.CreatedAt, "response": r.Response, "verified": r.OrderID != ""})
	}
	var related []ShopProduct
	for _, rp := range idx.products {
		if rp.Category == p.Category && rp.ID != p.ID {
			related = append(related, rp)
		}
	}
	sortShop(related, "popular")
	desc := fmt.Sprintf("The %s is part of the %s %s collection.", p.Name, st.Name, strings.ToLower(p.Category))
	if p.Sold30 > 0 {
		desc += fmt.Sprintf(" %d bought in the last 30 days.", p.Sold30)
	}
	return H{
		"product":      p,
		"description":  desc,
		"reviews":      shown,
		"distribution": dist,
		"related":      related[:min(4, len(related))],
		"lowStock":     p.Available > 0 && p.Available <= lowStockAt,
		"freeShipping": freeShippingOver,
		"shippingFee":  shippingFee,
	}, nil
}

func shortName(full string) string {
	parts := strings.Fields(full)
	if len(parts) == 0 {
		return "Verified buyer"
	}
	if len(parts) == 1 {
		return parts[0]
	}
	return parts[0] + " " + parts[len(parts)-1][:1] + "."
}

// shopStates lists the delivery states the store ships to, with their region.
func shopStates(ds *model.Dataset) []H {
	region := map[string]string{}
	for _, c := range ds.Customers {
		if c.State != "" {
			region[c.State] = c.Region
		}
	}
	names := make([]string, 0, len(region))
	for k := range region {
		names = append(names, k)
	}
	sort.Strings(names)
	out := make([]H, 0, len(names))
	for _, n := range names {
		out = append(out, H{"name": n, "region": region[n]})
	}
	return out
}

type CartLine struct {
	ProductID string `json:"productId"`
	Qty       int    `json:"qty"`
}

type ShopCustomer struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Phone string `json:"phone"`
	City  string `json:"city"`
	State string `json:"state"`
}

type OrderRequest struct {
	Items    []CartLine   `json:"items"`
	Customer ShopCustomer `json:"customer"`
	Payment  string       `json:"payment"` // card | cod
}

// PlaceOrder validates stock, prices the cart server-side, and records the
// order exactly like any other store order so every agent sees it.
func (s *Service) PlaceOrder(ctx context.Context, st model.Store, req OrderRequest) (H, error) {
	if len(req.Items) == 0 || len(req.Items) > maxCartLines {
		return nil, fmt.Errorf("%w: the cart must have between 1 and %d items", ErrInvalidOrder, maxCartLines)
	}
	if req.Payment != "card" && req.Payment != "cod" {
		return nil, fmt.Errorf("%w: choose a payment method", ErrInvalidOrder)
	}
	s.shopMu.Lock()
	defer s.shopMu.Unlock()
	ds, err := s.Dataset(ctx, st)
	if err != nil {
		return nil, err
	}
	var stateRegion string
	for _, h := range shopStates(ds) {
		if h["name"] == req.Customer.State {
			stateRegion = h["region"].(string)
		}
	}
	if stateRegion == "" {
		return nil, fmt.Errorf("%w: we don't deliver to that state", ErrInvalidOrder)
	}

	now := time.Now()
	s.mu.Lock()
	shift := s.shifts[st.ID]
	s.mu.Unlock()
	stored := func(t time.Time) time.Time { return t.Add(-shift) } // persisted timeline

	merged := map[string]int{}
	var order []string
	for _, l := range req.Items {
		if l.Qty < 1 || l.Qty > maxLineQty {
			return nil, fmt.Errorf("%w: quantities must be between 1 and %d", ErrInvalidOrder, maxLineQty)
		}
		if ds.ProductByID[l.ProductID] == nil {
			return nil, fmt.Errorf("%w: a product in your cart is no longer available", ErrInvalidOrder)
		}
		if merged[l.ProductID] == 0 {
			order = append(order, l.ProductID)
		}
		merged[l.ProductID] += l.Qty
	}

	next := *ds
	next.Inventory = append([]model.InventoryItem(nil), ds.Inventory...)
	invIdx := map[string]int{}
	for i := range next.Inventory {
		invIdx[next.Inventory[i].ProductID] = i
	}
	o := model.Order{Status: model.OrderProcessing, PaymentMethod: "prepaid", Channel: "direct", CreatedAt: now}
	if req.Payment == "cod" {
		o.PaymentMethod = "cod"
	}
	var changed []model.InventoryItem
	for _, pid := range order {
		p := ds.ProductByID[pid]
		qty := merged[pid]
		i, ok := invIdx[pid]
		if !ok || next.Inventory[i].OnHand-next.Inventory[i].Reserved < qty {
			return nil, fmt.Errorf("%w: only %d of %s left", ErrOutOfStock, max(0, available(next.Inventory, invIdx, pid)), p.Name)
		}
		next.Inventory[i].OnHand -= qty
		next.Inventory[i].UpdatedAt = now
		saved := next.Inventory[i]
		saved.UpdatedAt = stored(now)
		changed = append(changed, saved)
		o.Items = append(o.Items, model.OrderItem{ProductID: pid, Qty: qty, UnitPrice: p.Price, UnitCost: p.Cost})
		o.Subtotal += p.Price * float64(qty)
	}
	o.Subtotal = round2(o.Subtotal)
	if o.Subtotal < freeShippingOver {
		o.ShippingFee = shippingFee
	}
	o.Total = round2(o.Subtotal + o.ShippingFee)

	// Customer: reuse by email, otherwise create.
	var cust *model.Customer
	var newCust *model.Customer
	email := strings.ToLower(strings.TrimSpace(req.Customer.Email))
	for i := range ds.Customers {
		if strings.EqualFold(ds.Customers[i].Email, email) {
			cust = &ds.Customers[i]
			break
		}
	}
	if cust == nil {
		c := model.Customer{ID: fmt.Sprintf("C-%d", nextSeq(ds.Customers, func(c model.Customer) string { return c.ID })),
			Name: strings.TrimSpace(req.Customer.Name), Email: email, Phone: strings.TrimSpace(req.Customer.Phone),
			City: strings.TrimSpace(req.Customer.City), State: req.Customer.State, Region: stateRegion, CreatedAt: now}
		newCust = &c
		cust = &c
		next.Customers = append(append([]model.Customer(nil), ds.Customers...), c)
	}
	o.CustomerID = cust.ID
	seq := nextSeq(ds.Orders, func(o model.Order) string { return o.ID })
	o.ID = fmt.Sprintf("O-%d", seq)
	o.Number = fmt.Sprintf("#%s%d", orderPrefix(ds), seq)
	for i := range o.Items {
		o.Items[i].OrderID = o.ID
	}
	sh := model.Shipment{OrderID: o.ID, Courier: regionCourier(ds, stateRegion), State: req.Customer.State, Region: stateRegion,
		PromisedAt: now.AddDate(0, 0, 5), Status: model.OrderProcessing, Cost: 2.35}

	so, ssh := o, sh
	so.CreatedAt = stored(o.CreatedAt)
	ssh.PromisedAt = stored(sh.PromisedAt)
	var sc *model.Customer
	if newCust != nil {
		c := *newCust
		c.CreatedAt = stored(c.CreatedAt)
		sc = &c
	}
	if err := s.Repo.AddShopOrder(ctx, st.ID, so, sc, ssh, changed); err != nil {
		return nil, err
	}

	next.Orders = append(append([]model.Order(nil), ds.Orders...), o)
	next.Shipments = append(append([]model.Shipment(nil), ds.Shipments...), sh)
	next.Index()
	s.mu.Lock()
	s.datasets[st.ID] = &next
	s.mu.Unlock()
	s.InvalidateStore(st.ID)

	lines := make([]H, 0, len(o.Items))
	for _, it := range o.Items {
		lines = append(lines, H{"productId": it.ProductID, "name": ds.ProductByID[it.ProductID].Name, "qty": it.Qty, "unitPrice": it.UnitPrice})
	}
	return H{"number": o.Number, "createdAt": o.CreatedAt, "items": lines, "subtotal": o.Subtotal, "shippingFee": o.ShippingFee,
		"total": o.Total, "payment": req.Payment, "estimatedDelivery": sh.PromisedAt, "email": email}, nil
}

func available(inv []model.InventoryItem, idx map[string]int, pid string) int {
	if i, ok := idx[pid]; ok {
		return inv[i].OnHand - inv[i].Reserved
	}
	return 0
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// nextSeq returns one more than the largest numeric suffix of the IDs.
func nextSeq[T any](xs []T, id func(T) string) int {
	best := 0
	for _, x := range xs {
		v := id(x)
		if i := strings.LastIndex(v, "-"); i >= 0 {
			if n, err := strconv.Atoi(v[i+1:]); err == nil && n > best {
				best = n
			}
		}
	}
	return best + 1
}

func orderPrefix(ds *model.Dataset) string {
	if len(ds.Orders) > 0 {
		n := ds.Orders[0].Number
		end := 1
		for end < len(n) && (n[end] < '0' || n[end] > '9') {
			end++
		}
		if end > 1 {
			return n[1:end]
		}
	}
	return "ORD"
}

// regionCourier picks the courier with the best recent on-time rate in the
// region, so storefront orders avoid a carrier the Orders agent flagged.
func regionCourier(ds *model.Dataset, region string) string {
	type stat struct{ n, onTime int }
	stats := map[string]*stat{}
	since := ds.Now.AddDate(0, 0, -21)
	for _, sh := range ds.Shipments {
		if sh.Region != region || sh.DeliveredAt == nil || sh.PromisedAt.Before(since) {
			continue
		}
		st := stats[sh.Courier]
		if st == nil {
			st = &stat{}
			stats[sh.Courier] = st
		}
		st.n++
		if !sh.DeliveredAt.After(sh.PromisedAt) {
			st.onTime++
		}
	}
	best, bestRate := "", -1.0
	names := make([]string, 0, len(stats))
	for k := range stats {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, k := range names {
		st := stats[k]
		if st.n < 10 {
			continue
		}
		if r := float64(st.onTime) / float64(st.n); r > bestRate {
			best, bestRate = k, r
		}
	}
	if best == "" && len(ds.Shipments) > 0 {
		best = ds.Shipments[len(ds.Shipments)-1].Courier
	}
	return best
}
