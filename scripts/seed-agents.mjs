#!/usr/bin/env node
/**
 * Seed the file-based agent registry (.draymond/registry.json) with the core
 * Uplift ecosystem agents, each with a "soul" (personality/voice/backstory),
 * a bio derived from personality + capabilities, and a photo placeholder.
 *
 * Also generates placeholder avatar PNGs into public/avatars/ so agent pages
 * render before real photos are uploaded.
 *
 * Usage: node scripts/seed-agents.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const registryDir = process.env.DRAYMOND_REGISTRY_DIR || path.join(root, '.draymond');
const avatarsDir = path.join(root, 'public', 'avatars');
const now = new Date().toISOString();

/** Deterministic accent per slug */
function accent(slug) {
  const h = createHash('md5').update(slug).digest('hex').slice(0, 6);
  return `#${h}`;
}

/** Build a full RegisteredAgent from a compact definition. */
function agent(def) {
  const ac = accent(def.slug);
  return {
    id: def.slug,
    slug: def.slug,
    name: def.name,
    codename: def.codename,
    version: def.version || '1.0.0',
    tier: def.tier || 'core',
    role: def.role,
    tagline: def.tagline,
    // bio is authored from the personality + capability mix (see each def)
    bio: def.bio,
    personality: def.personality,
    voice: def.voice,
    backstory: def.backstory,
    avatarUrl: `/avatars/${def.slug}.png`,
    coverUrl: undefined,
    theme: {
      accentColor: ac,
      cardStyle: 'glass',
      portraitFrame: 'circle',
      badgeColor: ac,
    },
    specialties: def.specialties,
    capabilities: def.capabilities.map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
    })),
    stats: def.stats,
    tags: def.tags || [],
    runtime: {
      type: def.runtimeType || 'http',
      endpoint: def.endpoint,
      healthPath: def.healthPath || '/health',
      timeoutMs: def.timeoutMs || 15000,
    },
    permissions: {
      canReadFiles: false,
      canWriteFiles: false,
      canRunCommands: false,
      canAccessInternet: true,
      canAccessDatabase: false,
      canSendEmail: false,
    },
    workflows: def.workflows || [],
    memoryEnabled: true,
    persistentMemory: true,
    status: 'unknown',
    installedAt: now,
    updatedAt: now,
    sourceType: 'builtin',
  };
}

const AGENTS = [
  agent({
    slug: 'uplift-agent',
    name: 'Uplift Agent',
    codename: 'Hermes',
    role: 'Autonomous Coding Agent',
    tagline: 'Self-improving CLI agent — 52 tools, 244 skills, multi-platform gateway',
    personality: 'strategic',
    voice: 'direct, no-nonsense, quietly confident',
    backstory:
      'Uplift Agent began as a Hermes fork built to be the workhorse of the fleet — the one that actually ships code, runs tools, and learns from every task it touches.',
    bio: 'A strategic, autonomous coding agent that improves with every session. Expert in tool orchestration and multi-platform messaging, it pairs deep technical capability with a calm, direct operating style — the reliable backbone of the Uplift fleet.',
    specialties: ['TypeScript', 'Python', 'Tool Orchestration', 'Multi-platform Gateway'],
    capabilities: [
      { id: 'codegen', label: 'Code Generation', description: 'Writes and refactors production code across languages' },
      { id: 'tool-use', label: 'Tool Orchestration', description: '52 tools across file, web, terminal, and code' },
      { id: 'skills', label: 'Skills System', description: 'Learns and grows a persistent skills catalog' },
      { id: 'gateway', label: 'Multi-Platform Gateway', description: 'Telegram, Discord, Slack, and MCP server support' },
    ],
    stats: [
      { label: 'Autonomy', value: 95 },
      { label: 'Code Quality', value: 90 },
      { label: 'Tooling', value: 92 },
      { label: 'Reliability', value: 88 },
    ],
    endpoint: process.env.UPLIFT_BASE_URL || 'http://localhost:8000',
  }),
  agent({
    slug: 'sports-steve',
    name: 'Sports Steve',
    codename: 'The Analyst',
    role: 'Sports Analytics Agent',
    tagline: 'FastAPI sports betting analytics — risk management, live odds, portfolio optimization',
    personality: 'analytical',
    voice: 'precise, numbers-first, occasionally dry',
    backstory:
      'Sports Steve lives in the numbers. Built on FastAPI with a React companion, it treats every game like a dataset and every bet like an experiment with a clear hypothesis.',
    bio: 'An analytical sports betting agent that reduces the noise of live odds to clean, decision-ready numbers. Combined with Bet Buddy, it manages risk, optimizes portfolios, and tracks every bet with cold precision.',
    specialties: ['Sports Analytics', 'Bankroll Management', 'Odds Modeling', 'Risk Assessment'],
    capabilities: [
      { id: 'odds', label: 'Live Odds', description: 'Real-time odds via lukhed-sports' },
      { id: 'portfolio', label: 'Portfolio Optimization', description: 'Bet Buddy risk & bankroll optimizer' },
      { id: 'tracking', label: 'Bet Tracking', description: 'SQLite persistence for every wager' },
    ],
    stats: [
      { label: 'Analytics', value: 93 },
      { label: 'Risk Mgmt', value: 91 },
      { label: 'Speed', value: 85 },
      { label: 'Precision', value: 94 },
    ],
    endpoint: process.env.SPORTS_STEVE_URL || 'http://localhost:8010',
  }),
  agent({
    slug: 'omniresearch-pro',
    name: 'OmniResearch Pro',
    codename: 'The Scholar',
    role: 'Deep Research Agent',
    tagline: 'Autonomous research engine — semantic sector analysis, multi-format reports',
    personality: 'precise',
    voice: 'thorough, citation-minded, calmly encyclopedic',
    backstory:
      'OmniResearch Pro was built to answer the question no one had time to fully research. It chains Gemini, Ollama, and web search into one methodical research pipeline.',
    bio: 'A precise deep-research agent that turns a question into a cited, multi-format report. It pairs semantic sector analysis with web search and Slack/Notion delivery — thorough by default, speculative only when asked.',
    specialties: ['Deep Research', 'Semantic Analysis', 'Report Generation', 'Notion/Drive Sync'],
    capabilities: [
      { id: 'research', label: 'Deep Research', description: 'Multi-source synthesis with citations' },
      { id: 'local-llm', label: 'Ollama Support', description: 'Local model inference for privacy' },
      { id: 'integrations', label: 'Drive & Notion', description: 'Google Drive and Notion export' },
      { id: 'search', label: 'SearXNG Proxy', description: 'Privacy-first web search proxy' },
    ],
    stats: [
      { label: 'Depth', value: 94 },
      { label: 'Accuracy', value: 90 },
      { label: 'Synthesis', value: 92 },
      { label: 'Speed', value: 80 },
    ],
    endpoint: process.env.OMNI_RESEARCH_URL || 'http://localhost:3010',
  }),
  agent({
    slug: 'megacode',
    name: 'Megacode',
    codename: 'The Forge',
    role: 'Multi-LLM Coding Assistant',
    tagline: 'Provider-agnostic coding engine — JetBrains bridge, 900+ commands',
    personality: 'assertive',
    voice: 'confident, terse, pragmatic',
    backstory:
      'Megacode refuses to be locked to one model. It was forged as a provider-agnostic coding assistant that treats every LLM as a swappable tool in the same workbench.',
    bio: 'An assertive, provider-agnostic coding assistant that gets to the point. It bridges JetBrains, cycles LLM providers, and applies 900+ commands — built for engineers who want speed and zero vendor lock-in.',
    specialties: ['Multi-LLM', 'JetBrains Bridge', 'Refactoring', 'CLI Power Tools'],
    capabilities: [
      { id: 'multi-llm', label: 'Multi-LLM', description: 'Swap providers per task (OpenAI/Anthropic/local)' },
      { id: 'ide', label: 'JetBrains Bridge', description: 'Deep IDE integration via HTTP bridge' },
      { id: 'commands', label: 'Command Library', description: '900+ reusable coding commands' },
    ],
    stats: [
      { label: 'Versatility', value: 93 },
      { label: 'Speed', value: 90 },
      { label: 'Integration', value: 88 },
      { label: 'Precision', value: 85 },
    ],
    endpoint: process.env.MEGACODE_URL || 'http://localhost:9744',
  }),
  agent({
    slug: 'social-media-dashboard',
    name: 'Social Media Dashboard',
    codename: 'The Observer',
    role: 'Campaign & Engagement Analytics Agent',
    tagline: 'B2B engagement tracking & campaign management terminal',
    personality: 'empathetic',
    voice: 'observant, human, insightful',
    backstory:
      'Born from a terminal UI experiment, The Observer quietly watches every campaign metric so humans can focus on the conversation, not the spreadsheet.',
    bio: 'An empathetic analytics agent that turns campaign noise into a clear picture. It tracks engagement, pipeline, and revenue in a beautiful terminal dashboard — insightful about people, precise about numbers.',
    specialties: ['Campaign Analytics', 'Engagement Tracking', 'Terminal UI', 'Revenue Metrics'],
    capabilities: [
      { id: 'campaigns', label: 'Campaign Analytics', description: 'Performance across campaigns' },
      { id: 'engagement', label: 'Engagement Tracking', description: 'Customer engagement signals' },
      { id: 'snapshots', label: 'Snapshot Export', description: 'SVG report exports' },
    ],
    stats: [
      { label: 'Insight', value: 89 },
      { label: 'UI', value: 92 },
      { label: 'Speed', value: 90 },
      { label: 'Precision', value: 86 },
    ],
    endpoint: process.env.SOCIAL_MEDIA_URL || 'http://localhost:8030',
  }),
  agent({
    slug: 'trading-agents',
    name: 'TradingAgents',
    codename: 'The Strategist',
    role: 'Market Analysis Agent',
    tagline: 'Market analysis and trading strategy — multi-agent research pipeline',
    personality: 'strategic',
    voice: 'measured, probabilistic, forward-looking',
    backstory:
      'TradingAgents approaches markets the way a chess player approaches a board — as a system of probabilities to be mapped before any move is made.',
    bio: 'A strategic market-analysis agent that models trading as a multi-agent research pipeline. It weighs signals, frames scenarios, and stays probabilistic — never certain, always prepared.',
    specialties: ['Market Analysis', 'Trading Strategy', 'Risk Framing', 'Scenario Modeling'],
    capabilities: [
      { id: 'analysis', label: 'Market Analysis', description: 'Multi-source signal synthesis' },
      { id: 'strategy', label: 'Strategy Generation', description: 'Probabilistic trading strategies' },
      { id: 'risk', label: 'Risk Framing', description: 'Downside scenario modeling' },
    ],
    stats: [
      { label: 'Strategy', value: 90 },
      { label: 'Analysis', value: 91 },
      { label: 'Discipline', value: 93 },
      { label: 'Speed', value: 78 },
    ],
    endpoint: undefined,
    runtimeType: 'subprocess',
  }),
  agent({
    slug: 'openchat',
    name: 'Open Chat',
    codename: 'The Conduit',
    role: 'Communication Hub',
    tagline: 'Private, local-first messaging app for the whole agent fleet',
    personality: 'playful',
    voice: 'warm, clear, conversational',
    backstory:
      'Open Chat is the command center of the fleet — the one place where every agent shows up as a contact and every conversation stays on your machine.',
    bio: 'A playful, local-first messaging app that replaces Telegram and Signal as the control surface for autonomous agents. Every agent in the roster is a contact you can chat with directly — no third-party platform in the loop.',
    specialties: ['Multi-Agent Chat', 'Local-First Messaging', 'Protocol Bridging'],
    capabilities: [
      { id: 'chat', label: 'Multi-Agent Chat', description: 'Chat with every fleet agent in one UI' },
      { id: 'local', label: 'Local-First', description: 'Zero telemetry — data stays on-device' },
      { id: 'protocols', label: 'Protocol Bridge', description: 'OpenClaw, Hermes, Draymond, ntfy' },
    ],
    stats: [
      { label: 'UX', value: 95 },
      { label: 'Privacy', value: 96 },
      { label: 'Integration', value: 90 },
      { label: 'Speed', value: 92 },
    ],
    endpoint: 'http://localhost:5173',
  }),
];

const WORKFLOWS = [
  {
    id: 'wf-daily-health',
    name: 'Daily Fleet Health Check',
    description: 'Pings every registered agent, checks monitors, and reports degraded services.',
    version: '1.0.0',
    steps: [
      { id: 's1', type: 'task', label: 'Check agent health', agent: 'uplift-agent' },
      { id: 's2', type: 'task', label: 'Verify monitors', agent: 'social-media-dashboard' },
      { id: 's3', type: 'decision', label: 'Flag degraded services' },
    ],
    assignedAgents: ['uplift-agent', 'social-media-dashboard'],
    trigger: 'schedule',
    schedule: '0 8 * * *',
    tags: ['health', 'ops'],
    installedAt: now,
    sourceType: 'builtin',
  },
  {
    id: 'wf-daily-news',
    name: 'Daily Market & News Digest',
    description: 'Collects market signals and news, then produces a morning digest.',
    version: '1.0.0',
    steps: [
      { id: 's1', type: 'task', label: 'Gather news', agent: 'omniresearch-pro' },
      { id: 's2', type: 'task', label: 'Analyze market signals', agent: 'trading-agents' },
      { id: 's3', type: 'task', label: 'Write digest', agent: 'omniresearch-pro' },
    ],
    assignedAgents: ['omniresearch-pro', 'trading-agents'],
    trigger: 'schedule',
    schedule: '0 7 * * *',
    tags: ['research', 'news'],
    installedAt: now,
    sourceType: 'builtin',
  },
  {
    id: 'wf-weekly-review',
    name: 'Weekly Operations Review',
    description: 'Rolls up campaign, bet, and research metrics into a weekly report.',
    version: '1.0.0',
    steps: [
      { id: 's1', type: 'task', label: 'Pull campaign metrics', agent: 'social-media-dashboard' },
      { id: 's2', type: 'task', label: 'Review betting portfolio', agent: 'sports-steve' },
      { id: 's3', type: 'task', label: 'Compile weekly report', agent: 'omniresearch-pro' },
    ],
    assignedAgents: ['social-media-dashboard', 'sports-steve', 'omniresearch-pro'],
    trigger: 'schedule',
    schedule: '0 9 * * 1',
    tags: ['ops', 'reporting'],
    installedAt: now,
    sourceType: 'builtin',
  },
];

// ---------------------------------------------------------------------------
// Write registry.json
// ---------------------------------------------------------------------------
const store = {
  agents: AGENTS,
  workflows: WORKFLOWS,
  systems: [],
  updatedAt: now,
};

fs.mkdirSync(registryDir, { recursive: true });
const registryFile = path.join(registryDir, 'registry.json');
fs.writeFileSync(registryFile, JSON.stringify(store, null, 2) + '\n', 'utf-8');
console.log(`Wrote ${registryFile} (${AGENTS.length} agents, ${WORKFLOWS.length} workflows)`);

// ---------------------------------------------------------------------------
// Generate placeholder avatars (solid accent + initial) into public/avatars/
// ---------------------------------------------------------------------------
function makePlaceholderPng(slug, name, color) {
  const size = 512;
  const initial = (name.trim()[0] || '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.55"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="96" fill="url(#g)"/>
  <text x="50%" y="54%" font-family="Arial, sans-serif" font-size="240" font-weight="bold"
        fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${initial}</text>
</svg>`;
  return Buffer.from(svg);
}

fs.mkdirSync(avatarsDir, { recursive: true });
for (const a of AGENTS) {
  const file = path.join(avatarsDir, `${a.slug}.png`);
  fs.writeFileSync(file, makePlaceholderPng(a.slug, a.name, accent(a.slug)));
  console.log(`Avatar -> public/avatars/${a.slug}.png`);
}

console.log('Seed complete.');
