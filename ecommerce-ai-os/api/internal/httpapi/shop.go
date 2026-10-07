package httpapi

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/service"
)

// Public storefront. It needs no session: it sells from the one store
// configured as the shop (SHOP_STORE_ID, or the demo store) and only ever
// exposes shopper-facing fields.
func (s *Server) shopRoutes(api fiber.Router) {
	shop := api.Group("/shop", s.rateLimit("shop", 300, time.Minute), s.shopStore)
	shop.Get("", s.shopHome)
	shop.Get("/products", s.shopCatalog)
	shop.Get("/products/:id", s.shopProduct)
	shop.Post("/orders", s.rateLimit("checkout", 10, time.Minute), s.shopOrder)
}

func (s *Server) shopStore(c *fiber.Ctx) error {
	id := s.svc.ShopStoreID
	if id == "" {
		return Err(503, "shop_unavailable", "The store is not open yet.", "")
	}
	st, err := s.svc.Repo.StoreByID(c.UserContext(), id)
	if err != nil {
		return Err(503, "shop_unavailable", "The store is not open yet.", "")
	}
	c.Locals("store", st)
	return c.Next()
}

func (s *Server) shopHome(c *fiber.Ctx) error {
	out, err := s.svc.ShopHome(c.UserContext(), storeOf(c))
	if err != nil {
		return err
	}
	return c.JSON(out)
}

func (s *Server) shopCatalog(c *fiber.Ctx) error {
	q := c.Query("q")
	if utf8.RuneCountInString(q) > 80 {
		q = string([]rune(q)[:80])
	}
	out, err := s.svc.ShopCatalog(c.UserContext(), storeOf(c), c.Query("category"), q, c.Query("sort"), c.QueryInt("page", 1), c.QueryInt("pageSize", 24))
	if err != nil {
		return err
	}
	return c.JSON(out)
}

func (s *Server) shopProduct(c *fiber.Ctx) error {
	out, err := s.svc.ShopProductDetail(c.UserContext(), storeOf(c), c.Params("id"))
	if err != nil {
		return err
	}
	return c.JSON(out)
}

func (s *Server) shopOrder(c *fiber.Ctx) error {
	var req service.OrderRequest
	if err := c.BodyParser(&req); err != nil {
		return Err(400, "invalid_body", "The request body is not valid JSON.", "")
	}
	cu := &req.Customer
	cu.Name, cu.Email, cu.Phone, cu.City = strings.TrimSpace(cu.Name), strings.ToLower(strings.TrimSpace(cu.Email)), strings.TrimSpace(cu.Phone), strings.TrimSpace(cu.City)
	n := utf8.RuneCountInString
	switch {
	case n(cu.Name) < 2 || n(cu.Name) > 80:
		return Err(422, "invalid_name", "Enter your full name (2–80 characters).", "")
	case !validEmail(cu.Email):
		return Err(422, "invalid_email", "Enter a valid email address.", "")
	case n(cu.Phone) > 20:
		return Err(422, "invalid_phone", "Enter a shorter phone number.", "")
	case n(cu.City) < 2 || n(cu.City) > 60:
		return Err(422, "invalid_city", "Enter your city.", "")
	case cu.State == "":
		return Err(422, "invalid_state", "Choose your state.", "")
	}
	out, err := s.svc.PlaceOrder(c.UserContext(), storeOf(c), req)
	switch {
	case errors.Is(err, service.ErrOutOfStock):
		return Err(409, "out_of_stock", strings.TrimPrefix(err.Error(), service.ErrOutOfStock.Error()+": "), "Lower the quantity or remove the item from your cart.")
	case errors.Is(err, service.ErrInvalidOrder):
		return Err(422, "invalid_order", strings.TrimPrefix(err.Error(), service.ErrInvalidOrder.Error()+": "), "")
	case err != nil:
		return err
	}
	return c.Status(201).JSON(out)
}
