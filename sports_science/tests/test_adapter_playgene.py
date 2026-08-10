# sports_science/tests/test_adapter_playgene.py
import pytest
from sports_science.adapters.playgene import (
    PlaygeneAdapter,
    normalize_playbook_input,
    DEFAULT_SIM_URL,
)


def test_default_sim_url():
    assert DEFAULT_SIM_URL == "http://localhost:8080"


def test_normalize_playbook_input_validates_sport():
    with pytest.raises(ValueError):
        normalize_playbook_input({"sport": "chess"})


def test_adapter_offline_returns_error_not_crash():
    adapter = PlaygeneAdapter(base_url="http://127.0.0.1:1")  # unreachable
    out = adapter.run_play_simulation({"sport": "NBA", "play": {"name": "Horns", "formation": "Horns", "base_success_rate": 50, "base_expected_points": 1.0}, "offense_players": [], "defense": {"team_name": "X", "average_def_rating": 70, "blitz_rate": 20, "rotation_speed": 60, "double_team_wr1": 10}, "situation": {"quarter": 1, "time_remaining_secs": 600, "offense_score": 0, "defense_score": 0}, "seed": 42})
    assert out["source"] == "playgene"
    assert out["evidence_tier"] == "E3"
