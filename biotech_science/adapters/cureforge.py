# biotech_science/adapters/cureforge.py
"""CureForge adapter - hypothesis verification + Bayesian evidence.

Tries the CureForge server endpoints (/bayes/evidence) when running; otherwise
falls back to the local deterministic engine (biotech_science.verify).
Evidence tiers:
  E1 - live CureForge / ChEMBL / ClinicalTrials.gov evidence
  E3 - offline deterministic Bayesian priors (default)
"""
from __future__ import annotations

import sys
from pathlib import Path

import requests

DEFAULT_CUREFORGE_URL = "http://localhost:8083"

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from biotech_science.verify import bayesian_update  # noqa: E402


class CureForgeAdapter:
    def __init__(self, base_url: str = DEFAULT_CUREFORGE_URL):
        self.base_url = base_url

    def bayes_evidence(self, target: str, prior: float = 0.5, is_success: bool = True) -> dict:
        """Bayesian evidence update for a target hypothesis."""
        try:
            resp = requests.get(
                f"{self.base_url}/bayes/evidence",
                params={"target": target, "prior": prior, "isSuccess": str(is_success).lower()},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
            return {"source": "cureforge", "evidence_tier": "E1", "data": data, "evidence": data}
        except requests.RequestException:
            # Deterministic offline priors - no network dependency, so the
            # fallback is fast and reproducible (E1 evidence is only claimed
            # when the live endpoint answers).
            out = bayesian_update(prior, is_success, chembl_active_count=0, has_clinical_trials=False)
            out["target"] = target
            out["evidence_tier"] = "E3"
            return {
                "source": "cureforge_local",
                "evidence_tier": "E3",
                "data": out,
                "evidence": out,
            }
