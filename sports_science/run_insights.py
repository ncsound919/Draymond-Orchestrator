# sports_science/run_insights.py
"""CLI runner: whole-profile bidirectional insight synthesis.

Contract (mirrors biotech run_translate.py style):
  python sports_science/run_insights.py session <profile.json> [--domain sports|biotech]
Output: machine-readable JSON InsightReport. Non-zero exit => {"error": ...}.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from science_bridge.insights import synthesize  # noqa: E402


def _asdict(report) -> dict:
    return {
        "from_domain": report.from_domain,
        "to_domain": report.to_domain,
        "source_read": report.source_read,
        "target_read": report.target_read,
        "translated_metrics": [
            {
                "metric": m.metric,
                "source_value": m.source_value,
                "target_metric": m.target_metric,
                "target_value": m.target_value,
                "confidence": m.confidence,
                "note": m.note,
            }
            for m in report.translated_metrics
        ],
        "archetype": report.archetype,
        "archetype_translation": report.archetype_translation,
        "confidence": report.confidence,
        "evidence_tier": report.evidence_tier,
    }


def _main() -> int:
    parser = argparse.ArgumentParser(description="Whole-profile bidirectional insight synthesis")
    parser.add_argument("session", help="session id (ignored, for contract compatibility)")
    parser.add_argument("profile", help="path to a metrics/profile JSON")
    parser.add_argument("--domain", default=None, choices=["sports", "biotech"],
                        help="domain of the profile (default: auto-detect)")
    parser.add_argument("--from_biotech", action="store_true",
                        help="treat the profile as a biotech profile (default: sports)")
    args = parser.parse_args()
    try:
        profile_path = Path(args.profile)
        if not profile_path.exists():
            raise ValueError(f"profile not found: {args.profile}")
        profile = json.loads(profile_path.read_text(encoding="utf-8-sig"))
        domain = args.domain or ("biotech" if args.from_biotech else None)
        report = synthesize(profile, from_domain=domain)
        print(json.dumps(_asdict(report), default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
