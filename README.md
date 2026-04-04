# The Uplift Lab + Draymond Orchestrator

This repository serves a dual purpose: it is the codebase for **The Uplift Lab** (public-facing community platform) and **Draymond Orchestrator** (the central AI agent management system for the Uplift Ecosystem). Both share a single Next.js application.

---

## The Uplift Lab

**The Operating System for Black Community Empowerment**

The Uplift Lab is a modular, community-owned digital platform engineered to directly address systemic barriers facing the Black community across six critical domains: education, health, finance, entrepreneurship, justice, and community support. Built by and with the community — never extracting, always uplifting.

### Membership

**Membership at The Uplift Lab is, and always will be, $0.**

We believe that access to empowerment tools should not be behind a paywall. Every module, from financial literacy to life skills training, is accessible for free to all community members.

- **Easy Access:** Simple signup process with no credit card required.
- **Always Free:** No hidden fees, no "pro" tiers, no catch.
- **Community Owned:** Data sovereignty and community governance at the core.

### Modules

| Module | Domain | Status |
|---|---|---|
| **Uplift Learn** | Education & Digital Literacy | **Active** (Life Skills & Mentorship) |
| Uplift Health | Health & Wellness | Coming Soon |
| **Uplift Wealth** | Financial Empowerment | **Active** (Financial Literacy) |
| Uplift Ventures | Entrepreneurship | Coming Soon |
| Uplift Justice | Legal Aid & Criminal Justice | Coming Soon |
| Uplift Community | Community Support & Mutual Aid | Phase 0 |

---

## Draymond Orchestrator

**The central nervous system for the Uplift Ecosystem's AI agents.**

Draymond is not a DevOps control panel. It is a **Marvel-style character roster dashboard** where every AI agent, tool, skill, and service in the ecosystem gets a character bio card with capabilities, status indicators, and invocation controls. Think S.H.I.E.L.D. agent roster, not Kubernetes dashboard.

### Core Capabilities

#### Entity Registry (`seed.ts`)

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

#### Business Chains (`business-chains.ts`)

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

#### Scheduled Jobs

11 automated jobs managed by Draymond for health checks, data syncs, report generation, and maintenance tasks across all registered entities.

#### Invocation System

Draymond invokes registered entities through three mechanisms:
- **REST API** — HTTP endpoints for request/response workflows
- **Subprocess** — Direct process spawning for local agents
- **SDK calls** — Programmatic integration for tightly-coupled services

#### Health Monitoring

Continuous health checking for all registered agents. The dashboard displays real-time status (online, degraded, offline) on each character bio card.

### Registered Agents

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
- **Backend:** [Supabase](https://supabase.com/) (PostgreSQL + Auth)
- **Architecture:** Static site generation (SSG) for public pages, server components for dashboard

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

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |

---

## Project Structure

```
├── src/
│   ├── app/                     # Next.js App Router pages
│   │   ├── page.tsx             # Uplift Lab landing page
│   │   ├── dashboard/           # Draymond Orchestrator dashboard
│   │   └── api/                 # API routes for invocation
│   ├── components/
│   │   ├── MembershipBanner.tsx # Uplift Lab CTA
│   │   ├── HistoryHeroes.tsx    # Interactive Black history component
│   │   ├── CharacterRoster.tsx  # Marvel-style agent bio cards
│   │   └── ChainBuilder.tsx     # Business chain workflow UI
│   └── lib/
│       ├── seed.ts              # Entity registry (50+ entities)
│       ├── business-chains.ts   # 9 chain templates
│       └── scheduler.ts        # 11 scheduled jobs
├── supabase/
│   └── migrations/              # Database schema and RLS policies
├── Scaffold                     # Full platform architecture blueprint
└── public/                      # Static assets
```

---

## Key Files

- `src/lib/seed.ts` — Entity registry defining all agents, tools, skills, services, and pipelines with slugs, kinds, and capabilities
- `src/lib/business-chains.ts` — Multi-agent chain templates connecting entities into workflows
- `src/components/MembershipBanner.tsx` — Call-to-action for free membership
- `src/components/HistoryHeroes.tsx` — Interactive Black history component
- `Scaffold` — Full platform architecture and development blueprint
- `supabase/migrations/` — Database schema and security policies

---

## The Uplift Ecosystem

Draymond Orchestrator manages the following ecosystem:

- **Uplift Agent** — Advanced AI coding agent (Hermes fork) with 52 tools and 244 skills
- **Sports Steve** — Sports analytics and prediction agent
- **Sub Team** — Deterministic CPU design pipeline
- **Megacode** — Multi-LLM provider-agnostic coding assistant
- **OmniResearch Pro** — Deep research and synthesis agent
- **Social Media Dashboard** — Social media management and analytics
- **Indy Music Platform** — Independent music discovery and promotion
- **TradingAgents** — Market analysis and trading strategy agent
- **Overlay Chain** — Cross-chain blockchain infrastructure

Each tool works standalone. Draymond adds centralized monitoring, multi-agent chain workflows, and scheduled job management — but connection is always optional.
