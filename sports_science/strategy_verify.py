# sports_science/strategy_verify.py
"""Strategy Verification Lab — the sports analog of Overlay Oncology's CureForge.

CureForge generates a hypothesis and verifies it by running candidate code in a
locked-down sandbox with property fuzzing. This module keeps the *verification*
discipline but NOT the arbitrary-code-execution risk (CureForge's own README
notes its denylist subprocess is not a security boundary). Here a strategy is a
declarative signal over historical records, and it is verified against falsifiers:

  1. enough_test_bets      — the held-out window has a usable sample
  2. positive_in_sample_roi — the threshold earns on the training window
  3. positive_roi           — it still earns out-of-sample
  4. roi_ci_excludes_zero   — the bootstrap CI on out-of-sample ROI excludes 0
  5. calibrated             — Brier score within a documented ceiling

No-lookahead discipline: the decision threshold is chosen on the TRAIN window
only and applied to the TEST window. ``fuzz_verdict`` re-runs the verification on
deterministic subsamples to test whether the verdict is robust.

Honesty rules: verdict "passed" => E2; "failed" => E3; "inconclusive" => E4.
Never E1 — a backtest is not a measurement.

Pure standard library. No LLM, no network, no code execution. Deterministic.
"""
from __future__ import annotations

import random
from typing import Any

CODE_VERSION = "strategy_verify-1.0.0"

BRIER_CEILING = 0.25  # documented heuristic: well-calibrated probabilities


def _profit(won: int, odds: float) -> float:
    """Flat 1-unit stake: win pays (odds-1), loss costs 1."""
    return (odds - 1.0) if won else -1.0


def _roi(bets: list[dict]) -> float:
    if not bets:
        return 0.0
    return sum(_profit(int(b["won"]), float(b["odds"])) for b in bets) / len(bets)


def _bootstrap_roi_ci(bets: list[dict], iterations: int, seed: int) -> tuple[float, float, float]:
    """Percentile bootstrap CI for mean ROI over the bet list."""
    point = _roi(bets)
    if not bets:
        return 0.0, 0.0, 0.0
    rng = random.Random(seed)
    m = len(bets)
    draws = []
    for _ in range(iterations):
        sample = [bets[rng.randrange(m)] for _ in range(m)]
        draws.append(_roi(sample))
    draws.sort()
    lo = draws[int(0.025 * len(draws))]
    hi = draws[min(len(draws) - 1, int(round(0.975 * len(draws))))]
    return lo, hi, point


def _brier(records: list[dict]) -> float:
    if not records:
        return 0.0
    return sum((float(r["prob"]) - int(r["won"])) ** 2 for r in records) / len(records)


def _best_threshold(train: list[dict]) -> float:
    """Choose the threshold that maximises TRAIN ROI (no-lookahead)."""
    candidates = sorted({float(r["prob"]) for r in train})
    best_threshold, best_roi, found = 0.5, float("-inf"), False
    for t in candidates:
        bets = [r for r in train if float(r["prob"]) >= t]
        roi = _roi(bets)
        if roi > best_roi:
            best_threshold, best_roi, found = t, roi, True
    return best_threshold if found else 0.5


def verify_strategy(
    records: list[dict],
    threshold: float | None = None,
    train_frac: float = 0.5,
    min_bets: int = 30,
    seed: int = 7,
    bootstraps: int = 200,
) -> dict[str, Any]:
    """Verify a threshold strategy against the falsifier set (see module docstring).

    ``records``: list of ``{"date": sortable, "prob": float, "odds": float,
    "won": 0|1}``. Returns ``{status, verdict, falsifiers, threshold, train_roi,
    test_roi, roi_ci, brier, n_train, n_test, n_bets, evidence_tier}``.
    """
    recs = sorted(records, key=lambda r: r["date"])
    n = len(recs)
    split = int(n * train_frac)
    train, test = recs[:split], recs[split:]

    if len(test) < min_bets or len(train) < 2:
        return {
            "status": "inconclusive",
            "verdict": "inconclusive",
            "reason": f"need >= {min_bets} test records; got {len(test)}",
            "falsifiers": {"enough_test_bets": False},
            "evidence_tier": "E4",
            "code_version": CODE_VERSION,
        }

    # No-lookahead: threshold from train only, unless the caller pinned one.
    threshold_used = float(threshold) if threshold is not None else _best_threshold(train)
    train_bets = [r for r in train if float(r["prob"]) >= threshold_used]
    test_bets = [r for r in test if float(r["prob"]) >= threshold_used]

    train_roi = _roi(train_bets)
    test_roi = _roi(test_bets)
    ci_low, ci_high, _ = _bootstrap_roi_ci(test_bets, bootstraps, seed)
    brier = _brier(recs)

    falsifiers = {
        "enough_test_bets": len(test_bets) >= min_bets,
        "positive_in_sample_roi": train_roi > 0.0,
        "positive_roi": test_roi > 0.0,
        "roi_ci_excludes_zero": ci_low > 0.0,
        "calibrated": brier <= BRIER_CEILING,
    }
    passed = all(falsifiers.values())
    verdict = "passed" if passed else "failed"
    return {
        "status": verdict,
        "verdict": verdict,
        "falsifiers": falsifiers,
        "threshold": round(threshold_used, 6),
        "train_roi": round(train_roi, 6),
        "test_roi": round(test_roi, 6),
        "roi_ci": [round(ci_low, 6), round(ci_high, 6)],
        "brier": round(brier, 6),
        "n_train": len(train),
        "n_test": len(test),
        "n_bets": len(test_bets),
        "evidence_tier": "E2" if passed else "E3",
        "code_version": CODE_VERSION,
    }


def fuzz_verdict(
    records: list[dict],
    seeds: tuple[int, ...] = (1, 2, 3, 4, 5),
    min_bets: int = 20,
    bootstraps: int = 100,
) -> dict[str, Any]:
    """Re-run verification on deterministic subsamples; report verdict stability.

    The CureForge property-fuzz analog: a verdict that only holds for one sample
    is not a verdict. ``stable`` is True only when every subsample agrees.
    """
    verdicts: list[str] = []
    for s in seeds:
        rng = random.Random(s)
        k = min(len(records), max(min_bets, int(len(records) * 0.8)))
        sample = rng.sample(list(records), k)
        verdicts.append(verify_strategy(sample, min_bets=min_bets, seed=s, bootstraps=bootstraps)["verdict"])
    stable = len(set(verdicts)) == 1
    all_passed = bool(verdicts) and all(v == "passed" for v in verdicts)
    return {
        "status": "ok",
        "verdicts": verdicts,
        "stable": stable,
        "n_seeds": len(seeds),
        "evidence_tier": "E2" if (stable and all_passed) else "E3",
        "code_version": CODE_VERSION,
    }
