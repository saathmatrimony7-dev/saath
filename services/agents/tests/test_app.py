"""App skeleton tests: health is open, scope-check requires a valid token."""

from fastapi.testclient import TestClient

from saath_agents.config import AgentConfig
from saath_agents.main import create_app
from saath_agents.tokens import mint_token

SECRET = "test-secret-do-not-use-in-prod-0123456789"

cfg = AgentConfig(
    agent_token_secret=SECRET,
    core_api_url="http://localhost:3000",
    internal_service_token="internal-test-token",
)
client = TestClient(create_app(cfg))


def test_healthz_open():
    assert client.get("/healthz").status_code == 200


def test_scope_check_rejects_missing_token():
    assert client.get("/internal/scope-check").status_code == 401


def test_scope_check_rejects_invalid_token():
    resp = client.get("/internal/scope-check", headers={"x-agent-token": "garbage"})
    assert resp.status_code == 401


def test_scope_check_returns_claims_for_valid_token():
    token = mint_token(SECRET, agent="A4-matchmaker", acting_for_user_id="usr_9")
    resp = client.get("/internal/scope-check", headers={"x-agent-token": token})
    assert resp.status_code == 200
    body = resp.json()
    assert body["agent"] == "A4-matchmaker"
    assert body["acting_for_user_id"] == "usr_9"


def test_no_openapi_schema_exposed():
    # Internal-only service: no docs/schema surface.
    assert client.get("/openapi.json").status_code == 404
