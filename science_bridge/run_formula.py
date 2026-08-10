# science_bridge/run_formula.py
"""CLI runner: compute NBA advanced stats + biotech analogs from a box score.

Contract:
  python science_bridge/run_formula.py session <box.json> [--stat KEY]
Prints machine-readable JSON (list of computed metrics, or single stat).
Non-zero exit => {"error": ...}.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from science_bridge.formulas import compute_box_score  # noqa: E402


def _main() -> int:
    parser = argparse.ArgumentParser(description="NBA advanced-stat formula engine (math-x verified)")
    parser.add_argument("session", help="session id (ignored, for contract compatibility)")
    parser.add_argument("box", help="path to box-score JSON")
    parser.add_argument("--stat", default=None, help="compute only this stat key (e.g. PER, TS_PCT)")
    args = parser.parse_args()
    try:
        raw = json.loads(Path(args.box).read_text(encoding="utf-8-sig"))
        if not isinstance(raw, dict):
            raise ValueError("box score must be an object")
        results = compute_box_score(raw)
        if args.stat:
            stat_key = args.stat.upper()
            results = [r for r in results if r["key"] == stat_key]
            if not results:
                print(json.dumps({"error": f"unknown stat '{args.stat}'"}, default=str))
                return 1
        print(json.dumps(results, default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
