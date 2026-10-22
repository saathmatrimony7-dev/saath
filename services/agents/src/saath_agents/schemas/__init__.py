"""Pydantic I/O schemas — source of truth for agent/tool contracts (§6, §7).

Every agent has a strict input and output schema; free text never crosses
between users (rule 6). Structured screening protocol types live here so the
API (Zod) and agents (Pydantic) share one contract shape.
"""

from .screening import (
    AdvocateTopicAnswer,
    ScreeningVerdict,
    TopicResult,
    Verdict,
)

__all__ = [
    "AdvocateTopicAnswer",
    "ScreeningVerdict",
    "TopicResult",
    "Verdict",
]
