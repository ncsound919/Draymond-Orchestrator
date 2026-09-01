# sports_science/evidence.py
"""Evidence grading for sports metrics (E1-E4) — mirror of biotech evidence.py.

Wired into every metrics/coach output so each value carries a tier:
  E1 = measured (direct sensor/game data)
  E2 = derived (computed from measured inputs)
  E3 = rule-based (expert heuristic)
  E4 = simulated (modeled, unvalidated)
"""
from __future__ import annotations

EVIDENCE_TIERS = ("E1", "E2", "E3", "E4")


def grade_metric(metric: str, value: float | None = None, source: str = "derived") -> str:
    """Assign an evidence tier to a metric based on its source."""
    src = source.strip().lower()
    if src in ("measured", "sensor", "game_data", "raw"):
        return "E1"
    if src in ("derived", "computed", "model"):
        return "E2"
    if src in ("rule", "rule-based", "heuristic", "expert"):
        return "E3"
    if src in ("simulation", "sim", "simulated"):
        return "E4"
    # Fallback: known-derived metrics default to E2, else E3.
    return "E2"


def best_tier(metrics: dict) -> str:
    """Return the best (lowest-index) evidence tier among nested dict values.

    Best-wins aggregation — use this for PROMOTING tier summaries.
    Use worst_tier for runner envelope aggregation where any failure should downgrade.
    """
    tiers = [v["evidence_tier"] for v in metrics.values()
             if isinstance(v, dict) and v.get("evidence_tier") in EVIDENCE_TIERS]
    if not tiers:
        return "E4"
    for t in EVIDENCE_TIERS:
        if t in tiers:
            return t
    return "E4"


def worst_tier(graded: dict) -> str:
    """Return the worst (highest-index) evidence tier among nested dict values.

    Any-failure-downgrade aggregation — use this for runner envelope aggregation.
    Use best_tier for PROMOTING tier summaries where the best sub-tier should bubble up.
    """
    worst = None
    for v in graded.values():
        if isinstance(v, dict) and isinstance(v.get("evidence_tier"), str):
            t = v["evidence_tier"]
            if t in EVIDENCE_TIERS and (worst is None or EVIDENCE_TIERS.index(t) > EVIDENCE_TIERS.index(worst)):
                worst = t
    return worst or "E3"


def grade_profile(metrics: dict) -> dict:
    """Attach an evidence_tier summary to a metrics dict (best available tier).

    Deprecated: use best_tier() for the string return value, or worst_tier()
    for the downgrade-aggregation semantics.
    """
    return {"evidence_tier": best_tier(metrics)}
