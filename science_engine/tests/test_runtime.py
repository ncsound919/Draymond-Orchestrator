# science_engine/tests/test_runtime.py
"""Tests for the deterministic ticked simulation runtime."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from science_engine.runtime import ModelValidationError, load_model, run_model  # noqa: E402

MODELS = Path(__file__).resolve().parent.parent / "models"

LOAD_SPEC = {
    "model_id": "test-load",
    "state_vars": ["fatigue", "recovery", "injury_risk"],
    "params": {"load_rate": 0.3, "acwr": 1.3},
    "initial_state": {"fatigue": 0.0, "recovery": 0.5, "injury_risk": 0.2},
    "update_rules": {
        "fatigue": "fatigue + load_rate - 0.05*recovery",
        "recovery": "recovery + 0.1",
        "injury_risk": "0.5*fatigue + 0.3*abs(acwr-1)",
    },
    "events": [{"when": "injury_risk > 0.8", "action": "flag:collapse_window"}],
    "outputs": ["fatigue", "injury_risk"],
    "ticks": 12,
}


def test_runtime_deterministic():
    a = run_model(LOAD_SPEC)
    b = run_model(LOAD_SPEC)
    assert a.to_dict() == b.to_dict()


def test_series_length_is_ticks_plus_final_snapshot():
    r = run_model(LOAD_SPEC)
    assert len(r.series) == 13  # 12 ticks + final snapshot
    assert r.series[0]["tick"] == 0
    assert r.series[-1]["tick"] == 12


def test_events_fire_on_predicate():
    r = run_model(LOAD_SPEC)
    assert any(e["action"] == "flag:collapse_window" for e in r.events)
    # injury_risk starts low and climbs past 0.8 mid-run.
    assert any(t["injury_risk"] > 0.8 for t in r.series)


def test_outputs_only_declared_metrics():
    r = run_model(LOAD_SPEC)
    assert set(r.outputs.keys()) == {"fatigue", "injury_risk"}


def test_unparseable_rule_degrades_to_e4():
    bad = dict(LOAD_SPEC)
    bad["update_rules"] = {"fatigue": "not a valid expr !!!", "recovery": "recovery + 0.1", "injury_risk": "fatigue"}
    r = run_model(bad)
    assert r.evidence_tier == "E4"
    assert r.error is not None


def test_missing_update_rule_degrades_to_e4():
    import copy

    bad = copy.deepcopy(LOAD_SPEC)
    del bad["update_rules"]["recovery"]
    r = run_model(bad)
    assert r.evidence_tier == "E4"
    assert r.error is not None


def test_param_override_changes_trajectory():
    import copy

    base = run_model(LOAD_SPEC)
    mod = copy.deepcopy(LOAD_SPEC)
    mod["params"] = {"load_rate": 0.9, "acwr": 1.3}
    high = run_model(mod)
    assert high.outputs["fatigue"] > base.outputs["fatigue"]


def test_load_model_rejects_missing_file():
    try:
        load_model(Path("does-not-exist.json"))
        assert False, "expected ModelValidationError"
    except ModelValidationError:
        pass


def test_all_seed_models_load_and_run():
    model_files = sorted(MODELS.glob("*.json"))
    assert len(model_files) == 20
    for m in model_files:
        spec = load_model(m)
        r = run_model(spec)
        assert r.error is None, f"{m.name}: {r.error}"
        assert r.evidence_tier in ("E1", "E2", "E3", "E4")
        assert len(r.series) > 0
        # Determinism per model.
        assert run_model(spec).to_dict() == r.to_dict(), f"{m.name} not deterministic"
