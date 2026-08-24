# biotech_science/run_score.py
"""Scientific Scoreboard runner: end-to-end scored research mission.

Ties the existing pipeline (hypothesis + verify) to the quality-first scientific
scoreboard. For a target + cancer_type, it:
  1. generates a falsifiable hypothesis
  2. fetches/uses real evidence (ChEMBL/CT.gov when reachable)
  3. computes the reward-function score with all safeguard gates
  4. runs red-team audit + two-key promotion + leaderboard framing
  5. returns a decision-ready record for human scientific oversight

Contract (mirrors run_hypothesis.py):
  python biotech_science/run_score.py session <input.json>
Input:
  { cancer_type, target, knowledge_base?, intent?, cost_usd?, time_days?,
    replication?: {successes, attempts, documented_failures},
    redteam_findings?: [str], expert_signed_off?: bool,
    patient_relevant?: bool }
Output: { score, components, gates, verdict, overclaiming_risk, hypothesis,
         verification, safeguards } ; non-zero exit => {"error": ...}
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
from biotech_science.verify import fetch_target_evidence  # noqa: E402
from biotech_science.science_scoreboard import (  # noqa: E402
    Evidence,
    Precommitment,
    score_result,
    redteam_audit,
    two_key_promotion,
)


def _to_evidence(hypothesis: dict, evidence_payload: dict) -> list:
    """Map hypothesis + real evidence into scoreboard Evidence records."""
    support = max(0.0, min(1.0, hypothesis.get("critic_score", 0.0)))
    ev = [
        Evidence(
            kind="literature",
            source="hypothesis.archetype",
            support=support,
            uncertainty=0.3,
            citation_ok=True,
        )
    ]
    chembl = int(evidence_payload.get("chembl_active_count", 0) or 0)
    has_ct = bool(evidence_payload.get("has_clinical_trials", False))
    if chembl > 0 or has_ct:
        ev.append(Evidence(
            kind="trial" if has_ct else "dataset",
            source="chembl/clinicaltrials",
            support=0.8 if has_ct else 0.6,
            uncertainty=0.2,
            citation_ok=True,
        ))
    else:
        ev.append(Evidence(
            kind="dataset", source="none", support=0.0, uncertainty=0.6, citation_ok=True,
        ))
    # Contradictions from the hypothesis' own skeptic review.
    for flaw in hypothesis.get("flaws", [])[:2]:
        ev.append(Evidence(
            kind="literature", source="skeptic", support=0.2,
            contradicts=True, uncertainty=0.2, citation_ok=True,
        ))
    return ev


def compute_score(payload: dict) -> dict:
    cancer_type = str(payload.get("cancer_type", ""))
    target = str(payload.get("target", ""))
    kb = str(payload.get("knowledge_base", ""))

    hypothesis = generate_hypothesis(cancer_type, target, knowledge_base=kb,
                                     intent=str(payload.get("intent", "")))
    hypothesis = score_hypothesis_against_kb(hypothesis, kb)

    evidence_payload = fetch_target_evidence(target)
    evidence_tier = evidence_payload.get("evidence_tier", "E3")
    evidence = _to_evidence(hypothesis, evidence_payload)

    repl = payload.get("replication", {}) or {}
    rep_success = int(repl.get("successes", 0))
    rep_attempts = int(repl.get("attempts", 0))
    rep_failures = int(repl.get("documented_failures", 0))

    precommit = Precommitment(
        endpoint=str(payload.get("precommit_endpoint", "measurable endpoint")),
        effect_direction=str(payload.get("precommit_direction", "+")),
        effect_size_threshold=float(payload.get("precommit_threshold", 0.1)),
        controls=list(payload.get("precommit_controls", []) or []),
        failure_definition=str(payload.get("precommit_failure", "no effect")),
    )

    result = score_result(
        evidence=evidence,
        claimed_confidence=float(hypothesis.get("confidence", 0.5)),
        precommitment=precommit,
        prediction_matched=bool(payload.get("prediction_matched", False)),
        replication_successes=rep_success,
        replication_attempts=rep_attempts,
        documented_failures=rep_failures,
        actionable=True,
        evidence_tier=evidence_tier,
        patient_relevant=bool(payload.get("patient_relevant", True)),
        cost_usd=float(payload.get("cost_usd", 0.0)),
        time_days=float(payload.get("time_days", 0.0)),
        redteam_passed=bool(payload.get("redteam_passed", False)),
        expert_signed_off=bool(payload.get("expert_signed_off", False)),
    )

    # Safeguards
    findings = list(payload.get("redteam_findings", []) or [])
    audit = redteam_audit(result, findings)
    proposer = {"verification_score": float(payload.get("proposer_score", result.score))}
    reproducer = {
        "verification_score": float(payload.get("reproducer_score", 0.0)),
        "independent": True,
    }
    promotion = two_key_promotion(proposer, reproducer)

    return {
        "score": round(result.score, 4),
        "components": result.components,
        "gates": {k: v.value for k, v in result.gates.items()},
        "verdict": result.verdict,
        "overclaiming_risk": round(result.overclaiming_risk, 4),
        "hypothesis": {
            "target": hypothesis["target"],
            "domain": hypothesis["domain"],
            "modality": hypothesis["modality"],
            "mechanism": hypothesis["mechanism"],
            "testable_prediction": hypothesis["testable_prediction"],
            "confidence": hypothesis["confidence"],
            "flaws": hypothesis["flaws"],
            "critic_score": hypothesis["critic_score"],
        },
        "verification": {
            "evidence_tier": evidence_tier,
            "chembl_active_count": int(evidence_payload.get("chembl_active_count", 0)),
            "has_clinical_trials": bool(evidence_payload.get("has_clinical_trials", False)),
            "precommitment_hash": precommit.hash,
        },
        "safeguards": {
            "redteam": audit,
            "two_key_promotion": promotion,
            "expert_signoff_required_for_action": True,
        },
    }


def _main() -> int:
    parser = argparse.ArgumentParser(description="Scientific scoreboard runner")
    parser.add_argument("session", help="session id (ignored, contract compat)")
    parser.add_argument("input", help="path to input JSON")
    args = parser.parse_args()
    try:
        if not Path(args.input).exists():
            raise ValueError(f"input not found: {args.input}")
        payload = json.loads(Path(args.input).read_text(encoding="utf-8-sig"))
        if not isinstance(payload, dict):
            raise ValueError("input root must be an object")
        out = compute_score(payload)
        print(json.dumps(out, default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, default=str))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
