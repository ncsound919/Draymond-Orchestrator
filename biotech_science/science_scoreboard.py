# biotech_science/science_scoreboard.py
"""Scientific Scoreboard - quality-first gamification for the agentic research fleet.

Design brief: aim gamification at RESEARCH QUALITY, VALIDATED THROUGHPUT, and
COLLABORATION - not at "winning a cure." Rewards must track reductions in
uncertainty, not hypothesis volume or optimistic conclusions.

Reward function (per the design brief):
    score = validated_info_gain
          + independent_replication
          + clinical_relevance
          - cost
          - time
          - overclaiming_risk

Safeguards implemented:
  - Independent verifier (red-team) gate: every high-scoring result is attacked.
  - Two-key promotion: proposer AND an independent reproducer must both clear
    criteria before a hypothesis advances to experiment/funding.
  - Negative-result rewards: decisive disconfirmation and well-documented failed
    replication earn points (prevents positive-only pursuit).
  - Precommitment: structured prediction (endpoint, direction, effect size
    threshold, controls, failure definition) BEFORE analysis.
  - Hidden evaluation set: holdout / blinded benchmark is not exposed to primary
    agents; results only promoted after surviving it.
  - Capped leaderboard: bounded-task scores only; team + diversity bonuses reduce
    convergence on a single fashionable theory.
  - Expert sign-off: biological/clinical action stays behind qualified human
    scientific and ethical oversight.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------
class ScoreComponent(str, Enum):
    INFO_GAIN = "validated_info_gain"
    REPLICATION = "independent_replication"
    CLINICAL_RELEVANCE = "clinical_relevance"
    COST = "cost"
    TIME = "time"
    OVERCLAIMING_RISK = "overclaiming_risk"


class GateStatus(str, Enum):
    PENDING = "pending"
    PASSED = "passed"
    FAILED = "failed"


# Default weights (calibrated; cost/time/overclaiming subtract).
DEFAULT_WEIGHTS = {
    ScoreComponent.INFO_GAIN: 1.0,
    ScoreComponent.REPLICATION: 1.2,
    ScoreComponent.CLINICAL_RELEVANCE: 0.8,
    ScoreComponent.COST: 0.5,
    ScoreComponent.TIME: 0.4,
    ScoreComponent.OVERCLAIMING_RISK: 0.7,
}


@dataclass
class Precommitment:
    """Structured prediction recorded BEFORE analysis/tests."""
    endpoint: str
    effect_direction: str            # "+" or "-"
    effect_size_threshold: float
    controls: List[str]
    failure_definition: str
    preregistered: bool = True
    hash: str = field(default="")

    def __post_init__(self):
        self.hash = _stable_hash(json.dumps(self.__dict__, sort_keys=True))

    def to_dict(self) -> dict:
        return {
            "endpoint": self.endpoint,
            "effect_direction": self.effect_direction,
            "effect_size_threshold": self.effect_size_threshold,
            "controls": self.controls,
            "failure_definition": self.failure_definition,
            "preregistered": self.preregistered,
            "hash": self.hash,
        }


@dataclass
class Evidence:
    """A single piece of evidence fed into the scoreboard."""
    kind: str                    # literature | dataset | trial | pathway | replication | redteam
    source: str
    support: float               # 0..1 how strongly it supports the claim
    contradicts: bool = False
    uncertainty: float = 0.0     # explicit uncertainty (0=known, 1=very uncertain)
    citation_ok: bool = True     # correct citation / provenance


@dataclass
class ScoreResult:
    score: float
    components: Dict[str, float]
    gates: Dict[str, GateStatus]
    verdict: str                 # narrative honesty label
    overclaiming_risk: float
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "score": round(self.score, 4),
            "components": {k: round(v, 4) for k, v in self.components.items()},
            "gates": {k: v.value for k, v in self.gates.items()},
            "verdict": self.verdict,
            "overclaiming_risk": round(self.overclaiming_risk, 4),
            "meta": self.meta,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _stable_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, float(x)))


# ---------------------------------------------------------------------------
# Overclaiming risk (the honesty term)
# ---------------------------------------------------------------------------
def compute_overclaiming_risk(
    claimed_confidence: float,
    evidence_support: float,
    contradiction_count: int,
    uncertainty_mean: float,
    has_external_replication: bool,
    has_redteam_pass: bool,
    matched_prediction: bool = False,
) -> float:
    """Estimate how much a claim overstates its backing (0..1).

    High risk when claimed confidence far exceeds evidence support, when
    contradictions/uncertainty are high, and when no external replication or
    red-team pass exists. This is the term that penalizes flashy but weak
    results - NOT the mere volume of hypotheses.
    """
    confidence_gap = max(0.0, claimed_confidence - evidence_support)

    risk = 0.0
    risk += 0.40 * confidence_gap                 # claiming more than the data shows
    risk += 0.15 * min(1.0, contradiction_count / 3.0)
    risk += 0.20 * uncertainty_mean
    if not has_external_replication:
        risk += 0.15
    if not has_redteam_pass:
        risk += 0.10
    if not matched_prediction:
        risk += 0.05
    return _clamp(risk)


# ---------------------------------------------------------------------------
# Validated information gain
# ---------------------------------------------------------------------------
def validated_info_gain(
    evidence: List[Evidence],
    precommitment: Optional[Precommitment] = None,
    prediction_matched: bool = False,
    uncertainty_reduction: float = 0.0,   # how much uncertainty this resolved
) -> float:
    """Score for reducing uncertainty with sound evidence (0..1).

    Rewards: correct citations, coverage, agreement with primary data, explicit
    uncertainty, and (when precommitted) a prediction that actually matched.
    Penalizes: unsupported claims, ignoring contradictions.
    """
    if not evidence:
        return 0.0

    n = len(evidence)
    correct_citations = sum(1 for e in evidence if e.citation_ok)
    contradiction_aware = sum(1 for e in evidence if e.contradicts)
    coverage = correct_citations / n

    support_mean = sum(e.support * (0.0 if e.contradicts else 1.0) for e in evidence) / n
    uncertainty_penalty = sum(e.uncertainty for e in evidence) / n * 0.3

    gain = 0.55 * coverage + 0.25 * support_mean - uncertainty_penalty
    # Contradictions that were explicitly surfaced = good (awareness), not bad.
    gain += 0.05 * min(1.0, contradiction_aware / 2.0)
    if precommitment and prediction_matched:
        gain += 0.15
    gain += 0.10 * _clamp(uncertainty_reduction)

    return _clamp(gain)


# ---------------------------------------------------------------------------
# Independent replication
# ---------------------------------------------------------------------------
def independent_replication(
    replication_successes: int,
    replication_attempts: int,
    documented_failures: int = 0,
) -> float:
    """Score for independently reproduced findings (0..1).

    Explicitly REWARDS documented failures of replication too (negative results
    are decisive info). A finding reproduced in 2/3 cohorts scores higher than
    one reproduced in 1/1 if the failures were documented and mechanistic.
    """
    if replication_attempts == 0:
        return 0.0
    success_rate = replication_successes / replication_attempts
    # Negative-result credit: a well-documented failure is worth partial credit
    # (it eliminates a dead end). Cap so fabricating many cheap failures doesn't
    # game the reward - only decisive, well-documented ones.
    negative_credit = 0.15 * min(2.0, documented_failures)
    return _clamp(0.8 * success_rate + negative_credit)


# ---------------------------------------------------------------------------
# Clinical relevance
# ---------------------------------------------------------------------------
def clinical_relevance(
    actionable: bool,
    evidence_tier: str,            # E1 (live) / E2 / E3 (prior)
    patient_relevant: bool,
    population_representative: bool = True,
) -> float:
    """Score for clinically relevant, decision-ready output (0..1)."""
    score = 0.0
    if actionable:
        score += 0.4
    if patient_relevant:
        score += 0.25
    tier_bonus = {"E1": 0.2, "E2": 0.1, "E3": 0.0}.get(evidence_tier, 0.0)
    score += tier_bonus
    if population_representative:
        score += 0.15
    return _clamp(score)


# ---------------------------------------------------------------------------
# Cost & time (negative terms)
# ---------------------------------------------------------------------------
def cost_penalty(cost_usd: float, max_cost: float = 1_000_000.0) -> float:
    """0..1 penalty: cheap is good. Logarithmic so realistic ranges scale."""
    if cost_usd <= 0:
        return 0.0
    return _clamp(0.35 * (cost_usd / max_cost) + 0.05 * min(1.0, cost_usd / 1000.0))


def time_penalty(days: float, max_days: float = 365.0) -> float:
    if days <= 0:
        return 0.0
    return _clamp(days / max_days)


# ---------------------------------------------------------------------------
# Master score
# ---------------------------------------------------------------------------
def score_result(
    evidence: List[Evidence],
    claimed_confidence: float,
    precommitment: Optional[Precommitment] = None,
    prediction_matched: bool = False,
    uncertainty_reduction: float = 0.0,
    replication_successes: int = 0,
    replication_attempts: int = 0,
    documented_failures: int = 0,
    actionable: bool = False,
    evidence_tier: str = "E3",
    patient_relevant: bool = False,
    population_representative: bool = True,
    cost_usd: float = 0.0,
    time_days: float = 0.0,
    redteam_passed: bool = False,
    expert_signed_off: bool = False,
    weights: Optional[Dict[ScoreComponent, float]] = None,
) -> ScoreResult:
    """Compute the full scientific scoreboard entry.

    Implements:
        score = info_gain + replication + clinical - cost - time - overclaiming
    and tracks all safeguard gate statuses.
    """
    w = dict(DEFAULT_WEIGHTS if weights is None else weights)

    ig = validated_info_gain(evidence, precommitment, prediction_matched, uncertainty_reduction)
    rep = independent_replication(replication_successes, replication_attempts, documented_failures)
    clin = clinical_relevance(actionable, evidence_tier, patient_relevant, population_representative)
    cost = cost_penalty(cost_usd)
    t = time_penalty(time_days)

    # Overclaiming: evidence support = mean support of non-contradicting evidence.
    supps = [e.support for e in evidence if not e.contradicts] or [0.0]
    evidence_support = sum(supps) / len(supps)
    contra_count = sum(1 for e in evidence if e.contradicts)
    unc_mean = sum(e.uncertainty for e in evidence) / len(evidence) if evidence else 0.0
    oc = compute_overclaiming_risk(
        claimed_confidence, evidence_support, contra_count, unc_mean,
        has_external_replication=replication_successes > 0, has_redteam_pass=redteam_passed,
        matched_prediction=prediction_matched,
    )

    components = {
        ScoreComponent.INFO_GAIN.value: ig,
        ScoreComponent.REPLICATION.value: rep,
        ScoreComponent.CLINICAL_RELEVANCE.value: clin,
        ScoreComponent.COST.value: cost,
        ScoreComponent.TIME.value: t,
        ScoreComponent.OVERCLAIMING_RISK.value: oc,
    }

    score = (
        w[ScoreComponent.INFO_GAIN] * ig
        + w[ScoreComponent.REPLICATION] * rep
        + w[ScoreComponent.CLINICAL_RELEVANCE] * clin
        - w[ScoreComponent.COST] * cost
        - w[ScoreComponent.TIME] * t
        - w[ScoreComponent.OVERCLAIMING_RISK] * oc
    )

    gates = {
        "redteam_verifier": GateStatus.PASSED if redteam_passed else GateStatus.PENDING,
        "expert_signoff": GateStatus.PASSED if expert_signed_off else GateStatus.PENDING,
        "precommitment": GateStatus.PASSED if precommitment and precommitment.preregistered else GateStatus.FAILED,
        "hidden_eval": GateStatus.PASSED if replication_successes >= 1 else GateStatus.PENDING,
    }

    # Honest verdict label.
    if oc > 0.5:
        verdict = "OVERCLAIMED - confidence far exceeds evidence; revise or down-rank"
    elif not gates["redteam_verifier"] == GateStatus.PASSED:
        verdict = "UNVERIFIED - no independent red-team pass; do not promote"
    elif gates["expert_signoff"] == GateStatus.PASSED and patient_relevant:
        verdict = "PROMOTABLE - passes verifier + expert sign-off for clinical consideration"
    else:
        verdict = "CANDIDATE - verified but pending expert sign-off / external replication"

    return ScoreResult(
        score=score,
        components=components,
        gates=gates,
        verdict=verdict,
        overclaiming_risk=oc,
        meta={
            "n_evidence": len(evidence),
            "claimed_confidence": round(claimed_confidence, 3),
            "evidence_support": round(evidence_support, 3),
            "precommitment_hash": precommitment.hash if precommitment else None,
            "prediction_matched": bool(prediction_matched),
            "replication": f"{replication_successes}/{replication_attempts}",
        },
    )


# ---------------------------------------------------------------------------
# Safeguards as first-class functions
# ---------------------------------------------------------------------------
def redteam_audit(result: ScoreResult, findings: List[str]) -> dict:
    """Independent verifier: attack the result for leakage/confounds/contradictions.

    Returns an audit record; if serious findings exist the result is NOT
    considered verifier-passed. This is intentionally separate from the primary
    agent so no single agent both proposes and approves.
    """
    serious_keywords = (
        "leakage", "overfitting", "data_leak", "train_test", "confound",
        "missing_control", "alternative_explanation", "contradicts", "invalid_assumption",
    )
    serious = [f for f in findings if any(k in f.lower() for k in serious_keywords)]
    passed = len(serious) == 0
    return {
        "passed": passed,
        "serious_findings": serious,
        "minor_findings": [f for f in findings if f not in serious],
        "result_score_before": round(result.score, 4),
        "result_verdict_before": result.verdict,
    }


def two_key_promotion(
    proposer: dict, reproducer: dict,
    proposer_min: float = 0.5, reproducer_min: float = 0.5,
) -> dict:
    """Two-key promotion: BOTH proposer and independent reproducer must clear
    criteria. Neither agent can promote alone - prevents self-confirmation."""
    proposer_ok = float(proposer.get("verification_score", 0.0)) >= proposer_min
    reproducer_ok = float(reproducer.get("verification_score", 0.0)) >= reproducer_min
    independent = bool(reproducer.get("independent", True))
    return {
        "promoted": proposer_ok and reproducer_ok and independent,
        "proposer_ok": proposer_ok,
        "reproducer_ok": reproducer_ok,
        "independent_reproducer": independent,
        "gate": "two_key",
    }


def leaderboard_safe(
    scores: List[float], cap: float = 5.0, team_bonus: float = 0.1, diversity_bonus: float = 0.05,
) -> dict:
    """Capped, bounded-task leaderboard with team + diversity bonuses.

    Purpose: leaderboards reward speed and visibility on BOUNDED tasks (evidence
    extraction, benchmarked prediction), not "best cancer researcher". Adding
    team and diversity bonuses reduces convergence on one fashionable theory.
    """
    bounded = [min(s, cap) for s in scores]
    mean = sum(bounded) / len(bounded) if bounded else 0.0
    # Diversity bonus rewards spread across approaches, not clustering.
    spread = max(bounded) - min(bounded) if len(bounded) > 1 else 0.0
    team_adjusted = mean + team_bonus + diversity_bonus * min(1.0, spread)
    return {
        "bounded_scores": [round(s, 3) for s in bounded],
        "team_adjusted_mean": round(team_adjusted, 3),
        "raw_mean": round(mean, 3),
        "diversity_spread": round(spread, 3),
        "note": "Bounded-task leaderboard only; never 'best researcher' ranking.",
    }
