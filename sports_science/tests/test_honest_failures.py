# sports_science/tests/test_honest_failures.py
"""require_honest converts exceptions into structured E4 UnavailableResult."""
import importlib

from sports_science.validation_engine import UnavailableResult, is_unavailable, require_honest


class FakeModelThatCrashes:
    def win_probability(self, home, away, date):
        raise FileNotFoundError("sports_model.db missing")

    def total_over_probability(self, team, line, date):
        raise FileNotFoundError("sports_model.db missing")

    def player_points_over_probability(self, player, line, date):
        raise FileNotFoundError("sports_model.db missing")

    def market_benchmark(self, from_date, to_date, max_games):
        raise FileNotFoundError("sports_model.db missing")

    def backtest(self, from_date, to_date, max_games):
        raise FileNotFoundError("sports_model.db missing")


class FakeModelThatSucceeds:
    def win_probability(self, home, away, date):
        return {"status": "ok", "win_probability": 0.55, "evidence_tier": "E2",
                "home_form": 0.5, "away_form": 0.5, "home_advantage": 0.02, "n": 100}

    def total_over_probability(self, team, line, date):
        return {"status": "ok", "over_probability": 0.48, "evidence_tier": "E2", "n": 100}

    def player_points_over_probability(self, player, line, date):
        return {"status": "ok", "over_probability": 0.51, "evidence_tier": "E2", "n": 50}

    def market_benchmark(self, from_date, to_date, max_games):
        return {"status": "ok", "model_concordance": 0.55, "evidence_tier": "E2",
                "model_ci_low": 0.50, "model_ci_high": 0.60,
                "market_concordance": 0.52, "market_ci_low": 0.48, "market_ci_high": 0.56,
                "model_minus_market": 0.03, "n": 200}

    def backtest(self, from_date, to_date, max_games):
        return {"status": "ok", "concordance": 0.54, "evidence_tier": "E2",
                "ci_low": 0.50, "ci_high": 0.58, "calibration_error": 0.04,
                "lift": 1.1, "n": 500, "home_advantage": 0.02, "form_scale": 0.15}


def test_unavailable_result_is_e4():
    r = UnavailableResult("no data", source="x")
    assert is_unavailable(r)
    assert r["evidence_tier"] == "E4"
    assert r["status"] == "unavailable"


def test_require_honest_wraps_exception_into_unavailable():
    @require_honest
    def boom(_x):
        raise FileNotFoundError("nba.sqlite not found")

    res = boom(1)
    assert is_unavailable(res)
    assert res["evidence_tier"] == "E4"
    assert "nba.sqlite" in res["reason"]


def test_require_honest_passes_through_value():
    @require_honest
    def ok(_x):
        return {"value": 1.0, "evidence_tier": "E2"}

    res = ok(1)
    assert not is_unavailable(res)
    assert res["value"] == 1.0


def test_run_model_win_prob_returns_unavailable_on_missing_db(monkeypatch):
    from sports_science import run_model
    importlib.reload(run_model)
    monkeypatch.setattr(run_model, "TeamFormModel", lambda **kw: FakeModelThatCrashes())
    res = run_model._win_prob_metrics("AAA", "BBB", "2024-01-01")
    assert is_unavailable(res) or (
        isinstance(res, list) and len(res) == 1 and
        res[0].get("evidence_tier") == "E4" and res[0].get("status") == "unavailable"
    )


def test_run_model_totals_returns_unavailable_on_missing_db(monkeypatch):
    from sports_science import run_model
    importlib.reload(run_model)
    monkeypatch.setattr(run_model, "TeamFormModel", lambda **kw: FakeModelThatCrashes())
    res = run_model._totals_metrics("LAL", 220.5, "2024-01-01")
    assert is_unavailable(res) or (
        isinstance(res, list) and len(res) == 1 and
        res[0].get("evidence_tier") == "E4" and res[0].get("status") == "unavailable"
    )


def test_run_model_player_returns_unavailable_on_missing_db(monkeypatch):
    from sports_science import run_model
    importlib.reload(run_model)
    monkeypatch.setattr(run_model, "TeamFormModel", lambda **kw: FakeModelThatCrashes())
    res = run_model._player_metrics("LeBron James", 25.5, "2024-01-01")
    assert is_unavailable(res) or (
        isinstance(res, list) and len(res) == 1 and
        res[0].get("evidence_tier") == "E4" and res[0].get("status") == "unavailable"
    )


def test_run_model_backtest_returns_unavailable_on_missing_db(monkeypatch):
    from sports_science import run_model
    importlib.reload(run_model)
    monkeypatch.setattr(run_model, "TeamFormModel", lambda **kw: FakeModelThatCrashes())
    res = run_model._backtest_metrics("2013-01-01", "2023-06-01", 100)
    assert is_unavailable(res) or (
        isinstance(res, list) and len(res) == 1 and
        res[0].get("evidence_tier") == "E4" and res[0].get("status") == "unavailable"
    )


def test_run_model_metrics_pass_through_on_success(monkeypatch):
    from sports_science import run_model
    importlib.reload(run_model)
    monkeypatch.setattr(run_model, "TeamFormModel", lambda **kw: FakeModelThatSucceeds())
    res = run_model._win_prob_metrics("LAL", "BOS", "2024-01-01")
    assert isinstance(res, list)
    assert len(res) == 1
    assert res[0]["modeled"] is True
    assert res[0]["evidence_tier"] == "E2"
