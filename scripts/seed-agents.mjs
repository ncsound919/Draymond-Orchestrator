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
    team: def.team || [],
    skills: def.skills || [],
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
    skills: ["coding-agent","fullstack-dev","writing-plans","ui-ux-pro-max","web-search"],
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
    skills: ["stock-analysis","finance","charts"],
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
    skills: ["market-research","qingyan-research","multi-search-engine","web-search","contentanalysis"],
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
    skills: ["coding-agent","fullstack-dev","skill-creator","skill-vetter"],
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
    role: 'Marketing Team Lead — Campaign & Engagement Analytics',
    tagline: 'Lead of the deterministic marketing team; consolidates the weekly Marketing Pulse',
    personality: 'empathetic',
    voice: 'observant, human, insightful',
    backstory:
      'Born from a terminal UI experiment, The Observer quietly watches every campaign metric so humans can focus on the conversation, not the spreadsheet. Promoted to lead of the marketing team, it now consolidates its four deterministic members — Voice Keeper, Scheduler, Format Auditor, and Tracker — into one auditable weekly Marketing Pulse.',
    bio: 'Lead of the Overlay365 marketing team. The Observer turns campaign noise into a clear picture and signs off on the deterministic outputs of its four members. Every action item in the Marketing Pulse cites exactly which member produced it.',
    specialties: ['Marketing Team Lead', 'Campaign Analytics', 'Engagement Tracking', 'Marketing Pulse'],
    skills: ["marketing-mode","seo-content-writer","content-strategy","blog-writer","charts","overlay-marketing"],
    capabilities: [
      { id: 'campaigns', label: 'Campaign Analytics', description: 'Performance across campaigns' },
      { id: 'engagement', label: 'Engagement Tracking', description: 'Customer engagement signals' },
      { id: 'pulse', label: 'Marketing Pulse', description: 'Consolidates Voice Keeper / Scheduler / Format Auditor / Tracker outputs weekly' },
      { id: 'snapshots', label: 'Snapshot Export', description: 'SVG report exports' },
    ],
    stats: [
      { label: 'Insight', value: 89 },
      { label: 'Orchestration', value: 93 },
      { label: 'Speed', value: 90 },
      { label: 'Precision', value: 86 },
    ],
    endpoint: process.env.SOCIAL_MEDIA_URL || 'http://localhost:8030',
    team: ['overlay-marketing-voice', 'overlay-marketing-scheduler', 'overlay-marketing-format', 'overlay-marketing-tracker'],
    workflows: ['wf-marketing-pulse'],
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
    skills: ["stock-analysis","finance","charts"],
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
    skills: ["image-generation","image-edit","image-understand","video-generation","pdf","xlsx","ppt"],
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
    endpoint: 'http://localhost:3333',
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
    skills: ["coding-agent","fullstack-dev","skill-vetter","writing-plans"],
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
    endpoint: 'http://localhost:4000',
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
    skills: ["skill-vetter","qingyan-research"],
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
    endpoint: 'http://localhost:3000',
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
    skills: ["skill-vetter","web-search"],
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
    endpoint: 'http://localhost:3001',
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
    skills: ["video-generation","video-understand","podcast-generate"],
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
    args: ['agents/AI-Youtube-Shorts-Generator-main/main.py'],
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
    skills: ["skill-creator"],
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
    skills: ["finance","stock-analysis"],
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
  agent({
    slug: 'agent-browser',
    name: 'Agent Browser',
    codename: 'The Conductor',
    role: 'Music Rights & Business Orchestrator',
    tagline: 'Registers your music (ASCAP/HFA/MLC), runs the fleet, and opens the book library',
    personality: 'strategic',
    voice: 'orchestral, decisive, business-first',
    backstory:
      'Agent Browser is the control room for the whole empire. It was built to register music with the performance rights organizations, keep every service in the fleet humming, and open the library when an agent needs to learn something new.',
    bio: 'A strategic conductor that turns your music catalog into registered, monetized rights across ASCAP, HFA, and MLC. It also orchestrates the Agent Browser platform (Big Homie, Claw Protect, Mutly, VibeServe, RepoRank) and gives every agent access to a 133-book knowledge library.',
    specialties: ['Music Registration', 'ASCAP / HFA / MLC', 'Fleet Orchestration', 'Book Library Access'],
    skills: ["music-rights","bookbridge","book-synthesis"],
    capabilities: [
      { id: 'ascap', label: 'ASCAP Registration', description: 'Extract + register compositions with ASCAP' },
      { id: 'hfa', label: 'HFA Upload', description: 'Harry Fox Agency mechanical licensing uploads' },
      { id: 'mlc', label: 'MLC Registration', description: 'Mechanical Licensing Collective catalog extraction' },
      { id: 'orchestrate', label: 'Fleet Orchestration', description: 'Coordinates Big Homie, Claw Protect, Mutly, VibeServe, RepoRank' },
      { id: 'library', label: 'Book Library', description: 'Searches and cites the 133-book knowledge library' },
    ],
    stats: [
      { label: 'Music Ops', value: 93 },
      { label: 'Orchestration', value: 95 },
      { label: 'Rights Accuracy', value: 90 },
      { label: 'Business Focus', value: 92 },
    ],
    endpoint: 'http://localhost:3000',
  }),
  agent({
    slug: 'bookbridge',
    name: 'BookBridge',
    codename: 'The Librarian',
    role: 'Book Library & Citation Engine',
    tagline: 'Search, cite, and retrieve from your book library (REST :8777 / MCP :8778)',
    personality: 'precise',
    voice: 'scholarly, exact, cite-first',
    backstory:
      'The Librarian keeps 133 books at its fingertips — searching passages, mapping concepts across books, and always ready with the exact citation. Every agent in the fleet asks it for knowledge.',
    bio: 'A precise book-library daemon that gives every agent searchable, citeable knowledge: hybrid keyword+semantic search, full-text retrieval, knowledge graphs, reading plans, and APA/MLA/Chicago/BibTeX/IEEE citations.',
    specialties: ['Hybrid Search', 'Citations', 'Knowledge Graph', 'Reading Plans'],
    skills: ["bookbridge","web-reader"],
    capabilities: [
      { id: 'search', label: 'Hybrid Search', description: 'FTS5 keyword + TF-IDF semantic search' },
      { id: 'retrieval', label: 'Full-Text Retrieval', description: 'Stream any page range from an offline cache' },
      { id: 'citations', label: 'Citations', description: 'APA, MLA, Chicago, BibTeX, Vancouver, IEEE' },
      { id: 'mcp', label: 'MCP Tools', description: 'Nine MCP tools for direct agent integration' },
    ],
    stats: [
      { label: 'Search', value: 94 },
      { label: 'Citations', value: 93 },
      { label: 'Coverage', value: 90 },
      { label: 'Speed', value: 91 },
    ],
    endpoint: 'http://localhost:8777',
  }),
  agent({
    slug: 'book-synthesis',
    name: 'Book Synthesis Engine',
    codename: 'The Synthesist',
    role: 'Multi-Book Knowledge Synthesis',
    tagline: 'Synthesizes up to 5 books into validated, illustrated reports with confidence scores',
    personality: 'creative',
    voice: 'synthetic, curious, evidence-conscious',
    backstory:
      'The Synthesist reads five books at once, cross-checks them against the web, and weaves the confirmed knowledge into a report — then draws a picture of the key ideas.',
    bio: 'A creative synthesis engine that processes up to 5 books simultaneously, scans the web for validation, cross-references sources for accuracy, and produces illustrated JSON/text reports with confidence scores.',
    specialties: ['Multi-Book Synthesis', 'Web Validation', 'Illustration', 'Report Generation'],
    skills: ["book-synthesis","web-search","contentanalysis"],
    capabilities: [
      { id: 'multi', label: 'Multi-Book Processing', description: 'Up to 5 PDF/EPUB/DOCX/TXT books at once' },
      { id: 'webscan', label: 'Web Scanning', description: 'Validates synthesized concepts online' },
      { id: 'validity', label: 'Validity Comparison', description: 'Cross-references sources for accuracy' },
      { id: 'reports', label: 'Comprehensive Reports', description: 'JSON + text reports with confidence scores' },
    ],
    stats: [
      { label: 'Synthesis', value: 92 },
      { label: 'Accuracy', value: 88 },
      { label: 'Coverage', value: 90 },
      { label: 'Creativity', value: 91 },
    ],
    endpoint: undefined,
    runtimeType: 'subprocess',
    command: 'python',
    args: ['agents/Book-Synthesis-Engine-main/knowledge_synthesizer.py'],
  }),
  // ── Overlay365 business-operations team ────────────────────────────────────
  agent({
    slug: 'overlay-strategist',
    name: 'The Strategist',
    codename: 'The Compass',
    role: 'Feedback Clustering & Roadmap Prioritization',
    tagline: 'Turns scattered feedback into a ranked, audit-traced roadmap',
    personality: 'strategic',
    voice: 'measured, synthesis-first, evidence-cited',
    backstory:
      'Assembled from kodus-ai\u2019s clustering engine and OmniResearch\u2019s research discipline, The Strategist reads every support email, issue, and reply as one voice in a conversation — and only makes claims it can trace to a raw record.',
    bio: 'Bi-weekly feedback clustering agent for the Overlay365 platforms (Health/Wealth/Justice). Clusters feedback by similarity, scores clusters on frequency/severity/brand alignment, and keeps every claim tied to evidence itemIds. Built to reject invented trends — thin data is reported as thin.',
    specialties: ['Feedback Clustering', 'Roadmap Prioritization', 'Brand Alignment', 'Evidence Auditing'],
    skills: ['overlay-strategist', 'market-research', 'contentanalysis', 'web-search', 'writing-plans', 'bookbridge'],
    capabilities: [
      { id: 'cluster', label: 'Evidence Clustering', description: 'Deterministic dedup + similarity clustering with full id trails' },
      { id: 'score', label: 'Prioritization Scoring', description: 'Frequency/severity/brand-alignment weighted 0-100 scores' },
      { id: 'audit', label: 'Audit-First Reporting', description: 'LLM narrative validated against evidence ids or dropped' },
      { id: 'ground', label: 'Library Grounding', description: 'Grounds recommendations in the BookBridge knowledge library' },
    ],
    stats: [
      { label: 'Clustering', value: 90 },
      { label: 'Auditability', value: 95 },
      { label: 'Research', value: 86 },
      { label: 'Bias Control', value: 92 },
    ],
    runtimeType: 'cli',
    command: 'npx',
    args: ['tsx', '../overlay365/agent-team/agents/strategist/index.ts'],
    tags: ['overlay365', 'product', 'roadmap', 'feedback'],
  }),
  agent({
    slug: 'overlay-treasurer',
    name: 'The Treasurer',
    codename: 'The Cashier',
    role: 'Cash Pulse & Revenue Reconciliation',
    tagline: 'One weekly number across Stripe, CashApp, and Venmo — never a guess',
    personality: 'precise',
    voice: 'numerical, withholding, nulls-left-visible',
    backstory:
      'Built on the stripe-pulse MRR/ARR engine, The Treasurer was taught that an estimate is a lie: MRR without subscription data stays null, and expense categories stay null until a source exists.',
    bio: 'Weekly cash-pulse agent across the three payment rails of Overlay365. Aggregates inflow by rail and platform, computes MRR only from real subscription data (null otherwise), flags anomalies against prior weeks, and never fabricates expense or pricing recommendations.',
    specialties: ['Revenue Reconciliation', 'MRR / ARR', 'Payment Rails', 'Anomaly Detection'],
    skills: ['overlay-treasurer', 'finance', 'stock-analysis', 'charts', 'xlsx'],
    capabilities: [
      { id: 'aggregate', label: 'Multi-Rail Aggregation', description: 'Stripe API + CashApp/Venmo manual CSV imports' },
      { id: 'mrr', label: 'MRR Computation', description: 'Reuses stripe-pulse subscription math; null when data is thin' },
      { id: 'anomaly', label: 'Inflow Anomalies', description: 'Flags drops vs multi-week averages' },
      { id: 'report', label: 'Cash Pulse Report', description: 'One-page markdown with nulls visible, never hidden' },
    ],
    stats: [
      { label: 'Accuracy', value: 94 },
      { label: 'Data Discipline', value: 97 },
      { label: 'Reconciliation', value: 90 },
      { label: 'Conservatism', value: 96 },
    ],
    runtimeType: 'cli',
    command: 'npx',
    args: ['tsx', '../overlay365/agent-team/agents/treasurer/index.ts'],
    tags: ['overlay365', 'finance', 'cash', 'revenue'],
  }),
  agent({
    slug: 'overlay-guardian',
    name: 'The Guardian',
    codename: 'The Watch',
    role: 'Compliance Flagging (Justice & Health)',
    tagline: 'Flags for human review — never drafts, never fabricates legal citations',
    personality: 'stoic',
    voice: 'cautionary, rules-cited, boundary-holding',
    backstory:
      'Modeled on claw-protect\u2019s fail-closed discipline: when the rule corpus is absent, The Guardian is inert-but-functional and says so. It will not guess a law, a statute, or a medical guideline from memory.',
    bio: 'Compliance guard for Justice (legal-adjacent) and Health (medical-adjacent) content. Evaluates content diffs and complaints against an uploaded ToS/Privacy/guideline corpus. Without that corpus it emits a single explicit flag and nothing else.',
    specialties: ['Content Compliance', 'Rule Corpus Matching', 'Legal/Health Boundaries', 'Fail-Closed Auditing'],
    skills: ['overlay-guardian', 'skill-vetter', 'book-synthesis', 'qingyan-research'],
    capabilities: [
      { id: 'corpus', label: 'Rule Corpus Matching', description: 'Trigger-pattern matching against uploaded reference docs only' },
      { id: 'diff', label: 'Content Diff Flagging', description: 'Flags changed Justice/Health content for human review' },
      { id: 'boundary', label: 'Scope Boundary', description: 'Never drafts final legal/medical text; flags only' },
      { id: 'failclosed', label: 'Fail-Closed Corpus', description: 'Empty corpus → explicit status, zero fabricated findings' },
    ],
    stats: [
      { label: 'Caution', value: 98 },
      { label: 'Rule Fidelity', value: 95 },
      { label: 'Scope Control', value: 97 },
      { label: 'Traceability', value: 94 },
    ],
    runtimeType: 'cli',
    command: 'npx',
    args: ['tsx', '../overlay365/agent-team/agents/guardian/index.ts'],
    tags: ['overlay365', 'compliance', 'legal', 'health'],
  }),
  agent({
    slug: 'overlay-auditor',
    name: 'The Auditor',
    codename: 'The Inspector',
    role: 'Deterministic Site Integrity Checks',
    tagline: 'Uptime, broken links, and payment flow — verified, not asserted',
    personality: 'analytical',
    voice: 'verifiable, pass/fail, no prose where data suffices',
    backstory:
      'Born from tldraw\u2019s link checker and Draymond\u2019s own monitors module, The Auditor runs deterministic checks against the live Overlay365 sites and reports pass/fail structure — no LLM, no opinion, just measured facts.',
    bio: 'Weekly deterministic auditor for uplift-health, uplift-wealth, uplift-justice, and overlay365.com. Checks uptime, same-origin broken links, and payment/donate link resolution read-only. Never executes a real payment.',
    specialties: ['Uptime Monitoring', 'Broken Link Crawling', 'Payment Flow Integrity', 'Deterministic Checks'],
    skills: ['overlay-auditor', 'web-reader', 'web-search', 'coding-agent', 'charts'],
    capabilities: [
      { id: 'uptime', label: 'Uptime Checks', description: 'HTTP status + response time per live site' },
      { id: 'links', label: 'Broken Link Crawl', description: 'Same-origin crawl, depth 2, rate-limited' },
      { id: 'payflow', label: 'Payment Flow', description: 'Read-only resolution of Stripe/CashApp/Venmo links' },
      { id: 'report', label: 'Audit Report', description: 'structured pass/fail + overall health' },
    ],
    stats: [
      { label: 'Determinism', value: 98 },
      { label: 'Coverage', value: 92 },
      { label: 'Speed', value: 90 },
      { label: 'Read-Only Safety', value: 97 },
    ],
    runtimeType: 'cli',
    command: 'npx',
    args: ['tsx', '../overlay365/agent-team/agents/auditor/index.ts'],
    tags: ['overlay365', 'monitoring', 'uptime', 'audit'],
  }),
  // ── Overlay365 deterministic marketing team (led by The Observer) ───────────
  agent({
    slug: 'overlay-marketing-voice',
    name: 'The Voice Keeper',
    codename: 'The Wordsmith',
    role: 'Brand Voice Guard',
    tagline: 'Deterministic brand-tone check on every planned post',
    personality: 'precise',
    voice: 'exact, rule-cited, boundary-holding',
    backstory:
      'Fail-closed like the Guardian: with no uploaded brand guidelines, The Voice Keeper says so and evaluates nothing rather than guessing the Overlay365 tone.',
    bio: 'Deterministic brand-voice guard for the marketing team. Matches draft posts against an uploaded Overlay365 brand-guidelines corpus (forbidden terms, required language, patterns). No corpus = explicit status, zero fabricated verdicts.',
    specialties: ['Brand Voice', 'Tone Rules', 'Fail-Closed Evaluation'],
    skills: ['overlay-marketing', 'seo-content-writer', 'content-strategy'],
    capabilities: [
      { id: 'voice', label: 'Brand Voice Check', description: 'Rule-corpus match against forbidden/required terms' },
      { id: 'failclosed', label: 'Fail-Closed Corpus', description: 'Empty guidelines corpus → explicit status, no guesses' },
    ],
    stats: [
      { label: 'Tone Fidelity', value: 95 },
      { label: 'Caution', value: 97 },
      { label: 'Consistency', value: 94 },
    ],
    runtimeType: 'cli',
    command: 'npx',
    args: ['tsx', '../overlay365/agent-team/agents/marketing/index.ts'],
    tags: ['marketing', 'brand', 'voice'],
    team: [],
  }),
  agent({
    slug: 'overlay-marketing-scheduler',
    name: 'The Scheduler',
    codename: 'The Planner',
    role: 'Deterministic Editorial Calendar',
    tagline: 'Turns topic seeds into a weekly cross-platform posting plan',
    personality: 'strategic',
    voice: 'organized, cadence-driven',
    backstory:
      'Built on deterministic cadence rules per platform — X, Instagram, LinkedIn, Facebook, TikTok — The Scheduler turns a topic seed list into a repeatable weekly plan with no judgment calls.',
    bio: 'Editorial calendar planner. Distributes topic seeds round-robin across per-platform weekly cadence rules and best posting slots. Pure and deterministic.',
    specialties: ['Editorial Calendar', 'Platform Cadence', 'Topic Rotation'],
    skills: ['overlay-marketing', 'content-strategy', 'blog-writer'],
    capabilities: [
      { id: 'calendar', label: 'Weekly Calendar', description: 'Deterministic post plan per platform/day/slot' },
      { id: 'rotation', label: 'Topic Rotation', description: 'Round-robin distribution of topic seeds' },
    ],
    stats: [
      { label: 'Cadence', value: 93 },
      { label: 'Coverage', value: 91 },
      { label: 'Determinism', value: 98 },
    ],
    runtimeType: 'cli',
    command: 'npx',
    args: ['tsx', '../overlay365/agent-team/agents/marketing/index.ts'],
    tags: ['marketing', 'calendar', 'scheduling'],
    team: [],
  }),
  agent({
    slug: 'overlay-marketing-format',
    name: 'The Format Auditor',
    codename: 'The Inspector of Layouts',
    role: 'Cross-Platform Content Format Audit',
    tagline: 'Character, hashtag, and link checks per platform — pass/fail',
    personality: 'analytical',
    voice: 'verifiable, constraint-cited',
    backstory:
      'The deterministic sibling of The Auditor, applied to content: X 280 chars, LinkedIn links required, hashtag ceilings enforced — no opinions, only constraints.',
    bio: 'Format auditor for the marketing team. Validates planned posts against per-platform constraints (character limits, hashtag ceilings, link requirements) and reports pass/fail.',
    specialties: ['Platform Constraints', 'Character Limits', 'Hashtag Rules'],
    skills: ['overlay-marketing', 'seo-content-writer'],
    capabilities: [
      { id: 'format', label: 'Format Audit', description: 'Per-platform character/hashtag/link validation' },
    ],
    stats: [
      { label: 'Constraint Fidelity', value: 96 },
      { label: 'Determinism', value: 98 },
    ],
    runtimeType: 'cli',
    command: 'npx',
    args: ['tsx', '../overlay365/agent-team/agents/marketing/index.ts'],
    tags: ['marketing', 'format', 'content'],
    team: [],
  }),
  agent({
    slug: 'overlay-marketing-tracker',
    name: 'The Tracker',
    codename: 'The Ledger',
    role: 'Performance & Engagement Analytics',
    tagline: 'Engagement metrics aggregated deterministically — nulls left visible',
    personality: 'stoic',
    voice: 'numerical, withholding, null-safe',
    backstory:
      'In the image of The Treasurer: no data source, no estimate. The Tracker aggregates imported engagement rows and reports nulls when nothing is wired.',
    bio: 'Performance analyst for the marketing team. Aggregates impressions/engagements from imported rows, computes engagement rate, and flags anomalies vs prior weeks. Null-safe: unavailable data stays unavailable.',
    specialties: ['Engagement Metrics', 'Anomaly Detection', 'Null-Safe Reporting'],
    skills: ['overlay-marketing', 'charts', 'xlsx'],
    capabilities: [
      { id: 'metrics', label: 'Engagement Aggregation', description: 'Impressions/engagements by platform' },
      { id: 'anomaly', label: 'Anomaly Detection', description: 'Flags drops vs multi-week averages' },
    ],
    stats: [
      { label: 'Accuracy', value: 94 },
      { label: 'Data Discipline', value: 96 },
      { label: 'Conservatism', value: 95 },
    ],
    runtimeType: 'cli',
    command: 'npx',
    args: ['tsx', '../overlay365/agent-team/agents/marketing/index.ts'],
    tags: ['marketing', 'analytics', 'engagement'],
    team: [],
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
  {
    id: 'wf-overlay-founder-sync',
    name: 'Overlay365 Weekly Founder Sync',
    description:
      'Consolidates the four Overlay365 agents (Strategist, Treasurer, Guardian, Auditor) into a single Founder Sync memo. Agents without wired data sources report "not-run" explicitly.',
    version: '1.0.0',
    steps: [
      { id: 's1', type: 'task', label: 'Run site integrity audit', agent: 'overlay-auditor' },
      { id: 's2', type: 'task', label: 'Compute weekly cash pulse', agent: 'overlay-treasurer' },
      { id: 's3', type: 'task', label: 'Cluster feedback + roadmap', agent: 'overlay-strategist' },
      { id: 's4', type: 'task', label: 'Flag compliance content', agent: 'overlay-guardian' },
      { id: 's5', type: 'decision', label: 'Consolidate into Founder Sync memo' },
    ],
    assignedAgents: [
      'overlay-auditor',
      'overlay-treasurer',
      'overlay-strategist',
      'overlay-guardian',
    ],
    trigger: 'schedule',
    schedule: '0 9 * * 1',
    tags: ['overlay365', 'founder-sync', 'reporting'],
    installedAt: now,
    sourceType: 'builtin',
  },
  {
    id: 'wf-marketing-pulse',
    name: 'Marketing Pulse (weekly)',
    description:
      'The Observer consolidates its four deterministic members — Voice Keeper, Scheduler, Format Auditor, Tracker — into the weekly Marketing Pulse memo.',
    version: '1.0.0',
    steps: [
      { id: 's1', type: 'task', label: 'Check brand voice on planned posts', agent: 'overlay-marketing-voice' },
      { id: 's2', type: 'task', label: 'Build weekly editorial calendar', agent: 'overlay-marketing-scheduler' },
      { id: 's3', type: 'task', label: 'Audit post formats per platform', agent: 'overlay-marketing-format' },
      { id: 's4', type: 'task', label: 'Aggregate engagement metrics', agent: 'overlay-marketing-tracker' },
      { id: 's5', type: 'decision', label: 'Consolidate into Marketing Pulse', agent: 'social-media-dashboard' },
    ],
    assignedAgents: [
      'social-media-dashboard',
      'overlay-marketing-voice',
      'overlay-marketing-scheduler',
      'overlay-marketing-format',
      'overlay-marketing-tracker',
    ],
    trigger: 'schedule',
    schedule: '0 10 * * 1',
    tags: ['marketing', 'pulse', 'reporting'],
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
  // AgentBrowser / music-rights / book tools
  { id: 'skill-music-rights', name: 'Music Rights (ASCAP/HFA/MLC)', slug: 'music-rights', category: 'music', author: 'AgentBrowser', version: '1.0', path: 'agents/AgentBrowser-main/mini-services/music-rights', description: 'Register compositions with ASCAP, HFA, and MLC from a catalog.' },
  { id: 'skill-bookbridge', name: 'BookBridge', slug: 'bookbridge', category: 'knowledge', author: 'ncsound919', version: '1.0', path: 'agents/BookBridge--main', description: 'Search, cite, and retrieve from the book library (REST :8777 / MCP :8778).' },
  { id: 'skill-book-synthesis', name: 'Book Synthesis Engine', slug: 'book-synthesis', category: 'knowledge', author: 'ncsound919', version: '1.0', path: 'agents/Book-Synthesis-Engine-main', description: 'Synthesize up to 5 books into validated, illustrated reports with confidence scores.' },
  // Overlay365 business-operations skills
  { id: 'skill-overlay-strategist', name: 'Overlay365 Strategist', slug: 'overlay-strategist', category: 'business', author: 'overlay365-agent-team', version: '1.0', path: '../overlay365/agent-team', description: 'Evidence-clustered feedback triage and roadmap prioritization (audit-traced).' },
  { id: 'skill-overlay-treasurer', name: 'Overlay365 Treasurer', slug: 'overlay-treasurer', category: 'business', author: 'overlay365-agent-team', version: '1.0', path: '../overlay365/agent-team', description: 'Weekly cash pulse across Stripe/CashApp/Venmo; MRR only from real subscription data.' },
  { id: 'skill-overlay-guardian', name: 'Overlay365 Guardian', slug: 'overlay-guardian', category: 'business', author: 'overlay365-agent-team', version: '1.0', path: '../overlay365/agent-team', description: 'Compliance flagging for Justice/Health content against an uploaded rule corpus (fail-closed).' },
  { id: 'skill-overlay-auditor', name: 'Overlay365 Auditor', slug: 'overlay-auditor', category: 'business', author: 'overlay365-agent-team', version: '1.0', path: '../overlay365/agent-team', description: 'Deterministic uptime, broken-link, and payment-flow checks on the live Overlay365 sites.' },
  { id: 'skill-overlay-marketing', name: 'Overlay365 Marketing Team', slug: 'overlay-marketing', category: 'marketing', author: 'overlay365-agent-team', version: '1.0', path: '../overlay365/agent-team', description: 'Deterministic marketing team (Voice Keeper, Scheduler, Format Auditor, Tracker) led by The Observer.' },
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




