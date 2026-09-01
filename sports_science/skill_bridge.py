# sports_science/skill_bridge.py
"""LabDirector agent-executor bridge.

Each executor returns an AgentResult-like shape:
    {"success": bool, "data": dict, "error": str|None, "evidence_tier": str}
Currently executes the deterministic runners directly. A real DCA SkillExecutor
hook is planned for a later milestone when deterministic-brain is wired.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Callable

from sports_science.run_metrics import compute_metrics_from_json
from sports_science.run_coach import build_gameplan


def _metric_result(inputs: dict, ctx: Any) -> dict:
    dataset = inputs.get("dataset", "")
    path = Path(dataset)
    if not path.exists():
        return {"success": False, "data": {}, "error": f"dataset not found: {dataset}", "evidence_tier": "E4"}
    try:
        return {"success": True, "data": compute_metrics_from_json(path), "error": None, "evidence_tier": "E2"}
    except (OSError, ValueError) as e:
        return {"success": False, "data": {}, "error": f"metrics computation failed: {e}", "evidence_tier": "E4"}


def _coach_result(inputs: dict, ctx: Any) -> dict:
    """Build a game plan from upstream stat_crew metrics.

    The LabDirector merges completed upstream task results into downstream
    inputs as `upstream_results` keyed by upstream task id, where each value is
    the upstream AgentResult `.data` (the metrics dict). We prefer an explicit
    `metrics` input, then any upstream metrics dict, then a metrics file path.
    """
    metrics = inputs.get("metrics")
    if metrics is None:
        upstream = inputs.get("upstream_results") or {}
        metrics = next((v for v in upstream.values() if isinstance(v, dict) and "ter" in v), None)
    plan = build_gameplan(sport=inputs.get("sport", "basketball"), metrics_file=metrics)
    return {"success": plan["status"] == "ok", "data": plan, "error": plan.get("message"), "evidence_tier": "E3"}


_EXECUTORS: dict[str, Callable[[dict, Any], dict]] = {
    "stat_crew": _metric_result,
    "coach": _coach_result,
}


class AgentResultProxy(dict):
    """Result object that satisfies both LabDirector and the bridge contract.

    Biotech's LabDirector reads AgentResult attributes (.success, .data,
    .error, .evidence_tier, .logs) off each executor result; the sports bridge
    historically returned a plain dict ({"success", "data", "error",
    "evidence_tier"}). This dict subclass exposes the same keys as attributes,
    so both callers work against the same object.
    """

    def __getattr__(self, name: str):
        if name in self:
            return self[name]
        if name == "logs":
            return []
        raise AttributeError(name)

    def __setattr__(self, name: str, value: Any):
        self[name] = value


def make_agent_executor(skill: str, sport: str = "basketball") -> Callable[[dict, Any], Any]:
    """Return an async function matching LabDirector's agent_executor[agent] signature."""
    fn = _EXECUTORS[skill]

    async def executor(inputs: dict, context: Any) -> dict:
        enriched = dict(inputs)
        enriched.setdefault("sport", sport)
        result = await asyncio.to_thread(fn, enriched, context)
        return AgentResultProxy(result)

    return executor
