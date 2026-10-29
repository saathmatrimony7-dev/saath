"""A7 Family Liaison (P3-10, DESIGN.md §6 A7).

Summarises structured family feedback (signal counts per shortlisted
candidate) for the owner in their language. STRICTLY signals-only — no
comments or other C4 material ever enter the LLM payload. Mid tier via
the LLM Gateway, strict schema, deterministic per-locale fallback.
"""

from .engine import A7FamilyLiaison, FamilyLlmPort, FamilySettings
from .schemas import (
    FAMILY_SUMMARY_MODEL_VERSION,
    FamilySignalItem,
    FamilySummaryResult,
)

__all__ = [
    "A7FamilyLiaison",
    "FAMILY_SUMMARY_MODEL_VERSION",
    "FamilyLlmPort",
    "FamilySettings",
    "FamilySignalItem",
    "FamilySummaryResult",
]
