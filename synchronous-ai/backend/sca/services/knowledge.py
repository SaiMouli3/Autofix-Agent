"""Company knowledge: ingestion, chunking, indexing and hybrid retrieval.

Retrieval combines BM25 lexical scoring (always available) with cosine similarity
over provider embeddings (when the organization's provider has an embedding model).
Documents are only reported as ``indexed`` after chunks are committed.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from sca.config import get_settings
from sca.db import session_scope
from sca.models import Document, DocumentChunk, IngestionJob, KnowledgeSource, ModelProvider, utcnow
from sca.services.providers import ProviderError, embed_texts

log = logging.getLogger("sca.knowledge")

SUPPORTED_EXTENSIONS = {".txt", ".md", ".markdown", ".csv", ".json", ".html", ".htm", ".pdf", ".docx", ".xlsx", ".yaml", ".yml", ".log"}
CHUNK_CHARS = 1400
CHUNK_OVERLAP = 200

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ingest")


# --------------------------------------------------------------------------- extraction


def extract_text(path: Path, filename: str) -> str:
    ext = Path(filename).suffix.lower()
    raw = path.read_bytes()
    if ext == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw))
        pages = []
        for i, page in enumerate(reader.pages):
            txt = page.extract_text() or ""
            if txt.strip():
                pages.append(f"[page {i + 1}]\n{txt}")
        return "\n\n".join(pages)
    if ext == ".docx":
        import docx

        d = docx.Document(io.BytesIO(raw))
        parts = [p.text for p in d.paragraphs if p.text.strip()]
        for table in d.tables:
            for row in table.rows:
                parts.append(" | ".join(c.text.strip() for c in row.cells))
        return "\n".join(parts)
    if ext == ".xlsx":
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        parts = []
        for ws in wb.worksheets:
            rows = []
            for row in ws.iter_rows(values_only=True):
                if any(c is not None and str(c).strip() for c in row):
                    rows.append(" | ".join("" if c is None else str(c) for c in row))
                if len(rows) >= 5000:
                    rows.append("… (more rows not shown)")
                    break
            if rows:
                parts.append(f"[sheet {ws.title}]\n" + "\n".join(rows))
        wb.close()
        return "\n\n".join(parts)
    text = raw.decode("utf-8", errors="replace")
    if ext in (".html", ".htm"):
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(text, "html.parser")
        for t in soup(["script", "style", "noscript"]):
            t.decompose()
        return soup.get_text("\n")
    if ext == ".json":
        try:
            return json.dumps(json.loads(text), indent=2)[:2_000_000]
        except json.JSONDecodeError:
            return text
    return text


def chunk_text(text: str) -> list[str]:
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        return []
    paras = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    cur = ""
    for p in paras:
        while len(p) > CHUNK_CHARS:  # hard-split very long paragraphs
            head, p = p[:CHUNK_CHARS], p[CHUNK_CHARS - CHUNK_OVERLAP :]
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.append(head)
        if len(cur) + len(p) + 2 <= CHUNK_CHARS:
            cur = f"{cur}\n\n{p}" if cur else p
        else:
            if cur:
                chunks.append(cur)
            tail = cur[-CHUNK_OVERLAP:] if cur else ""
            cur = f"{tail}\n\n{p}" if tail else p
    if cur:
        chunks.append(cur)
    return chunks


# --------------------------------------------------------------------------- ingestion


def store_upload(org_id: str, source_id: str, filename: str, data: bytes) -> tuple[Path, str]:
    s = get_settings()
    digest = hashlib.sha256(data).hexdigest()
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename).name)[:120] or "file"
    target_dir = s.uploads_dir / org_id / source_id
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / f"{digest[:16]}_{safe}"
    path.write_bytes(data)
    return path, digest


def _embedding_provider(db: Session, org_id: str) -> ModelProvider | None:
    return db.execute(
        select(ModelProvider)
        .where(ModelProvider.org_id == org_id, ModelProvider.embedding_model != "")
        .order_by(ModelProvider.created_at)
    ).scalars().first()


def ingest_document(document_id: str, job_id: str) -> None:
    with session_scope() as db:
        doc = db.get(Document, document_id)
        job = db.get(IngestionJob, job_id)
        if doc is None or job is None:
            return
        doc.status = "processing"
        job.status = "running"
        job.started_at = utcnow()
    try:
        with session_scope() as db:
            doc = db.get(Document, document_id)
            text = extract_text(Path(doc.storage_path), doc.filename)
            chunks = chunk_text(text)
            if not chunks:
                raise ValueError("no extractable text found (scanned PDFs need OCR before upload)")
            vectors: list[list[float]] | None = None
            embed_note = "lexical index only (no embedding model configured)"
            provider = _embedding_provider(db, doc.org_id)
            if provider is not None:
                try:
                    vectors = embed_texts(db, provider, chunks)
                    embed_note = f"embedded with {provider.embedding_model}"
                except ProviderError as exc:
                    embed_note = f"embedding failed ({exc.code}); lexical index only"
                    log.warning("embedding failed for %s: %s", document_id, exc.message)
            db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))
            for i, c in enumerate(chunks):
                emb = None
                if vectors is not None:
                    emb = np.asarray(vectors[i], dtype="<f4").tobytes()
                db.add(DocumentChunk(org_id=doc.org_id, source_id=doc.source_id, document_id=doc.id,
                                     ordinal=i, text=c, embedding=emb))
            doc.chunk_count = len(chunks)
            doc.embedded = vectors is not None
            doc.status = "indexed"
            doc.error = ""
            doc.indexed_at = utcnow()
            job = db.get(IngestionJob, job_id)
            job.status = "succeeded"
            job.detail = f"{len(chunks)} chunks; {embed_note}"
            job.finished_at = utcnow()
    except Exception as exc:  # noqa: BLE001
        log.exception("ingestion failed for %s", document_id)
        with session_scope() as db:
            doc = db.get(Document, document_id)
            job = db.get(IngestionJob, job_id)
            if doc:
                doc.status = "failed"
                doc.error = str(exc)[:1000]
            if job:
                job.status = "failed"
                job.detail = str(exc)[:1000]
                job.finished_at = utcnow()


def submit_ingestion(document_id: str, job_id: str, *, sync: bool = False) -> None:
    if sync:
        ingest_document(document_id, job_id)
    else:
        _executor.submit(ingest_document, document_id, job_id)


# --------------------------------------------------------------------------- retrieval

_TOKEN = re.compile(r"[A-Za-z0-9]+")


def _tokens(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text) if len(t) > 1]


def search(db: Session, org_id: str, source_ids: list[str], query: str, top_k: int = 5) -> list[dict[str, Any]]:
    if not source_ids or not query.strip():
        return []
    rows = db.execute(
        select(DocumentChunk, Document.filename, KnowledgeSource.name)
        .join(Document, Document.id == DocumentChunk.document_id)
        .join(KnowledgeSource, KnowledgeSource.id == DocumentChunk.source_id)
        .where(DocumentChunk.org_id == org_id, DocumentChunk.source_id.in_(source_ids), Document.status == "indexed")
    ).all()
    if not rows:
        return []

    # BM25
    q_terms = _tokens(query)
    docs_tokens = [_tokens(r[0].text) for r in rows]
    n = len(rows)
    avgdl = sum(len(t) for t in docs_tokens) / max(n, 1)
    df: Counter[str] = Counter()
    for toks in docs_tokens:
        df.update(set(toks))
    k1, b = 1.5, 0.75
    bm25 = []
    for toks in docs_tokens:
        tf = Counter(toks)
        score = 0.0
        for term in q_terms:
            if term not in tf:
                continue
            idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
            score += idf * tf[term] * (k1 + 1) / (tf[term] + k1 * (1 - b + b * len(toks) / max(avgdl, 1)))
        bm25.append(score)
    max_bm = max(bm25) or 1.0
    lexical = [s / max_bm for s in bm25]

    # Dense (if all candidate chunks carry embeddings from the same model)
    dense = [0.0] * n
    use_dense = all(r[0].embedding for r in rows)
    if use_dense:
        provider = _embedding_provider(db, org_id)
        try:
            if provider is None:
                raise ProviderError("embeddings_unavailable", "")
            qv = np.asarray(embed_texts(db, provider, [query])[0], dtype="<f4")
            mat = np.stack([np.frombuffer(r[0].embedding, dtype="<f4") for r in rows])
            if mat.shape[1] == qv.shape[0]:
                sims = mat @ qv / (np.linalg.norm(mat, axis=1) * np.linalg.norm(qv) + 1e-9)
                dense = [float(max(s, 0.0)) for s in sims]
            else:
                use_dense = False
        except ProviderError:
            use_dense = False

    scored = []
    for i, (chunk, filename, source_name) in enumerate(rows):
        score = 0.6 * dense[i] + 0.4 * lexical[i] if use_dense else lexical[i]
        if score > 0:
            scored.append((score, chunk, filename, source_name))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [
        {
            "score": round(s, 4),
            "chunk_id": c.id,
            "document_id": c.document_id,
            "document": fn,
            "source": sn,
            "ordinal": c.ordinal,
            "text": c.text,
            "retrieval": "hybrid" if use_dense else "lexical",
        }
        for s, c, fn, sn in scored[:top_k]
    ]
