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
from sports_science.validation_engine import require_honest, utc_now_iso  # noqa: E402
from sports_science.evidence import worst_tier  # noqa: E402


@require_honest
def _win_prob_metrics(home: str, away: str, date: str) -> list[dict[str, Any]]:
    model = TeamFormModel()
    result = model.win_probability(home, away, date)
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


@require_honest
def _totals_metrics(team: str, line: float, date: str) -> list[dict[str, Any]]:
    model = TeamFormModel()
    result = model.total_over_probability(team, line, date)
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


@require_honest
def _player_metrics(player: str, line: float, date: str) -> list[dict[str, Any]]:
    model = TeamFormModel()
    result = model.player_points_over_probability(player, line, date)
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


@require_honest
def _market_metrics(from_date: str, to_date: str, max_games: int) -> list[dict[str, Any]]:
    model = TeamFormModel()
    result = model.market_benchmark(from_date=from_date, to_date=to_date, max_games=max_games)
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


@require_honest
def _backtest_metrics(from_date: str, to_date: str, max_games: int) -> list[dict[str, Any]]:
    model = TeamFormModel()
    result = model.backtest(from_date=from_date, to_date=to_date, max_games=max_games)
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


def build_output(kind: str, metrics: list[dict[str, Any]], domain: str) -> dict[str, Any]:
    return {
        "ok": True,
        "kind": kind,
        "domain": domain,
        "metrics": metrics,
        "evidence_tier": worst_tier({m.get("name", str(i)): m for i, m in enumerate(metrics)}) or "E4",
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

    b = sub.add_parser("backtest", help="validate the model on historical games")
    b.add_argument("--from", dest="from_date", default="2013-01-01")
    b.add_argument("--to", dest="to_date", default="2023-06-01")
    b.add_argument("--max", dest="max_games", type=int, default=800)

    args = parser.parse_args()
    try:
        if args.command == "query":
            metrics = _win_prob_metrics(args.home, args.away, args.date)
        elif args.command == "totals":
            metrics = _totals_metrics(args.team, args.line, args.date)
        elif args.command == "player":
            metrics = _player_metrics(args.player, args.line, args.date)
        elif args.command == "market":
            metrics = _market_metrics(args.from_date, args.to_date, args.max_games)
        elif args.command == "backtest":
            metrics = _backtest_metrics(args.from_date, args.to_date, args.max_games)
        else:  # pragma: no cover
            metrics = []
        print(json.dumps(build_output(args.command, metrics, "sports"), default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())