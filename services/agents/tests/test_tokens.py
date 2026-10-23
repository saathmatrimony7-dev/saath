"""Scoped token tests: mint/verify, expiry, tamper, TTL cap."""

import time

import pytest

from saath_agents.tokens import (
    MAX_TTL_SECONDS,
    ScopedTokenError,
    mint_token,
    verify_token,
)

SECRET = "test-secret-do-not-use-in-prod-0123456789"


def test_roundtrip():
    token = mint_token(
        SECRET, agent="A5-advocate", acting_for_user_id="usr_1", tools=["get_preference_snapshot"]
    )
    claims = verify_token(SECRET, token)
    assert claims.agent == "A5-advocate"
    assert claims.acting_for_user_id == "usr_1"
    assert claims.tools == ["get_preference_snapshot"]
    assert claims.exp > int(time.time())


def test_tampered_token_rejected():
    token = mint_token(SECRET, agent="A1")
    bad = token[:-4] + "AAAA"
    with pytest.raises(ScopedTokenError):
        verify_token(SECRET, bad)


def test_wrong_secret_rejected():
    token = mint_token(SECRET, agent="A1")
    with pytest.raises(ScopedTokenError):
        verify_token("another-secret-0123456789abcdef", token)


def test_expired_token_rejected():
    token = mint_token(SECRET, agent="A1", ttl_seconds=-10)
    with pytest.raises(ScopedTokenError):
        verify_token(SECRET, token)


def test_ttl_capped_at_15_minutes():
    with pytest.raises(ValueError):
        mint_token(SECRET, agent="A1", ttl_seconds=MAX_TTL_SECONDS + 1)


# Deterministic golden vector minted by the Core API's TS verifier
# (format: b64url(json) + "." + b64url(hmac_sha256(secret, payload))).
# Regenerate with services/api/scripts if the format ever changes.
TS_GOLDEN_TOKEN = (
    "eyJhZ2VudCI6IkExLW9uYm9hcmRpbmciLCJhY3RpbmdfZm9yX3VzZXJfaWQiOiJ1c3JfMSIsInRvb2xzIjpbImdldF9wcm9maWxlX2RyYWZ0Iiwic2F2ZV9wcm9maWxlX2ZpZWxkcyJdLCJleHAiOjQwMDAwMDAwMDB9"
    ".bWN6jaM4Czi6B17tQFiHlxUuEUvm8LUS6Eej8jQOLyA"
)


def test_ts_interop_golden_vector():
    """A token minted by the TS gateway verifies here — formats stay in sync."""
    claims = verify_token(SECRET, TS_GOLDEN_TOKEN)
    assert claims.agent == "A1-onboarding"
    assert claims.acting_for_user_id == "usr_1"
    assert claims.tools == ["get_profile_draft", "save_profile_fields"]


def test_ts_interop_golden_vector_tamper_rejected():
    bad = TS_GOLDEN_TOKEN[:-4] + "AAAA"
    with pytest.raises(ScopedTokenError):
        verify_token(SECRET, bad)
