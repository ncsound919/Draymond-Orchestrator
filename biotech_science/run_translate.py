# biotech_science/run_translate.py
"""CLI runner: bidirectional sports <-> biotech translation.

Contract (from tests/biotech-python-executors.test.ts):
  python biotech_science/run_translate.py session <term> [--value N] [--from_biotech]
Output: { source_term, target_term, target_value?, ... } — NO inner
evidence_tier (stripped at the TS boundary; the executor sets E3).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from biotech_science.translation.engine import BiotechTranslationEngine  # noqa: E402


def translate_term(term: str, value: float | None, from_sports: bool) -> dict:
    engine = BiotechTranslationEngine()
    res = engine.translate(term, value=value, from_sports=from_sports)
    # Flatten to the executor contract: preserve value as target_value, drop
    # evidence_tier (executor supplies E3), keep confidence + description.
    out = {
        "source_term": res["source_term"],
        "target_term": res["target_term"],
        "direction": res["direction"],
        "confidence": res["confidence"],
        "description": res["description"],
        "domain": res["domain"],
    }
    if value is not None:
        out["target_value"] = value
    if "archetype" in res:
        out["archetype"] = res["archetype"]
    if "metric_conversion" in res:
        out["metric_conversion"] = res["metric_conversion"]
    return out


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
