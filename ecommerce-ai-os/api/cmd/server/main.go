// Command server runs the E-commerce AI OS API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/auth"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/cache"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/config"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/httpapi"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/llm"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/repo"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/service"
)

const (
	demoEmail    = "admin@loomline.in"
	demoPassword = "demo-loomline"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	cfg := config.Load()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	var r repo.Repo
	if cfg.DatabaseURL != "" {
		pg, err := repo.NewPostgres(ctx, cfg.DatabaseURL)
		if err != nil {
			slog.Error("postgres unavailable", "err", err)
			os.Exit(1)
		}
		r = pg
		slog.Info("repository: postgres")
	} else {
		r = repo.NewMemory()
		slog.Warn("repository: in-memory (set DATABASE_URL for persistence)")
	}
	defer r.Close()

	var c cache.Cache
	if cfg.RedisURL != "" {
		rc, err := cache.NewRedis(ctx, cfg.RedisURL)
		if err != nil {
			slog.Warn("redis unavailable, using in-memory cache", "err", err)
			c = cache.NewMemory()
		} else {
			c = rc
			slog.Info("cache: redis")
		}
	} else {
		c = cache.NewMemory()
	}
	defer c.Close()

	var l llm.Client
	switch {
	case cfg.ExpLabsAPIKey != "" && cfg.ExpLabsProtocol == "anthropic":
		// The Anthropic SDK appends /v1/messages itself.
		base := strings.TrimSuffix(strings.TrimRight(cfg.ExpLabsBaseURL, "/"), "/v1")
		l = llm.New(llm.Options{APIKey: cfg.ExpLabsAPIKey, BaseURL: base, Model: cfg.ExpLabsModel, Effort: cfg.LLMEffort})
		slog.Info("llm: Experiential Labs gateway (anthropic protocol)", "model", cfg.ExpLabsModel)
	case cfg.ExpLabsAPIKey != "":
		l = llm.NewOpenAICompatible(cfg.ExpLabsBaseURL, cfg.ExpLabsAPIKey, cfg.ExpLabsModel)
		slog.Info("llm: Experiential Labs gateway", "base_url", cfg.ExpLabsBaseURL, "model", cfg.ExpLabsModel)
	default:
		l = llm.New(llm.Options{APIKey: cfg.AnthropicAPIKey, BaseURL: cfg.AnthropicBaseURL, Model: cfg.LLMModel, Effort: cfg.LLMEffort, Fallbacks: cfg.LLMFallbacks})
	}
	if !l.Enabled() {
		slog.Warn("no LLM key set (EXP_LABS_API_KEY / ANTHROPIC_API_KEY) — assistant runs on the deterministic reasoner")
	}
	svc := service.New(r, c, l)

	if cfg.SeedDemo {
		if err := seedDemo(ctx, svc); err != nil {
			slog.Error("demo seed failed", "err", err)
		}
	}

	srv := httpapi.New(cfg, svc)
	go func() {
		if err := srv.App.Listen(":" + cfg.Port); err != nil {
			slog.Error("server stopped", "err", err)
			os.Exit(1)
		}
	}()
	slog.Info("api listening", "port", cfg.Port)
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	_ = srv.App.ShutdownWithTimeout(10 * time.Second)
}

// seedDemo ensures a ready-to-use demo account exists.
func seedDemo(ctx context.Context, svc *service.Service) error {
	u, err := svc.Repo.UserByEmail(ctx, demoEmail)
	if errors.Is(err, repo.ErrNotFound) {
		hash, herr := auth.HashPassword(demoPassword)
		if herr != nil {
			return herr
		}
		u, err = svc.Repo.CreateOrgUser(ctx, "Loomline", model.User{Name: "Admin", Email: demoEmail, PasswordHash: hash})
	}
	if err != nil {
		return err
	}
	stores, err := svc.Repo.StoresByOrg(ctx, u.OrgID)
	if err != nil {
		return err
	}
	if len(stores) == 0 {
		start := time.Now()
		st, err := svc.CreateDemoStore(ctx, u.OrgID, "fashion", "Loomline — India")
		if err != nil {
			return err
		}
		slog.Info("demo store seeded", "store", st.ID, "took", time.Since(start), "login", demoEmail)
	}
	return nil
}
