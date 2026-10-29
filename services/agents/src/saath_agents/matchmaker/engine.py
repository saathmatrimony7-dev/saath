"""A4 Matchmaker engine (P3-07, DESIGN.md §6.1 A4 + §8 steps 6-9).

Per user, over the Core tool surface only:
  1. get_candidates          — §8 steps 1-5 (pool → hard filters → ANN →
                               reciprocity → weighted pre-rank) + the
                               shown-counts input for step 8.
  2. exposure cap            — §8 step 8 as a pure filter (mirrors Core's
                               applyExposureCap; candidate shown ≤ cap/day).
  3. request_screening       — §8 step 6 for the top `stage2_max` candidates
                               (§7.4.8 cost cap). Keep COMPATIBLE/PARTIAL.
  4. final rank              — §8 step 7: COMPATIBLE before PARTIAL, then a
                               weighted score (config weights).
  5. publish_daily_matches   — §8 step 9 (idempotent replace-set per
                               batch_date; entitlement counts are config).

P3-09: after the final rank, one explanation per published match is
generated (tier mid via the LLM Gateway; see saath_agents.explanations)
and attached to the publish payload. Failures degrade to a deterministic
template — the pipeline never fails on explanations.

The engine holds no state and no credentials — only the injected port.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

from ..config import AgentConfig

if TYPE_CHECKING:
    from ..explanations import ExplanationGenerator

_VERDICT_ORDER = {"COMPATIBLE": 0, "PARTIAL": 1}


class MatchmakerToolsPort(Protocol):
    """A4's entire Core surface. Tests fake this port end-to-end."""

    def get_candidates(self, user_id: str) -> dict[str, Any]: ...

    def request_screenings(
        self, a_user_id: str, candidate_ids: list[str]
    ) -> dict[str, Any]: ...

    def publish_daily_matches(
        self, user_id: str, batch_date: str, matches: list[dict[str, Any]]
    ) -> dict[str, Any]: ...


@dataclass(frozen=True)
class MatchmakerSettings:
    """Config mirror (rule 13). Instantiated from AgentConfig."""

    stage2_max_per_user: int = 30
    daily_publish_count: int = 3
    exposure_daily_cap: int = 5
    final_weight_screening: float = 0.7
    final_weight_prerank: float = 0.3


def apply_exposure_cap(
    candidates: list[dict[str, Any]],
    shown_counts: dict[str, int],
    cap: int,
) -> list[dict[str, Any]]:
    """§8 step 8 (pure): drop candidates already shown `cap` times today.

    Mirrors Core's applyExposureCap exactly (same semantics, TS/Python).
    """
    if not isinstance(cap, int) or isinstance(cap, bool) or cap <= 0:
        raise ValueError("invalid exposure cap")
    return [c for c in candidates if shown_counts.get(c["userId"], 0) < cap]


class A4Matchmaker:
    AGENT = "A4-matchmaker"

    def __init__(
        self,
        tools: MatchmakerToolsPort,
        settings: MatchmakerSettings | None = None,
        explanations: ExplanationGenerator | None = None,
    ) -> None:
        self._tools = tools
        self._s = settings or MatchmakerSettings()
        self._explanations = explanations

    def final_score(self, screened: dict[str, Any]) -> float:
        prerank = min(1.0, max(0.0, float(screened.get("score", 0.0))))
        screening = min(1.0, max(0.0, float(screened.get("screeningScore", 0.0))))
        return self._s.final_weight_screening * screening + self._s.final_weight_prerank * prerank

    def run_for_user(self, user_id: str, batch_date: str) -> dict[str, Any]:
        data = self._tools.get_candidates(user_id)
        candidates = list(data.get("candidates", []))
        shown = dict(data.get("shownCounts", {}))

        # Step 8 — exposure control BEFORE spending screening budget.
        pool = apply_exposure_cap(candidates, shown, self._s.exposure_daily_cap)

        # Step 6 — pre-screen the top candidates (§7.4.8 cap), cheapest first.
        # One batched tool call per user (the nightly batch's hot loop).
        screened: list[dict[str, Any]] = []
        by_id = {c["userId"]: c for c in pool}
        batch = [c["userId"] for c in pool[: self._s.stage2_max_per_user]]
        screening_calls = 0
        if batch:
            results = self._tools.request_screenings(user_id, batch).get("results", [])
            screening_calls = len(batch)
            for v in results:
                verdict = str(v.get("verdict", "")).upper()
                if verdict in ("COMPATIBLE", "PARTIAL"):
                    cand = by_id.get(v["candidateId"])
                    if cand is None:
                        continue
                    screened.append(
                        {**cand, "verdict": verdict, "screeningScore": float(v.get("score", 0.0))}
                    )

        # Step 7 — final rank: verdict class, then weighted score, then id.
        screened.sort(
            key=lambda s: (
                _VERDICT_ORDER.get(s["verdict"], 2),
                -self.final_score(s),
                s["userId"],
            )
        )
        publish = screened[: self._s.daily_publish_count]
        matches = [
            {
                "candidateId": s["userId"],
                "rank": i + 1,
                "score": round(self.final_score(s), 4),
            }
            for i, s in enumerate(publish)
        ]

        # P3-09 — §8 step 9: one explanation per published match, in the
        # viewer's locale, over the closed-vocabulary fact tags Core
        # supplied with get_candidates. Best-effort by construction.
        locale = str(data.get("locale") or "en")
        explanation_errors = 0
        if self._explanations is not None:
            for match, side in zip(matches, publish):
                facts = [str(f) for f in side.get("explanationFacts", [])]
                try:
                    text = self._explanations.generate(
                        viewer_id=user_id, locale=locale, facts=facts
                    )
                except Exception:  # noqa: BLE001 — belt and suspenders
                    explanation_errors += 1
                    continue
                if text:
                    match["explanation"] = {locale: text}

        # Step 9 — publish (idempotent replace-set per batch_date).
        result = self._tools.publish_daily_matches(user_id, batch_date, matches)
        return {
            "userId": user_id,
            "candidates": len(candidates),
            "capped": len(pool),
            "screeningCalls": screening_calls,
            "passedScreening": len(screened),
            "published": result.get("published", len(matches)),
            "explanations": sum(1 for m in matches if "explanation" in m),
            "explanationErrors": explanation_errors,
            "matches": matches,
        }


def settings_from_config(config: AgentConfig) -> MatchmakerSettings:
    return MatchmakerSettings(
        stage2_max_per_user=config.matching_stage2_max_per_user,
        daily_publish_count=config.matching_daily_publish_count,
        exposure_daily_cap=config.matching_exposure_daily_cap,
        final_weight_screening=config.matching_final_weight_screening,
        final_weight_prerank=config.matching_final_weight_prerank,
    )


__all__ = [
    "A4Matchmaker",
    "MatchmakerSettings",
    "MatchmakerToolsPort",
    "apply_exposure_cap",
    "settings_from_config",
]
