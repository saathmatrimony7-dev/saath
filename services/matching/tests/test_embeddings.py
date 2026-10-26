"""P3-01 tests: hashing provider, factory guardrails, summary validation."""

import math

import pytest
from pydantic import ValidationError

from saath_matching.embeddings import (
    EMBEDDING_PROVIDER_NAMES,
    HASHING_MODEL_VERSION,
    EmbeddingError,
    EmbeddingProvider,
    EmbeddingSummary,
    HashingEmbeddingProvider,
    build_embedding_provider,
    render_summary_text,
)


class TestHashingEmbeddingProvider:
    def test_deterministic(self):
        provider = HashingEmbeddingProvider()
        a = provider.embed(["Software engineer from Pune, vegetarian"])[0]
        b = provider.embed(["Software engineer from Pune, vegetarian"])[0]
        assert a == b

    def test_dimensions_default_1024(self):
        provider = HashingEmbeddingProvider()
        assert provider.dimensions == 1024
        assert len(provider.embed(["hello world"])[0]) == 1024

    def test_l2_normalised(self):
        provider = HashingEmbeddingProvider()
        for vector in provider.embed(["a b c", "longer text about engineering"]):
            norm = math.sqrt(sum(x * x for x in vector))
            assert norm == pytest.approx(1.0)

    def test_different_texts_different_vectors(self):
        provider = HashingEmbeddingProvider()
        a = provider.embed(["loves hiking and classical music"])[0]
        b = provider.embed(["financial analyst, non vegetarian"])[0]
        assert a != b

    def test_empty_text_raises(self):
        provider = HashingEmbeddingProvider()
        with pytest.raises(EmbeddingError):
            provider.embed([""])
        with pytest.raises(EmbeddingError):
            provider.embed(["   \n\t "])

    def test_batch_embed(self):
        provider = HashingEmbeddingProvider()
        vectors = provider.embed(["one text", "two text", "three text"])
        assert len(vectors) == 3
        assert all(len(v) == 1024 for v in vectors)

    def test_model_version_constant(self):
        assert HashingEmbeddingProvider.model_version == HASHING_MODEL_VERSION
        assert HASHING_MODEL_VERSION == "hash-embed-v1"


class TestFactory:
    def test_unknown_name_raises(self):
        with pytest.raises(EmbeddingError):
            build_embedding_provider("openai", node_env="development")

    def test_production_hashing_refused(self):
        with pytest.raises(EmbeddingError, match="production"):
            build_embedding_provider("hashing", node_env="production")

    def test_development_hashing_ok(self):
        provider = build_embedding_provider("hashing", node_env="development")
        assert isinstance(provider, HashingEmbeddingProvider)

    def test_local_stub_raises_not_installed(self):
        with pytest.raises(EmbeddingError, match="P3-02"):
            build_embedding_provider("local", node_env="production")

    def test_provider_names_constant(self):
        assert EMBEDDING_PROVIDER_NAMES == ("local", "hashing")


class TestEmbeddingSummary:
    def _valid_kwargs(self):
        return {
            "display_name": "Asha",
            "about_normalised": "Loves trekking and classical music",
            "profession": "software engineer",
            "education_level": "masters",
            "city": "pune",
            "diet": "veg",
            "marital_status": "never_married",
            "attributes": {"personality": "introvert", "hobby": "trekking"},
            "stances": ["family_time_over_career"],
            "preferences": ["diet_ok:veg"],
        }

    def test_valid_summary(self):
        summary = EmbeddingSummary(**self._valid_kwargs())
        assert summary.display_name == "Asha"

    def test_extra_field_rejected(self):
        with pytest.raises(ValidationError):
            EmbeddingSummary(**self._valid_kwargs(), raw_bio="hello")

    def test_oversized_about_rejected(self):
        kwargs = self._valid_kwargs()
        kwargs["about_normalised"] = "x" * 501
        with pytest.raises(ValidationError):
            EmbeddingSummary(**kwargs)

    def test_bad_attribute_key_rejected(self):
        kwargs = self._valid_kwargs()
        kwargs["attributes"] = {"Bad Key": "value"}
        with pytest.raises(ValidationError):
            EmbeddingSummary(**kwargs)

    def test_too_many_attributes_rejected(self):
        kwargs = self._valid_kwargs()
        kwargs["attributes"] = {f"attr_{i}": "v" for i in range(21)}
        with pytest.raises(ValidationError):
            EmbeddingSummary(**kwargs)

    def test_oversized_stance_rejected(self):
        kwargs = self._valid_kwargs()
        kwargs["stances"] = ["x" * 201]
        with pytest.raises(ValidationError):
            EmbeddingSummary(**kwargs)

    def test_newline_in_field_rejected(self):
        kwargs = self._valid_kwargs()
        kwargs["about_normalised"] = "line one\nline two"
        with pytest.raises(ValidationError):
            EmbeddingSummary(**kwargs)

    def test_newline_in_stance_rejected(self):
        with pytest.raises(ValidationError):
            EmbeddingSummary(stances=["ok\ninjected: value"])

    def test_newline_in_attribute_value_rejected(self):
        with pytest.raises(ValidationError):
            EmbeddingSummary(attributes={"key": "v1\nv2"})

    def test_render_summary_text_deterministic(self):
        kwargs = self._valid_kwargs()
        first = render_summary_text(EmbeddingSummary(**kwargs))
        second = render_summary_text(EmbeddingSummary(**kwargs))
        assert first == second
        assert "display_name: Asha" in first
        assert "personality=introvert" in first
        # Newline-joined "key: value" lines only — no blank/injected lines.
        for line in first.split("\n"):
            assert ": " in line

    def test_render_omits_empty_fields(self):
        text = render_summary_text(EmbeddingSummary(display_name="Asha"))
        assert text == "display_name: Asha"


class TestProtocolConformance:
    def test_hashing_provider_satisfies_protocol(self):
        provider = HashingEmbeddingProvider()
        assert isinstance(provider, EmbeddingProvider)
        provider_ok: EmbeddingProvider = provider  # static conformance
        assert provider_ok.dimensions == 1024

    def test_factory_returns_protocol(self):
        provider = build_embedding_provider("hashing", node_env="test")
        assert isinstance(provider, EmbeddingProvider)
