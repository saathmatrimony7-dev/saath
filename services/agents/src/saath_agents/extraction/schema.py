"""A2 Profile Extractor — strict output schema (P1-07, DESIGN.md A6.2).

Everything is structured and schema-validated: no raw transcript text may
appear in the output (A7/rule 6 hygiene — downstream consumers get fields,
not free-form user text). extra='forbid' everywhere.

Confidence: 0.0-1.0 per field, reflecting how explicitly the user stated it.
Fields below CONFIDENCE_FLOOR are listed in low_confidence_fields and get a
confirm question — A1 sends those back to the user before publishing.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CONFIDENCE_FLOOR = 0.6
MODEL_VERSION = "a2-extract-v1"

Diet = Literal["veg", "eggetarian", "non_veg", "jain_veg", "vegan"]
MaritalStatus = Literal["never_married", "divorced", "widowed", "separated"]
Religion = Literal["hindu", "muslim", "christian", "sikh", "jain", "buddhist", "parsi", "no-religion"]


class ConfidenceValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: object | None = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class MaybeString(ConfidenceValue):
    value: str | None = Field(default=None, min_length=1, max_length=200)


class MaybeInt(ConfidenceValue):
    value: int | None = Field(default=None, ge=0, le=100000)


class MaybeBool(ConfidenceValue):
    value: bool | None = None


class ExtractedProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: MaybeString = Field(default_factory=MaybeString)
    about_normalised: MaybeString = Field(default_factory=MaybeString)
    height_cm: MaybeInt = Field(default_factory=MaybeInt)
    marital_status: ConfidenceValue = Field(default_factory=ConfidenceValue)
    diet: ConfidenceValue = Field(default_factory=ConfidenceValue)
    education_level: MaybeString = Field(default_factory=MaybeString)
    profession: MaybeString = Field(default_factory=MaybeString)
    income_band: MaybeString = Field(default_factory=MaybeString)
    city_id: MaybeString = Field(default_factory=MaybeString)
    willing_to_relocate: MaybeBool = Field(default_factory=MaybeBool)
    religion_id: MaybeString = Field(default_factory=MaybeString)
    community_id: MaybeString = Field(default_factory=MaybeString)
    sub_community_id: MaybeString = Field(default_factory=MaybeString)
    mother_tongue: MaybeString = Field(default_factory=MaybeString)


class ExtractedPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    age_min: MaybeInt = Field(default_factory=MaybeInt)
    age_max: MaybeInt = Field(default_factory=MaybeInt)
    height_min: MaybeInt = Field(default_factory=MaybeInt)
    cities: MaybeString = Field(default_factory=MaybeString)  # comma-separated slugs
    relocate_ok: MaybeBool = Field(default_factory=MaybeBool)
    open_to_all_communities: MaybeBool = Field(default_factory=MaybeBool)
    diet_ok: MaybeString = Field(default_factory=MaybeString)  # comma-separated slugs
    marital_ok: MaybeString = Field(default_factory=MaybeString)  # comma-separated slugs


class Rule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["eq", "neq", "in", "not_in", "lt", "gt"]
    value: str | int | bool | list[str]


class ExtractedDealbreaker(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]{0,63}$")
    rule: Rule
    confidence: float = Field(ge=0.0, le=1.0)


class ExtractionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile: ExtractedProfile = Field(default_factory=ExtractedProfile)
    preferences: ExtractedPreferences = Field(default_factory=ExtractedPreferences)
    dealbreakers: list[ExtractedDealbreaker] = Field(default_factory=list, max_length=50)
    low_confidence_fields: list[str] = Field(default_factory=list, max_length=50)
    confirm_questions: list[str] = Field(default_factory=list, max_length=50)
    model_version: str = Field(default=MODEL_VERSION, max_length=32)

    def fields_below_floor(self) -> list[str]:
        """Field paths (dot notation) whose confidence is under the floor."""

        low: list[str] = []

        def walk(prefix: str, model: BaseModel) -> None:
            for name in type(model).model_fields:
                val = getattr(model, name)
                path = f"{prefix}.{name}" if prefix else name
                if isinstance(val, ConfidenceValue) and val.value is not None:
                    if val.confidence < CONFIDENCE_FLOOR:
                        low.append(path)
                elif isinstance(val, BaseModel):
                    walk(path, val)

        walk("profile", self.profile)
        walk("preferences", self.preferences)
        low.extend(
            f"dealbreakers[{i}]"
            for i, d in enumerate(self.dealbreakers)
            if d.confidence < CONFIDENCE_FLOOR
        )
        return low
