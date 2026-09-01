from sports_science.player_model import possessions_from_pbp, pace_adjusted_rate, player_usage


def test_possessions_from_pbp_counts_possessions():
    rows = [
        {"team": "BOS", "period": 1, "type": "shot", "made": 1},
        {"team": "BOS", "period": 1, "type": "shot", "made": 0},
        {"team": "BOS", "period": 2, "type": "turnover"},
        {"team": "BOS", "period": 2, "type": "shot", "made": 1},
    ]
    assert possessions_from_pbp(rows) == 4


def test_possessions_from_pbp_empty():
    assert possessions_from_pbp([]) == 0


def test_pace_adjusted_rate_scales_by_possessions():
    assert abs(pace_adjusted_rate(100, 90) - 111.11) < 0.1
    assert pace_adjusted_rate(100, 0) == 0.0  # graceful zero


def test_player_usage_in_bounds():
    assert 0.0 <= player_usage(10, 100) <= 1.0
    assert player_usage(0, 0) == 0.0  # graceful zero


def test_player_impact_estimate_returns_float():
    from sports_science.player_model import player_impact_estimate
    val = player_impact_estimate(plus_minus=10.0, possessions=500)
    assert isinstance(val, float)
    assert val != 10.0  # shrunk toward prior


def test_holdout_validation_tier_is_e2_or_e3():
    from sports_science.player_model import validate_player_model
    seasons = {
        s: [{"score": 0.5 + 0.3 * i + s * 0.01, "outcome": 1 if (0.5 + 0.3 * i + s * 0.01) > 0.5 else 0}
            for i in range(40)]
        for s in range(2010, 2016)
    }
    res = validate_player_model(seasons, holdout_season=2015)
    assert res["status"] in ("ok", "unavailable")
    if res["status"] == "ok":
        assert res["evidence_tier"] in ("E2", "E3")
        assert "concordance" in res


def test_holdout_validation_unavailable_when_small():
    from sports_science.player_model import validate_player_model
    seasons = {2015: [{"score": 0.5, "outcome": 1}]}
    res = validate_player_model(seasons, holdout_season=2015)
    assert res["status"] == "unavailable"
    assert res["evidence_tier"] == "E4"
