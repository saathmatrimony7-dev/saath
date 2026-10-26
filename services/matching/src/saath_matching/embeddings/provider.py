"""Embedding provider port (P3-01, DESIGN.md §8, D3/rule 13).

Embeddings are built from NORMALISED STRUCTURED SUMMARIES (see summary.py),
never from raw bios. The provider is config-driven; the deterministic
hashing provider exists for tests/CI only and is refused in production by a
guardrail mirroring services/api/src/config.ts (P0-12 rails).
"""

from __future__ import annotations

import hashlib
import math
import os
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
    """Real local open-source multilingual model (bge-m3, 1024-dim, P3-02).

    Runs fully on-prem (data residency, ADR-0012/D3). The heavy
    ``sentence-transformers`` runtime is an optional ``[embed]`` extra and is
    lazy-imported so the base venv and the test suite stay light; without it,
    instantiation raises an EmbeddingError with install instructions.
    Batch embeddings via SentenceTransformer.encode; mean-pooling is handled
    by the library; ``normalize_embeddings=True`` L2-normalises the outputs.
    Deterministic given the model weights.
    """

    def __init__(
        self, dimensions: int = 1024, model: str | None = None
    ) -> None:
        if dimensions <= 0:
            raise EmbeddingError("dimensions must be a positive integer")
        self.model_name = model or os.environ.get("EMBEDDING_MODEL", "BAAI/bge-m3")
        self.dimensions = dimensions
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise EmbeddingError(
                "local embedding provider not installed; "
                "install with: uv pip install 'saath-matching[embed]'"
            ) from exc
        self._model = SentenceTransformer(self.model_name)

    @property
    def model_version(self) -> str:
        return self.model_name

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        encoded = self._model.encode(
            texts, normalize_embeddings=True, convert_to_numpy=True
        )
        vectors = encoded.tolist()
        for vector in vectors:
            if len(vector) != self.dimensions:
                raise EmbeddingError(
                    f"model returned {len(vector)} dimensions; "
                    f"expected {self.dimensions}"
                )
        return vectors


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
