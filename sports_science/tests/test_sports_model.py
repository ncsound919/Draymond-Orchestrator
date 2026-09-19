# tests/test_sports_model.py — bbtech → Sports Steve / Bet Buddy model bridge
"""End-to-end tests over the REAL NBA warehouse (nba.sqlite). These assert the
model is honest: probabilities are in (0,1), unknown inputs degrade to E4, and
the backtest concordance CI excludes 0.5 (real signal, not theater)."""

import pytest

from sports_science.sports_model import (
    TeamFormModel,
    model_total_over,
    model_win_probability,
)


def _dataset_available() -> bool:
    try:
        TeamFormModel()
        return True
    except FileNotFoundError:
        return False


pytestmark = pytest.mark.skipif(
    not _dataset_available(),
    reason="NBA dataset not present",
)


@pytest.fixture(scope="module")
def model():
    return TeamFormModel()


def test_model_loads_teams(model):
    teams = model.teams()
    assert "GSW" in teams
    assert "LAL" in teams


def test_win_probability_shape(model):
    result = model.win_probability("GSW", "LAL", "2023-05-01")
    assert result["status"] == "ok"
    assert result["modeled"] is True
    assert 0.0 < result["win_probability"] < 1.0
    assert result["evidence_tier"] in ("E2", "E3")
    assert "provenance" in result


def test_win_probability_site_swaps_change_probability(model):
    """Home advantage means P(GSW home vs MIA) != P(GSW away vs MIA)."""
    p_home = model.win_probability("BOS", "MIA", "2022-06-01")["win_probability"]
    p_away = model.win_probability("MIA", "BOS", "2022-06-01")["win_probability"]
    assert 0.0 < p_home < 1.0
    assert 0.0 < p_away < 1.0
    # Home-court advantage inflates the home side relative to the away side.
    assert p_home + p_away > 1.0


def test_win_probability_unknown_team_degrades(model):
    result = model.win_probability("ZZZ", "LAL", "2023-05-01")
    assert result["status"] == "unavailable"
    assert result["evidence_tier"] == "E4"
    assert result["modeled"] is False


def test_total_over_probability_shape(model):
    result = model.total_over_probability("GSW", 225.0, "2023-05-01")
    assert result["status"] == "ok"
    assert result["modeled"] is True
    assert 0.0 < result["over_probability"] < 1.0
    assert 0.0 < result["under_probability"] < 1.0
    assert result["under_probability"] == pytest.approx(1.0 - result["over_probability"], abs=1e-6)


def test_total_insufficient_data_degrades(model):
    result = model.total_over_probability("GSW", 225.0, "1950-01-01")
    assert result["status"] == "unavailable"
    assert result["evidence_tier"] == "E4"


def test_convenience_functions():
    assert model_win_probability("GSW", "LAL", "2023-05-01")["modeled"] is True
    assert model_total_over("GSW", 225.0, "2023-05-01")["modeled"] is True


def test_backtest_concordance_excludes_chance(model):
    """The core honesty gate: the model must beat 0.5 out-of-fold."""
    result = model.backtest(from_date="2015-01-01", to_date="2023-06-01", max_games=300)
    assert result["status"] == "ok"
    assert result["n"] >= 40
    assert result["concordance"] > 0.5
    assert result["ci_low"] > 0.5 or result["ci_high"] < 0.5
    assert result["evidence_tier"] == "E2"
    assert result["lift"] > 1.0


# ---------------------------------------------------------------------------
# sports_model.db capabilities (player props + market benchmark)
# ---------------------------------------------------------------------------


def _model_db_available() -> bool:
    from sports_science.datasets_config import model_db_path

    p = model_db_path()
    return p is not None and p.exists()


model_db_tests = pytest.mark.skipif(
    not _model_db_available(),
    reason="sports_model.db not built (run prepare_datasets.py)",
)


@model_db_tests
def test_player_points_over_probability(model):
    result = model.player_points_over_probability("LeBron James", 25.5, "2018-04-01")
    assert result["status"] == "ok"
    assert result["modeled"] is True
    assert 0.0 < result["over_probability"] < 1.0
    assert result["n"] >= 5
    assert result["evidence_tier"] in ("E2", "E3")


@model_db_tests
def test_player_unknown_degrades(model):
    result = model.player_points_over_probability("Not A Real Player XYZ", 10.0, "2018-04-01")
    assert result["status"] == "unavailable"
    assert result["evidence_tier"] == "E4"
    assert result["modeled"] is False


@model_db_tests
def test_market_benchmark_reports_model_vs_market(model):
    """Honesty gate: the benchmark reports BOTH model and market concordance
    side by side — the model is not claimed to beat the book unless it does."""
    result = model.market_benchmark(from_date="2015-01-01", to_date="2018-06-01", max_games=300)
    assert result["status"] == "ok"
    assert result["n"] >= 40
    assert 0.0 < result["model_concordance"] < 1.0
    assert 0.0 < result["market_concordance"] < 1.0
    assert "model_minus_market" in result