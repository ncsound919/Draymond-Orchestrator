# science_bridge/translation/__init__.py
"""Bidirectional sports <-> biotech translation core (shared seam)."""

from .engine import BiotechTranslationEngine, TranslationEngine, TranslationResult  # noqa: F401
from .evidence import EVIDENCE_TIERS, grade_confidence, grade_translation  # noqa: F401
from .mappings import (  # noqa: F401
    ARCHETYPE_ALIASES,
    ARCHETYPE_FORWARD,
    ARCHETYPE_SPINE,
    FORWARD_TERMS,
    FORMULA_ALIASES,
    FORMULA_MAPPINGS,
    Mapping,
    METRIC_CONVERSIONS,
    REVERSE_TERMS,
    TranslationDirection,
    TranslatedRecord,
    VERIFIABLE_FORMULAS,
)

__all__ = [
    "TranslationEngine",
    "BiotechTranslationEngine",
    "TranslationResult",
    "TranslationDirection",
    "TranslatedRecord",
    "Mapping",
    "FORWARD_TERMS",
    "REVERSE_TERMS",
    "FORMULA_MAPPINGS",
    "FORMULA_ALIASES",
    "VERIFIABLE_FORMULAS",
    "ARCHETYPE_FORWARD",
    "ARCHETYPE_ALIASES",
    "ARCHETYPE_SPINE",
    "METRIC_CONVERSIONS",
    "EVIDENCE_TIERS",
    "grade_confidence",
    "grade_translation",
]
