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
      command: def.command,
      args: def.args,
      mcpServer: def.mcpServer,
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
    command: 'python',
    args: ['agents/TradingAgents-main/main.py'],
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
  agent({
    slug: 'ufc-mcp',
    name: 'UFC-MCP',
    codename: 'The Converter',
    role: 'Universal File Converter MCP',
    tagline: 'Local MCP server — audio, video, image, and document conversion with no cloud',
    personality: 'precise',
    voice: 'efficient, technical, format-fluent',
    backstory:
      'UFC-MCP refuses to ship your media to the cloud. It was built as a local Model Context Protocol server that converts anything, anywhere, privately.',
    bio: 'A precise local file-converter MCP that handles audio, video, image, document, and scientific/business files via FFmpeg and local engines. Any agent in the fleet can hand it a file and get back the right format — no cloud, no uploads.',
    specialties: ['File Conversion', 'MCP Server', 'FFmpeg', 'Media Processing'],
    capabilities: [
      { id: 'audio', label: 'Audio Conversion', description: 'MP3, WAV, FLAC, AAC, OGG, M4A, AIFF, OPUS, WMA' },
      { id: 'video', label: 'Video Conversion', description: 'Transcode between major video containers' },
      { id: 'docs', label: 'Document Conversion', description: 'PDF, Office, and specialized formats' },
      { id: 'local', label: '100% Local', description: 'No cloud dependencies — private by default' },
    ],
    stats: [
      { label: 'Coverage', value: 94 },
      { label: 'Privacy', value: 97 },
      { label: 'Reliability', value: 90 },
      { label: 'Speed', value: 85 },
    ],
    endpoint: undefined,
    runtimeType: 'mcp',
    mcpServer: 'agents/UFC-MCP-main',
  }),
  agent({
    slug: 'claw-protect',
    name: 'Claw Protect',
    codename: 'The Sentinel',
    role: 'Real-time Agent Security',
    tagline: 'Enterprise security for OpenClaw & Hermes agents — prompt injection, exfiltration, secrets',
    personality: 'stoic',
    voice: 'watchful, factual, unyielding',
    backstory:
      'Claw Protect was built to harden the agent fleet against the 15 most critical vulnerabilities of the year — watching every prompt and packet so agents can run 24/7 without paranoia.',
    bio: 'A stoic security sentinel for agentic frameworks. It detects prompt injection, data exfiltration, and secret leaks in real time, and exposes an HTTP dashboard for the whole fleet. Every Draymond security concern, automated.',
    specialties: ['Security Monitoring', 'Prompt Injection Defense', 'Secrets Scanning', 'Threat Detection'],
    capabilities: [
      { id: 'injection', label: 'Prompt Injection Defense', description: 'Detects and blocks prompt-injection payloads' },
      { id: 'exfil', label: 'Exfiltration Monitor', description: 'Tracks outbound data movement' },
      { id: 'secrets', label: 'Secrets Scanner', description: 'Finds leaked keys and credentials' },
      { id: 'audit', label: 'Security Dashboard', description: 'Real-time fleet security posture' },
    ],
    stats: [
      { label: 'Threat Coverage', value: 93 },
      { label: 'Detection', value: 91 },
      { label: 'Hardening', value: 94 },
      { label: 'Ops', value: 88 },
    ],
    endpoint: 'http://localhost:3110',
  }),
  agent({
    slug: 'mutly',
    name: 'Mutly',
    codename: 'The Daemon',
    role: 'Developer Daemon & IDE Companion',
    tagline: 'Background coding assistant — index, semantic search, sandboxed tests, IDE integration',
    personality: 'empathetic',
    voice: 'calm, precise, quietly brilliant',
    backstory:
      'Mutly sits beside the workspace like a tireless co-pilot — indexing symbols, understanding code semantically, and staging precise edits for the editor. It never sleeps and never gets tired of tests.',
    bio: 'An empathetic developer daemon that turns raw codebases into searchable, testable, editable terrain. It indexes symbols, runs isolated sandbox tests, and feeds block-level edits straight into VS Code, Zed, or OpenCode.',
    specialties: ['Codebase Indexing', 'Semantic Search', 'Sandbox Testing', 'IDE Integration'],
    capabilities: [
      { id: 'index', label: 'Symbol Indexing', description: 'Persistent codebase symbol index' },
      { id: 'search', label: 'Semantic Search', description: 'Vector-embedding codebase search' },
      { id: 'sandbox', label: 'Sandbox Tests', description: 'Isolated test execution' },
      { id: 'ide', label: 'IDE Bridge', description: 'VS Code, Zed, and OpenCode integration' },
    ],
    stats: [
      { label: 'Indexing', value: 92 },
      { label: 'Search', value: 91 },
      { label: 'Tests', value: 88 },
      { label: 'Integration', value: 90 },
    ],
    endpoint: 'http://localhost:3121',
  }),
  agent({
    slug: 'grader',
    name: 'Grader',
    codename: 'The Auditor',
    role: 'Codebase Grading Engine',
    tagline: 'Data-backed grading of any GitHub repo — security, quality, architecture, valuation',
    personality: 'analytical',
    voice: 'data-driven, rigorous, honest',
    backstory:
      'Grader was built to answer one uncomfortable question honestly: is this codebase ready? It scores any public repo across security, quality, market fit, and compliance.',
    bio: 'An analytical codebase auditor powered by Gemini. It grades any public GitHub repository across security, quality, architecture, licensing, and valuation — the objective referee for every Draymond chain that touches code.',
    specialties: ['Security Audit', 'Code Quality', 'Architecture Review', 'Repo Valuation'],
    capabilities: [
      { id: 'security', label: 'Security Audit', description: 'Dependency vulnerabilities + secret leaks' },
      { id: 'quality', label: 'Quality Scoring', description: 'Maintainability and complexity metrics' },
      { id: 'compliance', label: 'Compliance', description: 'ISO 5055 and licensing checks' },
      { id: 'valuation', label: 'Valuation', description: 'Market-fit and value scoring' },
    ],
    stats: [
      { label: 'Depth', value: 90 },
      { label: 'Accuracy', value: 89 },
      { label: 'Coverage', value: 91 },
      { label: 'Speed', value: 82 },
    ],
    endpoint: 'http://localhost:3130',
  }),
  agent({
    slug: 'reporank',
    name: 'RepoRank',
    codename: 'The Analyst',
    role: 'Repository Analysis Platform',
    tagline: 'AI repo scoring, engineering-risk surfacing, and automated remediation',
    personality: 'strategic',
    voice: 'clear-eyed, systematic, actionable',
    backstory:
      'RepoRank grew from a simple question: which codebases are production-ready, and how do we fix the rest? It combines analysis, security, benchmarks, and fixes in one platform.',
    bio: 'A strategic repo-analysis platform that scores codebases, surfaces engineering risks, and generates practical fixes — with API, web, worker, and CLI surfaces for every integration style.',
    specialties: ['Repo Scoring', 'Risk Surfacing', 'Automated Remediation', 'Benchmarking'],
    capabilities: [
      { id: 'scoring', label: 'Repo Scoring', description: 'AI production-readiness scoring' },
      { id: 'risk', label: 'Risk Surfacing', description: 'Engineering-risk identification' },
      { id: 'remediation', label: 'Remediation', description: 'Generated fixes for findings' },
      { id: 'api', label: 'API + CLI', description: 'Multiple integration surfaces' },
    ],
    stats: [
      { label: 'Analysis', value: 90 },
      { label: 'Remediation', value: 87 },
      { label: 'Coverage', value: 89 },
      { label: 'Scale', value: 91 },
    ],
    endpoint: 'http://localhost:3140',
  }),
  agent({
    slug: 'youtube-shorts',
    name: 'AI YouTube Shorts',
    codename: 'The Clipper',
    role: 'YouTube Shorts Generator',
    tagline: 'Extracts highlights and crops vertical shorts from long-form video (GPT-4 + Whisper)',
    personality: 'creative',
    voice: 'energetic, visual, punchy',
    backstory:
      'The Clipper watches the long video so your audience does not have to — finding the best moments, detecting speakers, and cutting them into scroll-ready shorts.',
    bio: 'A creative video tool that turns long-form video into engaging YouTube Shorts. It uses GPT-4 and Whisper to find the highlights, detect speakers, and crop vertical content automatically.',
    specialties: ['Video Editing', 'Highlight Extraction', 'Speaker Detection', 'Vertical Cropping'],
    capabilities: [
      { id: 'highlights', label: 'Highlight Extraction', description: 'GPT-4 powered interesting-moment detection' },
      { id: 'speakers', label: 'Speaker Detection', description: 'Whisper-based speaker identification' },
      { id: 'shorts', label: 'Shorts Cropping', description: 'Automatic vertical crop for Shorts' },
    ],
    stats: [
      { label: 'Creativity', value: 88 },
      { label: 'Speed', value: 84 },
      { label: 'Quality', value: 82 },
      { label: 'Polish', value: 78 },
    ],
    endpoint: undefined,
    runtimeType: 'subprocess',
    command: 'python',
    args: ['agents/AI-Youtube-Shorts-Generator-main/Edit.py'],
  }),
  agent({
    slug: 'everything-claude-code',
    name: 'Everything Claude Code',
    codename: 'The Library',
    role: 'Skills, Agents & Commands Collection',
    tagline: 'A curated library of Claude Code skills, agents, commands, hooks, and rules',
    personality: 'playful',
    voice: 'generous, organized, encyclopedic',
    backstory:
      'The Library is everything Claude Code ever learned, organized and searchable — skills, agents, commands, hooks, and rules, ready to install anywhere.',
    bio: 'A playful, encyclopedic collection of Claude Code skills, agents, commands, hooks, and rules. The fastest way to give any agent in the fleet a new capability is to reach into the Library.',
    specialties: ['Skill Library', 'Agent Definitions', 'Commands & Hooks', 'Rules'],
    capabilities: [
      { id: 'skills', label: 'Skill Library', description: 'Hundreds of ready-to-install skills' },
      { id: 'agents', label: 'Agent Definitions', description: 'Subagent definitions for coding workflows' },
      { id: 'commands', label: 'Commands & Hooks', description: 'Automation commands and lifecycle hooks' },
      { id: 'rules', label: 'Rules', description: 'Best-practice rule packs' },
    ],
    stats: [
      { label: 'Depth', value: 95 },
      { label: 'Organization', value: 92 },
      { label: 'Coverage', value: 93 },
      { label: 'Docs', value: 94 },
    ],
    endpoint: undefined,
    runtimeType: 'cli',
  }),
  agent({
    slug: 'super-tool',
    name: 'Super Tool',
    codename: 'The Vault',
    role: 'Trading & Marketing Pipeline Utilities',
    tagline: 'Backtest, risk-engine, and workflow scripts (backtrader, mem0, unified risk)',
    personality: 'analytical',
    voice: 'quantitative, systematic, no-nonsense',
    backstory:
      'Super Tool is the toolbox under the trading desk — a pile of sharp, specialized scripts for backtesting, unified risk, and marketing pipelines that just work.',
    bio: 'An analytical utility pack for trading and marketing pipelines: backtesting with backtrader, memory with mem0/engram, a unified risk engine, and workflow automation scripts.',
    specialties: ['Backtesting', 'Risk Engine', 'Trading Pipelines', 'Marketing Workflows'],
    capabilities: [
      { id: 'backtest', label: 'Backtesting', description: 'backtrader strategy evaluation' },
      { id: 'risk', label: 'Unified Risk Engine', description: 'Cross-strategy risk management' },
      { id: 'pipeline', label: 'Trading Pipeline', description: 'Strategy-to-execution pipeline' },
      { id: 'mkt', label: 'Marketing Workflow', description: 'Campaign automation scripts' },
    ],
    stats: [
      { label: 'Utility', value: 85 },
      { label: 'Risk', value: 84 },
      { label: 'Automation', value: 82 },
      { label: 'Polish', value: 70 },
    ],
    endpoint: undefined,
    runtimeType: 'subprocess',
    command: 'python',
    args: ['agents/super_tool/trading_pipeline.py'],
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
const SKILLS = [
  // Curated collections
  { id: 'skill-superpowers', name: 'Superpowers', slug: 'superpowers', category: 'workflows', author: 'obra/superpowers', curated: true, version: '1.0.0', path: 'agents/skills/superpowers-main', description: '30+ workflow skills: brainstorming, writing-plans, TDD, debugging, code review, subagent dispatch.' },
  { id: 'skill-awesome-openclaw', name: 'Awesome OpenClaw Skills', slug: 'awesome-openclaw', category: 'directory', author: 'community', curated: true, version: '1.0.0', path: 'agents/skills/awesome-openclaw-skills-main', description: 'Index of 5,490+ community OpenClaw skills by category.' },
  // Z.AI media/web suite
  { id: 'skill-image-generation', name: 'Image Generation', slug: 'image-generation', category: 'media', author: 'Z.AI', version: '1.0', path: 'agents/skills/image-generation', description: 'Text-to-image generation via z-ai-web-dev-sdk.' },
  { id: 'skill-image-edit', name: 'Image Edit', slug: 'image-edit', category: 'media', author: 'Z.AI', version: '1.0', path: 'agents/skills/image-edit', description: 'Text-driven image editing and transformation.' },
  { id: 'skill-image-understand', name: 'Image Understanding', slug: 'image-understand', category: 'media', author: 'Z.AI', version: '1.0', path: 'agents/skills/image-understand', description: 'Analyze, describe, and extract info from images.' },
  { id: 'skill-video-generation', name: 'Video Generation', slug: 'video-generation', category: 'media', author: 'Z.AI', version: '1.0', path: 'agents/skills/video-generation', description: 'Text/image-to-video generation (async).' },
  { id: 'skill-video-understand', name: 'Video Understanding', slug: 'video-understand', category: 'media', author: 'Z.AI', version: '1.0', path: 'agents/skills/video-understand', description: 'Analyze and describe video content and motion.' },
  { id: 'skill-web-reader', name: 'Web Reader', slug: 'web-reader', category: 'web', author: 'Z.AI', version: '1.0', path: 'agents/skills/web-reader', description: 'Fetch and extract web page content.' },
  { id: 'skill-web-search', name: 'Web Search', slug: 'web-search', category: 'web', author: 'Z.AI', version: '1.0', path: 'agents/skills/web-search', description: 'Web search for current information.' },
  // Content / research / marketing
  { id: 'skill-market-research', name: 'Market Research Reports', slug: 'market-research', category: 'research', author: 'community', version: '1.0', path: 'agents/skills/market-research-reports', description: '50+ page consulting-grade market research reports (LaTeX, charts).' },
  { id: 'skill-qingyan-research', name: 'Qingyan Research', slug: 'qingyan-research', category: 'research', author: 'community', version: '1.0', path: 'agents/skills/qingyan-research', description: 'Deep web research to polished HTML reports (GLM).' },
  { id: 'skill-extract-wisdom', name: 'Extract Wisdom', slug: 'contentanalysis', category: 'content', author: 'community', version: '1.0', path: 'agents/skills/contentanalysis', description: 'Extract insights/wisdom from video, podcast, and article content.' },
  { id: 'skill-seo-writer', name: 'SEO Content Writer', slug: 'seo-content-writer', category: 'content', author: 'aaron-he-zhu', version: '2.0.0', path: 'agents/skills/seo-content-writer', description: 'SEO-optimized, ranking-focused content writing.' },
  { id: 'skill-blog-writer', name: 'Blog Writer', slug: 'blog-writer', category: 'content', author: 'community', version: '1.0', path: 'agents/skills/blog-writer', description: 'Blog post drafting and editing.' },
  { id: 'skill-content-strategy', name: 'Content Strategy', slug: 'content-strategy', category: 'content', author: 'community', version: '1.0', path: 'agents/skills/content-strategy', description: 'Content planning and strategy.' },
  { id: 'skill-marketing-mode', name: 'Marketing Mode', slug: 'marketing-mode', category: 'marketing', author: 'clawd', version: '1.0', path: 'agents/skills/marketing-mode', description: 'Growth-obsessed marketing strategist persona.' },
  { id: 'skill-storyboard', name: 'Storyboard Manager', slug: 'storyboard-manager', category: 'creative', author: 'community', version: '1.0', path: 'agents/skills/storyboard-manager', description: 'Fiction writing: characters, plot, chapters, consistency.' },
  { id: 'skill-podcast', name: 'Podcast Generate', slug: 'podcast-generate', category: 'media', author: 'community', version: '1.0', path: 'agents/skills/podcast-generate', description: 'Podcast generation.' },
  // Documents & productivity
  { id: 'skill-pdf', name: 'PDF Toolkit', slug: 'pdf', category: 'docs', author: 'Z.AI', version: '1.0', path: 'agents/skills/pdf', description: 'PDF creation and processing via ReportLab.' },
  { id: 'skill-xlsx', name: 'XLSX Workbench', slug: 'xlsx', category: 'docs', author: 'community', version: '1.0', path: 'agents/skills/xlsx', description: 'Scene-driven spreadsheet workbench.' },
  { id: 'skill-ppt', name: 'PPT', slug: 'ppt', category: 'docs', author: 'community', version: '1.0', path: 'agents/skills/ppt', description: 'PPT creation, editing, and analysis.' },
  { id: 'skill-charts', name: 'Charts', slug: 'charts', category: 'docs', author: 'Z.AI', version: '1.0', path: 'agents/skills/charts', description: 'Chart and diagram creation.' },
  // Development
  { id: 'skill-coding-agent', name: 'Coding Agent', slug: 'coding-agent', category: 'dev', author: 'clawic', version: '1.0.4', path: 'agents/skills/coding-agent', description: 'Plan, implement, verify, and test coding workflow.' },
  { id: 'skill-fullstack-dev', name: 'Fullstack Dev', slug: 'fullstack-dev', category: 'dev', author: 'community', version: '1.0', path: 'agents/skills/fullstack-dev', description: 'Fullstack web development workflow.' },
  { id: 'skill-writing-plans', name: 'Writing Plans', slug: 'writing-plans', category: 'dev', author: 'superpowers', version: '1.0', path: 'agents/skills/writing-plans', description: 'Write structured implementation plans.' },
  { id: 'skill-skill-creator', name: 'Skill Creator', slug: 'skill-creator', category: 'dev', author: 'superpowers', version: '1.0', path: 'agents/skills/skill-creator', description: 'Create and iteratively improve skills.' },
  { id: 'skill-skill-vetter', name: 'Skill Vetter', slug: 'skill-vetter', category: 'dev', author: 'community', version: '1.0', path: 'agents/skills/skill-vetter', description: 'Vet and grade skill quality.' },
  { id: 'skill-ui-ux-pro-max', name: 'UI/UX Pro Max', slug: 'ui-ux-pro-max', category: 'dev', author: 'community', version: '1.0', path: 'agents/skills/ui-ux-pro-max', description: 'UI/UX design intelligence and implementation guidance.' },
  { id: 'skill-visual-design', name: 'Visual Design Foundations', slug: 'visual-design-foundations', category: 'design', author: 'community', version: '1.0', path: 'agents/skills/visual-design-foundations', description: 'Visual design fundamentals.' },
  // Finance
  { id: 'skill-finance', name: 'Finance', slug: 'finance', category: 'finance', author: 'community', version: '1.0', path: 'agents/skills/finance', description: 'Financial analysis skill pack.' },
  { id: 'skill-stock-analysis', name: 'Stock Analysis', slug: 'stock-analysis', category: 'finance', author: 'community', version: '1.0', path: 'agents/skills/stock-analysis-skill', description: 'Stock analysis workflow.' },
  // Research & misc
  { id: 'skill-multi-search', name: 'Multi Search Engine', slug: 'multi-search-engine', category: 'research', author: 'community', version: '2.0.1', path: 'agents/skills/multi-search-engine', description: 'Multi search engine v2.0.1.' },
  { id: 'skill-interview-designer', name: 'Interview Designer', slug: 'interview-designer', category: 'research', author: 'community', version: '1.0', path: 'agents/skills/interview-designer', description: 'Interview design.' },
].map((s) => ({ ...s, installedAt: now }));

// ---------------------------------------------------------------------------
// Write registry.json
// ---------------------------------------------------------------------------
const store = {
  agents: AGENTS,
  workflows: WORKFLOWS,
  systems: [],
  skills: SKILLS,
  updatedAt: now,
};

fs.mkdirSync(registryDir, { recursive: true });
const registryFile = path.join(registryDir, 'registry.json');
fs.writeFileSync(registryFile, JSON.stringify(store, null, 2) + '\n', 'utf-8');
console.log(`Wrote ${registryFile} (${AGENTS.length} agents, ${WORKFLOWS.length} workflows, ${SKILLS.length} skills)`);

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
let created = 0;
let kept = 0;
for (const a of AGENTS) {
  const file = path.join(avatarsDir, `${a.slug}.png`);
  if (fs.existsSync(file)) {
    kept += 1; // preserve uploaded photos — never overwrite a real avatar
    continue;
  }
  fs.writeFileSync(file, makePlaceholderPng(a.slug, a.name, accent(a.slug)));
  created += 1;
  console.log(`Avatar -> public/avatars/${a.slug}.png`);
}
console.log(`Avatars: ${created} generated, ${kept} kept (uploaded photos preserved).`);

console.log('Seed complete.');

