# Experiment Batch Run — 2026-08-27

**Status:** 15 executed (0 failed), 15 marked unrunnable (claim-only stubs)
**Engine:** `research/experiments-runs/run_queue.py` → deterministic science CLIs
**Evidence:** all results E1/E2 (measured from real datasets or deterministic sims), no fabrication
**Artifacts:** `research/experiments-runs/2026-08-27/{id}.json` + `summary.json`

---

## Results by hypothesis

### biotech-01-h1 — burden-threshold risk model flags life-threatening windows (SIMULATION, `88c98552`) ✅ SUPPORTED
- **Risk score spikes to 0.865 at tick 1 and stays elevated through tick 5, while tumor burden keeps climbing to its 1.037 peak at tick 7.** The risk signal fires `flag:life_threatening_window` at ticks 1–5 — *before* peak burden. Interception then drives burden down (0.258 final) with `flag:intercepted_early` from tick 37.
- **Reading:** the burden-threshold model detects the danger window ahead of maximum clinical burden — consistent with H1's claim. The flagging-before-peak pattern is the key observable.

### biotech-03-h1 — genomic classification match drives durable clearance (ANALYSIS, `ca1ea44e`) — real METABRIC patient
- Patient `0` (claudin-low, ER+, grade 3, size 22cm, age 75.65): **ter 0.5575, recurrence risk 0.812** (post-tx), composite 43.39, archetype `cancer_dominant` (0.471), drug classes = chemotherapy + cell-cycle inhibitors.
- Baseline risk 0.969 → post-treatment 0.812: the model's clearance story is present but modest on this single patient; needs cohort-scale run to test H1.

### biotech-05-h1 — pathway blockade above seeding threshold halts colonization (SIMULATION, `e8c6561c`) ⚠️ INCONCLUSIVE
- 48 ticks: primary tumor grows 1.0 → 10.4, circulating cells 0.1 → 1.5, **but metastatic_sites stays 0.0 the entire run with zero events triggered.**
- **Reading:** the model never seeds within 48 ticks under default params — the seeding-threshold claim is **not testable** with the current model calibration (no threshold crossing occurs). Flag as a model-calibration gap, not a result.

### sports-01-h1 — stress above adaptation ceiling predicts stagnation (SIMULATION, `7fcff755`) — executed, see artifact.

### sports-03-h2 — recovery half-life shortens as stress toxicity rises (ANALYSIS + TRANSLATION, real athlete A001 + Bogut)
- A001 (Center, age 24, HRV 63.5, load 0.65, AC 1.5): **injury_risk 28.69** (E2), fatigue 0.274, availability 0.726 (normal tier), recovery_priority normal. Real-data baseline established for the fatigue-threshold H1.
- Bogut 2010-11 translation (`33dc2ac0`/`794c27ea`): cross-domain sports→biotech read of a real NBA season.

### sports-08-h1 — data coverage is the binding constraint (SIMULATION + 4 ANALYSES)
- Sim (`d470ea7d`): final state — data_coverage 1.0, model maturity 1.0, sport accuracy 1.0, **integration_score 0.8** → the model self-reports integration as its weakest binding constraint (not data coverage at these settings).
- Real analyses: A001/A002 athlete-injury profiles + 2 NBA team-season profiles (`2010-11_101106`, `2010-11_101107`) — real-data TER/fatigue/injury outputs now exist for the multi-sport engine.

---

## Fixes landed
1. **6 queue entries referenced dead `.next/standalone/datasets/...` paths** (never-built bundle) → rewritten to live `datasets/...` paths, re-run clean.
2. **15 claim-only stubs** (08-25 auto-queue, no model_id/dataset/profile) → marked `unrunnable` with reason, so the queue stops silently carrying dead entries.

## Discoveries for the research line
- **Risk-before-burden (E1):** the burden-threshold model's risk score leads the tumor-burden peak by ~6 ticks — the single strongest observable from this batch.
- **Metastasis model doesn't seed (E1):** 48-tick default sim produces zero colonization events — a calibration gap to fix before claiming seeding-threshold results.
- **Real data now flowing:** 8 real athlete/NBA/METABRIC profiles analyzed end-to-end through the deterministic pipeline (E1/E2), breaking the "0 executed experiments" state.

## Remaining debt
- 15 claim-only hypotheses need real inputs (dataset/model_id) to be runnable — design task, not execution task.
- biotech-05 model needs re-calibration so threshold crossing can be observed.