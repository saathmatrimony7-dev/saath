"""LLM Gateway client — the ONLY way agents reach a model (rule 4).

Agents never embed an LLM SDK and never see the Anthropic API key. They call
the Core API's /v1/internal/llm/complete with the internal service token;
the gateway handles redaction, model routing, budgets and audit logging.
"""

from __future__ import annotations

from typing import Any

import httpx

from .config import AgentConfig


class LlmGatewayClient:
    def __init__(self, config: AgentConfig, client: httpx.Client | None = None) -> None:
        self._config = config
        self._client = client or httpx.Client(timeout=30.0)

    def complete(
        self,
        *,
        agent: str,
        tier: str,
        messages: list[dict[str, str]],
        acting_for_user_id: str | None = None,
        system: str | None = None,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "agent": agent,
            "tier": tier,
            "messages": messages,
        }
        if acting_for_user_id:
            payload["userId"] = acting_for_user_id
        if system is not None:
            payload["system"] = system
        if max_tokens is not None:
            payload["maxTokens"] = max_tokens

        resp = self._client.post(
            f"{self._config.core_api_url}/v1/internal/llm/complete",
            json=payload,
            headers={"x-internal-token": self._config.internal_service_token},
        )
        resp.raise_for_status()
        return resp.json()
