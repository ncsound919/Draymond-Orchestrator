# sports_science/run_coach.py
"""Coach runner: metrics -> deterministic, evidence-tiered game plan."""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from sports_science.clinical import availability_tier, gameplan_response  # noqa: E402

RECOVERY_PLAY: dict[str, str] = {
    "critical": "pull from rotation; load management 48h; physio protocol",
    "elevated": "cap minutes at 24; prioritize rest; monitor next session",
    "normal": "standard rotation; progressive overload",
}


def build_gameplan(sport: str, metrics_file: Any) -> dict[str, Any]:
    """Build a deterministic, evidence-tiered game plan from metrics.

    `metrics_file` may be: None (error), a path to a metrics JSON, or an
    already-loaded dict (so the LabDirector bridge can pass upstream metrics
    data directly without a round-trip through disk).
    """
    if not metrics_file:
        return {"status": "error", "message": "metrics required"}
    if isinstance(metrics_file, dict):
        m = metrics_file
    else:
        try:
            with open(metrics_file, encoding="utf-8") as f:
                m = json.load(f)
        except (OSError, ValueError):
            return {"status": "error", "message": f"unreadable metrics file: {metrics_file}"}
    plan = gameplan_response(m)
    risk_frac = float(m.get("injury_risk", 0.0)) / 100.0 if float(m.get("injury_risk", 0.0)) > 1.0 else float(m.get("injury_risk", 0.0))
    tier = availability_tier(risk_frac)
    plan["sport"] = sport
    plan["status"] = "ok"
    plan["ter"] = m.get("ter")
    plan["recovery"] = RECOVERY_PLAY.get(m.get("recovery_priority", tier), RECOVERY_PLAY[tier])
    plan["focus"] = "increase spacing pressure" if m.get("gravity", 0) < 0.5 else "maintain spacing"
    return plan


def _main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("session_id")
    parser.add_argument("sport")
    parser.add_argument("metrics_file")
    args = parser.parse_args()
    plan = build_gameplan(args.sport, args.metrics_file)
    print(json.dumps(plan))
    return 0 if plan["status"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(_main())
