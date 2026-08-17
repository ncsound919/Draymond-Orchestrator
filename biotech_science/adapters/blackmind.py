# biotech_science/adapters/blackmind.py
"""BlackMind adapter - hypothesis + reasoning for the biotech engine.

Tries the BlackMind/BAM reasoning endpoint when running; otherwise falls back
to the local deterministic hypothesis engine (biotech_science.hypothesis).
Evidence tiers:
  E1 - live BlackMind reasoning response
  E3 - local deterministic hypothesis generation (default offline)
"""
from __future__ import annotations

import sys
from pathlib import Path

import requests

DEFAULT_BLACKMIND_URL = "http://localhost:3002"

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from biotech_science.hypothesis import generate_hypothesis, score_hypothesis_against_kb  # noqa: E402


class BlackMindAdapter:
    def __init__(self, base_url: str = DEFAULT_BLACKMIND_URL):
        self.base_url = base_url

    def hypothesize(self, cancer_type: str, target: str, knowledge_base: str = "", intent: str = "") -> dict:
        """Generate a structured hypothesis via BlackMind (or local fallback)."""
        try:
            resp = requests.post(
                f"{self.base_url}/api/science/hypothesize",
                json={
                    "cancer_type": cancer_type,
                    "target": target,
                    "knowledge_base": knowledge_base,
                    "intent": intent,
                },
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "source": "blackmind",
                "evidence_tier": "E1",
                "data": data,
                "hypothesis": data if isinstance(data, dict) else {},
            }
        except requests.RequestException:
            hypothesis = generate_hypothesis(
                cancer_type=cancer_type,
                target=target,
                knowledge_base=knowledge_base,
                intent=intent,
            )
            hypothesis = score_hypothesis_against_kb(hypothesis, knowledge_base)
            return {
                "source": "blackmind_local",
                "evidence_tier": "E3",
                "data": hypothesis,
                "hypothesis": hypothesis,
            }
