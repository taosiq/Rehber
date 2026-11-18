"""Password hashing, random tokens and signatures.

- Passwords: Argon2id (OWASP's first recommendation), auto-upgraded when params change.
- Session tokens / API keys: 256-bit random values; only their SHA-256 hash is stored,
  so a database leak doesn't expose working credentials.
- Widget conversation tokens: HMAC-SHA256 signatures with SECRET_KEY.
"""

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

_hasher = PasswordHasher()  # argon2id, m=64MiB, t=3, p=4

# Verifying against this when the email doesn't exist keeps response time
# identical, so attackers can't discover which emails have accounts.
_DUMMY_HASH = _hasher.hash("timing-equaliser-not-a-real-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> tuple[bool, str | None]:
    """Return (ok, new_hash). new_hash is set when the stored hash should be upgraded."""
    try:
        _hasher.verify(password_hash or _DUMMY_HASH, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False, None
    if password_hash is None:
        return False, None
    return True, (_hasher.hash(password) if _hasher.check_needs_rehash(password_hash) else None)


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def constant_time_equals(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    return hmac.compare_digest(a.encode(), b.encode())


def sign(value: str, purpose: str) -> str:
    """HMAC signature bound to a purpose, so a token for one use can't be replayed for another."""
    key = get_settings().secret_key.encode()
    return hmac.new(key, f"{purpose}:{value}".encode(), hashlib.sha256).hexdigest()


def verify_signature(value: str, signature: str | None, purpose: str) -> bool:
    return constant_time_equals(sign(value, purpose), signature)
