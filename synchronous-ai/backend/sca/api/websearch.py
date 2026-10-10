"""Web search settings (Tavily): store the key once per organization and test it live."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from sca.api.deps import Principal, require
from sca.db import get_db
from sca.services import audit, websearch

router = APIRouter(prefix="/api/web-search", tags=["web-search"])


class KeyIn(BaseModel):
    api_key: str = Field(min_length=10, max_length=300)


class TestIn(BaseModel):
    query: str = Field(default="latest news about AI agents", min_length=2, max_length=300)


@router.get("")
def get_status(p: Principal = Depends(require("agents:read")), db: Session = Depends(get_db)):
    return websearch.status(db, p.org_id)


@router.put("")
def set_key(body: KeyIn, p: Principal = Depends(require("settings:write")), db: Session = Depends(get_db)):
    try:
        websearch.set_key(db, p.org_id, body.api_key, p.user_id)
    except websearch.WebSearchError as exc:
        raise HTTPException(422, exc.message) from exc
    audit.record(db, p.org_id, "web_search.key_set", actor_id=p.user_id, target_type="web_search", target_id="tavily")
    db.commit()
    return websearch.status(db, p.org_id)


@router.delete("")
def delete_key(p: Principal = Depends(require("settings:write")), db: Session = Depends(get_db)):
    if not websearch.delete_key(db, p.org_id):
        raise HTTPException(404, "no web search key is stored for this organization")
    audit.record(db, p.org_id, "web_search.key_deleted", actor_id=p.user_id, target_type="web_search", target_id="tavily")
    db.commit()
    return websearch.status(db, p.org_id)


@router.post("/test")
def test(body: TestIn, p: Principal = Depends(require("settings:write")), db: Session = Depends(get_db)):
    """Run one real search with the stored key and return the result titles and links."""
    try:
        out = websearch.search(db, p.org_id, body.query, max_results=3)
    except websearch.WebSearchError as exc:
        return {"ok": False, "error": exc.message}
    audit.record(db, p.org_id, "web_search.tested", actor_id=p.user_id, target_type="web_search", target_id="tavily",
                 details={"results": len(out["results"])})
    db.commit()
    return {"ok": True, "results": [{"title": r["title"], "url": r["url"]} for r in out["results"]],
            "response_time": out.get("response_time")}
