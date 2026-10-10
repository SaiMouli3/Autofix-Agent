"""Files users attach to a task: documents (text is extracted for the agent) and images (shown to
vision-capable models). Uploaded first, then linked to the task when it is submitted.

Stored under ``<data_dir>/uploads/attachments/<org>/<attachment id>/`` as ``original`` plus, for
documents, ``text.txt``. File contents are checked against the extension (magic bytes), names are
never used as paths, and everything is scoped to the organization.
"""

from __future__ import annotations

import hashlib
import re
import shutil
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from sca.config import get_settings
from sca.models import Attachment, Task
from sca.services import knowledge

IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
DOC_TYPES = {
    ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".csv": "text/csv",
    ".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown", ".json": "application/json",
    ".html": "text/html", ".htm": "text/html", ".yaml": "text/yaml", ".yml": "text/yaml", ".log": "text/plain",
    ".xml": "application/xml",
}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_PER_TASK = 10
TEXT_LIMIT = 400_000  # characters kept from one document


class AttachmentError(Exception):
    pass


def _root() -> Path:
    return (get_settings().data_dir / "uploads" / "attachments").resolve()


def folder(att: Attachment) -> Path:
    p = (_root() / att.org_id / att.id).resolve()
    if not str(p).startswith(str(_root())):
        raise AttachmentError("invalid attachment path")
    return p


def safe_name(filename: str) -> str:
    name = Path(filename or "file").name.strip().replace("\x00", "")
    name = re.sub(r"[^\w.\- ()]+", "_", name)[:120].strip(" .") or "file"
    return name


def _looks_like(ext: str, head: bytes) -> bool:
    if ext == ".png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if ext in (".jpg", ".jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if ext == ".gif":
        return head[:6] in (b"GIF87a", b"GIF89a")
    if ext == ".webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if ext == ".pdf":
        return head.lstrip()[:5] == b"%PDF-"
    if ext in (".docx", ".xlsx"):
        return head.startswith(b"PK\x03\x04")
    # Text formats: reject binary content.
    return b"\x00" not in head


def save(db: Session, org_id: str, user_id: str, filename: str, data: bytes) -> Attachment:
    name = safe_name(filename)
    ext = Path(name).suffix.lower()
    if ext in IMAGE_TYPES:
        kind, mime, limit = "image", IMAGE_TYPES[ext], MAX_IMAGE_BYTES
    elif ext in DOC_TYPES:
        kind, mime, limit = "document", DOC_TYPES[ext], get_settings().max_upload_bytes
    else:
        raise AttachmentError(f"'{ext or name}' files are not supported. Attach images (PNG, JPG, WebP, GIF) or documents "
                              "(PDF, Word, Excel, CSV, text, Markdown, JSON, HTML, YAML, XML).")
    if not data:
        raise AttachmentError("the file is empty")
    if len(data) > limit:
        raise AttachmentError(f"'{name}' is larger than {limit // (1024 * 1024)} MB")
    if not _looks_like(ext, data[:64]):
        raise AttachmentError(f"'{name}' does not look like a {ext[1:].upper()} file")
    att = Attachment(org_id=org_id, uploaded_by=user_id, filename=name, kind=kind, mime=mime, size=len(data),
                     sha256=hashlib.sha256(data).hexdigest())
    db.add(att)
    db.flush()
    d = folder(att)
    d.mkdir(parents=True, exist_ok=True)
    (d / "original").write_bytes(data)
    if kind == "document":
        try:
            text = knowledge.extract_text(d / "original", name)
        except Exception as exc:  # noqa: BLE001 - malformed files are reported, not fatal
            shutil.rmtree(d, ignore_errors=True)
            raise AttachmentError(f"could not read '{name}': {type(exc).__name__}") from exc
        text = (text or "").strip()[:TEXT_LIMIT]
        (d / "text.txt").write_text(text, encoding="utf-8")
        att.text_chars = len(text)
    return att


def link(db: Session, org_id: str, user_id: str, ids: list[str], task: Task) -> list[Attachment]:
    if len(ids) > MAX_PER_TASK:
        raise AttachmentError(f"at most {MAX_PER_TASK} attachments per task")
    out = []
    for aid in dict.fromkeys(ids):
        att = db.get(Attachment, aid)
        if att is None or att.org_id != org_id or att.uploaded_by != user_id:
            raise AttachmentError("attachment not found")
        if att.task_id is not None:
            raise AttachmentError(f"'{att.filename}' is already attached to another task")
        att.task_id = task.id
        out.append(att)
    return out


def for_task(db: Session, task_id: str) -> list[Attachment]:
    return list(db.execute(select(Attachment).where(Attachment.task_id == task_id)
                           .order_by(Attachment.created_at)).scalars())


def public(att: Attachment) -> dict:
    return {"id": att.id, "filename": att.filename, "kind": att.kind, "mime": att.mime, "size": att.size,
            "text_chars": att.text_chars, "created_at": att.created_at}


def read_text(att: Attachment) -> str:
    p = folder(att) / "text.txt"
    return p.read_text(encoding="utf-8") if p.exists() else ""


def remove_files(atts: list[Attachment]) -> None:
    for att in atts:
        shutil.rmtree(folder(att), ignore_errors=True)
