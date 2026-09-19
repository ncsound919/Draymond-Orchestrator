# sports_science/tests/test_player_decon.py
import math

from sports_science.player_decon import (
    adjusted_plus_minus,
    cholesky_solve,
    ridge_fit,
    validate_decomposition,
)

_COMBOS = [["A", "B", "C"], ["A", "B", "D"], ["A", "C", "D"], ["B", "C", "D"]]
_EFFECTS = {"A": 1.0, "B": 0.5, "C": 0.0, "D": -0.5}


def _rows(repeats):
    rows = []
    for combo in _COMBOS:
        for _ in range(repeats):
            rows.append({"players": combo, "margin": sum(_EFFECTS[p] for p in combo)})
    return rows


def test_cholesky_solve_matches_known_system():
    A = [[4.0, 1.0], [1.0, 3.0]]
    b = [1.0, 2.0]
    x = cholesky_solve(A, b)
    assert math.isclose(x[0], 1.0 / 11.0, rel_tol=1e-9)
    assert math.isclose(x[1], 7.0 / 11.0, rel_tol=1e-9)


def test_ridge_fit_recovers_exact_linear_relationship():
    X = [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]
    y = [2.0, 3.0, 5.0]
    beta = ridge_fit(X, y, alpha=0.0)
    assert math.isclose(beta[0], 2.0, abs_tol=1e-9)
    assert math.isclose(beta[1], 3.0, abs_tol=1e-9)


def test_adjusted_plus_minus_ranks_star_highest():
    rows = [
        {"players": ["A", "B", "C"], "margin": 2.0},
        {"players": ["A", "B", "D"], "margin": 1.0},
        {"players": ["A", "C", "D"], "margin": 3.0},
        {"players": ["B", "C", "D"], "margin": -2.0},
        {"players": ["A", "B", "C"], "margin": 1.0},
        {"players": ["A", "B", "D"], "margin": 2.0},
        {"players": ["A", "C", "D"], "margin": 1.0},
        {"players": ["B", "C", "D"], "margin": -1.0},
    ]
    out = adjusted_plus_minus(rows, alpha=1.0)
    assert set(out["coefficients"]) == {"A", "B", "C", "D"}
    assert max(out["coefficients"], key=out["coefficients"].get) == "A"
    assert out["evidence_tier"] == "E3"  # in-sample only


def test_adjusted_plus_minus_is_deterministic():
    rows = _rows(3)
    assert adjusted_plus_minus(rows) == adjusted_plus_minus(rows)


def test_validate_decomposition_out_of_sample_is_e2():
    res = validate_decomposition(_rows(6), _rows(2), alpha=0.1)
    assert res["status"] == "ok"
    assert res["r_squared"] > 0.0
    assert res["evidence_tier"] == "E2"
    assert res["n_train"] == 24 and res["n_test"] == 8


def test_validate_decomposition_insufficient_is_e4():
    res = validate_decomposition(_rows(1), _rows(1))
    assert res["status"] == "unavailable"
    assert res["evidence_tier"] == "E4"
