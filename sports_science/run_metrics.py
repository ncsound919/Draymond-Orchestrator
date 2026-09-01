# sports_science/run_metrics.py
"""CLI + importable runner: raw sports data JSON -> Codex + injury metrics (E2/E3)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# Allow running as a script from the repo root (DCA skill packs invoke
# `python sports_science/run_metrics.py ...`): make the repo root importable.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sports_science.codex_metrics import ter_score, four_factors, four_factors_from_performance, gravity_index, flow_index  # noqa: E402
from sports_science.evidence import grade_metric, worst_tier  # noqa: E402
from sports_science.injury_risk import fatigue_score, injury_risk_percent, recovery_priority  # noqa: E402
from sports_science.clinical import baseline_form, projected_availability, availability_tier  # noqa: E402


def compute_metrics_from_raw(raw: dict) -> dict[str, Any]:
    p = raw.get("performance", {})
    b = raw.get("biometrics", {})
    ter = ter_score(
        fg=p.get("fg", 0.0), tp=p.get("tp", 0.0), ast=p.get("ast", 0.0),
        oreb=p.get("oreb", 0.0), tov=p.get("tov", 0.0), pf=p.get("pf", 0.0),
    )
    # four factors: use explicit values when present, otherwise derive the
    # analogy factors from the real performance line (never flat defaults).
    if all(k in p for k in ("proliferation", "clearance", "resource", "metastasis")):
        factors = four_factors(
            proliferation=p.get("proliferation", 50.0),
            clearance=p.get("clearance", 50.0),
            resource=p.get("resource", 50.0),
            metastasis=p.get("metastasis", 50.0),
        )
    else:
        factors = four_factors_from_performance(p)
    gravity = gravity_index(
        defensive_attention=p.get("defensive_attention", 0.5),
        court_spacing=p.get("court_spacing", 0.5),
    )
    flow = flow_index(tempo=p.get("tempo", 0.5), possession_quality=p.get("possession_quality", 0.5))
    fatigue = fatigue_score(hrv=b.get("hrv", 65.0), load=b.get("load", 0.0))
    risk = injury_risk_percent(
        fatigue=fatigue,
        acute_chronic=b.get("acute_chronic", 1.0),
        sleep_hrs=b.get("sleep_hrs", 8.0),
    )
    risk_frac = risk / 100.0
    availability = projected_availability(fatigue, risk_frac, b.get("acute_chronic", 1.0))
    form = baseline_form(ter, gravity, flow)
    acute_chronic = b.get("acute_chronic", 1.0)
    graded = {
        "ter_evidence": {"evidence_tier": grade_metric("ter", ter, source="derived")},
        "fatigue_evidence": {"evidence_tier": grade_metric("fatigue", fatigue, source="derived")},
        "injury_risk_evidence": {"evidence_tier": grade_metric("injury_risk", risk, source="derived")},
        "baseline_form_evidence": {"evidence_tier": grade_metric("baseline_form", form, source="derived")},
        "availability_evidence": {"evidence_tier": grade_metric("availability", availability, source="derived")},
    }
    return {
        "sport": raw.get("sport", "unknown"),
        "ter": ter,
        "ter_evidence": grade_metric("ter", ter, source="derived"),
        "four_factors": factors,
        "gravity": gravity,
        "flow": flow,
        "fatigue": fatigue,
        "fatigue_evidence": grade_metric("fatigue", fatigue, source="derived"),
        "injury_risk": risk,
        "injury_risk_evidence": grade_metric("injury_risk", risk, source="derived"),
        "recovery_priority": recovery_priority(risk),
        # Clinical/performance-risk projection (scientific-rigor parity).
        "baseline_form": form,
        "baseline_form_evidence": grade_metric("baseline_form", form, source="derived"),
        "availability": availability,
        "availability_evidence": grade_metric("availability", availability, source="derived"),
        "availability_tier": availability_tier(risk_frac),
        "acute_chronic": acute_chronic,
        "evidence_tier": worst_tier(graded),
    }


def compute_metrics_from_json(input_path: Path) -> dict[str, Any]:
    raw = json.loads(Path(input_path).read_text(encoding="utf-8"))
    return compute_metrics_from_raw(raw)


def _main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("session_id")
    parser.add_argument("sport")
    parser.add_argument("dataset")
    args = parser.parse_args()
    input_path = Path(args.dataset)
    if not input_path.exists():
        print(json.dumps({"error": f"dataset not found: {args.dataset}"}))
        return 1
    result = compute_metrics_from_json(input_path)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(_main())
