"""Saath matching pipeline: retrieval, ranking, nightly batch (DESIGN.md §8)."""

from saath_matching.embeddings import (
    EmbeddingError,
    EmbeddingProvider,
    EmbeddingSummary,
    build_embedding_provider,
)
from saath_matching.snapshots import ProfileSnapshot
from saath_matching.summary_builder import EmbeddingResult, build_summary, embed_snapshot

__version__ = "0.2.0"

__all__ = [
    "__version__",
    "EmbeddingError",
    "EmbeddingProvider",
    "EmbeddingResult",
    "EmbeddingSummary",
    "ProfileSnapshot",
    "build_embedding_provider",
    "build_summary",
    "embed_snapshot",
]
