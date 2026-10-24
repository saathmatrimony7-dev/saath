"""A2 Profile Extractor engine (P1-07, DESIGN.md A6.2).

Transcript in → ExtractionResult out. One LLM call (tier small per DESIGN);
one repair retry if the model returns invalid JSON. All LLM traffic goes
through the gateway client port (rule 4); the model never sees anything but
the transcript and this prompt.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Protocol

from pydantic import ValidationError

from .schema import ExtractionResult, MODEL_VERSION

PROMPT_PATH = Path(__file__).parent / "prompts" / "v1.md"

# The transcript is trusted service-side data (already stored), but bound it
# anyway so a broken caller cannot blow up the prompt budget.
MAX_TURNS = 200
MAX_TURN_CHARS = 2000


class LlmPort(Protocol):
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


def _drop_bad_dealbreakers(data: dict) -> dict | None:
    """Return a copy with dealbreakers that violate the field-name contract
    removed, or None if nothing changed / structure is unusable."""
    if not isinstance(data, dict) or not isinstance(data.get("dealbreakers"), list):
        return None
    import re

    ok = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
    cleaned = dict(data)
    cleaned["dealbreakers"] = [
        d for d in data["dealbreakers"]
        if isinstance(d, dict) and ok.match(str(d.get("field", "")))
    ]
    return cleaned


class ExtractionError(Exception):
    """The model failed to produce a schema-valid result after retries."""


def load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def _schema_brief() -> str:
    """Compact field list embedded in the user message (the full schema is
    enforced by Pydantic afterwards; this keeps the prompt small)."""

    return (
        "JSON schema (extra keys rejected): "
        '{"profile":{"display_name":v,"about_normalised":v,"height_cm":v,'
        '"marital_status":v,"diet":v,"education_level":v,"profession":v,'
        '"income_band":v,"city_id":v,"willing_to_relocate":v,"religion_id":v,'
        '"community_id":v,"sub_community_id":v,"mother_tongue":v},'
        '"preferences":{"age_min":v,"age_max":v,"height_min":v,"cities":v,'
        '"relocate_ok":v,"open_to_all_communities":v,"diet_ok":v,"marital_ok":v},'
        '"dealbreakers":[{"field":s,"rule":{"op":s,"value":x},"confidence":f}],'
        '"low_confidence_fields":[s],"confirm_questions":[s],'
        '"model_version":"a2-extract-v1"} '
        'where v = {"value": <value or null>, "confidence": <0..1>}. '
        'cities/diet_ok/marital_ok: comma-separated slugs in one value string.'
    )


def _extract_json(text: str) -> str:
    """Tolerates fences/prose around the JSON object."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        return fence.group(1)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ExtractionError("no JSON object in model output")
    return text[start : end + 1]


class A2Extractor:
    def __init__(self, llm: LlmPort, max_retries: int = 1) -> None:
        self._llm = llm
        self._max_retries = max_retries

    def extract(
        self,
        transcript: list[dict[str, str]],
        *,
        acting_for_user_id: str | None = None,
    ) -> ExtractionResult:
        if not transcript or len(transcript) > MAX_TURNS:
            raise ExtractionError("transcript empty or too long")
        lines = [
            f"{m['role']}: {m['content'][:MAX_TURN_CHARS]}" for m in transcript[:MAX_TURNS]
        ]
        user_msg = (
            "Transcript (role: content):\n"
            + "\n".join(lines)
            + "\n\n"
            + _schema_brief()
            + "\n\nExtract now. Output the JSON object only."
        )
        system = load_prompt()

        last_err: Exception | None = None
        for attempt in range(self._max_retries + 1):
            try:
                res = self._llm.complete(
                    agent="A2-extractor",
                    tier="small",
                    messages=[{"role": "user", "content": user_msg}],
                    acting_for_user_id=acting_for_user_id,
                    system=system,
                    max_tokens=4096,  # full-schema JSON needs more than the 1k default
                )
                raw = _extract_json(str(res.get("text", "")))
                data = json.loads(raw)
                try:
                    return ExtractionResult.model_validate(data)
                except ValidationError:
                    # Model emitted a malformed dealbreaker field name etc.:
                    # drop offending dealbreakers and re-validate once.
                    cleaned = _drop_bad_dealbreakers(data)
                    if cleaned is not None and cleaned != data:
                        return ExtractionResult.model_validate(cleaned)
                    raise
            except (ValidationError, json.JSONDecodeError, ExtractionError) as exc:
                last_err = exc
                if attempt < self._max_retries:
                    user_msg += (
                        "\n\nYour previous output failed validation: "
                        f"{type(exc).__name__}. Return ONLY the corrected JSON object."
                    )
        raise ExtractionError(f"extraction failed after retries: {last_err}")


__all__ = ["A2Extractor", "ExtractionError", "load_prompt", "MODEL_VERSION"]
