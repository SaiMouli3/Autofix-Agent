"""Symmetric encryption for stored credentials (Fernet / AES-128-CBC + HMAC-SHA256).

``SCA_SECRET_KEY`` may contain several comma-separated keys to support rotation:
the first key encrypts, all keys decrypt. In development, a key is generated into
``<data_dir>/secret.key`` (mode 0600) if none is configured.
"""

from __future__ import annotations

import hashlib
import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from sca.config import get_settings


@lru_cache
def _fernet() -> MultiFernet:
    s = get_settings()
    raw = s.secret_key
    if not raw:
        key_file = s.data_dir / "secret.key"
        if not key_file.exists():
            key = Fernet.generate_key()
            fd = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as fh:
                fh.write(key)
        raw = key_file.read_text().strip()
    keys = [Fernet(k.strip().encode()) for k in raw.split(",") if k.strip()]
    return MultiFernet(keys)


def encrypt(plaintext: str) -> bytes:
    return _fernet().encrypt(plaintext.encode("utf-8"))


def decrypt(ciphertext: bytes) -> str:
    try:
        return _fernet().decrypt(ciphertext).decode("utf-8")
    except InvalidToken as exc:  # wrong key or tampered value
        raise ValueError("secret could not be decrypted with the configured key") from exc


def fingerprint(plaintext: str) -> str:
    """Short non-reversible identifier, safe to show in the UI."""
    return hashlib.sha256(plaintext.encode()).hexdigest()[:12]


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()
