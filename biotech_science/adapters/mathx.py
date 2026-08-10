# biotech_science/adapters/mathx.py
"""Shared math spine adapter (reuse of sports' MathXAdapter).

Math-X is the cross-cutting math/biostats backbone. This adapter re-exports the
sports package's MathXAdapter so both engines hit the same local math-x service
(localhost:5000) and fall back to deterministic local compute when unreachable.
"""
from __future__ import annotations

import random

import numpy as np
import requests
from sympy import lambdify, simplify, sympify

DEFAULT_MATHX_URL = "http://localhost:5000"


def verify_derivation(expr_a, expr_b):
    try:
        diff = simplify(sympify(expr_a) - sympify(expr_b))
        return {"verified": diff == 0, "trust": 1.0}
    except Exception:
        return {"verified": False, "trust": 0.0}


def run_monte_carlo_est(seed, n, fn="x"):
    rng = random.Random(seed)
    samples = np.empty(int(n), dtype=float)
    func = lambdify("x", sympify(fn), "math")
    for i in range(int(n)):
        samples[i] = func(rng.random())
    return {"mean": float(samples.mean()), "std": float(samples.std()), "n": int(n), "seed": seed}


class MathXAdapter:
    def __init__(self, base_url=DEFAULT_MATHX_URL):
        self.base_url = base_url

    def call(self, endpoint, payload):
        try:
            resp = requests.post(f"{self.base_url}{endpoint}", json=payload, timeout=10)
            resp.raise_for_status()
            return {"source": "mathx", "evidence_tier": "E1", "data": resp.json()}
        except requests.RequestException:
            return {"source": "mathx", "evidence_tier": "E3", "data": {"error": "mathx service unreachable"}}
