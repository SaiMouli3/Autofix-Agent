"""Secret redaction for logs, events, audit records and API responses."""

from __future__ import annotations

import re
import threading
from typing import Any

REDACTED = "[REDACTED]"

_PATTERNS = [
    re.compile(r"\b(xpl|sk|pk|rk)[-_][A-Za-z0-9_\-]{12,}\b"),  # provider-style keys
    re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{10,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),  # JWT
    re.compile(r"(?i)(authorization\s*[:=]\s*)(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}"),
    re.compile(r"(?i)\b(api[_-]?key|secret|password|passwd|token)(\"?\s*[:=]\s*\"?)([^\s\"',;]{6,})"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----"),
]

_SENSITIVE_KEYS = re.compile(r"(?i)(api[_-]?key|secret|password|token|authorization|cookie|credential)")

# Known secret values registered at runtime (decrypted credentials currently in use).
_known: set[str] = set()
_lock = threading.Lock()


def register_secret(value: str | None) -> None:
    if value and len(value) >= 6:
        with _lock:
            _known.add(value)


def redact_text(text: str) -> str:
    if not text:
        return text
    with _lock:
        known = sorted(_known, key=len, reverse=True)
    for value in known:
        if value in text:
            text = text.replace(value, REDACTED)
    for pat in _PATTERNS:
        if pat.groups >= 3:
            text = pat.sub(lambda m: f"{m.group(1)}{m.group(2)}{REDACTED}", text)
        elif pat.groups == 2:
            text = pat.sub(lambda m: f"{m.group(1)}{REDACTED}", text)
        else:
            text = pat.sub(REDACTED, text)
    return text


def redact(obj: Any, _depth: int = 0) -> Any:
    """Recursively redact strings and values under sensitive keys."""
    if _depth > 12:
        return obj
    if isinstance(obj, str):
        return redact_text(obj)
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if isinstance(k, str) and _SENSITIVE_KEYS.search(k) and isinstance(v, (str, int)) and v not in ("", None):
                if k.lower().endswith(("_id", "_ref", "secret_name", "fingerprint")) or k.lower() in ("has_secret", "token_count"):
                    out[k] = v
                else:
                    out[k] = REDACTED
            else:
                out[k] = redact(v, _depth + 1)
        return out
    if isinstance(obj, (list, tuple)):
        return [redact(v, _depth + 1) for v in obj]
    return obj
