"""A8 Coordinator & Coach (P4-09, DESIGN.md §6.1 A8).

Trigger: mutual interest, stalled chat, meeting booked. Suggests icebreakers,
proposes call/meet slots, sends reminders, collects post-meeting feedback.

Hard contract (DESIGN.md A8 human-in-the-loop): A8 NEVER sends anything to
the other person — its tools write only to its own user's surface:
  - propose_slots            → slot proposal stored for the caller's user
  - send_nudge               → reminder notification to the CALLER's own user
  - record_meeting_feedback  → feedback on the conversation (own side)

The engine works from closed-vocabulary conversation facts only — chat
bodies are C4 and never enter this agent (rule: no raw text crosses).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

AGENT = "A8-coordinator"

ICEBREAKERS: dict[str, list[str]] = {
    "en": [
        "Ask what a perfect weekend looks like for them.",
        "Share the story behind your city — and ask about theirs.",
        "Talk about one family tradition that matters to you.",
    ],
    "hi": [
        "पूछें कि उनके लिए एक परफ़ेक्ट वीकएंड कैसा होता है।",
        "अपने शहर की एक कहानी साझा करें — और उनका शहर पूछें।",
        "अपने परिवार की एक परंपरा के बारे में बताएं जो आपके लिए मायने रखती है।",
    ],
    "ta": [
        "அவர்களுக்கு ஒரு சிறந்த வார இறுதி எப்படி இருக்கும் என்று கேளுங்கள்.",
        "உங்கள் நகரத்தின் கதையைப் பகிர்ந்து கொள்ளுங்கள் — அவர்களுடையதையும் கேளுங்கள்.",
        "உங்கள் குடும்பத்தில் முக்கியமான ஒரு மரபைப் பற்றிப் பேசுங்கள்.",
    ],
}

INTRO_ICEBREAKER = {
    "en": "Introduce yourself and mention what caught your interest.",
    "hi": "अपना परिचय दें और बताएं कि आपका ध्यान क्या आकर्षित करता है।",
    "ta": "உங்களை அறிமுகப்படுத்திக் கொள்ளுங்கள், எது உங்கள் கவனத்தை ஈர்த்தது என்று கூறுங்கள்.",
}

CONTACT_SHARED_ICEBREAKER = {
    "en": "You have both opted in to share contacts — agree on a good time to talk.",
    "hi": "आप दोनों ने संपर्क साझा करने की सहमति दी है — बात करने का अच्छा समय तय करें।",
    "ta": "இருவரும் தொடர்பு பகிர்வதை ஒப்புக்கொண்டீர்கள் — பேச ஒரு நல்ல நேரம் ஒத்துவையுங்கள்.",
}


class CoordinatorToolsPort(Protocol):
    """A8's ONLY way to touch data — the Core /internal/tools/* surface."""

    def propose_slots(self, user_id: str, conversation_id: str, slots: list[str]) -> dict[str, Any]: ...

    def send_nudge(self, user_id: str, conversation_id: str) -> dict[str, Any]: ...

    def record_meeting_feedback(
        self, user_id: str, conversation_id: str, outcome: str, notes: str | None = None
    ) -> dict[str, Any]: ...


@dataclass
class CoordinatorSuggestion:
    icebreakers: list[str]
    slots: list[str] = field(default_factory=list)


@dataclass
class CoordinatorFacts:
    """Closed-vocabulary conversation facts (no chat bodies — C4 stays in Core)."""

    origin: str = "mutual"  # mutual | intro
    contact_shared: bool = False
    stalled_days: int = 0


class A8Coordinator:
    """Suggest-only coordinator. Deterministic icebreakers keep tests and the
    mock transport LLM-free; the mid-tier LLM pass (warmer, context-aware
    openers) is deliberately left for the polish pass."""

    AGENT = AGENT

    def __init__(self, tools: CoordinatorToolsPort | None = None) -> None:
        # `suggest()` is tool-free; the tool-using flows assert a port exists.
        self._tools = tools

    def suggest(self, locale: str = "en", facts: CoordinatorFacts | None = None) -> CoordinatorSuggestion:
        lang = locale if locale in ICEBREAKERS else "en"
        facts = facts or CoordinatorFacts()
        icebreakers: list[str] = []
        if facts.origin == "intro":
            icebreakers.append(INTRO_ICEBREAKER[lang])
        icebreakers.extend(ICEBREAKERS[lang])
        if facts.contact_shared:
            icebreakers.append(CONTACT_SHARED_ICEBREAKER[lang])
        return CoordinatorSuggestion(icebreakers=icebreakers, slots=[])

    def _require_tools(self) -> CoordinatorToolsPort:
        if self._tools is None:
            raise RuntimeError("A8 tools port not configured")
        return self._tools

    def propose_slots(self, user_id: str, conversation_id: str, slots: list[str]) -> dict[str, Any]:
        if not 1 <= len(slots) <= 5:
            raise ValueError("between 1 and 5 slots")
        return self._require_tools().propose_slots(user_id, conversation_id, slots)

    def nudge(self, user_id: str, conversation_id: str) -> dict[str, Any]:
        return self._require_tools().send_nudge(user_id, conversation_id)

    def record_feedback(
        self, user_id: str, conversation_id: str, outcome: str, notes: str | None = None
    ) -> dict[str, Any]:
        if outcome not in ("went_well", "neutral", "did_not_meet", "not_a_match"):
            raise ValueError("unknown feedback outcome")
        return self._require_tools().record_meeting_feedback(user_id, conversation_id, outcome, notes)


__all__ = [
    "AGENT",
    "A8Coordinator",
    "CoordinatorFacts",
    "CoordinatorSuggestion",
    "CoordinatorToolsPort",
]
