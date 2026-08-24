"""Tests for the agent eval harness (Albada Ch9/Ch11 + Oshin Ch10 ports).
Run: python tests/test_agent_eval.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from biotech_science.agent_eval import (  # noqa: E402
    parse_eval_case, tool_metrics, param_accuracy, phrase_recall,
    evaluate_memory_retrieval, numeric_field_checks, evaluate_single_instance,
    evaluate_eval_set, consistency_check, detect_regressions,
    VariantSelector, llm_judge_metric,
)

passed = 0
failed = 0


def check(cond, msg):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok - {msg}")
    else:
        failed += 1
        print(f"  FAIL - {msg}")


EVAL_CASE = {
    "input": {"cohort": "BRCA", "task": "deconvolve"},
    "expected": {
        "final_state": {
            "tool_calls": [
                {"tool": "epic_deconvolve", "params": {"cohort": "BRCA"}},
                {"tool": "ssgsea", "params": {"signature": "Immune"}},
            ],
            "msg_contains": ["cd8 t cells", "completed"],
            "numeric_fields": {"epic.CD8 T cells": [0.0, 1.0]},
        }
    },
}


def fake_agent_good(case_input):
    return {
        "tool_calls": [
            {"tool": "epic_deconvolve", "params": {"cohort": "BRCA"}},
            {"tool": "ssgsea", "params": {"signature": "Immune"}},
        ],
        "final_message": "Deconvolution completed. CD8 T cells fraction reported.",
        "output": {"epic": {"CD8 T cells": 0.24}},
    }


def fake_agent_bad(case_input):
    return {
        "tool_calls": [{"tool": "epic_deconvolve", "params": {"cohort": "WRONG"}}],
        "final_message": "done",
        "output": {"epic": {"CD8 T cells": 7.7}},
    }


def test_schema():
    print("agent_eval.schema:")
    case = parse_eval_case('{"input": 1, "expected": {}}')
    check(case is not None, "valid JSON case parses")
    check(parse_eval_case("") is None, "empty raw -> None")
    check(parse_eval_case("not json") is None, "invalid JSON -> None")
    check(parse_eval_case('{"input": 1}') is None, "missing expected -> None")
    check(parse_eval_case(EVAL_CASE) is not None, "dict case parses")


def test_planning_metrics():
    print("agent_eval.planning (faithful Albada formulas):")
    exp_calls = EVAL_CASE["expected"]["final_state"]["tool_calls"]
    m = tool_metrics(["epic_deconvolve", "ssgsea"], exp_calls)
    check(m["tool_recall"] == 1.0 and m["tool_precision"] == 1.0, "perfect recall+precision")
    m2 = tool_metrics(["epic_deconvolve", "extra_tool"], exp_calls)
    check(m2["tool_recall"] == 0.5, "recall 0.5 when one expected tool missing")
    check(abs(m2["tool_precision"] - 0.5) < 1e-9, "precision 0.5 with one spurious tool")
    m3 = tool_metrics([], exp_calls)
    check(m3["tool_precision"] == 0.0, "precision 0 with no predicted tools")
    check(param_accuracy([], exp_calls) == 0.0, "param accuracy 0 when no calls")
    good = fake_agent_good({})["tool_calls"]
    check(param_accuracy(good, exp_calls) == 1.0, "param accuracy 1.0 on exact match")
    check(phrase_recall("Deconvolution completed. CD8 T cells ok",
                        ["cd8 t cells", "completed"]) == 1.0, "phrase recall 1.0 (case-insensitive)")
    check(phrase_recall("done", ["cd8 t cells"]) == 0.0, "phrase recall 0 when missing")


def test_memory():
    print("agent_eval.memory (faithful evaluate_memory_retrieval):")
    def retrieve_fn(query, k):
        return {"q1": ["a", "b"], "q2": ["x"], "q3": ["c"]} [query][:k]
    r = evaluate_memory_retrieval(retrieve_fn, ["q1", "q2", "q3"],
                                  [["a"], ["b"], ["c"]], top_k=1)
    check(abs(r["retrieval_accuracy@1"] - 2 / 3) < 1e-9, "accuracy@1 = 2/3 (q2 miss)")
    r2 = evaluate_memory_retrieval(retrieve_fn, ["q1", "q2", "q3"],
                                   [["a"], ["b"], ["c"]], top_k=2)
    check(abs(r2["retrieval_accuracy@2"] - 2 / 3) < 1e-9, "accuracy@2 still 2/3 (b not in q2)")


def test_numeric_and_holistic():
    print("agent_eval.holistic:")
    nf = numeric_field_checks({"epic": {"CD8 T cells": 0.24}},
                              {"epic.CD8 T cells": [0.0, 1.0]})
    check(nf["all_within"], "numeric range pass")
    nf2 = numeric_field_checks({"epic": {"CD8 T cells": 7.7}},
                               {"epic.CD8 T cells": [0.0, 1.0]})
    check(not nf2["all_within"], "numeric range fail on out-of-range value")
    nf3 = numeric_field_checks({}, {"missing.path": [0, 1]})
    check(not nf3["all_within"], "missing path fails honestly")

    good = evaluate_single_instance(EVAL_CASE, fake_agent_good({}))
    check(good is not None, "good run evaluated")
    check(good["task_success"] == 1.0, "good run task_success = 1.0")
    bad = evaluate_single_instance(EVAL_CASE, fake_agent_bad({}))
    check(bad["task_success"] == 0.0, "bad run task_success = 0.0 (wrong tool params, missing phrase, out-of-range)")
    check(evaluate_single_instance(None, {}) is None, "None case -> None")


def test_eval_set_and_regression():
    print("agent_eval.eval_set + regression:")
    res = evaluate_eval_set([EVAL_CASE, EVAL_CASE], fake_agent_good)
    check(res["n_cases"] == 2, "2 cases run")
    check(res["mean_metrics"]["task_success"] == 1.0, "aggregate success 1.0")
    base = res["mean_metrics"]
    worse = evaluate_eval_set([EVAL_CASE, EVAL_CASE], fake_agent_bad)
    reg = detect_regressions(base, worse["mean_metrics"])
    check(not reg["clean"], "regression detected vs baseline")
    check("task_success" in reg["regressed"], "task_success flagged")
    ok = detect_regressions(base, base)
    check(ok["clean"], "identical metrics -> clean")
    tiny = detect_regressions({"m": 1.0}, {"m": 0.99}, tolerance=0.02)
    check(tiny["clean"], "delta within tolerance -> clean")


def test_consistency():
    print("agent_eval.consistency:")
    r = consistency_check(lambda c: {"a": 1}, {"x": 1}, n_runs=3)
    check(r["stable"], "deterministic agent stable across runs")
    counter = {"i": 0}
    def flaky(c):
        counter["i"] += 1
        return {"a": counter["i"]}
    r2 = consistency_check(flaky, {"x": 1}, n_runs=3)
    check(not r2["stable"], "non-deterministic agent flagged unstable")


def test_bandit():
    print("agent_eval.variant_selector (UCB1):")
    sel = VariantSelector(["v1", "v2"])
    # UCB1 warmup: select+update pairs play each arm exactly once.
    played = []
    for _ in range(2):
        v = sel.select()
        played.append(v)
        sel.update(v, 0.5)
    check(set(played) == {"v1", "v2"}, "warmup plays each arm once")
    for _ in range(10):
        v = sel.select()
        sel.update(v, 1.0 if v == "v1" else 0.2)
    stats = sel.stats()
    check(stats["v1"]["mean_reward"] >= 0.9, "v1 mean reward high (incl. 0.5 warmup)")
    check(stats["v1"]["mean_reward"] > stats["v2"]["mean_reward"], "v1 outperforms v2")
    check(stats["v2"]["n"] >= 1, "v2 was explored")
    check(sel.select() == "v1", "UCB1 exploits the better arm")
    try:
        VariantSelector([])
        check(False, "empty variants rejected")
    except ValueError:
        check(True, "empty variants rejected")
    try:
        sel.update("nope", 1.0)
        check(False, "unknown variant update rejected")
    except ValueError:
        check(True, "unknown variant update rejected")


def test_llm_judge():
    print("agent_eval.llm_judge:")
    r = llm_judge_metric(None, "criteria", "text")
    check(r["llm_judge"] is None, "no judge -> honest None")
    r2 = llm_judge_metric(lambda c, t: 0.87, "grounded?", "report text")
    check(r2["llm_judge"] == 0.87, "judge score passed through")
    r3 = llm_judge_metric(lambda c, t: 5.0, "c", "t")
    check(r3["llm_judge"] == 1.0, "score clamped to [0,1]")
    r4 = llm_judge_metric(lambda c, t: 1 / 0, "c", "t")
    check("error" in r4, "judge failure reported honestly")


if __name__ == "__main__":
    test_schema()
    test_planning_metrics()
    test_memory()
    test_numeric_and_holistic()
    test_eval_set_and_regression()
    test_consistency()
    test_bandit()
    test_llm_judge()
    print(f"\n{passed} passed, {failed} failed")
    if failed:
        sys.exit(1)
