"""A4 explanation generator (P3-09, DESIGN.md §8 step 9 + risk table).

One LLM call per published match (tier mid via the LLM Gateway), with:
  - strict schema (extra=forbid) + the A5/A6 JSON-extraction pattern
  - one repair retry on validation failure
  - factuality post-check: every claim.fact must be in the provided tags
    (Core already restricts those to declared-field positives)
  - output filters: total length cap, no HTML, PII-pattern block
  - deterministic per-locale template fallback on ANY failure — a batch
    must never fail because an explanation could not be generated.

generate() never raises.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from pydantic import ValidationError

from .schema import EXPLANATION_FACT_TAGS, ExplanationsResult

AGENT = "A4-matchmaker"
PROMPT_PATH = Path(__file__).parent / "prompts" / "v1.md"

# Output filter: any of these patterns in the final text forces the
# deterministic fallback (phone-ish digit runs, email, URLs).
_PII_PATTERNS = re.compile(
    r"(\+?\d[\d\s().-]{8,}\d)|([\w.+-]+@[\w-]+(\.[\w-]+)+)|(https?://\S+)|(www\.\S+)"
)


class ExplanationsPort(Protocol):
    """The LLM Gateway client surface (tests fake this)."""

    def complete(
        self,
        *,
        agent: str,
        tier: str,
        messages: list[dict[str, str]],
        acting_for_user_id: str | None = None,
        system: str | None = None,
        max_tokens: int | None = None,
    ) -> dict[str, Any]: ...


@dataclass(frozen=True)
class ExplanationSettings:
    """Config mirror (rule 13). Instantiated from AgentConfig."""

    max_chars: int = 280
    max_claims: int = 3
    max_tokens: int = 220


# Deterministic per-locale fallback templates — generic positives only,
# one sentence per fact tag, no names/places (no label plumbing needed).
_TEMPLATES: dict[str, dict[str, str]] = {
    "en": {
        "SHARED_CITY": "You are both based in the same city.",
        "SHARED_DIET": "You share the same diet.",
        "SHARED_COMMUNITY": "You belong to the same community.",
        "SHARED_RELIGION": "You share the same religion.",
        "BOTH_VERIFIED": "You are both verified members.",
        "BOTH_RECENTLY_ACTIVE": "You have both been active recently.",
    },
    "hi": {
        "SHARED_CITY": "आप दोनों एक ही शहर में रहते हैं।",
        "SHARED_DIET": "आप दोनों की डाइट एक जैसी है।",
        "SHARED_COMMUNITY": "आप दोनों एक ही समुदाय से हैं।",
        "SHARED_RELIGION": "आप दोनों का धर्म एक ही है।",
        "BOTH_VERIFIED": "आप दोनों सत्यापित सदस्य हैं।",
        "BOTH_RECENTLY_ACTIVE": "आप दोनों हाल ही में सक्रिय रहे हैं।",
    },
    "ta": {
        "SHARED_CITY": "இருவரும் ஒரே நகரத்தில் இருக்கிறீர்கள்.",
        "SHARED_DIET": "இருவருக்கும் ஒரே உணவு பழக்கம்.",
        "SHARED_COMMUNITY": "இருவரும் ஒரே சமூகத்தைச் சேர்ந்தவர்கள்.",
        "SHARED_RELIGION": "இருவருக்கும் ஒரே மதம்.",
        "BOTH_VERIFIED": "இருவரும் சரிபார்க்கப்பட்ட உறுப்பினர்கள்.",
        "BOTH_RECENTLY_ACTIVE": "இருவரும் சமீபத்தில் செயலில் இருந்தீர்கள்.",
    },
}


def load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def _extract_json(text: str) -> dict[str, Any]:
    """Fenced ```json block or first { to last } (same rule as A5/A6)."""
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text[text.find("{") : text.rfind("}") + 1]
    return json.loads(candidate)


class ExplanationGenerator:
    def __init__(self, llm: ExplanationsPort, settings: ExplanationSettings | None = None) -> None:
        self._llm = llm
        self._s = settings or ExplanationSettings()

    def generate(self, *, viewer_id: str, locale: str, facts: list[str]) -> str | None:
        """Best-effort explanation text in `locale`, or None (no facts)."""
        allowed = [f for f in facts if f in EXPLANATION_FACT_TAGS]
        if not allowed:
            return None
        locale = locale if locale in _TEMPLATES else "en"
        system = (
            load_prompt()
            .replace("{locale}", locale)
            .replace("{max_claims}", str(self._s.max_claims))
            .replace("{max_chars}", str(self._s.max_chars))
        )
        user_msg = json.dumps({"locale": locale, "facts": allowed}, ensure_ascii=False)
        try:
            resp = self._llm.complete(
                agent=AGENT,
                tier="mid",
                system=system,
                messages=[{"role": "user", "content": user_msg}],
                acting_for_user_id=viewer_id,
                max_tokens=self._s.max_tokens,
            )
            prev = str(resp.get("text", ""))
            text = self._post_check(self._parse(prev), allowed)
            if text is not None:
                return text

            # One repair retry: show the bad answer, demand a strict redo.
            resp2 = self._llm.complete(
                agent=AGENT,
                tier="mid",
                system=system,
                messages=[
                    {"role": "user", "content": user_msg},
                    {"role": "assistant", "content": prev},
                    {
                        "role": "user",
                        "content": (
                            "Your previous answer failed validation (schema, "
                            "unknown fact tag, length limit, or forbidden "
                            "content). Answer again with ONLY the JSON object; "
                            "use facts from the provided list only."
                        ),
                    },
                ],
                acting_for_user_id=viewer_id,
                max_tokens=self._s.max_tokens,
            )
            text = self._post_check(self._parse(str(resp2.get("text", ""))), allowed)
            if text is not None:
                return text
        except Exception:
            pass  # transport/budget/parse errors all fall back
        return self._fallback(allowed, locale)

    def _parse(self, text: str) -> ExplanationsResult | None:
        try:
            data = _extract_json(text)
            result = ExplanationsResult.model_validate(data)
        except (ValidationError, ValueError, json.JSONDecodeError):
            return None
        return result

    def _post_check(self, result: ExplanationsResult | None, allowed: list[str]) -> str | None:
        if result is None:
            return None
        claims = result.claims[: self._s.max_claims]
        if not claims:
            return None
        # Factuality: every claim maps to a provided field (risk table).
        if any(c.fact not in allowed for c in claims):
            return None
        joined = " ".join(c.text.strip() for c in claims)
        if len(joined) > self._s.max_chars:
            return None
        if "<" in joined or ">" in joined:  # rendered as text, never HTML
            return None
        if _PII_PATTERNS.search(joined):
            return None
        return joined

    def _fallback(self, allowed: list[str], locale: str) -> str | None:
        templates = _TEMPLATES[locale]
        sentences = [templates[f] for f in allowed if f in templates][:2]
        return " ".join(sentences) if sentences else None


__all__ = [
    "AGENT",
    "ExplanationGenerator",
    "ExplanationSettings",
    "ExplanationsPort",
    "load_prompt",
]
