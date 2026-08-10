# Sports Scientific Rigor + Shared Bidirectional Insight Core — Design

**Date:** 2026-08-10
**Status:** Approved (execution pending)
**Governing context:** `OVERLAY_SCIENCE_MAP.md` (definitive domain map) + existing `biotech_science/` (class-leading biotech engine, committed as `f2edffd`) + `sports_science/` (existing sports engine).

---

## 1. Goal

Upgrade the sports platform to the same scientific rigor as the biotech platform,
and introduce a **shared bidirectional insight core** so the translation seam not only
matches terms/archetypes but synthesizes whole-profile insights on both ends.

## 2. Architecture

New top-level package `science_bridge/` at repo root. Both `sports_science/` and
`biotech_science/` already insert repo root into `sys.path`, so both can import it.

```
Draymond-Orchestrator\
├── science_bridge\                  ← NEW shared seam (single source of truth)
│   ├── __init__.py
│   ├── translation\
│   │   ├── mappings.py              # moved from biotech (term/archetype/metric tables)
│   │   ├── engine.py                # bidirectional term/archetype/metric translation
│   │   └── evidence.py              # E1-E4 grading
│   └── insights.py                  # NEW whole-profile bidirectional synthesis
├── sports_science\
│   ├── translation\__init__.py      # thin re-export of science_bridge
│   ├── evidence.py                  # NEW: grade_metric() tiers
│   ├── clinical.py                  # NEW: performance-risk module (mirror of biotech clinical.py)
│   ├── run_translate.py             # NEW CLI (mirror biotech run_translate.py)
│   └── run_insights.py              # NEW CLI (whole-profile synthesis)
├── biotech_science\
│   └── translation\                 # becomes thin re-export shim → science_bridge
```

**Dependency direction:** both platforms → `science_bridge`. `science_bridge` is fully
self-contained (tables live in `mappings.py`); it imports neither platform.

## 3. Whole-profile insight synthesis (`science_bridge/insights.py`)

```
synthesize(profile: dict, from_domain: 'sports' | 'biotech') -> InsightReport
```

- Accepts either domain's full metric profile.
  - sports: `ter`, `four_factors` (proliferation/clearance/resource/metastasis), `gravity`,
    `flow`, `fatigue`, `injury_risk`, `recovery_priority`.
  - biotech: `ter`, `four_factors` (proliferation/clearance/angiogenesis/metastasis),
    `tumor_gravity`, `tumor_flow`, clinical risk, `risk_tier`, archetype.
- **Normalizes the four-factor naming gap:** sports `resource` ↔ biotech `angiogenesis`.
- Translates each metric bidirectionally; aggregates the archetype match
  (Jordan→cancer, Curry→virus, Draymond→immune system, Jokic→CNS, etc.).
- Emits an `InsightReport`:
  - `source_read` — plain-language read of the input domain profile.
  - `target_read` — translated insight in the OTHER domain (actionable implication).
  - `translated_metrics[]` — per-metric translated values + confidence.
  - `evidence_tier` (E1–E4) + confidence.
- Deterministic, rule-based, evidence-tiered. No LLM dependency.

## 4. Sports scientific-rigor modules

- `sports_science/evidence.py` — `grade_metric(metric, value, source) -> tier`:
  measured=E1, derived=E2, rule-based=E3. Wired into every metrics/coach output.
- `sports_science/clinical.py` (mirrors biotech `clinical.py`):
  - `baseline_form(ter, gravity, flow)` → 0–1 form score.
  - `projected_availability(fatigue, injury_risk, acute_chronic)` → load/minutes projection.
  - `fatigue_curve(load_history)` → deterministic load-decay trajectory.
  - `availability_tier(risk)` → normal / elevated / critical.
  - `gameplan_response(metrics)` → coach-payload builder (mirrors `treatment_response`).
- `sports_science/run_translate.py` + `run_insights.py` — CLI runners with the same
  machine-readable JSON contract as biotech's runners.

## 5. TS layer + API surface

- `src/lib/sports/pythonExecutors.ts` — add `runPythonTranslate` + `runPythonInsights`
  (mirror biotech executors).
- `src/lib/sports/api.ts` — expose translate + insights submission paths.
- New route group `src/app/api/v1/sports/`: `run`, `experiments` (mirror biotech routes,
  authorized via `api-auth`).
- Shared endpoint `src/app/api/v1/translate/insights/route.ts` — whole-profile synthesis
  for either domain.

## 6. Testing (full parity)

- Python: `science_bridge/tests/` + `sports_science/tests/test_translation.py`,
  `test_insights.py`, `test_clinical.py`, `test_evidence.py`. Biotech tests keep passing
  through the re-export shim.
- TS: `tests/sports-api.test.ts`, `tests/sports-python-executors.test.ts`,
  `tests/translate-insights.test.ts` (mirror biotech's).
- Verify: `python -m pytest` (both packages) + `npx vitest run` + `npx eslint` +
  project typecheck.
