"""A2 extraction accuracy eval runner (P1-07 exit criterion: >=90% on golden set).

Usage:
  uv run python -m evals.run_extraction_eval              # mock mode (CI plumbing)
  REAL=1 uv run python -m evals.run_extraction_eval       # real Claude via Core gateway

Mock mode uses a deterministic extractor stand-in and verifies plumbing only.
Real mode requires the Core API running with LLM_GATEWAY_TRANSPORT=anthropic
(rule 4: no direct SDK calls here — everything goes through the gateway).

Writes evals/reports/extraction_eval_{mode}_{timestamp}.json + .md.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from evals.golden.personas import PERSONAS

REPORTS_DIR = Path(__file__).parent / "reports"
ACCURACY_THRESHOLD = 0.90

ENUM_FIELDS = {"diet", "marital_status", "religion_id", "community_id", "sub_community_id", "mother_tongue"}
SLUG_LIST_FIELDS = {"cities", "diet_ok", "marital_ok"}


def _norm_text(v: object) -> str:
    return re.sub(r"\s+", " ", str(v).strip().lower())


def _tokens(v: object) -> set[str]:
    return {
        t
        for t in re.split(r"[^a-z0-9.]+", _norm_text(v))
        if len(t) >= 3 or t.isdigit()
    }


# Equivalent titles so honest model paraphrases aren't penalised (kept tiny
# and reviewed — this is scorer normalisation, not ground truth).
_SYNONYMS = {
    "teacher": {"teacher", "teaching", "faculty", "tutor", "trainer"},
    "software engineer": {"software engineer", "software developer", "sde", "programmer"},
}


def _text_matches(expected: object, actual: object) -> bool:
    """Containment either way, or token overlap (handles teach/teacher,
    B.Ed/BEd, MA Political Science/M.A. Political Science)."""
    a, e = _norm_text(actual), _norm_text(expected)
    if a == e or a in e or e in a:
        return True
    for key, group in _SYNONYMS.items():
        if e in group and a in group:
            return True
    ta, te = _tokens(actual), _tokens(expected)
    if not te:
        return False
    if len(te) == 1:
        return te <= ta
    return len(te & ta) / len(te) >= 0.6


def _split_slugs(v: object) -> set[str]:
    return {s.strip().lower() for s in str(v or "").split(",") if s.strip()}


def value_matches(field: str, expected: object, actual: object) -> bool:
    if actual is None:
        return False
    if field in SLUG_LIST_FIELDS:
        return _split_slugs(expected) <= _split_slugs(actual)
    if isinstance(expected, bool):
        return actual is expected or str(actual).lower() == str(expected).lower()
    if isinstance(expected, int):
        try:
            return abs(int(actual) - expected) <= (1 if field == "height_cm" else 0)
        except (TypeError, ValueError):
            return False
    if field in ENUM_FIELDS:
        return _norm_text(actual) == _norm_text(expected)
    # short text: containment or token overlap
    return _text_matches(expected, actual)


def score_persona(extracted: dict, expected: dict) -> tuple[list[str], list[str]]:
    """Returns (matched, missed) per expected leaf check."""
    matched: list[str] = []
    missed: list[str] = []
    for section in ("profile", "preferences"):
        for field, want in (expected.get(section) or {}).items():
            node = (extracted.get(section) or {}).get(field) or {}
            got = node.get("value") if isinstance(node, dict) else None
            label = f"{section}.{field}={want!r}"
            (matched if value_matches(field, want, got) else missed).append(label)
    for want in expected.get("dealbreakers") or []:
        found = any(
            d.get("field") == want["field"]
            and (d.get("rule") or {}).get("op") == want["rule"]["op"]
            and value_matches(want["field"], json.dumps(want["rule"]["value"]), json.dumps((d.get("rule") or {}).get("value")))
            for d in extracted.get("dealbreakers") or []
        )
        label = f"dealbreaker:{want['field']}:{want['rule']['op']}:{want['rule']['value']!r}"
        (matched if found else missed).append(label)
    return matched, missed


class MockLlm:
    """Plumbing-only stand-in: extracts nothing, returns a valid empty result."""

    def complete(self, **kwargs):
        return {
            "text": json.dumps(
                {
                    "profile": {},
                    "preferences": {},
                    "dealbreakers": [],
                    "low_confidence_fields": [],
                    "confirm_questions": [],
                    "model_version": "a2-extract-v1",
                }
            ),
            "model": "mock",
        }


def main() -> int:
    real = os.environ.get("REAL") == "1"
    if real:
        from saath_agents.config import load_config
        from saath_agents.extraction.extractor import A2Extractor
        from saath_agents.llm_gateway_client import LlmGatewayClient

        llm = LlmGatewayClient(load_config())
        extract_fn = lambda transcript, pid: A2Extractor(llm).extract(
            transcript, acting_for_user_id=None
        ).model_dump()
        mode = "real"
    else:
        from saath_agents.extraction.extractor import A2Extractor

        extract_fn = lambda transcript, pid: A2Extractor(MockLlm()).extract(transcript).model_dump()
        mode = "mock"

    per_persona: list[dict] = []
    all_matched = 0
    all_checks = 0
    failures = 0
    for persona in PERSONAS:
        t0 = time.time()
        try:
            extracted = extract_fn(persona["transcript"], persona["id"])
            matched, missed = score_persona(extracted, persona["expected"])
        except Exception as exc:  # noqa: BLE001 — report, don't abort the eval
            extracted, matched, missed = {}, [], [f"ERROR: {type(exc).__name__}: {exc}"]
        all_matched += len(matched)
        all_checks += len(matched) + len(missed)
        per_persona.append(
            {
                "id": persona["id"],
                "locale": persona["locale"],
                "matched": matched,
                "missed": missed,
                "accuracy": round(len(matched) / max(1, len(matched) + len(missed)), 4),
                "seconds": round(time.time() - t0, 2),
            }
        )
        if missed:
            failures += 1
        print(f"[{persona['id']}] {len(matched)}/{len(matched) + len(missed)} "
              f"({per_persona[-1]['accuracy']:.0%})" + (f"  MISSED: {missed}" if missed else ""))

    accuracy = all_matched / max(1, all_checks)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = {
        "mode": mode,
        "model_version": "a2-extract-v1",
        "personas": len(PERSONAS),
        "checks": all_checks,
        "matched": all_matched,
        "accuracy": round(accuracy, 4),
        "threshold": ACCURACY_THRESHOLD if real else None,
        "pass": (accuracy >= ACCURACY_THRESHOLD) if real else None,
        "per_persona": per_persona,
    }
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / f"extraction_eval_{mode}_{ts}.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    md = [
        f"# A2 extraction eval ({mode}) — {ts}",
        "",
        f"- personas: {len(PERSONAS)}  checks: {all_checks}  matched: {all_matched}",
        f"- **accuracy: {accuracy:.1%}**"
        + (f"  (threshold {ACCURACY_THRESHOLD:.0%} → {'PASS' if report['pass'] else 'FAIL'})" if real else "  (mock plumbing run — no threshold)"),
        "",
    ]
    for p in per_persona:
        md.append(f"- `{p['id']}` ({p['locale']}) {p['accuracy']:.0%} — missed: {p['missed'] or 'none'}")
    (REPORTS_DIR / f"extraction_eval_{mode}_{ts}.md").write_text("\n".join(md), encoding="utf-8")

    print(f"\nOVERALL {mode}: {accuracy:.1%} ({all_matched}/{all_checks})")
    if real:
        print(f"Threshold {ACCURACY_THRESHOLD:.0%}: {'PASS' if report['pass'] else 'FAIL'}")
        return 0 if report["pass"] else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
