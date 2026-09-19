# sports_science/run_model.py
"""CLI runner: bbtech sports model bridge (Sports Steve / Bet Buddy / trends).

Contract (mirrors run_derive.py style):
  python sports_science/run_model.py backtest [--from DATE] [--to DATE] [--max N]
  python sports_science/run_model.py query --home ABR --away ABR --date YYYY-MM-DD
  python sports_science/run_model.py totals --team ABR --line 220.5 --date YYYY-MM-DD

Output: machine-readable JSON. For Draymond the executor wraps `data` as a
BlackMind ScienceEngine row; derived-metric payloads carry `metrics` so the
trends store persists them with metricKind='derived'.

Non-zero exit => {"ok": false, "error": ...} on stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sports_science.sports_model import TeamFormModel  # noqa: E402
from sports_science.validation_engine import utc_now_iso  # noqa: E402

def _e4(name: str, reason: str) -> list[dict[str, Any]]:
    """Honest E4 unavailable metric for any failure path."""
    return [{
        "name": name,
        "status": "unavailable",
        "reason": reason,
        "evidence_tier": "E4",
        "modeled": False,
    }]


def _win_prob_metrics(home: str, away: str, date: str, model: TeamFormModel | None = None) -> list[dict[str, Any]]:
    if model is None:
        model = TeamFormModel()
    try:
        result = model.win_probability(home, away, date)
    except Exception as exc:  # noqa: BLE001
        return _e4("sports_model.win_probability", str(exc))
    if result.get("status") != "ok":
        return [
            {
                "name": "sports_model.win_probability",
                "status": "unavailable",
                "reason": result.get("reason", "unknown"),
                "evidence_tier": "E4",
                "modeled": False,
            }
        ]
    return [
        {
            "name": "sports_model.win_probability",
            "value": result["win_probability"],
            "unit": "probability",
            "home": home,
            "away": away,
            "game_date": date,
            "home_form": result["home_form"],
            "away_form": result["away_form"],
            "home_advantage": result["home_advantage"],
            "n": result["n"],
            "evidence_tier": result["evidence_tier"],
            "modeled": True,
            "provenance": result.get("provenance"),
        }
    ]


def _totals_metrics(team: str, line: float, date: str, model: TeamFormModel | None = None) -> list[dict[str, Any]]:
    if model is None:
        model = TeamFormModel()
    try:
        result = model.total_over_probability(team, line, date)
    except Exception as exc:  # noqa: BLE001
        return _e4("sports_model.total_over_probability", str(exc))
    if result.get("status") != "ok":
        return [
            {
                "name": "sports_model.total_over_probability",
                "status": "unavailable",
                "reason": result.get("reason", "unknown"),
                "evidence_tier": "E4",
                "modeled": False,
            }
        ]
    return [
        {
            "name": "sports_model.total_over_probability",
            "value": result["over_probability"],
            "unit": "probability",
            "team": team,
            "line": line,
            "game_date": date,
            "n": result["n"],
            "evidence_tier": result["evidence_tier"],
            "modeled": True,
            "provenance": result.get("provenance"),
        }
    ]


def _player_metrics(player: str, line: float, date: str, model: TeamFormModel | None = None) -> list[dict[str, Any]]:
    if model is None:
        model = TeamFormModel()
    try:
        result = model.player_points_over_probability(player, line, date)
    except Exception as exc:  # noqa: BLE001
        return _e4("sports_model.player_points_over_probability", str(exc))
    if result.get("status") != "ok":
        return [
            {
                "name": "sports_model.player_points_over_probability",
                "status": "unavailable",
                "reason": result.get("reason", "unknown"),
                "evidence_tier": "E4",
                "modeled": False,
            }
        ]
    return [
        {
            "name": "sports_model.player_points_over_probability",
            "value": result["over_probability"],
            "unit": "probability",
            "player": player,
            "line": line,
            "game_date": date,
            "n": result["n"],
            "evidence_tier": result["evidence_tier"],
            "modeled": True,
            "provenance": result.get("provenance"),
        }
    ]


def _market_metrics(from_date: str, to_date: str, max_games: int, model: TeamFormModel | None = None) -> list[dict[str, Any]]:
    if model is None:
        model = TeamFormModel()
    try:
        result = model.market_benchmark(from_date=from_date, to_date=to_date, max_games=max_games)
    except Exception as exc:  # noqa: BLE001
        return _e4("sports_model.market_benchmark", str(exc))
    if result.get("status") != "ok":
        return [
            {
                "name": "sports_model.market_benchmark",
                "status": "unavailable",
                "reason": result.get("reason", "unknown"),
                "evidence_tier": "E4",
                "modeled": False,
            }
        ]
    return [
        {
            "name": "sports_model.market_benchmark",
            "value": result["model_concordance"],
            "unit": "c_index",
            "model_ci_low": result["model_ci_low"],
            "model_ci_high": result["model_ci_high"],
            "market_concordance": result["market_concordance"],
            "market_ci_low": result["market_ci_low"],
            "market_ci_high": result["market_ci_high"],
            "model_minus_market": result["model_minus_market"],
            "n": result["n"],
            "evidence_tier": result["evidence_tier"],
            "modeled": True,
            "provenance": result.get("provenance"),
        }
    ]


def _backtest_metrics(from_date: str, to_date: str, max_games: int, model: TeamFormModel | None = None) -> list[dict[str, Any]]:
    if model is None:
        model = TeamFormModel()
    try:
        result = model.backtest(from_date=from_date, to_date=to_date, max_games=max_games)
    except Exception as exc:  # noqa: BLE001
        return _e4("sports_model.backtest", str(exc))
    if result.get("status") != "ok":
        return [
            {
                "name": "sports_model.backtest",
                "status": "unavailable",
                "reason": result.get("reason", "unknown"),
                "evidence_tier": "E4",
                "modeled": False,
            }
        ]
    return [
        {
            "name": "sports_model.backtest",
            "value": result["concordance"],
            "unit": "c_index",
            "ci_low": result["ci_low"],
            "ci_high": result["ci_high"],
            "calibration_error": result["calibration_error"],
            "lift": result["lift"],
            "n": result["n"],
            "home_advantage": result["home_advantage"],
            "form_scale": result["form_scale"],
            "evidence_tier": result["evidence_tier"],
            "modeled": True,
            "provenance": result.get("provenance"),
        }
    ]


def _live_props_metrics(sport: str, max_legs: int, edge: float) -> list[dict[str, Any]]:
    """Live player-prop edge test: real book props vs the model. Degrades to an
    honest E4 unavailable metric when no Odds API key is configured."""
    import asyncio

    from sports_science.live_props import LivePropEngine

    async def _run() -> dict[str, Any]:
        engine = LivePropEngine(edge_threshold=edge)
        if not engine.available():
            return {
                "name": "sports_model.live_props",
                "status": "unavailable",
                "reason": "Odds API key not set (set THE_ODDS_API_KEY or add to Keywire)",
                "evidence_tier": "E4",
                "modeled": False,
            }
        result = await engine.run(sport=sport, max_legs=max_legs)
        return {
            "name": "sports_model.live_props",
            "value": result.get("avg_edge"),
            "unit": "edge",
            "fetched_legs": result.get("fetched_legs"),
            "scored_legs": result.get("scored_legs"),
            "edges_above_threshold": result.get("edges_above_threshold"),
            "status": result.get("status"),
            "reason": result.get("reason"),
            "evidence_tier": result.get("evidence_tier", "E4"),
            "modeled": result.get("modeled", False),
            "ledger_rows": result.get("ledger_rows", [])[:10],
        }

    try:
        return [asyncio.run(_run())]
    except Exception as exc:  # noqa: BLE001
        return [{
            "name": "sports_model.live_props",
            "status": "unavailable",
            "reason": str(exc),
            "evidence_tier": "E4",
            "modeled": False,
        }]


def _live_ml_metrics(sport: str, max_games: int, edge: float) -> list[dict[str, Any]]:
    """Live moneyline edge test: team model vs real live closing lines."""
    import asyncio

    from sports_science.live_props import LivePropEngine

    async def _run() -> dict[str, Any]:
        engine = LivePropEngine(edge_threshold=edge)
        if not engine.available():
            return {
                "name": "sports_model.live_ml",
                "status": "unavailable",
                "reason": "Odds API key not set (set THE_ODDS_API_KEY or add to Keywire)",
                "evidence_tier": "E4",
                "modeled": False,
            }
        result = await engine.run_ml(sport=sport, max_games=max_games, edge_threshold=edge)
        return {
            "name": "sports_model.live_ml",
            "value": result.get("avg_edge"),
            "unit": "edge",
            "fetched_events": result.get("fetched_events"),
            "scored_edges": result.get("scored_edges"),
            "status": result.get("status"),
            "reason": result.get("reason"),
            "evidence_tier": result.get("evidence_tier", "E4"),
            "modeled": result.get("modeled", False),
            "ledger_rows": result.get("ledger_rows", [])[:10],
        }

    try:
        return [asyncio.run(_run())]
    except Exception as exc:  # noqa: BLE001
        return [{
            "name": "sports_model.live_ml",
            "status": "unavailable",
            "reason": str(exc),
            "evidence_tier": "E4",
            "modeled": False,
        }]


def _settle_metrics(sport: str) -> list[dict[str, Any]]:
    """Settle open ledger rows against real scores via the Scores API."""
    import asyncio

    from sports_science.live_props import LivePropEngine

    async def _run() -> dict[str, Any]:
        engine = LivePropEngine()
        if not engine.available():
            return {
                "name": "sports_model.settle",
                "status": "unavailable",
                "reason": "Odds API key not set (set THE_ODDS_API_KEY or add to Keywire)",
                "evidence_tier": "E4",
                "modeled": False,
            }
        result = await engine.settle(sport=sport)
        return {
            "name": "sports_model.settle",
            "value": result.get("settled"),
            "unit": "bets",
            "settled": result.get("settled"),
            "open": result.get("open"),
            "status": result.get("status"),
            "reason": result.get("reason"),
            "evidence_tier": result.get("evidence_tier", "E4"),
            "modeled": result.get("modeled", False),
        }

    try:
        return [asyncio.run(_run())]
    except Exception as exc:  # noqa: BLE001
        return [{
            "name": "sports_model.settle",
            "status": "unavailable",
            "reason": str(exc),
            "evidence_tier": "E4",
            "modeled": False,
        }]


def build_output(kind: str, metrics: list[dict[str, Any]], domain: str) -> dict[str, Any]:
    tiers = ["E1", "E2", "E3", "E4"]
    worst = None
    for m in metrics:
        t = m.get("evidence_tier")
        if isinstance(t, str) and t in tiers:
            if worst is None or tiers.index(t) > tiers.index(worst):
                worst = t
    return {
        "ok": True,
        "kind": kind,
        "domain": domain,
        "metrics": metrics,
        "evidence_tier": worst or "E4",
        "generated_at": utc_now_iso(),
    }


def _main() -> int:
    parser = argparse.ArgumentParser(description="bbtech sports model bridge")
    sub = parser.add_subparsers(dest="command", required=True)

    q = sub.add_parser("query", help="modeled home win probability")
    q.add_argument("--home", required=True)
    q.add_argument("--away", required=True)
    q.add_argument("--date", required=True, help="game date YYYY-MM-DD")

    t = sub.add_parser("totals", help="modeled over probability for a total line")
    t.add_argument("--team", required=True)
    t.add_argument("--line", type=float, required=True)
    t.add_argument("--date", required=True)

    p = sub.add_parser("player", help="modeled over probability for a player pts prop")
    p.add_argument("--player", required=True)
    p.add_argument("--line", type=float, required=True)
    p.add_argument("--date", required=True)

    m = sub.add_parser("market", help="benchmark model vs the real betting market")
    m.add_argument("--from", dest="from_date", default="2010-01-01")
    m.add_argument("--to", dest="to_date", default="2018-06-01")
    m.add_argument("--max", dest="max_games", type=int, default=600)

    l = sub.add_parser("live-props", help="live player-prop edge test vs real book odds")
    l.add_argument("--sport", default="NBA")
    l.add_argument("--max", dest="max_legs", type=int, default=200)
    l.add_argument("--edge", type=float, default=0.03)

    lm = sub.add_parser("live-ml", help="live moneyline edge test: team model vs real closing lines")
    lm.add_argument("--sport", default="NBA")
    lm.add_argument("--max", dest="max_games", type=int, default=30)
    lm.add_argument("--edge", type=float, default=0.03)

    st = sub.add_parser("settle", help="settle open ledger rows against real scores")
    st.add_argument("--sport", default="NBA")

    b = sub.add_parser("backtest", help="validate the model on historical games")
    b.add_argument("--from", dest="from_date", default="2013-01-01")
    b.add_argument("--to", dest="to_date", default="2023-06-01")
    b.add_argument("--max", dest="max_games", type=int, default=800)

    args = parser.parse_args()
    try:
        model = TeamFormModel()
        if args.command == "query":
            metrics = _win_prob_metrics(args.home, args.away, args.date, model)
        elif args.command == "totals":
            metrics = _totals_metrics(args.team, args.line, args.date, model)
        elif args.command == "player":
            metrics = _player_metrics(args.player, args.line, args.date, model)
        elif args.command == "market":
            metrics = _market_metrics(args.from_date, args.to_date, args.max_games, model)
        elif args.command == "backtest":
            metrics = _backtest_metrics(args.from_date, args.to_date, args.max_games, model)
        elif args.command == "live-props":
            metrics = _live_props_metrics(args.sport, args.max_legs, args.edge)
        elif args.command == "live-ml":
            metrics = _live_ml_metrics(args.sport, args.max_games, args.edge)
        elif args.command == "settle":
            metrics = _settle_metrics(args.sport)
        else:  # pragma: no cover
            metrics = []
        print(json.dumps(build_output(args.command, metrics, "sports"), default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())