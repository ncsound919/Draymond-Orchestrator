# Math X → Draymond: Full Embedding Plan

**Status:** All phases complete (0–5)
**Branch:** work from `feat/venture-scout` → new branch `feat/mathx-embed`
**Source:** `ncsound919/math-x` (cloned to `C:\Users\User\AppData\Local\Temp\opencode\math-x`)
**Target:** `Draymond-Orchestrator` (Next.js 16, React 19, TS, SQLite/better-sqlite3, Vitest)

> **Implementation note (decision):** the deterministic brain being run is the
> **Python agent** at `agents/deterministic-brain/` (not the TS module — that
> module was dead/unimported and has since been removed from the tree). The
> math-aware brain work therefore targets the Python code: a new
> `brain/mathx.py` core (1:1 mirror of `src/lib/mathx`) and a rewired
> `brain/metacognition.py` (calibrated confidence, recurrence evidence, EV-ranked
> proposals). See Phase 1g.

---

## 0. Goal

Strip Math X to its components and embed **everything** inside Draymond so there is one
system, one codebase, one compute substrate. Two compute paths by design:

| Path | Where | Used for |
|---|---|---|
| **Pure TypeScript** (`src/lib/mathx/`) | Node server + cron runtime | Orchestration math, brain scoring, verification, token budgets — deterministic, testable, offline |
| **Pyodide / DuckDB WASM workers** (client) | Browser dashboard | Probability Lab, bioinformatics, file analysis, heavy simulation — interactive, visual |

Both paths share the **same formulas** (documented in `src/lib/mathx/`), so a Bayesian
score computed in the cron is the same Bayesian score a user computes in the dashboard.

---

## 1. Current state (what we are working with)

### Draymond today
- **No** math/stat library, chart library, OCR, DuckDB, RAG, or web workers. All numeric
  logic is hand-rolled: percentiles (`confidence.ts:407`), linear thresholds
  (`confidence.ts:401`), severity→weakness lookup (`deterministic-brain.ts:147`),
  composite weights (`analytics.ts`, `weakness-scoring.ts`), linear memory decay
  (`memory-intelligence.ts`).
- LLM via `callLLM` in `src/lib/draymond/llm.ts` — 8 providers, fallback chain, budget-gated
  by `workflow-budget.ts`. Anthropic path sends **text-only** content (no vision/images).
- DB: local SQLite only (`better-sqlite3`), supabase-compatible query builder.
- API routes: Next.js handlers under `src/app/api/**`, auth via `api-auth.ts`
  (`authorizeRequest`: Bearer `CRON_SECRET` / review tokens / `X-Api-Key`).
- Frontend: server-component pages + `Header` nav
  (`Chat · Operations · Agents · Workflows · Schedules · Approvals · Downloads · Admin`);
  `/chat` is a client `ChatClient.tsx`.
- Tests: Vitest, `tests/**/*.test.ts`, coverage thresholds enforced on
  `src/lib/draymond/**` (lines 75 / stmts 70 / funcs 75 / branches 55).
- Git: repo is on branch `feat/venture-scout`, `.env.example` has an uncommitted change.

### Math X (source to strip)
- **Live surface** (small): `App.tsx`, `Omnibar`, `ResultsPane`, `LeftDrawer`,
  `MathRenderer`, `ChartView`, `ExportButton`, `ParameterSliders`, `ModelSelector`,
  `usePyodide`/`useDuckDB`/`PyodideWorkerManager`, `memory.ts`/`sessions.ts`/`apiFetch.ts`/`useOCR.ts`.
- **Orphaned but real** (lift wholesale): `ExportPanel`, `ExampleGallery`, `DomainPicker`,
  `DomainSelector`, `DerivationVerifier`, `ProofTree`, `ProofVerifier`, `LiteraturePanel`,
  `BioFileDropzone`, `BioFileCard`, `GenomeBrowser`, `MoleculeViewer`, `MafsPlot`, `PlotView`,
  `WorkflowTemplates`, `PyodideErrorBoundary`, `useBioPyodide`, `useSymPyVerifier`,
  `bioParser.ts`, `bioPrompt.ts`, `useLiteratureRAG.ts`, export/share utils.
- **API routes** (Express): chat (SSE), codegen, plan, verify(+results), literature
  (search/pubmed/gene), ocr, bio (ncbi/uniprot), hypothesis (run/refine), analogies, domain,
  models, export.
- **Core package** `@mathx/math-core`: `types`, `modelRouter`, `tokenizer`, `verify`,
  `prompts`, `domainPrompts` — pure TS, the only package that is actually imported.
- **Dead code to NOT port:** all 11 root flat files (`index.ts`, `auth.ts`, `domain.ts`,
  `errors.ts`, `ocr.ts`, `analogies.ts`, `sessions.ts`, `useOCR.ts`, `ExportPanel.tsx`,
  `ProofVerifier.test.tsx`, `auth.test.ts`), packages `schemas`/`shared`/`ui`,
  `middleware/rateLimit.ts`, `services/bioContext.ts`, `workers/index.ts`.
- **Known bugs to fix on port:** OCR field mismatch (web sends `image`, API expects `data`);
  `useLiteratureRAG` posts to `/api/literature` but route is `/api/literature/search`;
  `ExportPanel` DOCX posts to nonexistent `/api/export/docx`; live API leaks `err.message`.

---

## 2. Target architecture

```
Draymond-Orchestrator
├── src/lib/mathx/                  ← NEW pure-TS math core (ported + new stats)
│   ├── index.ts                    # barrel
│   ├── types.ts                    # MathX types (ported, trimmed)
│   ├── tokenizer.ts                # estimateTokens / truncateToTokens / chunkText (ported)
│   ├── router.ts                   # mode→provider mapping, token budgets (adapted to Draymond providers)
│   ├── verify.ts                   # parseVerifySteps / computeSummary / buildSymPyVerificationCode (ported)
│   ├── stats.ts                    # NEW: betaPosterior, shrinkage, EWMA, CUSUM, percentile, normalCdf, sigmoid
│   ├── optimize.ts                 # NEW: EV-prioritized queue ranking, cost-aware objective
│   ├── prompts.ts                  # MATHX_SYSTEM, MODE_PREFIXES, domainPrompts (ported)
│   └── formats.ts                  # latex/notebook/markdown export helpers (ported)
│
├── src/app/api/math/               ← NEW Next.js route group (ported, LLM via callLLM)
│   ├── plan/route.ts               # POST — planner (engine/complexity/chain)
│   ├── codegen/route.ts            # POST — Python codegen
│   ├── verify/route.ts             # POST — derivation extraction + SymPy code
│   ├── verify/results/route.ts     # POST — trust-score merge
│   ├── hypothesis/run/route.ts     # POST — hypothesis + test code
│   ├── hypothesis/refine/route.ts  # POST — SSE refine
│   ├── analogies/route.ts          # POST
│   ├── domain/route.ts             # POST
│   ├── export/route.ts             # POST — markdown/latex/jupyter/plain
│   ├── ocr/route.ts                # POST — Claude vision (image support added to llm.ts)
│   ├── literature/…/route.ts       # search / pubmed/:pmid / gene/:query (pure fetch)
│   ├── bio/…/route.ts              # ncbi / uniprot (pure fetch)
│   └── models/route.ts             # GET — provider probe
│
├── src/app/math/                   ← NEW client page — the Math Lab (modes, results, charts)
├── src/components/mathx/           ← NEW ported components (see Phase 3/4)
├── src/workers/                    ← NEW client workers (Pyodide, DuckDB, SymPy verifier)
│
├── src/lib/draymond/               ← MODIFIED: rewired to consume mathx
│   ├── llm.ts                      # token budgets via mathx/tokenizer; vision support for OCR
│   ├── confidence.ts               # Bayesian posterior + shrinkage instead of raw rates
│   ├── deterministic-brain.ts      # calibrated confidence, EWMA/CUSUM drift, EV-ranked queue
│   ├── day-orchestrator.ts         # token-budgeted, cost-aware phase runs
│   ├── analytics.ts                # percentile from mathx/stats
│   └── ...                         # (unchanged files untouched)
│
└── tests/                          # NEW/updated Vitest suites (see per-phase)
```

Integration style: **fusion, not a silo.** `src/lib/draymond/*` imports from
`src/lib/mathx/*`; the Math Lab page and `/chat` share the same verify/OCR/chart plumbing;
the dashboard exposes the same math the cron uses.

---

## 3. Conventions

- Namespace: `@/lib/mathx` (alias `@` → `src` already configured).
- All new modules are pure ESM TS, zero runtime deps (math-core + stats are dependency-free
  so they run identically in Node and browser).
- Formula docs: every non-trivial function in `stats.ts`/`optimize.ts` carries a comment
  with the mathematical definition + sources, so the WASM path and TS path stay consistent.
- LLM calls from math routes go through `callLLM` (Draymond's budget/fallback chain) — never
  a fresh SDK client.
- API auth: internal math routes use the same guard style as `/api/ops/*`; admin-only
  endpoints (cron, brain sweep) use `authorizeRequest` with `CRON_SECRET`.
- UI: dark theme + existing `Header` nav; new pages follow the `benchmarks/page.tsx`
  server-component pattern where possible, client components only where required
  (WASM, charts, interactive).
- Tests: Vitest in `tests/**/*.test.ts`; new math-core/stats modules get unit tests with
  **100% branch coverage on the formulas** (compare against hand-computed values).
  Add `src/lib/mathx/**` to the coverage `include` so the gate protects the new math.
- Browser deps are **lazy-loaded** (`dynamic import`) to keep the app shell fast.

---

## 4. Dependencies & config changes

### package.json (Draymond)
Add (all browser-side, lazy-imported):
- `echarts` ^5 — ChartView (live Math X dep)
- `katex` + `@types/katex` — MathRenderer (live)
- `dompurify` + `@types/dompurify` — sanitizer (live)
- `idb-keyval` — memory/RAG store (live)
- `@duckdb/duckdb-wasm` — analytics (live)
- Phase-4 optional: `plotly.js-dist-min`, `mafs`, `reactflow`, `igv`, `ngl` (viewers)
- Phase-4 optional: `pdfjs-dist` if we lift PDF file-intel

No new server deps. Pyodide itself is **not** an npm dep — loaded from CDN inside the
worker blob (same approach as Math X), so nothing to add.

### next.config.ts
- Add any native/server package to `serverExternalPackages` if we add one (none planned —
  mathx is pure TS).
- Extend CSP `connect-src` to include the CDNs the workers/UI call:
  `https://cdn.jsdelivr.net` (Pyodide, DuckDB bundles), plus `https://www.ncbi.nlm.nih.gov`,
  `https://eutils.ncbi.nlm.nih.gov`, `https://export.arxiv.org`, `https://rest.uniprot.org`
  (literature/bio fetches happen server-side, so these matter only if we choose client fetch).
- Keep `script-src 'unsafe-inline' 'unsafe-eval'` (needed by WASM/Pyodide).

### .env.example (append, documented)
```
# ── Math X (embedded) ─────────────────────────────────────────────
MATHX_MODE=on                 # master switch for the /math lab + routes
OLLAMA_BASE_URL=              # optional local models (deepseek-r1, qwen2.5-math)
OLLAMA_MODEL=deepseek-r1:8b
QWEN_BASE_URL=                # optional qwen local
QWEN_MODEL=qwen2.5-math:7b
MATHX_DOMAIN_PROMPTS=1        # enable 15-domain expert prompts
```

### vitest.config.ts
- Extend coverage `include` with `src/lib/mathx/**`.

---

## 5. Phases

Each phase is independently shippable, testable, and reviewable. Run
`npm run type-check && npm run lint && npm test` at every phase end.

---

### Phase 0 — Governance & deps (~30 min)
- Verify clean git state on `feat/venture-scout` (`.env.example` is already dirty — commit or
  stash it first). Create branch `feat/mathx-embed`.
- Add the deps above; `npm install`.
- Update `next.config.ts` CSP; append `.env.example` block; extend `vitest.config.ts`.
- Copy the full math-x source snapshot into `docs/mathx-source-reference/` (zip) as the
  auditable upstream reference **before** stripping, so nothing is lost.
- **Accept:** `npm run type-check && npm test` still green.

---

### Phase 1 — Pure-TS math core + rewire (the math-aware benefits) ~1–2 days
This is the highest-value phase: it makes the orchestrator and brain mathematically astute
with zero UI.

**1a. Port `src/lib/mathx/`**
- `types.ts`, `tokenizer.ts`, `verify.ts`, `prompts.ts` — port from `packages/math-core`
  verbatim (adjust imports to `@/lib/mathx`).
- `router.ts` — port `selectProvider`/`MODE_MAX_TOKENS` but **adapt** the mapping to
  Draymond's provider set (`opencode-free`/`deepseek`/`gemini`/`anthropic`/`qwen`) and
  wire `buildProviderOrder` from `llm.ts` as the fallback backbone.

**1b. NEW `stats.ts` (TDD — formulas verified against hand-computed values)**
- `percentile(sorted, p)` — linear-interpolated (replaces nearest-rank in `confidence.ts`).
- `betaPosterior(successes, failures, priorA=1, priorB=1)` → `{mean, ciLow, ciHigh}`
  (regularized incomplete beta via continued fraction; tests vs known values).
- `shrinkage(rate, n, priorMean, priorStrength)` → shrunk estimate for small samples.
- `ewma(values, lambda)` → trend series + last value.
- `cusum(values, target, k, h)` → alarms on sustained drift (statistical process control).
- `normalCdf(z)` (Abramowitz–Stegun approximation), `sigmoid(x)` for calibration.

**1c. NEW `optimize.ts` (TDD)**
- `rankByExpectedValue(items: {p, impact, age}, decayLambda)` → sorted priority score.
- `costAwareOrder(jobs, {tokenEstimate, costPerToken, deadline})` → schedule order
  minimizing weighted lateness subject to budget (greedy EDD + cost cap).

**1d. Rewire Draymond core**
- `confidence.ts`: historical-rate signal becomes `shrinkage(success_rate, n, baseline, 5)`;
  threshold recommendation becomes `betaPosterior`-derived (sample-aware); percentiles use
  `mathx/stats.percentile`.
- `deterministic-brain.ts`: replace hardcoded per-path confidences with calibrated values
  (evidence count → posterior); replace "failed last run" drift with `cusum`/`ewma` over
  `draymond_execution_logs` + monitor history; queue ordering via
  `rankByExpectedValue` (weakness_score × confidence, age-decayed).
- `day-orchestrator.ts`: `estimateTokens` on each step's payload; run phases cost-aware
  via `costAwareOrder`.
- `llm.ts`: default `maxTokens` and truncation via `mathx/tokenizer`; per-mode budgets from
  `router.MODE_MAX_TOKENS`.
- `analytics.ts`: use shared `percentile`.

**1e. Tests** — `tests/mathx/stats.test.ts`, `tests/mathx/tokenizer.test.ts`,
`tests/mathx/verify.test.ts`, `tests/mathx/optimize.test.ts`,
`tests/mathx/router.test.ts`, `tests/mathx/prompts.test.ts`; update
`tests/confidence.test.ts`, `tests/day-orchestrator.test.ts`. **DONE — all green
(674 TS tests + 29 Python tests, type-check + lint + coverage gates pass).**

**1g. Python deterministic brain (the live brain)** ✅
- `agents/deterministic-brain/brain/mathx.py` — pure-stdlib Python port of the
  mathx core (percentile, beta posterior, shrinkage, EWMA, CUSUM, normal CDF,
  sigmoid, EV ranking, calibrated confidence).
- `agents/deterministic-brain/brain/metacognition.py` — hardcoded confidences
  replaced with reliability-calibrated values; recurrence evidence (a finding
  that keeps coming back is boosted via a Beta posterior); findings ranked by
  expected value before the cap; ledger records `ev`; self-reflection now
  reports calibration tables.
- `agents/deterministic-brain/tests/test_mathx.py` — mirrors the TS suite,
  29 tests passing; existing brain tests still green (51 passing).

**Accept:** full suite green with new coverage on `src/lib/mathx/**`; brain report shows
sample-size-aware confidence + EWMA/CUSUM drift signals + EV-ranked queue.

---

### Phase 2 — Math service API routes ~1 day
Port the Express routes to Next.js route handlers under `src/app/api/math/*`. All LLM calls
via `callLLM` (with `provider: 'anthropic'` preferred for the Claude-heavy ones, falling
back through the chain). Fix the known bugs on the way.

- `plan`, `codegen`, `hypothesis/run`, `analogies`, `domain`, `export` — JSON-in/JSON-out,
  LLM-generated, zod-validated, `DEFAULT_PLAN`-style fallbacks on parse failure.
- `verify` + `verify/results` — port step extraction (LLM), `buildSymPyVerificationCode`,
  and the trust-score merge (pure, unit-testable).
- `literature/search`, `literature/pubmed/:pmid`, `literature/gene/:query` — pure fetch
  (NCBI E-utilities + arXiv), no LLM, fail-soft per source.
- `bio/ncbi`, `bio/uniprot` — pure fetch, no LLM, 8s timeouts.
- `models` — provider availability probe.
- `ocr` — **requires image support**: extend `llm.ts` with an optional `images?: {dataB64,
  mediaType}[]` that the Anthropic + Gemini paths can serialize as content blocks (Anthropic
  `content: [{type:'text'},{type:'image',source:{...}}]`, Gemini `inlineData`). Port the OCR
  prompt; **fix the field contract** (`data` + `mediaType`) and update the client to match.
- `chat` — DO NOT duplicate. Draymond already owns `/api/chat` (`chat.ts` +
  `orchestrateChatTurn`). Add the Math X plan→codegen→compute→chat pipeline as an optional
  mode inside the existing turn (see Phase 3), reusing the SSE shapes.

Auth: guard with `requireDraymondAuth` (session) for browser calls + `authorizeRequest`
(`CRON_SECRET`) where cron hits them.

**Accept:** every route exercised via unit tests (mock `callLLM`) + a curl smoke script
`scripts/mathx-smoke.mjs`. ✅ **DONE** — all 16 routes implemented under
`src/app/api/math/*` over a shared `src/lib/mathx/services.ts` + `route-helpers.ts`;
`llm.ts` gained vision (`images`) support; 12 service tests; `scripts/mathx-smoke.ts`
green; full gates pass (686 TS tests, lint clean, coverage above thresholds). Known
math-x bugs fixed on port (OCR `data` contract, `/literature/search` path, export
formats, sanitized errors). Refinement (`hypothesis/refine`) is JSON not SSE (callLLM
is request/response — SSE streaming deferred to a later pass).

---

### Phase 3 — Frontend Math Lab + workers ~2 days
- Port `src/workers/PyodideWorkerManager.ts` (inlined blob, numpy/scipy/sympy base,
  pandas/statsmodels lazy, biopython via micropip) → `src/workers/`. Port `usePyodide`,
  `useDuckDB`, `useSymPyVerifier`.
- Port `src/components/mathx/`: `MathRenderer` (KaTeX + dompurify), `ChartView` (ECharts),
  `ResultsPane` (as `MathResults`), `ParameterSliders`, `DerivationVerifier`,
  `DomainSelector`, `ModelSelector` (adapted to Draymond providers), `PyodideErrorBoundary`.
- New page `src/app/math/page.tsx` (client): mode rail (Scientist / Formula / Hypothesis /
  Deep Solve / Synergy / Probability / File Intel / Domain Expert), omnibar input, results
  stream, charts, proof badges, session persistence (idb-keyval or Draymond's existing
  chat history pattern).
- Integrate into existing `/chat` (`ChatClient.tsx`): suggestion chips for math modes,
  OCR image drop → `/api/math/ocr` → inject LaTeX, code-execution block rendering
  (`execution.stdout/chart/table`), proof-verify inline badges.
- `Header.tsx`: add `Math` nav item.
- CSP/next.config verified so Pyodide/DuckDB CDNs load in dev + build.

**Accept:** `/math` page runs a real Probability Lab (numpy via WASM) end-to-end; `/chat`
handles an OCR image and renders a chart; everything lazy-loads without breaking the
Operations page. ✅ **DONE** — workers ported to `src/workers/`
(`PyodideWorkerManager` blob worker, `usePyodide`, `useDuckDB`, `useSymPyVerifier`),
renderers under `src/components/mathx/` (`MathRenderer` KaTeX+DOMPurify, `ChartView`
ECharts lazy, `ParameterSliders`, `PyodideErrorBoundary`, `MathResults`), a full `/math`
Math Lab page (8-mode rail, OCR image→LaTeX, plan→codegen→compute→narrative pipeline,
chart/table/param-slider output), and a `Math` nav entry. Added `/api/math/chat`
(Math X narrative, non-streaming) + `mathChat` service. Production build passes with all
17 math routes + `/math`. OCR/charts/proof-verify are fused in the Math Lab; the existing
`/chat` remains Draymond's orchestration chat (math chat integration there is optional).

---

### Phase 4 — Advanced panels + RAG ~2 days
Lift the orphaned-but-real features:
- `LiteraturePanel` + `useLiteratureRAG` (fix endpoint → `/api/math/literature/search`);
  inject selected papers as context in `/chat`.
- `BioFileDropzone`/`BioFileCard` + `useBioPyodide`/`bioParser.ts`/`bioPrompt.ts`;
  wire `buildBioContext` into chat.
- `ProofTree` (reactflow) + `PlotView`/`MafsPlot` + `GenomeBrowser`/`MoleculeViewer`
  (network/CDN-dependent — label clearly, lazy-load, off by default via env).
- `ExportPanel` (fix DOCX → markdown/latex/jupyter/plain only), `ExportButton`,
  `shareSession` (CompressionStream share links), `ExampleGallery`, `WorkflowTemplates`.
- Port `memory.ts` (IndexedDB TF-IDF) as a Math-context store; optionally feed retrieved
  chunks into `orchestrateChatTurn` alongside `system-intel`.

**Accept:** literature RAG and bio analysis work end-to-end in the Math Lab; chat can
consume retrieved + bio context; all optional viewers guarded by feature flags. ✅ **DONE**
— `LiteraturePanel` (PubMed/arXiv search → inject papers as chat context) and `BioPanel`
(NCBI/UniProt lookup → inject) as a RAG drawer in the Math Lab; `useMathMemory`
(IndexedDB TF-IDF recall + store) feeds auto-context; `/api/math/export` session export
button; `src/lib/mathx/share.ts` (CompressionStream share links, chunked base64 — avoids
the call-stack arg limit); shared-session restore from the URL hash. **Deferred (off by
design, heavy deps):** ProofTree (reactflow), GenomeBrowser/MoleculeViewer (IGV/NGL),
PlotView/MafsPlot, bio file parsing (biopython), ExampleGallery, WorkflowTemplates.

---

### Phase 5 — Orchestrator/brain deep integration, cleanup, verification ✅
- **Deterministic brain calibration:** `compute_calibration()` in
  `agents/deterministic-brain/brain/metacognition.py` audits stated confidence
  vs real outcomes (accepted-rate per confidence band + per finding type) and
  emits `recommended_reliabilities` to retune `TYPE_RELIABILITY`. Exposed via
  `GET /brain/calibration`, `python main.py --brain-calibration`, and a test
  suite (`tests/test_calibration.py`). This closes the metacognitive loop.
- **Regression sweep:** reviewed `analytics.ts`, `weakness-scoring.ts`,
  `memory-intelligence.ts`, `index.ts`, `roster-stats.ts`, `benchmarking.ts`.
  The remaining hand-rolled formulas are domain logic with specific semantics
  (risk multipliers, decay policies, composite weights) — no mathx swap is
  strictly better without changing behavior, so they were kept and this is
  documented rather than churned.
- **Cleanup:** the upstream math-x temp clone was deleted (archived at
  `docs/mathx-source-reference/`); `docs/mathx.md` operator guide written;
  README/CONTRIBUTING updated; full TS + Python gates re-run.

---

## 6. Known bugs carried over from Math X — fix list

1. OCR: unify field name to `data` + `mediaType` server-side and client-side.
2. Literature RAG: correct endpoint to `/api/math/literature/search`.
3. Export: only `markdown|latex|jupyter|plain` (drop phantom DOCX).
4. No error leaking: use `sanitizeError` from `api-auth.ts` in every new route.
5. Mount real per-route rate limits using Draymond's `rate-limiter.ts` (skip Math X's dead
   limiter file).

---

## 7. Verification strategy (every phase)

```bash
npm run type-check   # tsc --noEmit
npm run lint         # eslint
npm test             # vitest (all suites)
npm run test:coverage # enforce thresholds incl. src/lib/mathx/**
npm run build        # next build (end of Phases 3–5)
scripts/mathx-smoke.mjs  # curl smoke across /api/math/* (end of Phase 2+)
```

Coverage note: formulas in `stats.ts`/`optimize.ts`/`verify.ts` are tested against
hand-computed values (e.g. `betaPosterior(9,1,1,1)` mean = `10/12`, EWMA against a known
series), not just property checks — this is what "mathematically astute" means at the test
level.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Pyodide/CDN availability offline | Workers already load from jsDelivr; add a cached-service-worker fallback in Phase 4; the TS path keeps the brain functional offline regardless. |
| Bundle size from ECharts/Plotly/IGV/NGL | All lazy-imported; `next/dynamic` with `ssr:false`; IGV/NGL behind feature flags. |
| Coverage gate broken by new modules | Add `src/lib/mathx/**` to include and write real formula tests in Phase 1 (before any UI). |
| LLM cost creep from math routes | All math routes reuse `callLLM` → budget-gated; `MODE_MAX_TOKENS` caps every call; Phase 1 tokenizer budgets day-plan runs. |
| Two compute paths diverge | Single formula source in `stats.ts`; WASM path only *renders/explores*; any number a cron uses comes from TS. |
| Vision API (OCR) adds a surface | Extend `llm.ts` images option with provider guards; OCR route degrades to an explicit 400 if no vision-capable provider is configured. |

---

## 9. Rollback

Phase-gated commits on `feat/mathx-embed`. Any phase can be reverted independently
(`git revert <phase-tag>`). The math-x snapshot zip in `docs/` preserves the upstream source
for future reference. The original Draymond behavior is retained wherever a mathx
replacement is gated behind an env flag (`MATHX_MODE=off` restores the hand-rolled path for
`confidence`/`brain` during the transition).
