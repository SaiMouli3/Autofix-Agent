"""Model provider configuration and connection testing."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from sca.api.deps import Principal, require, scoped
from sca.db import get_db
from sca.models import ModelProvider, Secret
from sca.security.netguard import BlockedTarget, check_url
from sca.services import audit
from sca.services.providers import PROVIDER_KINDS, ProviderError, fetch_catalog, test_provider
from sca.services.secrets import put_secret, read_secret

router = APIRouter(prefix="/api/providers", tags=["providers"])


class ProviderIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    kind: Literal["experiential_labs", "openai_compatible", "openai", "anthropic"]
    base_url: str = Field(default="", max_length=500)
    default_model: str = Field(default="", max_length=200)
    embedding_model: str = Field(default="", max_length=200)
    api_key: str | None = Field(default=None, max_length=1000)


class ProviderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    base_url: str | None = Field(default=None, max_length=500)
    default_model: str | None = Field(default=None, max_length=200)
    embedding_model: str | None = Field(default=None, max_length=200)


class CredentialIn(BaseModel):
    api_key: str = Field(min_length=8, max_length=1000)


class TestIn(BaseModel):
    model: str | None = None


def _out(db: Session, pr: ModelProvider) -> dict:
    sec = db.get(Secret, pr.secret_id) if pr.secret_id else None
    return {
        "id": pr.id, "name": pr.name, "kind": pr.kind, "kind_label": PROVIDER_KINDS[pr.kind]["label"],
        "base_url": pr.base_url or PROVIDER_KINDS[pr.kind]["default_base_url"],
        "default_model": pr.default_model, "embedding_model": pr.embedding_model,
        "has_credential": sec is not None,
        "credential_fingerprint": sec.fingerprint if sec else None,
        "credential_updated_at": (sec.rotated_at or sec.created_at) if sec else None,
        "status": pr.status, "last_tested_at": pr.last_tested_at, "last_test_result": pr.last_test_result,
        "model_count": len(pr.catalog or []), "created_at": pr.created_at,
    }


def _check_base_url(kind: str, url: str) -> str:
    if not url:
        return ""
    if not PROVIDER_KINDS[kind]["base_url_editable"]:
        raise HTTPException(422, "base URL is fixed for this provider kind")
    try:
        check_url(url)
    except BlockedTarget as exc:
        raise HTTPException(422, f"base URL rejected by network policy: {exc}") from exc
    return url.rstrip("/")


@router.get("/kinds")
def kinds(p: Principal = Depends(require("providers:read"))):
    return PROVIDER_KINDS


@router.get("")
def list_providers(p: Principal = Depends(require("providers:read")), db: Session = Depends(get_db)):
    rows = db.execute(select(ModelProvider).where(ModelProvider.org_id == p.org_id).order_by(ModelProvider.created_at)).scalars()
    return [_out(db, r) for r in rows]


@router.post("", status_code=201)
def create_provider(body: ProviderIn, p: Principal = Depends(require("providers:write")), db: Session = Depends(get_db)):
    if db.execute(select(ModelProvider).where(ModelProvider.org_id == p.org_id, ModelProvider.name == body.name)).first():
        raise HTTPException(409, "a provider with this name already exists")
    base = _check_base_url(body.kind, body.base_url)
    if body.kind == "openai_compatible" and not base:
        raise HTTPException(422, "base URL is required for OpenAI-compatible providers")
    pr = ModelProvider(org_id=p.org_id, name=body.name, kind=body.kind, base_url=base,
                       default_model=body.default_model, embedding_model=body.embedding_model)
    db.add(pr)
    db.flush()
    if body.api_key:
        pr.secret_id = put_secret(db, p.org_id, f"provider:{pr.id}", "provider", body.api_key, p.user_id).id
    audit.record(db, p.org_id, "provider.created", actor_id=p.user_id, target_type="provider", target_id=pr.id,
                 details={"name": pr.name, "kind": pr.kind, "credential_set": bool(body.api_key)})
    db.commit()
    return _out(db, pr)


@router.put("/{provider_id}")
def update_provider(provider_id: str, body: ProviderUpdate, p: Principal = Depends(require("providers:write")),
                    db: Session = Depends(get_db)):
    pr = scoped(db, ModelProvider, provider_id, p, "provider")
    if body.name is not None:
        pr.name = body.name
    if body.base_url is not None:
        pr.base_url = _check_base_url(pr.kind, body.base_url)
    if body.default_model is not None:
        pr.default_model = body.default_model
    if body.embedding_model is not None:
        pr.embedding_model = body.embedding_model
    pr.status = "untested"
    audit.record(db, p.org_id, "provider.updated", actor_id=p.user_id, target_type="provider", target_id=pr.id,
                 details=body.model_dump(exclude_none=True))
    db.commit()
    return _out(db, pr)


@router.post("/{provider_id}/credential")
def set_credential(provider_id: str, body: CredentialIn, p: Principal = Depends(require("providers:write")),
                   db: Session = Depends(get_db)):
    pr = scoped(db, ModelProvider, provider_id, p, "provider")
    sec = put_secret(db, p.org_id, f"provider:{pr.id}", "provider", body.api_key, p.user_id)
    pr.secret_id = sec.id
    pr.status = "untested"
    audit.record(db, p.org_id, "provider.credential_updated", actor_id=p.user_id, target_type="provider",
                 target_id=pr.id, details={"fingerprint": sec.fingerprint})
    db.commit()
    return _out(db, pr)


@router.post("/{provider_id}/test")
def test(provider_id: str, body: TestIn, p: Principal = Depends(require("providers:test")), db: Session = Depends(get_db)):
    pr = scoped(db, ModelProvider, provider_id, p, "provider")
    result = test_provider(db, pr, body.model)
    audit.record(db, p.org_id, "provider.tested", actor_id=p.user_id, target_type="provider", target_id=pr.id,
                 details={"ok": result.get("ok"), "error": result.get("error"), "model": result.get("model")})
    db.commit()
    return {"provider": _out(db, pr), "result": result}


@router.get("/{provider_id}/models")
def models(provider_id: str, refresh: bool = False, tools_only: bool = True,
           p: Principal = Depends(require("providers:read")), db: Session = Depends(get_db)):
    pr = scoped(db, ModelProvider, provider_id, p, "provider")
    if refresh or not pr.catalog:
        key = read_secret(db, pr.secret_id, p.org_id)
        if not key:
            raise HTTPException(422, "provider has no credential")
        try:
            pr.catalog = fetch_catalog(pr, key)
        except ProviderError as exc:
            raise HTTPException(502, f"{exc.code}: {exc.message}") from exc
        db.commit()
    items = [m for m in (pr.catalog or []) if not tools_only or m.get("supports_tools")]
    return {"models": items, "pricing_note": "Published provider rates; costs shown in the platform are estimates."}
