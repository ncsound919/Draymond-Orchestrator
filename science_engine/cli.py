# science_engine/cli.py
"""CLI: run a simulation model.

Contract (mirrors sports/biotech runner style):
  python -m science_engine.cli <model.json> [ticks] [--params '{"k": v}']
Output: machine-readable JSON SimulationResult. Non-zero exit => {"error": ...}.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .runtime import ModelValidationError, load_model, run_model


def _main() -> int:
    parser = argparse.ArgumentParser(description="Deterministic ticked simulation runtime")
    parser.add_argument("model", help="path to a model JSON")
    parser.add_argument("ticks", nargs="?", type=int, default=None,
                        help="override model ticks (optional)")
    parser.add_argument("--params", default=None,
                        help="JSON object of parameter overrides (optional)")
    args = parser.parse_args()
    try:
        spec = load_model(args.model)
        if args.ticks is not None:
            spec["ticks"] = max(1, args.ticks)
        if args.params:
            overrides = json.loads(args.params)
            if not isinstance(overrides, dict):
                raise ValueError("--params must be a JSON object")
            merged = dict(spec.get("params") or {})
            merged.update({k: float(v) for k, v in overrides.items()})
            spec["params"] = merged
        result = run_model(spec)
        print(json.dumps(result.to_dict(), default=str))
        return 0 if result.error is None else 1
    except (ModelValidationError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
