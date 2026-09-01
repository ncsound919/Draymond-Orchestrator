# sports_science/validation_scorecard.py
"""Sports validation scorecard — the credibility surface for Sports Steve
(win probability) and Bet Buddy (props/betting), with the MARKET as the null
comparator. Mirrors Overlay Oncology's buildValidationScorecard honesty gate:
report real numbers or 'unavailable'; never fabricate a score."""
from __future__ import annotations

from sports_science.validation_engine import (
    verify_determinism, utc_now_iso, UnavailableResult,
)

CODE_VERSION = "sports-scorecard-1.0.0"

_cache: dict | None = None


def _status_gate(blocks: dict) -> str:
    """ok/partial/unavailable per the presence of real validation blocks."""
    if isinstance(blocks.get("win_probability"), dict) and blocks["win_probability"].get("status") == "ok":
        return "ok"
    if isinstance(blocks.get("calibration"), dict) or isinstance(blocks.get("market_null"), dict):
        return "partial"
    return "unavailable"


def _win_prob_block() -> dict:
    try:
        from sports_science.sports_model import TeamFormModel
        model = TeamFormModel()
    except (FileNotFoundError, ImportError) as exc:
        return {"status": "unavailable", "reason": str(exc)}
    try:
        bt = model.backtest()
    except Exception as exc:  # noqa: BLE001
        return {"status": "unavailable", "reason": f"backtest failed: {exc}"}
    if isinstance(bt, UnavailableResult) or bt.get("status") != "ok":
        reason = bt.get("reason") if isinstance(bt, dict) else "backtest unavailable"
        return {"status": "unavailable", "reason": reason}
    try:
        mb = model.market_benchmark()
    except Exception as exc:  # noqa: BLE001
        mb = {"status": "unavailable", "reason": str(exc)}
    return {
        "status": "ok",
        "concordance": bt.get("concordance"),
        "ci_low": bt.get("ci_low"),
        "ci_high": bt.get("ci_high"),
        "calibration_error": bt.get("calibration_error"),
        "lift": bt.get("lift"),
        "n": bt.get("n"),
        "evidence_tier": bt.get("evidence_tier"),
        "market_null": {
            "model_concordance": mb.get("model_concordance"),
            "market_concordance": mb.get("market_concordance"),
            "model_minus_market": mb.get("model_minus_market"),
        } if mb.get("status") == "ok" else {"status": "unavailable"},
    }


def _bet_buddy_block() -> dict:
    try:
        from sports_science.betting_pipeline import BettingExperiment
    except (FileNotFoundError, ImportError) as exc:
        return {"status": "unavailable", "reason": str(exc)}
    try:
        exp = BettingExperiment(max_games=1400)
    except FileNotFoundError as exc:
        return {"status": "unavailable", "reason": str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {"status": "unavailable", "reason": f"experiment init failed: {exc}"}
    try:
        ewma_result = exp.evaluate("ewma-net", exp._ewma_predict)
    except Exception as exc:  # noqa: BLE001
        return {"status": "unavailable", "reason": f"ewma-net evaluation failed: {exc}"}
    if getattr(ewma_result, "n", 0) == 0:
        return {"status": "unavailable", "reason": "no market games"}
    bets = getattr(ewma_result, "bets", 0)
    ci_low = getattr(ewma_result, "ci_low", None)
    ci_high = getattr(ewma_result, "ci_high", None)
    return {
        "status": "ok",
        "model": "ewma-net",
        "concordance": getattr(ewma_result, "concordance", None),
        "ci_low": ci_low,
        "ci_high": ci_high,
        "roi": getattr(ewma_result, "roi", None),
        "roi_ci": list(getattr(ewma_result, "roi_ci", None)) if getattr(ewma_result, "roi_ci", None) is not None else None,
        "roi_p_positive": getattr(ewma_result, "roi_p_positive", None),
        "bets": bets,
        "n": getattr(ewma_result, "n", None),
        "evidence_tier": "E2" if (bets >= 500 and ci_low is not None
                                  and (ci_low > 0.5 or ci_high < 0.5)) else "E3",
    }


def _verification_block() -> dict:
    def run_once(_seed):
        return _win_prob_block()
    return verify_determinism(run_once, [1])


def build_sports_scorecard() -> dict:
    """Assemble the sports validation scorecard. Always returns the same shape
    (status: ok/partial/unavailable); never raises. Result is cached at module
    level so repeated calls (e.g. in tests) are instant."""
    global _cache
    if _cache is not None:
        return _cache
    blocks: dict = {
        "win_probability": _win_prob_block(),
    }
    wp = blocks["win_probability"]
    blocks["market_null"] = (
        wp.get("market_null") if isinstance(wp, dict) and wp.get("status") == "ok"
        else {"status": "unavailable"}
    )
    blocks["bet_buddy"] = _bet_buddy_block()
    blocks["verification"] = _verification_block()
    blocks["summary"] = {
        "model": "sports_model.ewma-net",
        "honesty_gate": "beats the market (model concordance CI vs market on same games), not absolute >=0.6",
        "generated_at": utc_now_iso(),
        "code_version": CODE_VERSION,
    }
    blocks["status"] = _status_gate(blocks)
    _cache = blocks
    return blocks
