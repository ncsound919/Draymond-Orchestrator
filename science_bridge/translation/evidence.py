# biotech_science/translation/evidence.py
"""Evidence grading for translation outputs (E1-E4)."""

from __future__ import annotations

# Evidence tier legend (matches Draymond / Overlay Science):
#   E1 = measured (direct data / validated computation)
#   E2 = literature-derived (published reference)
#   E3 = expert-estimated (rule-based mapping, expert judgment)
#   E4 = simulation-based (modeled, not yet validated)
EVIDENCE_TIERS = ("E1", "E2", "E3", "E4")


def grade_confidence(confidence: float) -> str:
    """Map a 0-1 translation confidence to an evidence tier."""
    if confidence >= 0.95:
        return "E1"
    if confidence >= 0.85:
        return "E2"
    if confidence >= 0.7:
        return "E3"
    return "E4"


def grade_translation(result: dict) -> dict:
    """Attach an evidence tier + justification to a translation result dict.

    The tier starts from the term-fidelity confidence; schema/mapping breadth
    can nudge it at most one tier up (never below E3 for rule-based maps).
    """
    confidence = float(result.get("confidence", 0.0))
    base = grade_confidence(confidence)
    domain = result.get("domain", "diagnosis")
    bidirectional = bool(result.get("bidirectional_possible", True))
    tiers = list(EVIDENCE_TIERS)
    idx = tiers.index(base)
    # Mature, bidirectional, high-confidence mappings get E1/E2.
    if bidirectional and confidence >= 0.9 and idx > 0:
        idx -= 1
    result["evidence_tier"] = tiers[idx]
    result["evidence_note"] = (
        "rule-based bidirectional map"
        if tiers[idx] in ("E3", "E4")
        else "validated term/metric mapping"
    )
    return result
