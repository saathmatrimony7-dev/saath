"""Nightly batch runner (P3-07, DESIGN.md §8 + Q4: script + internal HTTP
trigger; EventBridge/scheduler lands with P5 infra).

Iterates every batch-eligible user (Core enumeration), runs the A4 pipeline,
and aggregates stats. Per-user failures are counted and skipped — one bad
user must not abort the window. Re-running for the same batch_date is
idempotent (publish is a replace-set per user+date).
"""

from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from typing import Any

from ..config import AgentConfig
from ..explanations import ExplanationGenerator, ExplanationSettings
from ..llm_gateway_client import LlmGatewayClient
from ..matchmaker import (
    A4Matchmaker,
    MatchmakerCoreClient,
    MatchmakerToolsPort,
    settings_from_config,
)


@dataclass
class BatchStats:
    batchDate: str
    users: int = 0
    processed: int = 0
    published: int = 0
    screeningCalls: int = 0
    passedScreening: int = 0
    explanations: int = 0
    explanationErrors: int = 0
    errors: int = 0
    errorIds: list[str] | None = None
    ms: int = 0

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["perUserMs"] = round(self.ms / self.processed, 1) if self.processed else 0.0
        return d


def run_batch(
    config: AgentConfig,
    batch_date: str,
    tools: MatchmakerToolsPort | None = None,
    user_ids: list[str] | None = None,
    log_every: int = 200,
) -> dict[str, Any]:
    """Runs the full nightly batch for one date. Returns aggregate stats.

    Users are processed concurrently (BATCH_WORKERS threads, one shared
    Core-facing client — httpx pools connections); per-user failures are
    counted and skipped — one bad user must not abort the window.
    """
    core = tools or MatchmakerCoreClient(config)
    settings = settings_from_config(config)
    # P3-09: explanations only in production wiring (tests pass `tools` and
    # stay LLM-free). Fail-soft by construction — explanationErrors is a
    # stat, never a batch failure.
    explanations = None
    if tools is None:
        explanations = ExplanationGenerator(
            LlmGatewayClient(config),
            ExplanationSettings(
                max_chars=config.explanation_max_chars,
                max_claims=config.explanation_max_claims,
                max_tokens=config.explanation_max_tokens,
            ),
        )
    matchmaker = A4Matchmaker(core, settings, explanations)

    if user_ids is None:
        user_ids = core.batch_users()  # type: ignore[attr-defined]
    stats = BatchStats(batchDate=batch_date, users=len(user_ids), errorIds=[])
    t0 = time.time()

    def process(uid: str) -> dict[str, Any]:
        try:
            return matchmaker.run_for_user(uid, batch_date)
        except Exception as exc:  # noqa: BLE001 — keep the window going
            return {"__error__": f"{type(exc).__name__}: {str(exc)[:160]}"}

    workers = max(1, config.batch_workers)
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for out in pool.map(process, user_ids):
            done += 1
            if out is None or "__error__" in out:
                stats.errors += 1
                stats.errorIds = stats.errorIds or []
                stats.errorIds.append(user_ids[done - 1])
                if stats.errors <= 10:
                    print(f"[batch] user failed: {out.get('__error__') if out else 'unknown'}")
            else:
                stats.processed += 1
                stats.published += out["published"]
                stats.screeningCalls += out["screeningCalls"]
                stats.passedScreening += out["passedScreening"]
                stats.explanations += out.get("explanations", 0)
                stats.explanationErrors += out.get("explanationErrors", 0)
            if log_every and done % log_every == 0:
                print(f"[batch] {done}/{len(user_ids)} users, {stats.published} published, {stats.errors} errors")
    stats.ms = int((time.time() - t0) * 1000)
    return stats.to_dict()


def default_batch_date() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


__all__ = ["BatchStats", "run_batch", "default_batch_date"]
