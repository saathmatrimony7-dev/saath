"""Embedding provider port and normalised summary schema (P3-01)."""

from saath_matching.embeddings.provider import (
    EMBEDDING_PROVIDER_NAMES,
    HASHING_MODEL_VERSION,
    EmbeddingError,
    EmbeddingProvider,
    HashingEmbeddingProvider,
    LocalEmbeddingProvider,
    build_embedding_provider,
)
from saath_matching.embeddings.summary import (
    EmbeddingSummary,
    render_summary_text,
)

__all__ = [
    "EMBEDDING_PROVIDER_NAMES",
    "HASHING_MODEL_VERSION",
    "EmbeddingError",
    "EmbeddingProvider",
    "EmbeddingSummary",
    "HashingEmbeddingProvider",
    "LocalEmbeddingProvider",
    "build_embedding_provider",
    "render_summary_text",
]
