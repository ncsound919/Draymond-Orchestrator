# science_bridge/translation/mappings.py
"""Bidirectional sports <-> biotech mapping tables.

Terminology, archetype, and metric-conversion maps used by the translation
engine. Extends bb_tech_core's mappings with the full archetype set and
evidence-aware confidence metadata.

Carries the AUTHORITATIVE formula-backed lexicon ported from Overlay Science's
`disease_research/translation.py` (12 stat mappings with formulas + significance
scores, the archetype spine, and the verifiable-formula table) so the shared
seam matches the Overlay Science translation point exactly.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any


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

# ============================================================================
# AUTHORITATIVE FORMULA-BACKED LEXICON (ported from disease_research/translation.py)
# ============================================================================


@dataclass(frozen=True)
class Mapping:
    """A single bidirectional concept mapping (authoritative lexicon entry)."""

    sports_term: str
    biotech_term: str
    description: str
    formula: str | None = None
    significance: float = 0.5
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class TranslatedRecord:
    source_domain: str
    target_domain: str
    source_term: str
    target_term: str
    source_value: float | None = None
    target_value: float | None = None
    interpretation: str = ""
    confidence: float = 0.0
    evidence_tier: str = "E3"
    formula_verified: bool = False
    trust_score: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_domain": self.source_domain,
            "target_domain": self.target_domain,
            "source_term": self.source_term,
            "target_term": self.target_term,
            "source_value": self.source_value,
            "target_value": self.target_value,
            "interpretation": self.interpretation,
            "confidence": round(self.confidence, 4),
            "evidence_tier": self.evidence_tier,
            "formula_verified": self.formula_verified,
            "trust_score": self.trust_score,
        }


# The 12 stat mappings (from Basketball-IDE analogies.ts + disease_research).
FORMULA_MAPPINGS: list[Mapping] = [
    Mapping("Field Goal Percentage (FG%)", "Transfection Efficiency",
            "FG% measures successful shots out of attempts; transfection efficiency measures successful gene deliveries out of total attempts.",
            "FG% = FGM / FGA ~ Transfected Cells / Total Cells", 0.95, ("FG_PCT", "FGM", "FGA", "fg")),
    Mapping("Three-Point Percentage (3P%)", "Specificity Ratio",
            "Like 3-pointers requiring more precision, specificity measures how precisely a drug hits its target vs off-target effects.",
            "3P% = 3PM / 3PA ~ Target Hits / (Target + Off-target Hits)", 0.88, ("FG3_PCT", "3PM", "3PA", "tp")),
    Mapping("Assists (AST)", "Synergistic Drug Interactions",
            "Assists set up scoring; synergistic interactions enhance therapeutic outcomes.",
            "AST Rate ~ Synergy Index", 0.82, ("AST", "ast")),
    Mapping("Rebounds (REB)", "Recapture Rate",
            "Rebounds recover missed shots; recapture rates measure how well biological systems recover or recycle molecules.",
            "REB% ~ Molecules Recycled / Total Molecules Lost", 0.75, ("REB",)),
    Mapping("Turnovers (TOV)", "Adverse Events",
            "Turnovers are lost possessions; adverse events are unintended negative outcomes in treatment.",
            "TOV Rate ~ Adverse Events / Treatment Duration", 0.92, ("TOV", "tov")),
    Mapping("Plus/Minus (+/-)", "Therapeutic Index",
            "Plus/minus measures net impact; therapeutic index is the ratio of toxic dose to effective dose.",
            "+/- ~ log(Toxic Dose / Effective Dose)", 0.89, ("PLUS_MINUS",)),
    Mapping("Points Per Game (PPG)", "Bioavailability",
            "PPG measures scoring output; bioavailability measures how much drug reaches systemic circulation.",
            "PPG ~ AUC of Drug Concentration", 0.85, ("PTS",)),
    Mapping("Free Throw Percentage (FT%)", "Baseline Efficacy",
            "Free throws are uncontested; baseline efficacy is performance under controlled conditions.",
            "FT% ~ Response Rate in Control Arm", 0.78, ("FT_PCT",)),
    Mapping("Blocks (BLK)", "Inhibition Constants (Ki)",
            "Blocks prevent opponent scoring; inhibition constants measure how well a compound blocks a target.",
            "BLK Rate ~ 1 / Ki", 0.87, ("BLK",)),
    Mapping("Steals (STL)", "Competitive Binding Affinity",
            "Steals take possession; competitive binding measures how well a drug displaces competitors.",
            "STL Rate ~ Competitive Displacement Index", 0.83, ("STL",)),
    Mapping("Minutes Played (MIN)", "Half-Life",
            "Minutes indicate duration of contribution; half-life indicates duration of drug presence.",
            "MIN ~ Half-life x Clearance Factor", 0.91, ("MIN",)),
    Mapping("Offensive Rebounds (OREB)", "Reuptake Inhibition",
            "Offensive rebounds create new scoring chances; reuptake inhibition maintains higher neurotransmitter levels.",
            "OREB Rate ~ Reuptake Blockade %", 0.76, ("OREB",)),
]

FORMULA_ALIASES: dict[str, Mapping] = {}
for _m in FORMULA_MAPPINGS:
    for _a in _m.aliases:
        FORMULA_ALIASES[_a.strip().lower()] = _m
    FORMULA_ALIASES[_m.sports_term.strip().lower()] = _m
    FORMULA_ALIASES[_m.biotech_term.strip().lower()] = _m

# Verifiable formula identities (SymPy/Z3) — E1 when proven, else E3.
VERIFIABLE_FORMULAS: dict[str, tuple[str, str]] = {
    "TOV": ("-tov", "-adverse_events"),        # turnover penalty ~ adverse event rate
    "FG_PCT": ("fg_m/fga", "transfected/total"),  # FG% ~ transfection efficiency
    "PLUS_MINUS": ("points_for - points_against", "log(td/ed)"),  # +/- ~ therapeutic index log-ratio
}

# Archetype spine: athlete archetype -> (sports read, biotech phenotype).
ARCHETYPE_SPINE: dict[str, tuple[str, str]] = {
    "viral": ("explosive spread, high R0, immune escape", "infectious/immune-escape phenotype"),
    "mutation": ("adaptation under stress, defensive evasion", "evasive/adaptive tumor or pathogen"),
    "malignant": ("clonal expansion, host takeover", "high-pace aggressive tumor (Jordan model)"),
    "cns_endocrine": ("network control, hormonal distribution", "CNS/neuroendocrine regulatory axis"),
    "master_regulator": ("plasticity, differentiation, system control", "master transcription factor network"),
    "tcell": ("coordination, cytokine bursts, systemic defense", "cytotoxic immune surveillance"),
    "macrophage": ("resource recycling, inflammation management", "tumor-associated macrophage axis"),
    "invasive": ("barrier breach, structural deformation", "invasive/metastatic phenotype"),
    "rule_exploiter": ("efficiency exploitation, entropy management", "metabolic hijacking / Warburg phenotype"),
}
