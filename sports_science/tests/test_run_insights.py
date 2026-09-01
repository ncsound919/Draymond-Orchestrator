# sports_science/tests/test_run_insights.py
import json
import os
import tempfile

from sports_science.run_insights import run_insights


def test_verify_determinism_is_called_and_result_recorded():
    raw_profile = {
        "player_id": "TEST_99",
        "season": "2023-24",
        "games_played": 72,
        "performance": {
            "fg": 48.0,
            "tp": 2.0,
            "ast": 6.0,
            "oreb": 1.0,
            "tov": -2.0,
            "pf": -2.0,
            "defensive_attention": 0.4,
            "court_spacing": 0.5,
        },
        "biometrics": {
            "hrv": 55.0,
            "load": 0.8,
            "acute_chronic": 1.2,
            "sleep_hrs": 6.5,
        },
    }

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(raw_profile, f)
        path = f.name

    try:
        result = run_insights(path)
        assert "reproducibility_debt" in result
        assert isinstance(result["reproducibility_debt"], bool)
        assert result["reproducibility_debt"] is False
    finally:
        os.unlink(path)


def test_reproducibility_debt_is_true_when_determinism_fails(monkeypatch):
    import sports_science.run_insights as ri

    def _fails(fn, seeds, serializer=None):
        return {
            "ok": False,
            "checks": [{"seed": 1, "identical": False, "digest": "x"}],
            "evidence_tier": "E3",
            "checked_at": "2026-01-01T00:00:00Z",
        }

    monkeypatch.setattr(ri, "verify_determinism", _fails)

    raw_profile = {
        "player_id": "TEST_FAIL",
        "season": "2023-24",
        "performance": {
            "fg": 48.0,
            "tp": 2.0,
            "ast": 6.0,
            "oreb": 1.0,
            "tov": -2.0,
            "pf": -2.0,
            "defensive_attention": 0.4,
            "court_spacing": 0.5,
        },
        "biometrics": {
            "hrv": 55.0,
            "load": 0.8,
            "acute_chronic": 1.2,
            "sleep_hrs": 6.5,
        },
    }

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(raw_profile, f)
        path = f.name

    try:
        result = run_insights(path)
        assert result["reproducibility_debt"] is True
    finally:
        os.unlink(path)
