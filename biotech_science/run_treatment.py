# biotech_science/run_treatment.py
"""CLI runner: upstream metrics JSON -> treatment plan.

Contract (from tests/biotech-python-executors.test.ts):
  python biotech_science/run_treatment.py session <metrics.json path>
Input: metrics dict (may include risk_tier, malignancy_class, ter, composite_score).
Output: { recommendation, ... } with NO inner evidence_tier (stripped at TS
boundary). Non-zero exit => {"status":"error","message":...}.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from biotech_science.clinical import risk_tier  # noqa: E402


def compute_treatment(metrics_path: Path) -> dict:
    raw = json.loads(Path(metrics_path).read_text(encoding="utf-8-sig"))
    if isinstance(raw, dict) and isinstance(raw.get("data"), list) and raw["data"]:
        raw = raw["data"][0]
    metrics = dict(raw or {})

    ter = float(metrics.get("ter", 0.0) or 0.0)
    composite = float(metrics.get("composite_score", 0.0) or 0.0)
    risk = float(metrics.get("post_treatment_risk", metrics.get("recurrence_risk", 0.0)) or 0.0)
    tier = str(metrics.get("risk_tier", risk_tier(risk))).lower()

    if tier in ("high", "elite_malignant", "elite"):
        recommendation = "intensify therapy; consider combination or novel agent"
        action = "escalate"
    elif tier == "intermediate":
        recommendation = "consolidate therapy; monitor ctDNA"
        action = "maintain"
    else:
        recommendation = "maintain surveillance; consider de-escalation"
        action = "de-escalate"

    return {
        "status": "ok",
        "recommendation": recommendation,
        "action": action,
        "risk_tier": tier,
        "ter": ter,
        "composite_score": composite,
        "treatment_plan": {
            "lines": 1 if tier in ("low", "intermediate") else 2,
            "interval_months": 6 if tier == "low" else 3,
        },
    }


def _main() -> int:
    parser = argparse.ArgumentParser(description="Biotech treatment plan runner")
    parser.add_argument("session", help="session id (ignored, for contract compatibility)")
    parser.add_argument("metrics", help="path to metrics JSON")
    args = parser.parse_args()
    try:
        out = compute_treatment(Path(args.metrics))
        print(json.dumps(out, default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"status": "error", "message": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
