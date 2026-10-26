"""Core ports for the A6 broker (P3-05): the ONLY way the engine touches data.

- find_cached / check_hard_filters: service-token internal endpoints
  (orchestration, no user binding — the broker is neutral).
- get_preference_snapshot / write_screening_result: scoped agent tokens whose
  allow-list contains exactly the one tool each call needs, minted fresh per
  call (A1 pattern). The broker never sees DB credentials.
"""

from __future__ import annotations

from typing import Any

import httpx

from ..config import AgentConfig
from ..tokens import mint_token
from .broker import A6ScreeningBroker, ScreeningToolsPort

AGENT = A6ScreeningBroker.AGENT


class ScreeningCoreClient(ScreeningToolsPort):
    def __init__(self, config: AgentConfig, http: httpx.Client | None = None) -> None:
        self._config = config
        self._http = http or httpx.Client(timeout=30.0)

    def _agent_token(self, tool: str) -> str:
        return mint_token(
            self._config.agent_token_secret,
            agent=AGENT,
            acting_for_user_id="",  # neutral broker: no user binding
            tools=[tool],
        )

    def _service_headers(self) -> dict[str, str]:
        return {"x-internal-token": self._config.internal_service_token}

    def find_cached(self, a_user_id: str, b_user_id: str) -> dict[str, Any]:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/screening/find-cached",
            json={"aUserId": a_user_id, "bUserId": b_user_id},
            headers=self._service_headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def check_hard_filters(self, a_user_id: str, b_user_id: str) -> dict[str, Any]:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/matching/check-hard-filters",
            json={"aUserId": a_user_id, "bUserId": b_user_id},
            headers=self._service_headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def get_preference_snapshot(self, user_id: str) -> dict[str, Any]:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/tools/get_preference_snapshot",
            json={"userId": user_id},
            headers={"x-agent-token": self._agent_token("get_preference_snapshot")},
        )
        resp.raise_for_status()
        return resp.json()

    def write_screening_result(self, payload: dict[str, Any]) -> dict[str, Any]:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/tools/write_screening_result",
            json=payload,
            headers={"x-agent-token": self._agent_token("write_screening_result")},
        )
        resp.raise_for_status()
        return resp.json()


__all__ = ["ScreeningCoreClient", "AGENT"]
