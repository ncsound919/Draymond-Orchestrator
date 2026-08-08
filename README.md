# Draymond Orchestrator

**The central nervous system for the Overlay Ecosystem's AI agents.**

Draymond is not a DevOps control panel. It is a **Marvel-style character roster dashboard** where every AI agent, tool, skill, and service in the ecosystem gets a character bio card with capabilities, status indicators, and invocation controls. Think S.H.I.E.L.D. agent roster, not Kubernetes dashboard.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
[![CI](https://img.shields.io/github/actions/workflow/status/ncsound919/Draymond-Orchestrator/ci.yml?label=CI)](https://github.com/ncsound919/Draymond-Orchestrator/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-317%20passing-brightgreen)](https://github.com/ncsound919/Draymond-Orchestrator/actions)
![Coverage](https://img.shields.io/badge/coverage-75%25%20lines-orange)

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
npm test                # 317 tests across 32 files
npm run test:coverage   # Coverage enforced on src/lib/draymond/**
```

Coverage thresholds (`vitest.config.ts`): lines 75 / statements 70 / functions 75 /
branches 55 — measured on `src/lib/draymond/**/*.ts` (the orchestration core:
chains, scheduler, monitors, invoker, router, registry, confidence, llm).

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

Configure the scorer servers in `.env.local`:

```bash
REPORANK_URL=http://localhost:3001
REPORANK_API_KEY=your-reporank-api-key
GRADER_URL=http://localhost:3000
GRADER_API_KEY=your-grader-api-key
# optional
VIBE_REALITY_URL=
VIBE_REALITY_ID_TOKEN=
```

Agent → repo mapping lives in `src/lib/draymond/roster-repos.ts`. When a scorer
server is unreachable it fails soft and the benchmark records "no deep scores".

---

## Core Capabilities

### Entity Registry (`seed.ts`)

50+ registered entities across seven kinds:

| Kind | Description | Examples |
|------|-------------|----------|
| `agent` | Autonomous AI agents | Uplift Agent, Sports Steve, Sub Team, OmniResearch Pro |
| `tool` | Callable utilities and assistants | Megacode, Social Media Dashboard, TradingAgents |
| `skill` | Composable agent capabilities | Superpowers skills, Claude skills, OpenClaw curated |
| `extension` | IDE and platform integrations | VS Code extensions, browser integrations |
| `mcp_server` | Model Context Protocol servers | MCP tool servers |
| `service` | Infrastructure services | API gateways, databases, auth providers |
| `pipeline` | Multi-step processing chains | Batch runners, data pipelines |

### Business Chains (`business-chains.ts`)

9 chain templates for multi-agent workflows:

| Chain | Agents Involved | Purpose |
|-------|----------------|---------|
| CPU RTL Generation Pipeline | Sub Team agents | Deterministic CPU design from spec to verified Verilog |
| Code Completion Pipeline | Megacode + Uplift Agent | Multi-provider code completion with quality scoring |
| Research Pipeline | OmniResearch Pro + Uplift Agent | Deep research with source synthesis |
| Sports Analysis Pipeline | Sports Steve + TradingAgents | Sports data analysis with trading signals |
| Music Discovery Pipeline | Indy Music Platform + Social Media Dashboard | Independent music curation and promotion |
| Social Media Pipeline | Social Media Dashboard + Uplift Agent | Content generation and scheduling |
| Trading Pipeline | TradingAgents + Uplift Agent | Market analysis and strategy execution |
| Overlay Chain Pipeline | Overlay Chain | Cross-chain blockchain operations |
| Full Ecosystem Pipeline | All agents | End-to-end orchestration across all agents |

### Scheduled Jobs

11 automated jobs for health checks, data syncs, report generation, and maintenance tasks across all registered entities.

### Invocation System

Draymond invokes registered entities through three mechanisms:
- **REST API** — HTTP endpoints for request/response workflows
- **Subprocess** — Direct process spawning for local agents
- **SDK calls** — Programmatic integration for tightly-coupled services

### Health Monitoring

Continuous health checking for all registered agents. The dashboard displays real-time status (online, degraded, offline) on each character bio card.

---

## Registered Agents

| Agent | Slug | Kind | Description |
|-------|------|------|-------------|
| Uplift Agent | `uplift-agent` | `agent` | Advanced AI coding agent with 52 tools and 244 skills |
| Sports Steve | `sports-steve` | `agent` | Sports analytics and prediction agent |
| Sub Team | `sub-team` | `agent` | Deterministic CPU design pipeline (4 sub-agents) |
| Megacode | `megacode` | `tool` | Multi-LLM coding assistant with provider routing |
| OmniResearch Pro | `omniresearch-pro` | `agent` | Deep research and synthesis agent |
| Social Media Dashboard | `social-media-dashboard` | `tool` | Social media management and analytics |
| Indy Music Platform | `indy-music-platform` | `tool` | Independent music discovery and promotion |
| TradingAgents | `trading-agents` | `agent` | Market analysis and trading strategy agent |
| Overlay Chain | `overlay-chain` | `service` | Cross-chain blockchain infrastructure |

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
├── Entity Registry (seed.ts)    # 50+ entities with slugs, kinds, capabilities
├── Business Chains              # 9 multi-agent workflow templates
├── Scheduled Jobs               # 11 automated recurring tasks
├── Health Monitor               # Real-time status for all agents
└── Invocation Layer             # REST / subprocess / SDK dispatch
```

The dashboard renders each registered entity as a character card. Clicking a card shows the entity's full bio, capabilities, health status, recent invocations, and chain memberships. Chain templates can be triggered manually or run on schedule.

---

## Tech Stack

- **Framework:** [Next.js 16](https://nextjs.org/) (App Router, TypeScript)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/)
- **Fonts:** Inter (body), Space Grotesk (headings)
- **Backend:** Local SQLite (better-sqlite3) + local admin sessions — fully private, zero cost, runs 24/7 inside the app process
- **Architecture:** Server components for dashboard, SSG for public pages

### Brand Colors

| Token | Hex | Usage |
|---|---|---|
| Forest Green | `#2d4a1a` | Primary background, nav, CTAs |
| Warm Gold | `#c8a415` | Accent, highlights, CTAs |
| Soft Cream | `#faf6e6` | Page background |
| Deep Burgundy | `#6b2137` | Stats section |
| Rich Brown | `#6b4226` | Text accents |

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
| `CRON_SECRET` | Protects `/api/cron`, `/api/seed`, etc. |

The legacy `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` variables are
kept in `.env.example` only for the one-time data migration
(`node scripts/import-from-supabase.mjs dump`). See `scripts/` for details.

---

## Project Structure

```
├── src/
│   ├── app/                     # Next.js App Router pages
│   │   ├── page.tsx             # Dashboard home
│   │   ├── agents/              # Agent roster and detail pages
│   │   ├── workflows/           # Workflow builder and runner
│   │   ├── operations/          # Operations monitoring
│   │   ├── schedules/           # Scheduled jobs management
│   │   ├── approvals/           # Approval queue
│   │   ├── pipeline/            # Pipeline status
│   │   └── api/                 # API routes for invocation
│   ├── components/
│   │   ├── Header.tsx           # Dashboard navigation
│   │   ├── registry/            # Agent bio card components
│   │   └── QuickActionButton.tsx
│   └── lib/
│       ├── draymond/            # Core orchestration logic
│       │   ├── seed.ts          # Entity registry (50+ entities)
│       │   ├── business-chains.ts # 9 chain templates
│       │   ├── scheduler.ts     # 11 scheduled jobs
│       │   ├── invoker.ts       # REST / subprocess / SDK dispatch
│       │   ├── monitors.ts      # Health monitoring
│       │   └── registry.ts      # Entity registry operations
│       └── db/                  # Local SQLite data layer + auth
├── supabase/
│   └── migrations/              # Legacy Postgres schema (for reference only)
├── Scaffold                     # Full platform architecture blueprint
└── public/                      # Static assets
```

---

## Key Files

- `src/lib/draymond/seed.ts` — Entity registry defining all agents, tools, skills, services, and pipelines
- `src/lib/draymond/business-chains.ts` — Multi-agent chain templates connecting entities into workflows
- `src/lib/draymond/invoker.ts` — Invocation layer for REST, subprocess, and SDK calls
- `src/lib/draymond/monitors.ts` — Health monitoring for all registered entities
- `Scaffold` — Full platform architecture and development blueprint
- `supabase/migrations/` — Database schema and security policies

---

## The Uplift Ecosystem

Draymond Orchestrator manages the following ecosystem:

- **Uplift Agent** — Advanced AI coding agent (Hermes fork) with 52 tools and 244 skills
- **Sports Steve** — Sports analytics and prediction agent
- **Sub Team** — Deterministic CPU design pipeline ([github.com/ncsound919/Sub-Team](https://github.com/ncsound919/Sub-Team))
- **Megacode** — Multi-LLM provider-agnostic coding assistant
- **OmniResearch Pro** — Deep research and synthesis agent
- **Social Media Dashboard** — Social media management and analytics
- **Indy Music Platform** — Independent music discovery and promotion
- **TradingAgents** — Market analysis and trading strategy agent
- **Overlay Chain** — Cross-chain blockchain infrastructure
- **The Uplift Lab** — Community empowerment platform ([github.com/ncsound919/The-Uplift-Lab](https://github.com/ncsound919/The-Uplift-Lab))

Each tool works standalone. Draymond adds centralized monitoring, multi-agent chain workflows, and scheduled job management — but connection is always optional.


