"""Env-based config loader for the matching service (D3, rule 13).

Validation of the production guardrail (deterministic hashing provider must
not run in production) lives in embeddings/provider.py's factory, mirroring
services/agents/src/saath_agents/config.py and services/api/src/config.ts.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

from saath_matching.embeddings.provider import EMBEDDING_PROVIDER_NAMES


@dataclass(frozen=True)
class MatchingConfig:
    embedding_provider: str
    embedding_dimensions: int
    node_env: str


def load_config(env: Mapping[str, str] | None = None) -> MatchingConfig:
    source = os.environ if env is None else env
    provider = source.get("EMBEDDING_PROVIDER", "hashing")
    dimensions_raw = source.get("EMBEDDING_DIMENSIONS", "1024")
    node_env = source.get("NODE_ENV", "development")

    if provider not in EMBEDDING_PROVIDER_NAMES:
        raise ValueError(
            f"EMBEDDING_PROVIDER must be one of {', '.join(EMBEDDING_PROVIDER_NAMES)}"
        )
    try:
        dimensions = int(dimensions_raw)
    except ValueError as exc:
        raise ValueError("EMBEDDING_DIMENSIONS must be an integer") from exc
    if dimensions <= 0:
        raise ValueError("EMBEDDING_DIMENSIONS must be a positive integer")

    return MatchingConfig(
        embedding_provider=provider,
        embedding_dimensions=dimensions,
        node_env=node_env,
    )
