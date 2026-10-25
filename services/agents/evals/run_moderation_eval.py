"""A9 moderation eval runner (P2-05 exit criterion: scam scripts detected
>= 90% on the labelled corpus).

Usage:
  uv run python -m evals.run_moderation_eval              # mock mode (CI plumbing)
  REAL=1 uv run python -m evals.run_moderation_eval       # real Claude via Core gateway

Metrics: recall over the 40 abusive (scam-family) items — the exit bar —
plus precision over the 10 safe negatives (false alarms harm real users).
Mock mode uses a deterministic stand-in and verifies plumbing only.

Writes evals/reports/moderation_eval_{mode}_{timestamp}.json + .md.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from evals.moderation.corpus import ABUSIVE_IDS, CORPUS, SAFE_IDS

REPORTS_DIR = Path(__file__).parent / "reports"
RECALL_THRESHOLD = 0.90
# Precision floor so "flag everything" cannot pass: at most 2 of 10 safe items
# may be over-flagged.
MIN_PRECISION = 0.80


class MockLlm:
    """Plumbing-only stand-in: labels every other item scam_script, rest safe."""

    def __init__(self) -> None:
        self._n = 0

    def complete(self, **kwargs):
        self._n += 1
        label = "scam_script" if self._n % 2 == 0 else "safe"
        return {
            "text": json.dumps(
                {"label": label, "confidence": 0.9, "signals": ["mock"], "model_version": "a9-moderation-v1"}
            ),
            "model": "mock",
        }


def main() -> int:
    real = os.environ.get("REAL") == "1"
    if real:
        from saath_agents.config import load_config
        from saath_agents.llm_gateway_client import LlmGatewayClient
        from saath_agents.moderation import A9Classifier

        classify = A9Classifier(LlmGatewayClient(load_config())).classify
        mode = "real"
    else:
        from saath_agents.moderation import A9Classifier

        classify = A9Classifier(MockLlm()).classify
        mode = "mock"

    rows: list[dict] = []
    errors = 0
    for item in CORPUS:
        t0 = time.time()
        try:
            verdict = classify(str(item["text"]))
            got = verdict.label
            conf = verdict.confidence
        except Exception as exc:  # noqa: BLE001 — report, don't abort the eval
            errors += 1
            rows.append(
                dict(id=item["id"], lang=item["lang"], expected=item["expected"], got="ERROR",
                     confidence=0.0, correct=False, error=str(exc)[:200], ms=int((time.time() - t0) * 1000))
            )
            continue
        rows.append(
            dict(id=item["id"], lang=item["lang"], expected=item["expected"], got=got,
                 confidence=conf, correct=(got == item["expected"]),
                 ms=int((time.time() - t0) * 1000))
        )

    abusive = [r for r in rows if r["id"] in ABUSIVE_IDS]
    safe = [r for r in rows if r["id"] in SAFE_IDS]
    recall = sum(1 for r in abusive if r["correct"]) / len(abusive) if abusive else 0.0
    precision = sum(1 for r in safe if r["correct"]) / len(safe) if safe else 1.0
    detected = [r["id"] for r in abusive if r["correct"]]
    missed = [r["id"] for r in abusive if not r["correct"]]
    false_alarms = [r["id"] for r in safe if not r["correct"]]
    passed = recall >= RECALL_THRESHOLD and precision >= MIN_PRECISION

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = {
        "mode": mode,
        "ts": ts,
        "n": len(rows),
        "errors": errors,
        "abusive": len(abusive),
        "safe": len(safe),
        "recall": round(recall, 4),
        "precision": round(precision, 4),
        "recall_threshold": RECALL_THRESHOLD,
        "precision_floor": MIN_PRECISION,
        "detected": detected,
        "missed": missed,
        "false_alarms": false_alarms,
        "pass": passed,
        "rows": rows,
    }
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / f"moderation_eval_{mode}_{ts}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        f"# A9 moderation eval — {mode} run {ts}",
        "",
        f"- items: {len(rows)} (abusive {len(abusive)}, safe {len(safe)}), errors: {errors}",
        f"- **recall (scam-family): {recall:.1%}**  (threshold {RECALL_THRESHOLD:.0%} → {'PASS' if recall >= RECALL_THRESHOLD else 'FAIL'})",
        f"- **precision (safe negatives): {precision:.1%}**  (floor {MIN_PRECISION:.0%} → {'PASS' if precision >= MIN_PRECISION else 'FAIL'})",
        f"- missed: {missed}",
        f"- false alarms: {false_alarms}",
        f"- **overall: {'PASS' if passed else 'FAIL'}**",
        "",
        "| id | lang | expected | got | conf | ok |",
        "|----|------|----------|-----|------|----|",
    ]
    for r in rows:
        lines.append(f"| {r['id']} | {r['lang']} | {r['expected']} | {r['got']} | {r['confidence']:.2f} | {'✓' if r['correct'] else '✗'} |")
    (REPORTS_DIR / f"moderation_eval_{mode}_{ts}.md").write_text("\n".join(lines), encoding="utf-8")

    print(f"\nOVERALL {mode}: recall {recall:.1%}, precision {precision:.1%}, errors {errors}")
    if real:
        print(f"Threshold {RECALL_THRESHOLD:.0%}: {'PASS' if passed else 'FAIL'}")
        return 0 if passed else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
