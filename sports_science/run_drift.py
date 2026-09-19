# sports_science/run_drift.py
"""Regenerate the engine lockfile and gate on drift.

  python sports_science/run_drift.py --write   # rewrite the golden lockfile
  python sports_science/run_drift.py --check   # exit 1 if any output drifted

Mirrors Overlay Oncology's CI ``drift-gate`` job: silent number changes are
impossible — any engine output that diverges beyond 1e-6 fails the gate.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Iterator

# Allow running as a script from the repo root (mirrors run_metrics.py).
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sports_science.engine_registry import LOCKFILE_PATH, snapshot_all_engines  # noqa: E402

TOLERANCE = 1e-6


def _flatten(prefix: str, obj: Any) -> Iterator[tuple[str, Any]]:
    """Yield (path, scalar) pairs for every scalar in a nested structure."""
    if isinstance(obj, dict):
        for k in sorted(obj):
            yield from _flatten(f"{prefix}.{k}", obj[k])
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            yield from _flatten(f"{prefix}[{i}]", v)
    else:
        yield prefix, obj


def drift_lines(
    current: list[dict[str, Any]],
    expected: list[dict[str, Any]],
) -> list[str]:
    """Return human-readable drift lines (empty when the snapshots match)."""
    cur = {e["engine"]: e for e in current}
    exp = {e["engine"]: e for e in expected}
    lines: list[str] = []
    for name in sorted(set(cur) | set(exp)):
        if name not in exp:
            lines.append(f"{name}:+ (new engine)")
            continue
        if name not in cur:
            lines.append(f"{name}:- (removed engine)")
            continue
        c, e = cur[name], exp[name]
        if c["version"] != e["version"]:
            lines.append(f"{name}.version: {e['version']} -> {c['version']}")
        if c["inputsHash"] != e["inputsHash"]:
            lines.append(f"{name}.inputsHash: drift")
        cf = dict(_flatten(name, c["output"]))
        ef = dict(_flatten(name, e["output"]))
        for k in sorted(set(cf) | set(ef)):
            if k not in ef:
                lines.append(f"{k}:+ (new field)")
                continue
            if k not in cf:
                lines.append(f"{k}:- (removed field)")
                continue
            cv, ev = cf[k], ef[k]
            if isinstance(cv, (int, float)) and isinstance(ev, (int, float)):
                if abs(float(cv) - float(ev)) > TOLERANCE:
                    lines.append(f"{k}: {ev} -> {cv}")
            elif cv != ev:
                lines.append(f"{k}: {ev!r} -> {cv!r}")
    return lines


def _write_lockfile() -> None:
    payload = json.dumps(snapshot_all_engines(), indent=2, sort_keys=True) + "\n"
    LOCKFILE_PATH.write_text(payload, encoding="utf-8")


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Regenerate/gate the sports engine lockfile")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--write", action="store_true", help="rewrite the golden lockfile")
    group.add_argument("--check", action="store_true", help="exit 1 on drift")
    args = parser.parse_args(argv)

    if args.write:
        _write_lockfile()
        print(f"wrote {LOCKFILE_PATH}")
        return 0

    expected = json.loads(LOCKFILE_PATH.read_text(encoding="utf-8"))
    lines = drift_lines(snapshot_all_engines(), expected)
    if lines:
        for line in lines:
            print("DRIFT:", line)
        return 1
    print(f"ok: {len(expected)} engines lockfile-pinned")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
