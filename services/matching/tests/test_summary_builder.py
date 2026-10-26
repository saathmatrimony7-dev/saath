"""P3-02 tests: ProfileSnapshot schema, summary builder, embed_snapshot."""

import hashlib
import math
import uuid

import pytest
from pydantic import ValidationError

from saath_matching import (
    EmbeddingError,
    EmbeddingResult,
    EmbeddingSummary,
    ProfileSnapshot,
    build_summary,
    embed_snapshot,
)
from saath_matching.embeddings import HASHING_MODEL_VERSION, HashingEmbeddingProvider
from saath_matching.embeddings.summary import render_summary_text


def _valid_kwargs():
    return {
        "user_id": str(uuid.uuid4()),
        "profile_version": 3,
        "pref_version": 2,
        "display_name": "Asha",
        "about_normalised": "Loves trekking and classical music",
        "profession": "software engineer",
        "education_level": "masters",
        "diet": "veg",
        "marital_status": "never_married",
        "city_label": "pune",
        "religion_label": "hindu",
        "community_label": "maratha",
        "attributes": {"personality": "introvert", "hobby": "trekking"},
        "stances": ["family_time_over_career"],
        "preferences": ["diet_ok:veg"],
    }


class TestProfileSnapshot:
    def test_valid_snapshot(self):
        snap = ProfileSnapshot(**_valid_kwargs())
        assert snap.display_name == "Asha"
        assert snap.profile_version == 3

    def test_extra_field_rejected(self):
        with pytest.raises(ValidationError):
            ProfileSnapshot(**_valid_kwargs(), transcript="raw user chat text")

    def test_free_text_transcript_cannot_exist(self):
        # Rule 6 type-level guard: no transcript/bio/chat field on the schema.
        for forbidden in ("transcript", "raw_bio", "chat", "user_text", "messages"):
            assert forbidden not in ProfileSnapshot.model_fields

    def test_bad_user_id_rejected(self):
        kwargs = _valid_kwargs()
        kwargs["user_id"] = "not-a-uuid"
        with pytest.raises(ValidationError):
            ProfileSnapshot(**kwargs)

    def test_control_char_in_label_rejected(self):
        kwargs = _valid_kwargs()
        kwargs["city_label"] = "pune\ninjected: value"
        with pytest.raises(ValidationError):
            ProfileSnapshot(**kwargs)

    def test_oversized_display_name_rejected(self):
        kwargs = _valid_kwargs()
        kwargs["display_name"] = "x" * 81
        with pytest.raises(ValidationError):
            ProfileSnapshot(**kwargs)

    def test_oversized_about_rejected(self):
        kwargs = _valid_kwargs()
        kwargs["about_normalised"] = "x" * 501
        with pytest.raises(ValidationError):
            ProfileSnapshot(**kwargs)

    def test_bad_attribute_key_rejected(self):
        kwargs = _valid_kwargs()
        kwargs["attributes"] = {"Bad Key": "value"}
        with pytest.raises(ValidationError):
            ProfileSnapshot(**kwargs)

    def test_too_many_stances_rejected(self):
        kwargs = _valid_kwargs()
        kwargs["stances"] = [f"stance_{i}" for i in range(11)]
        with pytest.raises(ValidationError):
            ProfileSnapshot(**kwargs)

    def test_oversized_preference_rejected(self):
        kwargs = _valid_kwargs()
        kwargs["preferences"] = ["x" * 121]
        with pytest.raises(ValidationError):
            ProfileSnapshot(**kwargs)

    def test_version_zero_rejected(self):
        kwargs = _valid_kwargs()
        kwargs["profile_version"] = 0
        with pytest.raises(ValidationError):
            ProfileSnapshot(**kwargs)


class TestBuildSummary:
    def test_maps_allow_listed_fields(self):
        snap = ProfileSnapshot(**_valid_kwargs())
        summary = build_summary(snap)
        assert summary.display_name == "Asha"
        assert summary.city == "pune"
        assert summary.attributes == {"personality": "introvert", "hobby": "trekking"}
        assert summary.stances == ["family_time_over_career"]
        assert summary.preferences == ["diet_ok:veg"]
        assert isinstance(summary, EmbeddingSummary)

    def test_religion_and_community_labels_not_embedded(self):
        # User-declared filters only (rule 10); they are not embedding inputs.
        snap = ProfileSnapshot(**_valid_kwargs())
        summary = build_summary(snap)
        assert summary.display_name == "Asha"
        rendered = render_summary_text(summary)
        assert "hindu" not in rendered
        assert "maratha" not in rendered

    def test_rejects_control_char_via_summary_validation(self):
        snap = ProfileSnapshot(**_valid_kwargs())
        summary = build_summary(snap)
        with pytest.raises(ValidationError):
            EmbeddingSummary(
                **{**summary.model_dump(), "about_normalised": "a\nb"}
            )


class TestEmbedSnapshot:
    def test_happy_path(self):
        snap = ProfileSnapshot(**_valid_kwargs())
        provider = HashingEmbeddingProvider()
        result = embed_snapshot(snap, provider)
        assert isinstance(result, EmbeddingResult)
        assert result.user_id == str(snap.user_id)
        assert len(result.vector) == provider.dimensions
        assert result.model_version == HASHING_MODEL_VERSION
        assert result.profile_version == 3
        assert result.pref_version == 2
        norm = math.sqrt(sum(x * x for x in result.vector))
        assert norm == pytest.approx(1.0)

    def test_summary_hash_is_sha256_of_rendered_text(self):
        snap = ProfileSnapshot(**_valid_kwargs())
        provider = HashingEmbeddingProvider()
        result = embed_snapshot(snap, provider)
        text = render_summary_text(build_summary(snap))
        assert result.summary_hash == hashlib.sha256(text.encode("utf-8")).hexdigest()
        assert len(result.summary_hash) == 64

    def test_hash_stable_across_runs(self):
        kwargs = _valid_kwargs()
        provider = HashingEmbeddingProvider()
        first = embed_snapshot(ProfileSnapshot(**kwargs), provider)
        second = embed_snapshot(ProfileSnapshot(**kwargs), provider)
        assert first.summary_hash == second.summary_hash
        assert first.vector == second.vector

    def test_hash_changes_with_content(self):
        kwargs = _valid_kwargs()
        provider = HashingEmbeddingProvider()
        base = embed_snapshot(ProfileSnapshot(**kwargs), provider)
        changed = _valid_kwargs()
        changed["about_normalised"] = "Different normalised text entirely"
        other = embed_snapshot(ProfileSnapshot(**changed), provider)
        assert base.summary_hash != other.summary_hash

    def test_empty_snapshot_refused_by_provider(self):
        # An all-empty snapshot renders to empty text; the provider port
        # refuses to embed nothing (Core must send normalised content).
        snap = ProfileSnapshot(user_id=uuid.uuid4(), profile_version=1, pref_version=1)
        with pytest.raises(EmbeddingError):
            embed_snapshot(snap, HashingEmbeddingProvider())
