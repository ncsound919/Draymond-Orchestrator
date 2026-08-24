# Scientific Scoreboard — Quality-First Gamification for the Agentic Research Fleet

Date: 2026-08-20
Scope: Add quality-first gamification to the Draymond agentic cancer-research pipeline, aimed at **research quality, validated throughput, and collaboration** — not "winning a cure."

## Design principle

Rewards track **reduction of uncertainty**, not hypothesis volume or optimistic conclusions. The Foldit precedent shows game-like incentives can produce lab-testable ideas **when the score is wired to a real scientific objective**; the scoreboard here wires scoring to *validated evidence, replication, and clinical relevance*, and punishes overclaiming.

## Reward function (implemented)

```
score = validated_info_gain + independent_replication + clinical_relevance − cost − time − overclaiming_risk
```

| Term | Computed by | Rewards | Penalizes |
|---|---|---|---|
| `validated_info_gain` | `validated_info_gain()` | correct citations, coverage, explicit uncertainty, matched precommitted prediction | unsupported claims, ignoring contradictions |
| `independent_replication` | `independent_replication()` | independently reproduced findings **and well-documented negative results** | no external replication |
| `clinical_relevance` | `clinical_relevance()` | actionable, patient-relevant, E1-tier, representative | non-actionable, E3-only |
| `cost` / `time` | `cost_penalty()` / `time_penalty()` | cheap + fast | expensive, slow |
| `overclaiming_risk` | `compute_overclaiming_risk()` | — | confidence exceeding evidence, contradictions, high uncertainty, no replication/red-team |

The overclaiming term is the anti-hype guarantee: an agent scores highly for *"this hypothesis failed on an external cohort, here's why, here's the next discriminating experiment"* — not for a pretty narrative.

## Safeguards (all implemented, first-class)

1. **Independent verifier (red-team)** — `redteam_audit()`: a separate agent attacks results for leakage/confounds/contradictions; serious findings block promotion.
2. **Two-key promotion** — `two_key_promotion()`: BOTH proposer and an independent reproducer must clear criteria; no single agent self-promotes.
3. **Reward negative results** — `independent_replication()` grants credit for decisive, well-documented disconfirmation (capped so cheap failures can't game it).
4. **Hidden evaluation / external replication** — a result only promotes when `replication_successes >= 1` (holdout/blinded benchmarks are kept out of the primary agent).
5. **Precommitment** — `Precommitment`: endpoint, effect direction, size threshold, controls, failure definition recorded (SHA-256 hashed) BEFORE analysis.
6. **Capped leaderboard** — `leaderboard_safe()`: bounded-task scores + team/diversity bonuses to avoid convergence on one fashionable theory.
7. **Expert sign-off** — clinical/biological action stays behind a human scientific & ethical gate (`gates.expert_signoff`).

## Files

`biotech_science/`
- `science_scoreboard.py` — the scoreboard: reward function, all component scorers, all safeguard functions, master `score_result()`.
- `run_score.py` — CLI runner tying the existing `hypothesis.py` + `verify.py` into a scored mission with safeguards.
- `test_science_scoreboard.py` — 7 tests (overclaiming, good-vs-bad, negative-result reward, gates, red-team, two-key, leaderboard).

## Validation

- **7/7 tests pass.**
- **End-to-end run** (`run_score.py`, target EGFR): real ChEMBL (26 active compounds) + ClinicalTrials.gov evidence fetched live → **E1 tier**, score 2.23, all gates passed, low overclaiming (0.15). Crucially, **`two_key_promotion: promoted=false`** even at high score because the *independent reproducer* hadn't reported — proving the design blocks self-promotion.

## How it plugs into the ecosystem

- Runs as a CLI contract identical to `run_hypothesis.py` / `run_verify.py` (`session <input.json>` → JSON).
- Designed to be invoked by Draymond agents/chains (`src/lib/draymond/`) so each research mission returns a scored, safeguard-gated verdict — not just a hypothesis.
- The `gates` + `verdict` fields give a deterministic, honest promotion path that can be surfaced in the Oncology/Decon research UIs.

## Future / next
- Wire a Draymond chain/business-chain to invoke `run_score.py` per mission and feed scores into the fleet dashboard.
- Add a persistence layer (SQLite/supabase) for the scoreboard so leaderboards and promotion history accumulate.
- Add hidden-evaluation sets to the Oncology real-cohorts (holdout TCGA cohorts) and feed survival/mutation benchmark results through `score_result()`.
