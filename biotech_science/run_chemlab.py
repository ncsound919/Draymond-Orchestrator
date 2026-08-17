# biotech_science/run_chemlab.py
"""CLI runner: SMILES -> Chemlab Bayesian risk + analogues.

Contract:
  python biotech_science/run_chemlab.py session <input.json>
Input:
  { "smiles": str, "k"?: int }
Output: { smiles, valid, posterior_risk, confidence95, dominant_features,
  flagged, analogues } with NO inner evidence_tier (stripped at the TS
boundary). Non-zero exit => {"error": ...} on stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from biotech_science.chemlab import compute_risk, suggest_analogues  # noqa: E402


def compute_chemlab(payload: dict) -> dict:
    smiles = str(payload.get("smiles", "") or "")
    k = int(payload.get("k", 3) or 3)
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
    if risk.get("error"):
        out["error"] = risk["error"]
    return out


def _main() -> int:
    parser = argparse.ArgumentParser(description="Overlay-Chemlab risk runner")
    parser.add_argument("session", help="session id (ignored, for contract compatibility)")
    parser.add_argument("input", help="path to chemlab input JSON")
    args = parser.parse_args()
    try:
        if not Path(args.input).exists():
            raise ValueError(f"input not found: {args.input}")
        payload = json.loads(Path(args.input).read_text(encoding="utf-8-sig"))
        if not isinstance(payload, dict):
            raise ValueError("input root must be an object")
        out = compute_chemlab(payload)
        print(json.dumps(out, default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
