# biotech_science/test_science_scoreboard.py
"""Tests for the scientific scoreboard gamification.
Run: python -m pytest biotech_science/test_science_scoreboard.py -q
"""
import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import pytest

from biotech_science.science_scoreboard import (
    Evidence,
    Precommitment,
    score_result,
    redteam_audit,
    two_key_promotion,
    leaderboard_safe,
    compute_overclaiming_risk,
    GateStatus,
)


def ev(which):
    base = [
        Evidence(kind="literature", source="A", support=0.9, citation_ok=True),
        Evidence(kind="dataset", source="B", support=0.85, citation_ok=True),
    ]
    return base if which == "good" else [
        Evidence(kind="literature", source="A", support=0.9, citation_ok=False),  # bad citation
        Evidence(kind="dataset", source="B", support=0.3, contradicts=True),      # contradiction
        Evidence(kind="trial", source="C", support=0.1, uncertainty=0.8),         # weak + uncertain
    ]


def test_overclaiming_penalizes_confidence_without_evidence():
    # Claim 0.95 with weak evidence -> high overclaiming risk.
    high = compute_overclaiming_risk(0.95, 0.3, contradiction_count=2, uncertainty_mean=0.5,
                                     has_external_replication=False, has_redteam_pass=False)
    low = compute_overclaiming_risk(0.5, 0.5, contradiction_count=0, uncertainty_mean=0.1,
                                    has_external_replication=True, has_redteam_pass=True)
    assert high > low
    assert high > 0.5
    assert low < 0.4


def test_good_result_scores_higher_than_bad():
    good = score_result(
        evidence=ev("good"), claimed_confidence=0.6,
        precommitment=Precommitment("PFS", "+", 0.1, ["stage"], "no effect"),
        prediction_matched=True, replication_successes=2, replication_attempts=2,
        actionable=True, evidence_tier="E1", patient_relevant=True,
        redteam_passed=True, expert_signed_off=True,
    )
    bad = score_result(
        evidence=ev("bad"), claimed_confidence=0.95,
        prediction_matched=False, replication_successes=0, replication_attempts=0,
        actionable=False, evidence_tier="E3", patient_relevant=False,
        redteam_passed=False, expert_signed_off=False,
        cost_usd=800_000, time_days=300,
    )
    assert good.score > bad.score
    assert good.overclaiming_risk < bad.overclaiming_risk
    assert good.verdict.startswith("PROMOTABLE")


def test_negative_results_are_rewarded():
    # A decisive, well-documented failed replication still earns replication credit.
    rep_with_failure = score_result(
        evidence=ev("good"), claimed_confidence=0.5,
        replication_successes=1, replication_attempts=3, documented_failures=2,
    )
    rep_no_attempt = score_result(
        evidence=ev("good"), claimed_confidence=0.5,
        replication_successes=0, replication_attempts=0,
    )
    assert rep_with_failure.score > rep_no_attempt.score
    # The replication COMPONENT (0..1) caps negative-result credit so fabricating
    # many cheap failures can't inflate it beyond 1.
    assert rep_with_failure.components["independent_replication"] <= 1.0


def test_gates_track_safeguards():
    res = score_result(evidence=ev("good"), claimed_confidence=0.5, redteam_passed=False,
                       precommitment=None, expert_signed_off=False)
    assert res.gates["precommitment"] == GateStatus.FAILED
    assert res.gates["redteam_verifier"] == GateStatus.PENDING
    assert res.gates["expert_signoff"] == GateStatus.PENDING


def test_redteam_audit_blocks_leakage():
    res = score_result(evidence=ev("good"), claimed_confidence=0.7, redteam_passed=True)
    audit = redteam_audit(res, ["Possible train/test data leakage in cohort split",
                                "minor phrasing issue"])
    assert audit["passed"] is False
    assert len(audit["serious_findings"]) == 1
    assert "leakage" in audit["serious_findings"][0].lower()


def test_two_key_promotion_requires_both():
    proposer = {"verification_score": 0.9}
    weak_repro = {"verification_score": 0.2, "independent": True}
    strong_repro = {"verification_score": 0.8, "independent": True}
    non_independent = {"verification_score": 0.9, "independent": False}
    assert two_key_promotion(proposer, strong_repro)["promoted"] is True
    assert two_key_promotion(proposer, weak_repro)["promoted"] is False
    assert two_key_promotion(proposer, non_independent)["promoted"] is False


def test_leaderboard_is_capped_and_has_team_bonus():
    # Clustered scores get less diversity bonus than spread-out ones.
    clustered = leaderboard_safe([0.5, 0.5, 0.51, 0.49], team_bonus=0.1, diversity_bonus=0.05)
    spread = leaderboard_safe([0.1, 0.9, 0.5, 0.6], team_bonus=0.1, diversity_bonus=0.05)
    assert clustered["diversity_spread"] < spread["diversity_spread"]
    assert all(s <= 5.0 for s in clustered["bounded_scores"])
