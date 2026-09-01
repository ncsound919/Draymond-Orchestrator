from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sports_science.datasets_config import nba_sqlite_path, model_db_path
from sports_science.validation_engine import utc_now_iso, provenance_record
from sports_science.scorecard_api import persist_scorecard

CODE_VERSION = "run_players-1.0.0"


def _player_db_path() -> Path | None:
    for candidate in (nba_sqlite_path(), model_db_path()):
        if candidate and candidate.exists():
            return candidate
    return None


def _db_has_player_game(db: Path) -> bool:
    try:
        with sqlite3.connect(str(db)) as con:
            cur = con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='player_game'"
            )
            return cur.fetchone() is not None
    except sqlite3.Error:
        return False


def _season_game_count(db: Path, season: str) -> int:
    try:
        with sqlite3.connect(str(db)) as con:
            row = con.execute(
                "SELECT COUNT(DISTINCT game_date) FROM player_game WHERE game_date LIKE ?",
                (f"{season}%",),
            ).fetchone()
            return int(row[0]) if row and row[0] else 0
    except sqlite3.Error:
        return 0


def _metrics_for_player(player: str, season: str) -> list[dict]:
    prov = provenance_record(
        "run_players.metrics",
        {"player": player, "season": season},
        {},
        CODE_VERSION,
    )
    db = _player_db_path()
    if db is None:
        return [
            {"name": f"player.{player}.games", "value": None, "unit": "count",
             "evidence_tier": "E4", "modeled": False, "provenance": prov,
             "reason": "nba database not found"},
            {"name": f"player.{player}.pts_per_game", "value": None, "unit": "pts/game",
             "evidence_tier": "E4", "modeled": False, "provenance": prov,
             "reason": "nba database not found"},
            {"name": f"player.{player}.points_per_100", "value": None, "unit": "pts/100",
             "evidence_tier": "E4", "modeled": False, "provenance": prov,
             "reason": "nba database not found; possession data required for pace-adjusted rate"},
        ]

    if not _db_has_player_game(db):
        return [
            {"name": f"player.{player}.games", "value": None, "unit": "count",
             "evidence_tier": "E4", "modeled": False, "provenance": prov,
             "reason": "player_game table not found"},
            {"name": f"player.{player}.pts_per_game", "value": None, "unit": "pts/game",
             "evidence_tier": "E4", "modeled": False, "provenance": prov,
             "reason": "player_game table not found"},
            {"name": f"player.{player}.points_per_100", "value": None, "unit": "pts/100",
             "evidence_tier": "E4", "modeled": False, "provenance": prov,
             "reason": "player_game table not found"},
        ]

    try:
        with sqlite3.connect(str(db)) as con:
            row = con.execute(
                "SELECT SUM(pts), SUM(minutes), COUNT(*) FROM player_game "
                "WHERE player_name = ? AND game_date LIKE ?",
                (player, f"{season}%"),
            ).fetchone()
    except sqlite3.Error as exc:
        return [
            {"name": f"player.{player}.games", "value": None, "unit": "count",
             "evidence_tier": "E4", "modeled": False, "provenance": prov,
             "reason": f"db error: {exc}"},
            {"name": f"player.{player}.pts_per_game", "value": None, "unit": "pts/game",
             "evidence_tier": "E4", "modeled": False, "provenance": prov,
             "reason": f"db error: {exc}"},
            {"name": f"player.{player}.points_per_100", "value": None, "unit": "pts/100",
             "evidence_tier": "E4", "modeled": False, "provenance": prov,
             "reason": f"db error: {exc}"},
        ]

    total_pts = float(row[0]) if row and row[0] else 0.0
    total_min = float(row[1]) if row and row[1] else 0.0
    n_games = int(row[2]) if row and row[2] else 0

    if n_games == 0:
        return [
            {"name": f"player.{player}.games", "value": 0, "unit": "count",
             "evidence_tier": "E1", "modeled": False, "provenance": prov},
            {"name": f"player.{player}.pts_per_game", "value": None, "unit": "pts/game",
             "evidence_tier": "E4", "modeled": False, "provenance": prov,
             "reason": f"no games for {player} in {season}"},
            {"name": f"player.{player}.points_per_100", "value": None, "unit": "pts/100",
             "evidence_tier": "E4", "modeled": False, "provenance": prov,
             "reason": f"no games for {player} in {season}; possessions unavailable"},
        ]

    games_metric = {"name": f"player.{player}.games", "value": n_games,
                    "unit": "count", "evidence_tier": "E1", "modeled": False, "provenance": prov}
    pts_per_game_metric = {"name": f"player.{player}.pts_per_game",
                           "value": round(total_pts / n_games, 4),
                           "unit": "pts/game", "evidence_tier": "E2",
                           "modeled": True, "provenance": prov}

    n_team_games = _season_game_count(db, season)
    if n_team_games > 0:
        league_avg_poss_per_game = 100.0
        team_poss = league_avg_poss_per_game * n_team_games
        player_poss = (total_min / 48.0) * team_poss if total_min > 0 else 0.0
        pp100 = round(total_pts / player_poss * 100.0, 4) if player_poss > 0 else None
        if pp100 is not None:
            return [
                games_metric, pts_per_game_metric,
                {"name": f"player.{player}.points_per_100", "value": pp100,
                 "unit": "pts/100", "evidence_tier": "E3",
                 "modeled": True, "provenance": prov,
                 "note": "team possessions estimated at 100/game (league avg); Dean Oliver formula requires FGA/FTA/ORB/TOV columns not present in player_game table"},
            ]

    return [
        games_metric, pts_per_game_metric,
        {"name": f"player.{player}.points_per_100", "value": None,
         "unit": "pts/100", "evidence_tier": "E4", "modeled": False, "provenance": prov,
         "reason": "team possession data required for pace-adjusted rate; not available in player_game table (needs FGA/FTA/ORB/TOV)"},
    ]


def _main() -> int:
    parser = argparse.ArgumentParser(description="Per-player PBP-derived metrics")
    parser.add_argument("--player", required=True)
    parser.add_argument("--season", default="2015")
    parser.add_argument("--persist", action="store_true",
                        help="Persist to Draymond science_insights (source 'bbtech_player')")
    args = parser.parse_args()
    try:
        metrics = _metrics_for_player(args.player, args.season)
        result = {
            "ok": True,
            "player": args.player,
            "season": args.season,
            "metrics": metrics,
            "generated_at": utc_now_iso(),
        }
        if args.persist:
            result["persist"] = persist_scorecard(
                result, source="bbtech_player", session_id=args.player,
            )
        print(json.dumps(result, default=str))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
