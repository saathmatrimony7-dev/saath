"""Schema contract tests: the screening verdict enforces structure (§7).

This is the seed of the P3 guarantee "no raw user text crosses users" —
verdicts and advocate answers are schema-bound; unknown fields are forbidden.
"""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from saath_agents.schemas import AdvocateTopicAnswer, ScreeningVerdict, TopicResult, Verdict


def test_advocate_answer_valid():
    ans = AdvocateTopicAnswer(topic="career_after_marriage", result=TopicResult.COMPATIBLE, confidence=0.9)
    assert ans.result == TopicResult.COMPATIBLE


def test_advocate_answer_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        AdvocateTopicAnswer.model_validate(
            {
                "topic": "diet",
                "result": "compatible",
                "confidence": 0.5,
                "raw_user_text": "I hate non-veg people",  # must never be accepted
            }
        )


def test_advocate_answer_rejects_freeform_result():
    with pytest.raises(ValidationError):
        AdvocateTopicAnswer.model_validate(
            {"topic": "diet", "result": "they seem nice honestly", "confidence": 0.5}
        )


def test_verdict_shape():
    v = ScreeningVerdict(
        pair=("usr_a", "usr_b"),
        verdict=Verdict.COMPATIBLE,
        score=0.82,
        topics=[],
        reason_codes=["CITY_FLEX_PARTIAL"],
        model_version="screen-v0",
        expires_at=datetime.now(UTC),
    )
    assert v.verdict is Verdict.COMPATIBLE
