# biotech_science/adapters/chemlab.py
"""Overlay-Chemlab adapter - molecular risk scoring + analogue search.

Tries an RDKit/PubChem-capable chemlab endpoint when running; otherwise falls
back to the local deterministic engine (biotech_science.chemlab).
Evidence tiers:
  E2 - structure-derived risk (local deterministic chemistry)
  E3 - fallback heuristic (invalid SMILES / service unavailable)
"""
from __future__ import annotations

import sys
from pathlib import Path

import requests

DEFAULT_CHEMLAB_URL = "http://localhost:8084"

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from biotech_science.chemlab import compute_risk, suggest_analogues  # noqa: E402


class ChemlabAdapter:
    def __init__(self, base_url: str = DEFAULT_CHEMLAB_URL):
        self.base_url = base_url

    def risk(self, smiles: str, k: int = 3) -> dict:
        """Compute Bayesian toxicity risk + analogue suggestions for a SMILES."""
        try:
            resp = requests.post(
                f"{self.base_url}/risk",
                json={"smiles": smiles, "k": k},
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            return {"source": "chemlab", "evidence_tier": "E2", "data": data, "risk": data}
        except requests.RequestException:
            risk = compute_risk(smiles)
            analogues = suggest_analogues(smiles, k=k)
            out = {
                "smiles": risk["smiles"],
                "valid": risk["valid"],
                "posterior_risk": risk.get("posterior_risk"),
                "confidence95": risk.get("confidence95"),
                "dominant_features": risk.get("dominant_features"),
                "flagged": risk.get("flagged"),
                "analogues": analogues.get("analogues", []),
            }
            return {
                "source": "chemlab_local",
                "evidence_tier": risk.get("evidence_tier", "E3"),
                "data": out,
                "risk": out,
            }
