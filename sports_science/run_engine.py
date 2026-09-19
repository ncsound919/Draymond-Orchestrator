# sports_science/run_engine.py
"""CLI: run a registered engine or dump the locked registry as JSON.

  python sports_science/run_engine.py --list
  python sports_science/run_engine.py --registry
  python sports_science/run_engine.py --engine adjusted_plus_minus [--input '<json>']

Used by the bbtech-web-app deployment so it can serve real, lockfile-pinned
engine output instead of fabricated analytics. Prints JSON to stdout; exits
non-zero with {"ok": false, "error": ...} on failure.
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

from sports_science.engine_registry import ENGINES, snapshot_all_engines  # noqa: E402
from sports_science.registry_api import build_registry_response  # noqa: E402


def registry_payload() -> dict[str, Any]:
    """Registry inventory (engines + lockfile address) plus a live drift check."""
    _, _, body = build_registry_response()
    payload: dict[str, Any] = json.loads(body)
    from sports_science.engine_registry import LOCKFILE_PATH
    from sports_science.run_drift import drift_lines

    try:
        expected = json.loads(LOCKFILE_PATH.read_text(encoding="utf-8"))
        lines = drift_lines(snapshot_all_engines(), expected)
        payload["drift"] = {"status": "ok" if not lines else "drift", "drifted": lines}
    except OSError:
        payload["drift"] = {"status": "missing", "drifted": []}
    return payload


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a sports engine / dump the registry")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--list", action="store_true", help="list registered engine names")
    group.add_argument("--registry", action="store_true", help="dump engines + lockfile + drift")
    group.add_argument("--engine", type=str, help="run one registered engine")
    parser.add_argument("--input", type=str, default=None, help="JSON input for --engine")
    args = parser.parse_args(argv)

    if args.list:
        print(json.dumps({"ok": True, "engines": [e.name for e in ENGINES]}))
        return 0

    if args.registry:
        print(json.dumps(registry_payload(), default=str))
        return 0

    for def_ in ENGINES:
        if def_.name == args.engine:
            inp = json.loads(args.input) if args.input else def_.canonical_input
            print(json.dumps({
                "ok": True,
                "engine": def_.name,
                "version": def_.version,
                "output": def_.run(inp),
            }, default=str))
            return 0
    print(json.dumps({"ok": False, "error": f"unknown engine: {args.engine}"}))
    return 1


if __name__ == "__main__":
    sys.exit(_main())
