"""Encryption for secrets we must be able to read back (e.g. a business's WhatsApp access token).

Passwords and API keys are only ever hashed. An access token, though, has to be sent to Meta, so it is
encrypted at rest with Fernet (AES-128-CBC + HMAC-SHA256). The key is derived from SECRET_KEY, so a
database dump alone does not reveal working tokens.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


def _fernet() -> Fernet:
    digest = hashlib.sha256(b"rehber-encryption-v1:" + get_settings().secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(token: str) -> str | None:
    """None when the value can't be decrypted (e.g. SECRET_KEY was changed)."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return None
