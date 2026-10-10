"""Model provider configuration, connection testing and LLM construction.

Experiential Labs (https://api.experientiallabs.ai/v1) exposes an OpenAI-compatible
API: ``GET /models`` (catalog including tool support and published pricing),
``POST /chat/completions`` (with ``tools``), and ``POST /embeddings``, authenticated
with ``Authorization: Bearer <key>``. Because the protocol is OpenAI-compatible,
the existing OpenHands/LiteLLM ``openai/`` adapter is reused with ``base_url``
rather than writing a bespoke client.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
from pydantic import SecretStr
from sqlalchemy.orm import Session

from sca.config import get_settings
from sca.models import ModelProvider, utcnow
from sca.security.redaction import redact_text
from sca.services.secrets import read_secret

PROVIDER_KINDS: dict[str, dict[str, Any]] = {
    "experiential_labs": {
        "label": "Experiential Labs",
        "default_base_url": "https://api.experientiallabs.ai/v1",
        "protocol": "openai",
        "base_url_editable": True,
    },
    "openai_compatible": {
        "label": "OpenAI-compatible endpoint",
        "default_base_url": "",
        "protocol": "openai",
        "base_url_editable": True,
    },
    "openai": {"label": "OpenAI", "default_base_url": "https://api.openai.com/v1", "protocol": "openai", "base_url_editable": False},
    "anthropic": {"label": "Anthropic", "default_base_url": "https://api.anthropic.com", "protocol": "anthropic", "base_url_editable": False},
}


class ProviderError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


def _base_url(p: ModelProvider) -> str:
    return (p.base_url or PROVIDER_KINDS.get(p.kind, {}).get("default_base_url", "")).rstrip("/")


def _headers(p: ModelProvider, key: str) -> dict[str, str]:
    if PROVIDER_KINDS[p.kind]["protocol"] == "anthropic":
        return {"x-api-key": key, "anthropic-version": "2023-06-01"}
    return {"Authorization": f"Bearer {key}"}


def _classify_http(resp: httpx.Response) -> ProviderError:
    body = redact_text(resp.text[:400])
    if resp.status_code in (401, 403):
        return ProviderError("auth_failed", f"Authentication failed (HTTP {resp.status_code}). Check the API key.")
    if resp.status_code == 404:
        return ProviderError("not_found", f"Endpoint or model not found (HTTP 404): {body}")
    if resp.status_code == 429:
        return ProviderError("rate_limited", "Provider rate limit reached (HTTP 429).", retryable=True)
    if resp.status_code >= 500:
        return ProviderError("provider_unavailable", f"Provider error (HTTP {resp.status_code}).", retryable=True)
    return ProviderError("bad_request", f"Provider rejected the request (HTTP {resp.status_code}): {body}")


def _price_per_token(m: dict[str, Any]) -> tuple[float | None, float | None]:
    pricing = m.get("pricing") or {}
    inp = pricing.get("input_nano_usd_per_million_tokens")
    out = pricing.get("output_nano_usd_per_million_tokens")
    to_tok = lambda v: (v / 1e9) / 1e6 if isinstance(v, (int, float)) else None  # noqa: E731
    return to_tok(inp), to_tok(out)


def fetch_catalog(p: ModelProvider, key: str, timeout: float = 20.0) -> list[dict[str, Any]]:
    """Fetch the provider's model list (OpenAI-compatible providers only)."""
    if PROVIDER_KINDS[p.kind]["protocol"] != "openai":
        return []
    try:
        r = httpx.get(f"{_base_url(p)}/models", headers=_headers(p, key), timeout=timeout)
    except httpx.TimeoutException as exc:
        raise ProviderError("timeout", "Timed out contacting the provider.", retryable=True) from exc
    except httpx.HTTPError as exc:
        raise ProviderError("network_error", f"Could not reach provider: {type(exc).__name__}", retryable=True) from exc
    if r.status_code != 200:
        raise _classify_http(r)
    try:
        data = r.json()["data"]
    except Exception as exc:  # noqa: BLE001
        raise ProviderError("malformed_response", "Provider returned an unexpected /models payload.") from exc
    catalog = []
    for m in data:
        if not isinstance(m, dict) or "id" not in m:
            continue
        inp, out = _price_per_token(m)
        catalog.append({
            "id": m["id"],
            "supports_tools": m.get("supports_tools"),
            "context_window": m.get("context_window_tokens"),
            "max_output_tokens": m.get("maximum_output_tokens"),
            "input_usd_per_token": inp,
            "output_usd_per_token": out,
        })
    return catalog


def test_provider(db: Session, p: ModelProvider, model: str | None = None) -> dict[str, Any]:
    """Real connection test: list models, then a minimal tool-calling completion."""
    started = time.monotonic()
    result: dict[str, Any] = {"ok": False, "checks": []}
    key = read_secret(db, p.secret_id, p.org_id)
    if not key:
        result["error"] = {"code": "missing_credential", "message": "No API key configured for this provider."}
        return _store(db, p, result)
    model = model or p.default_model
    try:
        if PROVIDER_KINDS[p.kind]["protocol"] == "openai":
            catalog = fetch_catalog(p, key)
            p.catalog = catalog
            ids = {m["id"] for m in catalog}
            result["checks"].append({"name": "list_models", "ok": True, "detail": f"{len(catalog)} models available"})
            if model and ids and model not in ids:
                raise ProviderError("unknown_model", f"Model '{model}' is not offered by this provider.")
            entry = next((m for m in catalog if m["id"] == model), None)
            if entry and entry.get("supports_tools") is False:
                raise ProviderError(
                    "no_tool_calling",
                    f"Model '{model}' does not support tool calling, which the OpenHands agent runtime requires.",
                )
            if not model:
                raise ProviderError("no_model", "Set a default model to complete the test.")
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": "Call the ping tool with value 'ok'."}],
                "tools": [{
                    "type": "function",
                    "function": {"name": "ping", "description": "Connectivity check",
                                 "parameters": {"type": "object", "properties": {"value": {"type": "string"}},
                                                "required": ["value"]}},
                }],
                "max_tokens": 200,
            }
            t0 = time.monotonic()
            r = httpx.post(f"{_base_url(p)}/chat/completions", headers=_headers(p, key), json=payload, timeout=90)
            if r.status_code != 200:
                raise _classify_http(r)
            try:
                body = r.json()
                msg = body["choices"][0]["message"]
            except Exception as exc:  # noqa: BLE001
                raise ProviderError("malformed_response", "Unexpected chat completion payload.") from exc
            tool_ok = bool(msg.get("tool_calls"))
            result["checks"].append({
                "name": "chat_completion", "ok": True,
                "detail": f"{model} responded in {int((time.monotonic() - t0) * 1000)} ms",
            })
            result["checks"].append({
                "name": "tool_calling", "ok": tool_ok,
                "detail": "model emitted a tool call" if tool_ok else "model answered without calling the tool",
            })
            usage = body.get("usage") or {}
            result["usage"] = {k: usage.get(k) for k in ("prompt_tokens", "completion_tokens", "cost") if k in usage}
            result["ok"] = tool_ok
            if not tool_ok:
                result["error"] = {"code": "no_tool_calling", "message": "Model did not emit a tool call."}
        else:  # anthropic native
            r = httpx.post(
                f"{_base_url(p)}/v1/messages", headers={**_headers(p, key), "content-type": "application/json"},
                json={"model": model, "max_tokens": 16, "messages": [{"role": "user", "content": "ping"}]}, timeout=60,
            )
            if r.status_code != 200:
                raise _classify_http(r)
            result["checks"].append({"name": "messages", "ok": True, "detail": f"{model} responded"})
            result["ok"] = True
    except ProviderError as exc:
        result["error"] = {"code": exc.code, "message": redact_text(exc.message)}
    except httpx.TimeoutException:
        result["error"] = {"code": "timeout", "message": "Timed out contacting the provider."}
    except httpx.HTTPError as exc:
        result["error"] = {"code": "network_error", "message": f"Could not reach provider: {type(exc).__name__}"}
    result["latency_ms"] = int((time.monotonic() - started) * 1000)
    result["model"] = model
    return _store(db, p, result)


def _store(db: Session, p: ModelProvider, result: dict[str, Any]) -> dict[str, Any]:
    p.status = "ok" if result.get("ok") else "error"
    p.last_tested_at = utcnow()
    p.last_test_result = result
    db.flush()
    return result


def litellm_model_name(p: ModelProvider, model: str) -> str:
    if PROVIDER_KINDS[p.kind]["protocol"] == "anthropic":
        return model if model.startswith("anthropic/") else f"anthropic/{model}"
    return model if model.startswith("openai/") else f"openai/{model}"


def pricing_for(p: ModelProvider, model: str) -> tuple[float | None, float | None]:
    for m in p.catalog or []:
        if m.get("id") == model:
            return m.get("input_usd_per_token"), m.get("output_usd_per_token")
    return None, None


def build_llm(db: Session, p: ModelProvider, model_cfg: dict[str, Any], *, model_override: str | None = None,
              usage_id: str = "agent"):
    """Construct an OpenHands SDK ``LLM`` for this provider (credentials decrypted in-process)."""
    from openhands.sdk import LLM

    key = read_secret(db, p.secret_id, p.org_id)
    if not key:
        raise ProviderError("missing_credential", f"Provider '{p.name}' has no API key configured.")
    model = model_override or model_cfg["model"]
    in_cost, out_cost = pricing_for(p, model)
    kwargs: dict[str, Any] = dict(
        model=litellm_model_name(p, model),
        api_key=SecretStr(key),
        usage_id=usage_id,
        timeout=model_cfg.get("timeout_s") or 180,
        num_retries=get_settings().llm_num_retries,
        retry_min_wait=4,
        retry_max_wait=30,
        drop_params=True,
    )
    if PROVIDER_KINDS[p.kind]["protocol"] == "openai" and p.kind != "openai":
        kwargs["base_url"] = _base_url(p)
    if model_cfg.get("max_output_tokens"):
        kwargs["max_output_tokens"] = model_cfg["max_output_tokens"]
    if model_cfg.get("temperature") is not None:
        kwargs["temperature"] = model_cfg["temperature"]
    if model_cfg.get("top_p") is not None:
        kwargs["top_p"] = model_cfg["top_p"]
    if in_cost is not None and out_cost is not None:
        kwargs["input_cost_per_token"] = in_cost
        kwargs["output_cost_per_token"] = out_cost
    return LLM(**kwargs), (in_cost is not None and out_cost is not None)


def embed_texts(db: Session, p: ModelProvider, texts: list[str]) -> list[list[float]]:
    """OpenAI-compatible /embeddings call. Raises ProviderError on failure."""
    key = read_secret(db, p.secret_id, p.org_id)
    if not key or not p.embedding_model or PROVIDER_KINDS[p.kind]["protocol"] != "openai":
        raise ProviderError("embeddings_unavailable", "No embedding model configured.")
    out: list[list[float]] = []
    for i in range(0, len(texts), 64):
        batch = texts[i : i + 64]
        try:
            r = httpx.post(f"{_base_url(p)}/embeddings", headers=_headers(p, key),
                           json={"model": p.embedding_model, "input": batch}, timeout=60)
        except httpx.HTTPError as exc:
            raise ProviderError("network_error", f"Embedding request failed: {type(exc).__name__}", True) from exc
        if r.status_code != 200:
            raise _classify_http(r)
        data = sorted(r.json()["data"], key=lambda d: d["index"])
        out.extend(d["embedding"] for d in data)
    return out
