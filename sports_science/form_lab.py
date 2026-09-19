# sports_science/form_lab.py
"""Form & Fatigue Lab — the sports analog of Overlay Oncology's **Meta-Map**.

Two real, published methods:

* **Kalman local-level filter** (Kalman 1960) — track a team's/player's latent
  form from noisy game observations, with one-step-ahead out-of-sample
  validation against a naive (last-observation) baseline.
* **Banister impulse-response model** (Banister 1975; Calvert et al. 1976) —
  performance = baseline + k_fit * fitness - k_fatigue * fatigue, where fitness
  and fatigue are exponentially-weighted sums of training load with different
  time constants (tau_fit ~ 42 d, tau_fatigue ~ 12 d).

Honesty rules (see ``evidence.py``): E2 only when validated out-of-sample
(Kalman beats naive; Banister beats the naive baseline) with sufficient n;
otherwise E3. Never E1 — these are estimates, not measurements.

Pure standard library. No numpy, no LLM, no network. Deterministic.
"""
from __future__ import annotations

import math
from typing import Any

from sports_science.linalg import ridge_fit

CODE_VERSION = "form_lab-1.0.0"

_SQRT_2PI = math.sqrt(2.0 * math.pi)


# ---------------------------------------------------------------------------
# Kalman local-level filter
# ---------------------------------------------------------------------------


def kalman_local_level(
    observations: list[float],
    process_var: float = 0.5,
    obs_var: float = 1.0,
    initial_state: float | None = None,
    initial_var: float = 1.0,
) -> dict[str, Any]:
    """Filter a scalar time series with a random-walk state + Gaussian noise.

    Model: x_t = x_{t-1} + w (w ~ N(0, process_var)), z_t = x_t + v
    (v ~ N(0, obs_var)). Returns the filtered states, their variances, and the
    Gaussian log-likelihood of the observations.
    """
    n = len(observations)
    if n == 0:
        return {"states": [], "variances": [], "log_likelihood": 0.0, "n": 0, "code_version": CODE_VERSION}
    if process_var <= 0.0 or obs_var <= 0.0 or initial_var <= 0.0:
        raise ValueError("variances must be > 0")

    x = float(observations[0]) if initial_state is None else float(initial_state)
    p = float(initial_var)
    states: list[float] = []
    variances: list[float] = []
    log_likelihood = 0.0
    for z in observations:
        p_pred = p + process_var
        s = p_pred + obs_var
        k = p_pred / s
        innov = float(z) - x
        x = x + k * innov
        p = (1.0 - k) * p_pred
        states.append(x)
        variances.append(p)
        log_likelihood += -0.5 * (math.log(_SQRT_2PI * math.sqrt(s)) + (innov * innov) / s)
    return {
        "states": states,
        "variances": variances,
        "log_likelihood": log_likelihood,
        "n": n,
        "code_version": CODE_VERSION,
    }


def validate_kalman_forecast(
    observations: list[float],
    process_var: float = 0.5,
    obs_var: float = 1.0,
    train_frac: float = 0.7,
    min_test: int = 8,
) -> dict[str, Any]:
    """One-step-ahead out-of-sample RMSE vs a naive (last-observation) baseline.

    E2 when the filter beats naive (skill_score > 0) on >= min_test held-out
    points; E3 otherwise; E4 when there is not enough held-out data.
    """
    n = len(observations)
    split = int(n * train_frac)
    if n - split < min_test or split < 2:
        return {
            "status": "unavailable",
            "reason": f"need >= {min_test} held-out points; got {max(0, n - split)}",
            "evidence_tier": "E4",
        }

    x = float(observations[0])
    p = 1.0
    model_sq: list[float] = []
    naive_sq: list[float] = []
    for t, z in enumerate(observations):
        p_pred = p + process_var
        s = p_pred + obs_var
        k = p_pred / s
        if t >= split:
            model_sq.append((float(z) - x) ** 2)  # x is the t-1 filtered state
            naive_sq.append((float(z) - float(observations[t - 1])) ** 2)
        innov = float(z) - x
        x = x + k * innov
        p = (1.0 - k) * p_pred

    rmse = math.sqrt(sum(model_sq) / len(model_sq))
    rmse_naive = math.sqrt(sum(naive_sq) / len(naive_sq))
    skill = 1.0 - rmse / rmse_naive if rmse_naive > 0.0 else 0.0
    return {
        "status": "ok",
        "rmse": round(rmse, 6),
        "rmse_naive": round(rmse_naive, 6),
        "skill_score": round(skill, 6),
        "n_test": len(model_sq),
        "evidence_tier": "E2" if skill > 0.0 else "E3",
        "code_version": CODE_VERSION,
    }


# ---------------------------------------------------------------------------
# Banister impulse-response model
# ---------------------------------------------------------------------------


def _impulse_accumulators(events: list[list[float]], tau: float) -> list[float]:
    """Exponentially-weighted cumulative load at each event (tau = decay const)."""
    if not events:
        return []
    acc = 0.0
    last_day = events[0][0]
    out: list[float] = []
    for day, load in events:
        gap = day - last_day
        if gap < 0:
            raise ValueError("events must be ordered by non-decreasing day")
        acc *= math.exp(-gap / tau)
        acc += float(load)
        last_day = day
        out.append(acc)
    return out


def banister_series(
    events: list[list[float]],
    tau_fit: float = 42.0,
    tau_fatigue: float = 12.0,
    k_fit: float = 1.0,
    k_fatigue: float = 2.0,
    baseline: float = 0.0,
) -> dict[str, Any]:
    """Forward Banister model over ``events`` = [[day, load], ...] (ordered)."""
    if not events:
        return {"series": [], "n": 0, "code_version": CODE_VERSION}
    if tau_fit <= 0.0 or tau_fatigue <= 0.0:
        raise ValueError("time constants must be > 0")
    fitness = 0.0
    fatigue = 0.0
    last_day = events[0][0]
    series: list[dict[str, Any]] = []
    for day, load in events:
        gap = day - last_day
        if gap < 0:
            raise ValueError("events must be ordered by non-decreasing day")
        fitness *= math.exp(-gap / tau_fit)
        fatigue *= math.exp(-gap / tau_fatigue)
        fitness += float(load)
        fatigue += float(load)
        last_day = day
        series.append({
            "day": day,
            "fitness": fitness,
            "fatigue": fatigue,
            "performance": baseline + k_fit * fitness - k_fatigue * fatigue,
        })
    return {"series": series, "n": len(series), "code_version": CODE_VERSION}


def fit_banister(
    events: list[list[float]],
    observed: list[float],
    tau_fit: float = 42.0,
    tau_fatigue: float = 12.0,
) -> dict[str, Any]:
    """Fit baseline, k_fit, k_fatigue by least squares (linear given the taus)."""
    if len(events) != len(observed):
        raise ValueError("events and observed must align")
    if len(events) < 4:
        raise ValueError("need >= 4 observations to fit 3 parameters")
    a_fit = _impulse_accumulators(events, tau_fit)
    a_fat = _impulse_accumulators(events, tau_fatigue)
    X = [[1.0, a_fit[i], -a_fat[i]] for i in range(len(events))]
    y = [float(v) for v in observed]
    beta = ridge_fit(X, y, alpha=1e-9)  # tiny ridge for numerical stability
    pred = [X[i][0] * beta[0] + X[i][1] * beta[1] + X[i][2] * beta[2] for i in range(len(events))]
    ss_res = sum((y[i] - pred[i]) ** 2 for i in range(len(y)))
    y_mean = sum(y) / len(y)
    ss_tot = sum((v - y_mean) ** 2 for v in y)
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0.0 else 0.0
    return {
        "baseline": round(beta[0], 6),
        "k_fit": round(beta[1], 6),
        "k_fatigue": round(beta[2], 6),
        "r_squared": round(r2, 6),
        "n": len(events),
        "tau_fit": tau_fit,
        "tau_fatigue": tau_fatigue,
        "code_version": CODE_VERSION,
    }


def _predict_banister(
    events: list[list[float]],
    baseline: float,
    k_fit: float,
    k_fatigue: float,
    tau_fit: float,
    tau_fatigue: float,
) -> list[float]:
    a_fit = _impulse_accumulators(events, tau_fit)
    a_fat = _impulse_accumulators(events, tau_fatigue)
    return [baseline + k_fit * a_fit[i] - k_fatigue * a_fat[i] for i in range(len(events))]


def validate_banister(
    events: list[list[float]],
    observed: list[float],
    train_frac: float = 0.7,
    min_test: int = 8,
) -> dict[str, Any]:
    """Grid-search the time constants on train; score out-of-sample vs naive.

    E2 when the fitted model beats the naive (last-observation) baseline on the
    held-out tail; E3 otherwise; E4 when there is not enough held-out data.
    """
    n = len(events)
    split = int(n * train_frac)
    if n - split < min_test or split < 6:
        return {
            "status": "unavailable",
            "reason": f"need >= {min_test} held-out points and >= 6 train; got {n - split}/{split}",
            "evidence_tier": "E4",
        }
    grid = [(42.0, 12.0), (35.0, 10.0), (50.0, 15.0), (28.0, 7.0), (60.0, 18.0)]
    best: dict[str, Any] | None = None
    events_tr = events[:split]
    obs_tr = observed[:split]
    obs_te = observed[split:]
    for tau_fit, tau_fatigue in grid:
        fit = fit_banister(events_tr, obs_tr, tau_fit=tau_fit, tau_fatigue=tau_fatigue)
        pred = _predict_banister(
            events, fit["baseline"], fit["k_fit"], fit["k_fatigue"], tau_fit, tau_fatigue
        )[split:]
        rmse = math.sqrt(sum((obs_te[i] - pred[i]) ** 2 for i in range(len(obs_te))) / len(obs_te))
        if best is None or rmse < best["rmse"]:
            best = {
                "rmse": rmse,
                "tau_fit": tau_fit,
                "tau_fatigue": tau_fatigue,
                "fit": fit,
            }
    naive_sq = [(obs_te[i] - obs_te[i - 1]) ** 2 for i in range(1, len(obs_te))]
    rmse_naive = math.sqrt(sum(naive_sq) / len(naive_sq)) if naive_sq else 0.0
    skill = 1.0 - best["rmse"] / rmse_naive if rmse_naive > 0.0 else 0.0
    return {
        "status": "ok",
        "rmse": round(best["rmse"], 6),
        "rmse_naive": round(rmse_naive, 6),
        "skill_score": round(skill, 6),
        "tau_fit": best["tau_fit"],
        "tau_fatigue": best["tau_fatigue"],
        "k_fit": best["fit"]["k_fit"],
        "k_fatigue": best["fit"]["k_fatigue"],
        "baseline": best["fit"]["baseline"],
        "n_test": len(obs_te),
        "evidence_tier": "E2" if skill > 0.0 else "E3",
        "code_version": CODE_VERSION,
    }
