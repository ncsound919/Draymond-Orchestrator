# biotech_science/translation/mappings.py
"""Bidirectional sports <-> biotech mapping tables.

Terminology, archetype, and metric-conversion maps used by the translation
engine. Extends bb_tech_core's mappings with the full archetype set and
evidence-aware confidence metadata.
"""
from __future__ import annotations

from enum import Enum


class TranslationDirection(Enum):
    FORWARD = "basketball_to_biotech"
    REVERSE = "biotech_to_basketball"


class Domain(Enum):
    TREATMENT = "treatment"
    MUTATION = "mutation"
    GENOME = "genome"
    THERAPY = "therapy"
    EXPERIMENT = "experiment"
    DIAGNOSIS = "diagnosis"


# term -> (biotech_term, domain, description, confidence)
FORWARD_TERMS: dict[str, dict] = {
    "player": {"biotech": "cell", "domain": "diagnosis", "description": "Fundamental unit of analysis", "confidence": 0.98},
    "team": {"biotech": "tumor", "domain": "diagnosis", "description": "Collective entity with emergent properties", "confidence": 0.95},
    "roster": {"biotech": "cell_population", "domain": "diagnosis", "description": "Collection of similar cells", "confidence": 0.92},
    "coach": {"biotech": "physician", "domain": "treatment", "description": "Strategic decision maker", "confidence": 0.97},
    "playbook": {"biotech": "treatment_protocol", "domain": "treatment", "description": "Planned course of action", "confidence": 0.96},
    "possession": {"biotech": "cell_cycle", "domain": "genome", "description": "Unit of activity/proliferation", "confidence": 0.9},
    "shot": {"biotech": "effector_engagement", "domain": "therapy", "description": "Targeted intervention attempt", "confidence": 0.88},
    "rebound": {"biotech": "resource_scavenging", "domain": "metabolism", "description": "Nutrient/resource capture", "confidence": 0.85},
    "turnover": {"biotech": "resistance_evasion", "domain": "mutation", "description": "Loss of productive control", "confidence": 0.86},
    "foul": {"biotech": "collateral_toxicity", "domain": "treatment", "description": "Damaging side effect", "confidence": 0.84},
    "assist": {"biotech": "immune_cooperation", "domain": "therapy", "description": "Facilitating another effector", "confidence": 0.87},
    "defense": {"biotech": "immune_surveillance", "domain": "diagnosis", "description": "Protective activity", "confidence": 0.93},
    "bench": {"biotech": "reservoir_stemness", "domain": "genome", "description": "Reserve capacity", "confidence": 0.78},
    "star": {"biotech": "driver_oncogene", "domain": "mutation", "description": "Dominant causal factor", "confidence": 0.89},
    "role_player": {"biotech": "passenger_mutation", "domain": "mutation", "description": "Supporting, non-dominant factor", "confidence": 0.83},
    # metric-code terms (uppercase sports codes used by the translation CLI)
    "fg_pct": {"biotech": "proliferative_efficiency", "domain": "genome", "description": "Field-goal percentage -> fraction of productive divisions", "confidence": 0.88},
    "fg%": {"biotech": "proliferative_efficiency", "domain": "genome", "description": "Field-goal percentage -> fraction of productive divisions", "confidence": 0.88},
    "tp_pct": {"biotech": "effector_efficiency", "domain": "therapy", "description": "Three-point percentage -> high-leverage killing efficiency", "confidence": 0.87},
    "ast_pct": {"biotech": "immune_cooperation_index", "domain": "therapy", "description": "Assist percentage -> cooperative signaling rate", "confidence": 0.86},
    "reb_pct": {"biotech": "resource_capture_rate", "domain": "metabolism", "description": "Rebound percentage -> nutrient scavenging rate", "confidence": 0.84},
    "tov_pct": {"biotech": "resistance_rate", "domain": "mutation", "description": "Turnover percentage -> resistance/escape rate", "confidence": 0.86},
    "pace": {"biotech": "proliferation_tempo", "domain": "genome", "description": "Game pace -> cell division tempo", "confidence": 0.9},
    "usage": {"biotech": "tumor_burden", "domain": "diagnosis", "description": "Usage rate -> tumor burden share", "confidence": 0.89},
    "per": {"biotech": "composite_vitality", "domain": "diagnosis", "description": "Player efficiency rating -> composite clinical vitality", "confidence": 0.85},
    "win_share": {"biotech": "treatment_contribution", "domain": "therapy", "description": "Win shares -> patient outcome contribution", "confidence": 0.82},
}

# Reverse: biotech -> sports. Most are the inverse of forward; fill the gaps.
REVERSE_TERMS: dict[str, dict] = {
    v["biotech"]: {
        "sports": k,
        "domain": v["domain"],
        "description": v["description"],
        "confidence": v["confidence"] * 0.95,
    }
    for k, v in FORWARD_TERMS.items()
}
REVERSE_TERMS.update(
    {
        "tumor": {"sports": "team", "domain": "diagnosis", "description": "Collective entity with emergent properties", "confidence": 0.95},
        "cell": {"sports": "player", "domain": "diagnosis", "description": "Fundamental unit of analysis", "confidence": 0.98},
        "oncogene": {"sports": "star", "domain": "mutation", "description": "Dominant causal factor", "confidence": 0.89},
        "microenvironment": {"sports": "home_court", "domain": "diagnosis", "description": "Supporting context", "confidence": 0.82},
    }
)

# Archetype maps: player archetype <-> disease archetype.
# (mirrors sports_science.archetypes.py + bb_tech disease archetypes)
ARCHETYPE_FORWARD: dict[str, dict] = {
    "viral": {"disease": "virus_like_spread", "description": "Explosive first-step attacker that spreads through the field", "confidence": 0.94},
    "mutation": {"disease": "unstable_genome", "description": "Unpredictable genetic drift that evades scouting", "confidence": 0.92},
    "malignant": {"disease": "cancer_dominant", "description": "Dominant lesion that consumes resources and oppresses defense", "confidence": 0.97},
    "cns_endocrine": {"disease": "neuroendocrine_axis", "description": "High-IQ orchestrator that controls the hormonal rhythm", "confidence": 0.9},
    "master_regulator": {"disease": "master_transcription_factor", "description": "System engine that raises every teammate's ceiling", "confidence": 0.91},
    "tcell": {"disease": "immune_system", "description": "Relentless defender that targets the opponent's key player", "confidence": 0.95},
    "macrophage": {"disease": "phagocytic_cleanup", "description": "Grinder that cleans up debris and feeds second-chance activity", "confidence": 0.88},
    "invasive": {"disease": "metastatic_aggression", "description": "Freak athlete that physically overwhelms the point of attack", "confidence": 0.93},
    "rule_exploiter": {"disease": "therapy_evader", "description": "Bends rules to manufacture efficient repeatable offense", "confidence": 0.86},
}

ARCHETYPE_ALIASES: dict[str, str] = {
    "jordan": "malignant",
    "curry": "viral",
    "draymond": "tcell",
    "jokic": "cns_endocrine",
    "lebron": "master_regulator",
    "giannis": "invasive",
    "harden": "rule_exploiter",
    "luka": "rule_exploiter",
}

# Metric conversions: basketball metric <-> biotech metric with formula.
METRIC_CONVERSIONS: list[dict] = [
    {
        "basketball_metric": "ter",
        "biotech_metric": "tumor_efficiency",
        "conversion_factor": 1.0,
        "unit_basketball": "score",
        "unit_biotech": "efficiency",
        "formula": "TER -> tumor efficiency (1:1, cell-cycle normalized)",
    },
    {
        "basketball_metric": "four_factors",
        "biotech_metric": "proliferation_clearance_angiogenesis_metastasis",
        "conversion_factor": 1.0,
        "unit_basketball": "factor",
        "unit_biotech": "score",
        "formula": "shooting/rebounding/turnovers/fouls -> proliferation/clearance/angiogenesis/metastasis",
    },
    {
        "basketball_metric": "gravity_index",
        "biotech_metric": "immune_attention",
        "conversion_factor": 1.0,
        "unit_basketball": "index",
        "unit_biotech": "index",
        "formula": "defensive attention + spacing -> immune attention + tumor spacing",
    },
    {
        "basketball_metric": "flow_index",
        "biotech_metric": "treatment_flow",
        "conversion_factor": 1.0,
        "unit_basketball": "index",
        "unit_biotech": "index",
        "formula": "tempo x possession quality -> treatment tempo x response quality",
    },
]
