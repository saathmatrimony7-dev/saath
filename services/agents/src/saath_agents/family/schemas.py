"""A7 summary output contract (P3-10) — strict schema, extra=forbid."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Pinned model_version (rule 13).
FAMILY_SUMMARY_MODEL_VERSION = "a7-family-v1"


class FamilySignalItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidateId: str
    signals: list[str] = Field(default_factory=list)  # approve|reject|interested|concern


class FamilySummaryResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_version: Literal["a7-family-v1"]
    summary: str = Field(min_length=1, max_length=400)
