# biotech_science/adapters/moleculargraph.py
"""MolecularGraph adapter — Julia chemoinformatics backend.

Wraps the MolecularGraph.jl service (SMILES parsing, descriptors, MCS,
graph-based chemoinformatics). Graceful degradation: E1 on reachable compute,
E3 with a clear error when the backend is unreachable.
"""
from __future__ import annotations

import requests

DEFAULT_MOLECULARGRAPH_URL = "http://localhost:8082"


class MolecularGraphAdapter:
    def __init__(self, base_url: str = DEFAULT_MOLECULARGRAPH_URL):
        self.base_url = base_url

    def descriptors(self, smiles: str) -> dict:
        """Compute molecular descriptors for a SMILES string."""
        try:
            resp = requests.post(
                f"{self.base_url}/descriptors",
                json={"smiles": smiles},
                timeout=10,
            )
            resp.raise_for_status()
            return {"source": "moleculargraph", "evidence_tier": "E1", "data": resp.json()}
        except requests.RequestException:
            return {
                "source": "moleculargraph",
                "evidence_tier": "E3",
                "data": {"error": "moleculargraph service unreachable"},
            }
