"""Scoped agent tokens (DESIGN.md §6.0, §12.6).

Every agent invocation carries a short-lived token binding:
  agent              — which agent (A1…A11)
  acting_for_user_id — the user the agent acts for (empty for neutral agents)
  tools              — allow-listed internal tool names
  exp                — expiry (max 15 minutes)

HMAC-SHA256 signed (itsdangerous). The signing secret lives in config /
Secrets Manager. An agent never gets DB credentials — these tokens are the
ONLY way it can call the Core API's /internal/tools/* endpoints.
"""

from __future__ import annotations

import time
from typing import Any

import itsdangerous
from pydantic import BaseModel, Field

MAX_TTL_SECONDS = 15 * 60


class ScopedTokenClaims(BaseModel):
    agent: str
    acting_for_user_id: str = ""
    tools: list[str] = Field(default_factory=list)
    exp: int


class ScopedTokenError(Exception):
    """Signature invalid, expired, or malformed."""


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
    signer = itsdangerous.TimestampSigner(secret.encode())
    payload = claims.model_dump_json().encode()
    return signer.sign(payload).decode()


def verify_token(secret: str, token: str) -> ScopedTokenClaims:
    signer = itsdangerous.TimestampSigner(secret.encode())
    try:
        payload = signer.unsign(token, max_age=MAX_TTL_SECONDS)
        claims = ScopedTokenClaims.model_validate_json(payload)
    except (itsdangerous.BadSignature, itsdangerous.SignatureExpired, ValueError) as exc:
        raise ScopedTokenError("invalid or expired agent token") from exc
    if claims.exp < int(time.time()):
        raise ScopedTokenError("invalid or expired agent token")
    return claims
