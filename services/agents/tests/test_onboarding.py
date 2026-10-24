"""A1 onboarding engine tests (P1-06).

Exit-criterion coverage with a scripted mock LLM (no network, no key):
- full interview completes in English and Hindi (mock replies)
- interview stops at the turn cap with status awaiting_confirm
- EVERY assistant message carries the literal "[AI] " label (enforced in code)
- prompts contain no secrets/policy internals
- turn endpoint is service-token guarded
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from saath_agents.config import AgentConfig
from saath_agents.main import create_app
from saath_agents.onboarding.engine import (
    AI_LABEL,
    PROMPT_DIR,
    A1OnboardingEngine,
    InterviewState,
    greeting,
    load_system_prompt,
)

SECRET = "test-secret-do-not-use-in-prod-0123456789"


class MockLlm:
    """Scripted LLM: records the system prompt, replies per call index."""

    def __init__(self, replies: list[str]) -> None:
        self.replies = replies
        self.calls: list[dict] = []

    def complete(self, *, agent, tier, messages, acting_for_user_id=None, system=None):
        self.calls.append({"agent": agent, "messages": messages, "system": system})
        idx = min(len(self.calls) - 1, len(self.replies) - 1)
        return {"text": self.replies[idx], "model": "mock", "traceId": "t"}


class NoopTools:
    def get_attribute_definitions(self, user_id: str = "", community=None):
        return []

    def save_profile_fields(self, user_id: str, fields) -> None:
        return None

    def save_dealbreakers(self, user_id: str, dealbreakers) -> None:
        return None


EN_REPLIES = [
    "Tell me about your education and profession.",
    "What matters most to you in a partner?",
    "How do you spend your weekends?",
    "Tell me about your family.",
    "Are you open to relocating?",
    "Any firm dealbreakers?",
    "Thank you! Here is a summary of your profile. Please review and confirm.",
]
HI_REPLIES = [
    "अपनी पढ़ाई और पेशे के बारे में बताइए।",
    "जीवनसाथी में आपके लिए सबसे ज़रूरी क्या है?",
    "छुट्टियों में आप कैसे समय बिताते हैं?",
    "अपने परिवार के बारे में बताइए।",
    "क्या आप शहर बदलने को तैयार हैं?",
    "कोई पक्की शर्त?",
    "धन्यवाद! आपकी जानकारी का सार यह रहा। कृपया समीक्षा कर पुष्टि करें।",
]


def run_interview(locale: str, replies: list[str], max_turns: int = 7) -> InterviewState:
    engine = A1OnboardingEngine(llm=MockLlm(replies), tools=NoopTools(), max_turns=max_turns)
    state = InterviewState(session_id="s1", user_id="usr_1", locale=locale)
    answers = {
        "en": "I work as a teacher in Pune.",
        "hi": "मैं पुणे में शिक्षक हूँ।",
        "ta": "நான் ஒரு ஆசிரியர்.",
    }
    while True:
        out = engine.take_turn(state, answers[locale])
        assert out.reply_text.startswith(AI_LABEL)
        assert out.status in ("in_progress", "awaiting_confirm")
        if out.status == "awaiting_confirm":
            return state


def test_full_interview_completes_english():
    state = run_interview("en", EN_REPLIES, max_turns=7)
    assert state.turn_count == 7
    # All assistant turns in the transcript are AI-labelled.
    assistant = [m for m in state.history if m["role"] == "assistant"]
    assert len(assistant) == 7
    assert all(m["content"].startswith(AI_LABEL) for m in assistant)


def test_full_interview_completes_hindi():
    state = run_interview("hi", HI_REPLIES, max_turns=7)
    assert state.turn_count == 7
    assistant = [m for m in state.history if m["role"] == "assistant"]
    assert all(m["content"].startswith(AI_LABEL) for m in assistant)
    # Replies came from the scripted Hindi LLM (non-ASCII content present).
    assert any(not m["content"].isascii() for m in assistant)


def test_turn_cap_forces_summary():
    # Even if the LLM keeps asking questions, the engine stops at the cap.
    engine = A1OnboardingEngine(
        llm=MockLlm(["Another question?"] * 30), tools=NoopTools(), max_turns=5
    )
    state = InterviewState(session_id="s1", user_id="usr_1", locale="en")
    status = None
    while status != "awaiting_confirm":
        out = engine.take_turn(state, "answer")
        status = out.status
    assert state.turn_count == 5  # DESIGN.md Q3 cap honoured exactly


def test_label_enforced_when_llm_omits_it():
    engine = A1OnboardingEngine(llm=MockLlm(["No label here."]), tools=NoopTools())
    state = InterviewState(session_id="s1", user_id="usr_1", locale="en")
    out = engine.take_turn(state, "hello")
    assert out.reply_text.startswith(AI_LABEL)


def test_greetings_are_labelled_all_locales():
    for locale, expected in [("en", "Namaste"), ("hi", "नमस्ते"), ("ta", "வணக்கம்")]:
        g = greeting(locale)
        assert g.startswith(AI_LABEL)
        assert expected in g


def test_prompts_contain_no_secrets_or_internal_paths():
    # Secret-shaped values and internal URLs only — the word "password" is
    # expected in the guidance ("never ask for passwords").
    forbidden = re.compile(
        r"(sk-ant|sk_live|ghp_|xox[baprs]-|BEGIN [A-Z ]*PRIVATE KEY|/internal/)"
    )
    for prompt_file in Path(PROMPT_DIR).glob("*.md"):
        content = prompt_file.read_text(encoding="utf-8")
        assert not forbidden.search(content), f"{prompt_file.name} leaks internals"


def test_system_prompt_is_locale_specific():
    assert "Hindi" in load_system_prompt("hi")
    assert "தமிழ்" in load_system_prompt("ta") or "தமிழில்" in load_system_prompt("ta")


def _app_config() -> AgentConfig:
    return AgentConfig(
        agent_token_secret=SECRET,
        core_api_url="http://127.0.0.1:9",  # unreachable: not used by these tests
        internal_service_token="internal-test-token",
    )


def test_turn_endpoint_requires_service_token():
    client = TestClient(create_app(_app_config()))
    body = {
        "sessionId": "s1",
        "userId": "usr_1",
        "locale": "en",
        "turnCount": 0,
        "userText": "hello",
        "history": [],
    }
    assert client.post("/internal/onboarding/turn", json=body).status_code == 401
    assert (
        client.post(
            "/internal/onboarding/turn",
            json=body,
            headers={"x-internal-token": "wrong"},
        ).status_code
        == 401
    )


@pytest.mark.filterwarnings("ignore::DeprecationWarning")
def test_turn_endpoint_accepts_service_token_and_validates_body():
    import httpx

    client = TestClient(create_app(_app_config()))
    # Auth passes → the request reaches the LLM layer, which fails on the
    # unreachable Core URL (raised client-side by TestClient).
    with pytest.raises(httpx.ConnectError):
        client.post(
            "/internal/onboarding/turn",
            json={
                "sessionId": "s1",
                "userId": "usr_1",
                "locale": "en",
                "turnCount": 0,
                "userText": "hello",
                "history": [],
            },
            headers={"x-internal-token": "internal-test-token"},
        )
    bad = client.post(
        "/internal/onboarding/turn",
        json={
            "sessionId": "s1",
            "userId": "usr_1",
            "locale": "en",
            "turnCount": 0,
            "userText": "hello",
            "history": [],
            "injected": True,
        },
        headers={"x-internal-token": "internal-test-token"},
    )
    assert bad.status_code == 422  # extra=forbid
