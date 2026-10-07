package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/cache"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/config"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/llm"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/repo"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/service"
)

func newTestServer() *Server {
	svc := service.New(repo.NewMemory(), cache.NewMemory(), llm.Disabled{})
	return New(config.Config{JWTSecret: "test-secret", CORSOrigins: "http://localhost:3000"}, svc)
}

type client struct {
	t      *testing.T
	s      *Server
	cookie string
}

func (c *client) do(method, path string, body any, headers ...string) (int, map[string]any) {
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, r)
	req.Header.Set("Content-Type", "application/json")
	if c.cookie != "" {
		req.Header.Set("Cookie", c.cookie)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := c.s.App.Test(req, 30000)
	if err != nil {
		c.t.Fatal(err)
	}
	for _, ck := range res.Cookies() {
		if ck.Name == "eaos_session" {
			c.cookie = ck.Name + "=" + ck.Value
		}
	}
	var out map[string]any
	data, _ := io.ReadAll(res.Body)
	_ = json.Unmarshal(data, &out)
	return res.StatusCode, out
}

func TestAuthAndTenantIsolation(t *testing.T) {
	s := newTestServer()
	a := &client{t: t, s: s}
	b := &client{t: t, s: s}

	if code, _ := a.do("GET", "/api/dashboard", nil); code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated dashboard: got %d", code)
	}
	if code, _ := a.do("POST", "/api/auth/signup", map[string]string{"name": "A", "email": "bad", "password": "x"}); code != 422 {
		t.Fatalf("invalid signup should be 422, got %d", code)
	}
	if code, _ := a.do("POST", "/api/auth/signup", map[string]string{"name": "Alice Owner", "email": "alice@example.com", "password": "password-123", "company": "A Co"}); code != 201 {
		t.Fatalf("signup a: %d", code)
	}
	if code, _ := b.do("POST", "/api/auth/signup", map[string]string{"name": "Bob Owner", "email": "bob@example.com", "password": "password-123", "company": "B Co"}); code != 201 {
		t.Fatalf("signup b: %d", code)
	}
	if code, _ := a.do("POST", "/api/auth/signup", map[string]string{"name": "Dup", "email": "alice@example.com", "password": "password-123"}); code != 409 {
		t.Fatalf("duplicate signup should be 409, got %d", code)
	}
	// No store yet → explicit, actionable error.
	if code, body := a.do("GET", "/api/dashboard", nil); code != 409 || !strings.Contains(body["error"].(map[string]any)["code"].(string), "no_store") {
		t.Fatalf("expected no_store, got %d %v", code, body)
	}
	if code, _ := a.do("POST", "/api/stores", map[string]string{"platform": "shopify", "businessType": "fashion"}); code != 422 {
		t.Fatalf("unavailable connector should be 422, got %d", code)
	}
	code, body := a.do("POST", "/api/stores", map[string]string{"platform": "demo", "businessType": "fashion"})
	if code != 201 {
		t.Fatalf("create store: %d %v", code, body)
	}
	storeA := body["store"].(map[string]any)["id"].(string)

	code, body = a.do("GET", "/api/dashboard?range=7d", nil, "X-Store-ID", storeA)
	if code != 200 || len(body["priority"].([]any)) == 0 {
		t.Fatalf("dashboard for owner: %d", code)
	}
	// Bob must not be able to read Alice's store by ID.
	if code, _ := b.do("GET", "/api/dashboard", nil, "X-Store-ID", storeA); code != 404 {
		t.Fatalf("cross-tenant access must be 404, got %d", code)
	}
	if code, _ := b.do("GET", "/api/orders/list", nil, "X-Store-ID", storeA); code != 404 {
		t.Fatalf("cross-tenant list must be 404, got %d", code)
	}
	// Tampered session is rejected.
	b.cookie = "eaos_session=not-a-token"
	if code, _ := b.do("GET", "/api/me", nil); code != 401 {
		t.Fatalf("tampered session must be 401, got %d", code)
	}

	// Owner endpoints work and validate input.
	for _, p := range []string{"/api/agents", "/api/agents/orders", "/api/insights", "/api/notifications", "/api/orders/list?status=rto", "/api/search?q=aurora"} {
		if code, _ := a.do("GET", p, nil, "X-Store-ID", storeA); code != 200 {
			t.Fatalf("%s: %d", p, code)
		}
	}
	if code, _ := a.do("GET", "/api/agents/nope", nil, "X-Store-ID", storeA); code != 404 {
		t.Fatalf("unknown agent should 404, got %d", code)
	}
	if code, _ := a.do("PATCH", "/api/insights/in_x", map[string]string{"status": "bogus"}, "X-Store-ID", storeA); code != 422 {
		t.Fatalf("invalid insight status should 422, got %d", code)
	}
	code, body = a.do("POST", "/api/ai/chat", map[string]any{"messages": []map[string]string{{"role": "user", "content": "Which products should I reorder?"}}}, "X-Store-ID", storeA)
	if code != 200 || !strings.Contains(body["answer"].(string), "Reorder") {
		t.Fatalf("chat: %d %v", code, body)
	}
}

func TestStorefront(t *testing.T) {
	s := newTestServer()
	owner := &client{t: t, s: s}
	shopper := &client{t: t, s: s}

	if code, _ := shopper.do("GET", "/api/shop", nil); code != 503 {
		t.Fatalf("shop with no store configured should be 503, got %d", code)
	}
	if code, _ := owner.do("POST", "/api/auth/signup", map[string]string{"name": "Shop Owner", "email": "owner@example.com", "password": "password-123", "company": "Shop Co"}); code != 201 {
		t.Fatalf("signup: %d", code)
	}
	_, body := owner.do("POST", "/api/stores", map[string]string{"platform": "demo", "businessType": "fashion"})
	storeID := body["store"].(map[string]any)["id"].(string)
	s.svc.ShopStoreID = storeID

	// Public, no session.
	code, home := shopper.do("GET", "/api/shop", nil)
	if code != 200 || len(home["bestSellers"].([]any)) == 0 || len(home["states"].([]any)) == 0 {
		t.Fatalf("shop home: %d", code)
	}
	code, cat := shopper.do("GET", "/api/shop/products?sort=price_asc&pageSize=48", nil)
	items := cat["items"].([]any)
	if code != 200 || len(items) == 0 {
		t.Fatalf("catalog: %d", code)
	}
	// Pick an in-stock product.
	var pid string
	var avail float64
	for _, it := range items {
		p := it.(map[string]any)
		if p["available"].(float64) >= 3 {
			pid, avail = p["id"].(string), p["available"].(float64)
			break
		}
	}
	if pid == "" {
		t.Fatal("no in-stock product")
	}
	code, detail := shopper.do("GET", "/api/shop/products/"+pid, nil)
	if code != 200 {
		t.Fatalf("product: %d", code)
	}
	if _, leaked := detail["product"].(map[string]any)["cost"]; leaked {
		t.Fatal("storefront must not expose product cost")
	}
	if code, _ := shopper.do("GET", "/api/shop/products/P-nope", nil); code != 404 {
		t.Fatalf("unknown product should 404, got %d", code)
	}

	state := home["states"].([]any)[0].(map[string]any)["name"].(string)
	order := func(qty float64, st string) (int, map[string]any) {
		return shopper.do("POST", "/api/shop/orders", map[string]any{
			"items":    []map[string]any{{"productId": pid, "qty": qty}},
			"customer": map[string]string{"name": "Jamie Rivera", "email": "jamie@example.com", "city": "Austin", "state": st},
			"payment":  "card",
		})
	}
	if code, _ := order(1, "Nowhere"); code != 422 {
		t.Fatalf("unknown state should 422, got %d", code)
	}
	if avail <= 10 {
		if code, _ := order(avail+1, state); code != 409 {
			t.Fatalf("over-stock order should 409, got %d", code)
		}
	}
	code, placed := order(2, state)
	if code != 201 || placed["number"] == "" {
		t.Fatalf("place order: %d %v", code, placed)
	}

	// The owner's dashboard sees the new order, and stock went down.
	code, list := owner.do("GET", "/api/orders/list?q="+strings.TrimPrefix(placed["number"].(string), "#"), nil, "X-Store-ID", storeID)
	if code != 200 || list["total"].(float64) < 1 {
		t.Fatalf("order not visible to owner: %d %v", code, list)
	}
	_, detail = shopper.do("GET", "/api/shop/products/"+pid, nil)
	if got := detail["product"].(map[string]any)["available"].(float64); got != avail-2 {
		t.Fatalf("stock should drop from %v to %v, got %v", avail, avail-2, got)
	}
}
