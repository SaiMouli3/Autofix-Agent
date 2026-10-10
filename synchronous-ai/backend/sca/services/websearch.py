"""Live web search for agents, backed by Tavily (https://docs.tavily.com).

The Tavily API key is an organization secret (Settings → Web search, stored encrypted) or a
deployment-wide ``SCA_TAVILY_API_KEY``. Agents never see it: they call the platform's
``web_search`` / ``web_read`` tools, which run here, are permission-checked per call, rate limited
per task and audited. Results are returned to the agent as untrusted data.
"""

from __future__ import annotations

from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from sca.config import get_settings
from sca.models import Secret
from sca.security.netguard import BlockedTarget, check_url
from sca.security.redaction import redact_text, register_secret
from sca.services.secrets import put_secret, read_secret

API = "https://api.tavily.com"
_SECRET_NAME = "web_search:tavily"
MAX_RESULTS = 10
MAX_URLS = 5
MAX_PAGE_CHARS = 12_000
TOPICS = ("general", "news", "finance")
TIME_RANGES = ("day", "week", "month", "year")


class WebSearchError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _org_secret(db: Session, org_id: str) -> Secret | None:
    return db.execute(select(Secret).where(Secret.org_id == org_id, Secret.name == _SECRET_NAME)).scalar_one_or_none()


def api_key(db: Session, org_id: str) -> tuple[str, str]:
    """(key, source) where source is organization | deployment | ''."""
    sec = _org_secret(db, org_id)
    if sec is not None:
        key = read_secret(db, sec.id, org_id) or ""
        if key:
            return key, "organization"
    key = get_settings().tavily_api_key
    if key:
        register_secret(key)
        return key, "deployment"
    return "", ""


def status(db: Session, org_id: str) -> dict[str, Any]:
    key, source = api_key(db, org_id)
    sec = _org_secret(db, org_id)
    return {"provider": "tavily", "configured": bool(key), "source": source,
            "key_hint": (key[:9] + "…") if key else "",
            "fingerprint": sec.fingerprint if sec is not None and source == "organization" else None}


def set_key(db: Session, org_id: str, key: str, user_id: str) -> None:
    key = key.strip().strip("\"'").strip()
    if not key.startswith("tvly-") or len(key) < 20:
        raise WebSearchError("invalid_key", "That does not look like a Tavily API key (they start with tvly-).")
    put_secret(db, org_id, _SECRET_NAME, "web_search", key, user_id)


def delete_key(db: Session, org_id: str) -> bool:
    sec = _org_secret(db, org_id)
    if sec is None:
        return False
    db.delete(sec)
    return True


def _post(key: str, path: str, body: dict[str, Any], timeout: float = 30.0) -> dict[str, Any]:
    url = API + path
    try:
        check_url(url)
    except BlockedTarget as exc:
        raise WebSearchError("blocked_target", str(exc)) from exc
    try:
        r = httpx.post(url, json=body, headers={"Authorization": f"Bearer {key}"}, timeout=timeout, follow_redirects=False)
    except httpx.HTTPError as exc:
        raise WebSearchError("network_error", f"Tavily is unreachable ({type(exc).__name__})") from exc
    if r.status_code in (401, 403):
        raise WebSearchError("unauthorized", "Tavily rejected the API key. Check it in Settings → Web search.")
    if r.status_code == 429:
        raise WebSearchError("rate_limited", "Tavily rate limit or plan quota reached; try again later.")
    if r.status_code == 432 or r.status_code == 433:
        raise WebSearchError("quota_exceeded", "The Tavily plan's credit limit is reached.")
    if r.status_code >= 400:
        detail = ""
        try:
            detail = str((r.json() or {}).get("detail", ""))[:200]
        except ValueError:
            pass
        raise WebSearchError("provider_error", redact_text(f"Tavily returned HTTP {r.status_code} {detail}".strip()))
    try:
        return r.json()
    except ValueError as exc:
        raise WebSearchError("provider_error", "Tavily returned an unreadable response") from exc


def search(db: Session, org_id: str, query: str, *, max_results: int = 5, topic: str = "general",
           time_range: str | None = None, include_domains: list[str] | None = None,
           exclude_domains: list[str] | None = None, depth: str = "basic") -> dict[str, Any]:
    key, _ = api_key(db, org_id)
    if not key:
        raise WebSearchError("not_configured", "Web search is not set up. An administrator adds a Tavily API key in Settings → Web search.")
    query = (query or "").strip()
    if not query:
        raise WebSearchError("bad_request", "query is empty")
    body: dict[str, Any] = {
        "query": query[:400],
        "max_results": max(1, min(int(max_results or 5), MAX_RESULTS)),
        "topic": topic if topic in TOPICS else "general",
        "search_depth": "advanced" if depth == "advanced" else "basic",
        "include_answer": False, "include_raw_content": False, "include_images": False,
    }
    if time_range in TIME_RANGES:
        body["time_range"] = time_range
    if include_domains:
        body["include_domains"] = [d.strip()[:200] for d in include_domains[:10] if d.strip()]
    if exclude_domains:
        body["exclude_domains"] = [d.strip()[:200] for d in exclude_domains[:10] if d.strip()]
    data = _post(key, "/search", body)
    results = [{"title": (r.get("title") or "")[:300], "url": r.get("url", ""),
                "published_date": r.get("published_date"), "score": round(float(r.get("score") or 0), 3),
                "content": (r.get("content") or "")[:2000]}
               for r in (data.get("results") or []) if r.get("url")]
    return {"query": query, "results": results, "response_time": data.get("response_time")}


def extract(db: Session, org_id: str, urls: list[str]) -> dict[str, Any]:
    key, _ = api_key(db, org_id)
    if not key:
        raise WebSearchError("not_configured", "Web search is not set up. An administrator adds a Tavily API key in Settings → Web search.")
    clean = [u.strip() for u in (urls or []) if isinstance(u, str) and u.strip().lower().startswith(("http://", "https://"))]
    if not clean:
        raise WebSearchError("bad_request", "give one to five http(s) URLs")
    data = _post(key, "/extract", {"urls": clean[:MAX_URLS]}, timeout=60.0)
    pages = [{"url": r.get("url", ""), "content": (r.get("raw_content") or "")[:MAX_PAGE_CHARS],
              "truncated": len(r.get("raw_content") or "") > MAX_PAGE_CHARS}
             for r in (data.get("results") or [])]
    failed = [{"url": f.get("url"), "error": str(f.get("error", ""))[:200]} for f in (data.get("failed_results") or [])]
    return {"pages": pages, "failed": failed}
