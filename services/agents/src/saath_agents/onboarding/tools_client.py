"""Core tools port for A1 (P1-05/06): the ONLY way the engine touches user data.

Each call mints a fresh scoped agent token whose allow-list contains exactly
the tools that call needs. The agent never sees DB credentials.
"""

from __future__ import annotations

from typing import Any

import httpx

from ..config import AgentConfig
from ..tokens import mint_token

AGENT = "A1-onboarding"


class CoreToolsPort:
    def __init__(self, config: AgentConfig, http: httpx.Client | None = None) -> None:
        self._config = config
        self._http = http or httpx.Client(timeout=15.0)

    def _token(self, user_id: str, tools: list[str]) -> str:
        return mint_token(
            self._config.agent_token_secret,
            agent=AGENT,
            acting_for_user_id=user_id,
            tools=tools,
        )

    def get_attribute_definitions(self, user_id: str = "", community: str | None = None) -> list[dict[str, Any]]:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/tools/get_attribute_definitions",
            json={"community": community} if community else {},
            headers={"x-agent-token": self._token(user_id, ["get_attribute_definitions"])},
        )
        resp.raise_for_status()
        return resp.json()

    def save_profile_fields(self, user_id: str, fields: dict[str, Any]) -> None:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/tools/save_profile_fields",
            json={"userId": user_id, "fields": fields},
            headers={
                "x-agent-token": self._token(user_id, ["save_profile_fields"])
            },
        )
        resp.raise_for_status()

    def save_dealbreakers(self, user_id: str, dealbreakers: list[dict[str, Any]]) -> None:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/tools/save_dealbreakers",
            json={"userId": user_id, "dealbreakers": dealbreakers},
            headers={
                "x-agent-token": self._token(user_id, ["save_dealbreakers"])
            },
        )
        resp.raise_for_status()
