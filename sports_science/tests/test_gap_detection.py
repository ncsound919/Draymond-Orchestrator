# sports_science/tests/test_gap_detection.py
import json

from sports_science.gap_detection import (
    MAX_GAPS_PER_REPORT,
    compute_gap_id,
    detect_gaps,
    summarize_gaps,
)

NOW = "2026-08-24T00:00:00Z"


def test_unknown_kind_fires_on_unavailable_result():
    report = {
        "vision": {"status": "unavailable", "reason": "pose model missing", "evidence_tier": "E4"}
    }
    res = detect_gaps(report, now=NOW)
    assert res["ok"] is True
    unknown = [g for g in res["gaps"] if g["kind"] == "unknown"]
    assert len(unknown) == 1
    assert "pose model missing" in unknown[0]["title"]
    assert unknown[0]["severity"] == 4
    assert unknown[0]["detected_at"] == NOW


def test_weak_evidence_kind_fires_on_e3_e4_payloads():
    report = {"metric": {"value": 1.0, "evidence_tier": "E3"}}
    e3 = detect_gaps(report, now=NOW)["gaps"]
    assert [g["kind"] for g in e3] == ["weak_evidence"]
    assert e3[0]["evidence_tier"] == "E3"
    assert e3[0]["severity"] == 3

    e4 = detect_gaps({"metric": {"value": 1.0, "evidence_tier": "E4"}}, now=NOW)["gaps"]
    assert e4[0]["severity"] == 4

    clean_tier = detect_gaps({"metric": {"value": 1.0, "evidence_tier": "E2"}}, now=NOW)
    assert clean_tier["gaps"] == []


def test_anomaly_kind_fires_on_baseline_outlier():
    series = {"series": [10.0, 10.5, 9.8, 30.0], "baseline": {"mean": 10.0, "std": 1.0}}
    res = detect_gaps(series, now=NOW)
    anomalies = [g for g in res["gaps"] if g["kind"] == "anomaly"]
    assert len(anomalies) == 1
    assert anomalies[0]["source_ref"].endswith("series[3]")
    assert anomalies[0]["severity"] == 5
    # An in-bounds series stays silent.
    calm = detect_gaps(
        {"series": [10.0, 10.5, 9.8], "baseline": {"mean": 10.0, "std": 1.0}}, now=NOW
    )
    assert calm["gaps"] == []


def test_gap_kind_fires_on_low_translation_confidence():
    report = {
        "translated_metrics": [
            {"metric": "ter", "confidence": 0.95},
            {"metric": "gravity", "confidence": 0.4},
        ]
    }
    res = detect_gaps(report, now=NOW)
    gaps = [g for g in res["gaps"] if g["kind"] == "gap"]
    assert len(gaps) == 1
    assert "gravity" in gaps[0]["title"]


def test_gap_kind_fires_on_null_spanning_ci_and_calibration_error():
    ci = detect_gaps({"ci_low": 0.45, "ci_high": 0.55}, now=NOW)
    assert [g["kind"] for g in ci["gaps"]] == ["gap"]

    calib = detect_gaps({"calibration_error": 0.2}, now=NOW)
    assert [g["kind"] for g in calib["gaps"]] == ["gap"]
    assert calib["gaps"][0]["severity"] == 4

    good = detect_gaps({"ci_low": 0.6, "ci_high": 0.9, "calibration_error": 0.05}, now=NOW)
    assert good["gaps"] == []


def test_dedup_uses_stable_content_hash_ids():
    dup = {
        "a": {"status": "unavailable", "reason": "sensor down"},
        "b": [{"status": "unavailable", "reason": "sensor down"}],
    }
    res = detect_gaps(dup, now=NOW)
    # Same content at different paths keeps distinct source refs...
    assert len(res["gaps"]) == 2
    # ...but every id is the stable content hash of kind+source_ref+title.
    assert res["gaps"][0]["gap_id"] == compute_gap_id(
        "unknown", "$.a", "sensor down"
    )
    assert res["gaps"][1]["gap_id"] == compute_gap_id(
        "unknown", "$.b[0]", "sensor down"
    )
    # Re-scanning reproduces byte-identical ids (cross-scan dedup key).
    again = detect_gaps(dup, now=NOW)
    assert [g["gap_id"] for g in res["gaps"]] == [g["gap_id"] for g in again["gaps"]]


def test_cap_enforcement_per_report():
    report = {
        f"step_{i}": {"status": "unavailable", "reason": f"missing dependency {i}"}
        for i in range(MAX_GAPS_PER_REPORT + 10)
    }
    res = detect_gaps(report, now=NOW)
    assert len(res["gaps"]) == MAX_GAPS_PER_REPORT


def test_clean_report_produces_zero_gaps():
    report = {
        "from_domain": "sports",
        "to_domain": "biotech",
        "confidence": 0.85,
        "evidence_tier": "E1",
        "translated_metrics": [
            {"metric": "ter", "source_value": 1.2, "target_value": 1.2, "confidence": 0.9},
            {"metric": "flow", "source_value": 0.5, "target_value": 0.5, "confidence": 0.8},
        ],
        "validation": {"concordance": 0.72, "ci_low": 0.61, "ci_high": 0.83,
                       "calibration_error": 0.04, "evidence_tier": "E2"},
        "series": [10.0, 10.2, 9.9],
        "baseline": {"mean": 10.0, "std": 1.0},
    }
    res = detect_gaps(report, now=NOW)
    assert res["ok"] is True
    assert res["gaps"] == []
    assert res["scanned_at"] == NOW


def test_determinism_same_input_same_output():
    report = {
        "vision": {"status": "unavailable", "reason": "model missing"},
        "translated_metrics": [{"metric": "ter", "confidence": 0.3}],
        "series": [1.0, 99.0],
        "baseline": {"mean": 1.0, "std": 2.0},
    }
    first = detect_gaps(report, now=NOW)
    second = detect_gaps(report, now=NOW)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)


def test_invalid_input_fails_honestly():
    res = detect_gaps("not a report")
    assert res["ok"] is False
    assert res["gaps"] == []


def test_summarize_counts_by_kind():
    report = {
        "a": {"status": "unavailable", "reason": "x"},
        "b": {"status": "unavailable", "reason": "y"},
        "c": {"calibration_error": 0.4},
    }
    summary = summarize_gaps(detect_gaps(report, now=NOW))
    assert summary["summary"] == {"unknown": 2, "gap": 1}
