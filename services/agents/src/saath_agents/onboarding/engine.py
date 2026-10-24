"""A1 Onboarding Interviewer — interview state machine (P1-06, DESIGN.md A6.1).

The engine is deliberately transport-agnostic: it talks to an LLM through a
port (the LLM Gateway client in production, a scripted mock in tests) and to
Core through a tools port (scoped tokens only). Versioned prompt files live in
prompts/; PROMPT_VERSION tracks the active set.

Guarantees enforced HERE (not prompt-faith):
- every assistant reply carries the literal "[AI] " label;
- the interview stops at max_turns with an awaiting_confirm summary;
- nothing is "live" — the profile publishes only via Core's confirm endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

PROMPT_VERSION = "v1"
PROMPT_DIR = Path(__file__).parent / "prompts"
AI_LABEL = "[AI] "
LOCALES = ("en", "hi", "ta")
DEFAULT_MAX_TURNS = 25


class LlmPort(Protocol):
    def complete(
        self,
        *,
        agent: str,
        tier: str,
        messages: list[dict[str, str]],
        acting_for_user_id: str | None = None,
        system: str | None = None,
    ) -> dict[str, Any]: ...


class ToolsPort(Protocol):
    def get_attribute_definitions(
        self, user_id: str = "", community: str | None = None
    ) -> list[dict[str, Any]]: ...

    def save_profile_fields(self, user_id: str, fields: dict[str, Any]) -> None: ...

    def save_dealbreakers(self, user_id: str, dealbreakers: list[dict[str, Any]]) -> None: ...


@dataclass
class InterviewState:
    """Everything needed to resume an interview; stored by the caller (Core)."""

    session_id: str
    user_id: str
    locale: str = "en"
    turn_count: int = 0
    history: list[dict[str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class TurnOutput:
    reply_text: str  # always AI-labelled
    status: str  # "in_progress" | "awaiting_confirm"


def load_system_prompt(locale: str) -> str:
    if locale not in LOCALES:
        locale = "en"
    return (PROMPT_DIR / f"{PROMPT_VERSION}_{locale}.md").read_text(encoding="utf-8")


def greeting(locale: str) -> str:
    greetings = {
        "en": "Namaste! I am your Saath onboarding assistant. Shall we begin with a little about you?",
        "hi": "नमस्ते! मैं आपकी साथ ऑनबोर्डिंग सहायक हूँ। क्या हम आपके बारे में थोड़ी बात से शुरुआत करें?",
        "ta": "வணக்கம்! நான் உங்கள் சாத் உதவியாளர். உங்கள் பற்றி சிறிது பேசுவதில் தொடங்கலாமா?",
    }
    return AI_LABEL + greetings.get(locale, greetings["en"])


class A1OnboardingEngine:
    def __init__(self, llm: LlmPort, tools: ToolsPort, max_turns: int = DEFAULT_MAX_TURNS) -> None:
        self._llm = llm
        self._tools = tools
        self._max_turns = max_turns

    def take_turn(self, state: InterviewState, user_text: str) -> TurnOutput:
        state.history.append({"role": "user", "content": user_text})
        final_turn = state.turn_count + 1 >= self._max_turns

        system = load_system_prompt(state.locale)
        if final_turn:
            system += (
                "\n\nWRAP UP NOW: the interview turn limit is reached. Thank the user, "
                "summarise what you collected, and ask them to review and confirm "
                "their profile. Ask no further questions."
                if state.locale == "en"
                else "\n\nअब समाप्त करें: बारी सीमा पूरी हुई। उपयोगकर्ता को धन्यवाद दें, "
                "इकट्ठी जानकारी का सार बताएँ और प्रोफ़ाइल की समीक्षा व पुष्टि करने को कहें। "
                "कोई नया सवाल न पूछें।"
            )

        res = self._llm.complete(
            agent="A1-onboarding",
            tier="mid",
            messages=state.history,
            acting_for_user_id=state.user_id,
            system=system,
        )
        reply = str(res.get("text", "")).strip()
        if not reply.startswith(AI_LABEL):
            reply = AI_LABEL + reply
        state.history.append({"role": "assistant", "content": reply})
        state.turn_count += 1

        status = "awaiting_confirm" if final_turn else "in_progress"
        return TurnOutput(reply_text=reply, status=status)
