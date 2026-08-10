# sports_science/run_translate.py
"""CLI runner: bidirectional sports <-> biotech translation (shared core).

Contract (mirrors biotech run_translate.py):
  python sports_science/run_translate.py session <term> [--value N] [--from_biotech]
Output: machine-readable JSON. Non-zero exit => {"error": ...} on stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from science_bridge.translation.engine import BiotechTranslationEngine  # noqa: E402


def translate_term(term: str, value: float | None, from_sports: bool) -> dict:
    engine = BiotechTranslationEngine()
    if value is not None:
        return engine.translate_metric(term, value, from_sports=from_sports)
    return engine.translate(term, value=value, from_sports=from_sports)


def _main() -> int:
    parser = argparse.ArgumentParser(description="Bidirectional sports <-> biotech translation")
    parser.add_argument("session", help="session id (ignored, for contract compatibility)")
    parser.add_argument("term", help="term to translate")
    parser.add_argument("--value", type=float, default=None, help="numeric value to carry through")
    parser.add_argument("--from_biotech", action="store_true", help="translate biotech -> sports (default sports -> biotech)")
    args = parser.parse_args()
    try:
        out = translate_term(args.term, args.value, from_sports=not args.from_biotech)
        print(json.dumps(out, default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
