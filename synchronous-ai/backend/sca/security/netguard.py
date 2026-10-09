"""Outbound request guard (SSRF protection) for integrations and MCP servers.

Resolves the target host and rejects loopback, link-local (incl. cloud metadata
169.254.169.254), private, multicast, reserved and unspecified addresses unless the
host is explicitly allow-listed by an administrator (``SCA_ALLOWED_PRIVATE_HOSTS``).
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from sca.config import get_settings

METADATA_HOSTS = {"metadata.google.internal", "metadata", "instance-data", "169.254.169.254", "fd00:ec2::254"}


class BlockedTarget(ValueError):
    pass


def _is_forbidden_ip(ip: ipaddress._BaseAddress) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or (isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None and _is_forbidden_ip(ip.ipv4_mapped))
    )


def check_url(url: str, *, allow_http: bool | None = None) -> str:
    """Validate an outbound URL. Returns the normalized URL or raises BlockedTarget."""
    s = get_settings()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise BlockedTarget("only http(s) URLs are allowed")
    if parsed.username or parsed.password:
        raise BlockedTarget("credentials must not be embedded in URLs; use a secret reference")
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        raise BlockedTarget("URL has no host")
    if host in METADATA_HOSTS:
        raise BlockedTarget("cloud metadata endpoints are always blocked")
    if allow_http is None:
        allow_http = not s.is_production
    if parsed.scheme == "http" and not allow_http and host not in s.allowed_private_hosts:
        raise BlockedTarget("plain HTTP is not allowed in production; use HTTPS")

    allow_private = s.allow_private_network_targets or host in s.allowed_private_hosts
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise BlockedTarget(f"host could not be resolved: {host}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if str(ip) == "169.254.169.254" or (isinstance(ip, ipaddress.IPv6Address) and str(ip) == "fd00:ec2::254"):
            raise BlockedTarget("cloud metadata endpoints are always blocked")
        if _is_forbidden_ip(ip) and not allow_private:
            raise BlockedTarget(
                f"{host} resolves to a non-public address ({ip}); an administrator must allow-list it "
                "via SCA_ALLOWED_PRIVATE_HOSTS"
            )
    return url
