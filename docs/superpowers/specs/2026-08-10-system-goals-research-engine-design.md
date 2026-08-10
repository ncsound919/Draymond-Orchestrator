# System Goals + Unified Research/Simulation Engine — Design

**Date:** 2026-08-10
**Status:** Approved (execution pending)
**Governing context:** Overlay Science domain map + existing `science_bridge`, `biotech_science`, `sports_science`, `science_factory`, TaskDAG, ultraplan, kairos, and scheduler.

---

## 1. Goal

Stand up a **system-goals layer** (20 research goals across biotech/oncology and
sports science) and a **unified experiment/simulation/research engine** that runs
analysis, deterministic simulation, and cross-domain translation experiments
against those goals, on a scheduler-driven research rotation.

## 2. Architecture

```
Draymond-Orchestrator\
├── .draymond\
│   ├── system-goals.json       ← 20 goals, heuristic priorities, status
│   ├── hypotheses.json         ← testable claims per goal (untested→supported/refuted)
│   └── experiment-queue.json   ← pending experiment specs (priority-ordered)
├── science_engine\             ← NEW Python sim runtime (ticked state-machine DSL)
│   ├── __init__.py
│   ├── runtime.py              # sympy-evaluated update rules, ticks, events
│   ├── cli.py                  # python -m science_engine.sim <model> <ticks> <params>
│   └── models\                 # 20 seed JSON models (one per goal)
├── src\lib\science\
│   ├── goals.ts                # goal/hypothesis CRUD (JSON-state)
│   ├── priority.ts             # heuristic priority scoring
│   ├── experiments.ts          # unified ExperimentEngine (dispatch + persist)
│   └── sim.ts                  # shells out to science_engine Python runtime
├── src\app\api\v1\science\
│   ├── goals\route.ts          # GET list, GET by id, POST create
│   ├── experiments\route.ts    # POST run, GET list
│   └── simulations\route.ts    # POST run a model directly
└── scheduler: research_rotation cron job
```

## 3. State model

- Goals/hypotheses/queue: JSON-state files under `.draymond/` (ultraplan/mission-strategy pattern).
- Experiment results: unified `science_experiments` SQLite table.

## 4. Goal schema (`.draymond/system-goals.json`)

`{ id, domain (biotech|sports), area, title, opportunity, rationale, priority (0-1 heuristic), status, model_id, hypothesis_ids[] }`

## 5. Hypothesis schema (`.draymond/hypotheses.json`)

`{ id, goal_id, claim, status (untested|in_progress|supported|refuted), experiment_ids[] }`

## 6. Heuristic priority scoring (`src/lib/science/priority.ts`)

Pure function: `0.6*cross_domain_value + 0.3*adapter_availability + 0.1*hypothesis_maturity + base`. Rotation drains ready experiments ordered by priority × maturity.

## 7. Unified ExperimentEngine (`src/lib/science/experiments.ts`)

- `analysis` → sports/biotech metrics CLIs
- `simulation` → shell to `python -m science_engine.sim <model> <ticks> <params>`
- `translation` → `science_bridge.synthesize`
- Results persist to `science_experiments` with `evidence_tier`.

## 8. Python sim runtime (`science_engine/runtime.py`)

JSON model: `{ model_id, state_vars[], params{}, update_rules{}, events[], outputs[], ticks }`.
Update rules parsed with sympy; ticks recorded; events fired on predicates; output is
`{ series, events_triggered, final_state, evidence_tier }`. Deterministic.

## 9. Seed models — all 20 goals

One deterministic JSON model per goal (10 biotech, 10 sports), several mapping
onto existing metrics (biological load ↔ sports clinical fatigue; tumor growth ↔
biotech onco_metrics).

## 10. Scheduler integration

`research_rotation` cron job (daily, `job_type: 'custom'`) drains the highest-priority
ready experiment. Kairos detector `detectStaleExperiment` flags experiments stuck
> N hours.

## 11. Testing

- Python: runtime determinism, event firing, sympy rules, all 20 models load+run.
- TS: goals CRUD + priority, experiments dispatch, sim shell-out.
- Verify: pytest + vitest + lint green.
