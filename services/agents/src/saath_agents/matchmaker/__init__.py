"""A4 matchmaker package (P3-07, DESIGN.md §6.1 A4 + §8)."""

from .engine import (
    A4Matchmaker,
    MatchmakerSettings,
    MatchmakerToolsPort,
    apply_exposure_cap,
    settings_from_config,
)
from .tools_client import MatchmakerCoreClient

__all__ = [
    "A4Matchmaker",
    "MatchmakerCoreClient",
    "MatchmakerSettings",
    "MatchmakerToolsPort",
    "apply_exposure_cap",
    "settings_from_config",
]
