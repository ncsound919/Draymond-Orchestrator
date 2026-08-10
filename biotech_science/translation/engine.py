# biotech_science/translation/engine.py
"""Full bidirectional sports <-> biotech translation engine.

Class-leading translation core: term mapping, archetype mapping, metric
conversion, confidence scoring, and E1-E4 evidence grading — in both
directions. Extends bb_tech_core.translation_engine with archetype translation
and confidence/evidence support.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .evidence import grade_translation
from .mappings import (
    ARCHETYPE_ALIASES,
    ARCHETYPE_FORWARD,
    FORWARD_TERMS,
    METRIC_CONVERSIONS,
    REVERSE_TERMS,
    TranslationDirection,
)


@dataclass
class TranslationResult:
    source_term: str
    target_term: str
    direction: TranslationDirection
    confidence: float
    description: str
    domain: str
    bidirectional_possible: bool
    evidence_tier: str = "E3"
    extra: dict = field(default_factory=dict)


class BiotechTranslationEngine:
    """Bidirectional translation between basketball analytics and biotech."""

    def __init__(self) -> None:
        self.history: list[TranslationResult] = []

    # ── term translation ────────────────────────────────────────────────────
    def translate_term(self, term: str, value: float | None = None, from_sports: bool = True) -> TranslationResult:
        term_l = term.strip().lower()
        table = FORWARD_TERMS if from_sports else REVERSE_TERMS
        direction = TranslationDirection.FORWARD if from_sports else TranslationDirection.REVERSE

        # Archetype aliases (Jordan -> cancer_dominant, etc.)
        if term_l in ARCHETYPE_ALIASES:
            archetype = ARCHETYPE_ALIASES[term_l]
            return self._translate_archetype(term_l, archetype, direction)

        mapping = table.get(term_l)
        if mapping is None:
            return TranslationResult(
                source_term=term,
                target_term=term_l,
                direction=direction,
                confidence=0.5,
                description=f"no direct mapping; kept literal ('{term_l}')",
                domain="unknown",
                bidirectional_possible=False,
                evidence_tier="E4",
            )

        target = mapping["biotech"] if from_sports else mapping["sports"]
        result = TranslationResult(
            source_term=term,
            target_term=target,
            direction=direction,
            confidence=mapping["confidence"],
            description=mapping["description"],
            domain=mapping["domain"],
            bidirectional_possible=target in (REVERSE_TERMS if from_sports else FORWARD_TERMS),
        )
        if value is not None:
            result.extra["value"] = value
        grade_translation(result.__dict__)
        return result

    # ── archetype translation ───────────────────────────────────────────────
    def _translate_archetype(self, term: str, archetype: str, direction: TranslationDirection) -> TranslationResult:
        mapping = ARCHETYPE_FORWARD.get(archetype, {})
        if not mapping:
            return TranslationResult(
                source_term=term, target_term=term, direction=direction,
                confidence=0.5, description="unknown archetype", domain="diagnosis",
                bidirectional_possible=False, evidence_tier="E4",
            )
        target = mapping["disease"]
        result = TranslationResult(
            source_term=term,
            target_term=target,
            direction=direction,
            confidence=mapping["confidence"],
            description=mapping["description"],
            domain="diagnosis",
            bidirectional_possible=True,
            extra={"archetype": archetype},
        )
        grade_translation(result.__dict__)
        return result

    # ── metric conversion ───────────────────────────────────────────────────
    def convert_metric(self, metric: str) -> dict | None:
        for conv in METRIC_CONVERSIONS:
            if conv["basketball_metric"] == metric or conv["biotech_metric"] == metric:
                return dict(conv)
        return None

    # ── full translate API ──────────────────────────────────────────────────
    def translate(self, term: str, value: float | None = None, from_sports: bool = True) -> dict:
        """Public API — used by run_translate.py. Returns a plain dict (JSON-safe)."""
        result = self.translate_term(term, value, from_sports)
        out = {
            "source_term": result.source_term,
            "target_term": result.target_term,
            "direction": result.direction.value,
            "confidence": result.confidence,
            "description": result.description,
            "domain": result.domain,
            "bidirectional_possible": result.bidirectional_possible,
            "evidence_tier": result.evidence_tier,
        }
        if result.extra:
            out.update(result.extra)
        # Include available metric conversion for known metric terms.
        conv = self.convert_metric(term.lower())
        if conv:
            out["metric_conversion"] = conv
        self.history.append(result)
        return out

    def translate_all(self, terms: list[str], from_sports: bool = True) -> list[dict]:
        return [self.translate(t, from_sports=from_sports) for t in terms]
