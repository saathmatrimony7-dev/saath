"""Profile snapshot — the ONLY shape Core may send to the matching service (P3-02).

DESIGN.md §8 / rule 6 guard: this schema is the type-level proof that raw user
text cannot enter the embedding pipeline — there is deliberately NO free-text
transcript field. ``stances`` are A2-system-normalised soft-preference stances
(``soft_preferences.stance_normalised``), never raw chat/bio text.
"""

from __future__ import annotations

import re
import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_LABEL_CHARS = 80
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


class ProfileSnapshot(BaseModel):
    """Normalised profile snapshot accepted from Core (strict, rule 3)."""

    model_config = ConfigDict(extra="forbid")

    user_id: uuid.UUID
    profile_version: int = Field(ge=1)
    pref_version: int = Field(ge=1)

    display_name: str | None = Field(default=None, max_length=MAX_LABEL_CHARS)
    about_normalised: str | None = Field(default=None, max_length=MAX_ABOUT_CHARS)
    profession: str | None = Field(default=None, max_length=MAX_LABEL_CHARS)
    education_level: str | None = Field(default=None, max_length=MAX_LABEL_CHARS)
    diet: str | None = Field(default=None, max_length=MAX_LABEL_CHARS)
    marital_status: str | None = Field(default=None, max_length=MAX_LABEL_CHARS)
    city_label: str | None = Field(default=None, max_length=MAX_LABEL_CHARS)
    religion_label: str | None = Field(default=None, max_length=MAX_LABEL_CHARS)
    community_label: str | None = Field(default=None, max_length=MAX_LABEL_CHARS)

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
        "diet",
        "marital_status",
        "city_label",
        "religion_label",
        "community_label",
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
