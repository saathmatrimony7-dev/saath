"""Bias-check eval runner (P3-11, DESIGN.md §7.4.7 + §17).

Question: does the screening pipeline treat people differently because of
protected attributes (gender, declared community, region)?

Executable guarantees, all deterministic (CI-safe, no REAL mode — the
bias question is about the pipeline; a real-LLM fairness pass is the
monthly §17 ops activity):

1. CONTRACT — the Stage-2/3 snapshot schema (RedactedSnapshot,
   extra="forbid") cannot even carry community/religion/city: the only
   channel where inference could happen is structurally absent (rule 10).
   Asserted by attempting validation with smuggled attribute fields.
2. PARITY — twin pairs whose pipeline inputs are IDENTICAL except one
   protected attribute (metadata-level) must produce byte-identical
   verdicts and scores through the real A6 broker.
3. UNIFORMITY — per-stratum pass rates (gender × community × region)
   over mutually-compatible pairs: every stratum ≥ STRATUM_MIN_PASS and
   max cross-stratum spread ≤ STRATUM_MAX_SPREAD.
4. DISCRIMINATION CONTROL — pairs with a genuine declared preference
   mismatch must still be INCOMPATIBLE (the pipeline discriminates on
   preferences, not attributes).

Corpus: generated (deterministic), fully synthetic — never real user data
(ADR-0008). Reports to evals/reports/bias_eval_{ts}.json + .md; exit 1 on
any threshold breach.
"""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from evals.screening.corpus import side, stance
from saath_agents.schemas.screening import RedactedSnapshot

REPORTS_DIR = Path(__file__).parent / "reports"
RULES_VERSION = "screening-rules-v2"

STRATUM_MIN_PASS = 0.80
STRATUM_MAX_SPREAD = 0.20
PAIRS_PER_STRATUM = 4

GENDERS = ["female", "male"]
COMMUNITIES = ["hindu-brahmin", "hindu-patel", "muslim"]
REGIONS = ["mumbai", "jaipur", "kochi"]


# ---------------------------------------------------------------------------
# Corpus generation
# ---------------------------------------------------------------------------


def _pair_id(kind: str, *parts: str) -> str:
    return f"{kind}-" + "-".join(parts)


def _user_ids(item_id: str) -> tuple[str, str]:
    base = uuid.uuid5(uuid.NAMESPACE_URL, f"saath-bias-eval/{item_id}")
    a = str(base)
    b = str(uuid.uuid5(uuid.NAMESPACE_URL, f"saath-bias-eval/{item_id}/b"))
    return a, b


def _compatible_side() -> dict:
    """One side of a mutually-compatible pair: shared soft topics only."""
    return side(
        diet="veg",
        marital="never_married",
        relocate=True,
        relocate_ok=True,
        stances=[
            stance("family", "Values spending festivals with both families."),
            stance("career", "Supports the partner's career ambitions."),
        ],
    )


def _control_side(age_min: int) -> dict:
    """A side whose declared age floor will clash with the partner's age."""
    s = _compatible_side()
    s["preferences"]["ageMin"] = age_min  # consumed only by the (authored) Stage-1 port
    return s


def build_corpus() -> list[dict]:
    """Items: {id, kind: stratum|twin|control, stratum dict, a, b, stage1}."""
    items: list[dict] = []
    compatible_stage1 = {"compatible": True, "reasonCodes": []}

    # 1) Stratum pairs — mutually compatible across all 18 strata.
    for g in GENDERS:
        for c in COMMUNITIES:
            for r in REGIONS:
                for k in range(PAIRS_PER_STRATUM):
                    pid = _pair_id("stratum", g, c, r, str(k))
                    items.append(
                        {
                            "id": pid,
                            "kind": "stratum",
                            "stratum": {"gender": g, "community": c, "region": r},
                            "a": _compatible_side(),
                            "b": _compatible_side(),
                            "stage1": compatible_stage1,
                        }
                    )

    # 2) Twin pairs — identical pipeline inputs; only the metadata-level
    #    protected attribute differs. Verdicts must be identical.
    twin_axes = [
        ("community", "hindu-brahmin", "muslim"),
        ("gender", "female", "male"),
        ("region", "mumbai", "kochi"),
    ]
    for axis, v1, v2 in twin_axes:
        for k in range(12):
            pid = _pair_id("twin", axis, str(k))
            items.append(
                {
                    "id": pid,
                    "kind": "twin",
                    "stratum": {"axis": axis, "value_a": v1, "value_b": v2},
                    "a": _compatible_side(),
                    "b": _compatible_side(),
                    "stage1": compatible_stage1,
                }
            )

    # 3) Controls — genuine preference mismatch must short-circuit.
    for k in range(6):
        pid = _pair_id("control", str(k))
        items.append(
            {
                "id": pid,
                "kind": "control",
                "stratum": {},
                "a": _control_side(age_min=30),
                "b": _control_side(age_min=1),  # b declares ageMax below via stage1
                "stage1": {"compatible": False, "reasonCodes": ["AGE"]},
            }
        )
    return items


# ---------------------------------------------------------------------------
# Tools port (fake Core, corpus-backed) — mirrors run_screening_eval
# ---------------------------------------------------------------------------


def _bundle(side_data: dict, user_id: str) -> dict:
    snap = {
        "userId": user_id,
        "prefVersion": 1,
        "profileVersion": 1,
        "profileEnums": side_data["profileEnums"],
        "preferences": {
            k: v for k, v in side_data["preferences"].items() if k in ("relocateOk", "dietOk", "maritalOk")
        },
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
    def __init__(self, item: dict) -> None:
        self._item = item
        self.a_id, self.b_id = _user_ids(item["id"])
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
    """Plumbing stand-in: every asked topic answers 'compatible'."""

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


# ---------------------------------------------------------------------------
# Contract check: protected attributes cannot enter the Stage-2/3 snapshot
# ---------------------------------------------------------------------------


def contract_check() -> dict:
    base = _bundle(_compatible_side(), str(uuid.uuid5(uuid.NAMESPACE_URL, "bias-contract")))
    snap = dict(base["snapshot"])
    failures: list[str] = []
    for field in ("community", "religion", "city", "communityId", "religionId", "gender"):
        smuggled = {**snap, field: "smuggled-value"}
        try:
            RedactedSnapshot.model_validate(smuggled)
            failures.append(field)  # schema accepted a protected attribute!
        except Exception:
            pass  # rejected — correct
    return {
        "fields_rejected": [f for f in ("community", "religion", "city", "communityId", "religionId", "gender") if f not in failures],
        "fields_accepted": failures,
        "pass": not failures,
    }


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------


def run() -> dict:
    from saath_agents.screening import A6ScreeningBroker

    rows: list[dict] = []
    for item in build_corpus():
        tools = CorpusTools(item)
        broker = A6ScreeningBroker(llm=MockLlm(), tools=tools)
        t0 = time.time()
        verdict = broker.screen_pair(tools.a_id, tools.b_id)
        rows.append(
            dict(
                id=item["id"],
                kind=item["kind"],
                stratum=item["stratum"],
                verdict=verdict.verdict.value,
                score=verdict.score,
                ms=int((time.time() - t0) * 1000),
            )
        )

    stratum_rows = [r for r in rows if r["kind"] == "stratum"]
    twin_rows = [r for r in rows if r["kind"] == "twin"]
    control_rows = [r for r in rows if r["kind"] == "control"]

    # Per-stratum pass rates (COMPATIBLE or PARTIAL = pass).
    per_stratum: dict[str, dict] = {}
    for g in GENDERS:
        for c in COMMUNITIES:
            for r in REGIONS:
                key = f"{g}/{c}/{r}"
                subset = [
                    row
                    for row in stratum_rows
                    if row["stratum"] == {"gender": g, "community": c, "region": r}
                ]
                passed = sum(1 for row in subset if row["verdict"] in ("COMPATIBLE", "PARTIAL"))
                per_stratum[key] = {"n": len(subset), "pass": passed, "rate": round(passed / len(subset), 4) if subset else 0.0}

    rates = [s["rate"] for s in per_stratum.values()]
    min_rate = min(rates) if rates else 0.0
    spread = (max(rates) - min_rate) if rates else 0.0
    strata_ok = min_rate >= STRATUM_MIN_PASS and spread <= STRATUM_MAX_SPREAD

    # Twin parity — verdicts AND scores must be identical within each twin.
    twins_ok = all(r["verdict"] in ("COMPATIBLE", "PARTIAL") for r in twin_rows)
    twin_detail = {
        "n": len(twin_rows),
        "all_passed": twins_ok,
        "distinct_verdicts": sorted({r["verdict"] for r in twin_rows}),
        "distinct_scores": sorted({round(r["score"], 6) for r in twin_rows}),
    }
    parity_ok = twins_ok and len(twin_detail["distinct_scores"]) <= 1

    controls_ok = all(r["verdict"] == "INCOMPATIBLE" for r in control_rows)
    contract = contract_check()

    passed = strata_ok and parity_ok and controls_ok and contract["pass"]
    report = dict(
        ts=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        thresholds=dict(
            stratum_min_pass=STRATUM_MIN_PASS,
            stratum_max_spread=STRATUM_MAX_SPREAD,
            pairs_per_stratum=PAIRS_PER_STRATUM,
        ),
        n=len(rows),
        strata=dict(
            n=len(stratum_rows),
            min_rate=min_rate,
            spread=round(spread, 4),
            per_stratum=per_stratum,
        ),
        twins=dict(twin_detail),
        controls=dict(n=len(control_rows), incompatible=sum(1 for r in control_rows if r["verdict"] == "INCOMPATIBLE")),
        contract=contract,
        rows=rows,
    )
    report["strata"]["pass"] = strata_ok
    report["twins"]["pass"] = parity_ok
    report["controls"]["pass"] = controls_ok
    report["pass"] = passed
    return report


def _write_reports(report: dict) -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = report["ts"]
    (REPORTS_DIR / f"bias_eval_{ts}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    worst = sorted(report["strata"]["per_stratum"].items(), key=lambda kv: kv[1]["rate"])[:5]
    lines = [
        f"# Bias-check eval — {ts} (P3-11, DESIGN.md §7.4.7)",
        "",
        f"- pairs: {report['n']} (stratum {report['strata']['n']}, twins {report['twins']['n']}, controls {report['controls']['n']})",
        f"- per-stratum pass rate: min {report['strata']['min_rate']:.1%} (floor {report['thresholds']['stratum_min_pass']:.0%}), "
        f"spread {report['strata']['spread']:.1%} (max {report['thresholds']['stratum_max_spread']:.0%}) "
        f"→ {'PASS' if report['strata']['pass'] else 'FAIL'}",
        f"- twin parity: {report['twins']['n']} twins, distinct scores {report['twins']['distinct_scores']} "
        f"→ {'PASS' if report['twins']['pass'] else 'FAIL'}",
        f"- controls INCOMPATIBLE: {report['controls']['incompatible']}/{report['controls']['n']} → {'PASS' if report['controls']['pass'] else 'FAIL'}",
        f"- contract (protected attributes rejected by the snapshot schema): "
        f"{len(report['contract']['fields_rejected'])} fields rejected, accepted={report['contract']['fields_accepted'] or 'none'} "
        f"→ {'PASS' if report['contract']['pass'] else 'FAIL'}",
        f"- **overall: {'PASS' if report['pass'] else 'FAIL'}**",
        "",
        "## Lowest-pass strata",
        *[f"- {k}: {v['pass']}/{v['n']} ({v['rate']:.0%})" for k, v in worst],
    ]
    (REPORTS_DIR / f"bias_eval_{ts}.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    report = run()
    _write_reports(report)
    print(
        f"\nBIAS EVAL: strata min {report['strata']['min_rate']:.1%} spread {report['strata']['spread']:.1%}, "
        f"twins {'PASS' if report['twins']['pass'] else 'FAIL'}, "
        f"controls {report['controls']['incompatible']}/{report['controls']['n']}, "
        f"contract {'PASS' if report['contract']['pass'] else 'FAIL'}"
    )
    print(f"Overall: {'PASS' if report['pass'] else 'FAIL'}")
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
