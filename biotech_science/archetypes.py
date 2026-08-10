# biotech_science/archetypes.py
"""Disease archetypes + drug/patient mapping (mirror of sports_science.archetypes).

Player archetypes translate onto disease archetypes (see translation/engine.py);
this module provides the biotech-side surface: disease archetype registry,
patient profile -> archetype scoring, and drug-class association.
"""
from __future__ import annotations

_DISEASE_ARCHETYPES = {
    "virus_like_spread": ("Rapid, contagious-like progression that spreads through tissue compartments.", ("cancer", "infection")),
    "unstable_genome": ("High mutational burden; genetically unstable, evades targeted therapy.", ("cancer",)),
    "cancer_dominant": ("Dominant lesion; high proliferation, resource consumption, therapy resistance.", ("cancer",)),
    "neuroendocrine_axis": ("Neuroendocrine-driven orchestration; hormonal rhythm controls disease course.", ("cancer", "endocrine")),
    "master_transcription_factor": ("System-level regulator raising the aggressiveness of the whole disease.", ("cancer",)),
    "immune_system": ("Host immune response; the 'defense' that targets disease cells.", ("immunology",)),
    "phagocytic_cleanup": ("Macrophage/myeloid activity; debris clearance and tissue remodeling.", ("immunology",)),
    "metastatic_aggression": ("Invasive/metastatic phenotype; physically overwhelms tissue barriers.", ("cancer",)),
    "therapy_evader": ("Adaptive resistance; exploits treatment rules to recur.", ("cancer", "therapy")),
}

_DRUG_CLASS_MAP = {
    "cancer_dominant": ["chemotherapy", "cell-cycle inhibitors"],
    "virus_like_spread": ["oncolytic virus", "immune checkpoint"],
    "master_transcription_factor": ["transcription-factor inhibitors", "epigenetic therapy"],
    "immune_system": ["immunotherapy", "adoptive cell therapy"],
    "metastatic_aggression": ["anti-metastatic agents", "integrin inhibitors"],
    "therapy_evader": ["combination therapy", "next-generation agents"],
}

ARCHETYPES = {name: {"description": desc, "diseases": list(dz)} for name, (desc, dz) in _DISEASE_ARCHETYPES.items()}


def disease_archetype(name: str) -> dict:
    """Return archetype info by canonical name or alias."""
    key = str(name).strip().lower()
    if key in ARCHETYPES:
        return ARCHETYPES[key]
    # Accept the player-alias (e.g. 'jordan' -> 'cancer_dominant').
    from .translation.mappings import ARCHETYPE_ALIASES, ARCHETYPE_FORWARD
    if key in ARCHETYPE_ALIASES:
        return ARCHETYPE_FORWARD[ARCHETYPE_ALIASES[key]]
    raise KeyError(f"unknown archetype: {name!r}")


def drug_classes_for(archetype: str) -> list[str]:
    """Drug classes suggested for a disease archetype (E3 expert mapping)."""
    return list(_DRUG_CLASS_MAP.get(archetype, []))


def patient_archetype_profile(
    proliferation: float,
    mutational_burden: float,
    immune_infiltrate: float,
    metastasis_score: float,
) -> dict:
    """Score a patient/tumor profile against disease archetypes (E3 heuristic).

    Returns the best-matching archetype + normalized match scores.
    """
    prof = {
        "virus_like_spread": 0.2 * (100 - immune_infiltrate) + 0.3 * metastasis_score,
        "unstable_genome": mutational_burden,
        "cancer_dominant": 0.5 * proliferation + 0.3 * (100 - immune_infiltrate),
        "master_transcription_factor": 0.3 * proliferation + 0.4 * mutational_burden,
        "metastatic_aggression": metastasis_score,
        "therapy_evader": 0.4 * (100 - immune_infiltrate) + 0.4 * mutational_burden,
    }
    total = sum(prof.values()) or 1.0
    scores = {k: round(v / total, 4) for k, v in prof.items()}
    best = max(scores, key=scores.get)
    return {
        "best_archetype": best,
        "description": ARCHETYPES[best]["description"],
        "scores": scores,
        "drug_classes": drug_classes_for(best),
        "evidence_tier": "E3",
    }
