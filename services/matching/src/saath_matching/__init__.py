"""Saath matching pipeline: retrieval, ranking, nightly batch (DESIGN.md §8)."""

from saath_matching.embeddings import (
    EmbeddingError,
    EmbeddingProvider,
    EmbeddingSummary,
    build_embedding_provider,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "EmbeddingError",
    "EmbeddingProvider",
    "EmbeddingSummary",
    "build_embedding_provider",
]
