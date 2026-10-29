"""Core port for the A8 coordinator (P4-09): its ONLY way to touch data.

Agent tokens are minted fresh per call with exactly one tool in the
allow-list and bound to the acting user (A4 pattern). A8 never sees DB
credentials.
"""

from __future__ import annotations

from typing import Any

import httpx

from ..config import AgentConfig
from ..tokens import mint_token
from .engine import A8Coordinator

AGENT = A8Coordinator.AGENT


class CoordinatorCoreClient:
    def __init__(self, config: AgentConfig, http: httpx.Client | None = None) -> None:
        self._config = config
        self._http = http or httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0))

    def _token(self, user_id: str, tool: str) -> str:
        return mint_token(
            self._config.agent_token_secret,
            agent=AGENT,
            acting_for_user_id=user_id,
            tools=[tool],
        )

    def propose_slots(self, user_id: str, conversation_id: str, slots: list[str]) -> dict[str, Any]:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/tools/propose_slots",
            json={"userId": user_id, "conversationId": conversation_id, "slots": slots},
            headers={"x-agent-token": self._token(user_id, "propose_slots")},
        )
        resp.raise_for_status()
        return resp.json()

    def send_nudge(self, user_id: str, conversation_id: str) -> dict[str, Any]:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/tools/send_nudge",
            json={"userId": user_id, "conversationId": conversation_id},
            headers={"x-agent-token": self._token(user_id, "send_nudge")},
        )
        resp.raise_for_status()
        return resp.json()

    def record_meeting_feedback(
        self, user_id: str, conversation_id: str, outcome: str, notes: str | None = None
    ) -> dict[str, Any]:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/tools/record_meeting_feedback",
            json={
                "userId": user_id,
                "conversationId": conversation_id,
                "outcome": outcome,
                **({"notes": notes} if notes is not None else {}),
            },
            headers={"x-agent-token": self._token(user_id, "record_meeting_feedback")},
        )
        resp.raise_for_status()
        return resp.json()


__all__ = ["CoordinatorCoreClient", "AGENT"]
