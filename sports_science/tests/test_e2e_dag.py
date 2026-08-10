# sports_science/tests/test_e2e_dag.py
import asyncio
import json
from sports_science.skill_bridge import make_agent_executor


def test_full_statcrew_to_coach_dag(tmp_path):
    sample = tmp_path / "sample.json"
    sample.write_text(json.dumps({
        "sport": "boxing",
        "performance": {"fg": 70.0, "tp": 80.0, "ast": 60.0, "oreb": 50.0, "tov": -40.0, "pf": -30.0,
                        "defensive_attention": 0.7, "court_spacing": 0.6},
        "biometrics": {"hrv": 52.0, "load": 0.85, "acute_chronic": 1.3, "sleep_hrs": 5.5},
    }))

    stat_crew = make_agent_executor("stat_crew", "boxing")
    coach = make_agent_executor("coach", "boxing")
    ctx = type("Ctx", (), {"experiment_id": "exp_e2e"})()

    # Step 1: stat_crew produces metrics (mimics LabDirector task t1 completion)
    metrics_result = asyncio.run(stat_crew({"dataset": str(sample)}, ctx))
    assert metrics_result["evidence_tier"] == "E1"
    assert metrics_result["data"]["injury_risk"] > 0.0  # poor HRV + high load raises risk above zero
    assert "recovery_priority" in metrics_result["data"]

    # Step 2: LabDirector merges t1's metrics into coach inputs as upstream_results
    plan = asyncio.run(coach({
        "upstream_results": {"t1": metrics_result["data"]},
    }, ctx))
    assert plan["success"] is True
    assert plan["data"]["recovery"]  # non-empty recovery play
    assert plan["data"]["ter"] == metrics_result["data"]["ter"]
