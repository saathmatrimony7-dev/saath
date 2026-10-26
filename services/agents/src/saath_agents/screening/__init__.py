"""A5/A6 screening package (P3-05, DESIGN.md §7)."""

from .advocate import A5Advocate, AdvocateError, load_prompt
from .broker import (
    A6ScreeningBroker,
    BrokerError,
    ScreeningThresholds,
    ScreeningToolsPort,
    combine_topic_results,
    combine_verdict,
    inputs_hash,
)
from .tools_client import ScreeningCoreClient

__all__ = [
    "A5Advocate",
    "A6ScreeningBroker",
    "AdvocateError",
    "BrokerError",
    "ScreeningCoreClient",
    "ScreeningThresholds",
    "ScreeningToolsPort",
    "combine_topic_results",
    "combine_verdict",
    "inputs_hash",
    "load_prompt",
]
