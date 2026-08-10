# sports_science/clinical.py
"""Performance-risk model — baseline form, projected availability, fatigue curve.

Mirror of biotech_science.clinical.py + disease_research.clinical.py, on the
sports side. Turns measured performance/biometric inputs into an availability
projection and a deterministic fatigue trajectory, evidence-tiered E1-E4.

Same input => same output (deterministic reference implementation; no external
clinical libs required).
"""
from __future__ import annotations


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def baseline_form(ter: float, gravity: float, flow: float) -> float:
    """0-1 baseline form score from efficiency + gravity + flow.

    TER normalized by a reference maximum (2.0 -> 1.0); gravity and flow
    contribute as multipliers. Clamped to [0,1].
    """
    ter_norm = _clamp01(float(ter) / 2.0)
    gravity_c = _clamp01(float(gravity))
    flow_c = _clamp01(float(flow))
    return round(_clamp01(0.6 * ter_norm + 0.25 * gravity_c + 0.15 * flow_c), 4)


def projected_availability(fatigue: float, injury_risk: float, acute_chronic: float) -> float:
    """Projected share of full load the athlete can safely take (0-1).

    Fatigue, injury-risk, and acute-chronic-ratio deviation reduce availability.
    """
    fatigue_pen = _clamp01(float(fatigue) / 100.0 if float(fatigue) > 1.0 else float(fatigue))
    risk_pen = _clamp01(float(injury_risk) / 100.0 if float(injury_risk) > 1.0 else float(injury_risk))
    ac_dev = _clamp01(abs(float(acute_chronic) - 1.0) * 0.5)
    availability = 1.0 - (0.4 * fatigue_pen + 0.4 * risk_pen + 0.2 * ac_dev)
    return round(_clamp01(availability), 4)


def fatigue_curve(load_history: list[float]) -> list[dict]:
    """Deterministic load-decay fatigue trajectory.

    Input: chronological load values (e.g. 4-week rolling loads). Output:
    [{day, load, decayed_load, fatigue_index}] where fatigue_index is the
    exponentially-smoothed load relative to the roster baseline.
    """
    curve: list[dict] = []
    if not load_history:
        return curve
    baseline = max(1.0, sum(float(x) for x in load_history) / len(load_history))
    smoothed = 0.0
    alpha = 0.3
    for i, load in enumerate(load_history):
        load = float(load)
        smoothed = alpha * load + (1 - alpha) * smoothed if i > 0 else load
        fatigue_index = _clamp01(smoothed / baseline)
        curve.append(
            {
                "day": i,
                "load": round(load, 4),
                "decayed_load": round(smoothed, 4),
                "fatigue_index": round(fatigue_index, 4),
            }
        )
    return curve


def availability_tier(risk: float) -> str:
    """Map a 0-1 risk value to a load tier.

    Critical >= 0.8, elevated >= 0.6, else normal.
    """
    risk = float(risk)
    if risk >= 0.8:
        return "critical"
    if risk >= 0.6:
        return "elevated"
    return "normal"


def gameplan_response(metrics: dict) -> dict:
    """Build the coach-payload consumed by run_coach.py / skill_bridge.

    Mirrors biotech clinical.treatment_response. `minutes` is the capped load
    allocation; `availability` may be passed in or projected from fatigue/risk.
    """
    ter = float(metrics.get("ter", 0.0))
    gravity = float(metrics.get("gravity", 0.5))
    flow = float(metrics.get("flow", 0.5))
    fatigue = float(metrics.get("fatigue", 0.0))
    injury_risk = float(metrics.get("injury_risk", 0.0))
    acute_chronic = float(metrics.get("acute_chronic", 1.0))

    risk_frac = injury_risk / 100.0 if injury_risk > 1.0 else injury_risk
    availability = float(metrics.get("availability", projected_availability(fatigue, risk_frac, acute_chronic)))
    form = float(metrics.get("form", baseline_form(ter, gravity, flow)))
    tier = availability_tier(risk_frac)

    if tier == "critical":
        recommendation = "pull from rotation; load management 48h; physio protocol"
        minutes = 0
    elif tier == "elevated":
        recommendation = "cap minutes at 24; prioritize rest; monitor next session"
        minutes = 24
    else:
        recommendation = "standard rotation; progressive overload"
        minutes = 36

    return {
        "status": "ok",
        "ter": ter,
        "baseline_form": form,
        "availability": availability,
        "availability_tier": tier,
        "minutes": minutes,
        "recommendation": recommendation,
        "evidence_tier": "E1",
    }
