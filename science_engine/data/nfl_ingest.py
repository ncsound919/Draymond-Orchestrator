# science_engine/data/nfl_ingest.py
"""NFL injury-report ingestion: real player injury histories -> sports profiles.

Reads nfl_injury_reports_FULL_2009_2025.csv and aggregates each player-season
into an athlete profile the sports metrics engine consumes. Injury history
feeds the biological-load / durability signal (injury-prone players get higher
injury-risk profiles). Output: one JSON profile per player-season under
datasets/sports/nfl/profiles/.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent.parent
DEFAULT_INPUT = REPO / "datasets" / "kaggle" / "nfl-injury-reports"
DEFAULT_OUTPUT = REPO / "datasets" / "sports" / "nfl" / "profiles"

OUT_STATUS = {"Out": 1.0, "Doubtful": 0.8, "Questionable": 0.5, "": 0.2}
PRACTICE_DOWN = {"Did Not Practice In Week": 1.0, "Limited Participation in Practice": 0.6, "Full Participation in Practice": 0.2}


def _f(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _status_score(s: str) -> float:
    return OUT_STATUS.get(str(s or "").strip(), 0.2)


def _practice_score(s: str) -> float:
    key = str(s or "").strip()
    return PRACTICE_DOWN.get(key, 0.3)


def nfl_to_engine(player_season: dict) -> dict:
    n = max(1, player_season["count"])
    injury_rate = player_season["out_events"] / n
    practice_deficit = player_season["practice_sum"] / n
    weeks = player_season["weeks"]
    position = player_season.get("position", "")
    return {
        "profile_id": f"{player_season['season']}_{player_season['name']}".replace(" ", "_"),
        "sport": "football",
        "name": player_season["name"],
        "season": str(player_season["season"]),
        "position": position,
        "performance": {
            # Engine expects fg/tp percentages; ast/oreb/tov/pf as per-game.
            "fg": 60.0 + (1.0 - injury_rate) * 20.0,
            "tp": 30.0,
            "ast": max(0.0, 5.0 - injury_rate * 5.0),
            "oreb": 3.0,
            "tov": -(practice_deficit * 3.0),
            "pf": -(injury_rate * 3.0),
            "defensive_attention": 0.5,
            "court_spacing": 0.4,
        },
        "biometrics": {
            "hrv": 65.0 - injury_rate * 20.0,
            "load": min(1.0, max(0.0, (weeks + injury_rate) / 20.0)),
            "acute_chronic": max(0.5, min(1.5, 1.2 - injury_rate * 0.5)),
            "sleep_hrs": 7.0,
        },
        "injury_history": {
            "injury_rate": round(injury_rate, 4),
            "out_events": player_season["out_events"],
            "weeks_reported": weeks,
            "top_injuries": player_season["top_injuries"][:5],
        },
        "source": "nfl-injury-reports-2009-2025",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest NFL injury reports into engine profiles")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    csv_file = next(args.input.glob("nfl_injury_reports*.csv"), None)
    if csv_file is None:
        print(json.dumps({"error": "no NFL injury CSV found", "input": str(args.input)}))
        return 1

    ps: dict[tuple, dict] = defaultdict(
        lambda: {"count": 0, "out_events": 0, "practice_sum": 0.0, "weeks": 0, "top_injuries": [], "injuries": {}}
    )
    with open(csv_file, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            season = str(row.get("season", "")).strip()
            name = str(row.get("full_name", "")).strip()
            if not season or not name:
                continue
            key = (season, name)
            rec = ps[key]
            rec.setdefault("count", 0)
            rec["count"] += 1
            if str(row.get("report_status", "")).strip() == "Out":
                rec["out_events"] += 1
            rec["practice_sum"] += _practice_score(row.get("practice_status"))
            injury = str(row.get("report_primary_injury", "")).strip()
            if injury:
                rec["injuries"][injury] = rec["injuries"].get(injury, 0) + 1
            rec["position"] = str(row.get("position", "")).strip()
            week = _f(row.get("week"))
            if week:
                rec["weeks"] = max(rec["weeks"], int(week))

    for rec in ps.values():
        rec["top_injuries"] = sorted(rec["injuries"].items(), key=lambda kv: -kv[1])

    args.output.mkdir(parents=True, exist_ok=True)
    written = 0
    for (season, name), rec in sorted(ps.items()):
        if args.limit and written >= args.limit:
            break
        rec["season"] = season
        rec["name"] = name
        profile = nfl_to_engine(rec)
        out = args.output / f"{profile['profile_id']}.json"
        out.write_text(json.dumps(profile, indent=2), encoding="utf-8")
        written += 1

    print(json.dumps({"parsed": len(ps), "written": written, "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
