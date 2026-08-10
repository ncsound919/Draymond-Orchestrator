# biotech_science/skill_bridge.py
"""Bridge to the 151-skill scientific capability layer (mirror of sports skill_bridge).

Wraps claude-scientific-skills database lookups (PubChem, ChEMBL, DrugBank,
ClinVar, PDB, UniProt, KEGG) with a graceful-degradation contract: E1 when a
skill is importable, E3 with a clear message otherwise. Also exposes the
treatment-result payload builder used by run_treatment.py.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_SKILLS_ROOT = os.environ.get(
    "BIOTECH_SKILLS_ROOT",
    r"C:\Users\User\Downloads\Uplift\02_Pillars\Overlay Science\Biotech\claude-scientific-skills-main\scientific-skills",
)

if _SKILLS_ROOT and Path(_SKILLS_ROOT).exists() and str(_SKILLS_ROOT) not in sys.path:
    sys.path.insert(0, _SKILLS_ROOT)


def _try_import(module: str, pkg_hint: str):
    """Try importing a skill module; return module or None."""
    try:
        return __import__(module)
    except Exception:  # noqa: BLE001
        return None


def database_lookup(database: str, query: str) -> dict:
    """Look up an identifier in a scientific database via the skills layer.

    Supported: pubchem, chembl, drugbank, clinvar, pdb, uniprot, kegg.
    Degrades to E3 with a clear message when the skill/network is unavailable.
    """
    db = str(database).strip().lower()
    if not query:
        return {"database": db, "evidence_tier": "E3", "data": {"error": "query required"}}

    if db == "pubchem":
        mod = _try_import("pubchem_database", "pubchem")
        if mod is None:
            return _unavailable(db)
        try:
            res = mod.lookup_compound(query)
            return {"database": db, "evidence_tier": "E1", "data": res}
        except Exception:  # noqa: BLE001
            return _unavailable(db)

    if db == "chembl":
        mod = _try_import("chembl_database", "chembl")
        if mod is None:
            return _unavailable(db)
        try:
            res = mod.lookup_molecule(query)
            return {"database": db, "evidence_tier": "E1", "data": res}
        except Exception:  # noqa: BLE001
            return _unavailable(db)

    if db in ("drugbank", "clinvar", "pdb", "uniprot", "kegg"):
        mod = _try_import(f"{db}_database", db)
        if mod is None:
            return _unavailable(db)
        try:
            res = mod.lookup(query)
            return {"database": db, "evidence_tier": "E1", "data": res}
        except Exception:  # noqa: BLE001
            return _unavailable(db)

    return {"database": db, "evidence_tier": "E3", "data": {"error": f"unsupported database '{db}'"}}


def _unavailable(database: str) -> dict:
    return {
        "database": database,
        "evidence_tier": "E3",
        "data": {"error": f"{database} skill unavailable (skills not installed or offline)"},
    }


def list_databases() -> list[str]:
    return ["pubchem", "chembl", "drugbank", "clinvar", "pdb", "uniprot", "kegg"]
