"""A4 "why this match" explanations (P3-09, DESIGN.md §8 step 9).

Strict-schema LLM generation (tier mid via the LLM Gateway) over a
closed-vocabulary fact bundle of declared-field positives only, with a
deterministic per-locale template fallback. Generation never fails the
nightly batch: every failure mode degrades to the fallback or no text.
"""

from .generator import ExplanationGenerator, ExplanationSettings, ExplanationsPort
from .schema import EXPLANATION_FACT_TAGS, EXPLANATION_MODEL_VERSION, ExplanationsResult

__all__ = [
    "EXPLANATION_FACT_TAGS",
    "EXPLANATION_MODEL_VERSION",
    "ExplanationGenerator",
    "ExplanationSettings",
    "ExplanationsPort",
    "ExplanationsResult",
]
