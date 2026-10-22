"""LLM Gateway client tests — the Anthropic SDK is never touched here."""

import httpx

from saath_agents.config import AgentConfig
from saath_agents.llm_gateway_client import LlmGatewayClient

cfg = AgentConfig(
    agent_token_secret="test-secret-do-not-use-in-prod",
    core_api_url="http://api.test",
    internal_service_token="internal-test-token",
)


def test_client_posts_to_gateway_with_service_token():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["token"] = request.headers.get("x-internal-token")
        captured["json"] = request.read().decode()
        return httpx.Response(200, json={"text": "ok", "model": "m", "traceId": "t1"})

    transport = httpx.MockTransport(handler)
    client = LlmGatewayClient(cfg, httpx.Client(transport=transport))
    out = client.complete(agent="A1", tier="small", messages=[{"role": "user", "content": "hi"}])

    assert captured["url"] == "http://api.test/v1/internal/llm/complete"
    assert captured["token"] == "internal-test-token"
    assert '"agent": "A1"' in captured["json"] or '"agent":"A1"' in captured["json"]
    assert out["traceId"] == "t1"


def test_sdk_isolation():
    """No module in saath_agents may import the anthropic package (rule 4)."""

    import pathlib
    import re

    src = pathlib.Path(__file__).parent.parent / "src" / "saath_agents"
    offenders = [
        p
        for p in src.rglob("*.py")
        if re.search(r"^\s*(import|from)\s+anthropic\b", p.read_text(), re.MULTILINE)
    ]
    assert offenders == [], f"anthropic SDK imported in: {offenders}"
