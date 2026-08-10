# biotech_science/tests/test_runners.py
"""CLI runner tests — mirrors test_runners.py for sports."""
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent


def _run(script: str, *args: str) -> dict:
    res = subprocess.run(
        [sys.executable, str(REPO / "biotech_science" / script), "session", *args],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=60,
    )
    assert res.returncode == 0, f"runner failed: {res.stdout} {res.stderr}"
    return json.loads(res.stdout)


def test_run_analysis_smoke(tmp_path):
    fixture = tmp_path / "tumor.json"
    fixture.write_text(
        json.dumps(
            {
                "cancer_type": "lung",
                "tumor": {
                    "ki67": 70.0,
                    "apoptotic_index": 40.0,
                    "microvessel_density": 55.0,
                    "ctc_count": 8.0,
                    "mutational_burden": 60.0,
                    "immune_infiltrate": 40.0,
                },
                "clinical": {
                    "tumor_size_cm": 3.5,
                    "grade": 3,
                    "age": 58,
                    "receptor_status": {"ER_positive": False, "HER2_positive": True},
                },
                "treatment": {"ctdna": 0.3, "tumor_shrinkage_pct": 25, "time_point_months": 6},
            }
        ),
        encoding="utf-8",
    )
    out = _run("run_analysis.py", str(fixture))
    assert "ter" in out
    assert "risk_tier" in out
    assert "four_factors" in out
    assert "archetype" in out


def test_run_analysis_missing_dataset_errors():
    res = subprocess.run(
        [sys.executable, str(REPO / "biotech_science" / "run_analysis.py"), "session", "nonexistent.json"],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=60,
    )
    assert res.returncode != 0
    out = json.loads(res.stdout)
    assert "error" in out


def test_run_translate_forward():
    out = _run("run_translate.py", "jordan")
    assert out["target_term"] == "cancer_dominant"


def test_run_translate_reverse():
    out = _run("run_translate.py", "cell", "--from_biotech")
    assert out["target_term"] == "player"


def test_run_translate_preserves_value():
    out = _run("run_translate.py", "fg_pct", "--value", "45.5")
    assert out["target_value"] == 45.5


def test_run_treatment(tmp_path):
    metrics = tmp_path / "metrics.json"
    metrics.write_text(
        json.dumps({"risk_tier": "HIGH", "malignancy_class": "ELITE_MALIGNANT", "ter": 30.0, "composite_score": 80.0}),
        encoding="utf-8",
    )
    out = _run("run_treatment.py", str(metrics))
    assert out["status"] == "ok"
    assert out["risk_tier"] == "high"
    assert "recommendation" in out
