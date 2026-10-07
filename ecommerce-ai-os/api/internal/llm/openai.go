package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OpenAICompatible talks to gateways that expose an OpenAI-style
// /chat/completions endpoint (e.g. the Experiential Labs API).
type OpenAICompatible struct {
	baseURL string
	apiKey  string
	model   string
	http    *http.Client
}

func NewOpenAICompatible(baseURL, apiKey, model string) *OpenAICompatible {
	return &OpenAICompatible{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		model:   model,
		http:    &http.Client{Timeout: 90 * time.Second},
	}
}

func (o *OpenAICompatible) Enabled() bool { return true }
func (o *OpenAICompatible) Model() string { return o.model }

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model     string        `json:"model"`
	Messages  []chatMessage `json:"messages"`
	MaxTokens int           `json:"max_tokens,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message      chatMessage `json:"message"`
		FinishReason string      `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (o *OpenAICompatible) Complete(ctx context.Context, system string, msgs []Message, maxTokens int) (string, error) {
	req := chatRequest{Model: o.model, MaxTokens: maxTokens}
	if system != "" {
		req.Messages = append(req.Messages, chatMessage{Role: "system", Content: system})
	}
	for _, m := range msgs {
		if strings.TrimSpace(m.Content) == "" {
			continue
		}
		role := "user"
		if m.Role == "assistant" {
			role = "assistant"
		}
		req.Messages = append(req.Messages, chatMessage{Role: role, Content: m.Content})
	}
	body, _ := json.Marshal(req)
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(time.Duration(attempt) * 800 * time.Millisecond):
			}
		}
		text, retry, err := o.do(ctx, body)
		if err == nil {
			return text, nil
		}
		lastErr = err
		if !retry {
			break
		}
	}
	return "", lastErr
}

func (o *OpenAICompatible) do(ctx context.Context, body []byte) (string, bool, error) {
	hr, err := http.NewRequestWithContext(ctx, http.MethodPost, o.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", false, err
	}
	hr.Header.Set("Authorization", "Bearer "+o.apiKey)
	hr.Header.Set("Content-Type", "application/json")
	res, err := o.http.Do(hr)
	if err != nil {
		return "", true, fmt.Errorf("llm gateway unreachable: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	var cr chatResponse
	_ = json.Unmarshal(raw, &cr)
	if res.StatusCode >= 300 {
		msg := strings.TrimSpace(string(raw))
		if cr.Error != nil && cr.Error.Message != "" {
			msg = cr.Error.Message
		}
		if len(msg) > 300 {
			msg = msg[:300]
		}
		retry := res.StatusCode == 429 || res.StatusCode >= 500
		return "", retry, fmt.Errorf("llm gateway returned %d: %s", res.StatusCode, msg)
	}
	if len(cr.Choices) == 0 {
		return "", false, fmt.Errorf("llm gateway returned no choices")
	}
	if cr.Choices[0].FinishReason == "content_filter" {
		return "", false, ErrRefused
	}
	return strings.TrimSpace(cr.Choices[0].Message.Content), false, nil
}
