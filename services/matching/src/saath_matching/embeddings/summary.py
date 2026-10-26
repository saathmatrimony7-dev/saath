"""Normalised structured summary used as the ONLY embedding input (§8).

Raw bios never reach the embedding provider: A2-system-normalised fields
(soft_preferences.stance_normalised for stances) are validated here and
rendered to a stable "key: value" text. Control characters (including
newlines) are rejected in every string field so the rendered text cannot be
injected with extra lines.
"""

from __future__ import annotations

import re
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_ABOUT_CHARS = 500
MAX_ATTRIBUTES = 20
MAX_ATTRIBUTE_VALUE_CHARS = 120
MAX_STANCES = 10
MAX_STANCE_CHARS = 200
MAX_PREFERENCES = 10
MAX_PREFERENCE_CHARS = 120

ATTRIBUTE_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


def _check_no_control_chars(value: str) -> str:
    if _CONTROL_CHARS.search(value):
        raise ValueError("control characters (including newlines) are not allowed")
    return value


class EmbeddingSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = None
    about_normalised: str | None = Field(default=None, max_length=MAX_ABOUT_CHARS)
    profession: str | None = None
    education_level: str | None = None
    city: str | None = None
    diet: str | None = None
    marital_status: str | None = None
    attributes: dict[
        Annotated[str, Field(pattern=ATTRIBUTE_KEY_PATTERN.pattern)],
        Annotated[str, Field(max_length=MAX_ATTRIBUTE_VALUE_CHARS)],
    ] = Field(default_factory=dict, max_length=MAX_ATTRIBUTES)
    stances: list[Annotated[str, Field(max_length=MAX_STANCE_CHARS)]] = Field(
        default_factory=list, max_length=MAX_STANCES
    )
    preferences: list[Annotated[str, Field(max_length=MAX_PREFERENCE_CHARS)]] = Field(
        default_factory=list, max_length=MAX_PREFERENCES
    )

    @field_validator(
        "display_name",
        "about_normalised",
        "profession",
        "education_level",
        "city",
        "diet",
        "marital_status",
        mode="before",
    )
    @classmethod
    def _no_control_chars(cls, value: object) -> object:
        if isinstance(value, str):
            _check_no_control_chars(value)
        return value

    @field_validator("attributes", mode="before")
    @classmethod
    def _validate_attributes(cls, value: object) -> object:
        if isinstance(value, dict):
            for key, item in value.items():
                if not isinstance(key, str) or not ATTRIBUTE_KEY_PATTERN.match(key):
                    raise ValueError(
                        f"invalid attribute key {key!r}; must match "
                        f"{ATTRIBUTE_KEY_PATTERN.pattern}"
                    )
                if isinstance(item, str):
                    _check_no_control_chars(item)
        return value

    @field_validator("stances", "preferences", mode="before")
    @classmethod
    def _validate_lists(cls, value: object) -> object:
        if isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    _check_no_control_chars(item)
        return value


# Fixed render order — the rendered text feeds the embedding, so it must be
# stable across runs and code changes.
_FIELD_ORDER = (
    "display_name",
    "about_normalised",
    "profession",
    "education_level",
    "city",
    "diet",
    "marital_status",
)


def render_summary_text(summary: EmbeddingSummary) -> str:
    """Stable newline-joined "key: value" rendering used as embedding input."""
    lines: list[str] = []
    for name in _FIELD_ORDER:
        value = getattr(summary, name)
        if value:
            lines.append(f"{name}: {value}")
    if summary.attributes:
        attrs = ", ".join(f"{k}={v}" for k, v in sorted(summary.attributes.items()))
        lines.append(f"attributes: {attrs}")
    if summary.stances:
        lines.append("stances: " + ", ".join(summary.stances))
    if summary.preferences:
        lines.append("preferences: " + ", ".join(summary.preferences))
    return "\n".join(lines)
