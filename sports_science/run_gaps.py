# sports_science/run_gaps.py
"""CLI runner: deterministic research-gap scan over report JSON.

Contract (mirrors run_derive.py style):
  python sports_science/run_gaps.py <report_json_path|->
A path of '-' reads the report from stdin. The report may be a single
InsightReport/validation dict or a list of them.
Output: machine-readable JSON {ok, gaps, summary:{counts by kind}, scanned_at}.
Non-zero exit => {"ok": false, "error": ...} on stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sports_science.gap_detection import detect_gaps, summarize_gaps  # noqa: E402


def scan_report(report) -> dict:
    return summarize_gaps(detect_gaps(report))


def _main() -> int:
    parser = argparse.ArgumentParser(description="Research-gap detection over report JSON")
    parser.add_argument("report", help="path to a report JSON file, or '-' for stdin")
    args = parser.parse_args()
    try:
        if args.report == "-":
            raw = sys.stdin.read()
        else:
            input_path = Path(args.report)
            if not input_path.exists():
                raise ValueError(f"report not found: {args.report}")
            raw = input_path.read_text(encoding="utf-8-sig")
        report = json.loads(raw) if raw.strip() else {}
        print(json.dumps(scan_report(report), default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
