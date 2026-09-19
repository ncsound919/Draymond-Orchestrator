# sports_science/tests/test_form_lab.py
import math

from sports_science.form_lab import (
    banister_series,
    fit_banister,
    kalman_local_level,
    validate_banister,
    validate_kalman_forecast,
)


def test_kalman_is_deterministic_and_shaped():
    obs = [10.0, 12.0, 11.0, 13.0, 12.0, 14.0]
    a = kalman_local_level(obs)
    b = kalman_local_level(obs)
    assert a == b
    assert a["n"] == len(obs)
    assert len(a["states"]) == len(obs)
    assert math.isfinite(a["log_likelihood"])


def test_kalman_converges_on_constant_signal():
    out = kalman_local_level([5.0] * 20, process_var=0.1, obs_var=1.0)
    assert abs(out["states"][-1] - 5.0) < 0.5


def test_kalman_validation_beats_naive_on_oscillating_noise():
    obs = [10.0 + (1.0 if i % 2 == 0 else -1.0) for i in range(30)]
    res = validate_kalman_forecast(obs, process_var=0.1, obs_var=1.0, train_frac=0.7)
    assert res["status"] == "ok"
    assert res["skill_score"] > 0.0
    assert res["evidence_tier"] == "E2"


def test_kalman_validation_insufficient_is_e4():
    res = validate_kalman_forecast([1.0, 2.0, 3.0])
    assert res["status"] == "unavailable"
    assert res["evidence_tier"] == "E4"


def test_banister_first_event_is_load_impulse():
    out = banister_series([[0, 100.0], [1, 0.0]], k_fit=1.0, k_fatigue=2.0, baseline=0.0)
    first = out["series"][0]
    assert first["fitness"] == 100.0
    assert first["fatigue"] == 100.0
    assert first["performance"] == 100.0 - 2.0 * 100.0


def test_banister_fitness_decays_without_load():
    out = banister_series([[0, 100.0], [10, 0.0]])
    assert out["series"][1]["fitness"] < out["series"][0]["fitness"]
    assert out["series"][1]["fatigue"] < out["series"][0]["fatigue"]


def _load_events(days=60):
    return [[d, 100.0 if d % 7 in (0, 1) else 0.0] for d in range(days)]


def test_fit_banister_recovers_known_parameters():
    events = _load_events()
    observed = [
        s["performance"]
        for s in banister_series(
            events, tau_fit=42.0, tau_fatigue=12.0, k_fit=1.0, k_fatigue=1.0, baseline=10.0
        )["series"]
    ]
    fit = fit_banister(events, observed, tau_fit=42.0, tau_fatigue=12.0)
    assert abs(fit["baseline"] - 10.0) < 1e-3
    assert abs(fit["k_fit"] - 1.0) < 1e-3
    assert abs(fit["k_fatigue"] - 1.0) < 1e-3
    assert fit["r_squared"] > 0.999


def test_validate_banister_returns_honest_tier():
    events = _load_events()
    observed = [
        s["performance"]
        for s in banister_series(
            events, tau_fit=42.0, tau_fatigue=12.0, k_fit=1.0, k_fatigue=2.0, baseline=10.0
        )["series"]
    ]
    res = validate_banister(events, observed)
    assert res["status"] == "ok"
    assert res["evidence_tier"] in ("E2", "E3")
    assert res["tau_fit"] in (42.0, 35.0, 50.0, 28.0, 60.0)


def test_validate_banister_insufficient_is_e4():
    res = validate_banister([[0, 1.0], [1, 1.0]], [1.0, 1.0])
    assert res["status"] == "unavailable"
    assert res["evidence_tier"] == "E4"
