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
from sports_science.run_metrics import compute_metrics_from_raw  # noqa: E402
from sports_science.validation_engine import verify_determinism  # noqa: E402


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


def _derived_profile(profile: dict, domain: str) -> dict:
    """Derive the standard metric set (ter, four_factors, gravity, flow,
    injury_risk) from a RAW profile and return it in the shape synthesize()
    consumes. The profile shapes diverge: NBA profiles carry raw `performance`
    + `biometrics`, while synthesize() expects the computed four-factor/metric
    vocabulary. Without this bridge, insights silently degrade to empty
    ("no profile metrics detected") and never read the athlete's real numbers.

    Profiles that are ALREADY in the derived metric shape (four_factors/ter/
    gravity/flow/injury_risk/archetype) pass through unchanged.
    """
    if "performance" not in profile and "biometrics" not in profile:
        return dict(profile)
    derived = dict(compute_metrics_from_raw(profile))
    if domain == "sports":
        # synthesize()'s sports branch reads injury_risk as a 0-1 fraction, but
        # compute_metrics_from_raw returns a 0-100 percent — normalize here.
        risk = derived.get("injury_risk")
        if isinstance(risk, (int, float)):
            derived["injury_risk"] = risk / 100.0
    return derived


def run_insights(profile_path: str | Path, from_domain: str | None = None) -> dict:
    """Run the full insight pipeline on a profile JSON file.

    Args:
        profile_path: path to the profile JSON file
        from_domain: optional domain override ("sports" or "biotech");
            inferred from the profile shape if not provided

    Returns a dict with keys (same shape as CLI output), plus:
      - reproducibility_debt: bool — True if verify_determinism failed on
        compute_metrics_from_raw, False if it passed
    """
    path = Path(profile_path)
    if not path.exists():
        raise ValueError(f"profile not found: {profile_path}")
    profile = json.loads(path.read_text(encoding="utf-8-sig"))
    domain = from_domain or "sports"
    derived = _derived_profile(profile, domain)

    det_report = verify_determinism(
        lambda _: compute_metrics_from_raw(profile),
        seeds=[1, 2],
    )
    reproducibility_debt = not det_report["ok"]

    report = synthesize(derived, from_domain=domain)
    result = _asdict(report)
    result["reproducibility_debt"] = reproducibility_debt
    return result


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
        from_domain = args.domain or ("biotech" if args.from_biotech else None)
        result = run_insights(args.profile, from_domain=from_domain)
        print(json.dumps(result, default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
