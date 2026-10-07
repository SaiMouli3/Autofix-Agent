// Package httpapi exposes the REST API. Handlers validate input, resolve the
// tenant (user → organization → store) and delegate to the service layer.
package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/fiber/v2/middleware/requestid"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/auth"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/config"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/repo"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/service"
)

type Server struct {
	App  *fiber.App
	cfg  config.Config
	svc  *service.Service
	auth *auth.Manager
}

type apiError struct {
	Status  int
	Code    string
	Message string
	Hint    string
}

func (e *apiError) Error() string { return e.Message }

func Err(status int, code, msg, hint string) error {
	return &apiError{Status: status, Code: code, Message: msg, Hint: hint}
}

func errorHandler(c *fiber.Ctx, err error) error {
	var ae *apiError
	var fe *fiber.Error
	switch {
	case errors.As(err, &ae):
	case errors.Is(err, repo.ErrNotFound):
		ae = &apiError{Status: 404, Code: "not_found", Message: "The requested resource doesn't exist or you don't have access to it."}
	case errors.As(err, &fe):
		ae = &apiError{Status: fe.Code, Code: "http_error", Message: fe.Message}
	case errors.Is(err, context.DeadlineExceeded):
		ae = &apiError{Status: 504, Code: "timeout", Message: "The analysis took too long to complete.", Hint: "Try again in a moment."}
	default:
		slog.Error("unhandled error", "path", c.Path(), "err", err, "request_id", c.Locals("requestid"))
		ae = &apiError{Status: 500, Code: "internal", Message: "Something went wrong on our side.", Hint: "The team has been notified. Try again shortly."}
	}
	return c.Status(ae.Status).JSON(fiber.Map{"error": fiber.Map{"code": ae.Code, "message": ae.Message, "hint": ae.Hint}})
}

func New(cfg config.Config, svc *service.Service) *Server {
	app := fiber.New(fiber.Config{
		AppName:      "E-commerce AI OS API",
		ErrorHandler: errorHandler,
		BodyLimit:    1 << 20,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 120 * time.Second,
		ProxyHeader:  fiber.HeaderXForwardedFor,
	})
	s := &Server{App: app, cfg: cfg, svc: svc, auth: auth.NewManager(cfg.JWTSecret)}
	app.Use(recover.New())
	app.Use(requestid.New())
	app.Use(helmet.New(helmet.Config{CrossOriginEmbedderPolicy: "unsafe-none"}))
	app.Use(cors.New(cors.Config{AllowOrigins: cfg.CORSOrigins, AllowCredentials: true, AllowHeaders: "Content-Type, X-Store-ID, Authorization"}))
	app.Use(s.logRequests)
	s.routes()
	return s
}

func (s *Server) logRequests(c *fiber.Ctx) error {
	start := time.Now()
	err := c.Next()
	if strings.HasPrefix(c.Path(), "/api/") {
		status := c.Response().StatusCode()
		if err != nil {
			var ae *apiError
			if errors.As(err, &ae) {
				status = ae.Status
			}
		}
		slog.Info("request", "method", c.Method(), "path", c.Path(), "status", status, "ms", time.Since(start).Milliseconds(), "request_id", c.Locals("requestid"))
	}
	return err
}

// rateLimit is a fixed-window limiter keyed by client IP and bucket name.
func (s *Server) rateLimit(name string, limit int64, window time.Duration) fiber.Handler {
	return func(c *fiber.Ctx) error {
		key := fmt.Sprintf("%s:%s:%d", name, c.IP(), time.Now().Unix()/int64(window.Seconds()))
		n, err := s.svc.Cache.Incr(c.UserContext(), key, window)
		if err == nil && n > limit {
			c.Set("Retry-After", fmt.Sprint(int(window.Seconds())))
			return Err(429, "rate_limited", "Too many requests.", "Wait a moment and try again.")
		}
		return c.Next()
	}
}

// requireAuth resolves the session to a user and organization.
func (s *Server) requireAuth(c *fiber.Ctx) error {
	token := c.Cookies(auth.CookieName)
	if token == "" {
		if h := c.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			token = strings.TrimPrefix(h, "Bearer ")
		}
	}
	if token == "" {
		return Err(401, "unauthenticated", "Please sign in to continue.", "")
	}
	claims, err := s.auth.Parse(token)
	if err != nil {
		return Err(401, "session_expired", "Your session has expired.", "Sign in again to continue.")
	}
	u, err := s.svc.Repo.UserByID(c.UserContext(), claims.Subject)
	if err != nil || u.OrgID != claims.OrgID {
		return Err(401, "session_invalid", "Your session is no longer valid.", "Sign in again to continue.")
	}
	c.Locals("user", u)
	return c.Next()
}

func userOf(c *fiber.Ctx) *model.User { return c.Locals("user").(*model.User) }

// requireStore resolves the active store and enforces organization isolation:
// a store ID from another organization is indistinguishable from a missing one.
func (s *Server) requireStore(c *fiber.Ctx) error {
	u := userOf(c)
	id := c.Get("X-Store-ID")
	if id == "" {
		id = c.Query("storeId")
	}
	ctx := c.UserContext()
	if id == "" {
		stores, err := s.svc.Repo.StoresByOrg(ctx, u.OrgID)
		if err != nil {
			return err
		}
		if len(stores) == 0 {
			return Err(409, "no_store", "No store is connected yet.", "Connect a store to start your AI operations team.")
		}
		id = stores[0].ID
	}
	st, err := s.svc.Repo.StoreForOrg(ctx, u.OrgID, id)
	if err != nil {
		return Err(404, "store_not_found", "That store doesn't exist in your organization.", "Pick a store from the store selector.")
	}
	c.Locals("store", st)
	return c.Next()
}

func storeOf(c *fiber.Ctx) model.Store { return *c.Locals("store").(*model.Store) }

func (s *Server) setSession(c *fiber.Ctx, u *model.User, remember bool) error {
	ttl := 24 * time.Hour
	if remember {
		ttl = 30 * 24 * time.Hour
	}
	tok, err := s.auth.Issue(u.ID, u.OrgID, ttl)
	if err != nil {
		return err
	}
	ck := &fiber.Cookie{Name: auth.CookieName, Value: tok, HTTPOnly: true, Secure: s.cfg.CookieSecure, SameSite: "Lax", Path: "/"}
	if remember {
		ck.Expires = time.Now().Add(ttl)
	}
	c.Cookie(ck)
	return nil
}
