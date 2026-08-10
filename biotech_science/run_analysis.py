# biotech_science/run_analysis.py
"""CLI runner: raw tumor/patient dataset JSON -> onco + clinical metrics.

Contract (from tests/biotech-python-executors.test.ts):
  python biotech_science/run_analysis.py session <dataset>
Input schema:
  {
    "cancer_type": str,
    "tumor":    { ki67, apoptotic_index, microvessel_density, ctc_count },
    "clinical": { tumor_size_cm, grade, age, receptor_status: {ER_positive, HER2_positive} },
    "treatment":{ ctdna, tumor_shrinkage_pct, time_point_months }
  }
Output: flat dict { ter, risk_tier, ... } with NO evidence_tier (stripped at the
TS boundary). Non-zero exit => {"error": ...} on stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from biotech_science.onco_metrics import (  # noqa: E402
    compute_onco_metrics,
    four_factors,
    ter_score,
)
from biotech_science.clinical import baseline_risk, post_treatment_risk, risk_tier  # noqa: E402
from biotech_science.archetypes import patient_archetype_profile  # noqa: E402


def _f(value, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def compute_analysis(dataset_path: Path) -> dict:
    if not Path(dataset_path).exists():
        raise ValueError(f"dataset not found: {dataset_path}")
    raw = json.loads(Path(dataset_path).read_text(encoding="utf-8-sig"))
    if not isinstance(raw, dict):
        raise ValueError("dataset root must be an object")

    tumor = raw.get("tumor", {})
    clinical = raw.get("clinical", {})
    treatment = raw.get("treatment", {})
    rs = clinical.get("receptor_status", {})

    ki67 = _f(tumor.get("ki67"), 50.0)
    apoptotic = _f(tumor.get("apoptotic_index"), 50.0)
    mvd = _f(tumor.get("microvessel_density"), 50.0)
    ctc = _f(tumor.get("ctc_count"), 0.0)

    # Map the original BB-Tech tumor schema onto the four-factors.
    proliferation = ki67
    clearance = apoptotic
    angiogenesis = mvd
    metastasis = _f(tumor.get("metastasis", _f(tumor.get("ctc_count"), 0.0)), 0.0)

    # TER from BB-Tech-style performance inputs (ki67 = productive division proxy,
    # ctDNA = resistance, shrinkage = clearance).
    fg = ki67 / 10.0
    tp = _f(tumor.get("three_pointer_analog", 0.0), 0.0)
    ast = _f(tumor.get("immune_coop", 0.0), 0.0)
    oreb = _f(tumor.get("resource_uptake", 0.0), 0.0)
    tov = _f(treatment.get("ctdna", 0.0), 0.0) * 10.0
    pf = _f(treatment.get("toxicity", 0.0), 0.0)

    ter = ter_score(fg, tp, ast, oreb, tov, pf, cell_cycle=24.0)
    factors = four_factors(proliferation, clearance, angiogenesis, metastasis)

    base_risk = baseline_risk(
        _f(clinical.get("tumor_size_cm"), 2.0),
        int(_f(clinical.get("grade"), 2)),
        _f(clinical.get("age"), 55.0),
        {"ER_positive": bool(rs.get("ER_positive", False)), "HER2_positive": bool(rs.get("HER2_positive", False))},
    )
    post_risk = post_treatment_risk(
        base_risk,
        ctdna=_f(treatment.get("ctdna"), 0.0),
        tumor_shrinkage=_f(treatment.get("tumor_shrinkage_pct"), 0.0),
        time_point=int(_f(treatment.get("time_point_months"), 0)),
    )

    arche = patient_archetype_profile(
        proliferation=proliferation,
        mutational_burden=_f(tumor.get("mutational_burden", 50.0), 50.0),
        immune_infiltrate=_f(tumor.get("immune_infiltrate", 50.0), 50.0),
        metastasis_score=metastasis,
    )

    return {
        "ter": ter,
        "four_factors": factors,
        "tumor_gravity": max(0.0, min(1.0, 0.6 * (ctc / 10.0) + 0.4 * (mvd / 100.0))),
        "tumor_flow": max(0.0, (_f(treatment.get("time_point_months"), 0) / 12.0) * (post_risk / (base_risk + 1e-9))),
        "baseline_risk": base_risk,
        "post_treatment_risk": post_risk,
        "risk_tier": risk_tier(post_risk),
        "recurrence_risk": post_risk,
        "composite_score": round((post_risk * 100 + ter * 10) / 2, 2),
        "archetype": arche["best_archetype"],
        "archetype_scores": arche["scores"],
        "drug_classes": arche["drug_classes"],
        "cancer_type": str(raw.get("cancer_type", "unknown")),
    }


def _main() -> int:
    parser = argparse.ArgumentParser(description="Biotech science analysis runner")
    parser.add_argument("session", help="session id (ignored, for contract compatibility)")
    parser.add_argument("dataset", help="path to tumor/patient JSON dataset")
    args = parser.parse_args()
    try:
        out = compute_analysis(Path(args.dataset))
        print(json.dumps(out, default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
