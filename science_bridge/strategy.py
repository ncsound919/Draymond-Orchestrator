# science_bridge/strategy.py
"""Strategy translation layer: game-plan <-> treatment-plan.

Layer 2 of the expanded translation system. Maps high-level strategy elements
between basketball and biotech: lineups <-> drug combinations, defensive scheme
<-> immune strategy, offensive system <-> therapeutic regimen, matchups <-> target
selection. Each mapping is a rule-based (E3) bilingual record with confidence.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class StrategyRecord:
    sports_strategy: str
    biotech_strategy: str
    description: str
    confidence: float
    tactics: list[str] = field(default_factory=list)
    evidence_tier: str = "E3"


STRATEGY_MAPPINGS: list[StrategyRecord] = [
    StrategyRecord(
        sports_strategy="small-ball lineup",
        biotech_strategy="low-density tumor microenvironment strategy",
        description="Small-ball trades size for spacing/speed; biotech analog trades stromal density for drug penetration and immune access.",
        confidence=0.84,
        tactics=["stretch the floor", "increase drug penetrance", "reduce stromal density"],
    ),
    StrategyRecord(
        sports_strategy="switch-everything defense",
        biotech_strategy="broad-spectrum immune surveillance / pan-target coverage",
        description="Switch-everything removes mismatches; biotech analog deploys broad surveillance covering multiple escape pathways.",
        confidence=0.81,
        tactics=["no mismatch windows", "cover escape mutations", "broad immune patrol"],
    ),
    StrategyRecord(
        sports_strategy="high-pace offense",
        biotech_strategy="accelerated replication-cycle pressure (tempo therapy)",
        description="High pace generates more possessions; biotech analog pressures cells by compressing division-cycle windows.",
        confidence=0.78,
        tactics=["push tempo", "compress cell-cycle", "limit recovery windows"],
    ),
    StrategyRecord(
        sports_strategy="iso-heavy offense (star isolation)",
        biotech_strategy="driver-oncogene-targeted monotherapy",
        description="Iso offense feeds the star; biotech analog concentrates therapy on the dominant driver oncogene.",
        confidence=0.86,
        tactics=["feed the star", "target the driver", "concentrate the regimen"],
    ),
    StrategyRecord(
        sports_strategy="motion offense (ball movement)",
        biotech_strategy="combination therapy with pathway cross-talk",
        description="Motion offense maximizes ball movement; biotech analog uses combination agents that exploit pathway cooperation.",
        confidence=0.83,
        tactics=["move the ball", "cross-pathway synergies", "multi-agent cooperation"],
    ),
    StrategyRecord(
        sports_strategy="defensive rebounds -> transition",
        biotech_strategy="immune-resource recycling -> rapid re-engagement",
        description="Rebound-and-run converts defense to offense; biotech analog recycles cleared antigens into rapid immune re-engagement.",
        confidence=0.79,
        tactics=["rebound and run", "recycle antigen", "re-engage fast"],
    ),
    StrategyRecord(
        sports_strategy="late-game clock management",
        biotech_strategy="dose-timing / pharmacokinetic scheduling",
        description="Clock management paces possessions late; biotech analog schedules dosing to maximize efficacy windows.",
        confidence=0.82,
        tactics=["manage the clock", "schedule doses", "maximize efficacy windows"],
    ),
    StrategyRecord(
        sports_strategy="zone defense",
        biotech_strategy="compartmentalized immune containment",
        description="Zone defends areas not players; biotech analog contains disease by compartment rather than chasing individual cells.",
        confidence=0.76,
        tactics=["defend areas", "contain compartments", "regional lockdown"],
    ),
]

_STRATEGY_LOOKUP = {s.sports_strategy: s for s in STRATEGY_MAPPINGS}
_REVERSE_STRATEGY_LOOKUP = {s.biotech_strategy: s for s in STRATEGY_MAPPINGS}


def translate_strategy(name: str, from_sports: bool = True) -> dict:
    """Translate a strategy element bidirectionally."""
    key = str(name).strip().lower()
    table = _STRATEGY_LOOKUP if from_sports else _REVERSE_STRATEGY_LOOKUP
    record = table.get(key)
    if record is None:
        return {
            "layer": "strategy",
            "source_term": name,
            "target_term": None,
            "confidence": 0.0,
            "evidence_tier": "E4",
            "description": "no known strategy mapping",
        }
    return {
        "layer": "strategy",
        "source_term": record.sports_strategy if from_sports else record.biotech_strategy,
        "target_term": record.biotech_strategy if from_sports else record.sports_strategy,
        "confidence": record.confidence,
        "evidence_tier": record.evidence_tier,
        "description": record.description,
        "tactics": record.tactics,
    }


def list_strategies() -> list[str]:
    return [s.sports_strategy for s in STRATEGY_MAPPINGS]
