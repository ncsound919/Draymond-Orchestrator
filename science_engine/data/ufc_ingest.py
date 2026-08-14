# science_engine/data/ufc_ingest.py
"""UFC fighter ingestion: real mixed-martial-arts fighter averages -> sports profiles.

Reads raw_fighter_details.csv (per-fighter strike/takedown/submission averages)
and maps each fighter into the sports performance dict the sports metrics engine
consumes. Output: one JSON profile per fighter under datasets/sports/ufc/profiles/.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent.parent
DEFAULT_INPUT = REPO / "datasets" / "kaggle" / "ufc"
DEFAULT_OUTPUT = REPO / "datasets" / "sports" / "ufc" / "profiles"


def _f(v: Any) -> float:
    try:
        return float(str(v).replace("%", "").replace(" lbs.", "").replace("cm", "").strip())
    except (TypeError, ValueError):
        return 0.0


def ufc_to_engine(r: dict) -> dict:
    sig_acc = _f(r.get("Str_Acc"))
    td_acc = _f(r.get("TD_Acc"))
    slpm = _f(r.get("SLpM"))
    sapm = _f(r.get("SApM"))
    sub_avg = _f(r.get("Sub_Avg"))
    td_avg = _f(r.get("TD_Avg"))
    weight = _f(r.get("Weight"))
    height = _f(r.get("Height"))
    return {
        "profile_id": str(r.get("fighter_name", "")),
        "sport": "mma",
        "name": str(r.get("fighter_name", "")),
        "performance": {
            # fg/tp as percentages (striking/takedown accuracy); ast/oreb/tov/pf
            # as per-fight aggregates.
            "fg": sig_acc,
            "tp": td_acc,
            "ast": sub_avg,
            "oreb": td_avg,
            "tov": -sapm,
            "pf": -slpm,
            "defensive_attention": min(1.0, max(0.0, weight / 300.0)),
            "court_spacing": min(1.0, max(0.0, (height or 175.0) / 220.0)),
        },
        "biometrics": {
            "hrv": 60.0 + min(20.0, slpm * 2.0),
            "load": min(1.0, max(0.0, slpm / 10.0)),
            "acute_chronic": 1.0,
            "sleep_hrs": 7.0,
        },
        "source": "ufc-fighter-details",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest UFC fighters into engine profiles")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    csv_file = next(args.input.glob("raw_fighter_details.csv"), None)
    if csv_file is None:
        print(json.dumps({"error": "no UFC fighter CSV found", "input": str(args.input)}))
        return 1

    with open(csv_file, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    args.output.mkdir(parents=True, exist_ok=True)
    written = 0
    for r in rows:
        if args.limit and written >= args.limit:
            break
        profile = ufc_to_engine(r)
        out = args.output / f"{profile['profile_id'] or 'f' + str(written)}.json"
        out.write_text(json.dumps(profile, indent=2), encoding="utf-8")
        written += 1

    print(json.dumps({"parsed": len(rows), "written": written, "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
