# science_bridge/run_layers.py
"""CLI runner: layered translation (terminology / strategy / procedure).

Contract:
  python science_bridge/run_layers.py session <term> [--layer all|terminology|strategy|procedure]
  python science_bridge/run_layers.py session <term1,term2> --layer all
Prints machine-readable JSON. Non-zero exit => {"error": ...}.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from science_bridge.translation.engine import TranslationEngine  # noqa: E402


def _main() -> int:
    parser = argparse.ArgumentParser(description="Layered sports <-> biotech translation")
    parser.add_argument("session", help="session id (ignored, for contract compatibility)")
    parser.add_argument("terms", help="term or comma-separated terms to translate")
    parser.add_argument("--layer", default="all", choices=["all", "terminology", "strategy", "procedure"])
    parser.add_argument("--from_biotech", action="store_true", help="translate biotech -> sports")
    args = parser.parse_args()
    try:
        from_sports = not args.from_biotech
        engine = TranslationEngine()
        terms = [t.strip() for t in args.terms.split(",") if t.strip()]
        out = []
        for term in terms:
            if args.layer == "terminology":
                out.append(engine.translate(term, from_sports=from_sports))
            elif args.layer == "strategy":
                from science_bridge.strategy import translate_strategy
                out.append(translate_strategy(term, from_sports=from_sports))
            elif args.layer == "procedure":
                from science_bridge.procedure import translate_procedure
                out.append(translate_procedure(term, from_sports=from_sports))
            else:
                out.append(engine.translate_layer(term, from_sports=from_sports))
        print(json.dumps(out, default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
