"""A8 coordinator tests (P4-09, DESIGN.md §6.1 A8).

Covers the suggest-only contract: icebreakers derive from closed-vocabulary
conversation facts (never chat bodies), and every tool call is bound to the
caller's own user — the agent has no path to the other participant.
"""

from __future__ import annotations

import base64
import json

import pytest
from fastapi.testclient import TestClient

from saath_agents.config import AgentConfig
from saath_agents.coordinator import (
    AGENT,
    A8Coordinator,
    CoordinatorCoreClient,
    CoordinatorFacts,
)
from saath_agents.main import create_app


class FakeTools:
    """Records tool calls; stands in for the Core tools surface."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple]] = []

    def propose_slots(self, user_id, conversation_id, slots):
        self.calls.append(("propose_slots", (user_id, conversation_id, tuple(slots))))
        return {"proposed": len(slots)}

    def send_nudge(self, user_id, conversation_id):
        self.calls.append(("send_nudge", (user_id, conversation_id)))
        return {"delivered": True, "reason": None}

    def record_meeting_feedback(self, user_id, conversation_id, outcome, notes=None):
        self.calls.append(("record_meeting_feedback", (user_id, conversation_id, outcome, notes)))
        return {"recorded": True}


def test_suggest_is_deterministic_and_locale_aware():
    coordinator = A8Coordinator()
    en = coordinator.suggest("en")
    again = coordinator.suggest("en")
    assert en.icebreakers == again.icebreakers
    assert len(en.icebreakers) == 3
    hi = coordinator.suggest("hi")
    assert hi.icebreakers[0] != en.icebreakers[0]


def test_intro_origin_prefixes_an_intro_icebreaker():
    suggestion = A8Coordinator().suggest("en", CoordinatorFacts(origin="intro"))
    assert len(suggestion.icebreakers) == 4
    assert "Introduce yourself" in suggestion.icebreakers[0]


def test_contact_shared_adds_a_contact_hint():
    suggestion = A8Coordinator().suggest("en", CoordinatorFacts(contact_shared=True))
    assert any("opted in" in line for line in suggestion.icebreakers)


def test_unknown_locale_falls_back_to_english():
    suggestion = A8Coordinator().suggest("fr")
    assert suggestion.icebreakers[0].startswith("Ask what")


def test_tools_are_called_for_the_callers_own_user_only():
    tools = FakeTools()
    coordinator = A8Coordinator(tools)
    coordinator.propose_slots("user-a", "conv-1", ["2026-11-01T10:00:00Z"])
    coordinator.nudge("user-a", "conv-1")
    coordinator.record_feedback("user-a", "conv-1", "went_well", notes="nice")
    assert [c[0] for c in tools.calls] == [
        "propose_slots",
        "send_nudge",
        "record_meeting_feedback",
    ]
    for _name, args in tools.calls:
        assert args[0] == "user-a"


def test_slot_count_is_bounded():
    with pytest.raises(ValueError):
        A8Coordinator(FakeTools()).propose_slots("u", "c", [])
    with pytest.raises(ValueError):
        A8Coordinator(FakeTools()).propose_slots("u", "c", ["s"] * 6)


def test_feedback_outcome_is_a_closed_vocabulary():
    with pytest.raises(ValueError):
        A8Coordinator(FakeTools()).record_feedback("u", "c", "they_were_rude")


def _cfg() -> AgentConfig:
    return AgentConfig(
        core_api_url="http://core.test",
        internal_service_token="test-internal-token-0123456789",
        agent_token_secret="test-agent-token-hmac-secret",
    )


def test_tools_client_mints_single_tool_tokens():
    import httpx

    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"recorded": True})

    client = CoordinatorCoreClient(_cfg(), http=httpx.Client(transport=httpx.MockTransport(handler)))
    client.send_nudge("user-a", "conv-1")
    assert len(requests) == 1
    req = requests[0]
    assert req.url.path.endswith("/v1/internal/tools/send_nudge")
    token = req.headers["x-agent-token"]
    payload = token.split(".")[0]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    assert claims["agent"] == AGENT
    assert claims["acting_for_user_id"] == "user-a"
    assert claims["tools"] == ["send_nudge"]


def test_suggest_route_requires_service_token():
    client = TestClient(create_app(_cfg()))
    res = client.post(
        "/internal/coordinator/suggest",
        json={"userId": "u", "conversationId": "c"},
    )
    assert res.status_code == 401


def test_suggest_route_returns_suggestions_only():
    client = TestClient(create_app(_cfg()))
    res = client.post(
        "/internal/coordinator/suggest",
        json={"userId": "u", "conversationId": "c", "origin": "intro", "locale": "hi"},
        headers={"x-internal-token": _cfg().internal_service_token},
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body["icebreakers"]) == 4  # intro opener + 3 base (hi)
    assert body["slots"] == []
    assert json.dumps(body)  # plain JSON, no C4 material
