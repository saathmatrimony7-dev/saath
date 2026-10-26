"""Screening protocol schemas (DESIGN.md §7.3).

The verdict shape mirrors §7.3 exactly; reason codes are an allow-list enum,
never free text — incompatible pairs reveal nothing (§7.4.4).

P3-05 adds the redacted preference snapshot (§7.4.1): the ONLY view that may
cross between the two users' agents. Enums + A2-normalised stances, strict
extra=forbid, and no free-text field anywhere (exit criterion 1). This file
mirrors services/api/src/modules/screening/screening.dto.ts — keep in sync.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Pinned model versions (rule 13: models are config, versions are pinned in
# code for reproducibility/audit, §7.4.6). Core refuses writes whose
# model_version differs from its configured SCREENING_MODEL_VERSION.
MODEL_VERSION = "a6-screen-v2"
A5_MODEL_VERSION = "a5-advocate-v2"


class Verdict(str, Enum):
    COMPATIBLE = "COMPATIBLE"
    PARTIAL = "PARTIAL"
    INCOMPATIBLE = "INCOMPATIBLE"


class TopicResult(str, Enum):
    COMPATIBLE = "compatible"
    PARTIAL = "partial"
    CONFLICT = "conflict"


class AdvocateTopicAnswer(BaseModel):
    """Per-topic structured answer from an Advocate (Stage 2). No free text.

    Parsed from model JSON output, so not strict-mode (str→enum coercion is
    allowed); the boundary is extra="forbid" + the TopicResult enum + bounds.
    """

    model_config = ConfigDict(extra="forbid")

    topic: str = Field(max_length=64)
    result: TopicResult
    confidence: float = Field(ge=0.0, le=1.0)


class AdvocateAnswers(BaseModel):
    """A5 strict output: per-topic answers only. Never prose, never echoes."""

    model_config = ConfigDict(extra="forbid")

    answers: list[AdvocateTopicAnswer] = Field(default_factory=list, max_length=64)
    model_version: str = Field(default=A5_MODEL_VERSION, max_length=32)


class TopicScore(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    topic: str
    result: TopicResult


class ScreeningVerdict(BaseModel):
    """Stage 3 verdict written to screening_results (§7.3)."""

    model_config = ConfigDict(strict=True, extra="forbid")

    pair: tuple[str, str]
    verdict: Verdict
    score: float = Field(ge=0.0, le=1.0)
    topics: list[TopicScore] = Field(default_factory=list)
    reason_codes: list[str] = Field(default_factory=list)  # enum-gated at write time
    model_version: str
    expires_at: datetime


# ---------------------------------------------------------------------------
# Redacted snapshot (§7.2/§7.4.1) — wire contract, camelCase like Core's zod.
# ---------------------------------------------------------------------------

Diet = Literal["veg", "eggetarian", "non_veg", "jain_veg", "vegan"]
MaritalStatus = Literal["never_married", "divorced", "widowed", "separated"]
ShareLevel = Literal["minimal", "standard", "detailed"]

STANCE_MAX_CHARS = 200
TOPIC_MAX_CHARS = 64


class SoftPreferenceStance(BaseModel):
    """One A2-normalised stance. The ONLY natural-language channel, bounded."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    topic: str = Field(min_length=1, max_length=TOPIC_MAX_CHARS)
    stance: str = Field(min_length=1, max_length=STANCE_MAX_CHARS)
    weight: int = Field(ge=0, le=100)


class ProfileEnums(BaseModel):
    """Enum/boolean profile facts only — no names, no about text."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    diet: Diet | None = None
    marital_status: MaritalStatus | None = Field(default=None, alias="maritalStatus")
    has_children: bool = Field(alias="hasChildren")
    willing_to_relocate: bool | None = Field(default=None, alias="willingToRelocate")


class PreferenceEnums(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    relocate_ok: bool | None = Field(default=None, alias="relocateOk")
    diet_ok: list[Diet] = Field(default_factory=list, max_length=10, alias="dietOk")
    marital_ok: list[MaritalStatus] = Field(
        default_factory=list, max_length=10, alias="maritalOk"
    )


class RedactedSnapshot(BaseModel):
    """What the broker (and each A5 advocate) may see about one user.

    No community/religion (Stage 1 handles those deterministically; rule 10),
    no city (Stage 1 concern), no free text beyond bounded normalised stances.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    user_id: str = Field(alias="userId")
    pref_version: int = Field(ge=1, alias="prefVersion")
    profile_version: int = Field(ge=1, alias="profileVersion")
    profile_enums: ProfileEnums = Field(alias="profileEnums")
    preferences: PreferenceEnums
    soft_preferences: list[SoftPreferenceStance] = Field(
        default_factory=list, max_length=10, alias="softPreferences"
    )
    share_level: ShareLevel = Field(alias="shareLevel")


class SnapshotBundle(BaseModel):
    """get_preference_snapshot response: snapshot + audit-hash material."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    snapshot: RedactedSnapshot
    snapshot_hash: str = Field(alias="snapshotHash", pattern=r"^[0-9a-f]{64}$")
    pref_version: int = Field(ge=1, alias="prefVersion")
    profile_version: int = Field(ge=1, alias="profileVersion")
    rules_version: str = Field(alias="rulesVersion", max_length=32)
    model_version: str = Field(alias="modelVersion", max_length=32)


class HardFilterOutcome(BaseModel):
    """Stage 1 result from Core's check-hard-filters (single source of truth)."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    compatible: bool
    reason_codes: list[str] = Field(default_factory=list, alias="reasonCodes")


class CachedLookup(BaseModel):
    """find-cached response: hit carries the stored verdict row."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    status: Literal["hit", "miss"]
    result: dict | None = None
    pref_version_a: int | None = Field(default=None, alias="prefVersionA")
    pref_version_b: int | None = Field(default=None, alias="prefVersionB")
    rules_version: str | None = Field(default=None, alias="rulesVersion", max_length=32)
    model_version: str | None = Field(default=None, alias="modelVersion", max_length=32)
