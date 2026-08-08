# Mission Engine — Design Spec

**Date:** 2026-08-08
**Status:** Approved for implementation
**Scope:** Unify Draymond Orchestrator into a single business ecosystem: revenue-driving chained automations + configured financial strategy, built entirely on existing rails (no new third-party stacks).

---

## 1. Context & Reality Check

The ecosystem has a rich but *dev-oriented* fleet: 10+ agents live on localhost, a chain
engine, an in-process cron scheduler, a Treasurer, and a JSON business pipeline. Hard truths
established during audit:

1. **Revenue is $0.** Treasury ledger shows zero settled; `STRIPE_SECRET_KEY` is not configured.
   Three pipeline opportunities are `lead` stage only — pipeline is not money.
2. **The fleet is a dev environment, not a business.** Most agents run on `localhost:*`.
3. **The $33k/mo target in `MISSION.md` is fiction at current state** — no clients, no deployed
   product, no payment rail. `ENGINE_TARGETS` in `business-pipeline.ts` hardcode 10k/12k/6k/5k.
4. **The bottleneck is distribution + commerce, not automation.** Chains exist and agents are
   online. Missing: *orders* and *a way to get paid*.
5. **Several MISSION.md engines are not deliverable today** (Aetherdesk GA, platform tiers,
   music-rights, sports/trading).

**Consequence:** this project re-baselines targets to an evidence-based plan and wires the
automation to the actual bottleneck: pipeline → close → deliver → invoice → paid.

## 2. Goals

- **Chained automations** that drive the business: 3 revenue delivery chains using online agents only.
- **Configured financial strategy**: service catalog, pricing tiers, per-service monthly targets,
  unit economics, cash model — replacing the hardcoded $33k fiction.
- **Pipeline automaton**: opportunities advance from `won` to `paid` *from chain outcomes*.
- **Weekly strategy feedback loop**: pipeline + revenue + delivery vs target → strategy memo.
- **Zero new third-party stacks.** Stripe remains the payment rail; deliverables use existing
  `pdf`/`xlsx`/`ppt`/`charts` skills; notifications use ntfy/nodemailer/Open-Chat.

## 3. Service Catalog (configured financial strategy)

| ID | Service | Agents (all online) | Tiers (USD) | Est. delivery cost | Monthly target (day 90) |
|---|---|---|---|---|---|
| `aetherdesk` | **Aetherdesk AI Call Center** (flagship, E2) | Aetherdesk platform + its own Stripe webhook billing | Rental periods: hour 2.00 · 4hr 7.20 · day 13.30 · week 64 · **month 239** · quarter 644 · 6mo 1,204 · year 2,239; overage 0.03–0.05/min; top-ups 100–5000 min | infra + LLM ~0.01/min | **$1,000** (a few rentals + top-ups) |
| `maas` | Marketing-as-a-Service | Observer/SMD, OmniResearch, Megacode, Uplift Agent | Starter 500 · Growth 1,000 · Scale 1,500 /mo | ~$15–30 tokens | **$2,000** (2 clients) |
| `audit` | Codebase Audit & QA | Grader, RepoRank, Claw-Protect, Uplift Agent | Standard 250 · Deep 500 · Enterprise 1,000 /audit | ~$5–10 | **$1,000** (2–4 audits) |
| `research` | Research Briefs | OmniResearch, Kaggle/brain, Uplift Agent | Brief 500 · Deep 1,000 · Custom 2,000 /brief | ~$8–20 | **$1,000** (1–2 briefs) |

**Total: $5,000/mo run-rate by day 90.** First dollar by day 30. Runway model computes the
required daily run-rate from revenue-to-date.

**Aetherdesk pricing discipline:** deliberate low-price volume model — ~$2.00 per 40
agent-minutes at the hour tier, discounted per period (4hr −10%, day −17%, week −20%, month
−25%). Overage billed per minute (DeepSeek $0.05, BYOK $0.03). Revenue for `aetherdesk` is
settled Stripe charges from `checkout.session.completed` (its existing webhook) — the mission
engine attributes those charges to the `aetherdesk` service line, it does not re-invent billing.

### 3.1 Pricing catalog ↔ Stripe

Each tier maps to a Stripe product + price (`price_*`) via `metadata.service = <id>`:
- `maas` tiers are **recurring subscriptions** (monthly).
- `audit` / `research` tiers are **one-time payments**.
- `aetherdesk` rental periods + top-up packs are **one-time payments** (created on the
  Aetherdesk product); its own webhook activates the rental window and credits minutes.

All prices were created live via the Stripe CLI on 2026-08-08 (see `.draymond/stripe-pricing.json`
for IDs). Metadata `service` on each price keeps the Treasurer's `platformFromMetadata` attribution
working; `metadata.service` is recorded on invoices.

## 4. Architecture

### 4.1 New modules (`src/lib/draymond/`)

1. **`mission-strategy.ts`** — config + JSON state (`.draymond/mission-strategy.json`).
   - `ServiceLine`: `id`, `name`, `agents[]`, `skills[]`, `tiers[]` (`{id,name,priceCents,billing}`),
     `deliveryCostCents`, `targetMonthly`, `wonCount`.
   - `MissionStrategy`: `services[]`, `totalMonthlyTarget`, `firstDollarByDay`, `runwayDays`,
     `updatedAt`.
   - Reads/writes follow the `business-pipeline.ts` JSON-state pattern (`DRAYMOND_REGISTRY_DIR`).
   - `serviceTargets()` feeds `business-pipeline.ts` so engine targets become strategy-driven.

2. **`mission-chains.ts`** — 3 chain template definitions (structure matches `business-chains.ts`):

   **`maas-monthly-cycle`**
   1. Research Trends → `omni-research` (`trending_topics`)
   2. Draft Content → `social-media-dashboard` (`generate_text`)
   3. Generate Assets → `social-media-dashboard` (`generate_image`) [parallel]
   4. **QA Gate** → `megacode` (`review`) on content/assets
   5. Compile Client Package → `uplift-agent` (`batch` → `compile_maas_package`) → PDF deliverable
   Output: `{ invoiceReady: true, opportunityId, deliverablePath }`

   **`audit-delivery`**
   1. Grade Repo → `grader` (`grade`)
   2. Deep Score → `reporank` (`score`) + Security Scan → `claw-protect` (`security_scan`) [parallel]
   3. **QA Gate** → `grader` (`grade`) re-verify
   4. Compile Audit Report → `uplift-agent` (`batch` → `compile_audit_report`) → PDF deliverable
   Output: `{ invoiceReady: true, opportunityId, deliverablePath }`

   **`research-brief-delivery`**
   1. Deep Research → `omni-research` (`research_news`)
   2. Data Feed → `kaggle` (`research_feed`) [parallel, optional]
   3. Synthesize Brief → `uplift-agent` (`batch` → `compile_research_brief`; market-research-reports skill)
   4. Compile PDF Brief → `uplift-agent` (pdf skill)
   Output: `{ invoiceReady: true, opportunityId, deliverablePath }`

3. **`mission-pipeline.ts`** — stage automaton + invoices.
   - Extends `OpportunityStage`: `lead | proposal | negotiation | won | delivering | invoiced | paid | lost`.
   - `dispatchDelivery(opportunityId)` → runs the service's chain via `instantiateChain`/`executeChain`,
     on `invoiceReady` advances `won → delivering → invoiced`, writes `.draymond/invoices.json`
     (`{id, opportunityId, serviceId, tierId, amountCents, status: "open"|"paid", stripeChargeId?}`).
   - `recordInvoiceSettled(chargeId, amountCents, serviceId)` → marks invoice `paid`, advances
     `invoiced → paid`, attributes revenue to the service line.
   - Aetherdesk charges (rentals/top-ups) carry `metadata.service = aetherdesk` from its own
     webhook — the mission engine attributes them to the `aetherdesk` line via
     `recordInvoiceSettled` on `checkout.session.completed` (no separate invoice needed).
   - `missionDashboard()` → unified KPI: strategy + pipeline + treasury + delivery stats + velocity
     (leads/wk, win rate, won→paid days).

4. **`mission-delivery.ts`** — dispatch glue: maps `serviceId → chainSlug`, validates the
   opportunity is `won`, runs the chain, advances stages, records self-learning outcomes.

### 4.2 Modified modules

- **`business-pipeline.ts`** — extend `OpportunityStage`; make `byEngine`/targets read service
  targets from `mission-strategy` (fallback to current constants when unset).
- **`scheduler.ts`** — add `custom` handlers + seeded jobs (see §5).
- **`chains-seed.ts`** — seed the 3 mission chain templates (upsert pattern already used).

### 4.3 New API routes (`src/app/api/mission/`)

- `GET  /api/mission/strategy` — service catalog, targets, unit economics, cash model.
- `POST /api/mission/opportunities` — add an opportunity for a service line (reuses `addOpportunity`).
- `POST /api/mission/dispatch` — `{ opportunityId }` → dispatch delivery chain, advance stage.
- `GET  /api/mission/dashboard` — unified KPI snapshot for the dashboard.

## 5. Scheduled Jobs (scheduler `custom` handlers + chains)

| Job | Cron | Handler / type | Purpose |
|---|---|---|---|
| Treasurer pulse *(exists)* | daily | `treasury_pulse` | Settled revenue only |
| `mission_pipeline_sync` | daily 06:00 | custom | Reconcile stages, flag stale leads, velocity KPI |
| `mission_strategy_review` | Mon 08:00 | custom | Pipeline + revenue + delivery vs target → strategy memo (email + ntfy) |
| `mission_run_maas_cycle` | Mon 09:00 | custom | Runs `maas-monthly-cycle` per active MaaS client |
| `audit-delivery` / `research-brief-delivery` | on-demand | API dispatch | Triggered when an opportunity is won |

## 6. Determinism & Honesty Guards

- **Revenue = settled cash only.** Treasurer never fabricates; unconfigured Stripe → `not-configured`.
- **QA gate before `invoiceReady`** in every delivery chain (Grader or Megacode review).
- **No fabricated pipeline.** Opportunities enter via API; `won` requires real add + close.
- Every chain run / stage transition writes a self-learning outcome for the audit trail.
- Pipeline stage names in the UI match the API exactly.

## 7. Stripe Configuration (CLI)

Install Stripe CLI (`winget install Stripe.StripeCLI`), `stripe login` (browser) or use
`STRIPE_SECRET_KEY` via `stripe config` / env. Create one product per service and prices per
tier with `metadata.service`:
- `maas` → recurring monthly prices (50000/100000/150000 cents).
- `audit` → one-time prices (25000/50000/100000 cents).
- `research` → one-time prices (50000/100000/200000 cents).
Set `STRIPE_SECRET_KEY` in `Draymond-Orchestrator/.env.local`. Record created `price_*` ids in
`mission-strategy.json` under each tier.

## 8. Testing

- **`mission-strategy.test.ts`** — config load, defaults, target math, price→service mapping.
- **`mission-pipeline.test.ts`** — stage transitions, invoice write/settle, dashboard KPI.
- **`mission-chains.test.ts`** — templates resolve to registered entities; chain seed upserts.
- Existing suite stays green: `npm run type-check`, `npm test`, `npm run lint`.

## 9. Out of Scope / Deferred

- Overlay platform tiers (Health/Wealth/Justice signups), music-rights, sports/trading monetization.
- Aetherdesk **production GA** (Twilio/FreeSWITCH, tenant onboarding) is outside this build — but its
  **pricing, Stripe catalog, and revenue attribution** are in scope (flagship E2 line).
- Third-party CRM / invoicing / workflow stacks (n8n, Invoice Ninja, Twenty, Ghost, etc.).
- Deploying the fleet to production (separate workstream; mission engine runs on Draymond).

## 10. Acceptance Criteria

1. `GET /api/mission/strategy` returns the 4-service catalog (aetherdesk + maas + audit + research)
   with targets + unit economics.
2. `POST /api/mission/dispatch` runs the correct chain and advances `won → invoiced` on success.
3. A settled Stripe charge flips an invoice `open → paid` and attributes revenue to the service —
   including Aetherdesk rental/top-up charges.
4. Monday 08:00 `mission_strategy_review` produces a memo with pipeline + revenue vs $5k target.
5. All existing 317 tests + new mission tests pass; type-check and lint clean.
