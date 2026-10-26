"""Snapshot -> summary -> embedding (P3-02, DESIGN.md §8).

``build_summary`` maps only the allow-listed fields of a Core ``ProfileSnapshot``
into the P3-01 ``EmbeddingSummary`` (rule 6: no raw user text anywhere).
``embed_snapshot`` renders the stable summary text, hashes it (provenance), and
embeds it through the configured provider port.
"""

from __future__ import annotations

import hashlib

from pydantic import BaseModel, ConfigDict

from saath_matching.embeddings.provider import EmbeddingError, EmbeddingProvider
from saath_matching.embeddings.summary import EmbeddingSummary, render_summary_text
from saath_matching.snapshots import ProfileSnapshot


class EmbeddingResult(BaseModel):
    """Provenance-carrying embedding result returned to Core."""

    model_config = ConfigDict(extra="forbid")

    user_id: str
    vector: list[float]
    summary_hash: str
    model_version: str
    profile_version: int
    pref_version: int


def build_summary(snapshot: ProfileSnapshot) -> EmbeddingSummary:
    """Map the allow-listed snapshot fields into the EmbeddingSummary schema.

    ``religion_label``/``community_label`` are accepted on the snapshot (Core
    sends them for taxonomy context) but are NOT embedding inputs — the
    EmbeddingSummary allow-list (P3-01) has no fields for them and DESIGN.md
    rule 10 keeps them as user-declared filters only.
    """
    return EmbeddingSummary(
        display_name=snapshot.display_name,
        about_normalised=snapshot.about_normalised,
        profession=snapshot.profession,
        education_level=snapshot.education_level,
        city=snapshot.city_label,
        diet=snapshot.diet,
        marital_status=snapshot.marital_status,
        attributes=dict(snapshot.attributes),
        stances=list(snapshot.stances),
        preferences=list(snapshot.preferences),
    )


def embed_snapshot(
    snapshot: ProfileSnapshot, provider: EmbeddingProvider
) -> EmbeddingResult:
    """Render, hash and embed one snapshot through the provider port."""
    text = render_summary_text(build_summary(snapshot))
    summary_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    vector = provider.embed([text])[0]
    if len(vector) != provider.dimensions:
        raise EmbeddingError(
            f"provider returned {len(vector)} dimensions; "
            f"expected {provider.dimensions}"
        )
    return EmbeddingResult(
        user_id=str(snapshot.user_id),
        vector=list(vector),
        summary_hash=summary_hash,
        model_version=str(getattr(provider, "model_version", "unknown")),
        profile_version=snapshot.profile_version,
        pref_version=snapshot.pref_version,
    )
