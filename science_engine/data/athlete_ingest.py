# science_engine/data/athlete_ingest.py
"""Athlete injury dataset ingestion: real collegiate athlete load/injury -> engine profiles.

Converts the Collegiate Athlete Injury dataset (Fatigue, Load Balance, ACL risk,
training hours) into the sports performance/biometric dict the runners consume.
Output: one JSON profile per athlete under datasets/sports/athlete-injury/profiles/.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent.parent
DEFAULT_INPUT = REPO / "datasets" / "sports" / "athlete-injury"
DEFAULT_OUTPUT = DEFAULT_INPUT / "profiles"


def _f(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def athlete_to_engine(r: dict) -> dict:
    fatigue = _f(r.get("Fatigue_Score")) / 10.0
    hours = _f(r.get("Training_Hours_Per_Week"))
    load_balance = _f(r.get("Load_Balance_Score"))
    acwr = round(1.0 + (load_balance - 50.0) / 50.0 * 0.5, 2)
    return {
        "profile_id": str(r.get("Athlete_ID", "")),
        "sport": "basketball",
        "name": str(r.get("Athlete_ID", "")),
        "age": _f(r.get("Age")),
        "position": str(r.get("Position", "")),
        "acl_risk_score": _f(r.get("ACL_Risk_Score")),
        "injury_indicator": int(_f(r.get("Injury_Indicator"))),
        "performance": {
            "fg": 60.0, "tp": 35.0, "ast": 5.0, "oreb": 4.0,
            "tov": -2.5, "pf": -3.0,
            "defensive_attention": 0.5, "court_spacing": 0.4,
            "proliferation": 50.0, "clearance": 50.0, "resource": 50.0, "metastasis": 50.0,
        },
        "biometrics": {
            "hrv": 65.0 - fatigue * 15.0,
            "load": min(1.0, hours / 20.0),
            "acute_chronic": max(0.5, min(1.5, acwr)),
            "sleep_hrs": 7.0,
        },
        "source": "collegiate-athlete-injury",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest athlete injury into engine profiles")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    csv_file = next(args.input.glob("*injury*.csv"), None)
    if csv_file is None:
        print(json.dumps({"error": "no athlete injury CSV found", "input": str(args.input)}))
        return 1

    with open(csv_file, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    args.output.mkdir(parents=True, exist_ok=True)
    written = 0
    for r in rows:
        if args.limit and written >= args.limit:
            break
        profile = athlete_to_engine(r)
        out = args.output / f"{profile['profile_id']}.json"
        out.write_text(json.dumps(profile, indent=2), encoding="utf-8")
        written += 1

    print(json.dumps({"parsed": len(rows), "written": written, "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
