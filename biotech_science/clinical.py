# biotech_science/clinical.py
"""Clinical risk model — recurrence, survival, treatment response.

Mirror of sports_science.injury_risk.py + disease_research.clinical.py.

Delegates to bbtech 2 ContinuousRiskCalculator when importable, otherwise a
deterministic reference implementation. Survival uses lifelines/scikit-survival
when available, else a deterministic Kaplan-Meier fallback. Same input => same
output within each code path.
"""
from __future__ import annotations

import math
import os
import sys

_BBTECH_AVAILABLE = False
try:
    _BBTECH_ROOT = os.environ.get(
        "BIOTECH_BBTECH_PATH",
        r"C:\Users\User\Downloads\Uplift\02_Pillars\Overlay Science\Shared\bb_tech_core",
    )
    if _BBTECH_ROOT not in sys.path:
        sys.path.insert(0, _BBTECH_ROOT)
    try:
        from oncology_platform.clinical.risk_calculator import ContinuousRiskCalculator  # type: ignore
        _BBTECH_AVAILABLE = True
    except ImportError:
        from bb_tech_core.oncology_platform.clinical.risk_calculator import (  # type: ignore
            ContinuousRiskCalculator,
        )
        _BBTECH_AVAILABLE = True
except Exception:  # noqa: BLE001
    _BBTECH_AVAILABLE = False


def _ref_baseline_risk(
    tumor_size: float,
    grade: int,
    age: float,
    er_positive: bool,
    her2_positive: bool,
) -> float:
    """Reference Cox-style 5-year recurrence probability."""
    risk_score = 0.0
    if tumor_size > 0:
        risk_score += math.log(tumor_size) * 0.3
    risk_score += grade * 0.2
    risk_score += (age / 100.0) * 0.15
    if er_positive:
        risk_score -= 0.4
    if her2_positive:
        risk_score += 0.3
    return 1.0 - math.exp(-math.exp(risk_score))


def baseline_risk(
    tumor_size: float,
    grade: int,
    age: float,
    receptor_status: dict[str, bool] | None = None,
) -> float:
    """5-year recurrence probability at diagnosis (0-1)."""
    rs = receptor_status or {}
    if _BBTECH_AVAILABLE:
        try:
            calc = ContinuousRiskCalculator()
            return float(
                calc.calculate_baseline_risk(
                    tumor_size=tumor_size,
                    grade=grade,
                    age=age,
                    receptor_status=rs,
                )
            )
        except Exception:  # noqa: BLE001
            pass
    return _ref_baseline_risk(
        tumor_size,
        grade,
        age,
        er_positive=bool(rs.get("ER_positive", False)),
        her2_positive=bool(rs.get("HER2_positive", False)),
    )


def post_treatment_risk(
    baseline: float,
    ctdna: float = 0.0,
    tumor_shrinkage: float = 0.0,
    time_point: int = 0,
) -> float:
    """Bayesian-updated recurrence probability after treatment (0-1).

    Higher ctDNA and lower shrinkage raise risk; longer time-on-treatment with
    shrinkage lowers it. Clamped to [0,1].
    """
    if not _BBTECH_AVAILABLE:
        # Deterministic Bayesian-style update.
        likelihood = 1.0 + (ctdna * 0.8) - (tumor_shrinkage / 100.0 * 0.6)
        decay = 1.0 / (1.0 + 0.05 * max(0, time_point))
        return max(0.0, min(1.0, baseline * likelihood * decay))
    try:
        from oncology_platform.clinical.risk_calculator import ContinuousRiskCalculator  # type: ignore
        calc = ContinuousRiskCalculator()
        return float(
            calc.calculate_post_treatment_risk(
                baseline_risk=baseline,
                ctdna=ctdna,
                tumor_shrinkage=tumor_shrinkage,
                time_point=time_point,
            )
        )
    except Exception:  # noqa: BLE001
        likelihood = 1.0 + (ctdna * 0.8) - (tumor_shrinkage / 100.0 * 0.6)
        decay = 1.0 / (1.0 + 0.05 * max(0, time_point))
        return max(0.0, min(1.0, baseline * likelihood * decay))


def _kaplan_meier(times: list[float], events: list[int]) -> list[dict]:
    """Deterministic Kaplan-Meier estimator (no external deps).

    Input: parallel arrays of observed times and event flags (1=event, 0=censored).
    Output: [{time, n_at_risk, n_events, survival}]
    """
    pairs = sorted(zip(times, events), key=lambda p: p[0])
    curve: list[dict] = []
    survival = 1.0
    n_at_risk = len(pairs)
    i = 0
    while i < len(pairs):
        t = pairs[i][0]
        d = 0
        c = 0
        while i < len(pairs) and pairs[i][0] == t:
            if pairs[i][1]:
                d += 1
            else:
                c += 1
            i += 1
        if n_at_risk > 0 and d > 0:
            survival *= (1.0 - d / n_at_risk)
        curve.append(
            {
                "time": t,
                "n_at_risk": n_at_risk,
                "n_events": d,
                "survival": round(survival, 6),
            }
        )
        n_at_risk -= d + c
    return curve


def survival_curve(times: list[float], events: list[int]) -> list[dict]:
    """Kaplan-Meier survival curve. Uses lifelines when installed; deterministic
    fallback otherwise (same survival values, fewer diagnostics)."""
    try:
        from lifelines import KaplanMeierFitter  # type: ignore
        kmf = KaplanMeierFitter()
        kmf.fit(times, event_observed=events)
        out: list[dict] = []
        for t, s in zip(kmf.survival_function_.index, kmf.survival_function_["KM_estimate"]):
            out.append({"time": float(t), "survival": round(float(s), 6)})
        return out
    except Exception:  # noqa: BLE001
        return _kaplan_meier(list(map(float, times)), [int(e) for e in events])


def risk_tier(risk: float) -> str:
    """Map a 0-1 recurrence probability to a clinical risk tier."""
    if risk < 0.2:
        return "low"
    if risk < 0.5:
        return "intermediate"
    return "high"


def treatment_response(metrics: dict) -> dict:
    """Build the treatment-plan payload consumed by run_treatment.py.

    Mirrors disease_research.skill_bridge._treatment_result contract.
    """
    risk = float(metrics.get("risk", metrics.get("post_treatment_risk", 0.0)))
    ter = float(metrics.get("ter", 0.0))
    tier = risk_tier(risk)
    if tier == "low":
        recommendation = "maintain surveillance; consider de-escalation"
    elif tier == "intermediate":
        recommendation = "consolidate therapy; monitor ctDNA"
    else:
        recommendation = "intensify therapy; consider combination/novel agent"
    return {
        "status": "ok",
        "risk_tier": tier,
        "recurrence_risk": risk,
        "ter": ter,
        "recommendation": recommendation,
        "evidence_tier": "E1",
    }
