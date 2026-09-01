# sports_science/tests/test_skill_bridge.py
import asyncio
from sports_science.skill_bridge import make_agent_executor


def test_executor_returns_agentresult_like_shape():
    executor = make_agent_executor(skill="stat_crew", sport="basketball")
    inputs = {"dataset": "path/not/exist.json"}
    ctx = type("Ctx", (), {"experiment_id": "exp_test"})()
    out = asyncio.run(executor(inputs, ctx))
    assert out["success"] is False
    assert out["evidence_tier"] == "E4"
    assert out["error"]  # missing dataset surfaces as an error, not a false success
    # LabDirector reads AgentResult attributes, not just dict keys
    assert out.success is False
    assert out.evidence_tier == "E4"
    assert out.logs == []


def test_coach_consumes_upstream_metrics_dict():
    executor = make_agent_executor(skill="coach", sport="boxing")
    inputs = {
        "upstream_results": {
            "t1": {"ter": 15.0, "gravity": 0.4, "recovery_priority": "elevated"},
        }
    }
    ctx = type("Ctx", (), {"experiment_id": "exp_test"})()
    out = asyncio.run(executor(inputs, ctx))
    assert out["success"] is True
    assert out["data"]["ter"] == 15.0
    assert out["data"]["recovery"]  # non-empty recovery play for "elevated"
    assert out["data"]["focus"] == "increase spacing pressure"  # gravity 0.4 < 0.5


def test_coach_without_metrics_returns_error():
    executor = make_agent_executor(skill="coach", sport="basketball")
    inputs = {}
    ctx = type("Ctx", (), {"experiment_id": "exp_test"})()
    out = asyncio.run(executor(inputs, ctx))
    assert out["success"] is False
    assert out["error"] == "metrics required"
