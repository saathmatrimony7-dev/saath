"""Corpus integrity + mock-plumbing tests for the P3-06 screening eval.

CI-green proof that the labelled corpus meets the plan's shape (Q3: 60
stage-2 pairs en 30 / hi 18 / Hinglish 12, ≥15 adversarial near-misses;
stage-1 short-circuit items) and that the eval runner executes end to end
against the deterministic mock (ADR-0008: mock verifies plumbing in CI, the
accuracy bar is enforced only on the REAL=1 checkpoint run).
"""

from __future__ import annotations

from evals.run_screening_eval import CorpusTools, _user_ids, run
from evals.screening.corpus import CORPUS, POSITIVE_IDS, STAGE1_IDS, STAGE2_IDS
from saath_agents.schemas.screening import RedactedSnapshot

STANCE_MAX = 200
TOPIC_MAX = 64


def test_corpus_shape_and_language_split():
    assert len(CORPUS) >= 60
    assert len(STAGE2_IDS) == 60
    assert len(STAGE1_IDS) == 6
    langs = {}
    for item in CORPUS:
        if item["stage"] == 2:
            langs[item["lang"]] = langs.get(item["lang"], 0) + 1
    assert langs == {"en": 30, "hi": 18, "hinglish": 12}


def test_corpus_ids_unique_and_labels_valid():
    ids = [i["id"] for i in CORPUS]
    assert len(ids) == len(set(ids))
    for item in CORPUS:
        assert item["expected"] in ("compatible", "partial", "incompatible")
        assert item["stage"] in (1, 2)
        if item["stage"] == 1:
            assert item["expected"] == "incompatible"
            assert item["stage1"]["compatible"] is False
            assert item["stage1"]["reasonCodes"]
        else:
            assert item["stage1"]["compatible"] is True


def test_adversarial_near_miss_count():
    n = sum(1 for i in CORPUS if i["stage"] == 2 and i["adversarial"])
    assert n >= 15, f"only {n} adversarial near-miss pairs"


def test_expected_distribution_and_denominator():
    expected = {}
    for item in CORPUS:
        if item["stage"] == 2:
            expected[item["expected"]] = expected.get(item["expected"], 0) + 1
    assert expected["compatible"] >= 15
    assert expected["partial"] >= 10
    assert expected["incompatible"] >= 10
    assert len(POSITIVE_IDS) == expected["compatible"] + expected["partial"]


def test_stances_bounded_and_snapshots_schema_valid():
    for item in CORPUS:
        for side_key in ("a", "b"):
            side = item[side_key]
            assert side["stances"], f"{item['id']}:{side_key} has no stances"
            for s in side["stances"]:
                assert 1 <= len(s["stance"]) <= STANCE_MAX
                assert 1 <= len(s["topic"]) <= TOPIC_MAX
                assert 0 <= s["weight"] <= 100
            uid, _ = _user_ids(item)
            bundle = CorpusTools(item).get_preference_snapshot(
                uid if side_key == "a" else _user_ids(item)[1]
            )
            RedactedSnapshot.model_validate(bundle["snapshot"])


def test_mock_run_executes_full_pipeline():
    report = run("mock")
    assert report["mode"] == "mock"
    assert report["n"] == len(CORPUS)
    assert report["errors"] == 0
    # mock answers 'compatible' everywhere: every stage-1 item still short-
    # circuits to INCOMPATIBLE (the deterministic path), and all stage-2
    # items rate COMPATIBLE.
    assert report["stage1_wrong"] == []
    stage2_gots = {r["got"] for r in report["rows"] if r["stage"] == 2}
    assert stage2_gots == {"COMPATIBLE"}
    # verdicts came back through the strict schema with scores in range
    for r in report["rows"]:
        assert 0.0 <= r["score"] <= 1.0
    # false-incompatible is empty under an all-compatible mock (it only
    # counts good pairs rated INCOMPATIBLE)
    assert report["false_incompatible"] == []
    assert report["false_incompatible_rate"] == 0.0
    # agreement = exactly the compatible-labelled stage-2 items + stage-1s
    compat = {i["id"] for i in CORPUS if i["stage"] == 2 and i["expected"] == "compatible"}
    correct_ids = {r["id"] for r in report["rows"] if r["correct"]}
    assert correct_ids == compat | set(STAGE1_IDS)


def test_mock_run_hindi_text_roundtrips():
    report = run("mock")
    hi_row = next(r for r in report["rows"] if r["id"] == "scr-hi-001")
    assert hi_row["got"] == "COMPATIBLE"
    assert hi_row["error"] is None
