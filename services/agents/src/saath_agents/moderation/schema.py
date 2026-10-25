"""A9 output schema (P2-05). extra=forbid everywhere: the verdict that crosses
back to Core is labels + signal keywords only — never user text (rule 6/8
hygiene: moderation consumers act on categories, not content)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

LABELS = Literal[
    "safe",
    "money_request",
    "off_platform_pressure",
    "scam_script",
    "harassment",
    "sexual_content",
]

MODEL_VERSION = "a9-moderation-v1"


class ModerationVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: LABELS
    confidence: float = Field(ge=0.0, le=1.0)
    signals: list[str] = Field(default_factory=list, max_length=5)  # short keywords only
    model_version: str = Field(default=MODEL_VERSION, max_length=32)
