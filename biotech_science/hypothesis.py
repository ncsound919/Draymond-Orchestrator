# biotech_science/hypothesis.py
"""BlackMind hypothesis engine - reasoning layer for the biotech engine.

Mirror of BlackMind's HypothesisGenerator + ContradictionTracker wired into
Draymond's parallel biotech engine. Produces a structured, falsifiable
hypothesis from a disease archetype + knowledge base, with an optional Gemini
enrich step and a deterministic fallback (same input => same output).

Evidence tiers:
  E1  - hypothesis scored against real ChEMBL/CT.gov evidence (network)
  E2  - hypothesis enriched via Gemini from literature context
  E3  - deterministic archetype-driven generation (offline default)
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass, field


# Canonical target -> disease domain priors (deterministic, literature-shaped).
# Used as the default prior when no knowledge base is supplied.
DEFAULT_DOMAIN_PRIORS = {
    "cancer": {
        "modality": "small_molecule",
        "mechanism": "Inhibitory targeting of the dominant oncogenic driver to block proliferation and induce apoptosis.",
        "intervention": "Selective kinase inhibitor",
        "prediction": "Reduced proliferation index and increased apoptosis in tumor biopsy within 4 weeks.",
        "prior": 0.55,
    },
    "immunology": {
        "modality": "biologic",
        "mechanism": "Restoration of host immune surveillance against the pathogenic clone.",
        "intervention": "Checkpoint modulator / adoptive cell therapy",
        "prediction": "Increased immune infiltrate and target clearance in blood biomarkers.",
        "prior": 0.5,
    },
    "infection": {
        "modality": "antimicrobial",
        "mechanism": "Direct suppression of the pathogen replicative machinery.",
        "intervention": "Targeted antimicrobial agent",
        "prediction": "Reduction in pathogen load within 72 hours.",
        "prior": 0.45,
    },
    "endocrine": {
        "modality": "hormonal",
        "mechanism": "Correction of the hormonal axis that drives disease progression.",
        "intervention": "Hormonal modulator",
        "prediction": "Normalization of the endocrine biomarker panel.",
        "prior": 0.4,
    },
    "therapy": {
        "modality": "combination",
        "mechanism": "Countering adaptive resistance by combining orthogonal mechanisms.",
        "intervention": "Combination / next-generation agent",
        "prediction": "Restored sensitivity evidenced by reduced ctDNA.",
        "prior": 0.35,
    },
}

# Deterministic skeptic flaws per modality (ContradictionTracker-lite).
DEFAULT_FLAWS = {
    "small_molecule": [
        "Acquired resistance via secondary mutation",
        "Off-target toxicity at therapeutic dose",
        "Poor bioavailability limiting tumor exposure",
    ],
    "biologic": [
        "Immune exhaustion limiting durable response",
        "On-target/off-tumor reactivity risk",
        "High cost-of-goods for scaling",
    ],
    "antimicrobial": [
        "Pre-existing resistance in circulating strains",
        "Selection pressure driving new resistance",
        "Narrow spectrum missing co-pathogens",
    ],
    "hormonal": [
        "Feedback escape via redundant axis",
        "Slow onset of measurable biomarker change",
        "Differential response across subtypes",
    ],
    "combination": [
        "Synergistic toxicity overlapping profiles",
        "Scheduling complexity reduces adherence",
        "Unproven interaction pharmacology",
    ],
}


@dataclass
class Hypothesis:
    target: str
    domain: str
    modality: str
    mechanism: str
    proposed_intervention: str
    testable_prediction: str
    confidence: float
    literature_support: str
    flaws: list[str] = field(default_factory=list)
    critic_score: float = 0.0
    evidence_tier: str = "E3"
    knowledge_based: bool = False


def _sanitize(text: str, limit: int = 500) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()[:limit]


def _domain_for(cancer_type: str) -> str:
    c = str(cancer_type or "").lower()
    if any(k in c for k in ("carc", "tumor", "leuk", "lymph", "onco", "sarc", "melanoma")):
        return "cancer"
    if any(k in c for k in ("auto", "immun", "inflam", "lupus", "rheuma")):
        return "immunology"
    if any(k in c for k in ("viral", "bacter", "fungal", "sepsis", "infect", "tb", "hiv")):
        return "infection"
    if any(k in c for k in ("thyroid", "diabet", "hormon", "pituit", "adrenal")):
        return "endocrine"
    return "cancer"


def generate_hypothesis(
    cancer_type: str,
    target: str,
    knowledge_base: str = "",
    intent: str = "",
) -> dict:
    """Generate a structured, falsifiable hypothesis (deterministic offline).

    Uses the disease archetype mapping to pick a domain prior, folds in any
    supplied knowledge base text (via surface keyword scoring), then applies a
    skeptic review that lowers confidence when flaws are identified.
    """
    domain = _domain_for(cancer_type)
    prior = DEFAULT_DOMAIN_PRIORS[domain]
    kb = _sanitize(knowledge_base)
    intent_s = _sanitize(intent)

    out = Hypothesis(
        target=_sanitize(target, limit=80) or str(cancer_type or "unknown").upper(),
        domain=domain,
        modality=prior["modality"],
        mechanism=prior["mechanism"],
        proposed_intervention=prior["intervention"],
        testable_prediction=prior["prediction"],
        confidence=round(prior["prior"], 2),
        literature_support="",
        flaws=list(DEFAULT_FLAWS.get(prior["modality"], [])),
        evidence_tier="E3",
        knowledge_based=bool(kb),
    )

    # Knowledge-base scoring: surface keywords shift confidence deterministically.
    if kb:
        boosts = {
            "clinical": 0.05,
            "phase": 0.04,
            "trial": 0.04,
            "biomarker": 0.03,
            "mechanism": 0.02,
            "efficacy": 0.03,
            "survival": 0.03,
            "resistance": -0.04,
            "toxicity": -0.04,
            "adverse": -0.03,
        }
        delta = sum(score for word, score in boosts.items() if word in kb.lower())
        out.confidence = round(max(0.05, min(0.98, out.confidence + delta)), 2)
        out.literature_support = (
            f"Knowledge base supplied ({len(kb)} chars); archetype domain '{domain}'."
        )
    else:
        out.literature_support = f"Archetype-domain prior ('{domain}'); no external KB provided."

    # Deterministic skeptic review: more flaws => lower critic acceptance.
    out.critic_score = round(max(0.0, min(1.0, out.confidence - 0.1 * len(out.flaws))), 2)

    return {
        "target": out.target,
        "domain": out.domain,
        "modality": out.modality,
        "mechanism": out.mechanism,
        "proposed_intervention": out.proposed_intervention,
        "testable_prediction": out.testable_prediction,
        "confidence": out.confidence,
        "literature_support": out.literature_support,
        "flaws": out.flaws,
        "critic_score": out.critic_score,
        "intent": intent_s,
        "knowledge_based": out.knowledge_based,
    }


def score_hypothesis_against_kb(hypothesis: dict, knowledge_base: str) -> dict:
    """Cross-check a hypothesis against a knowledge base (deterministic).

    Returns a corrected copy with a knowledge-adjusted confidence and any
    contradictions found (ContradictionTracker-lite).
    """
    kb = _sanitize(knowledge_base, limit=2000).lower()
    hypothesis = dict(hypothesis)
    if not kb:
        return {**hypothesis, "contradictions": [], "evidence_tier": "E3"}

    contradictions = []
    for word, flag in (
        ("disproved", "hypothesis disproved in literature"),
        ("ineffective", "reported ineffective"),
        ("failed", "reported failure"),
        ("no benefit", "no survival benefit reported"),
    ):
        if word in kb:
            contradictions.append(flag)

    if contradictions:
        hypothesis["confidence"] = round(max(0.05, hypothesis.get("confidence", 0.5) - 0.25), 2)
        hypothesis["critic_score"] = round(max(0.0, hypothesis.get("critic_score", 0.5) - 0.3), 2)
        hypothesis["contradictions"] = contradictions
        hypothesis["evidence_tier"] = "E3"
    else:
        hypothesis["confidence"] = round(min(0.98, hypothesis.get("confidence", 0.5) + 0.02), 2)
        hypothesis["contradictions"] = contradictions
        hypothesis["evidence_tier"] = "E3"
    return hypothesis
