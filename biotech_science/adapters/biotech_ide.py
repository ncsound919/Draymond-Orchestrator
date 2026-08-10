# biotech_science/adapters/biotech_ide.py
"""Biotech IDE adapter — the seam between the sports and biotech engines.

The Biotech IDE (FastAPI, `Biotech IDE\backend`) is THE translation point:
sports analytics metrics (TER, four factors, gravity, flow) map onto disease
archetypes via its `/translate` endpoints and `lab_director` agent bridge.

This adapter wraps those endpoints with the same graceful-degradation contract
as the sports adapters: E1 when the IDE is reachable, E3 with a clear error
when it is not.
"""
from __future__ import annotations

import requests

DEFAULT_IDE_URL = "http://localhost:8080"  # Biotech IDE / bbtech def FastAPI server


class BiotechIdeAdapter:
    def __init__(self, base_url: str = DEFAULT_IDE_URL):
        self.base_url = base_url

    def translate(self, term: str, value: float | None = None) -> dict:
        """Translate a sports <-> biotech term/value via the IDE /translate endpoint."""
        try:
            payload = {"term": term}
            if value is not None:
                payload["value"] = value
            resp = requests.post(f"{self.base_url}/translate", json=payload, timeout=10)
            resp.raise_for_status()
            return {"source": "biotech_ide", "evidence_tier": "E1", "data": resp.json()}
        except requests.RequestException:
            return {
                "source": "biotech_ide",
                "evidence_tier": "E3",
                "data": {"error": "biotech_ide service unreachable"},
            }

    def lab_director(self, inputs: dict) -> dict:
        """Dispatch a lab-director task to the Biotech IDE agent bridge."""
        try:
            resp = requests.post(f"{self.base_url}/lab_director", json=inputs, timeout=10)
            resp.raise_for_status()
            return {"source": "biotech_ide", "evidence_tier": "E1", "data": resp.json()}
        except requests.RequestException:
            return {
                "source": "biotech_ide",
                "evidence_tier": "E3",
                "data": {"error": "biotech_ide service unreachable"},
            }
