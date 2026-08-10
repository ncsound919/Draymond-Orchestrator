# science_bridge/insights.py
"""Whole-profile bidirectional insight synthesis.

Accepts a full metric profile from either domain (sports or biotech), translates
every metric bidirectionally, aggregates the archetype match, and emits a
plain-language InsightReport with translated metrics and E1-E4 evidence.

Deterministic, rule-based, evidence-tiered. No LLM dependency.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .translation.engine import BiotechTranslationEngine
from .translation.evidence import grade_confidence

# Domain detection keys per profile.
SPORTS_KEYS = {"ter", "four_factors", "gravity", "flow", "fatigue", "injury_risk"}
BIOTECH_KEYS = {"ter", "four_factors", "tumor_gravity", "tumor_flow", "risk_tier"}

# Four-factor name normalization: sports 'resource' <-> biotech 'angiogenesis'.
FOUR_FACTOR_NORMALIZE = {"resource": "angiogenesis", "angiogenesis": "resource"}


@dataclass
class TranslatedMetric:
    metric: str
    source_value: float | None
    target_metric: str
    target_value: float | None
    confidence: float
    note: str


@dataclass
class InsightReport:
    from_domain: str
    to_domain: str
    source_read: str
    target_read: str
    translated_metrics: list[TranslatedMetric] = field(default_factory=list)
    archetype: str | None = None
    archetype_translation: str | None = None
    confidence: float = 0.0
    evidence_tier: str = "E3"


def detect_domain(profile: dict) -> str:
    """Detect whether a profile is sports or biotech by key presence."""
    keys = set(profile.keys())
    if "tumor_gravity" in keys or "tumor_flow" in keys or "risk_tier" in keys:
        return "biotech"
    if "fatigue" in keys or "injury_risk" in keys or "gravity" in keys:
        return "sports"
    return "sports"


def _norm_four_factors(factors: dict, from_domain: str) -> dict:
    """Normalize the four-factor naming gap for the target domain."""
    out = dict(factors)
    for k, v in FOUR_FACTOR_NORMALIZE.items():
        if k in out:
            target = v
            out.setdefault(target, out[k])
    return out


def _read_profile(profile: dict, domain: str) -> str:
    """Plain-language read of a profile in its own domain."""
    parts: list[str] = []
    ff = profile.get("four_factors", {})
    if isinstance(ff, dict) and ff:
        parts.append(
            "four-factor balance: proliferation {prol:.0f}, clearance {clear:.0f}, "
            "{res_name} {res:.0f}, metastasis {meta:.0f}".format(
                prol=ff.get("proliferation", 0),
                clear=ff.get("clearance", 0),
                res_name=("angiogenesis" if domain == "biotech" else "resource"),
                res=ff.get("angiogenesis", ff.get("resource", 0)),
                meta=ff.get("metastasis", 0),
            )
        )
    ter = profile.get("ter")
    if ter is not None:
        parts.append(f"efficiency TER {ter:.2f}")
    if domain == "sports":
        if "injury_risk" in profile:
            parts.append(f"injury risk {profile['injury_risk']:.0%}")
        if "recovery_priority" in profile:
            parts.append(f"recovery priority '{profile['recovery_priority']}'")
    else:
        if "risk_tier" in profile:
            parts.append(f"clinical risk tier '{profile['risk_tier']}'")
        if "recurrence_risk" in profile:
            parts.append(f"recurrence risk {profile['recurrence_risk']:.0%}")
    return "; ".join(parts) if parts else "no profile metrics detected"


def _metric_pairs(profile: dict, domain: str) -> list[tuple[str, float | None, str, float | None, str, float]]:
    """Build (source_metric, source_value, target_metric, target_value, note, confidence) pairs."""
    engine = BiotechTranslationEngine()
    pairs: list[tuple[str, float | None, str, float | None, str, float]] = []
    ff = profile.get("four_factors", {})
    if isinstance(ff, dict):
        for src, tgt in (("proliferation", "proliferation"), ("clearance", "clearance"),
                         ("resource", "angiogenesis"), ("angiogenesis", "resource"),
                         ("metastasis", "metastasis")):
            if src in ff:
                res = engine.translate(src, from_sports=(domain == "sports"))
                pairs.append((src, float(ff[src]), tgt, float(ff[src]), "four-factor direct map",
                              res.get("confidence", 0.7)))
    ter = profile.get("ter")
    if ter is not None:
        conv = engine.convert_metric("ter")
        confidence = 0.9 if conv else 0.7
        target = conv["biotech_metric"] if conv else "tumor_efficiency"
        pairs.append(("ter", float(ter), target, float(ter),
                      conv["formula"] if conv else "TER -> tumor efficiency", confidence))
    for src_key, tgt_key in (
        ("tumor_gravity", "gravity"),
        ("gravity", "tumor_gravity"),
        ("tumor_flow", "flow"),
        ("flow", "tumor_flow"),
    ):
        if src_key in profile:
            res = engine.translate(src_key, from_sports=(domain == "sports"))
            pairs.append((src_key, float(profile[src_key]), tgt_key, float(profile[src_key]),
                          f"{src_key} <-> {tgt_key}", res.get("confidence", 0.7)))
    return pairs


def synthesize(profile: dict, from_domain: str | None = None) -> InsightReport:
    """Synthesize a whole-profile insight report for the target (other) domain."""
    domain = from_domain or detect_domain(profile)
    to_domain = "biotech" if domain == "sports" else "sports"
    engine = BiotechTranslationEngine()

    source_read = _read_profile(profile, domain)
    translated: list[TranslatedMetric] = []
    confidences: list[float] = []

    for src, sv, tgt, tv, note, conf in _metric_pairs(profile, domain):
        translated.append(
            TranslatedMetric(
                metric=src,
                source_value=sv,
                target_metric=tgt,
                target_value=tv,
                confidence=conf,
                note=note,
            )
        )
        confidences.append(conf)

    # Archetype aggregation.
    archetype = profile.get("archetype")
    archetype_translation = None
    if archetype:
        if domain == "sports":
            try:
                res = engine.translate(archetype, from_sports=True)
                archetype_translation = res.get("target_term")
            except Exception:  # noqa: BLE001
                archetype_translation = None
        else:
            try:
                res = engine.translate(archetype, from_sports=False)
                archetype_translation = res.get("target_term")
            except Exception:  # noqa: BLE001
                archetype_translation = None

    confidence = sum(confidences) / len(confidences) if confidences else 0.6
    evidence_tier = grade_confidence(confidence)

    target_read = _build_target_read(profile, domain, archetype_translation)

    return InsightReport(
        from_domain=domain,
        to_domain=to_domain,
        source_read=source_read,
        target_read=target_read,
        translated_metrics=translated,
        archetype=archetype,
        archetype_translation=archetype_translation,
        confidence=round(confidence, 4),
        evidence_tier=evidence_tier,
    )


def _build_target_read(profile: dict, domain: str, archetype_translation: str | None) -> str:
    """Actionable implication of the profile in the OTHER domain."""
    ff = profile.get("four_factors", {})
    if isinstance(ff, dict):
        clearance = ff.get("clearance", 50)
        proliferation = ff.get("proliferation", 50)
    else:
        clearance, proliferation = 50.0, 50.0

    if domain == "sports":
        # sports -> biotech: athletic profile as tumor/clinical implication.
        risk = profile.get("injury_risk", 0.0)
        parts = [
            f"As a biotech/tumor profile, this athlete maps to a system with "
            f"{'high' if proliferation > 60 else 'moderate' if proliferation > 40 else 'low'} proliferation "
            f"and {'robust' if clearance > 60 else 'suppressed' if clearance < 40 else 'balanced'} immune clearance."
        ]
        if risk > 0.5:
            parts.append("Elevated injury load translates to elevated recurrence/relapse signal — flag for intensified monitoring.")
        else:
            parts.append("Injury load translates to controlled recurrence signal — routine surveillance is adequate.")
    else:
        # biotech -> sports: tumor/clinical profile as athletic implication.
        tier = profile.get("risk_tier", "intermediate")
        parts = [
            f"As an athletic profile, this tumor maps to a roster with "
            f"{'star-driver dominance' if proliferation > 60 else 'balanced contributors' if clearance > 50 else 'defensive reliance'}."
        ]
        if tier in ("high", "elite"):
            parts.append("High clinical risk maps to critical availability — expect load management / DNPs.")
        else:
            parts.append("Clinical risk maps to normal availability — full minutes allocation.")

    if archetype_translation:
        parts.append(f"Archetype translation: {archetype_translation}.")
    return " ".join(parts)
