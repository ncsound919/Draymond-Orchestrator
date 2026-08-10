# sports_science/tests/test_ingest.py
import pytest
from sports_science.ingest import normalize_performance_row, fetch_nba_player_game_log


def test_normalize_performance_row_maps_nba_to_codex():
    row = {
        "PTS": 30.0, "AST": 8.0, "REB": 10.0, "TOV": 3.0,
        "PF": 2.0, "FGM": 11.0, "FGA": 20.0, "3PM": 4.0, "3PA": 8.0,
    }
    out = normalize_performance_row(row)
    assert out["fg"] == pytest.approx(55.0)  # 11/20 * 100
    assert out["tp"] == pytest.approx(50.0)  # 4/8 * 100
    assert out["ast"] == 8.0
    assert out["oreb"] == 10.0
    assert out["tov"] == -3.0  # turnovers are penalties
    assert out["pf"] == -2.0


def test_normalize_performance_row_zero_attempts():
    out = normalize_performance_row({"FGM": 0, "FGA": 0, "3PM": 0, "3PA": 0})
    assert out["fg"] == 0.0
    assert out["tp"] == 0.0


def test_fetch_nba_player_game_log_requires_player_id():
    with pytest.raises(ValueError):
        fetch_nba_player_game_log(player_id=None, season="2024-25")


def test_fetch_nba_player_game_log_parses_result_sets(monkeypatch):
    """Parse path must work without network (isolates from NBA API format drift)."""
    class _FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "resultSets": [{
                    "headers": ["PLAYER_ID", "FGM", "FGA", "3PM", "3PA", "AST", "REB", "TOV", "PF"],
                    "rowSet": [[2544, 9, 18, 3, 6, 5, 6, 2, 1]],
                }]
            }

    import sports_science.ingest as ingest_mod

    monkeypatch.setattr(ingest_mod.requests, "get", lambda *a, **k: _FakeResp())
    rows = fetch_nba_player_game_log(player_id="2544", season="2024-25")
    assert len(rows) == 1
    row = rows[0]
    assert row["fg"] == pytest.approx(50.0)  # 9/18
    assert row["tp"] == pytest.approx(50.0)  # 3/6
    assert row["tov"] == -2.0
