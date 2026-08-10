# science_bridge/translation/engine.py
"""Shared bidirectional sports <-> biotech translation engine.

Single source of truth for the translation seam. Both the sports and biotech
platforms import this core; each platform's `translation/__init__.py` re-exports
it with its own public class name for backward compatibility.

Provides: term mapping, archetype mapping, metric conversion, confidence
scoring, and E1-E4 evidence grading — in both directions.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .evidence import grade_translation
from .mappings import (
    ARCHETYPE_ALIASES,
    ARCHETYPE_FORWARD,
    ARCHETYPE_SPINE,
    FORWARD_TERMS,
    FORMULA_ALIASES,
    Mapping,
    METRIC_CONVERSIONS,
    REVERSE_TERMS,
    VERIFIABLE_FORMULAS,
    TranslationDirection,
    TranslatedRecord,
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


class TranslationEngine:
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
        """Public API — JSON-safe plain dict. Used by run_translate.py CLIs."""
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

    # ── authoritative lexicon (formula-backed, from disease_research) ───────
    def lookup_mapping(self, term: str) -> Mapping | None:
        """Resolve a term/alias to its authoritative formula-backed Mapping."""
        key = str(term).strip().lower()
        if key in FORMULA_ALIASES:
            return FORMULA_ALIASES[key]
        # Fall back to normalized full names (first word).
        for _m in FORMULA_ALIASES.values():
            if _m.sports_term.strip().lower().startswith(key) or _m.biotech_term.strip().lower().startswith(key):
                return _m
        return None

    def formula_status(self, term: str) -> dict:
        """Report whether a term has a provable formula identity (E1) or not (E3)."""
        key = str(term).strip().lower()
        for mapping_key, (sport_term, bio_term) in VERIFIABLE_FORMULAS.items():
            if key in (mapping_key.lower(), sport_term.lower(), bio_term.lower()):
                return {
                    "has_formula": True,
                    "verified": False,  # semantic analogies are not algebraic identities
                    "evidence_tier": "E3",
                    "trust_score": 0,
                    "formula": VERIFIABLE_FORMULAS[mapping_key],
                }
        return {"has_formula": False, "verified": False, "evidence_tier": "E3"}

    def translate_metric(self, name: str, value: float, from_sports: bool = True) -> dict:
        """Translate a numeric metric preserving magnitude (authoritative lexicon).

        The mapping heuristic is E3; the value is passed through untouched.
        If the term has a provable formula identity, evidence_tier upgrades to E1.
        """
        m = self.lookup_mapping(name)
        formula = self.formula_status(name)
        if m is None:
            return TranslatedRecord(
                source_domain="sports" if from_sports else "biotech",
                target_domain="biotech" if from_sports else "sports",
                source_term=name, source_value=value, target_term="No direct equivalent",
                target_value=None, interpretation="No known mapping; value not transformed.",
                confidence=0.0, evidence_tier="E3",
            ).to_dict()
        if from_sports:
            return TranslatedRecord(
                source_domain="sports", target_domain="biotech",
                source_term=m.sports_term, target_term=m.biotech_term,
                source_value=value, target_value=value,
                interpretation=m.description, confidence=m.significance,
                evidence_tier="E1" if formula["verified"] else "E3",
                formula_verified=formula["verified"],
                trust_score=formula.get("trust_score", 0),
            ).to_dict()
        return TranslatedRecord(
            source_domain="biotech", target_domain="sports",
            source_term=m.biotech_term, target_term=m.sports_term,
            source_value=value, target_value=value,
            interpretation=m.description, confidence=m.significance,
            evidence_tier="E1" if formula["verified"] else "E3",
            formula_verified=formula["verified"],
            trust_score=formula.get("trust_score", 0),
        ).to_dict()

    def system_archetype(self, alias: str) -> dict:
        """Resolve an athlete/system alias to a biological archetype (spine)."""
        key = str(alias).strip().lower().split()[0]
        archetype = ARCHETYPE_ALIASES.get(key, key)
        if archetype not in ARCHETYPE_SPINE:
            return TranslatedRecord(
                source_domain="sports", target_domain="biotech",
                source_term=alias, target_term="Unknown archetype",
                interpretation="Athlete/alias not in the archetype spine.",
                confidence=0.0, evidence_tier="E3",
            ).to_dict()
        description, biotech_phenotype = ARCHETYPE_SPINE[archetype]
        return TranslatedRecord(
            source_domain="sports", target_domain="biotech",
            source_term=alias, target_term=archetype,
            interpretation=f"{description}. => {biotech_phenotype}",
            confidence=0.85, evidence_tier="E3",
        ).to_dict()

    def list_mappings(self) -> list[dict]:
        """Full bidirectional lexicon for the TranslationAgent registry."""
        return [
            {
                "sports_term": m.sports_term,
                "biotech_term": m.biotech_term,
                "description": m.description,
                "formula": m.formula,
                "significance": m.significance,
            }
            for m in FORMULA_ALIASES.values()
            if m.sports_term
        ]


# Backward-compatible alias: the biotech platform historically exposed this class
# as BiotechTranslationEngine. Both names point at the same shared core.
BiotechTranslationEngine = TranslationEngine
