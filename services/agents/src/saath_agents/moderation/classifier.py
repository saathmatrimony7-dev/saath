"""A9 classifier engine (P2-05).

Text in → ModerationVerdict out, one gateway call (tier small per DESIGN),
one repair retry on invalid output. Input is bounded (cost abuse, T12); all
LLM traffic goes through the gateway client port (rule 4).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Protocol

from pydantic import ValidationError

from .schema import MODEL_VERSION, ModerationVerdict

PROMPT_PATH = Path(__file__).parent / "prompts" / "v1.md"
MAX_TEXT_CHARS = 2000

_SCHEMA_BRIEF = (
    "JSON schema (extra keys rejected): "
    '{"label": one of safe | money_request | off_platform_pressure | '
    'scam_script | harassment | sexual_content, "confidence": 0..1, '
    '"signals": [short lowercase keywords, max 5], '
    f'"model_version": "{MODEL_VERSION}"}} '
    "Output the JSON object only."
)


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


class ModerationError(Exception):
    """The model failed to produce a schema-valid verdict after retries."""


def load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def _extract_json(text: str) -> str:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        return fence.group(1)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ModerationError("no JSON object in model output")
    return text[start : end + 1]


class A9Classifier:
    def __init__(self, llm: LlmPort, max_retries: int = 1) -> None:
        self._llm = llm
        self._max_retries = max_retries

    def classify(self, text: str) -> ModerationVerdict:
        if not text.strip():
            raise ModerationError("empty text")
        bounded = text[:MAX_TEXT_CHARS]
        user_msg = f"Classify this user-generated text:\n{bounded}\n\n{_SCHEMA_BRIEF}"
        system = load_prompt()

        last_err: Exception | None = None
        for attempt in range(self._max_retries + 1):
            try:
                res = self._llm.complete(
                    agent="A9-moderation",
                    tier="small",
                    messages=[{"role": "user", "content": user_msg}],
                    system=system,
                    max_tokens=300,
                )
                data = json.loads(_extract_json(str(res.get("text", ""))))
                return ModerationVerdict.model_validate(data)
            except (ValidationError, json.JSONDecodeError, ModerationError) as exc:
                last_err = exc
                if attempt < self._max_retries:
                    user_msg += (
                        "\n\nYour previous output failed validation: "
                        f"{type(exc).__name__}. Return ONLY the corrected JSON object."
                    )
        raise ModerationError(f"moderation failed after retries: {last_err}")


__all__ = ["A9Classifier", "ModerationError", "load_prompt", "MAX_TEXT_CHARS", "MODEL_VERSION"]
