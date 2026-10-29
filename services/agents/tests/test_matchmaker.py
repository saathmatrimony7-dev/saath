"""P3-07: A4 matchmaker engine + nightly batch runner tests (scripted ports).

Covers the §8 pipeline per user: exposure cap (pure, mirrors Core), stage-2
budget cap, verdict ordering + weighted final score, publish payload shape,
batch aggregation, per-user error isolation, and idempotent re-runs.
"""

from __future__ import annotations

import json

import pytest
from starlette.testclient import TestClient

from saath_agents.batch import run_batch
from saath_agents.config import AgentConfig
from saath_agents.main import create_app
from saath_agents.matchmaker import (
    A4Matchmaker,
    MatchmakerSettings,
    apply_exposure_cap,
    settings_from_config,
)


def cand(uid: str, score: float) -> dict:
    return {"userId": uid, "score": score, "similarity": score, "signals": {}, "reasonCodes": []}


class FakeTools:
    def __init__(
        self,
        *,
        candidates: list[dict] | None = None,
        shown: dict[str, int] | None = None,
        verdicts: dict[str, dict] | None = None,
        fail_users: set[str] | None = None,
    ) -> None:
        self._candidates = candidates or []
        self._shown = shown or {}
        self._verdicts = verdicts or {}
        self._fail = fail_users or set()
        self.screening_calls: list[tuple[str, str]] = []
        self.publish_calls: list[tuple[str, str, list]] = []
        self.rows: dict[tuple[str, str], list] = {}

    def get_candidates(self, user_id: str) -> dict:
        return {"candidates": list(self._candidates), "shownCounts": dict(self._shown)}

    def request_screenings(self, a: str, candidate_ids: list[str]) -> dict:
        for cid in candidate_ids:
            self.screening_calls.append((a, cid))
        return {
            "results": [
                {"candidateId": cid, **self._verdicts.get(cid, {"verdict": "COMPATIBLE", "score": 0.9})}
                for cid in candidate_ids
            ]
        }

    def publish_daily_matches(self, user_id: str, batch_date: str, matches: list) -> dict:
        if user_id in self._fail:
            raise RuntimeError("simulated publish failure")
        self.publish_calls.append((user_id, batch_date, matches))
        # replace-set semantics, mirroring Core
        self.rows[(user_id, batch_date)] = list(matches)
        return {"published": len(matches)}


# ---------------------------------------------------------------------------
# Pure exposure cap (parity with Core's applyExposureCap)
# ---------------------------------------------------------------------------


def test_exposure_cap_filters_and_validates():
    cs = [cand("u1", 0.9), cand("u2", 0.8), cand("u3", 0.7)]
    out = apply_exposure_cap(cs, {"u1": 5, "u2": 4}, 5)
    assert [c["userId"] for c in out] == ["u2", "u3"]
    assert apply_exposure_cap(cs, {}, 5) == cs
    with pytest.raises(ValueError):
        apply_exposure_cap(cs, {}, 0)


# ---------------------------------------------------------------------------
# A4 per-user pipeline
# ---------------------------------------------------------------------------


def _settings(**kw) -> MatchmakerSettings:
    return MatchmakerSettings(**kw)


def test_pipeline_orders_verdicts_then_weighted_score():
    tools = FakeTools(
        candidates=[cand("c1", 0.95), cand("c2", 0.90), cand("c3", 0.85), cand("c4", 0.80)],
        verdicts={
            "c1": {"verdict": "PARTIAL", "score": 0.9},
            "c2": {"verdict": "COMPATIBLE", "score": 0.5},
            "c3": {"verdict": "COMPATIBLE", "score": 0.95},
            "c4": {"verdict": "INCOMPATIBLE", "score": 0.9},
        },
    )
    mm = A4Matchmaker(tools, _settings())
    out = mm.run_for_user("me", "2026-10-27")
    # compatible first (c3 > c2 by screening score), partial next, incompatible dropped
    assert [m["candidateId"] for m in out["matches"]] == ["c3", "c2", "c1"]
    # weighted: 0.7*screening + 0.3*prerank
    assert out["matches"][0]["score"] == pytest.approx(round(0.7 * 0.95 + 0.3 * 0.85, 4))
    assert out["matches"][1]["rank"] == 2
    assert out["published"] == 3
    assert out["passedScreening"] == 3


def test_stage2_budget_and_publish_count_are_enforced():
    candidates = [cand(f"c{i}", 0.9 - i * 0.01) for i in range(10)]
    tools = FakeTools(candidates=candidates)
    mm = A4Matchmaker(tools, _settings(stage2_max_per_user=4, daily_publish_count=2))
    out = mm.run_for_user("me", "2026-10-27")
    assert out["screeningCalls"] == 4  # §7.4.8 budget
    assert len(out["matches"]) == 2  # publish cap


def test_exposure_cap_applies_before_screening():
    tools = FakeTools(
        candidates=[cand("c1", 0.9), cand("c2", 0.8), cand("c3", 0.7)],
        shown={"c1": 5},  # at cap
    )
    mm = A4Matchmaker(tools, _settings(exposure_daily_cap=5))
    out = mm.run_for_user("me", "2026-10-27")
    assert out["capped"] == 2
    assert ("me", "c1") not in tools.screening_calls


def test_publish_is_called_even_with_zero_matches():
    tools = FakeTools(candidates=[cand("c1", 0.9)], verdicts={"c1": {"verdict": "INCOMPATIBLE", "score": 0.1}})
    mm = A4Matchmaker(tools)
    out = mm.run_for_user("me", "2026-10-27")
    assert out["matches"] == []
    assert tools.publish_calls == [("me", "2026-10-27", [])]


# ---------------------------------------------------------------------------
# Batch runner
# ---------------------------------------------------------------------------


def _cfg() -> AgentConfig:
    return AgentConfig(
        core_api_url="http://127.0.0.1:9",
        internal_service_token="test-secret-do-not-use-in-prod-0123456789",
        agent_token_secret="test-secret-do-not-use-in-prod-0123456789",
    )


def test_batch_aggregates_and_isolates_errors():
    tools = FakeTools(candidates=[cand("c1", 0.9)], fail_users={"bad"})
    stats = run_batch(_cfg(), "2026-10-27", tools=tools, user_ids=["u1", "bad", "u2"], log_every=0)
    assert stats["users"] == 3
    assert stats["processed"] == 2
    assert stats["errors"] == 1
    assert stats["errorIds"] == ["bad"]
    assert stats["published"] == 2
    assert stats["screeningCalls"] == 2
    assert stats["ms"] >= 0


def test_batch_rerun_same_date_is_idempotent():
    tools = FakeTools(candidates=[cand("c1", 0.9)])
    s1 = run_batch(_cfg(), "2026-10-27", tools=tools, user_ids=["u1"], log_every=0)
    s2 = run_batch(_cfg(), "2026-10-27", tools=tools, user_ids=["u1"], log_every=0)
    assert s1["published"] == s2["published"] == 1
    # replace-set: still exactly one row per user+date
    assert len(tools.rows[("u1", "2026-10-27")]) == 1


def test_settings_come_from_config():
    cfg = AgentConfig(
        core_api_url="http://127.0.0.1:9",
        internal_service_token="x" * 40,
        agent_token_secret="x" * 40,
        matching_stage2_max_per_user=7,
        matching_daily_publish_count=5,
        matching_exposure_daily_cap=2,
        matching_final_weight_screening=0.6,
        matching_final_weight_prerank=0.4,
    )
    s = settings_from_config(cfg)
    assert s.stage2_max_per_user == 7
    assert s.daily_publish_count == 5
    assert s.exposure_daily_cap == 2
    assert s.final_weight_screening == 0.6


# ---------------------------------------------------------------------------
# HTTP trigger
# ---------------------------------------------------------------------------


def test_batch_route_requires_service_token():
    client = TestClient(create_app(_cfg()))
    res = client.post("/internal/batch/run", json={})
    assert res.status_code == 401
    res2 = client.post(
        "/internal/batch/run",
        json={"batchDate": "2026-10-27", "extra": 1},
        headers={"x-internal-token": _cfg().internal_service_token},
    )
    assert res2.status_code == 422


def test_batch_route_returns_stats_only(monkeypatch):
    client = TestClient(create_app(_cfg()))

    def fake_run_batch(cfg, batch_date):
        return {
            "batchDate": batch_date,
            "users": 2,
            "processed": 2,
            "published": 3,
            "screeningCalls": 10,
            "passedScreening": 4,
            "errors": 0,
            "errorIds": [],
            "ms": 42,
            "perUserMs": 21.0,
        }

    monkeypatch.setattr("saath_agents.main.run_batch", fake_run_batch)
    res = client.post(
        "/internal/batch/run",
        json={"batchDate": "2026-10-27"},
        headers={"x-internal-token": _cfg().internal_service_token},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["published"] == 3 and body["batchDate"] == "2026-10-27"
    assert json.dumps(body)  # stats are plain JSON
