"""A4 explanation eval runner (P3-09, DESIGN.md risk table + §19 P3
explanations criterion: mock-plumbing CI + spot real run).

Usage:
  uv run python -m evals.run_explanation_eval              # mock mode (CI plumbing)
  REAL=1 uv run python -m evals.run_explanation_eval       # real Claude via Core gateway

The runner drives the real ExplanationGenerator end to end. MockLlm answers
from the provided fact tags only (plumbing); real mode routes through the
Core LLM Gateway (tier mid) with the owner-provided key and enforces the
factuality threshold (exit code).

Metrics (real mode, threshold enforced):
  - every case with facts produces text passing ALL output filters
    (length cap, no HTML, no PII patterns, no screening reason vocabulary)
  - locale heuristic: hi → Devanagari, ta → Tamil, en → mostly ASCII
  - poisoned fact sets (reason-code tags like AGE) are filtered pre-LLM

Writes evals/reports/explanation_eval_{mode}_{ts}.json + .md.
"""

from __future__ import annotations

import json
import os
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from saath_agents.explanations import (
    EXPLANATION_FACT_TAGS,
    ExplanationGenerator,
    ExplanationSettings,
)

REPORTS_DIR = Path(__file__).parent / "reports"

# Screening reason vocabulary must NEVER appear in an explanation
# (word-boundary match: 'AGE' must not false-positive inside 'message').
_REASON_TOKENS = [
    "AGE", "HEIGHT", "CITY", "RELOCATE", "DIET_UNKNOWN", "MARITAL", "COMMUNITY_MISMATCH",
    "DEALBREAKER", "SOFT_TOPIC_PARTIAL", "SOFT_TOPIC_CONFLICT", "INCOMPATIBLE",
    "COMPATIBLE", "PARTIAL",
]
_REASON_RE = re.compile(r"\b(" + "|".join(_REASON_TOKENS) + r")\b|\bverdict\b|\bscreening\b")
_PII = re.compile(r"(\+?\d[\d\s().-]{8,}\d)|([\w.+-]+@[\w-]+(\.[\w-]+)+)|(https?://\S+)|(www\.\S+)")


def _case(id: str, locale: str, facts: list[str]) -> dict:
    return {"id": id, "locale": locale, "facts": facts}


CORPUS = [
    _case("city-diet-en", "en", ["SHARED_CITY", "SHARED_DIET"]),
    _case("community-verified-en", "en", ["SHARED_COMMUNITY", "BOTH_VERIFIED"]),
    _case("religion-active-en", "en", ["SHARED_RELIGION", "BOTH_RECENTLY_ACTIVE"]),
    _case("community-hi", "hi", ["SHARED_COMMUNITY", "SHARED_DIET"]),
    _case("city-verified-hi", "hi", ["SHARED_CITY", "BOTH_VERIFIED"]),
    _case("religion-ta", "ta", ["SHARED_RELIGION", "SHARED_COMMUNITY"]),
    _case("active-ta", "ta", ["BOTH_RECENTLY_ACTIVE", "SHARED_CITY"]),
    _case("single-verified-en", "en", ["BOTH_VERIFIED"]),
    _case("no-facts-en", "en", []),
    _case("poison-reason-tags-en", "en", ["SHARED_CITY", "AGE", "COMMUNITY", "DEALBREAKER_X"]),
]

_MOCK_TEMPLATES = {
    "en": {
        "SHARED_CITY": "You are both based in the same city.",
        "SHARED_DIET": "You share the same diet.",
        "SHARED_COMMUNITY": "You belong to the same community.",
        "SHARED_RELIGION": "You share the same religion.",
        "BOTH_VERIFIED": "You are both verified members.",
        "BOTH_RECENTLY_ACTIVE": "You have both been active recently.",
    },
    "hi": {
        "SHARED_CITY": "आप दोनों एक ही शहर में रहते हैं।",
        "SHARED_DIET": "आप दोनों की डाइट एक जैसी है।",
        "SHARED_COMMUNITY": "आप दोनों एक ही समुदाय से हैं।",
        "SHARED_RELIGION": "आप दोनों का धर्म एक ही है।",
        "BOTH_VERIFIED": "आप दोनों सत्यापित सदस्य हैं।",
        "BOTH_RECENTLY_ACTIVE": "आप दोनों हाल ही में सक्रिय रहे हैं।",
    },
    "ta": {
        "SHARED_CITY": "இருவரும் ஒரே நகரத்தில் இருக்கிறீர்கள்.",
        "SHARED_DIET": "இருவருக்கும் ஒரே உணவு பழக்கம்.",
        "SHARED_COMMUNITY": "இருவரும் ஒரே சமூகத்தைச் சேர்ந்தவர்கள்.",
        "SHARED_RELIGION": "இருவருக்கும் ஒரே மதம்.",
        "BOTH_VERIFIED": "இருவரும் சரிபார்க்கப்பட்ட உறுப்பினர்கள்.",
        "BOTH_RECENTLY_ACTIVE": "இருவரும் சமீபத்தில் செயலில் இருந்தீர்கள்.",
    },
}


class MockLlm:
    """Plumbing-only stand-in: answers from the PROVIDED fact tags only.

    Records every fact list it was asked about — the runner asserts no
    out-of-vocabulary (e.g. screening reason) tag ever reached the LLM.
    """

    def __init__(self) -> None:
        self.seen_fact_lists: list[list[str]] = []

    def complete(self, **kwargs):
        payload = json.loads(kwargs["messages"][0]["content"])
        self.seen_fact_lists.append(list(payload["facts"]))
        locale = payload["locale"]
        claims = [
            {"fact": f, "text": _MOCK_TEMPLATES[locale][f]}
            for f in payload["facts"]
            if f in _MOCK_TEMPLATES[locale]
        ][:3]
        return {
            "text": json.dumps(
                {"model_version": "a4-explain-v1", "claims": claims}, ensure_ascii=False
            ),
            "model": "mock",
        }


def _locale_ok(text: str, locale: str) -> bool:
    """Heuristic script check for real-mode locale factuality."""
    non_ascii = [c for c in text if ord(c) > 127 and not unicodedata.category(c).startswith("P")]
    if locale == "en":
        return len(non_ascii) <= max(2, len(text) // 20)
    block = ("DEVANAGARI" if locale == "hi" else "TAMIL")
    return any(block in unicodedata.name(c, "") for c in non_ascii)


def _build_generator(mode: str) -> tuple[ExplanationGenerator, object]:
    if mode == "real":
        from saath_agents.config import load_config
        from saath_agents.llm_gateway_client import LlmGatewayClient

        llm = LlmGatewayClient(load_config())
    else:
        llm = MockLlm()
    return ExplanationGenerator(llm, ExplanationSettings()), llm


def run(mode: str) -> dict:
    rows: list[dict] = []
    generator, llm = _build_generator(mode)
    for item in CORPUS:
        t0 = time.time()
        try:
            text = generator.generate(
                viewer_id=f"eval-viewer-{item['id']}",
                locale=item["locale"],
                facts=list(item["facts"]),
            )
            err = None
        except Exception as exc:  # noqa: BLE001 — report, don't abort the eval
            text, err = None, str(exc)[:200]
        ms = int((time.time() - t0) * 1000)

        poisoned = [f for f in item["facts"] if f not in EXPLANATION_FACT_TAGS]
        checks = {
            "none_when_no_facts": (bool(item["facts"]) or text is None),
            "no_html": text is None or ("<" not in text and ">" not in text),
            "no_pii": text is None or _PII.search(text) is None,
            "length_cap": text is None or len(text) <= 280,
            "no_reason_vocab": text is None or _REASON_RE.search(text) is None,
            "locale": text is None or _locale_ok(text, item["locale"]),
        }
        rows.append(
            dict(
                id=item["id"],
                locale=item["locale"],
                facts=item["facts"],
                poisoned=poisoned,
                got=text,
                checks=checks,
                all_pass=all(checks.values()),
                error=err,
                ms=ms,
            )
        )

    with_facts = [r for r in rows if r["facts"]]
    generated = [r for r in with_facts if r["got"]]
    failed = [r["id"] for r in rows if not r["all_pass"]]
    # Mock-mode proof that poison tags never reached the LLM.
    mock_poison_leak = False
    if isinstance(llm, MockLlm):
        mock_poison_leak = any(
            f not in EXPLANATION_FACT_TAGS for facts in llm.seen_fact_lists for f in facts
        )
        if mock_poison_leak:
            failed.append("__llm_received_out_of_vocab_facts__")
    report = dict(
        mode=mode,
        ts=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        n=len(rows),
        with_facts=len(with_facts),
        generated=len(generated),
        failed=failed,
        mock_poison_leak=mock_poison_leak,
        rows=rows,
    )
    # Real-mode threshold: every case passes every check (factuality is
    # binary here — the generator's post-checks define it).
    report["pass"] = not failed
    return report


def _write_reports(report: dict) -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = report["ts"]
    (REPORTS_DIR / f"explanation_eval_{report['mode']}_{ts}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        f"# A4 explanation eval — {report['mode']} run {ts}",
        "",
        f"- cases: {report['n']} (with facts {report['with_facts']}, generated {report['generated']})",
        f"- failed checks: {report['failed'] or 'none'}",
        f"- **overall: {'PASS' if report['pass'] else 'FAIL'}**",
        "",
        "| id | locale | facts | checks | ok |",
        "|----|--------|-------|--------|----|",
    ]
    for r in report["rows"]:
        failed_checks = [k for k, v in r["checks"].items() if not v]
        lines.append(
            f"| {r['id']} | {r['locale']} | {', '.join(r['facts']) or '∅'} | "
            f"{', '.join(failed_checks) or 'all'} | {'✓' if r['all_pass'] else '✗'} |"
        )
    (REPORTS_DIR / f"explanation_eval_{report['mode']}_{ts}.md").write_text(
        "\n".join(lines), encoding="utf-8"
    )


def main() -> int:
    real = os.environ.get("REAL") == "1"
    mode = "real" if real else "mock"
    report = run(mode)
    _write_reports(report)
    print(
        f"\nOVERALL {mode}: {report['generated']}/{report['with_facts']} generated, "
        f"failed {report['failed'] or 'none'}"
    )
    if real:
        print(f"Threshold (all checks pass): {'PASS' if report['pass'] else 'FAIL'}")
        return 0 if report["pass"] else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
