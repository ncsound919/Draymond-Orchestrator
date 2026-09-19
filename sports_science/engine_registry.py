# sports_science/engine_registry.py
"""ENGINE REGISTRY — single source of truth for deterministic sports engines.

Mirrors Overlay Oncology's ``lib/engine-registry.ts``:

* each engine is registered with a semantic version (bump when behavior
  changes, even an internal constant) and a canonical input,
* ``engine_registry.lock.json`` is the golden snapshot of every engine's
  output on its canonical input,
* ``run_drift.py`` regenerates it in memory and fails if anything diverges
  beyond 1e-6, so silent number changes are impossible.

Only PURE, DB-free, deterministic functions are registered, so the lockfile
reproduces on any machine without the 2.3 GB ``nba.sqlite``. Data-dependent
models (``sports_model.TeamFormModel``, ``betting_pipeline``) are validated via
``validation_scorecard`` against the real market, not pinned here.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from sports_science import codex_metrics, form_lab, mathx_stats, player_decon, player_model, strategy_verify
from sports_science.validation_engine import sha256_of, validate_predictor

EngineRun = Callable[[Any], Any]


def _round(value: Any, nd: int = 9) -> Any:
    """Round floats to a stable precision; normalise -0.0 -> 0.0."""
    if isinstance(value, float):
        r = round(value, nd)
        return 0.0 if r == 0 else r
    if isinstance(value, (list, tuple)):
        return [_round(x, nd) for x in value]
    if isinstance(value, dict):
        return {k: _round(v, nd) for k, v in value.items()}
    return value


def _fn(fn: Callable[..., Any]) -> EngineRun:
    """Wrap a function so a canonical kwargs dict drives it and the result is
    rounded to a stable, drift-sensitive precision."""
    return lambda kw: _round(fn(**kw))


def _synth_validation_records(n: int = 40) -> list[dict[str, float]]:
    """Deterministic synthetic (score, outcome) cohort with a known oracle.

    Scores are strictly increasing and outcomes split at 0.5, so the oracle
    concordance is exactly 1.0 — the honest-validation engine's golden value.
    """
    return [
        {"score": round((i + 0.5) / n, 9), "outcome": 1 if (i + 0.5) / n > 0.5 else 0}
        for i in range(n)
    ]


def _synth_strategy_records(n: int = 120) -> list[dict[str, Any]]:
    """Deterministic synthetic betting records where the signal is real.

    Probability cycles 0.30..0.90 over each block of 20; the outcome is a win
    whenever prob >= 0.6 (odds 2.0). A threshold strategy therefore earns
    out-of-sample — the verifier's golden "passed" case.
    """
    records: list[dict[str, Any]] = []
    for i in range(n):
        prob = round(0.30 + 0.60 * (i % 20) / 19, 4)
        records.append({"date": i, "prob": prob, "odds": 2.0, "won": 1 if prob >= 0.6 else 0})
    return records


class EngineDef:
    """A single registered engine: name, semver, canonical input, runner."""

    def __init__(self, name: str, version: str, canonical_input: Any, run: EngineRun):
        self.name = name
        self.version = version
        self.canonical_input = canonical_input
        self.run = run


# Registered engines in stable order.
ENGINES: list[EngineDef] = [
    EngineDef(
        "adjusted_plus_minus",
        "1.0.0",
        {
            "rows": [
                {"players": ["A", "B", "C"], "margin": 2.0},
                {"players": ["A", "B", "D"], "margin": 1.0},
                {"players": ["A", "C", "D"], "margin": 3.0},
                {"players": ["B", "C", "D"], "margin": -2.0},
                {"players": ["A", "B", "C"], "margin": 1.0},
                {"players": ["A", "B", "D"], "margin": 2.0},
                {"players": ["A", "C", "D"], "margin": 1.0},
                {"players": ["B", "C", "D"], "margin": -1.0},
            ],
            "alpha": 1.0,
        },
        _fn(player_decon.adjusted_plus_minus),
    ),
    EngineDef(
        "banister_series",
        "1.0.0",
        {"events": [[0, 100.0], [1, 0.0], [2, 150.0], [3, 0.0], [4, 0.0]]},
        _fn(form_lab.banister_series),
    ),
    EngineDef(
        "beta_posterior",
        "1.0.0",
        {"successes": 40.0, "failures": 60.0, "prior_a": 10.0, "prior_b": 10.0, "alpha_level": 0.05},
        _fn(mathx_stats.beta_posterior),
    ),
    EngineDef(
        "cusum",
        "1.0.0",
        {"values": [1.0, 2.0, 1.5, 2.5, 3.0, 3.5, 3.0, 4.0], "target": 2.0, "sigma": 1.0, "k": 0.5, "h": 5.0},
        _fn(mathx_stats.cusum),
    ),
    EngineDef(
        "ewma",
        "1.0.0",
        {"values": [10.0, 12.0, 11.0, 14.0, 13.0, 15.0], "lambda_": 0.3},
        _fn(mathx_stats.ewma),
    ),
    EngineDef(
        "four_factors_from_performance",
        "1.0.0",
        {"p": {"fg": 50.0, "tp": 30.0, "oreb": 6.0, "tov": -4.0, "pf": -3.0, "defensive_attention": 0.6, "court_spacing": 0.5}},
        _fn(codex_metrics.four_factors_from_performance),
    ),
    EngineDef(
        "fuzz_verdict",
        "1.0.0",
        {"records": _synth_strategy_records(), "min_bets": 20, "bootstraps": 100},
        _fn(strategy_verify.fuzz_verdict),
    ),
    EngineDef(
        "kalman_local_level",
        "1.0.0",
        {
            "observations": [10.0, 12.0, 11.0, 13.0, 12.0, 14.0, 13.0, 15.0],
            "process_var": 0.5,
            "obs_var": 1.0,
            "initial_var": 1.0,
        },
        _fn(form_lab.kalman_local_level),
    ),
    EngineDef(
        "pace_adjusted_rate",
        "1.0.0",
        {"value": 100.0, "possessions": 90.0, "per": 100.0},
        _fn(player_model.pace_adjusted_rate),
    ),
    EngineDef(
        "player_impact_estimate",
        "1.0.0",
        {"plus_minus": 12.5, "possessions": 80.0, "prior_mean": 0.0, "prior_strength": 50.0},
        _fn(player_model.player_impact_estimate),
    ),
    EngineDef(
        "shrinkage",
        "1.0.0",
        {"rate": 0.7, "n": 20.0, "prior_mean": 0.75, "prior_strength": 5.0},
        _fn(mathx_stats.shrinkage),
    ),
    EngineDef(
        "ter_score",
        "1.0.0",
        {"fg": 50.0, "tp": 30.0, "ast": 20.0, "oreb": 10.0, "tov": 8.0, "pf": 6.0, "cell_cycle": 24.0},
        _fn(codex_metrics.ter_score),
    ),
    EngineDef(
        "validate_predictor",
        "1.0.0",
        {"records": _synth_validation_records(), "k": 5, "seed": 7, "min_n": 40, "bootstraps": 200},
        _fn(validate_predictor),
    ),
    EngineDef(
        "verify_strategy",
        "1.0.0",
        {"records": _synth_strategy_records(), "threshold": None, "train_frac": 0.5, "min_bets": 20, "seed": 7, "bootstraps": 100},
        _fn(strategy_verify.verify_strategy),
    ),
]


def snapshot_engine(def_: EngineDef) -> dict[str, Any]:
    """Run one engine on its canonical input and record the inputsHash."""
    return {
        "engine": def_.name,
        "version": def_.version,
        "inputsHash": sha256_of(def_.canonical_input),
        "output": def_.run(def_.canonical_input),
    }


def snapshot_all_engines() -> list[dict[str, Any]]:
    """Run every registered engine on its canonical input, in registry order."""
    return [snapshot_engine(e) for e in ENGINES]


# Golden lockfile sits beside this module.
LOCKFILE_PATH = Path(__file__).resolve().with_name("engine_registry.lock.json")
