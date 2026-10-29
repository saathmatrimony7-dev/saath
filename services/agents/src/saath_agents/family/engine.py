"""A7 Family Liaison engine (P3-10, DESIGN.md §6 A7).

Mid-tier LLM digest over STRUCTURED SIGNALS ONLY (no comments — no C4
material ever crosses to the LLM), strict output schema, one repair
retry, deterministic per-locale template fallback. summarise() never
raises; callers get a usable digest or the fallback text.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from pydantic import ValidationError

from .schemas import FAMILY_SUMMARY_MODEL_VERSION, FamilySummaryResult, FamilySignalItem

AGENT = "A7-family"
PROMPT_PATH = Path(__file__).parent / "prompts" / "v1.md"

_PII = re.compile(r"(\+?\d[\d\s().-]{8,}\d)|([\w.+-]+@[\w-]+(\.[\w-]+)+)|(https?://\S+)|(www\.\S+)")


class FamilyLlmPort(Protocol):
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
class FamilySettings:
    max_chars: int = 400
    max_tokens: int = 300


_FALLBACK: dict[str, str] = {
    "en": "Family feedback across {profiles} shortlisted profile(s): {parts}.",
    "hi": "{profiles} शॉर्टलिस्ट की गई प्रोफ़ाइल पर पारिवारिक प्रतिक्रिया: {parts}।",
    "ta": "{profiles} குறுக்குப்பட்டியல் சுயவிவரங்களில் குடும்ப கருத்து: {parts}.",
}


def load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def _extract_json(text: str) -> dict[str, Any]:
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text[text.find("{") : text.rfind("}") + 1]
    return json.loads(candidate)


class A7FamilyLiaison:
    def __init__(self, llm: FamilyLlmPort, settings: FamilySettings | None = None) -> None:
        self._llm = llm
        self._s = settings or FamilySettings()

    def summarise(
        self,
        *,
        owner_id: str,
        locale: str,
        items: list[FamilySignalItem],
    ) -> str:
        locale = locale if locale in _FALLBACK else "en"
        system = (
            load_prompt().replace("{locale}", locale).replace("{max_chars}", str(self._s.max_chars))
        )
        payload = json.dumps(
            {
                "locale": locale,
                "items": [
                    {"candidateId": i.candidateId, "signals": list(i.signals)} for i in items
                ],
            },
            ensure_ascii=False,
        )
        try:
            resp = self._llm.complete(
                agent=AGENT,
                tier="mid",
                system=system,
                messages=[{"role": "user", "content": payload}],
                acting_for_user_id=owner_id,
                max_tokens=self._s.max_tokens,
            )
            prev = str(resp.get("text", ""))
            text = self._post_check(self._parse(prev))
            if text is not None:
                return text

            resp2 = self._llm.complete(
                agent=AGENT,
                tier="mid",
                system=system,
                messages=[
                    {"role": "user", "content": payload},
                    {"role": "assistant", "content": prev},
                    {
                        "role": "user",
                        "content": (
                            "Your previous answer failed validation. Answer again with ONLY "
                            "the JSON object, using only the provided signals."
                        ),
                    },
                ],
                acting_for_user_id=owner_id,
                max_tokens=self._s.max_tokens,
            )
            text = self._post_check(self._parse(str(resp2.get("text", ""))))
            if text is not None:
                return text
        except Exception:
            pass
        return self._fallback(locale, items)

    def _parse(self, text: str) -> FamilySummaryResult | None:
        try:
            return FamilySummaryResult.model_validate(_extract_json(text))
        except (ValidationError, ValueError, json.JSONDecodeError):
            return None

    def _post_check(self, result: FamilySummaryResult | None) -> str | None:
        if result is None:
            return None
        summary = result.summary.strip()
        if result.model_version != FAMILY_SUMMARY_MODEL_VERSION:
            return None
        if len(summary) > self._s.max_chars:
            return None
        if "<" in summary or ">" in summary:
            return None
        if _PII.search(summary):
            return None
        return summary

    def _fallback(self, locale: str, items: list[FamilySignalItem]) -> str:
        counts: dict[str, int] = {}
        for item in items:
            for s in item.signals:
                counts[s] = counts.get(s, 0) + 1
        parts = (
            ", ".join(f"{n} {s}" for s, n in sorted(counts.items())) or "no signals yet"
        )
        return _FALLBACK[locale].format(profiles=len(items), parts=parts)


__all__ = [
    "AGENT",
    "A7FamilyLiaison",
    "FamilyLlmPort",
    "FamilySettings",
    "load_prompt",
]
