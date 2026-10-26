"""Embedding provider port (P3-01, DESIGN.md §8, D3/rule 13).

Embeddings are built from NORMALISED STRUCTURED SUMMARIES (see summary.py),
never from raw bios. The provider is config-driven; the deterministic
hashing provider exists for tests/CI only and is refused in production by a
guardrail mirroring services/api/src/config.ts (P0-12 rails).
"""

from __future__ import annotations

import hashlib
import math
from typing import Protocol, runtime_checkable

HASHING_MODEL_VERSION = "hash-embed-v1"

EMBEDDING_PROVIDER_NAMES = ("local", "hashing")


class EmbeddingError(Exception):
    """Raised for unknown providers, guardrail violations, and bad input."""


@runtime_checkable
class EmbeddingProvider(Protocol):
    """Structural port: turn a batch of summary texts into vectors."""

    dimensions: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class HashingEmbeddingProvider:
    """Deterministic bag-of-words hashing vectoriser (tests/CI only).

    Tokens are lowercased, whitespace-split, hashed with sha256, mapped into
    ``dimensions`` buckets; the sign comes from a second hash. Vectors are
    L2-normalised. Deterministic across runs and platforms, no third-party
    deps. Never deploy in production (see build_embedding_provider guardrail).
    """

    model_version = HASHING_MODEL_VERSION

    def __init__(self, dimensions: int = 1024) -> None:
        if dimensions <= 0:
            raise EmbeddingError("dimensions must be a positive integer")
        self.dimensions = dimensions

    def _bucket(self, token: str) -> tuple[int, float]:
        token_bytes = token.encode("utf-8")
        index = (
            int.from_bytes(hashlib.sha256(token_bytes).digest()[:8], "big")
            % self.dimensions
        )
        sign = 1.0 if hashlib.sha256(b"sign:" + token_bytes).digest()[0] & 1 else -1.0
        return index, sign

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            tokens = text.lower().split()
            if not tokens:
                raise EmbeddingError("cannot embed empty or whitespace-only text")
            counts = [0.0] * self.dimensions
            for token in tokens:
                index, sign = self._bucket(token)
                counts[index] += sign
            norm = math.sqrt(sum(c * c for c in counts))
            vectors.append([c / norm for c in counts])
        return vectors


class LocalEmbeddingProvider:
    """Real local open-source multilingual model (bge-m3, 1024-dim).

    Placeholder seam for P3-02: config parsing works, but instantiation
    raises until the optional ``[embed]`` extra ships the model runtime.
    """

    model_version = "bge-m3"

    def __init__(self, dimensions: int = 1024) -> None:
        raise EmbeddingError(
            "local embedding provider not installed; "
            "pip install saath-matching[embed] (lands in P3-02)"
        )


def build_embedding_provider(name: str, *, node_env: str) -> EmbeddingProvider:
    """Factory for the configured embedding provider (D3, rule 13)."""
    if node_env == "production" and name == "hashing":
        # Mirrors the P0-12 rails in services/api/src/config.ts: deterministic
        # mocks must never reach prod by misconfiguration.
        raise EmbeddingError(
            "Refusing to boot in production with EMBEDDING_PROVIDER=hashing"
        )
    if name == "hashing":
        return HashingEmbeddingProvider()
    if name == "local":
        return LocalEmbeddingProvider()
    raise EmbeddingError(
        f"Unknown embedding provider: {name!r}; "
        f"expected one of {', '.join(EMBEDDING_PROVIDER_NAMES)}"
    )
