"""Task attachments: upload before submitting a task, download afterwards."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from sca.api.deps import Principal, require
from sca.config import get_settings
from sca.db import get_db
from sca.models import Attachment
from sca.services import attachments, audit

router = APIRouter(prefix="/api/attachments", tags=["attachments"])


@router.post("", status_code=201)
async def upload(file: UploadFile = File(...), p: Principal = Depends(require("tasks:create")),
                 db: Session = Depends(get_db)):
    limit = max(get_settings().max_upload_bytes, attachments.MAX_IMAGE_BYTES)
    data = await file.read(limit + 1)
    try:
        att = attachments.save(db, p.org_id, p.user_id, file.filename or "file", data)
    except attachments.AttachmentError as exc:
        raise HTTPException(422, str(exc)) from exc
    audit.record(db, p.org_id, "attachment.uploaded", actor_id=p.user_id, target_type="attachment", target_id=att.id,
                 details={"filename": att.filename, "kind": att.kind, "size": att.size})
    db.commit()
    return attachments.public(att)


def _get(db: Session, p: Principal, attachment_id: str) -> Attachment:
    att = db.get(Attachment, attachment_id)
    if att is None or att.org_id != p.org_id:
        raise HTTPException(404, "attachment not found")
    if att.task_id is None and att.uploaded_by != p.user_id:  # not yet sent: only its uploader sees it
        raise HTTPException(404, "attachment not found")
    return att


@router.get("/{attachment_id}")
def download(attachment_id: str, inline: bool = False, p: Principal = Depends(require("tasks:read")),
             db: Session = Depends(get_db)):
    att = _get(db, p, attachment_id)
    path = attachments.folder(att) / "original"
    if not path.exists():
        raise HTTPException(404, "file missing")
    show_inline = inline and att.kind == "image"
    return FileResponse(path, media_type=att.mime, filename=att.filename,
                        content_disposition_type="inline" if show_inline else "attachment",
                        headers={"Content-Security-Policy": "sandbox; default-src 'none'",
                                 "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"})


@router.delete("/{attachment_id}")
def remove(attachment_id: str, p: Principal = Depends(require("tasks:create")), db: Session = Depends(get_db)):
    att = _get(db, p, attachment_id)
    if att.task_id is not None or att.uploaded_by != p.user_id:
        raise HTTPException(409, "attachments of a submitted task cannot be removed")
    attachments.remove_files([att])
    db.delete(att)
    db.commit()
    return {"deleted": True}
