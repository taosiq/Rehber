"""Fixed-window rate limiting in Redis.

Fails CLOSED: if Redis is unreachable, limited endpoints refuse requests rather
than silently allowing unlimited login attempts or AI usage.
"""

import logging

import redis.asyncio as redis
from fastapi import HTTPException

from app.core.config import get_settings

log = logging.getLogger(__name__)
_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(get_settings().redis_url, socket_timeout=2, socket_connect_timeout=2)
    return _client


def reset_redis_client() -> None:
    """Drop the cached client (tests run each case in a fresh event loop)."""
    global _client
    _client = None


async def hit(key: str, limit: int, window_s: int) -> tuple[bool, int]:
    """Count one attempt. Returns (allowed, seconds_until_reset).

    The window starts at the first attempt (not on clock boundaries), so nobody can send twice the
    limit by straddling a minute boundary.
    """
    full_key = f"rl:{key}"
    r = get_redis()
    async with r.pipeline(transaction=True) as pipe:
        pipe.set(full_key, 0, ex=window_s, nx=True)
        pipe.incr(full_key)
        pipe.ttl(full_key)
        _, count, ttl = await pipe.execute()
    return count <= limit, ttl if ttl and ttl > 0 else window_s


async def enforce(key: str, limit: int, window_s: int, message: str = "Too many requests. Please wait and try again.") -> None:
    try:
        allowed, retry_after = await hit(key, limit, window_s)
    except Exception as exc:  # Redis down: fail closed
        log.error("Rate limiter unavailable: %s", exc)
        raise HTTPException(503, "Service temporarily unavailable. Please try again shortly.") from exc
    if not allowed:
        raise HTTPException(429, message, headers={"Retry-After": str(retry_after)})


async def clear(key_prefix: str) -> None:
    """Reset counters for a key (e.g. after a successful login)."""
    try:
        r = get_redis()
        await r.delete(f"rl:{key_prefix}")
        async for k in r.scan_iter(f"rl:{key_prefix}:*"):
            await r.delete(k)
    except Exception:  # best effort
        pass
