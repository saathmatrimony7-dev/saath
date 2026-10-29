"""A8 Coordinator & Coach package (P4-09, DESIGN.md §6.1 A8)."""

from .engine import (
    AGENT,
    A8Coordinator,
    CoordinatorFacts,
    CoordinatorSuggestion,
    CoordinatorToolsPort,
)
from .tools_client import CoordinatorCoreClient

__all__ = [
    "AGENT",
    "A8Coordinator",
    "CoordinatorCoreClient",
    "CoordinatorFacts",
    "CoordinatorSuggestion",
    "CoordinatorToolsPort",
]
