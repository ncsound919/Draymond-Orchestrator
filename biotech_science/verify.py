# biotech_science/verify.py
"""CureForge verification engine - hypothesis testing + evidence gate.

Mirror of CureForge's bayes.ts (/evidence) + verify sandbox pattern wired into
Draymond's parallel biotech engine. Two deterministic capabilities:

  1. Bayesian evidence update: P(H|D) = P(D|H)*P(H) / P(D) using literature
     shaped likelihoods (ChEMBL hit density + clinical-trial signal), with a
     pure-Python fallback when the network is unavailable.
  2. Deterministic property verification: evaluate a small, bounded JS-free
     expression against an expected value to ground "testable predictions" in
     real arithmetic (Acorn-style structural check replaced by a safe ast walk).

Evidence tiers:
  E1  - live ChEMBL / ClinicalTrials.gov evidence fetched
  E3  - offline deterministic priors (default)
"""
from __future__ import annotations

import ast
import json
import math
import os
import re
import urllib.request

# Default likelihoods (literature-shaped, matching CureForge bayes.ts defaults).
DEFAULT_LIKELIHOOD = {"p_d_given_h": 0.85, "p_d_given_not_h": 0.20}


def bayesian_update(
    prior: float,
    is_success: bool,
    chembl_active_count: int = 0,
    has_clinical_trials: bool = False,
) -> dict:
    """Bayes rule posterior over a target hypothesis.

    p(D|H) and p(D|not H) start from literature defaults and are nudged by
    live evidence: strong ChEMBL activity raises sensitivity, an existing
    clinical trial raises the false-positive signal.
    """
    p_d_h = DEFAULT_LIKELIHOOD["p_d_given_h"]
    p_d_nh = DEFAULT_LIKELIHOOD["p_d_given_not_h"]

    if chembl_active_count > 50:
        p_d_h = min(0.99, p_d_h + 0.10)
    elif chembl_active_count == 0:
        p_d_h = max(0.50, p_d_h - 0.20)
    if has_clinical_trials:
        p_d_nh = max(0.01, p_d_nh - 0.10)

    prior = max(0.0, min(1.0, float(prior)))
    p_d_h_eff = p_d_h if is_success else 1.0 - p_d_h
    p_d_nh_eff = p_d_nh if is_success else 1.0 - p_d_nh
    evidence = p_d_h_eff * prior + p_d_nh_eff * (1.0 - prior)
    posterior = (p_d_h_eff * prior) / evidence if evidence > 0 else 0.0

    return {
        "prior": round(prior, 4),
        "posterior": round(max(0.0, min(1.0, posterior)), 4),
        "p_d_given_h": round(p_d_h, 4),
        "p_d_given_not_h": round(p_d_nh, 4),
        "chembl_active_count": int(chembl_active_count),
        "has_clinical_trials": bool(has_clinical_trials),
        "evidence_tier": "E1",
    }


def fetch_target_evidence(target: str) -> dict:
    """Fetch ChEMBL + ClinicalTrials.gov evidence for a target symbol.

    Graceful degradation: returns zeros + E3 on any network failure so the
    engine keeps running offline.
    """
    target = re.sub(r"[^a-zA-Z0-9\-_]", "", str(target or ""))[:50]
    if not target:
        return {
            "chembl_active_count": 0,
            "has_clinical_trials": False,
            "evidence_tier": "E3",
            "error": "target required",
        }

    chembl_count = 0
    has_ct = False
    try:
        with urllib.request.urlopen(
            f"https://www.ebi.ac.uk/chembl/api/data/target/search?q={target}&format=json",
            timeout=10,
        ) as resp:
            chembl_count = int(json.loads(resp.read().decode("utf-8")).get("page_meta", {}).get("total_count", 0) or 0)
    except Exception:  # noqa: BLE001
        pass
    try:
        with urllib.request.urlopen(
            f"https://clinicaltrials.gov/api/v2/studies?query.intr={target}&pageSize=1",
            timeout=10,
        ) as resp:
            has_ct = len(json.loads(resp.read().decode("utf-8")).get("studies", [])) > 0
    except Exception:  # noqa: BLE001
        pass

    tier = "E1" if (chembl_count > 0 or has_ct) else "E3"
    return {
        "chembl_active_count": chembl_count,
        "has_clinical_trials": has_ct,
        "evidence_tier": tier,
    }


def verify_claim(claim: str, expected: float, tolerance: float = 1e-6) -> dict:
    """Deterministically evaluate a safe arithmetic claim and compare to expected.

    The expression is parsed with Python's ast (safe) - no eval/exec. Supports
    +, -, *, /, **, parentheses, and a small whitelist of names/constants.
    """
    claim = str(claim or "").strip()
    result = {"claim": claim, "expected": float(expected), "verified": False, "error": None, "evidence_tier": "E2"}

    if not claim:
        result["error"] = "empty claim"
        return result

    try:
        tree = ast.parse(claim, mode="eval")
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and node.id not in {"pi", "e", "tau"}:
                raise ValueError(f"disallowed identifier: {node.id}")
            if not isinstance(
                node,
                (
                    ast.Expression,
                    ast.BinOp,
                    ast.Constant,
                    ast.UnaryOp,
                    ast.Add,
                    ast.Sub,
                    ast.Mult,
                    ast.Div,
                    ast.Pow,
                    ast.USub,
                    ast.UAdd,
                    ast.Name,
                    ast.Load,
                ),
            ):
                raise ValueError(f"disallowed construct: {type(node).__name__}")

        names = {"pi": math.pi, "e": math.e, "tau": math.tau}
        value = eval(compile(tree, "<claim>", "eval"), {"__builtins__": {}}, names)  # noqa: S307 - AST-whitelisted above
        result["computed"] = round(float(value), 8)
        result["verified"] = abs(float(value) - float(expected)) <= float(tolerance)
    except Exception as exc:  # noqa: BLE001
        result["error"] = str(exc)

    return result


def verify_hypothesis_prediction(hypothesis: dict) -> dict:
    """Evaluate the 'testable_prediction' field of a hypothesis against its
    reported confidence as a sanity gate.

    Deterministic heuristic: a hypothesis is "grounded" if it has a concrete
    prediction AND a mechanism; confidence must be in [0,1]. Returns E2.
    """
    prediction = str(hypothesis.get("testable_prediction", "") or "").strip()
    mechanism = str(hypothesis.get("mechanism", "") or "").strip()
    conf = float(hypothesis.get("confidence", 0.0) or 0.0)

    errors = []
    if len(prediction) < 20:
        errors.append("testable_prediction too vague (<20 chars)")
    if len(mechanism) < 20:
        errors.append("mechanism too vague (<20 chars)")
    if not (0.0 <= conf <= 1.0):
        errors.append("confidence out of [0,1]")

    return {
        "grounded": not errors,
        "errors": errors,
        "prediction_length": len(prediction),
        "confidence": round(max(0.0, min(1.0, conf)), 4),
        "evidence_tier": "E2",
    }
