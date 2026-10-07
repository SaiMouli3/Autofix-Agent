// Package llm is the language layer. It is used only for reasoning,
// summarisation, classification, explanation and drafting — never for
// computing metrics, which the agents calculate deterministically.
package llm

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

type Message struct {
	Role    string `json:"role"` // user | assistant
	Content string `json:"content"`
}

type Client interface {
	Enabled() bool
	Model() string
	Complete(ctx context.Context, system string, msgs []Message, maxTokens int) (string, error)
}

var ErrDisabled = errors.New("llm: no API key configured")
var ErrRefused = errors.New("llm: request declined by the model")

// ---------------------------------------------------------------- disabled

type Disabled struct{}

func (Disabled) Enabled() bool { return false }
func (Disabled) Model() string { return "deterministic" }
func (Disabled) Complete(context.Context, string, []Message, int) (string, error) {
	return "", ErrDisabled
}

// ---------------------------------------------------------------- anthropic

type Anthropic struct {
	client    anthropic.Client
	model     string
	effort    anthropic.OutputConfigEffort
	fallbacks bool
}

type Options struct {
	APIKey    string
	BaseURL   string
	Model     string
	Effort    string
	Fallbacks bool
}

func New(o Options) Client {
	if o.APIKey == "" {
		return Disabled{}
	}
	opts := []option.RequestOption{option.WithAPIKey(o.APIKey), option.WithRequestTimeout(90 * time.Second), option.WithMaxRetries(2)}
	if o.BaseURL != "" {
		opts = append(opts, option.WithBaseURL(o.BaseURL))
	}
	effort := anthropic.OutputConfigEffort(o.Effort)
	switch effort {
	case anthropic.OutputConfigEffortLow, anthropic.OutputConfigEffortMedium, anthropic.OutputConfigEffortHigh, anthropic.OutputConfigEffortXhigh, anthropic.OutputConfigEffortMax:
	default:
		effort = anthropic.OutputConfigEffortLow
	}
	slog.Info("llm enabled", "model", o.Model, "effort", effort, "fallbacks", o.Fallbacks)
	return &Anthropic{client: anthropic.NewClient(opts...), model: o.Model, effort: effort, fallbacks: o.Fallbacks}
}

func (a *Anthropic) Enabled() bool { return true }
func (a *Anthropic) Model() string { return a.model }

func (a *Anthropic) Complete(ctx context.Context, system string, msgs []Message, maxTokens int) (string, error) {
	params := anthropic.MessageNewParams{
		Model:        anthropic.Model(a.model),
		MaxTokens:    int64(maxTokens),
		System:       []anthropic.TextBlockParam{{Text: system, CacheControl: anthropic.NewCacheControlEphemeralParam()}},
		OutputConfig: anthropic.OutputConfigParam{Effort: a.effort},
	}
	for _, m := range msgs {
		if strings.TrimSpace(m.Content) == "" {
			continue
		}
		if m.Role == "assistant" {
			params.Messages = append(params.Messages, anthropic.NewAssistantMessage(anthropic.NewTextBlock(m.Content)))
		} else {
			params.Messages = append(params.Messages, anthropic.NewUserMessage(anthropic.NewTextBlock(m.Content)))
		}
	}
	var reqOpts []option.RequestOption
	if a.fallbacks {
		// Server-side refusal fallback: a declined request is re-served by
		// a suitable fallback model inside the same call.
		reqOpts = append(reqOpts,
			option.WithHeaderAdd("anthropic-beta", "server-side-fallback-2026-07-01"),
			option.WithJSONSet("fallbacks", "default"))
	}
	resp, err := a.client.Messages.New(ctx, params, reqOpts...)
	if err != nil {
		return "", err
	}
	if resp.StopReason == anthropic.StopReasonRefusal {
		return "", ErrRefused
	}
	var sb strings.Builder
	for _, block := range resp.Content {
		if t, ok := block.AsAny().(anthropic.TextBlock); ok {
			sb.WriteString(t.Text)
		}
	}
	return strings.TrimSpace(sb.String()), nil
}
