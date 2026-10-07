// Package config loads runtime configuration from environment variables.
// Secrets are only ever read from the environment — never from code.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Env          string
	Port         string
	DatabaseURL  string // optional: in-memory repository when empty
	RedisURL     string // optional: in-memory cache/rate limiting when empty
	JWTSecret    string
	CookieSecure bool
	CORSOrigins  string
	SeedDemo     bool

	AnthropicAPIKey  string
	AnthropicBaseURL string
	LLMModel         string
	LLMEffort        string
	LLMFallbacks     bool

	// Experiential Labs gateway (takes precedence over the direct Anthropic key).
	ExpLabsAPIKey   string
	ExpLabsBaseURL  string
	ExpLabsModel    string
	ExpLabsProtocol string // openai (chat/completions) | anthropic (messages)

	GoogleClientID string
}

func get(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func getBool(key string, def bool) bool {
	v, err := strconv.ParseBool(os.Getenv(key))
	if err != nil {
		return def
	}
	return v
}

func Load() Config {
	c := Config{
		Env:              get("APP_ENV", "development"),
		Port:             get("PORT", "8080"),
		DatabaseURL:      get("DATABASE_URL", ""),
		RedisURL:         get("REDIS_URL", ""),
		JWTSecret:        get("JWT_SECRET", ""),
		CORSOrigins:      get("CORS_ORIGINS", "http://localhost:3000"),
		SeedDemo:         getBool("SEED_DEMO", true),
		AnthropicAPIKey:  get("ANTHROPIC_API_KEY", ""),
		AnthropicBaseURL: get("ANTHROPIC_BASE_URL", ""),
		LLMModel:         get("LLM_MODEL", "claude-opus-5-5"),
		LLMEffort:        get("LLM_EFFORT", "low"),
		GoogleClientID:   get("GOOGLE_CLIENT_ID", ""),
		ExpLabsAPIKey:    get("EXP_LABS_API_KEY", ""),
		ExpLabsBaseURL:   get("EXP_LABS_BASE_URL", "https://api.experientiallabs.ai/v1"),
		ExpLabsProtocol:  get("EXP_LABS_PROTOCOL", "openai"),
	}
	// Gateway model IDs use dots (e.g. claude-opus-5.5).
	c.ExpLabsModel = get("EXP_LABS_MODEL", "claude-opus-5.5")
	c.CookieSecure = getBool("COOKIE_SECURE", c.Env == "production")
	// Server-side refusal fallbacks are a first-party API feature; default
	// them off when a custom gateway/base URL is configured.
	c.LLMFallbacks = getBool("LLM_FALLBACKS", c.AnthropicBaseURL == "")
	if c.JWTSecret == "" {
		if c.Env == "production" {
			slog.Error("JWT_SECRET must be set in production")
			os.Exit(1)
		}
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		c.JWTSecret = hex.EncodeToString(b)
		slog.Warn("JWT_SECRET not set — using an ephemeral development secret; sessions reset on restart")
	}
	return c
}

func (c Config) Production() bool { return c.Env == "production" }
