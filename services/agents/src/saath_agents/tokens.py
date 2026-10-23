"""Scoped agent tokens (DESIGN.md A6.0, A12.6).

Every agent invocation carries a short-lived token binding:
  agent              -> which agent (A1..A11)
  acting_for_user_id -> the user the agent acts for (empty for neutral agents)
  tools              -> allow-listed internal tool names
  exp                -> expiry (max 15 minutes)

Format (shared with the Core API's TS verifier — keep in sync):
  token = b64url(json_claims) + "." + b64url(hmac_sha256(secret, b64url_json))

HMAC-SHA256 signed; the signing secret lives in config / Secrets Manager.
An agent never gets DB credentials — these tokens are the ONLY way it can
call the Core API's /internal/tools/* endpoints.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
from typing import Any

from pydantic import BaseModel, Field

MAX_TTL_SECONDS = 15 * 60


class ScopedTokenClaims(BaseModel):
    agent: str
    acting_for_user_id: str = ""
    tools: list[str] = Field(default_factory=list)
    exp: int


class ScopedTokenError(Exception):
    """Signature invalid, expired, or malformed."""


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def mint_token(
    secret: str,
    *,
    agent: str,
    acting_for_user_id: str = "",
    tools: list[str] | None = None,
    ttl_seconds: int = MAX_TTL_SECONDS,
) -> str:
    if ttl_seconds > MAX_TTL_SECONDS:
        raise ValueError("agent token TTL exceeds the 15-minute maximum")
    claims = ScopedTokenClaims(
        agent=agent,
        acting_for_user_id=acting_for_user_id,
        tools=tools or [],
        exp=int(time.time()) + ttl_seconds,
    )
    payload = _b64url(claims.model_dump_json().encode())
    sig = _b64url(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def verify_token(secret: str, token: str) -> ScopedTokenClaims:
    try:
        payload, sig = token.split(".", 1)
    except ValueError as exc:
        raise ScopedTokenError("invalid or expired agent token") from exc
    expected = _b64url(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(expected, sig):
        raise ScopedTokenError("invalid or expired agent token")
    try:
        claims = ScopedTokenClaims.model_validate_json(_b64url_decode(payload))
    except ValueError as exc:
        raise ScopedTokenError("invalid or expired agent token") from exc
    if claims.exp < int(time.time()):
        raise ScopedTokenError("invalid or expired agent token")
    return claims
