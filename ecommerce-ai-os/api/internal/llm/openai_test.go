package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAICompatible(t *testing.T) {
	var got chatRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer k" {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":{"message":"bad auth"}}`))
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":" hello "},"finish_reason":"stop"}]}`))
	}))
	defer srv.Close()

	c := NewOpenAICompatible(srv.URL+"/v1/", "k", "m1")
	out, err := c.Complete(context.Background(), "sys", []Message{{Role: "user", Content: "hi"}}, 50)
	if err != nil || out != "hello" {
		t.Fatalf("got %q, %v", out, err)
	}
	if got.Model != "m1" || len(got.Messages) != 2 || got.Messages[0].Role != "system" {
		t.Fatalf("unexpected request %+v", got)
	}
	bad := NewOpenAICompatible(srv.URL+"/v1", "wrong", "m1")
	if _, err := bad.Complete(context.Background(), "", []Message{{Role: "user", Content: "hi"}}, 50); err == nil {
		t.Fatal("expected auth error")
	}
}
