"""Agent evaluation harness - grounded in:

- Albada, "Building Applications with AI Agents" (O'Reilly 2025), Ch9
  (Validation and Measurement): structured eval sets, tool recall/precision,
  parameter accuracy, memory retrieval accuracy@k, consistency, holistic
  task-success aggregation; Ch11 (Improvement Loops): shadow/A/B/bandits.
- Oshin, "Learning LangChain" (O'Reilly 2025), Ch10 (Testing): heuristic
  evaluators first, then LLM-as-judge; golden datasets; regression testing.

Faithful ports of the book's metric formulas (tool_metrics, param_accuracy,
evaluate_memory_retrieval) plus an eval-set schema, regression detection, and
a deterministic UCB1/epsilon-greedy variant selector for improvement loops.

Honest: heuristics only measure what they state; LLM-as-judge is a pluggable
callable and is never faked.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

# ---------------------------------------------------------------------------
# Eval-set schema (Albada Ch9: input state + expected final state)
# ---------------------------------------------------------------------------


def parse_eval_case(raw: str) -> Optional[dict]:
    """Parse one eval case: {"input": ..., "expected": {...}}.

    Expected keys (all optional):
      tool_calls: [{tool, params}] - planner expectations
      msg_contains: [str]         - phrases required in the final message
      numeric_fields: {path: [lo, hi]} - numeric output range checks
      retrieval: {queries: [...], expected: [[items]], top_k: int}
    """
    if not raw:
        return None
    if isinstance(raw, str) and not raw.strip():
        return None
    try:
        ex = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(ex, dict) or "expected" not in ex:
        return None
    return ex


# ---------------------------------------------------------------------------
# Planning metrics - faithful ports of Albada Ch9 p.232-233
# ---------------------------------------------------------------------------


def tool_metrics(pred_tools: List[str], expected_calls: List[dict]) -> dict:
    """Tool recall + precision vs expected tool invocations (faithful port)."""
    expected_names = [c.get("tool") for c in expected_calls]
    if not expected_names:
        return {"tool_recall": 1.0, "tool_precision": 1.0}
    pred_set = set(pred_tools)
    exp_set = set(expected_names)
    tp = len(exp_set & pred_set)
    recall = tp / len(exp_set)
    precision = tp / len(pred_set) if pred_set else 0.0
    return {"tool_recall": recall, "tool_precision": precision}


def param_accuracy(pred_calls: List[dict], expected_calls: List[dict]) -> float:
    """Fraction of expected calls matched exactly (tool + params) - faithful port."""
    if not expected_calls:
        return 1.0
    matched = 0
    for exp in expected_calls:
        for pred in pred_calls:
            if pred.get("tool") == exp.get("tool") and pred.get("params") == exp.get("params"):
                matched += 1
                break
    return matched / len(expected_calls)


def phrase_recall(final_message: str, expected_phrases: List[str]) -> float:
    """Fraction of required phrases present in the final message (Albada)."""
    if not expected_phrases:
        return 1.0
    msg = (final_message or "").lower()
    hits = sum(1 for p in expected_phrases if p.lower() in msg)
    return hits / len(expected_phrases)


# ---------------------------------------------------------------------------
# Memory metrics - faithful port of Albada Ch9 evaluate_memory_retrieval
# ---------------------------------------------------------------------------


def evaluate_memory_retrieval(
    retrieve_fn: Callable[..., List[Any]],
    queries: List[str],
    expected_results: List[List[Any]],
    top_k: int = 1,
) -> Dict[str, float]:
    """retrieval_accuracy@k: fraction of queries with >=1 expected item in top-k."""
    hits = 0
    for query, expect in zip(queries, expected_results):
        results = retrieve_fn(query, top_k)
        if set(results) & set(expect):
            hits += 1
    accuracy = hits / len(queries) if queries else 1.0
    return {f"retrieval_accuracy@{top_k}": accuracy}


# ---------------------------------------------------------------------------
# Numeric output range checks (scientific-output grounding)
# ---------------------------------------------------------------------------


def numeric_field_checks(output: dict, numeric_fields: Dict[str, List[float]]) -> dict:
    """Verify numeric output fields fall within expected [lo, hi] ranges.

    Path syntax: dotted keys, e.g. "summary.c_index" or "epic.CD8 T cells".
    Returns {path: pass_bool} plus all_within.
    """
    results = {}
    for path, (lo, hi) in numeric_fields.items():
        node: Any = output
        ok = True
        for key in path.split("."):
            if isinstance(node, dict) and key in node:
                node = node[key]
            else:
                ok = False
                break
        if ok:
            try:
                val = float(node)
                ok = lo <= val <= hi
            except (TypeError, ValueError):
                ok = False
        results[path] = ok
    return {"fields": results, "all_within": all(results.values()) if results else True}


# ---------------------------------------------------------------------------
# Holistic evaluation - Albada Ch9 evaluate_single_instance pattern
# ---------------------------------------------------------------------------


def evaluate_single_instance(case: dict, agent_output: dict) -> Optional[Dict[str, float]]:
    """Score one agent run against one eval case.

    agent_output: {"tool_calls": [{tool, params}], "final_message": str,
                   "output": <full structured output dict>}
    Returns metrics dict with task_success aggregate, or None for bad case.
    """
    if case is None:
        return None
    expected = case.get("expected", {}).get("final_state", case.get("expected", {}))
    exp_calls = expected.get("tool_calls", [])
    exp_phrases = expected.get("msg_contains", [])
    pred_calls = agent_output.get("tool_calls", [])
    final_msg = agent_output.get("final_message", "")

    metrics: Dict[str, float] = {}
    metrics.update(tool_metrics([c.get("tool") for c in pred_calls], exp_calls))
    metrics["param_accuracy"] = param_accuracy(pred_calls, exp_calls)
    metrics["phrase_recall"] = phrase_recall(final_msg, exp_phrases)

    num_spec = expected.get("numeric_fields") or {}
    if num_spec:
        nf = numeric_field_checks(agent_output.get("output", {}), num_spec)
        metrics["numeric_fields_pass"] = 1.0 if nf["all_within"] else 0.0

    metrics["task_success"] = (
        metrics["tool_recall"] * metrics["tool_precision"]
        * metrics["param_accuracy"] * metrics["phrase_recall"]
    )
    if num_spec:
        metrics["task_success"] *= metrics["numeric_fields_pass"]
    return metrics


def evaluate_eval_set(cases: List[dict], run_agent: Callable[[dict], dict]) -> dict:
    """Run the agent over the eval set; aggregate mean metrics (golden set run)."""
    per_case = []
    agg: Dict[str, float] = {}
    for case in cases:
        out = run_agent(case.get("input", case))
        m = evaluate_single_instance(case, out)
        if m is None:
            continue
        per_case.append(m)
        for k, v in m.items():
            agg[k] = agg.get(k, 0.0) + v
    n = len(per_case)
    summary = {k: round(v / n, 4) for k, v in agg.items()} if n else {}
    return {"pipeline": "agent-eval-set", "schema_version": "1.0.0",
            "n_cases": n, "mean_metrics": summary, "per_case": per_case}


# ---------------------------------------------------------------------------
# Consistency (Albada Ch9): deterministic scenarios -> same output
# ---------------------------------------------------------------------------


def consistency_check(run_agent: Callable[[dict], dict], case_input: dict,
                      n_runs: int = 3) -> dict:
    """Re-run the same deterministic scenario; report output stability."""
    outputs = [json.dumps(run_agent(case_input), sort_keys=True, default=str) for _ in range(n_runs)]
    stable = len(set(outputs)) == 1
    return {"pipeline": "consistency-check", "schema_version": "1.0.0",
            "n_runs": n_runs, "stable": stable}


# ---------------------------------------------------------------------------
# Regression detection (Albada Ch9 / Oshin Ch10)
# ---------------------------------------------------------------------------


def detect_regressions(baseline: Dict[str, float], current: Dict[str, float],
                       tolerance: float = 0.02) -> dict:
    """Flag metrics that dropped more than `tolerance` vs baseline."""
    regressions = {}
    for metric, base_val in baseline.items():
        cur = current.get(metric)
        if cur is None:
            continue
        if base_val - cur > tolerance:
            regressions[metric] = {"baseline": base_val, "current": cur,
                                   "delta": round(cur - base_val, 4)}
    return {"pipeline": "regression-detect", "schema_version": "1.0.0",
            "tolerance": tolerance, "regressed": regressions,
            "clean": not regressions}


# ---------------------------------------------------------------------------
# Improvement loop variant selector - Albada Ch11 (bandits)
# ---------------------------------------------------------------------------


class VariantSelector:
    """UCB1 bandit over agent variants (deterministic, no RNG).

    Albada Ch11: exploration/exploitation for continuous improvement loops.
    UCB1: pick argmax(mean + c * sqrt(ln t / n_i)).
    """

    def __init__(self, variants: List[str], c: float = 1.414):
        if not variants:
            raise ValueError("need at least one variant")
        self.variants = list(variants)
        self.c = c
        self.n: Dict[str, int] = {v: 0 for v in self.variants}
        self.sum_reward: Dict[str, float] = {v: 0.0 for v in self.variants}
        self.t = 0

    def select(self) -> str:
        self.t += 1
        # Play each arm once first (UCB1 warmup).
        for v in self.variants:
            if self.n[v] == 0:
                return v
        best, best_score = None, -math.inf
        for v in self.variants:
            mean = self.sum_reward[v] / self.n[v]
            ucb = mean + self.c * math.sqrt(math.log(self.t) / self.n[v])
            if ucb > best_score:
                best, best_score = v, ucb
        return best

    def update(self, variant: str, reward: float) -> None:
        if variant not in self.n:
            raise ValueError(f"unknown variant: {variant}")
        self.n[variant] += 1
        self.sum_reward[variant] += float(reward)

    def stats(self) -> dict:
        return {v: {"n": self.n[v],
                    "mean_reward": round(self.sum_reward[v] / self.n[v], 4) if self.n[v] else None}
                for v in self.variants}


# ---------------------------------------------------------------------------
# LLM-as-judge hook (Oshin Ch10) - pluggable, never faked
# ---------------------------------------------------------------------------


def llm_judge_metric(judge_fn: Optional[Callable[[str, str], float]],
                     criteria: str, output_text: str) -> dict:
    """Apply an external LLM-as-judge; honest None when no judge configured."""
    if judge_fn is None:
        return {"llm_judge": None,
                "note": "no judge_fn configured - heuristic metrics only"}
    try:
        score = float(judge_fn(criteria, output_text))
    except Exception as e:  # noqa: BLE001
        return {"llm_judge": None, "error": f"judge_fn failed: {e}"}
    return {"llm_judge": max(0.0, min(1.0, score))}
