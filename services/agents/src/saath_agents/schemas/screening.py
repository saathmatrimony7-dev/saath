"""Screening protocol schemas (DESIGN.md §7.3).

The verdict shape mirrors §7.3 exactly; reason codes are an allow-list enum,
never free text — incompatible pairs reveal nothing (§7.4.4).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class Verdict(str, Enum):
    COMPATIBLE = "COMPATIBLE"
    PARTIAL = "PARTIAL"
    INCOMPATIBLE = "INCOMPATIBLE"


class TopicResult(str, Enum):
    COMPATIBLE = "compatible"
    PARTIAL = "partial"
    CONFLICT = "conflict"


class AdvocateTopicAnswer(BaseModel):
    """Per-topic structured answer from an Advocate (Stage 2). No free text."""

    model_config = ConfigDict(strict=True, extra="forbid")

    topic: str = Field(max_length=64)
    result: TopicResult
    confidence: float = Field(ge=0.0, le=1.0)


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
