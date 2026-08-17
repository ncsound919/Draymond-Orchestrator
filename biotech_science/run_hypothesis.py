# biotech_science/run_hypothesis.py
"""CLI runner: target + cancer_type -> BlackMind hypothesis + skeptic review.

Contract:
  python biotech_science/run_hypothesis.py session <input.json>
Input:
  { "cancer_type": str, "target": str, "knowledge_base"?: str, "intent"?: str }
Output: { target, domain, modality, mechanism, ..., flaws, critic_score } with
NO inner evidence_tier (stripped at the TS boundary). Non-zero exit =>
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

from biotech_science.hypothesis import generate_hypothesis, score_hypothesis_against_kb  # noqa: E402


def compute_hypothesis(payload: dict) -> dict:
    hypothesis = generate_hypothesis(
        cancer_type=str(payload.get("cancer_type", "")),
        target=str(payload.get("target", "")),
        knowledge_base=str(payload.get("knowledge_base", "")),
        intent=str(payload.get("intent", "")),
    )
    hypothesis = score_hypothesis_against_kb(hypothesis, str(payload.get("knowledge_base", "")))
    # Drop the inner evidence_tier (stripped at the TS boundary; the executor
    # supplies the tier). Mirrors run_translate.py.
    hypothesis.pop("evidence_tier", None)
    return hypothesis


def _main() -> int:
    parser = argparse.ArgumentParser(description="BlackMind hypothesis runner")
    parser.add_argument("session", help="session id (ignored, for contract compatibility)")
    parser.add_argument("input", help="path to hypothesis input JSON")
    args = parser.parse_args()
    try:
        if not Path(args.input).exists():
            raise ValueError(f"input not found: {args.input}")
        payload = json.loads(Path(args.input).read_text(encoding="utf-8-sig"))
        if not isinstance(payload, dict):
            raise ValueError("input root must be an object")
        out = compute_hypothesis(payload)
        print(json.dumps(out, default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
