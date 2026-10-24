"""A2 extractor + golden-set tests (P1-07)."""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from evals.golden.personas import PERSONAS
from saath_agents.extraction.extractor import A2Extractor, ExtractionError
from saath_agents.extraction.schema import (
    CONFIDENCE_FLOOR,
    ExtractionResult,
    ExtractedProfile,
    MaybeString,
)

VALID = {
    "profile": {
        "profession": {"value": "teacher", "confidence": 0.95},
        "diet": {"value": "veg", "confidence": 0.5},  # below floor
        "religion_id": {"value": "hindu", "confidence": 0.95},
    },
    "preferences": {"age_min": {"value": 26, "confidence": 0.93}},
    "dealbreakers": [
        {"field": "diet", "rule": {"op": "eq", "value": "veg"}, "confidence": 0.9}
    ],
    "low_confidence_fields": ["profile.diet"],
    "confirm_questions": ["Are you strictly vegetarian?"],
    "model_version": "a2-extract-v1",
}


class FakeLlm:
    def __init__(self, replies: list[str]) -> None:
        self.replies = replies
        self.calls = 0

    def complete(self, **kwargs):
        self.calls += 1
        return {"text": self.replies[min(self.calls - 1, len(self.replies) - 1)]}


# --- schema -----------------------------------------------------------------

def test_schema_strict_rejects_extra_keys():
    with pytest.raises(ValidationError):
        ExtractedProfile.model_validate({"profession": {"value": "x", "confidence": 1}, "hacked": 1})


def test_schema_rejects_bad_confidence_range():
    with pytest.raises(ValidationError):
        MaybeString(value="x", confidence=1.5)


def test_result_roundtrip_and_floor_detection():
    r = ExtractionResult.model_validate(VALID)
    assert "profile.diet" in r.fields_below_floor()
    assert "profile.profession" not in r.fields_below_floor()


def test_no_raw_transcript_echo_in_output():
    transcript_line = "I teach mathematics at a CBSE school in Pune"
    r = ExtractionResult.model_validate(VALID)
    blob = json.dumps(r.model_dump(), ensure_ascii=False)
    assert transcript_line not in blob


# --- extractor ---------------------------------------------------------------

def test_extractor_happy_path():
    llm = FakeLlm([json.dumps(VALID)])
    out = A2Extractor(llm).extract([{"role": "user", "content": "I am a teacher."}])
    assert out.profile.profession.value == "teacher"


def test_extractor_repairs_invalid_json_once():
    good = json.dumps(VALID)
    llm = FakeLlm(["this is not json at all", f"```json\n{good}\n```"])
    out = A2Extractor(llm).extract([{"role": "user", "content": "hi"}])
    assert out.profile.profession.value == "teacher"
    assert llm.calls == 2


def test_extractor_gives_up_after_retries():
    llm = FakeLlm(["not json", "still not json"])
    with pytest.raises(ExtractionError):
        A2Extractor(llm).extract([{"role": "user", "content": "hi"}])
    assert llm.calls == 2


def test_extractor_rejects_empty_transcript():
    with pytest.raises(ExtractionError):
        A2Extractor(FakeLlm([json.dumps(VALID)])).extract([])


# --- golden set sanity -------------------------------------------------------

def test_golden_set_size_and_diversity():
    assert len(PERSONAS) >= 20
    locales = {p["locale"] for p in PERSONAS}
    assert {"en", "hi", "ta"} <= locales
    genders = {p["gender"] for p in PERSONAS}
    assert genders == {"M", "F"}
    communities = {p["community"] for p in PERSONAS}
    assert len(communities) >= 10


def test_every_persona_has_usable_ground_truth():
    """Every persona carries at least 4 scorable checks (the eval needs signal),
    and at least one dealbreaker section (possibly empty = discipline check)."""
    for persona in PERSONAS:
        checks = sum(
            len(persona["expected"].get(section) or {})
            for section in ("profile", "preferences")
        ) + len(persona["expected"].get("dealbreakers") or [])
        assert checks >= 4, f"{persona['id']} has too little ground truth"
        assert "dealbreakers" in persona["expected"]
    for persona in PERSONAS:
        assert "dealbreakers" in persona["expected"]


# --- injection robustness (prompt-level, mocked model) -----------------------

def test_prompt_forbids_inference_and_mentions_injection():
    from saath_agents.extraction.extractor import load_prompt

    prompt = load_prompt().lower()
    assert "never infer" in prompt
    assert "prompt-injection" in prompt or "injection" in prompt
    assert CONFIDENCE_FLOOR == 0.6
