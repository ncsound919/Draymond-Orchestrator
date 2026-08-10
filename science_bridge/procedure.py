# science_bridge/procedure.py
"""Procedure translation layer: play execution <-> clinical protocol.

Layer 3 of the expanded translation system. Maps discrete procedural steps
between basketball plays and clinical protocols: inbound <-> dose step, screen
<-> drug cycle, pick-and-roll <-> combination step, timeout <-> monitoring
checkpoint, substitution <-> treatment-line switch. Rule-based (E3).
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ProcedureRecord:
    sports_step: str
    biotech_step: str
    description: str
    confidence: float
    sequence: list[str] = field(default_factory=list)
    evidence_tier: str = "E3"


PROCEDURE_MAPPINGS: list[ProcedureRecord] = [
    ProcedureRecord(
        sports_step="inbound pass",
        biotech_step="dose administration step",
        description="Inbound starts the possession; dose administration starts the treatment cycle.",
        confidence=0.88,
        sequence=["call the play", "administer dose", "initiate cycle"],
    ),
    ProcedureRecord(
        sports_step="set screen",
        biotech_step="drug-cycle priming step",
        description="A screen creates space for the ball-handler; priming prepares the cell population for a therapeutic pulse.",
        confidence=0.84,
        sequence=["set the screen", "prime the population", "release the handler"],
    ),
    ProcedureRecord(
        sports_step="pick-and-roll",
        biotech_step="combination pulse (two-agent sequenced step)",
        description="Pick-and-roll chains a screen into a roll; a combination pulse chains two agents for sequential effect.",
        confidence=0.83,
        sequence=["pick", "roll", "finish", "agent A then agent B"],
    ),
    ProcedureRecord(
        sports_step="call timeout",
        biotech_step="monitoring checkpoint / mid-cycle review",
        description="A timeout pauses play to regroup; a checkpoint pauses therapy for assessment.",
        confidence=0.9,
        sequence=["stop play", "review", "adjust game plan", "monitor biomarker", "adjust regimen"],
    ),
    ProcedureRecord(
        sports_step="substitution",
        biotech_step="treatment-line switch",
        description="Substitution brings a fresh player; a line switch brings a next-line therapy.",
        confidence=0.85,
        sequence=["bench current", "bring fresh", "switch line", "de-escalate or escalate"],
    ),
    ProcedureRecord(
        sports_step="end-of-quarter reset",
        biotech_step="cycle boundary / dosing window reset",
        description="Quarter reset repositions both teams; cycle boundary resets the dosing schedule.",
        confidence=0.8,
        sequence=["reset possession", "reset schedule", "restart window"],
    ),
    ProcedureRecord(
        sports_step="full-court press",
        biotech_step="intensive induction phase (high-dose window)",
        description="A press applies full-court pressure; an induction phase applies maximal therapeutic pressure.",
        confidence=0.82,
        sequence=["apply pressure", "force errors", "induce maximum response"],
    ),
    ProcedureRecord(
        sports_step="last-second shot",
        biotech_step="final push / salvage dose",
        description="A last-second shot decides the game; a salvage dose is the final therapeutic push.",
        confidence=0.81,
        sequence=["run the play", "final attempt", "salvage dose", "assess outcome"],
    ),
]

_PROCEDURE_LOOKUP = {p.sports_step: p for p in PROCEDURE_MAPPINGS}
_REVERSE_PROCEDURE_LOOKUP = {p.biotech_step: p for p in PROCEDURE_MAPPINGS}


def translate_procedure(name: str, from_sports: bool = True) -> dict:
    """Translate a procedural step bidirectionally."""
    key = str(name).strip().lower()
    table = _PROCEDURE_LOOKUP if from_sports else _REVERSE_PROCEDURE_LOOKUP
    record = table.get(key)
    if record is None:
        return {
            "layer": "procedure",
            "source_term": name,
            "target_term": None,
            "confidence": 0.0,
            "evidence_tier": "E4",
            "description": "no known procedure mapping",
        }
    return {
        "layer": "procedure",
        "source_term": record.sports_step if from_sports else record.biotech_step,
        "target_term": record.biotech_step if from_sports else record.sports_step,
        "confidence": record.confidence,
        "evidence_tier": record.evidence_tier,
        "description": record.description,
        "sequence": record.sequence,
    }


def list_procedures() -> list[str]:
    return [p.sports_step for p in PROCEDURE_MAPPINGS]
