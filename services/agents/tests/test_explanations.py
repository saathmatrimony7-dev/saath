"""P3-09: A4 explanation generator + engine wiring tests (scripted LLM port).

Covers the exit criteria: strict schema (extra=forbid), factuality
(claim.fact must be a provided tag — screening reason codes can never
leak), output filters (PII patterns, HTML, length), locale handling,
deterministic fallback on every failure mode, and engine wiring
(explanations only for published matches; errors counted, never raised).
"""

from __future__ import annotations

import json

from saath_agents.explanations import ExplanationGenerator, ExplanationSettings
from saath_agents.matchmaker import A4Matchmaker, MatchmakerSettings

FACTS = ["SHARED_CITY", "SHARED_DIET"]

GOOD = json.dumps(
    {
        "model_version": "a4-explain-v1",
        "claims": [
            {"fact": "SHARED_CITY", "text": "You are both based in the same city."},
            {"fact": "SHARED_DIET", "text": "You share the same diet."},
        ],
    }
)


class FakeLlm:
    """Scripted LLM gateway port; fail=True simulates budget/transport errors."""

    def __init__(self, responses: list[dict], *, fail: bool = False) -> None:
        self._responses = list(responses)
        self._fail = fail
        self.calls: list[dict] = []

    def complete(self, *, agent, tier, messages, acting_for_user_id=None, system=None, max_tokens=None):
        self.calls.append(
            {"agent": agent, "tier": tier, "messages": messages, "user": acting_for_user_id}
        )
        if self._fail:
            raise RuntimeError("simulated gateway failure")
        return self._responses.pop(0) if self._responses else {"text": "not json"}


def gen(llm: FakeLlm) -> ExplanationGenerator:
    return ExplanationGenerator(llm, ExplanationSettings())


def test_happy_path_schema_valid():
    llm = FakeLlm([{"text": GOOD}])
    text = gen(llm).generate(viewer_id="u1", locale="en", facts=FACTS)
    assert text == "You are both based in the same city. You share the same diet."
    call = llm.calls[0]
    assert call["tier"] == "mid"
    assert call["agent"] == "A4-matchmaker"
    assert call["user"] == "u1"


def test_no_or_unknown_facts_returns_none():
    assert gen(FakeLlm([])).generate(viewer_id="u", locale="en", facts=[]) is None
    assert gen(FakeLlm([])).generate(viewer_id="u", locale="en", facts=["SECRET_SALARY"]) is None


def test_invalid_json_repair_retry_then_success():
    llm = FakeLlm([{"text": "not json"}, {"text": GOOD}])
    text = gen(llm).generate(viewer_id="u", locale="en", facts=FACTS)
    assert text is not None and "same city" in text
    assert len(llm.calls) == 2


def test_persistent_invalid_falls_back_to_template():
    llm = FakeLlm([{"text": "nope"}, {"text": "still nope"}])
    text = gen(llm).generate(viewer_id="u", locale="en", facts=FACTS)
    assert text == "You are both based in the same city. You share the same diet."
    assert len(llm.calls) == 2  # one retry, then fallback


def test_unknown_fact_tag_falls_back():
    bad = json.dumps(
        {
            "model_version": "a4-explain-v1",
            "claims": [{"fact": "PARTNER_AGE_32", "text": "They are 32 years old."}],
        }
    )
    llm = FakeLlm([{"text": bad}, {"text": bad}])
    text = gen(llm).generate(viewer_id="u", locale="en", facts=FACTS)
    assert text == "You are both based in the same city. You share the same diet."


def test_screening_reason_codes_can_never_leak():
    # Exit criterion (verdict_only → no reasons leak): reason-code tags are
    # filtered BEFORE the LLM call, and claim.fact is post-checked against
    # the provided set — any response naming one falls back.
    for tag in ("AGE", "DIET", "COMMUNITY", "DEALBREAKER_UNKNOWN_FIELD"):
        claim = json.dumps({"model_version": "a4-explain-v1", "claims": [{"fact": tag, "text": "x"}]})
        llm = FakeLlm([{"text": claim}, {"text": claim}])
        text = gen(llm).generate(viewer_id="u", locale="en", facts=FACTS + [tag])
        assert text is not None and tag not in text
    sneaky = FakeLlm([{"text": GOOD}])
    gen(sneaky).generate(viewer_id="u", locale="en", facts=["AGE", "SHARED_CITY"])
    assert "AGE" not in sneaky.calls[0]["messages"][0]["content"]


def test_pii_html_and_length_filters_fall_back():
    pii = json.dumps(
        {
            "model_version": "a4-explain-v1",
            "claims": [{"fact": "SHARED_CITY", "text": "Call me at 9876543210."}],
        }
    )
    llm = FakeLlm([{"text": pii}, {"text": pii}])
    assert gen(llm).generate(viewer_id="u", locale="en", facts=FACTS) == (
        "You are both based in the same city. You share the same diet."
    )

    html = json.dumps(
        {
            "model_version": "a4-explain-v1",
            "claims": [{"fact": "SHARED_CITY", "text": "<b>bold</b>"}],
        }
    )
    llm2 = FakeLlm([{"text": html}, {"text": html}])
    assert "bold" not in (gen(llm2).generate(viewer_id="u", locale="en", facts=FACTS) or "")

    too_long = json.dumps(
        {
            "model_version": "a4-explain-v1",
            "claims": [{"fact": "SHARED_CITY", "text": "x" * 200}],
        }
    )
    llm3 = FakeLlm([{"text": too_long}, {"text": too_long}])
    assert gen(llm3).generate(viewer_id="u", locale="en", facts=FACTS) == (
        "You are both based in the same city. You share the same diet."
    )


def test_gateway_failure_falls_back():
    llm = FakeLlm([], fail=True)
    text = gen(llm).generate(viewer_id="u", locale="en", facts=FACTS)
    assert text == "You are both based in the same city. You share the same diet."


def test_fallback_templates_per_locale():
    llm = FakeLlm([], fail=True)
    assert "शहर" in gen(llm).generate(viewer_id="u", locale="hi", facts=["SHARED_CITY"])
    assert "நகர" in gen(llm).generate(viewer_id="u", locale="ta", facts=["SHARED_CITY"])
    # unknown locale degrades to English
    assert "same city" in gen(llm).generate(viewer_id="u", locale="fr", facts=["SHARED_CITY"])


# ---------------------------------------------------------------------------
# Engine wiring (explanations on the publish payload, published matches only)
# ---------------------------------------------------------------------------


class FakeTools:
    def __init__(self, candidates: list[dict], *, locale: str = "hi") -> None:
        self._candidates = candidates
        self._locale = locale
        self.publish_calls: list[tuple[str, str, list]] = []

    def get_candidates(self, user_id: str) -> dict:
        return {
            "candidates": list(self._candidates),
            "shownCounts": {},
            "locale": self._locale,
        }

    def request_screenings(self, a: str, candidate_ids: list[str]) -> dict:
        return {
            "results": [
                {"candidateId": cid, "verdict": "COMPATIBLE", "score": 0.9} for cid in candidate_ids
            ]
        }

    def publish_daily_matches(self, user_id: str, batch_date: str, matches: list) -> dict:
        self.publish_calls.append((user_id, batch_date, matches))
        return {"published": len(matches)}


def _cand(uid: str, facts: list[str]) -> dict:
    return {
        "userId": uid,
        "score": 0.9,
        "similarity": 0.9,
        "signals": {},
        "reasonCodes": [],
        "explanationFacts": facts,
    }


def test_engine_attaches_explanations_in_viewer_locale():
    tools = FakeTools(
        [_cand("c1", ["SHARED_CITY", "SHARED_DIET"]), _cand("c2", [])], locale="hi"
    )
    llm = FakeLlm([{"text": GOOD}])  # one call: only c1 has facts
    engine = A4Matchmaker(
        tools, MatchmakerSettings(daily_publish_count=2), ExplanationGenerator(llm)
    )
    out = engine.run_for_user("me", "2026-10-30")
    assert out["explanations"] == 1
    assert out["explanationErrors"] == 0
    published = tools.publish_calls[0][2]
    assert published[0]["explanation"]["hi"] == (
        "You are both based in the same city. You share the same diet."
    )
    # c2 had no facts → no explanation key, but still published
    assert "explanation" not in published[1]


def test_engine_generator_exception_is_counted_not_raised():
    class Exploding:
        def generate(self, **kwargs):  # noqa: ANN003, ANN002
            raise RuntimeError("boom")

    tools = FakeTools([_cand("c1", ["SHARED_CITY"])])
    engine = A4Matchmaker(tools, MatchmakerSettings(), Exploding())  # type: ignore[arg-type]
    out = engine.run_for_user("me", "2026-10-30")
    assert out["published"] == 1
    assert out["explanations"] == 0
    assert out["explanationErrors"] == 1
