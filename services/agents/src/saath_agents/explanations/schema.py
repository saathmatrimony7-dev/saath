"""P3-09 explanation output contract — strict schema (extra=forbid).

The LLM may only answer with claims whose `fact` is one of the tags Core
provided for the pair (closed vocabulary, declared fields only). The
generator post-checks claim.fact against the provided set anyway — this
schema is the first gate, not the only one.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Mirrors EXPLANATION_FACT_TAGS in Core (services/api matching.service.ts).
# Generic positives only: no screening verdicts/topics/reason codes (§7.4.3).
EXPLANATION_FACT_TAGS: tuple[str, ...] = (
    "SHARED_CITY",
    "SHARED_DIET",
    "SHARED_COMMUNITY",
    "SHARED_RELIGION",
    "BOTH_VERIFIED",
    "BOTH_RECENTLY_ACTIVE",
)

# Pinned model_version (rule 13: versions are config/pinned, never inferred).
EXPLANATION_MODEL_VERSION = "a4-explain-v1"


class ExplanationClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fact: str = Field(min_length=1)
    text: str = Field(min_length=1, max_length=140)


class ExplanationsResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_version: Literal["a4-explain-v1"]
    claims: list[ExplanationClaim] = Field(min_length=1, max_length=3)
