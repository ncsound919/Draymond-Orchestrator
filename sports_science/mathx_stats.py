# sports_science/mathx_stats.py
"""Python port of Draymond mathx statistics core (src/lib/mathx/stats.ts).

The math-x statistics library lives in TypeScript inside the Draymond
orchestrator. This module is a formula-for-formula port of the same six
functions so the Python sports stack (Sports Steve, Bet Buddy, sports_science)
runs the IDENTICAL math as Draymond: percentile, betaPosterior, shrinkage,
ewma, cusum, normalCdf, sigmoid.

Provenance: ported from `Draymond-Orchestrator/src/lib/mathx/stats.ts`
(mirrored in `tests/mathx/stats.test.ts`). The Python test suite
(tests/test_mathx_stats.py) re-asserts the same hand-computed values so
"mathematically astute" stays a testable property on both sides.

Pure standard library. No LLM, no network, deterministic.
"""
from __future__ import annotations

import math
from typing import Sequence

# ---------------------------------------------------------------------------
# Lgamma (Lanczos approximation, Numerical Recipes) — matches stats.ts
# ---------------------------------------------------------------------------


def _lgamma(x: float) -> float:
    cof = [
        76.18009172947146,
        -86.50532032941677,
        24.01409824083091,
        -1.231739572450155,
        0.1208650973866179e-2,
        -0.5395239384953e-5,
    ]
    y = x
    tmp = x + 5.5
    tmp -= (x + 0.5) * math.log(tmp)
    ser = 1.000000000190015
    for j in range(6):
        y += 1.0
        ser += cof[j] / y
    return -tmp + math.log((2.5066282746310005 * ser) / x)


# ---------------------------------------------------------------------------
# Continued fraction for the incomplete beta (Numerical Recipes betacf)
# ---------------------------------------------------------------------------


def _betacf(a: float, b: float, x: float) -> float:
    maxit = 200
    eps = 3e-14
    fpmin = 1e-300
    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - (qab * x) / qap
    if abs(d) < fpmin:
        d = fpmin
    d = 1.0 / d
    h = d
    for m in range(1, maxit + 1):
        m2 = 2 * m
        aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < fpmin:
            d = fpmin
        c = 1.0 + aa / c
        if abs(c) < fpmin:
            c = fpmin
        d = 1.0 / d
        h *= d * c
        aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < fpmin:
            d = fpmin
        c = 1.0 + aa / c
        if abs(c) < fpmin:
            c = fpmin
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h


def regularized_incomplete_beta(x: float, a: float, b: float) -> float:
    """Regularized incomplete beta I_x(a, b)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    if a <= 0 or b <= 0:
        raise ValueError("a and b must be > 0")
    bt = math.exp(
        _lgamma(a + b) - _lgamma(a) - _lgamma(b) + a * math.log(x) + b * math.log1p(-x)
    )
    if x < (a + 1.0) / (a + b + 2.0):
        return (bt * _betacf(a, b, x)) / a
    return 1.0 - (bt * _betacf(b, a, 1.0 - x)) / b


def inverse_regularized_incomplete_beta(p: float, a: float, b: float) -> float:
    """Inverse regularized incomplete beta — deterministic bisection (max 1e-12)."""
    if p <= 0:
        return 0.0
    if p >= 1:
        return 1.0
    if a <= 0 or b <= 0:
        raise ValueError("a and b must be > 0")
    lo, hi = 0.0, 1.0
    x = 0.5
    for _ in range(100):
        v = regularized_incomplete_beta(x, a, b)
        if abs(v - p) < 1e-12:
            break
        if v < p:
            lo = x
        else:
            hi = x
        x = (lo + hi) / 2.0
    return x


# ---------------------------------------------------------------------------
# Public stats API (mirrors mathx stats.ts)
# ---------------------------------------------------------------------------


def percentile(sorted_values: Sequence[float], p: float) -> float:
    """Linear-interpolated sample percentile (R type 7)."""
    if len(sorted_values) == 0:
        return 0.0
    clamped = max(0.0, min(1.0, p))
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    h = (len(sorted_values) - 1) * clamped
    lo = math.floor(h)
    hi = math.ceil(h)
    if lo == hi:
        return float(sorted_values[lo])
    frac = h - lo
    return float(sorted_values[lo]) + frac * (sorted_values[hi] - sorted_values[lo])


def beta_posterior(
    successes: float,
    failures: float,
    prior_a: float = 1.0,
    prior_b: float = 1.0,
    alpha_level: float = 0.05,
) -> dict:
    """Bayesian posterior for a Bernoulli success rate under Beta(prior) prior.

    With n successes / m failures the posterior is Beta(n + prior_a,
    m + prior_b); mean, sd and an equal-tailed credible interval follow.
    """
    alpha = max(0.0, successes) + max(0.0, prior_a)
    beta = max(0.0, failures) + max(0.0, prior_b)
    total = alpha + beta
    mean = alpha / total
    sd = math.sqrt((alpha * beta) / (total * total * (total + 1)))
    ci_low = inverse_regularized_incomplete_beta(alpha_level / 2.0, alpha, beta)
    ci_high = inverse_regularized_incomplete_beta(1.0 - alpha_level / 2.0, alpha, beta)
    return {
        "successes": successes,
        "failures": failures,
        "alpha": alpha,
        "beta": beta,
        "mean": mean,
        "sd": sd,
        "ci_low": ci_low,
        "ci_high": ci_high,
        "width": ci_high - ci_low,
    }


def shrinkage(rate: float, n: float, prior_mean: float = 0.75, prior_strength: float = 5.0) -> float:
    """Shrink an observed rate toward a prior mean with a given strength."""
    strength = max(0.0, prior_strength)
    count = max(0.0, n)
    if strength + count == 0:
        return rate
    return (strength * prior_mean + count * rate) / (strength + count)


def _halflife_of(lambda_: float) -> float:
    if lambda_ <= 0:
        return float("inf")
    if lambda_ >= 1:
        # Matches stats.ts: Math.log(0) === -Infinity ⇒ log(0.5)/-Infinity = 0.
        return 0.0
    return math.log(0.5) / math.log(1 - lambda_)


def ewma(values: Sequence[float], lambda_: float = 0.3) -> dict:
    """Exponentially weighted moving average. s_1 = x_1; s_t = l*x_t + (1-l)*s_{t-1}."""
    # Matches stats.ts: Number.EPSILON as the floor for lambda.
    eps = 2.220446049250313e-16
    l = max(eps, min(1.0, lambda_))
    series: list[float] = []
    if len(values) == 0:
        return {"series": series, "last": None, "halflife": _halflife_of(l)}
    s = float(values[0])
    series.append(s)
    for i in range(1, len(values)):
        s = l * float(values[i]) + (1 - l) * s
        series.append(s)
    return {"series": series, "last": s, "halflife": _halflife_of(l)}


def cusum(
    values: Sequence[float],
    target: float,
    sigma: float | None = None,
    k: float = 0.5,
    h: float = 5.0,
) -> dict:
    """Two-sided CUSUM (Page, 1954) for sustained process drift."""
    sigma_eff = sigma if sigma is not None and sigma > 0 else 1.0
    alarms = []
    s_plus = 0.0
    s_minus = 0.0
    for i, v in enumerate(values):
        z = (float(v) - target) / sigma_eff
        s_plus = max(0.0, s_plus + z - k)
        s_minus = max(0.0, s_minus - z - k)
        if s_plus > h:
            alarms.append({"index": i, "direction": "high", "magnitude": s_plus})
            s_plus = 0.0
        if s_minus > h:
            alarms.append({"index": i, "direction": "low", "magnitude": s_minus})
            s_minus = 0.0
    direction = "high" if s_plus > s_minus else ("low" if s_minus > s_plus else None)
    return {"alarms": alarms, "last_high": s_plus, "last_low": s_minus, "direction": direction}


def normal_cdf(z: float) -> float:
    """Standard normal CDF via Abramowitz & Stegun 7.1.26 (max error 7.5e-8)."""
    sign = -1 if z < 0 else 1
    x = abs(z) / math.sqrt(2)
    t = 1 / (1 + 0.3275911 * x)
    erfc = t * (
        0.254829592
        + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))
    )
    erf = 1 - erfc * math.exp(-x * x)
    return 0.5 * (1 + sign * erf)


def sigmoid(x: float) -> float:
    """Logistic map with overflow clamp. sigmoid(0) = 0.5, monotone in x."""
    if x >= 0:
        e = math.exp(-x)
        return 1 / (1 + e)
    e = math.exp(x)
    return e / (1 + e)