"""Encrypted secret storage."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from sca.models import Secret, utcnow
from sca.security import crypto
from sca.security.redaction import register_secret


def put_secret(db: Session, org_id: str, name: str, kind: str, value: str, user_id: str | None) -> Secret:
    value = value.strip()
    if not value:
        raise ValueError("secret value is empty")
    sec = db.execute(select(Secret).where(Secret.org_id == org_id, Secret.name == name)).scalar_one_or_none()
    if sec is None:
        sec = Secret(org_id=org_id, name=name, kind=kind, created_by=user_id,
                     ciphertext=crypto.encrypt(value), fingerprint=crypto.fingerprint(value))
        db.add(sec)
    else:
        sec.ciphertext = crypto.encrypt(value)
        sec.fingerprint = crypto.fingerprint(value)
        sec.rotated_at = utcnow()
    db.flush()
    register_secret(value)
    return sec


def read_secret(db: Session, secret_id: str | None, org_id: str) -> str | None:
    if not secret_id:
        return None
    sec = db.get(Secret, secret_id)
    if sec is None or sec.org_id != org_id:
        return None
    value = crypto.decrypt(sec.ciphertext)
    register_secret(value)
    return value
