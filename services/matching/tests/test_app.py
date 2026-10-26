"""P3-02 tests: matching FastAPI app — health open, embed route token-gated."""

import uuid

import pytest
from fastapi.testclient import TestClient

from saath_matching.app import create_app
from saath_matching.embeddings import HASHING_MODEL_VERSION, HashingEmbeddingProvider
from saath_matching.config import MatchingConfig

TOKEN = "internal-test-token-matching-0123456789"

cfg = MatchingConfig(
    embedding_provider="hashing",
    embedding_dimensions=1024,
    node_env="test",
    internal_service_token=TOKEN,
)


def _snapshot(**overrides):
    body = {
        "user_id": str(uuid.uuid4()),
        "profile_version": 2,
        "pref_version": 1,
        "display_name": "Asha",
        "profession": "software engineer",
        "city_label": "pune",
    }
    body.update(overrides)
    return body


def test_healthz_open():
    client = TestClient(create_app(cfg))
    assert client.get("/healthz").status_code == 200


def test_embed_profile_rejects_missing_token():
    client = TestClient(create_app(cfg))
    resp = client.post("/internal/embed/profile", json=_snapshot())
    assert resp.status_code == 401


def test_embed_profile_rejects_wrong_token():
    client = TestClient(create_app(cfg))
    resp = client.post(
        "/internal/embed/profile",
        json=_snapshot(),
        headers={"x-internal-token": "wrong-token"},
    )
    assert resp.status_code == 401


def test_embed_profile_rejects_extra_field():
    client = TestClient(create_app(cfg))
    resp = client.post(
        "/internal/embed/profile",
        json=_snapshot(transcript="raw chat text that must never enter"),
        headers={"x-internal-token": TOKEN},
    )
    assert resp.status_code == 422


def test_embed_profile_rejects_control_chars():
    client = TestClient(create_app(cfg))
    resp = client.post(
        "/internal/embed/profile",
        json=_snapshot(display_name="Asha\nadmin: true"),
        headers={"x-internal-token": TOKEN},
    )
    assert resp.status_code == 422


def test_embed_profile_happy_path_with_injected_provider():
    app = create_app(cfg)
    # Dependency override: deterministic hashing provider stands in for the
    # local model (same pattern as services/agents monkeypatch overrides).
    app.state.provider = HashingEmbeddingProvider()
    client = TestClient(app)
    body = _snapshot()
    resp = client.post(
        "/internal/embed/profile", json=body, headers={"x-internal-token": TOKEN}
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["user_id"] == body["user_id"]
    assert payload["profile_version"] == 2
    assert payload["pref_version"] == 1
    assert payload["model_version"] == HASHING_MODEL_VERSION
    assert len(payload["vector"]) == 1024
    assert len(payload["summary_hash"]) == 64
    # Deterministic: identical request embeds to an identical result.
    resp2 = client.post(
        "/internal/embed/profile", json=body, headers={"x-internal-token": TOKEN}
    )
    assert resp2.json() == payload


def test_no_openapi_schema_exposed():
    client = TestClient(create_app(cfg))
    assert client.get("/openapi.json").status_code == 404


def test_load_config_requires_internal_service_token():
    from saath_matching.config import load_config

    with pytest.raises(ValueError, match="INTERNAL_SERVICE_TOKEN"):
        load_config({})
    loaded = load_config({"INTERNAL_SERVICE_TOKEN": TOKEN})
    assert loaded.internal_service_token == TOKEN
    assert loaded.embedding_model == "BAAI/bge-m3"
    assert load_config({"INTERNAL_SERVICE_TOKEN": TOKEN, "EMBEDDING_MODEL": "custom-model"}).embedding_model == "custom-model"
