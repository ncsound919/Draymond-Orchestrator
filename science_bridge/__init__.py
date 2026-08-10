# science_bridge/__init__.py
"""Shared bidirectional insight core for the sports and biotech science engines.

Single source of truth for sports <-> biotech translation (terms, archetypes,
metric conversions, evidence grading) plus whole-profile insight synthesis.
Both `sports_science` and `biotech_science` import this package; it imports
neither platform (fully self-contained).
"""
__version__ = "1.0.0"

from . import insights, translation  # noqa: F401
from .insights import InsightReport, TranslatedMetric, detect_domain, synthesize  # noqa: F401
from .translation.engine import (  # noqa: F401
    BiotechTranslationEngine,
    TranslationEngine,
    TranslationResult,
)

__all__ = [
    "TranslationEngine",
    "BiotechTranslationEngine",
    "TranslationResult",
    "InsightReport",
    "TranslatedMetric",
    "detect_domain",
    "synthesize",
    "insights",
    "translation",
]
