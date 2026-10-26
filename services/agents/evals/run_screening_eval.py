"""A6 screening eval runner (P3-06, DESIGN.md §19 exit criterion 2:
false-incompatible rate ≤ 10% on labelled pairs).

Usage:
  uv run python -m evals.run_screening_eval              # mock mode (CI plumbing)
  REAL=1 uv run python -m evals.run_screening_eval       # real Claude via Core gateway

The runner drives the real A6 broker engine end to end. The Core-facing port
is backed by the corpus itself (Stage-1 outcomes are authored and
deterministic — the LLM-dependent surface is Stage 2/3, which is exactly
where a false-incompatible can occur). The LLM is the only difference
between modes: mock = deterministic stand-in (plumbing only), real = Core
LLM gateway with the owner-provided key (threshold enforced, exit code).

Metric (exit criterion 2): over Stage-2 items labelled compatible/partial,
the fraction rated INCOMPATIBLE must be ≤ FALSE_INCOMPATIBLE_MAX. Stage-1
short-circuit items must all rate INCOMPATIBLE (deterministic, 100%).

Writes evals/reports/screening_eval_{mode}_{timestamp}.json + .md.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from evals.screening.corpus import CORPUS, POSITIVE_IDS, STAGE1_IDS

REPORTS_DIR = Path(__file__).parent / "reports"
RULES_VERSION = "screening-rules-v2"
FALSE_INCOMPATIBLE_MAX = 0.10

# Verdict labels in the corpus are lowercase; broker emits §7.3 enums.
_VERDICT_MAP = {"compatible": "COMPATIBLE", "partial": "PARTIAL", "incompatible": "INCOMPATIBLE"}


def _user_ids(item: dict) -> tuple[str, str]:
    """Deterministic synthetic ids — never real user data (ADR-0008)."""
    base = uuid.uuid5(uuid.NAMESPACE_URL, f"saath-screening-eval/{item['id']}")
    a = str(base)
    b = str(uuid.uuid5(uuid.NAMESPACE_URL, f"saath-screening-eval/{item['id']}/b"))
    return a, b


def _bundle(side_data: dict, user_id: str) -> dict:
    snap = {
        "userId": user_id,
        "prefVersion": 1,
        "profileVersion": 1,
        "profileEnums": side_data["profileEnums"],
        "preferences": side_data["preferences"],
        "softPreferences": side_data["stances"],
        "shareLevel": "standard",
    }
    canonical = json.dumps(snap, sort_keys=True, separators=(",", ":"))
    return {
        "snapshot": snap,
        "snapshotHash": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "prefVersion": 1,
        "profileVersion": 1,
        "rulesVersion": RULES_VERSION,
        "modelVersion": "a6-screen-v2",
    }


class CorpusTools:
    """ScreeningToolsPort backed by one corpus item (fake Core)."""

    def __init__(self, item: dict) -> None:
        self._item = item
        self.a_id, self.b_id = _user_ids(item)
        self._bundles = {
            self.a_id: _bundle(item["a"], self.a_id),
            self.b_id: _bundle(item["b"], self.b_id),
        }
        self.write_payloads: list[dict] = []

    def find_cached(self, a_user_id: str, b_user_id: str) -> dict:
        return {
            "status": "miss",
            "prefVersionA": 1,
            "prefVersionB": 1,
            "rulesVersion": RULES_VERSION,
            "modelVersion": "a6-screen-v2",
        }

    def check_hard_filters(self, a_user_id: str, b_user_id: str) -> dict:
        return {
            "compatible": self._item["stage1"]["compatible"],
            "reasonCodes": list(self._item["stage1"]["reasonCodes"]),
        }

    def get_preference_snapshot(self, user_id: str) -> dict:
        return self._bundles[user_id]

    def write_screening_result(self, payload: dict) -> dict:
        self.write_payloads.append(payload)
        return {
            "id": str(uuid.uuid4()),
            "userA": payload["pair"][0],
            "userB": payload["pair"][1],
            "verdict": payload["verdict"],
            "score": payload["score"],
            "topics": payload["topics"],
            "reasonCodes": payload["reasonCodes"],
            "modelVersion": payload["modelVersion"],
            "inputsHash": payload["inputsHash"],
            "expiresAt": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        }


class MockLlm:
    """Plumbing-only stand-in: answers 'compatible' for every asked topic."""

    def complete(self, **kwargs):
        payload = json.loads(kwargs["messages"][0]["content"].split("\n", 1)[1])
        topics = payload["topics"]
        return {
            "text": json.dumps(
                {
                    "answers": [
                        {"topic": t, "result": "compatible", "confidence": 0.8} for t in topics
                    ],
                    "model_version": "a5-advocate-v2",
                }
            ),
            "model": "mock",
        }


def _build_broker(mode: str, tools: CorpusTools):
    from saath_agents.screening import A6ScreeningBroker

    if mode == "real":
        from saath_agents.config import load_config
        from saath_agents.llm_gateway_client import LlmGatewayClient

        llm = LlmGatewayClient(load_config())
    else:
        llm = MockLlm()
    return A6ScreeningBroker(llm=llm, tools=tools)


def run(mode: str) -> dict:
    rows: list[dict] = []
    errors = 0
    for item in CORPUS:
        tools = CorpusTools(item)
        broker = _build_broker(mode, tools)
        t0 = time.time()
        try:
            verdict = broker.screen_pair(tools.a_id, tools.b_id)
            got = verdict.verdict.value
            score = verdict.score
            err = None
        except Exception as exc:  # noqa: BLE001 — report, don't abort the eval
            errors += 1
            got, score, err = "ERROR", 0.0, str(exc)[:200]
        ms = int((time.time() - t0) * 1000)
        expected_v = _VERDICT_MAP[item["expected"]]
        rows.append(
            dict(
                id=item["id"],
                lang=item["lang"],
                stage=item["stage"],
                adversarial=item["adversarial"],
                expected=item["expected"],
                got=got,
                score=score,
                correct=(got == expected_v),
                false_incompatible=(
                    item["id"] in POSITIVE_IDS and got == "INCOMPATIBLE"
                ),
                error=err,
                ms=ms,
            )
        )

    stage2 = [r for r in rows if r["stage"] == 2]
    stage1 = [r for r in rows if r["stage"] == 1]
    false_inc = [r["id"] for r in stage2 if r["false_incompatible"]]
    denom = len(POSITIVE_IDS)
    fi_rate = len(false_inc) / denom if denom else 0.0
    agreement = sum(1 for r in rows if r["correct"]) / len(rows) if rows else 0.0
    by_lang: dict[str, dict] = {}
    for r in stage2:
        slot = by_lang.setdefault(r["lang"], {"n": 0, "false_incompatible": 0})
        slot["n"] += 1
        if r["false_incompatible"]:
            slot["false_incompatible"] += 1
    stage1_wrong = [r["id"] for r in stage1 if not r["correct"]]

    passed = fi_rate <= FALSE_INCOMPATIBLE_MAX and not stage1_wrong and errors == 0
    report = dict(
        mode=mode,
        ts=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        n=len(rows),
        errors=errors,
        stage2=len(stage2),
        stage1=len(stage1),
        false_incompatible_rate=round(fi_rate, 4),
        false_incompatible_max=FALSE_INCOMPATIBLE_MAX,
        false_incompatible=false_inc,
        denominator=denom,
        agreement=round(agreement, 4),
        per_language=by_lang,
        stage1_wrong=stage1_wrong,
        rows=rows,
    )
    report["pass"] = passed
    return report


def _write_reports(report: dict) -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = report["ts"]
    (REPORTS_DIR / f"screening_eval_{report['mode']}_{ts}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        f"# A6 screening eval — {report['mode']} run {ts}",
        "",
        f"- pairs: {report['n']} (stage-2 {report['stage2']}, stage-1 {report['stage1']}), errors: {report['errors']}",
        f"- **false-incompatible rate: {report['false_incompatible_rate']:.1%}** "
        f"({len(report['false_incompatible'])}/{report['denominator']}, max {report['false_incompatible_max']:.0%} "
        f"→ {'PASS' if report['false_incompatible_rate'] <= report['false_incompatible_max'] else 'FAIL'})",
        f"- overall agreement: {report['agreement']:.1%}",
        f"- stage-1 short-circuit wrong: {report['stage1_wrong']}",
        "- per-language (stage-2): "
        + ", ".join(
            f"{lang}: {s['false_incompatible']}/{s['n']} FI"
            for lang, s in sorted(report["per_language"].items())
        ),
        f"- **overall: {'PASS' if report['pass'] else 'FAIL'}**",
        "",
        "| id | lang | stage | adversarial | expected | got | score | ok |",
        "|----|------|-------|-------------|----------|-----|-------|----|",
    ]
    for r in report["rows"]:
        lines.append(
            f"| {r['id']} | {r['lang']} | {r['stage']} | {'✱' if r['adversarial'] else ''} | "
            f"{r['expected']} | {r['got']} | {r['score']:.2f} | {'✓' if r['correct'] else '✗'} |"
        )
    (REPORTS_DIR / f"screening_eval_{report['mode']}_{ts}.md").write_text(
        "\n".join(lines), encoding="utf-8"
    )


def main() -> int:
    real = os.environ.get("REAL") == "1"
    mode = "real" if real else "mock"
    report = run(mode)
    _write_reports(report)
    print(
        f"\nOVERALL {mode}: FI rate {report['false_incompatible_rate']:.1%} "
        f"({len(report['false_incompatible'])}/{report['denominator']}), "
        f"agreement {report['agreement']:.1%}, errors {report['errors']}"
    )
    if real:
        print(f"Threshold {report['false_incompatible_max']:.0%}: {'PASS' if report['pass'] else 'FAIL'}")
        return 0 if report["pass"] else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
