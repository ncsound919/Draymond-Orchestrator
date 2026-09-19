# sports_science/player_decon.py
"""Player Impact Deconvolution — ridge-regularized adjusted plus-minus (RAPM).

The sports analog of Overlay Oncology's **Decon** component: decompose a team's
observed point margin into per-player effects. This is a real, published method
(Sill 2010, *Improved NBA Adjusted +/- Using Regularization and Out-of-Sample
Testing*), not a heuristic.

Given a set of possessions, each with the players on the floor and the net
margin, we solve the ridge system

    (X'X + alpha I) beta = X'y

where X is the player-indicator design matrix and y is the (centered) margin.
The coefficients are the players' adjusted plus-minus. Regularization is
required because the on-court indicator columns are collinear.

Honesty rules (see ``evidence.py``): the decomposition is E2 when validated
out-of-sample, E3 (small sample / rule-of-thumb regularization) otherwise —
never E1. It is a statistical estimate, not a measurement.

Pure standard library. No numpy, no LLM, no network. Deterministic.
"""
from __future__ import annotations

from typing import Any

from sports_science.linalg import cholesky_solve, ridge_fit  # noqa: F401  (re-exported)

CODE_VERSION = "player_decon-1.0.0"


def _player_index(rows: list[dict]) -> dict[str, int]:
    players = sorted({p for r in rows for p in r["players"]})
    return {p: j for j, p in enumerate(players)}


def _design(rows: list[dict], index: dict[str, int]) -> tuple[list[list[float]], list[float]]:
    X: list[list[float]] = []
    y: list[float] = []
    for r in rows:
        row = [0.0] * len(index)
        for p in r["players"]:
            if p in index:
                row[index[p]] = 1.0
        X.append(row)
        y.append(float(r["margin"]))
    return X, y


def _center(
    X: list[list[float]], y: list[float]
) -> tuple[list[list[float]], list[float], list[float], float]:
    """Center each design column and the target; return the means too."""
    n = len(X)
    if n == 0:
        return X, y, [], 0.0
    p = len(X[0])
    col_means = [sum(X[i][j] for i in range(n)) / n for j in range(p)]
    y_mean = sum(y) / n
    Xc = [[X[i][j] - col_means[j] for j in range(p)] for i in range(n)]
    yc = [y[i] - y_mean for i in range(n)]
    return Xc, yc, col_means, y_mean


def adjusted_plus_minus(rows: list[dict], alpha: float = 1.0) -> dict[str, Any]:
    """Ridge-regularized adjusted plus-minus over possessions.

    ``rows``: list of possessions, each ``{"players": [id, ...], "margin": float}``
    where ``margin`` is the net points for the possessing team on that possession.

    Returns ``{coefficients, n, p, r_squared, alpha, evidence_tier}`` where each
    coefficient is a player's adjusted plus-minus (points per possession, net of
    teammates/opponents), and ``r_squared`` is the in-sample fit.
    """
    index = _player_index(rows)
    X, y = _design(rows, index)
    Xc, yc, _, _ = _center(X, y)
    beta = ridge_fit(Xc, yc, alpha) if Xc else []
    pred = [sum(Xc[i][j] * beta[j] for j in range(len(beta))) for i in range(len(Xc))]
    ss_res = sum((yc[i] - pred[i]) ** 2 for i in range(len(yc)))
    ss_tot = sum(v * v for v in yc)
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0.0 else 0.0
    players = [None] * len(index)
    for name, j in index.items():
        players[j] = name
    return {
        "coefficients": {players[j]: round(beta[j], 6) for j in range(len(beta))},
        "n": len(rows),
        "p": len(index),
        "r_squared": round(r2, 6),
        "alpha": alpha,
        "evidence_tier": "E3",  # in-sample only; use validate_decomposition for E2
        "code_version": CODE_VERSION,
    }


def validate_decomposition(
    train_rows: list[dict],
    test_rows: list[dict],
    alpha: float = 1.0,
    min_train: int = 20,
    min_test: int = 8,
) -> dict[str, Any]:
    """Out-of-sample validation of the decomposition on a held-out set.

    Fits on ``train_rows`` (with train centering) and evaluates R^2 on
    ``test_rows``. Returns E2 only when the sample is sufficient and the
    held-out R^2 is positive; otherwise E3. Degenerate input yields E4.
    """
    if len(train_rows) < min_train or len(test_rows) < min_test:
        return {
            "status": "unavailable",
            "reason": (
                f"need >= {min_train} train and >= {min_test} test possessions; "
                f"got {len(train_rows)}/{len(test_rows)}"
            ),
            "evidence_tier": "E4",
        }
    index = _player_index(train_rows + test_rows)
    Xtr, ytr = _design(train_rows, index)
    Xtr_c, ytr_c, col_means, y_mean = _center(Xtr, ytr)
    beta = ridge_fit(Xtr_c, ytr_c, alpha)
    Xte, yte = _design(test_rows, index)
    pred = [
        sum((Xte[i][j] - col_means[j]) * beta[j] for j in range(len(beta))) + y_mean
        for i in range(len(test_rows))
    ]
    yte_mean = sum(yte) / len(yte)
    ss_res = sum((yte[i] - pred[i]) ** 2 for i in range(len(yte)))
    ss_tot = sum((v - yte_mean) ** 2 for v in yte)
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0.0 else 0.0
    return {
        "status": "ok",
        "r_squared": round(r2, 6),
        "n_train": len(train_rows),
        "n_test": len(test_rows),
        "p": len(index),
        "alpha": alpha,
        "evidence_tier": "E2" if r2 > 0.0 else "E3",
        "code_version": CODE_VERSION,
    }
