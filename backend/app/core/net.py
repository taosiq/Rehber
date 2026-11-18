"""The visitor's real IP address, for rate limits and session records.

In production Rehber sits behind proxies on the same machine (Tailscale Funnel -> Next.js ->
API), so the direct peer is always 127.0.0.1. Proxies record the original address in
X-Forwarded-For, but a client can also send that header itself, so it is only trusted when the
request really came from a local/private proxy, and then the address is read from the RIGHT:
the right-most entry that isn't one of our own proxies is the first one a proxy we trust added.
Anything further left could have been written by the client and is ignored.
"""

import ipaddress

from starlette.requests import Request

from app.core.config import get_settings


# Where our own proxies live: this machine, home/office/Docker networks and Tailscale's range.
INTERNAL = [ipaddress.ip_network(n) for n in (
    "127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10",
    "169.254.0.0/16", "fc00::/7", "fe80::/10",
)]


def _is_internal(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    return any(ip in net for net in INTERNAL if net.version == ip.version)


def client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    if not get_settings().trust_proxy or not _is_internal(peer):
        return peer
    chain = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    for hop in reversed(chain):
        if not _is_internal(hop):
            return hop
    return chain[0] if chain else peer
