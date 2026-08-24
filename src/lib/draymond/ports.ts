// ============================================================================
// DRAYMOND TOOL PORT REGISTRY — the canonical port allocation
// ============================================================================
// Every tool/service in the ecosystem gets ONE dedicated port so nothing
// squats on 3000/8000 and services never collide. This is the single source
// of truth for the toolcount and port system: seed entities, health monitors,
// the start script, and .env.example all derive from these numbers.
//
// Allocation scheme (spread intelligently by category):
//   control        3444   Draymond itself
//   coding         4000/4100/9744   Mutly · LiteLLM · Megacode
//   review         3200-3202        RepoRank · Grader · Vibe-Reality
//   security       3300-3302        Claw-Protect · dep-scan · nuclei
//   orchestration  3500-3700        Big Homie · VibeServe · AgentBrowser
//   ecosystem      3001-3410/8000-8050/8777   app services
//   mission brain  8642/8648/8650   Hermes api_server · hermes-proxy (media+voice) · squad-service
//   mcp            stdio            UFC-MCP · CIS Assistant
// ============================================================================

export type ToolCategory =
  | 'control'
  | 'coding'
  | 'review'
  | 'knowledge'
  | 'security'
  | 'orchestration'
  | 'service'
  | 'mcp';

export interface ToolPort {
  slug: string;
  name: string;
  category: ToolCategory;
  /** Canonical port. `null` for stdio-only tools (no HTTP port). */
  port: number | null;
  /** Env var that overrides the base URL at runtime. */
  env: string;
  /** Health check path (relative to the base URL). */
  health?: string;
  /** Working directory of the service (relative to the Draymond repo root). */
  cwd?: string;
  /** Start command hint used by scripts/start-tools.ps1. */
  start?: string;
  notes?: string;
}

export const TOOL_PORTS: ToolPort[] = [
  // ── Control plane ────────────────────────────────────────────────────────
  { slug: 'draymond', name: 'Draymond Orchestrator', category: 'control', port: 3444, env: 'DRAYMOND_PUBLIC_URL', health: '/', cwd: '.', start: 'npm run dev', notes: 'The dashboard / API host.' },

  // ── Coding & IDE ─────────────────────────────────────────────────────────
  { slug: 'mutly', name: 'Mutly', category: 'coding', port: 4000, env: 'MUTLY_URL', health: '/api/agent/public-config', cwd: 'agents/Mutly-Daemon-Agent', start: 'npm run dev', notes: 'Codebase index, semantic search, sandboxed tests, RepoRank/VibeServe/Claw-Protect proxy. Health uses the public (unauthenticated) config route — /api/health requires X-Mutly-API-Key.' },
  { slug: 'litellm', name: 'LiteLLM Proxy', category: 'coding', port: 4100, env: 'LITELLM_URL', health: '/health', start: 'litellm --config litellm.yaml --port 4100', notes: 'Model gateway (moved off 4000 to free it for Mutly).' },
  { slug: 'megacode', name: 'Megacode', category: 'coding', port: null, env: 'MEGACODE_URL', cwd: 'agents/Megacode-main', notes: 'Claude Code fork + MCP manager + task router. Current checkout is the overcoat CLI (no HTTP server) — no port to health-check.' },
  { slug: 'opencode', name: 'opencode', category: 'coding', port: 4096, env: 'OPENCODE_SERVE_PORT', health: '/', start: 'opencode serve --port 4096', notes: 'Headless codegen engine (deepseek-v4-flash 0731). Dispatch via `opencode run --attach http://127.0.0.1:4096 --model opencode/deepseek-v4-flash`. Runs in the Draymond cwd.' },

  // ── Review & grading ─────────────────────────────────────────────────────
  { slug: 'reporank', name: 'RepoRank', category: 'review', port: 3200, env: 'REPORANK_URL', health: '/health', cwd: 'agents/reporank', start: 'pnpm dev:local', notes: 'Repo depth scoring + remediation + milestones/gates/drift progress. Health route is GET /health (not /api/health). Moved off 3001 (Bet Buddy).' },
  { slug: 'grader', name: 'Grader', category: 'review', port: 3201, env: 'GRADER_URL', health: '/api/health', cwd: 'agents/Grader-main', start: 'npm run dev', notes: 'Data-backed grade (sync /api/grade). Moved off 3000.' },
  { slug: 'vibe-reality', name: 'Vibe-Reality', category: 'review', port: 3202, env: 'VIBE_REALITY_URL', health: '/health', cwd: 'agents/Vibe-Reality-main', start: 'npm run dev', notes: 'Optional third deep scorer.' },
  { slug: 'codegang', name: 'Codegang', category: 'review', port: 3204, env: 'CODEGANG_URL', health: '/api', cwd: 'agents/Codegang', start: 'npx next dev --webpack -p 3204', notes: 'Local deep analysis + agent pipeline (scout→planner→executor→validator→committer). Content-based /api/analyze-comprehensive is the review-gate local scorer. Bearer auth via CODEGANG_API_KEY (Codegang SECRET_KEY).' },
  { slug: 'codenexus', name: 'CodeNexus', category: 'review', port: 3205, env: 'CODENEXUS_URL', health: '/api/health', cwd: 'agents/CodeNexus-main', start: 'npm run dev', notes: 'Agentic PR review + fix platform (webhook → diff → security scan → comment → auto-fix → verify → push).' },

  // ── Knowledge graph ──────────────────────────────────────────────────────
  { slug: 'graphify', name: 'Graphify', category: 'knowledge', port: 3203, env: 'GRAPHIFY_URL', health: '/health', cwd: 'graphify-out', start: 'python scripts/serve-graphify.py graphify-out/graph.json --transport http --port 3203 --json-response --stateless', notes: 'Codebase knowledge graph (tree-sitter AST, no vector store). MCP endpoint /mcp (POST only; GET /mcp is the SSE handshake and 406s by spec). Health probe: GET /health (served by scripts/serve-graphify.py). Query via MCP: query_graph / shortest_path / explain. Index with: scripts/graphify-index.ps1. Graph built by: graphify . --code-only --no-viz, then cluster-only.' },
  { slug: 'deterministic-brain', name: 'Deterministic Brain', category: 'knowledge', port: 3210, env: 'BRAIN_URL', health: '/health', cwd: 'agents/deterministic-brain', start: 'python main.py --serve', notes: 'Metacognitive observer (Recognition → Labeling → Intervention). API_PORT=3210. Sweep: POST /brain/sweep · Status: GET /brain/status.' },

  // ── Security scanning ────────────────────────────────────────────────────
  { slug: 'claw-protect', name: 'Claw-Protect', category: 'security', port: 3300, env: 'CLAW_PROTECT_URL', health: '/api/health', cwd: 'agents/Claw-Protect-main', start: 'npm run dev', notes: 'Secrets / prompt-injection scanner. Service-mode port is 3300 (see server.ts); CLAW_PORT overrides.' },
  { slug: 'depscan', name: 'dep-scan', category: 'security', port: 3301, env: 'DEPScan_URL', health: '/health', notes: 'Dependency CVE scanner.' },
  { slug: 'nuclei-scanner', name: 'Nuclei Scanner', category: 'security', port: 3302, env: 'NUCLEI_URL', health: '/health', notes: 'External vuln surface scanner.' },
  { slug: 'system-agent', name: 'System Agent', category: 'security', port: 3405, env: 'SYSTEM_AGENT_URL', health: '/api/health', cwd: 'agents/system-agent', start: 'npm run dev', notes: 'Resident Windows bridge — real-time OS telemetry (process/network/USB/Defender/files) + laptop control (launch/kill/power/file/service) for Draymond and endpoint protection for Claw-Protect. Loopback only; auth via SYSTEM_AGENT_KEY.' },
  { slug: 'cai', name: 'CAI (Cybersecurity AI)', category: 'security', port: 3303, env: 'CAI_URL', health: '/health', cwd: 'agents/CAI-main', start: 'wsl bash -lc "cd ~/cai-src && ~/.venvs/cai-wsl/bin/cai run"', notes: 'Offensive/defensive AI security agent framework (aliasrobotics/cai v1.1.5, 38 agents). Unix-only REPL — run via WSL venv ~/.venvs/cai-wsl (native fs; source ~/cai-src). Red/blue/purple team, web pentest, bug bounty, DFIR, APT, compliance, guardrails.' },

  // ── Orchestration backends ───────────────────────────────────────────────
  { slug: 'big-homie', name: 'Big Homie', category: 'orchestration', port: 3500, env: 'BIG_HOMIE_URL', health: '/tools/status', start: 'uvicorn big_homie_web:app --port 3500', notes: 'LLM agent backend / quality gate. No /health route; /tools/status is the JSON status endpoint.' },
  { slug: 'vibeserve', name: 'VibeServe', category: 'orchestration', port: 3600, env: 'VIBESERVE_URL', health: '/health', cwd: 'agents/VibeServe-main', start: 'python -m vibeserve', notes: 'FastMCP tool router (stdio; 3600 is its optional HTTP bridge). Moved off 8000.' },
  { slug: 'agent-browser', name: 'AgentBrowser', category: 'orchestration', port: 3700, env: 'AGENTBROWSER_URL', health: '/api/system/health', cwd: 'agents/AgentBrowser-main', start: 'npm run dev -- -p 3700', notes: 'Playwright browser automation + ecosystem gateway + Overlay365 QA harness (/api/testing). Moved off 3000 (Overlay Justice / HempForge).' },
  { slug: 'paperclip', name: 'Paperclip', category: 'orchestration', port: 3705, env: 'PAPERCLIP_URL', health: '/health', cwd: '04_Integrations/paperclip', start: 'pnpm dev', notes: 'Team-of-agents orchestration server + React UI (org charts, budgets, governance, goal alignment). Backs the ext-paperclip extension.' },

  // ── Hermes / mission brain ───────────────────────────────────────────────
  { slug: 'hermes-brain', name: 'Hermes Agent (Mission Brain)', category: 'orchestration', port: 8642, env: 'HERMES_BRAIN_URL', health: '/health', notes: 'Real NousResearch Hermes api_server (OpenAI SSE /v1/chat/completions). Started via scripts/start-hermes-gateway.ps1. Auth via API_SERVER_KEY env.' },
  { slug: 'hermes-proxy', name: 'Hermes Proxy (media+voice)', category: 'service', port: 8648, env: 'HERMES_PROXY_PORT', health: '/v1/health', notes: 'Node hermes-proxy: /media/* static + /api/v1/voice/* AetherDesk proxy. Chat role moved to hermes-brain (8642).' },
  { slug: 'squad-service', name: 'Squad Service', category: 'service', port: 8650, env: 'SQUAD_SERVICE_PORT', health: '/v1/health', notes: 'Specialists riggs/moss/scribe/echo/hype (part of hermes-proxy backend).' },

  // ── Ecosystem app services ───────────────────────────────────────────────
  { slug: 'bet-buddy', name: 'Bet Buddy', category: 'service', port: 3001, env: 'BET_BUDDY_URL', health: '/health', notes: 'Betting companion (3001 is now free — RepoRank moved to 3200).' },
  { slug: 'omniresearch-pro', name: 'OmniResearch Pro', category: 'service', port: 3010, env: 'OMNI_RESEARCH_URL', health: '/api/health', notes: 'Deep research agent.' },
  { slug: 'overlay-chain', name: 'Overlay Chain', category: 'service', port: 3020, env: 'OVERLAY_CHAIN_URL', health: '/api', notes: 'Supply chain intelligence.' },
  { slug: 'hemp-os', name: 'Hemp-OS', category: 'service', port: 3100, env: 'HEMP_OS_URL', health: '/health', notes: 'Scientific research OS.' },
  { slug: 'hempforge', name: 'HempForge', category: 'service', port: 3110, env: 'HEMPFORGE_URL', health: '/api/health', notes: 'Moved off 3000.' },
  { slug: 'ghostfolio', name: 'Ghostfolio', category: 'service', port: 3333, env: 'GHOSTFOLIO_URL', health: '/api/v1/health', notes: 'Portfolio tracker (kept; Claw-Protect moved off 3333).' },
  { slug: 'phoenix', name: 'Phoenix', category: 'service', port: 6006, env: 'PHOENIX_URL', health: '/health', notes: 'LLM/agent observability & evaluation. Started via docker (arize/phoenix) or `python -m phoenix.server.main serve --port 6006`.' },
  { slug: 'generative-video-ai', name: 'Generative Video AI', category: 'service', port: 8055, env: 'GENERATIVE_VIDEO_URL', health: '/', notes: 'Image/video generation studio (Next.js). Absorbs AI YouTube Shorts + Content Creation Engine.' },
  { slug: 'open-notebook', name: 'Open Notebook', category: 'service', port: 3030, env: 'OPEN_NOTEBOOK_URL', health: '/', cwd: '04_Integrations/integrations/open-notebook', start: 'python -m uvicorn api.main:app --host 127.0.0.1 --port 3030', notes: 'NotebookLM-style research workspace (folded into omniresearch-pro pipeline).' },
  { slug: 'stirling-pdf', name: 'Stirling PDF', category: 'service', port: 8080, env: 'STIRLING_PDF_URL', health: '/', notes: 'Local PDF operations (folded into ufc-mcp pipeline).' },
  { slug: 'tap919-middleman', name: 'Tap919 Middleman', category: 'service', port: 8021, env: 'MIDDLEMAN_URL', health: '/internal/ping', cwd: '06_Resources/tap919-middleman-main', start: 'python -m uvicorn app.main:app --host 0.0.0.0 --port 8021', notes: 'Metered agent-to-agent gateway (E3 cash register). Budget-engine meter.ts emits UsageEvents to /internal/execute when MIDDLEMAN_URL is set. Health: GET /internal/ping.' },
  { slug: 'recursive-ip', name: 'Recursive IP', category: 'service', port: 3410, env: 'RECURSIVE_IP_URL', health: '/api/v1/health', notes: 'Moved off 8000.' },
  { slug: 'cureforge', name: 'CureForge', category: 'service', port: 3060, env: 'CUREFORGE_URL', health: '/api/health', cwd: '02_Pillars/Overlay Science/Biotech/CureForge', start: 'npm run dev', notes: 'Deterministic verification agent lab — JSON IR → JS compile → vm sandbox → fast-check fuzzing → WebGPU Monte Carlo.' },
  { slug: 'bbtech-web-app', name: 'BBTech Web App', category: 'service', port: 3061, env: 'BBTECH_URL', health: '/health', cwd: '02_Pillars/Overlay Science/Shared/bb_tech_core/bbtech-web-app', start: 'npm run dev', notes: 'Runnable BBTech web stack — Express+Firebase+alasql server, React/Vite frontend, Python oncology_platform.' },
  { slug: 'overlay-oncology', name: 'Overlay Oncology', category: 'service', port: 3070, env: 'OVERLAY_ONCOLOGY_URL', health: '/api/calibration/state', cwd: '02_Pillars/Overlay Science/Overlay Oncology', start: 'npm run dev -- -p 3070', notes: 'Cancer research & biotech engines (Next.js) — calibrated to live public data (CCLE IC50, TCGA survival). Calibration state via /api/calibration/state (consumed by Overlay Global Lens publication). Runtime manifest runs it on :3070.' },
  { slug: 'uplift-agent', name: 'Uplift Agent', category: 'service', port: 8000, env: 'UPLIFT_BASE_URL', health: '/health', notes: 'General-purpose coding agent.' },
  { slug: 'uplift-bridge', name: 'Uplift Bridge (work queue)', category: 'service', port: null, env: 'DRAYMOND_PUBLIC_URL', health: '/api/bridge/v1/health', notes: 'Bridge protocol work queue served by Draymond itself under /api/bridge/v1/* (shares Draymond host 3444 — no dedicated port). Open-Chat polls this for remote session control.' },
  { slug: 'sports-steve', name: 'Sports Steve', category: 'service', port: 8010, env: 'SPORTS_STEVE_URL', health: '/api/v1/health', notes: 'Sports analytics agent.' },
  { slug: 'indy-music', name: 'Indy Music Platform', category: 'service', port: 8020, env: 'INDY_MUSIC_URL', health: '/health', notes: 'Music industry automation.' },
  { slug: 'social-media-dashboard', name: 'Social Media Dashboard', category: 'service', port: 8030, env: 'SOCIAL_MEDIA_URL', health: '/api/ai/health', notes: 'Content creation service.' },
  { slug: 'trading-agents', name: 'TradingAgents', category: 'service', port: 8040, env: 'TRADING_AGENTS_URL', health: '/health', notes: 'Market analysis.' },
  { slug: 'sub-team', name: 'Sub Team', category: 'service', port: 8050, env: 'SUB_TEAM_URL', health: '/health', notes: 'Deterministic CPU pipeline.' },
  { slug: 'bookbridge', name: 'BookBridge', category: 'service', port: 8777, env: 'BOOKBRIDGE_URL', health: '/health', notes: 'Book synthesis engine.' },
  { slug: 'aetherdesk', name: 'Aetherdesk Call Center', category: 'service', port: 8002, env: 'AETHERDESK_URL', health: '/api/v1/health', cwd: '../04_Integrations/Aetherdesk-Call-Center', start: 'python -m uvicorn src.api.main:app --host 127.0.0.1 --port 8002', notes: 'AI call center flagship (B2B). Health route is /api/v1/health (health router mounts under /api/v1). Moved off 8000 — Uplift Agent owns 8000.' },
  { slug: 'openchat', name: 'Open Chat', category: 'service', port: 5175, env: 'OPENCHAT_URL', health: '/', cwd: '../Open-Chat', start: 'npm run dev -- --port 5175 --strictPort', notes: 'Local-first fleet messaging SPA (Vite, binds ::1). Health probe is the root route. Moved off 5173 — RepoRank web Vite owns 5173.' },

  // ── MCP servers (stdio — no HTTP port) ───────────────────────────────────
  { slug: 'ufc-mcp', name: 'UFC-MCP', category: 'mcp', port: null, env: 'UFC_MCP_CMD', notes: 'Universal file converter over stdio MCP.' },
  { slug: 'mcp-cis-assistant', name: 'CIS Assistant', category: 'mcp', port: null, env: 'CIS_MCP_CMD', notes: 'UK CIS compliance over stdio MCP.' },
];

/** Look up a tool by slug. */
export function toolBySlug(slug: string): ToolPort | undefined {
  return TOOL_PORTS.find((t) => t.slug === slug);
}

/** Canonical base URL for a tool (http://localhost:<port>). */
export function toolUrl(slug: string): string | null {
  const tool = toolBySlug(slug);
  if (!tool || tool.port === null) return null;
  return `http://localhost:${tool.port}`;
}

/** Canonical health-check URL for a tool. */
export function toolHealthUrl(slug: string): string | null {
  const tool = toolBySlug(slug);
  const base = toolUrl(slug);
  if (!tool || !base) return null;
  return tool.health ? `${base}${tool.health}` : base;
}

/** Total number of tools in the registry. */
export function toolCount(): number {
  return TOOL_PORTS.length;
}

/** Tools whose canonical port is in use by another entry (should always be []). */
export function findPortCollisions(): Array<{ port: number; slugs: string[] }> {
  const byPort = new Map<number, string[]>();
  for (const t of TOOL_PORTS) {
    if (t.port === null) continue;
    const list = byPort.get(t.port) ?? [];
    list.push(t.slug);
    byPort.set(t.port, list);
  }
  return [...byPort.entries()]
    .filter(([, slugs]) => slugs.length > 1)
    .map(([port, slugs]) => ({ port, slugs }));
}

/** Human-readable summary of the whole registry (for reports and /admin). */
export function portRegistrySummary(): string {
  const lines = TOOL_PORTS.map((t) => {
    const port = t.port === null ? 'stdio' : String(t.port);
    return `${port.padStart(5)}  ${t.name.padEnd(28)} ${t.category}`;
  });
  const collisions = findPortCollisions();
  const collisionNote =
    collisions.length > 0
      ? `\n!! PORT COLLISIONS: ${collisions.map((c) => `${c.port} (${c.slugs.join(', ')})`).join('; ')}`
      : '';
  return `Tool port registry — ${TOOL_PORTS.length} tools\n${'─'.repeat(58)}\n${lines.join('\n')}${collisionNote}`;
}
