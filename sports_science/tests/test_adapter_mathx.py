# sports_science/tests/test_adapter_mathx.py
from sports_science.adapters.mathx import (
    verify_derivation,
    run_monte_carlo_est,
)


def test_verify_derivation_simple_identity():
    result = verify_derivation("2*x + 3*x", "5*x")
    assert result["verified"] is True


def test_run_monte_carlo_est_pi_like():
    # Estimate mean of a uniform(0,1) — known answer 0.5
    result = run_monte_carlo_est(seed=7, n=10000, fn="x")
    assert abs(result["mean"] - 0.5) < 0.05


def test_run_monte_carlo_est_same_seed_is_deterministic():
    first = run_monte_carlo_est(seed=7, n=1000, fn="x")
    second = run_monte_carlo_est(seed=7, n=1000, fn="x")
    assert first["mean"] == second["mean"]
    assert first["std"] == second["std"]


def test_verify_derivation_mismatch_is_not_verified():
    result = verify_derivation("x", "x*x")
    assert result["verified"] is False
