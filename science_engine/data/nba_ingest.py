# science_engine/data/nba_ingest.py
"""NBA dataset ingestion: real player-game box scores -> engine performance profiles.

Reads the NBA-Data-2010-2024 box-score CSVs and aggregates each player-season
into the performance dict the sports metrics engine consumes:
  { performance: { fg, tp, ast, oreb, tov, pf, defensive_attention, court_spacing } }

Output: one JSON profile per player-season under datasets/sports/nba/profiles/.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent.parent
DEFAULT_INPUT = REPO / "datasets" / "sports" / "nba"
DEFAULT_OUTPUT = DEFAULT_INPUT / "profiles"


def _f(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _minutes_to_float(m: str) -> float:
    """Convert 'MM:SS' to fractional minutes."""
    if not m:
        return 0.0
    try:
        if ":" in m:
            mm, ss = m.split(":")
            return int(mm) + int(ss) / 60.0
        return float(m)
    except (TypeError, ValueError):
        return 0.0


def parse_box_scores(paths: list[Path]) -> list[dict]:
    rows: list[dict] = []
    for p in paths:
        with open(p, "r", encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                rows.append(row)
    return rows


def aggregate_player_seasons(rows: list[dict]) -> dict[tuple[str, str], dict]:
    agg: dict[tuple[str, str], dict] = {}
    for r in rows:
        season = str(r.get("season_year", "unknown"))
        pid = str(r.get("personId", ""))
        name = str(r.get("personName", f"player-{pid}"))
        key = (season, pid)
        mins = _minutes_to_float(r.get("minutes", "0"))
        if mins <= 0:
            continue
        a = agg.setdefault(
            key,
            {
                "season": season,
                "player_id": pid,
                "name": name,
                "team": str(r.get("teamName", "")),
                "games": 0,
                "minutes": 0.0,
                "fgm": 0.0, "fga": 0.0, "tpm": 0.0, "tpa": 0.0,
                "ftm": 0.0, "fta": 0.0,
                "oreb": 0.0, "dreb": 0.0, "ast": 0.0, "stl": 0.0,
                "blk": 0.0, "tov": 0.0, "pf": 0.0, "pts": 0.0,
                "plus_minus": 0.0,
            },
        )
        a["games"] += 1
        a["minutes"] += mins
        a["fgm"] += _f(r.get("fieldGoalsMade"))
        a["fga"] += _f(r.get("fieldGoalsAttempted"))
        a["tpm"] += _f(r.get("threePointersMade"))
        a["tpa"] += _f(r.get("threePointersAttempted"))
        a["ftm"] += _f(r.get("freeThrowsMade"))
        a["fta"] += _f(r.get("freeThrowsAttempted"))
        a["oreb"] += _f(r.get("reboundsOffensive"))
        a["dreb"] += _f(r.get("reboundsDefensive"))
        a["ast"] += _f(r.get("assists"))
        a["stl"] += _f(r.get("steals"))
        a["blk"] += _f(r.get("blocks"))
        a["tov"] += _f(r.get("turnovers"))
        a["pf"] += _f(r.get("foulsPersonal"))
        a["pts"] += _f(r.get("points"))
        a["plus_minus"] += _f(r.get("plusMinusPoints"))
    return agg


def to_engine_profile(a: dict) -> dict:
    games = max(1, a["games"])
    fga = max(1.0, a["fga"])
    tpa = max(1.0, a["tpa"])
    fta = max(1.0, a["fta"])
    ast = a["ast"] / games
    tov = a["tov"] / games
    pf = a["pf"] / games
    return {
        "profile_id": f"{a['season']}_{a['player_id']}",
        "sport": "basketball",
        "name": a["name"],
        "season": a["season"],
        "team": a["team"],
        "games": a["games"],
        "performance": {
            # Engine expects fg/tp as percentages; ast/oreb/tov/pf as per-game.
            "fg": a["fgm"] / fga * 100.0,
            "tp": a["tpm"] / tpa * 100.0,
            "ast": ast,
            "oreb": a["oreb"] / games,
            "tov": -tov,  # engine's double-negative convention
            "pf": -pf,
            "defensive_attention": min(1.0, (a["stl"] + a["blk"]) / games / 5.0),
            "court_spacing": min(1.0, a["tpm"] / tpa if tpa else 0.0),
        },
        "biometrics": {
            "hrv": 65.0,  # placeholder; real HRV not in box scores
            "load": min(1.0, a["minutes"] / games / 48.0),
            "acute_chronic": 1.0,
            "sleep_hrs": 7.5,
        },
        "source": "nba-box-scores-2010-2024",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest NBA box scores into engine profiles")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=0, help="cap profiles (0 = all)")
    args = parser.parse_args()

    box_files = sorted(args.input.glob("regular_season_box_scores_*.csv"))
    if not box_files:
        print(json.dumps({"error": "no box score CSVs found", "input": str(args.input)}))
        return 1

    rows = parse_box_scores(box_files)
    agg = aggregate_player_seasons(rows)
    print(f"parsed {len(rows)} player-game rows -> {len(agg)} player-seasons")

    args.output.mkdir(parents=True, exist_ok=True)
    written = 0
    for (season, pid) in sorted(agg.keys()):
        if args.limit and written >= args.limit:
            break
        profile = to_engine_profile(agg[(season, pid)])
        out = args.output / f"{profile['profile_id']}.json"
        out.write_text(json.dumps(profile, indent=2), encoding="utf-8")
        written += 1

    print(json.dumps({"written": written, "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
