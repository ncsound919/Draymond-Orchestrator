# biotech_science/adapters/colabfold.py
"""ColabFold adapter — protein structure prediction backend.

Wraps the ColabFold service (AlphaFold2/ESMFold/RoseTTAFold2/Boltz) used for
structure prediction in the biotech engine. Like the other adapters, it
degrades gracefully: E1 on reachable predictions, E3 with a clear error when
the backend is not running locally.
"""
from __future__ import annotations

import requests

DEFAULT_COLABFOLD_URL = "http://localhost:8081"


class ColabFoldAdapter:
    def __init__(self, base_url: str = DEFAULT_COLABFOLD_URL):
        self.base_url = base_url

    def predict(self, sequence: str, model: str = "alphafold2") -> dict:
        """Run structure prediction for a protein sequence."""
        try:
            resp = requests.post(
                f"{self.base_url}/predict",
                json={"sequence": sequence, "model": model},
                timeout=60,
            )
            resp.raise_for_status()
            return {"source": "colabfold", "evidence_tier": "E1", "data": resp.json()}
        except requests.RequestException:
            return {
                "source": "colabfold",
                "evidence_tier": "E3",
                "data": {"error": "colabfold service unreachable"},
            }
