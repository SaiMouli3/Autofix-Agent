"""Company knowledge sources, document upload/ingestion, retrieval preview."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from sca.api.deps import Principal, require, scoped
from sca.config import get_settings
from sca.db import get_db
from sca.models import Agent, AgentVersion, Document, DocumentChunk, IngestionJob, KnowledgeSource
from sca.services import audit, knowledge

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


class SourceIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=2000)
    category: str = Field(default="Documents", max_length=60)
    department: str = Field(default="", max_length=80)


class SearchIn(BaseModel):
    query: str = Field(min_length=2, max_length=1000)
    source_ids: list[str]
    top_k: int = Field(default=5, ge=1, le=20)


class TextDocIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=2_000_000)


def _source_out(db: Session, s: KnowledgeSource) -> dict:
    docs = dict(db.execute(select(Document.status, func.count()).where(Document.source_id == s.id)
                           .group_by(Document.status)).all())
    chunks = db.execute(select(func.count()).select_from(DocumentChunk).where(DocumentChunk.source_id == s.id)).scalar_one()
    agents = []
    for a in db.execute(select(Agent).where(Agent.org_id == s.org_id)).scalars():
        cfg = db.execute(select(AgentVersion.config).where(AgentVersion.agent_id == a.id,
                                                           AgentVersion.version == a.current_version)).scalar_one()
        if s.id in (cfg.get("knowledge_sources") or []):
            agents.append({"id": a.id, "name": a.name})
    return {"id": s.id, "name": s.name, "description": s.description, "category": s.category,
            "department": s.department, "created_at": s.created_at, "documents": docs,
            "document_count": sum(docs.values()), "chunk_count": chunks, "agents": agents}


def _doc_out(d: Document) -> dict:
    return {"id": d.id, "source_id": d.source_id, "filename": d.filename, "mime": d.mime, "size": d.size,
            "sha256": d.sha256, "status": d.status, "error": d.error, "chunk_count": d.chunk_count,
            "embedded": d.embedded, "created_at": d.created_at, "indexed_at": d.indexed_at}


@router.get("/sources")
def list_sources(p: Principal = Depends(require("knowledge:read")), db: Session = Depends(get_db)):
    rows = db.execute(select(KnowledgeSource).where(KnowledgeSource.org_id == p.org_id).order_by(KnowledgeSource.name)).scalars()
    return [_source_out(db, s) for s in rows]


@router.post("/sources", status_code=201)
def create_source(body: SourceIn, p: Principal = Depends(require("knowledge:write")), db: Session = Depends(get_db)):
    if db.execute(select(KnowledgeSource).where(KnowledgeSource.org_id == p.org_id, KnowledgeSource.name == body.name)).first():
        raise HTTPException(409, "a source with this name already exists")
    s = KnowledgeSource(org_id=p.org_id, created_by=p.user_id, **body.model_dump())
    db.add(s)
    db.flush()
    audit.record(db, p.org_id, "knowledge.source_created", actor_id=p.user_id, target_type="knowledge_source",
                 target_id=s.id, details={"name": s.name})
    db.commit()
    return _source_out(db, s)


@router.delete("/sources/{source_id}")
def delete_source(source_id: str, p: Principal = Depends(require("knowledge:write")), db: Session = Depends(get_db)):
    s = scoped(db, KnowledgeSource, source_id, p, "knowledge source")
    for d in db.execute(select(Document).where(Document.source_id == s.id)).scalars():
        Path(d.storage_path).unlink(missing_ok=True)
    db.delete(s)
    audit.record(db, p.org_id, "knowledge.source_deleted", actor_id=p.user_id, target_type="knowledge_source",
                 target_id=source_id)
    db.commit()
    return {"ok": True}


@router.get("/sources/{source_id}/documents")
def list_documents(source_id: str, p: Principal = Depends(require("knowledge:read")), db: Session = Depends(get_db)):
    scoped(db, KnowledgeSource, source_id, p, "knowledge source")
    rows = db.execute(select(Document).where(Document.source_id == source_id).order_by(Document.created_at.desc())).scalars()
    return [_doc_out(d) for d in rows]


def _register(db: Session, p: Principal, s: KnowledgeSource, filename: str, data: bytes, mime: str) -> Document:
    path, digest = knowledge.store_upload(p.org_id, s.id, filename, data)
    doc = Document(org_id=p.org_id, source_id=s.id, filename=Path(filename).name[:300], mime=mime, size=len(data),
                   sha256=digest, storage_path=str(path), uploaded_by=p.user_id)
    db.add(doc)
    db.flush()
    job = IngestionJob(org_id=p.org_id, document_id=doc.id)
    db.add(job)
    audit.record(db, p.org_id, "knowledge.document_uploaded", actor_id=p.user_id, target_type="document",
                 target_id=doc.id, details={"filename": doc.filename, "size": doc.size, "sha256": digest})
    db.commit()
    knowledge.submit_ingestion(doc.id, job.id)
    return doc


@router.post("/sources/{source_id}/documents", status_code=202)
async def upload(source_id: str, file: UploadFile = File(...), p: Principal = Depends(require("knowledge:write")),
                 db: Session = Depends(get_db)):
    s = scoped(db, KnowledgeSource, source_id, p, "knowledge source")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in knowledge.SUPPORTED_EXTENSIONS:
        raise HTTPException(415, f"unsupported file type {ext or '(none)'}; supported: "
                                 f"{', '.join(sorted(knowledge.SUPPORTED_EXTENSIONS))}")
    limit = get_settings().max_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"file exceeds {limit // (1024 * 1024)} MB")
    if not data:
        raise HTTPException(422, "file is empty")
    doc = _register(db, p, s, file.filename or "upload", data, file.content_type or "application/octet-stream")
    return _doc_out(doc)


@router.post("/sources/{source_id}/text", status_code=202)
def add_text(source_id: str, body: TextDocIn, p: Principal = Depends(require("knowledge:write")),
             db: Session = Depends(get_db)):
    s = scoped(db, KnowledgeSource, source_id, p, "knowledge source")
    name = body.title if body.title.lower().endswith((".md", ".txt")) else f"{body.title}.md"
    doc = _register(db, p, s, name, body.content.encode(), "text/markdown")
    return _doc_out(doc)


@router.delete("/documents/{document_id}")
def delete_document(document_id: str, p: Principal = Depends(require("knowledge:write")), db: Session = Depends(get_db)):
    d = scoped(db, Document, document_id, p, "document")
    Path(d.storage_path).unlink(missing_ok=True)
    db.delete(d)
    audit.record(db, p.org_id, "knowledge.document_deleted", actor_id=p.user_id, target_type="document",
                 target_id=document_id, details={"filename": d.filename})
    db.commit()
    return {"ok": True}


@router.post("/documents/{document_id}/reindex", status_code=202)
def reindex(document_id: str, p: Principal = Depends(require("knowledge:write")), db: Session = Depends(get_db)):
    d = scoped(db, Document, document_id, p, "document")
    job = IngestionJob(org_id=p.org_id, document_id=d.id)
    db.add(job)
    d.status = "pending"
    db.commit()
    knowledge.submit_ingestion(d.id, job.id)
    return _doc_out(d)


@router.get("/jobs")
def jobs(p: Principal = Depends(require("knowledge:read")), db: Session = Depends(get_db)):
    rows = db.execute(select(IngestionJob, Document.filename).join(Document, Document.id == IngestionJob.document_id)
                      .where(IngestionJob.org_id == p.org_id).order_by(IngestionJob.created_at.desc()).limit(100)).all()
    return [{"id": j.id, "document_id": j.document_id, "filename": fn, "status": j.status, "detail": j.detail,
             "started_at": j.started_at, "finished_at": j.finished_at, "created_at": j.created_at} for j, fn in rows]


@router.post("/search")
def search(body: SearchIn, p: Principal = Depends(require("knowledge:read")), db: Session = Depends(get_db)):
    for sid in body.source_ids:
        scoped(db, KnowledgeSource, sid, p, "knowledge source")
    return knowledge.search(db, p.org_id, body.source_ids, body.query, body.top_k)
