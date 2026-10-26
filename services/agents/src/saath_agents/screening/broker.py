"""A6 Screening Broker engine (P3-05, DESIGN.md §7.3 + §6.1 A6).

Three deterministic stages around two small-LLM advocate calls:
  Stage 1: Core's two-sided hard-filter check (single source of truth in the
          matching module) — INCOMPATIBLE short-circuits with reason codes
          only, no LLM, no advocate input (§7.3).
  Stage 2: per-topic structured advocate Q&A (A5, tier small) over the OTHER
          side's redacted snapshot. Structured JSON only — no free-form
          agent-to-agent chat ever happens (§7.1).
  Stage 3: deterministic weighted combine into the §7.3 verdict; the pair
          cache (screening_results) is consulted first and written after.

Audit (§7.4.6): inputs_hash binds both snapshot hashes + the pinned rules
version; Core re-verifies the chain at write time and 409s on any drift.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from pydantic import ValidationError

from ..schemas.screening import (
    MODEL_VERSION,
    AdvocateTopicAnswer,
    CachedLookup,
    HardFilterOutcome,
    RedactedSnapshot,
    ScreeningVerdict,
    SnapshotBundle,
    TopicResult,
    TopicScore,
    Verdict,
)
from .advocate import A5Advocate

# Stage-2/3 soft reason codes (closed vocabulary; Core gates writes).
REASON_SOFT_PARTIAL = "SOFT_TOPIC_PARTIAL"
REASON_SOFT_CONFLICT = "SOFT_TOPIC_CONFLICT"


class ScreeningToolsPort(Protocol):
    """The broker's ONLY view of Core. Tests fake this port end-to-end."""

    def find_cached(self, a_user_id: str, b_user_id: str) -> dict[str, Any]: ...

    def check_hard_filters(self, a_user_id: str, b_user_id: str) -> dict[str, Any]: ...

    def get_preference_snapshot(self, user_id: str) -> dict[str, Any]: ...

    def write_screening_result(self, payload: dict[str, Any]) -> dict[str, Any]: ...


class BrokerError(Exception):
    """A Core tool response failed schema validation."""


@dataclass(frozen=True)
class ScreeningThresholds:
    """Stage-3 combine config (rule 13: thresholds are config, not code)."""

    score_compatible: float = 0.75
    score_partial: float = 0.45
    stage2_max_topics: int = 12


def inputs_hash(snapshot_hash_a: str, snapshot_hash_b: str, rules_version: str) -> str:
    """Binds both snapshot hashes to the pinned rules version (§7.4.6).

    Identical formula to Core's inputsHash() — a simple hex-string join, so
    no cross-language JSON canonicalisation is involved.
    """
    raw = f"{snapshot_hash_a}|{snapshot_hash_b}|{rules_version}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def combine_topic_results(
    answers_a: list[AdvocateTopicAnswer],
    answers_b: list[AdvocateTopicAnswer],
    weight_of: dict[str, int],
) -> list[TopicScore]:
    """One result per topic: conflict if either side conflicts, compatible
    only when both agree compatible, otherwise partial."""
    by_a = {a.topic: a for a in answers_a}
    by_b = {a.topic: a for a in answers_b}
    topics = sorted(set(by_a) | set(by_b))
    out: list[TopicScore] = []
    for topic in topics:
        ra = by_a.get(topic)
        rb = by_b.get(topic)
        if (ra and ra.result == TopicResult.CONFLICT) or (rb and rb.result == TopicResult.CONFLICT):
            result = TopicResult.CONFLICT
        elif ra and rb and ra.result == TopicResult.COMPATIBLE and rb.result == TopicResult.COMPATIBLE:
            result = TopicResult.COMPATIBLE
        else:
            result = TopicResult.PARTIAL
        out.append(TopicScore(topic=topic, result=result))
    return out


def combine_verdict(
    topics: list[TopicScore],
    weight_of: dict[str, int],
    thresholds: ScreeningThresholds,
) -> tuple[Verdict, float, list[str]]:
    """Deterministic Stage 3 (§7.3): weight = mean of both sides' weights."""
    value = {TopicResult.COMPATIBLE: 1.0, TopicResult.PARTIAL: 0.5, TopicResult.CONFLICT: 0.0}
    total_w = sum(weight_of.get(t.topic, 50) for t in topics)
    if not topics or total_w <= 0:
        return Verdict.COMPATIBLE, 1.0, []
    score = sum(weight_of.get(t.topic, 50) * value[t.result] for t in topics) / total_w
    if score >= thresholds.score_compatible:
        verdict = Verdict.COMPATIBLE
    elif score >= thresholds.score_partial:
        verdict = Verdict.PARTIAL
    else:
        verdict = Verdict.INCOMPATIBLE
    codes: list[str] = []
    if any(t.result == TopicResult.PARTIAL for t in topics):
        codes.append(REASON_SOFT_PARTIAL)
    if any(t.result == TopicResult.CONFLICT for t in topics):
        codes.append(REASON_SOFT_CONFLICT)
    return verdict, round(score, 4), codes


class A6ScreeningBroker:
    AGENT = "A6-screening-broker"

    def __init__(
        self,
        llm: Any,
        tools: ScreeningToolsPort,
        thresholds: ScreeningThresholds | None = None,
        advocate: A5Advocate | None = None,
    ) -> None:
        self._tools = tools
        self._thresholds = thresholds or ScreeningThresholds()
        self._advocate = advocate or A5Advocate(llm)

    def screen_pair(self, a_user_id: str, b_user_id: str) -> ScreeningVerdict:
        if a_user_id == b_user_id:
            raise BrokerError("cannot screen a user against themselves")
        cached = CachedLookup.model_validate(self._tools.find_cached(a_user_id, b_user_id))
        if cached.status == "hit" and cached.result:
            return self._verdict_from_row(cached.result)

        # Snapshots are fetched BEFORE Stage 1 so a short-circuited
        # INCOMPATIBLE can still be hash-bound into the audit chain.
        bundle_a = SnapshotBundle.model_validate(
            self._tools.get_preference_snapshot(a_user_id)
        )
        bundle_b = SnapshotBundle.model_validate(
            self._tools.get_preference_snapshot(b_user_id)
        )
        if bundle_a.rules_version != bundle_b.rules_version:
            raise BrokerError("snapshot rules versions diverged between sides")
        rules_version = bundle_a.rules_version

        stage1 = HardFilterOutcome.model_validate(
            self._tools.check_hard_filters(a_user_id, b_user_id)
        )
        if not stage1.compatible:
            return self._write(
                a_user_id,
                b_user_id,
                verdict=Verdict.INCOMPATIBLE,
                score=0.0,
                topics=[],
                reason_codes=stage1.reason_codes,
                bundle_a=bundle_a,
                bundle_b=bundle_b,
                rules_version=rules_version,
            )

        snap_a = bundle_a.snapshot
        snap_b = bundle_b.snapshot
        topics = self._common_topics(snap_a, snap_b)
        weights = self._topic_weights(snap_a, snap_b)

        answers_a = self._advocate.answer_topics(
            own_snapshot=bundle_a.snapshot.model_dump(by_alias=True),
            other_snapshot=bundle_b.snapshot.model_dump(by_alias=True),
            topics=topics,
        )
        answers_b = self._advocate.answer_topics(
            own_snapshot=bundle_b.snapshot.model_dump(by_alias=True),
            other_snapshot=bundle_a.snapshot.model_dump(by_alias=True),
            topics=topics,
        )
        combined = combine_topic_results(answers_a, answers_b, weights)
        verdict, score, codes = combine_verdict(combined, weights, self._thresholds)
        return self._write(
            a_user_id,
            b_user_id,
            verdict=verdict,
            score=score,
            topics=combined,
            reason_codes=codes,
            bundle_a=bundle_a,
            bundle_b=bundle_b,
            rules_version=rules_version,
        )

    # ------------------------------------------------------------------

    def _common_topics(self, a: RedactedSnapshot, b: RedactedSnapshot) -> list[str]:
        """Stage 2 topics: both sides hold a stance (others can't be judged).

        Sorted + capped for determinism and cost control (§7.4.8).
        """
        topics_a = {s.topic for s in a.soft_preferences}
        topics_b = {s.topic for s in b.soft_preferences}
        common = sorted(topics_a & topics_b)
        return common[: self._thresholds.stage2_max_topics]

    @staticmethod
    def _topic_weights(a: RedactedSnapshot, b: RedactedSnapshot) -> dict[str, int]:
        wa = {s.topic: s.weight for s in a.soft_preferences}
        wb = {s.topic: s.weight for s in b.soft_preferences}
        return {t: (wa.get(t, 50) + wb.get(t, 50)) // 2 for t in set(wa) | set(wb)}

    def _write(
        self,
        a_user_id: str,
        b_user_id: str,
        *,
        verdict: Verdict,
        score: float,
        topics: list[TopicScore],
        reason_codes: list[str],
        bundle_a: SnapshotBundle,
        bundle_b: SnapshotBundle,
        rules_version: str,
    ) -> ScreeningVerdict:
        # Pair order is normalised exactly like Core: hashes must attach to
        # user_a/user_b of the stored row.
        pair = tuple(sorted((a_user_id, b_user_id)))
        hash_of = {bundle_a.snapshot.user_id: bundle_a.snapshot_hash,
                   bundle_b.snapshot.user_id: bundle_b.snapshot_hash}
        snapshot_hash_a = hash_of[pair[0]]
        snapshot_hash_b = hash_of[pair[1]]
        payload = {
            "pair": list(pair),
            "verdict": verdict.value,
            "score": score,
            "topics": [t.model_dump() for t in topics],
            "reasonCodes": reason_codes,
            "modelVersion": MODEL_VERSION,
            "inputsHash": inputs_hash(snapshot_hash_a, snapshot_hash_b, rules_version),
            "snapshotHashA": snapshot_hash_a,
            "snapshotHashB": snapshot_hash_b,
        }
        row = self._tools.write_screening_result(payload)
        return self._verdict_from_row(row)

    @staticmethod
    def _verdict_from_row(row: dict[str, Any]) -> ScreeningVerdict:
        """Cached rows and write responses are the stored §7.3 shape."""
        try:
            topics = [
                TopicScore(topic=t["topic"], result=TopicResult(t["result"]))
                for t in row.get("topics", [])
            ]
            expires = row["expiresAt"] if "expiresAt" in row else row["expires_at"]
            if isinstance(expires, str):
                expires = datetime.fromisoformat(expires.replace("Z", "+00:00"))
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            return ScreeningVerdict(
                pair=(row["userA"] if "userA" in row else row["user_a"],
                      row["userB"] if "userB" in row else row["user_b"]),
                verdict=Verdict(row["verdict"]),
                score=float(row["score"]),
                topics=topics,
                reason_codes=list(row.get("reasonCodes", row.get("reason_codes", []))),
                model_version=row["modelVersion"] if "modelVersion" in row else row["model_version"],
                expires_at=expires,
            )
        except (KeyError, ValidationError, ValueError, TypeError) as exc:
            raise BrokerError(f"malformed screening row from Core: {exc}") from exc


__all__ = [
    "A6ScreeningBroker",
    "BrokerError",
    "ScreeningThresholds",
    "ScreeningToolsPort",
    "combine_topic_results",
    "combine_verdict",
    "inputs_hash",
]
