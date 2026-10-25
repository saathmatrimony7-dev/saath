"""A9 Safety & Moderation classifier (P2-05, DESIGN.md A6/A9).

Classifies user-generated text (chat — P4 — and report details today) into a
closed label set with confidence. Strict Pydantic boundary: no caller content
ever crosses back (only labels + short signal keywords), no prose echoes.
"""

from .classifier import A9Classifier, MAX_TEXT_CHARS, ModerationError
from .schema import LABELS, ModerationVerdict

__all__ = [
    "A9Classifier",
    "LABELS",
    "MAX_TEXT_CHARS",
    "ModerationError",
    "ModerationVerdict",
]
