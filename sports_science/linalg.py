# sports_science/linalg.py
"""Small deterministic linear-algebra helpers shared by the sports engines.

Pure standard library (no numpy). Kept separate so multiple engines
(``player_decon``, ``form_lab``, …) share ONE solver instead of duplicating it.
"""
from __future__ import annotations

import math


def cholesky(A: list[list[float]]) -> list[list[float]]:
    """Cholesky factor L of a symmetric positive-definite matrix A (A = L L')."""
    n = len(A)
    L = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1):
            s = sum(L[i][k] * L[j][k] for k in range(j))
            if i == j:
                d = A[i][i] - s
                if d <= 0.0:
                    raise ValueError("matrix is not positive definite")
                L[i][j] = math.sqrt(d)
            else:
                L[i][j] = (A[i][j] - s) / L[j][j]
    return L


def cholesky_solve(A: list[list[float]], b: list[float]) -> list[float]:
    """Solve A x = b for symmetric positive-definite A via Cholesky."""
    n = len(A)
    L = cholesky(A)
    # Forward substitution: L y = b
    y = [0.0] * n
    for i in range(n):
        s = sum(L[i][k] * y[k] for k in range(i))
        y[i] = (b[i] - s) / L[i][i]
    # Back substitution: L' x = y
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        s = sum(L[k][i] * x[k] for k in range(i + 1, n))
        x[i] = (y[i] - s) / L[i][i]
    return x


def ridge_fit(X: list[list[float]], y: list[float], alpha: float = 1.0) -> list[float]:
    """Ridge regression coefficients via (X'X + alpha I) beta = X'y.

    ``alpha=0`` yields ordinary least squares (A = X'X must still be SPD).
    """
    if not X:
        return []
    p = len(X[0])
    if alpha < 0.0:
        raise ValueError("alpha must be >= 0")
    A = [[0.0] * p for _ in range(p)]
    b = [0.0] * p
    for xi, yi in zip(X, y):
        for a in range(p):
            xa = xi[a]
            if xa == 0.0:
                continue
            b[a] += xa * yi
            for c in range(a, p):
                A[a][c] += xa * xi[c]
    for a in range(p):
        for c in range(a):
            A[a][c] = A[c][a]
        A[a][a] += alpha
    return cholesky_solve(A, b)
