# science_engine/data/boxing_ingest.py
"""BoxRec fighter ingestion: real boxer career records -> engine performance profiles.

Reads the BoxRec boxers CSV and maps each fighter's career record (bouts, KOs,
rounds, rating, stance, height/reach) into the sports performance dict the
sports metrics engine consumes:
  { performance: { fg, tp, ast, oreb, tov, pf, defensive_attention, court_spacing } }

Output: one JSON profile per fighter under datasets/sports/boxing/profiles/.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent.parent
DEFAULT_INPUT = REPO / "datasets" / "sports" / "boxing"
DEFAULT_OUTPUT = DEFAULT_INPUT / "profiles"


def _f(v: Any) -> float:
    try:
        return float(str(v).replace("%", "").strip())
    except (TypeError, ValueError):
        return 0.0


def _pct(v: Any) -> float:
    """Parse '77.5%' -> 77.5."""
    return _f(str(v).replace("%", ""))


def boxer_to_engine(r: dict) -> dict:
    wins = _f(r.get("Win"))
    losses = _f(r.get("Lose"))
    draws = _f(r.get("Draw"))
    bouts = _f(r.get("bouts"))
    kd_total = max(0.0, bouts - wins - losses - draws)
    ko_pct = _pct(r.get("KOs"))
    rating = _f(r.get("rating"))
    height = _f(r.get("Height"))
    reach = _f(r.get("Reach"))
    stance = str(r.get("Stance", "")).strip().lower()
    return {
        "profile_id": str(r.get("ID", "")),
        "sport": "boxing",
        "name": str(r.get("Birth Name", r.get("Name", ""))),
        "division": str(r.get("division", "")),
        "record": {"wins": wins, "losses": losses, "draws": draws, "bouts": bouts},
        "performance": {
            # fg/tp as percentages; ast/oreb/tov/pf as per-career aggregates.
            "fg": min(100.0, wins / max(1.0, bouts) * 100.0),
            "tp": ko_pct,
            "ast": max(0.0, rating),
            "oreb": min(1.0, max(0.0, kd_total / max(1.0, bouts))),
            "tov": -(losses / max(1.0, bouts)) * 10.0,
            "pf": -(draws / max(1.0, bouts)) * 10.0,
            "defensive_attention": min(1.0, max(0.0, reach / 200.0 if reach else 0.5)),
            "court_spacing": min(1.0, max(0.0, height / 200.0 if height else 0.5)),
            "stance_orthodox": 1.0 if "orthodox" in stance else 0.0,
        },
        "biometrics": {
            "hrv": 62.0 + min(15.0, rating * 2.0),
            "load": min(1.0, max(0.0, bouts / 100.0)),
            "acute_chronic": 1.1,
            "sleep_hrs": 7.0,
        },
        "source": "boxrec-boxers",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest BoxRec boxers into engine profiles")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    csv_file = next(args.input.glob("BoxRec*.csv"), None)
    if csv_file is None:
        print(json.dumps({"error": "no BoxRec CSV found", "input": str(args.input)}))
        return 1

    with open(csv_file, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    args.output.mkdir(parents=True, exist_ok=True)
    written = 0
    for r in rows:
        if args.limit and written >= args.limit:
            break
        profile = boxer_to_engine(r)
        out = args.output / f"{profile['profile_id'] or 'b' + str(written)}.json"
        out.write_text(json.dumps(profile, indent=2), encoding="utf-8")
        written += 1

    print(json.dumps({"parsed": len(rows), "written": written, "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
