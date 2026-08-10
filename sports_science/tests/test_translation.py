# sports_science/tests/test_translation.py
"""Tests for the sports-side translation + insights CLI runners."""
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent


def _run(script: str, *args: str) -> dict:
    res = subprocess.run(
        [sys.executable, str(REPO / "sports_science" / script), "session", *args],
        capture_output=True,
        text=True,
        cwd=REPO,
        timeout=60,
    )
    assert res.returncode == 0, f"runner failed: {res.stdout} {res.stderr}"
    return json.loads(res.stdout)


def test_run_translate_forward():
    out = _run("run_translate.py", "jordan")
    assert out["target_term"] == "cancer_dominant"


def test_run_translate_reverse():
    out = _run("run_translate.py", "cell", "--from_biotech")
    assert out["target_term"] == "player"


def test_run_translate_preserves_value():
    out = _run("run_translate.py", "fg_pct", "--value", "45.5")
    assert out["target_value"] == 45.5


def test_run_insights_sports_to_biotech(tmp_path):
    profile = tmp_path / "p.json"
    profile.write_text(
        json.dumps({
            "ter": 1.2,
            "four_factors": {"proliferation": 70, "clearance": 40, "resource": 55, "metastasis": 45},
            "gravity": 0.6, "flow": 0.5, "fatigue": 40, "injury_risk": 0.3,
            "recovery_priority": "high", "archetype": "jordan",
        }),
        encoding="utf-8",
    )
    out = _run("run_insights.py", str(profile))
    assert out["from_domain"] == "sports"
    assert out["to_domain"] == "biotech"
    assert out["archetype_translation"] == "cancer_dominant"
    assert len(out["translated_metrics"]) > 0


def test_run_insights_biotech_to_sports(tmp_path):
    profile = tmp_path / "p.json"
    profile.write_text(
        json.dumps({
            "ter": 1.1,
            "four_factors": {"proliferation": 60, "clearance": 50, "angiogenesis": 55, "metastasis": 40},
            "tumor_gravity": 0.55, "tumor_flow": 0.5, "risk_tier": "high",
            "recurrence_risk": 0.6, "archetype": "cancer_dominant",
        }),
        encoding="utf-8",
    )
    out = _run("run_insights.py", str(profile), "--from_biotech")
    assert out["from_domain"] == "biotech"
    assert out["to_domain"] == "sports"
    assert out["source_read"]
    assert out["target_read"]
