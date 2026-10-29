"""P3-10: A7 Family Liaison tests (scripted LLM port).

Covers: strict schema, one repair retry, deterministic per-locale fallback
on every failure mode, the signals-only payload contract (no comments can
ever reach the LLM), and output filters.
"""

from __future__ import annotations

import json

from starlette.testclient import TestClient

from saath_agents.config import AgentConfig
from saath_agents.family import A7FamilyLiaison, FamilySignalItem
from saath_agents.main import create_app

GOOD = json.dumps(
    {"model_version": "a7-family-v1", "summary": "Your family approves one profile and has concerns about another."}
)

ITEMS = [
    FamilySignalItem(candidateId="c1", signals=["approve", "approve"]),
    FamilySignalItem(candidateId="c2", signals=["concern"]),
]


class FakeLlm:
    def __init__(self, responses: list[dict], *, fail: bool = False) -> None:
        self._responses = list(responses)
        self._fail = fail
        self.calls: list[dict] = []

    def complete(self, *, agent, tier, messages, acting_for_user_id=None, system=None, max_tokens=None):
        self.calls.append({"agent": agent, "tier": tier, "messages": messages})
        if self._fail:
            raise RuntimeError("simulated gateway failure")
        return self._responses.pop(0) if self._responses else {"text": "not json"}


def test_happy_path_schema_valid():
    llm = FakeLlm([{"text": GOOD}])
    out = A7FamilyLiaison(llm).summarise(owner_id="o1", locale="en", items=ITEMS)
    assert out == "Your family approves one profile and has concerns about another."
    assert llm.calls[0]["tier"] == "mid"
    assert llm.calls[0]["agent"] == "A7-family"


def test_invalid_json_repair_retry_then_fallback():
    llm = FakeLlm([{"text": "not json"}, {"text": GOOD}])
    out = A7FamilyLiaison(llm).summarise(owner_id="o", locale="en", items=ITEMS)
    assert "approves one profile" in out
    assert len(llm.calls) == 2


def test_persistent_failure_falls_back_to_locale_template():
    llm = FakeLlm([{"text": "nope"}, {"text": "still nope"}])
    out = A7FamilyLiaison(llm).summarise(owner_id="o", locale="en", items=ITEMS)
    assert out == "Family feedback across 2 shortlisted profile(s): 2 approve, 1 concern."


def test_gateway_failure_falls_back_and_locales():
    llm = FakeLlm([], fail=True)
    assert "शॉर्टलिस्ट" in A7FamilyLiaison(llm).summarise(owner_id="o", locale="hi", items=ITEMS)
    assert "குறுக்குப்பட்டியல்" in A7FamilyLiaison(llm).summarise(owner_id="o", locale="ta", items=ITEMS)
    # unknown locale degrades to English
    out = A7FamilyLiaison(llm).summarise(owner_id="o", locale="fr", items=ITEMS)
    assert out.startswith("Family feedback")


def test_signals_only_payload_no_comments():
    # The payload sent to the LLM contains ONLY candidate ids + signal names.
    llm = FakeLlm([{"text": GOOD}])
    A7FamilyLiaison(llm).summarise(owner_id="o", locale="en", items=ITEMS)
    sent = llm.calls[0]["messages"][0]["content"]
    assert "comment" not in sent
    assert "approve" in sent and "concern" in sent
    assert "c1" in sent


def test_output_filters():
    pii = json.dumps(
        {"model_version": "a7-family-v1", "summary": "Call 9876543210 about this match."}
    )
    llm = FakeLlm([{"text": pii}, {"text": pii}])
    out = A7FamilyLiaison(llm).summarise(owner_id="o", locale="en", items=ITEMS)
    assert "9876543210" not in out

    html = json.dumps({"model_version": "a7-family-v1", "summary": "<b>bold digest</b>"})
    llm2 = FakeLlm([{"text": html}, {"text": html}])
    assert "bold" not in A7FamilyLiaison(llm2).summarise(owner_id="o", locale="en", items=ITEMS)


def test_http_route_service_token_guarded():
    cfg = AgentConfig(
        agent_token_secret="x" * 32,
        core_api_url="http://127.0.0.1:9",
        internal_service_token="t" * 24,
    )
    app = create_app(cfg)
    client = TestClient(app)
    anon = client.post(
        "/internal/family/summarise",
        json={"ownerId": "o", "locale": "en", "items": []},
    )
    assert anon.status_code == 401
    bad = client.post(
        "/internal/family/summarise",
        json={"ownerId": "o", "locale": "en", "items": []},
        headers={"x-internal-token": "wrong"},
    )
    assert bad.status_code == 401
    # With the right token the route runs end to end; the LLM gateway is
    # unreachable (127.0.0.1:9) so the deterministic fallback answers.
    ok = client.post(
        "/internal/family/summarise",
        json={
            "ownerId": "o",
            "locale": "en",
            "items": [{"candidateId": "c1", "signals": ["approve"]}],
        },
        headers={"x-internal-token": "t" * 24},
    )
    assert ok.status_code == 200
    assert "1 approve" in ok.json()["summary"]
