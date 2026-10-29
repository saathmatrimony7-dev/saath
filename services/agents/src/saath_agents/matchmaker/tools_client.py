"""Core ports for the A4 matchmaker (P3-07): its ONLY way to touch data.

Agent-token tools are minted fresh per call with exactly one tool in the
allow-list and bound to the acting user (A1 pattern); batch enumeration and
the screening delegation use the internal service token. A4 never sees DB
credentials.
"""

from __future__ import annotations

from typing import Any

import httpx

from ..config import AgentConfig
from ..tokens import mint_token
from .engine import A4Matchmaker, MatchmakerToolsPort

AGENT = A4Matchmaker.AGENT


class MatchmakerCoreClient(MatchmakerToolsPort):
    def __init__(self, config: AgentConfig, http: httpx.Client | None = None) -> None:
        self._config = config
        # Generous read timeout: the nightly batch serves big payloads
        # (candidate lists) and runs long queries on cold caches.
        self._http = http or httpx.Client(timeout=httpx.Timeout(120.0, connect=10.0))

    def _token(self, user_id: str, tool: str) -> str:
        return mint_token(
            self._config.agent_token_secret,
            agent=AGENT,
            acting_for_user_id=user_id,
            tools=[tool],
        )

    def _service_headers(self) -> dict[str, str]:
        return {"x-internal-token": self._config.internal_service_token}

    def batch_users(self) -> list[str]:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/matching/batch-users",
            headers=self._service_headers(),
        )
        resp.raise_for_status()
        return list(resp.json()["userIds"])

    def get_candidates(self, user_id: str) -> dict[str, Any]:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/tools/get_candidates",
            json={"userId": user_id},
            headers={"x-agent-token": self._token(user_id, "get_candidates")},
        )
        resp.raise_for_status()
        return resp.json()

    def request_screenings(self, a_user_id: str, candidate_ids: list[str]) -> dict[str, Any]:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/tools/request_screenings",
            json={"aUserId": a_user_id, "candidateIds": candidate_ids},
            headers={"x-agent-token": self._token(a_user_id, "request_screenings")},
        )
        resp.raise_for_status()
        return resp.json()

    def publish_daily_matches(
        self, user_id: str, batch_date: str, matches: list[dict[str, Any]]
    ) -> dict[str, Any]:
        resp = self._http.post(
            f"{self._config.core_api_url}/v1/internal/tools/publish_daily_matches",
            json={"userId": user_id, "batchDate": batch_date, "matches": matches},
            headers={"x-agent-token": self._token(user_id, "publish_daily_matches")},
        )
        resp.raise_for_status()
        return resp.json()


__all__ = ["MatchmakerCoreClient", "AGENT"]
