# Draymond Orchestrator

**The central nervous system for the Overlay Ecosystem's AI agents.**

Draymond is not a DevOps control panel. It is an **autonomous business & agent orchestration platform** — part Marvel-style character roster dashboard, part self-healing fleet manager, part mission-control for a real business pipeline. Every AI agent, tool, skill, and service in the ecosystem gets a character bio card with capabilities, status indicators, and invocation controls. Underneath, a 24/7 scheduler, in-process cron engine, monitor fleet, self-repair loop, LLM router, and a cash-aware business pipeline run continuously.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
[![CI](https://img.shields.io/github/actions/workflow/status/ncsound919/Draymond-Orchestrator/ci.yml?label=CI)](https://github.com/ncsound919/Draymond-Orchestrator/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-1688%20passing-brightgreen)](https://github.com/ncsound919/Draymond-Orchestrator/actions)
![Coverage](https://img.shields.io/badge/coverage-69%25%20lines-yellow)

## 📦 Releases

Desktop installers (Windows / macOS / Linux) are published on the
**[GitHub Releases page](https://github.com/ncsound919/Draymond-Orchestrator/releases)**.
Each release is built and tested automatically by CI.

---

## Getting Started

```bash
git clone https://github.com/ncsound919/Draymond-Orchestrator.git
cd Draymond-Orchestrator
cp .env.example .env.local   # fill in your values
npm install
npm run dev                  # http://localhost:3444
```

Prerequisites: **Node.js 20.19+**. The app uses a local SQLite database (created
automatically on first boot at `data/draymond.db`) and a local admin login — no
cloud accounts or hosted services required. On first login the admin account is
bootstrapped from `DRAYMOND_ADMIN_EMAIL` / `DRAYMOND_ADMIN_PASSWORD` in
`.env.local` (or a generated password printed to the server console).

Key configuration: `CRON_SECRET` (admin API), `CORS_ORIGIN` (allowed browser
origins), LLM keys (`DEEPSEEK_API_KEY`, `OPENCODE_API_KEY`, `GEMINI_API_KEY`,
`ANTHROPIC_API_KEY`, `QWEN_API_KEY`), and `ALLOW_LOCAL_AGENTS=1` for local agent
fleets.

## Testing

```bash
npm run lint            # ESLint
npm run type-check      # tsc --noEmit
npm test                # 1688 tests across 185 files
npm run test:coverage   # Coverage enforced on src/lib/draymond/**
```

Coverage thresholds (`vitest.config.ts`): lines 69 / statements 67 / functions 68 /
branches 55 — measured on `src/lib/draymond/**/*.ts` and `src/lib/mathx/**/*.ts`
(the orchestration core: chains, scheduler, monitors, invoker, router, registry,
confidence, llm, Kairos, service-manager, mission, treasury).

---

## Local Database & Auth

Draymond stores all state in a single **SQLite** file (`data/draymond.db`) via
`better-sqlite3`. The `src/lib/db/` module provides a supabase-js-compatible
query builder, so the ~150 existing `supabase.from('table').select()...` call
sites work unchanged.

- **Auth:** email + password login against the `local_users` table. Sessions are
  256-bit random tokens stored in `local_sessions` and carried in an httpOnly
  cookie. The admin account is bootstrapped on first login from
  `DRAYMOND_ADMIN_EMAIL` / `DRAYMOND_ADMIN_PASSWORD`.
- **Login:** `http://localhost:3444/login`. Sign out from the header.
- **Releases:** release binaries are served from `data/paid-releases/` (or
  `DRAYMOND_RELEASES_DIR`) by `/api/downloads/*`, gated by the local session +
  a `purchases` row.

### Migrating existing Supabase data

If you previously hosted Draymond on Supabase, dump once, then import:

```bash
node scripts/import-from-supabase.mjs dump    # fetch draymond_* rows + release files → ./data/
node scripts/import-from-supabase.mjs import  # load the dump into the local SQLite DB
```

The dump reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from
`.env.local` over the PostgREST/Storage REST APIs (no SDK dependency). Start the
app once before `import` so the schema exists.

### Admin password

Set a known password before the first login:

```bash
node scripts/create-admin.mjs admin@example.com 'your-strong-password'
```

### Roster Benchmark (RepoRank + Grader)

The **Roster Benchmark** job (`benchmark_roster`, runs daily at 06:30) deep-scores
every pictured agent's GitHub repo with **RepoRank** and **Grader** (plus optional
**Vibe-Reality**), records the stats in `draymond_benchmarks`, and queues the
weakest agents in `draymond_upgrade_queue`. The self-learning loop and repair
team then work on those agents in the background.

Configure the scorer servers in `.env.local` (canonical ports moved to 3200/3201):

```bash
REPORANK_URL=http://localhost:3200
REPORANK_API_KEY=your-reporank-api-key
GRADER_URL=http://localhost:3201
GRADER_API_KEY=your-grader-api-key
# optional
VIBE_REALITY_URL=
VIBE_REALITY_ID_TOKEN=
```

Agent → repo mapping lives in `src/lib/draymond/roster-repos.ts`. When a scorer
server is unreachable it fails soft and the benchmark records "no deep scores".

---

## Core Capabilities

### Autonomous Scheduler & Boot Catch-up

An **in-process cron engine** (1-minute tick) drives **60+ scheduled jobs** across
`chain`, `health_check`, `notification`, `decay_sweep`, and `custom` types. On
startup a **boot catch-up pass** runs jobs that were missed while the server was
offline (within a 24h horizon) — when Draymond starts, the work begins. The
Schedules dashboard (`/schedules`) offers live controls: **Catch up missed** and
**Re-run failed (N)** in one click.

Jobs are organized into a **day-phase orchestration plan** (`day-orchestrator.ts`):
morning → midday → evening → night, each grouping the jobs that must run together
in order, with a delegation plan enforcing per-component time windows, run
durations, per-run token budgets, and a shared fleet-wide daily token cap.

### Fleet Service Management (`service-manager.ts`)

Draymond doesn't just *monitor* the fleet — it **starts, health-checks, and
restarts** its own services. A canonical port registry (`ports.ts`, 66 services)
plus curated start recipes let the repair team actually FIX `fetch failed` jobs
by booting the down service. The boot sequence (`bootstrap.ts`) auto-starts the
core fleet: deterministic brain, BookBridge, **Uplift Agent (Hermes bridge)**,
**opencode**, Sports Steve, Social Media Dashboard, Hemp-OS, HempForge.

### Uplift Agent — Hermes fork bridge (`agents/Uplift-Agent`)

The Uplift Agent is a **Hermes-fork HTTP bridge** on `:8000` implementing
`/health`, `/task`, `/batch/multi`, `/task/:id`, `/session/:id`. It reuses the
ecosystem's Hermes agent loop (in `hermes-proxy/`) with tools, memory, and
skills — so Draymond's codegen fallback chain routes to a real agent, not a stub.

### LLM Router & Fallback Chain (`llm.ts`)

Every LLM call flows through a provider chain: **opencode free →
opencode Go (`deepseek-v4-flash` 0731) → DeepSeek direct → Gemini → Ollama →
OpenAI/Anthropic/Qwen**, whichever is configured and healthy. Structured JSON
output, image inputs, native reasoning modes, per-mode token budgets, and a
deterministic fallback string keep pipelines from stalling on an LLM outage.

### Intelligent Task Router (`router.ts`)

An LLM-powered **intent classifier** turns natural-language task descriptions
into a `RouteResult` (entity, chain, or query intent) with confidence and
alternatives — no need to type explicit slugs.

### Kairos — Always-on Proactive Daemon (`kairos.ts`)

A 5-minute tick scans the whole fleet for **kairos moments** — down monitors,
failed jobs, stale leads, revenue shortfall, budget pressure, weak agents,
repair loops, stale heartbeats, stale experiments. Moments are **deduped by
normalized hash** (so a monitor that stays down doesn't spam), ranked
critical → info, pushed to ntfy, and rolled into an optional daily digest.

### Self-Healing & Repair (`self-repair.ts`, `repair-team.ts`, `coding-repair.ts`)

- **Self-Repair Check** — detect failure signals, apply safe deterministic
  repairs (restart service, re-run job, clear cache); unknown failures escalate
  to on-call. A **failure-loop guard** stops blind re-repairs.
- **Repair Team** — scans failed jobs and dispatches the coding crew
  (**opencode** → **Uplift Agent** → deterministic plan) to patch them.
- **Service Health Repair** — probes the ecosystem and auto-starts down services.

### Self-Learning Loop (`self-learning.ts`, `learning-repair.ts`)

Every job/QA run/incident/repair is logged as an **outcome**; the loop clusters
them into **lessons** ("what worked / what broke") that future runs reference,
and proven repairs are registered so the fleet improves without code changes.

### Mission Control & Business Pipeline

- **Business pipeline** (`business-pipeline.ts`) — opportunities through
  lead → proposal → negotiation → won → delivering → invoiced → paid, against
  a monthly revenue target (evidence-based: only settled cash counts).
- **Mission dashboard** (`mission-pipeline.ts`, `mission-strategy.ts`) — invoice
  ledger + stage automaton across 4 service lines (audit, MaaS, research,
  aetherdesk), with a weekly strategy memo.
- **Treasury** (`treasury.ts`) — pulls **settled Stripe charges** via REST,
  updates revenue-to-date, fires sale alerts; never estimates.
- **Ventures** (`ventures.ts`) — the Strategist composes new ventures as chain
  recipes; low/medium-risk auto-run, high/critical require human approval.
- **Sales alerts** — every new settled charge pings ntfy + email in real time.

### Cognition Layer (`cognition.ts`, `dream-cycle.ts`, `ultraplan.ts`)

- **AutoDream** — gated 4-phase memory consolidation ("your AI organizes its
  notes while you sleep"): lock → time → sessions → idle gates.
- **Ultraplan** — deep-planning queue (draft → critique → revise) with an
  approval workflow.
- **Memory decay sweep** — prunes/expires stale memory rows.

### Observability & Analytics (`analytics.ts`, `metrics.ts`)

Performance leaderboard, execution heatmaps, cost tracking, latency percentiles,
and Prometheus metrics (`/api/ops/metrics`) for the whole orchestration system.

### Human-in-the-Loop Approvals (`ntfy.ts`, `/approvals`)

Confidence-gated actions publish an **ntfy push** with Approve/Reject buttons;
Open-Chat renders them and POSTs back with a single-use review token. The
Approvals dashboard manages the queue.

### Communications (`communicator.ts`)

Per day-phase **recaps** (money, issues, insights, upgrades) are built, saved,
pushed to Open-Chat, emailed, and prepared for a **voice call** via AetherDesk.
News ingestion (`news.ts`) pulls NEWSAPI/GNews/WorldNews for the daily digest.

### Worker Task Queue (`worker-tasks.ts`)

Tasks the boss assigns to remote workers (Open Chat): queued → claimed →
completed | failed, with skill-pack payloads.

### Systematic Interconnection (`systemic.ts`)

A single event-bridge choke point auto-wires every subsystem event into memory,
self-learning outcomes, the knowledge graph, and agenda goals — no per-tool
integration needed.

### Big Homie Supervisor (`supervisor.ts`)

A quality gate applied *after* a task produces output: results are checked
against acceptance criteria and rejected back to the worker when they miss.

### Dashboard Pages

`/` → Operations (redirect) · `/agents` bios & invocation · `/chains` workflow templates ·
`/schedules` job management with catch-up/rerun controls · `/operations` fleet
monitoring · `/approvals` human review · `/cognition` Kairos/AutoDream/Ultraplan ·
`/mission` business pipeline & strategy · `/benchmarks` roster scoring ·
`/ide` agent coding sessions (live SSE, pause/redirect/approve) · `/strategy`
Strategy Team runner · `/math` Math Lab · `/chat` conversations ·
`/downloads` release binaries.

### Health Monitoring

Continuous health checking for every registered agent, plus **heartbeat sweeps**
(`heartbeat.ts`) that probe each catalogued service and persist real liveness to
the file-based registry so status survives restarts.

---

## Entity Registry (`seed.ts`)

120+ registered entities across seven kinds:

| Kind | Description | Examples |
|------|-------------|----------|
| `agent` | Autonomous AI agents | Uplift Agent, Sports Steve, Sub Team, OmniResearch Pro, Hermes Agent |
| `tool` | Callable utilities and assistants | Megacode, Social Media Dashboard, TradingAgents |
| `skill` | Composable agent capabilities | Superpowers skills, Claude skills, OpenClaw curated |
| `extension` | IDE and platform integrations | VS Code extensions, browser integrations |
| `mcp_server` | Model Context Protocol servers | MCP tool servers |
| `service` | Infrastructure services | API gateways, databases, auth providers |
| `pipeline` | Multi-step processing chains | Batch runners, data pipelines |

### Business Chains (`business-chains.ts`)

30+ chain templates for multi-agent workflows, including:

| Chain | Agents Involved | Purpose |
|-------|----------------|---------|
| CPU RTL Generation Pipeline | Sub Team agents | Deterministic CPU design from spec to verified Verilog |
| Code Automation Pipeline | Megacode + Uplift Agent | Multi-provider code completion with quality scoring |
| Book-Grounded Research | BookBridge + research agents | Research answered from the library |
| Research Data Pipeline | OmniResearch Pro + Uplift Agent | Deep research with source synthesis |
| Sports Betting Daily | Sports Steve + Bet Buddy + TradingAgents | Daily sports analysis with betting signals |
| Music Business Automation | Indy Music Platform + Social Media Dashboard | Independent music curation and promotion |
| Daily Marketing Run | Social Media Dashboard + Uplift Agent | Content generation and scheduling |
| Supply Chain Intelligence | Overlay Chain | Cross-chain supply-chain operations |
| Hemp Research & News | Hemp-OS + news ingest | Research + news pipeline |
| IP Portfolio Grading | Overlay IP engine | Grade and protect IP |
| Morning Briefing | Fleet | Day-start briefing for all agents |

### Scheduled Jobs

60+ automated jobs: site health checks (every 5 min), brain decision cycle
(every 30 min), heartbeat + Kairos scans (every 15 min), fleet duty sync,
self-repair + service health repair (hourly), daily news digest, market data
snapshot, phase recaps (morning/midday/evening/night), treasurer cash pulse,
mission pipeline sync, dream cycle, ultraplan process, night-mode R&D, weekend
ops review, and more.

### Invocation System

Draymond invokes registered entities through three mechanisms:
- **REST API** — HTTP endpoints for request/response workflows
- **Subprocess** — Direct process spawning for local agents
- **SDK calls** — Programmatic integration for tightly-coupled services

---

## Registered Agents

| Agent | Slug | Kind | Description |
|-------|------|------|-------------|
| Uplift Agent | `uplift-agent` | `agent` | Hermes-fork coding agent bridge (port 8000, /task + /batch/multi) — the codegen fallback behind opencode |
| Hermes Agent | `hermes-brain` | `agent` | The real NousResearch Hermes mission brain (OpenAI SSE on 8642) |
| Sports Steve | `sports-steve` | `agent` | Sports analytics and prediction agent (FastAPI on 8010) |
| Sub Team | `sub-team` | `agent` | Deterministic CPU design pipeline (4 sub-agents) |
| Megacode | `megacode` | `tool` | Multi-LLM coding assistant with provider routing |
| OmniResearch Pro | `omniresearch-pro` | `agent` | Deep research and synthesis agent |
| Social Media Dashboard | `social-media-dashboard` | `tool` | Social media management and analytics (FastAPI on 8030) |
| Indy Music Platform | `indy-music-platform` | `tool` | Independent music discovery and promotion |
| TradingAgents | `trading-agents` | `agent` | Market analysis and trading strategy agent |
| Overlay Chain | `overlay-chain` | `service` | Cross-chain blockchain infrastructure |
| Deterministic Brain | `deterministic-brain` | `agent` | Metacognitive observer + reasoning engine (port 3210) |
| BookBridge | `bookbridge` | `service` | Book synthesis engine / library grounding (port 8777) |
| RepoRank | `reporank` | `tool` | Repo depth scoring (port 3200) |
| Grader | `grader` | `tool` | Data-backed grading (port 3201) |
| Codegang | `codegang` | `tool` | Local deep analysis + agent pipeline (port 3204) |

The full canonical port registry lives in `src/lib/draymond/ports.ts` (66 services).

---

## Math Lab

An embedded cross-domain mathematics workspace (ported from **Math X**) at
`/math`: Probability Lab, Formula Lab, Hypothesis, Deep Solve, Synergy, and
Domain Expert modes with local **Pyodide/WASM** (NumPy/SciPy/SymPy), DuckDB
analytics, OCR image → LaTeX, literature RAG (PubMed/arXiv), bio lookup
(NCBI/UniProt), proof verification, and session export/share.

- **API:** `src/app/api/math/*` — 17 session-authed routes (plan, codegen,
  verify, hypothesis, analogies, domain, export, ocr, literature, bio, models,
  chat). All LLM calls flow through Draymond's `callLLM` fallback chain with
  per-mode token budgets.
- **Math core:** `src/lib/mathx/` — pure-TS stats (Bayesian posterior, EWMA,
  CUSUM, EV ranking) shared by the orchestrator, the deterministic brain, and
  the Math Lab. Python mirror in `agents/deterministic-brain/brain/mathx.py`.
- See `docs/mathx.md` for the operator guide and `MATH-X-INTEGRATION-PLAN.md`
  for the full integration spec.

---

## How It Works

```
Draymond Dashboard (Next.js)
├── Character Roster UI          # Marvel-style bio cards for every entity
├── Entity Registry (seed.ts)    # 120+ entities with slugs, kinds, capabilities
├── Business Chains              # 30+ multi-agent workflow templates
├── In-process Scheduler         # 60+ cron jobs + boot catch-up + day phases
├── Service Manager              # start / health-check / restart the fleet
├── Health Monitor + Heartbeats  # real-time status for every service
├── Kairos                       # 5-min proactive fleet scan (deduped alerts)
├── Self-Repair + Repair Team    # auto-fix failures, escalate unknowns
├── LLM Router                   # opencode → deepseek → gemini fallback chain
├── Mission Control              # pipeline, treasury, ventures, KPIs
├── Cognition                    # AutoDream / Ultraplan / memory decay
└── Invocation Layer             # REST / subprocess / SDK dispatch
```

The dashboard renders each registered entity as a character card. Clicking a card
shows the entity's full bio, capabilities, health status, recent invocations, and
chain memberships. Chain templates can be triggered manually, run on schedule, or
be routed by natural language through the intelligent task router.

---

## Tech Stack

- **Framework:** [Next.js 16](https://nextjs.org/) (App Router, TypeScript)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/)
- **Fonts:** Inter (body), Space Grotesk (headings)
- **Backend:** Local SQLite (better-sqlite3) + local admin sessions — fully private, zero cost, runs 24/7 inside the app process
- **Architecture:** Server components for dashboard, SSG for public pages

### Brand Colors

| Token | Value | Usage |
|---|---|---|
| Background | `#0a0a0a` | App/page background (dark theme) |
| Surface | `rgba(255,255,255,0.05)` | Cards, panels, nav hover |
| Primary Green | `#22c55e` | CTAs, healthy status, success |
| Accent Gold | `#c8a415` | Warnings, highlights, mid scores |
| Danger Red | `#ef4444` | Errors, failed status, worst scores |

---

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3444](http://localhost:3444).

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `DRAYMOND_DB_PATH` | Path to the SQLite file (default `./data/draymond.db`) |
| `DRAYMOND_ADMIN_EMAIL` | Local admin login email (bootstrap) |
| `DRAYMOND_ADMIN_PASSWORD` | Local admin login password (bootstrap) |
| `DRAYMOND_RELEASES_DIR` | Directory served by `/api/downloads/*` (default `./data/paid-releases`) |
| `CRON_SECRET` | Protects `/api/cron`, `/api/seed`, `/api/monitors/check`, etc. |
| `OPENCODE_API_KEY` | Primary LLM provider (OpenCode Zen — free + Go tiers, deepseek-v4-flash) |
| `DEEPSEEK_API_KEY` | DeepSeek direct fallback |
| `GEMINI_API_KEY` | Gemini fallback |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `QWEN_API_KEY` | Optional further fallbacks |
| `ALLOW_LOCAL_AGENTS=1` | Allow local fleet agents over localhost |
| `UPLIFT_BASE_URL` | Uplift Agent base URL (default `http://localhost:8000`) |
| `SPORTS_STEVE_URL` · `SOCIAL_MEDIA_URL` · `BET_BUDDY_URL` | Companion agent URLs |
| `REPORANK_URL` / `GRADER_URL` | Deep-scorer servers for the Roster Benchmark |
| `DRAYMOND_FLEET_DAILY_BUDGET` | Fleet-wide daily token cap (default 5M) |
| `DRAYMOND_SCHEDULER_TICK_MS` | Scheduler tick (default 60s) |
| `DRAYMOND_BOOT_CATCHUP_HORIZON_MS` | Boot catch-up window for missed jobs (default 24h) |

The legacy `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` variables are
kept in `.env.example` only for the one-time data migration
(`node scripts/import-from-supabase.mjs dump`). See `scripts/` for details.

---

## Project Structure

```
├── src/
│   ├── app/                     # Next.js App Router pages
│   │   ├── page.tsx             # Dashboard home (redirects to Operations)
│   │   ├── agents/              # Agent roster and detail pages
│   │   ├── workflows/           # Workflow builder and runner
│   │   ├── chains/              # Chain templates
│   │   ├── operations/          # Operations / fleet monitoring
│   │   ├── schedules/           # Scheduled jobs (catch-up + re-run controls)
│   │   ├── approvals/           # Human-in-the-loop approval queue
│   │   ├── cognition/           # Kairos / AutoDream / Ultraplan
│   │   ├── mission/             # Business pipeline & strategy
│   │   ├── benchmarks/          # Roster benchmark scores
│   │   ├── ide/                 # Agent coding sessions (live SSE)
│   │   ├── strategy/            # Strategy Team runner
│   │   ├── math/                # Math Lab workspace
│   │   ├── chat/                # Conversations
│   │   └── api/                 # ~185 API routes (see below)
│   ├── components/
│   │   ├── Header.tsx           # Dashboard navigation
│   │   ├── registry/            # Agent bio card components
│   │   └── ...
│   ├── lib/
│   │   ├── draymond/            # Core orchestration logic (90+ modules)
│   │   │   ├── scheduler.ts     # In-process cron + boot catch-up + 60+ jobs
│   │   │   ├── service-manager.ts # start/health-check/restart the fleet
│   │   │   ├── kairos.ts        # 5-min proactive fleet scan
│   │   │   ├── self-repair.ts   # auto-repair with failure-loop guard
│   │   │   ├── mission-pipeline.ts # invoices + stage automaton
│   │   │   ├── treasury.ts      # settled Stripe revenue pulse
│   │   │   ├── llm.ts           # opencode → deepseek → gemini fallback chain
│   │   │   ├── day-orchestrator.ts # daily phase plan + runner
│   │   │   ├── ports.ts         # canonical fleet port registry (66 services)
│   │   │   ├── seed.ts          # entity registry (120+ entities)
│   │   │   └── business-chains.ts # 30+ chain templates
│   │   ├── mathx/               # Pure-TS stats + token budgeting
│   │   ├── db/                  # Local SQLite data layer + auth
│   │   └── ide/                 # opencode client, codegang, session recovery
│   ├── instrumentation.ts       # Boot: scheduler, bootstrap, cognition, Sentry
│   └── proxy.ts                 # Next.js proxy: session gate + API CORS
├── agents/
│   ├── Uplift-Agent/            # Hermes-fork HTTP bridge (port 8000)
│   └── ...                      # ecosystem agent checkouts
├── scripts/                     # ops, admin, import, seed, start scripts
├── supabase/
│   └── migrations/              # Legacy Postgres schema (for reference only)
└── public/                      # Static assets
```

### API surface (highlights)

- `POST /api/cron` · `POST /api/seed` — external triggers (Bearer `CRON_SECRET`)
- `GET|POST /api/ops/*` — services, heartbeats, brain, budget, delegation,
  learning, repair, repair-team, api-keys, news, metrics, day, rd-night, catalog
- `GET|POST /api/v1/*` — agents, chains, schedules, workflows, analytics,
  benchmarks, science (goals/experiments/simulations), sports, biotech,
  translate, voice, worker, health, status, memory
- `/api/auth/login|logout` · `/api/agents/*` · `/api/chains/*` ·
  `/api/monitors/*` · `/api/cognition/*` · `/api/mission/*` ·
  `/api/math/*` (17 routes) · `/api/business/*` · `/api/ventures/*`

## Key Files

- `src/lib/draymond/seed.ts` — Entity registry defining all agents, tools, skills, services, and pipelines
- `src/lib/draymond/business-chains.ts` — Multi-agent chain templates connecting entities into workflows
- `src/lib/draymond/scheduler.ts` — In-process cron engine, boot catch-up, and 60+ scheduled jobs
- `src/lib/draymond/service-manager.ts` — Start / health-check / restart the fleet
- `src/lib/draymond/kairos.ts` — Always-on proactive fleet scanner
- `src/lib/draymond/llm.ts` — Provider-agnostic LLM fallback chain
- `src/lib/draymond/ports.ts` — Canonical fleet port registry (66 services)
- `src/instrumentation.ts` — Boot sequence: scheduler, bootstrap, cognition, Sentry
- `agents/Uplift-Agent/server.js` — Hermes-fork Uplift Agent HTTP bridge
- `scripts/start-tools.ps1` — Boot the internal tool stack on canonical ports
- `Scaffold` — Full platform architecture and development blueprint
- `supabase/migrations/` — Database schema and security policies

---

## The Uplift Ecosystem

Draymond Orchestrator manages the following ecosystem:

- **Uplift Agent** — Hermes-fork coding agent HTTP bridge (port 8000), the codegen fallback behind opencode
- **Hermes Agent** — NousResearch Hermes mission brain (port 8642), Open-Chat's fleet brain
- **Sports Steve** — Sports analytics and prediction agent (port 8010)
- **Sub Team** — Deterministic CPU design pipeline ([github.com/ncsound919/Sub-Team](https://github.com/ncsound919/Sub-Team))
- **Megacode** — Multi-LLM provider-agnostic coding assistant
- **OmniResearch Pro** — Deep research and synthesis agent
- **Social Media Dashboard** — Social media management and analytics (port 8030)
- **Indy Music Platform** — Independent music discovery and promotion
- **TradingAgents** — Market analysis and trading strategy agent
- **Overlay Chain** — Cross-chain blockchain infrastructure
- **Deterministic Brain** — Metacognitive observer + reasoning engine (port 3210)
- **BookBridge** — Book synthesis engine / library grounding (port 8777)
- **The Uplift Lab** — Community empowerment platform ([github.com/ncsound919/The-Uplift-Lab](https://github.com/ncsound919/The-Uplift-Lab))

Each tool works standalone. Draymond adds centralized monitoring, multi-agent chain
workflows, scheduled job management, self-repair, and a cash-aware mission
pipeline — but connection is always optional.

### Fleet ports (canonical)

`src/lib/draymond/ports.ts` is the single source of truth. Highlights:

| Port | Service | Port | Service |
|------|---------|------|---------|
| 3444 | Draymond Orchestrator | 3200 | RepoRank |
| 4000 | Mutly | 3201 | Grader |
| 4096 | opencode serve | 3204 | Codegang |
| 3210 | Deterministic Brain | 3600 | VibeServe |
| 8000 | Uplift Agent (Hermes) | 3700 | AgentBrowser |
| 8010 | Sports Steve | 8777 | BookBridge |
| 8030 | Social Media Dashboard | 8642 | Hermes Brain |
| 8648 | Hermes Proxy (media/voice) | 8650 | Squad Service |


