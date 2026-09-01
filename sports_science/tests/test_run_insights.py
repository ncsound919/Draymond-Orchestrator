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


def test_insights_from_player_metrics_profile():
    """A player-metric profile (usage, per-100 output) synthesizes into insights
    with non-empty translated metrics — proving the translation bridge consumes
    player-level signals."""
    from sports_science.run_insights import _derived_profile
    from science_bridge.insights import synthesize
    profile = {
        "performance": {"fg": 55.0, "tp": 30.0, "ast": 5.0, "oreb": 4.0,
                        "tov": -2.5, "pf": -3.0, "defensive_attention": 0.7,
                        "court_spacing": 0.4},
        "biometrics": {"hrv": 60.0, "load": 0.75, "acute_chronic": 1.1, "sleep_hrs": 7.0},
        "player_metrics": {"usage": 0.28, "points_per_100": 32.0},
    }
    derived = _derived_profile(profile, "sports")
    report = synthesize(derived, from_domain="sports")
    assert len(report.translated_metrics) >= 4
    assert report.source_read != "no profile metrics detected"
