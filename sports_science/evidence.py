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


def grade_profile(metrics: dict) -> dict:
    """Attach an evidence_tier summary to a metrics dict (best available tier)."""
    if isinstance(metrics, dict) and "evidence_tier" in metrics:
        return metrics
    tiers = []
    for v in metrics.values():
        if isinstance(v, dict) and "evidence_tier" in v:
            tiers.append(v["evidence_tier"])
    best = "E1" if "E1" in tiers else "E2" if "E2" in tiers else "E3" if "E3" in tiers else "E4"
    return {"evidence_tier": best}
