"""SSRF protection — block requests to private IPs and cloud metadata endpoints."""

from __future__ import annotations

import ipaddress
import socket
from typing import Optional

# Cloud metadata endpoints to block
_BLOCKED_HOSTS = frozenset(
    {
        "169.254.169.254",  # AWS/GCP/Azure metadata
        "metadata.google.internal",
        "metadata.google.com",
        "100.100.100.200",  # Alibaba Cloud metadata
    }
)

_BLOCKED_CIDR = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),  # unique local
    ipaddress.ip_network("fe80::/10"),  # link-local v6
]


def is_private_ip(ip_str: str) -> bool:
    """Check if an IP address is private/reserved."""
    try:
        addr = ipaddress.ip_address(ip_str)
        return (
            any(addr in net for net in _BLOCKED_CIDR)
            or addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_multicast
            or addr.is_reserved
            or addr.is_unspecified
        )
    except ValueError:
        return False


def check_ssrf(url: str) -> Optional[str]:
    """Check a URL with Rust when installed and a fail-safe Python fallback."""
    try:
        from qlix.luna._rust_bridge import get_rust_module

        return get_rust_module().check_ssrf(url)
    except (ImportError, AttributeError):
        return _check_ssrf_python(url)


def _check_ssrf_python(url: str) -> Optional[str]:
    """Legacy Python SSRF check — kept for reference only."""
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme.lower() not in {"http", "https"}:
        return "Only http:// and https:// URLs are allowed"
    if parsed.username is not None or parsed.password is not None:
        return "Credentials in URLs are not allowed"
    hostname = parsed.hostname
    if not hostname:
        return "No hostname in URL"

    # Check blocked hosts
    hostname = hostname.lower().rstrip(".")
    if hostname in _BLOCKED_HOSTS or hostname == "localhost" or hostname.endswith(".localhost"):
        return f"Blocked host: {hostname} (cloud metadata endpoint)"

    # DNS resolution check
    try:
        resolved = socket.getaddrinfo(
            hostname,
            None,
            socket.AF_UNSPEC,
            socket.SOCK_STREAM,
        )
        for family, stype, proto, canonname, sockaddr in resolved:
            ip = sockaddr[0]
            if is_private_ip(ip):
                return f"URL resolves to private IP: {ip}"
    except socket.gaierror:
        pass  # DNS resolution failed — allow (will fail at request time)

    return None  # Safe


__all__ = ["check_ssrf", "is_private_ip"]
