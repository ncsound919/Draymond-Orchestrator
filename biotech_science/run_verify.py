# biotech_science/run_verify.py
"""CLI runner: target hypothesis -> CureForge Bayesian evidence + prediction check.

Contract:
  python biotech_science/run_verify.py session <input.json>
Input:
  { "target": str, "prior": number, "is_success"?: bool, "claim"?: str,
    "expected"?: number, "hypothesis"?: {...} }
Output: { prior, posterior, p_d_given_h, ..., verification?, prediction_gate? }
with NO inner evidence_tier (stripped at the TS boundary). Non-zero exit =>
{"error": ...} on stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from biotech_science.verify import (  # noqa: E402
    bayesian_update,
    fetch_target_evidence,
    verify_claim,
    verify_hypothesis_prediction,
)


def compute_verification(payload: dict) -> dict:
    target = str(payload.get("target", ""))
    prior = float(payload.get("prior", 0.5) or 0.5)
    is_success = bool(payload.get("is_success", True))

    evidence = fetch_target_evidence(target)
    out = bayesian_update(
        prior,
        is_success,
        chembl_active_count=evidence["chembl_active_count"],
        has_clinical_trials=evidence["has_clinical_trials"],
    )
    out["target"] = target

    claim = str(payload.get("claim", "") or "").strip()
    if claim:
        expected = payload.get("expected")
        if expected is None:
            raise ValueError("expected is required when claim is provided")
        out["verification"] = verify_claim(claim, float(expected))

    hypothesis = payload.get("hypothesis")
    if isinstance(hypothesis, dict):
        out["prediction_gate"] = verify_hypothesis_prediction(hypothesis)

    # Drop the top-level inner evidence_tier (stripped at the TS boundary; the
    # executor supplies the tier). Mirrors run_translate.py.
    out.pop("evidence_tier", None)
    return out


def _main() -> int:
    parser = argparse.ArgumentParser(description="CureForge verification runner")
    parser.add_argument("session", help="session id (ignored, for contract compatibility)")
    parser.add_argument("input", help="path to verification input JSON")
    args = parser.parse_args()
    try:
        if not Path(args.input).exists():
            raise ValueError(f"input not found: {args.input}")
        payload = json.loads(Path(args.input).read_text(encoding="utf-8-sig"))
        if not isinstance(payload, dict):
            raise ValueError("input root must be an object")
        out = compute_verification(payload)
        print(json.dumps(out, default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
