# PilotReady
# Copyright (c) 2026 PilotReady. All rights reserved.
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
#
# NOTE: licensing stub - to be reviewed/refined later.

"""Security primitives for PilotReady: password hashing + JWT sessions.

Sensitive data is protected here in two ways:

* **Passwords** are never stored in plaintext — they are hashed with **bcrypt**
  (per-password random salt, adaptive cost). Only the hash lands in the
  database, so a database leak does not expose anyone's password.
* **Sessions** are stateless **JWTs** signed with ``JWT_SECRET`` (HS256). The
  server trusts a token only if the signature verifies, so a client cannot forge
  or tamper with "who am I". The secret lives in the environment (``.env`` /
  Render secret), never in the repository.

Transport encryption (HTTPS/TLS) is handled by the hosting platforms — Render
and Vercel both terminate TLS automatically — so tokens and passwords travel
encrypted on the wire in production.
"""

from __future__ import annotations

import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger("pilotready.security")

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "10080"))  # 7 days

# The signing secret MUST be provided in production. For local development we
# fall back to a random ephemeral secret and warn loudly — that keeps dev secure
# by default (no hard-coded key) while still working out of the box; the only
# cost is that existing sessions are invalidated whenever the dev server
# restarts.
JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    JWT_SECRET = secrets.token_urlsafe(48)
    logger.warning(
        "JWT_SECRET is not set — generated an ephemeral development secret. "
        "Sessions will reset on every restart. Set JWT_SECRET in your .env / "
        "hosting environment for production."
    )

# bcrypt only considers the first 72 bytes of a password. Truncate consistently
# so hashing and verification always agree regardless of the bcrypt version.
_BCRYPT_MAX_BYTES = 72


def _encode_password(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    """Return a bcrypt hash (salt embedded) safe to store in the database."""

    return bcrypt.hashpw(_encode_password(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Check a plaintext password against a stored bcrypt hash (constant-time)."""

    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(_encode_password(password), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(user_id: uuid.UUID) -> str:
    """Mint a signed JWT identifying ``user_id`` with an expiry."""

    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and verify a JWT. Raises ``jwt.PyJWTError`` if invalid/expired."""

    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


_bearer_scheme = HTTPBearer(auto_error=False)
_CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user_id(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
) -> uuid.UUID:
    """FastAPI dependency: resolve the authenticated user's id from the Bearer
    token, or reject the request with 401."""

    if credentials is None or not credentials.credentials:
        raise _CREDENTIALS_ERROR
    try:
        payload = decode_access_token(credentials.credentials)
        return uuid.UUID(str(payload["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise _CREDENTIALS_ERROR from exc
