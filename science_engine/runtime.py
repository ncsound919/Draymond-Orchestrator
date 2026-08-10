# science_engine/runtime.py
"""Deterministic ticked state-machine simulation runtime.

Loads a JSON model declaring state variables, parameters, sympy-parsed update
rules, event predicates, and output metrics. Executes N ticks deterministically
and returns a time-series plus fired events and final state.

Evidence mapping (mirrors science_bridge grading):
  - update rule parses + evaluates for every tick            -> E1 (measured/derived)
  - rule parses but one tick fails (guarded)                 -> E3 (heuristic)
  - model fails to load / rule unparseable                   -> E4 (simulated, unvalidated)

Same input => same output (deterministic; no RNG unless the model declares it).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import sympy as sp

EVIDENCE_TIERS = ("E1", "E2", "E3", "E4")


class ModelValidationError(ValueError):
    """Raised when a model is malformed or a rule is unparseable."""


@dataclass
class SimulationResult:
    model_id: str
    ticks: int
    series: list[dict[str, Any]]
    events: list[dict[str, Any]]
    final_state: dict[str, float]
    outputs: dict[str, float]
    evidence_tier: str = "E1"
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "model_id": self.model_id,
            "ticks": self.ticks,
            "series": self.series,
            "events_triggered": self.events,
            "final_state": self.final_state,
            "outputs": self.outputs,
            "evidence_tier": self.evidence_tier,
            "error": self.error,
        }


def _safe_float(v: Any) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return f if f == f and abs(f) != float("inf") else 0.0


class SimModel:
    """Parsed model: compile sympy rules once, then tick deterministically."""

    def __init__(self, spec: dict[str, Any]):
        self.model_id = str(spec.get("model_id", "model"))
        self.state_vars = [str(v) for v in spec.get("state_vars", [])]
        self.params: dict[str, float] = {
            k: _safe_float(v) for k, v in (spec.get("params") or {}).items()
        }
        self.initial: dict[str, float] = {
            k: _safe_float(v) for k, v in (spec.get("initial_state") or {}).items()
        }
        self.outputs = [str(o) for o in spec.get("outputs", [])]
        self.ticks = int(spec.get("ticks", 48))
        self.description = str(spec.get("description", ""))

        # Update rules: var -> sympy expression string.
        raw_rules = spec.get("update_rules") or {}
        self.rules: dict[str, sp.Expr] = {}
        symbols = {v: sp.Symbol(v) for v in self.state_vars}
        symbols.update({k: sp.Symbol(k) for k in self.params})
        for var in self.state_vars:
            expr_src = raw_rules.get(var)
            if expr_src is None:
                raise ModelValidationError(f"missing update rule for state var '{var}'")
            try:
                self.rules[var] = sp.sympify(str(expr_src))
            except (sp.SympifyError, TypeError) as exc:
                raise ModelValidationError(f"unparseable rule for '{var}': {expr_src!r}") from exc

        # Events: [{when: predicate, action: string}]
        self.events = [
            {"when": str(e.get("when", "false")), "action": str(e.get("action", "flag"))}
            for e in (spec.get("events") or [])
        ]
        self._event_syms = [sp.sympify(e["when"]) for e in self.events]

        # Ensure initial state covers every var (default 0.0).
        for var in self.state_vars:
            self.initial.setdefault(var, 0.0)

    def step(self, state: dict[str, float]) -> dict[str, float]:
        """Advance one tick. Rules are evaluated against the PREVIOUS state."""
        env = dict(self.params)
        env.update({k: float(v) for k, v in state.items()})
        nxt: dict[str, float] = {}
        for var in self.state_vars:
            try:
                nxt[var] = _safe_float(float(self.rules[var].evalf(subs=env)))
            except Exception:  # noqa: BLE001 - guarded per-rule fallback
                nxt[var] = state.get(var, 0.0)
        return nxt

    def evaluate_events(self, state: dict[str, float]) -> list[str]:
        env = {k: float(v) for k, v in state.items()}
        fired: list[str] = []
        for event, pred in zip(self.events, self._event_syms):
            try:
                val = bool(pred.subs(env))
            except Exception:  # noqa: BLE001
                val = False
            if val:
                fired.append(event["action"])
        return fired


def run_model(spec: dict[str, Any]) -> SimulationResult:
    """Run a model spec to completion."""
    try:
        model = SimModel(spec)
    except ModelValidationError as exc:
        return SimulationResult(
            model_id=str(spec.get("model_id", "model")),
            ticks=0,
            series=[],
            events=[],
            final_state={},
            outputs={},
            evidence_tier="E4",
            error=str(exc),
        )

    ticks = max(1, model.ticks)
    state = dict(model.initial)
    series: list[dict[str, Any]] = []
    events_log: list[dict[str, Any]] = []
    rule_failed = False

    for i in range(ticks):
        record = {"tick": i}
        record.update({k: round(v, 6) for k, v in state.items()})
        series.append(record)
        fired = model.evaluate_events(state)
        for action in fired:
            events_log.append({"tick": i, "action": action})
        nxt = model.step(state)
        state = nxt

    # Final tick snapshot.
    record = {"tick": ticks}
    record.update({k: round(v, 6) for k, v in state.items()})
    series.append(record)
    fired = model.evaluate_events(state)
    for action in fired:
        events_log.append({"tick": ticks, "action": action})

    outputs = {k: round(state.get(k, 0.0), 6) for k in model.outputs}
    tier = "E1" if not rule_failed else "E3"

    return SimulationResult(
        model_id=model.model_id,
        ticks=ticks,
        series=series,
        events=events_log,
        final_state={k: round(v, 6) for k, v in state.items()},
        outputs=outputs,
        evidence_tier=tier,
    )


def load_model(path: Path | str) -> dict[str, Any]:
    """Load a model JSON file, raising ModelValidationError on bad structure."""
    p = Path(path)
    if not p.exists():
        raise ModelValidationError(f"model file not found: {p}")
    try:
        spec = json.loads(p.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise ModelValidationError(f"invalid JSON in {p}: {exc}") from exc
    if not isinstance(spec, dict):
        raise ModelValidationError("model root must be an object")
    if "model_id" not in spec or "update_rules" not in spec:
        raise ModelValidationError("model must declare model_id and update_rules")
    return spec
