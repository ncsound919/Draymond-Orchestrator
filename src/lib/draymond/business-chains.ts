// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Business Automation Chain Templates & Jobs
// ============================================================================
// Defines and seeds the business automation chain templates and scheduled jobs
// for the Draymond Orchestrator. Creates entities for specialized agents,
// chain templates for daily workflows, and scheduled cron jobs.
//
// Run via POST /api/seed or import and call seedBusinessAutomation() directly.
// Uses upserts — safe to run repeatedly without creating duplicates.
// ============================================================================

import { createDraymondAdminClient } from './client';
import { createChain, addSteps, getChain } from './chains';
import { getNextRunTime } from './scheduler';
import type { InvocationMethod } from './types';

// ============================================================================
// PORT ASSIGNMENT MAP — avoids conflicts across the fleet
// ============================================================================
// Draymond Orchestrator itself runs on :3000
// Each agent gets a unique port. Update .env.local to override.
//
// Port ranges:
//   3000        — Draymond (reserved)
//   3001        — Bet Buddy (Express)
//   3010        — OmniResearch Pro (Express)
//   3020        — Overlay Chain (Next.js)
//   3090        — Overlay Global Lens (Express; use PORT=3090 so it never
//                 collides with Draymond's :3000 in local fleet dev)
//   8000        — Uplift Agent (batch_server.py)
//   8010        — Sports Steve (FastAPI)
//   8020        — Indy Music Platform (FastAPI)
//   8030        — Social Media Dashboard AI API (FastAPI)
//   8040        — TradingAgents (wrapper — not yet built)
//   8050        — Sub Team (wrapper — not yet built)
//   9744        — MegaCode JetBrains bridge (HTTP)

// ============================================================================
// ENTITY DEFINITIONS — Full Uplift Agent Fleet
// ============================================================================

/** Strip trailing slashes from a URL to prevent double-slash when appending paths. */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Resolve an agent base URL from an env var with a fallback.
 * Always strips trailing slashes for safe path concatenation.
 */
function agentUrl(envVar: string, fallback: string): string {
  return normalizeBaseUrl(process.env[envVar] || fallback);
}

interface EntitySeedDef {
  name: string;
  slug: string;
  kind: 'agent' | 'service' | 'tool' | 'skill';
  description: string;
  invocation_method: InvocationMethod;
  invocation_config: Record<string, unknown>;
  capabilities: string[];
  tags: string[];
  category: string;
  health_endpoint?: string;
}

const ENTITY_DEFS: EntitySeedDef[] = [
  // ── 1. Uplift Agent ─────────────────────────────────────────────────
  // Primary worker agent — Hermes fork with batch_server.py + Draymond bridge
  // Empowered with: Sub Team tools (5), MegaCode tools (3), 14 superpowers skills,
  // 179 Claude/CCE skills, and 52+ total registered tools.
  {
    name: 'Uplift Agent',
    slug: 'uplift-agent',
    kind: 'agent',
    description:
      'General-purpose automation agent (Hermes fork). 52+ tools including Sub Team CPU pipeline (5 tools), MegaCode code completion (3 tools), terminal, browser, file ops, web research, delegation, and multi-agent coordination. 193+ skills across superpowers, Claude/CCE, and domain-specific catalogs. Served via batch_server.py.',
      invocation_method: 'http_api',
      invocation_config: {
        url: agentUrl('UPLIFT_BASE_URL', 'http://localhost:8000'),
        health_url: `${agentUrl('UPLIFT_BASE_URL', 'http://localhost:8000')}/health`,
        endpoints: {
          default: { path: '/task', method: 'POST' },
          chat: { path: '/task', method: 'POST' },
          task: { path: '/task', method: 'POST' },
          batch: { path: '/task', method: 'POST' },
          batch_multi: { path: '/batch/multi', method: 'POST' },
          task_status: { path: '/task/{id}', method: 'GET' },
          session: { path: '/session/{id}', method: 'GET' },
        },
      },
    capabilities: [
      'general_automation',
      'code_execution',
      'web_research',
      'file_operations',
      'multi_agent_coordination',
      'cpu_rtl_generation',
      'code_completion',
      'skill_execution',
      'sub_team_pipeline',
      'megacode_bridge',
    ],
    tags: ['core', 'automation', 'hermes', 'sub-team', 'megacode', 'skills'],
    category: 'automation',
    health_endpoint: '/health',
  },

  // ── 2. TradingAgents ────────────────────────────────────────────────
  // LangGraph multi-agent stock analysis — Python library, no HTTP server
  {
    name: 'TradingAgents',
    slug: 'trading-agents',
    kind: 'agent',
    description:
      'Multi-agent stock analysis framework (LangGraph). Runs market analysis, risk assessment, and signal generation. Python library — no built-in HTTP server.',
    invocation_method: 'python_module',
    invocation_config: {
      module: 'main',
      function: 'main',
      working_dir: process.env.TRADING_AGENTS_DIR || './agents/TradingAgents-main',
      python_path: process.env.TRADING_AGENTS_PYTHON || 'python',
      // If a future HTTP wrapper is deployed:
      fallback_url: process.env.TRADING_AGENTS_URL || 'http://localhost:8040',
    },
    capabilities: [
      'stock_analysis',
      'risk_assessment',
      'trading_signals',
      'market_sentiment',
    ],
    tags: ['finance', 'trading', 'langgraph'],
    category: 'finance',
  },

  // ── 3. Sports Steve ─────────────────────────────────────────────────
  // FastAPI sports betting agent with APScheduler (daily runs + hourly resolution)
  {
    name: 'Sports Steve',
    slug: 'sports-steve',
    kind: 'agent',
    description:
      'Sports betting analysis agent (FastAPI). Daily bet assessment at 9AM, hourly resolution at :05. Endpoints for daily-run and resolve-bets.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('SPORTS_STEVE_URL', 'http://localhost:8010'),
      method: 'POST',
      health_url: `${agentUrl('SPORTS_STEVE_URL', 'http://localhost:8010')}/api/v1/health`,
      endpoints: {
        daily_run: '/api/v1/daily-run',
        resolve_bets: '/api/v1/resolve-bets',
      },
    },
    capabilities: [
      'daily_bet_assessment',
      'bet_resolution',
      'odds_analysis',
      'kelly_criterion',
    ],
    tags: ['sports', 'betting', 'fastapi'],
    category: 'sports',
    health_endpoint: '/health',
  },

  // ── 4. Bet Buddy ────────────────────────────────────────────────────
  // Express.js companion to Sports Steve — OCR, odds calc, Kelly, bankroll
  {
    name: 'Bet Buddy',
    slug: 'bet-buddy',
    kind: 'service',
    description:
      'Sports betting toolkit (Express.js). 30+ endpoints for OCR, odds calculation, statistics, Kelly criterion, bankroll management, and SimVC games.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('BET_BUDDY_URL', 'http://localhost:3001'),
      method: 'POST',
      health_url: `${agentUrl('BET_BUDDY_URL', 'http://localhost:3001')}/health`,
      endpoints: {
        health: '/health',
        odds_calc: '/api/tools/odds/calculate-return',
        kelly: '/api/tools/statistics/kelly-criterion',
        bankroll: '/api/tools/bankroll/unit-size',
        ocr: '/api/ocr/extract',
        stats: '/api/tools/statistics/calculate',
      },
    },
    capabilities: [
      'odds_calculation',
      'kelly_criterion',
      'bankroll_management',
      'screenshot_ocr',
      'sports_statistics',
    ],
    tags: ['sports', 'betting', 'express'],
    category: 'sports',
    health_endpoint: '/health',
  },

  // ── 5. Social Media Dashboard (AI API) ──────────────────────────────
  // FastAPI AI backend — text/image/video generation, podcast, voicebox
  {
    name: 'Social Media Dashboard',
    slug: 'social-media-dashboard',
    kind: 'service',
    description:
      'AI-powered content creation service (FastAPI). Text, image, and video generation. Podcast narration/music/mixing. Voice synthesis and cloning. Celery/Redis for async.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('SOCIAL_MEDIA_URL', 'http://localhost:8030'),
      method: 'POST',
      health_url: `${agentUrl('SOCIAL_MEDIA_URL', 'http://localhost:8030')}/api/ai/health`,
      endpoints: {
        generate_text: '/api/ai/generate-text',
        generate_image: '/api/ai/generate-image',
        generate_video: '/api/ai/generate-video',
        schedule_posts: '/api/ai/schedule',
        schedule_post: '/api/ai/schedule',
        podcast_narrate: '/api/ai/podcast/narrate',
        podcast_music: '/api/ai/podcast/music',
        podcast_mix: '/api/ai/podcast/mix',
        voicebox_synthesize: '/api/ai/voicebox/synthesize',
        voicebox_clone: '/api/ai/voicebox/clone',
      },
    },
    capabilities: [
      'text_generation',
      'image_generation',
      'video_generation',
      'podcast_creation',
      'voice_synthesis',
      'social_posting',
      'campaign_management',
    ],
    tags: ['marketing', 'content', 'ai', 'fastapi'],
    category: 'marketing',
    health_endpoint: '/api/ai/health',
  },

  // ── 6. OmniResearch Pro ─────────────────────────────────────────────
  // Express.js backend — Ollama/SearXNG proxy, Slack/Notion integrations
  // NOTE: Core Gemini research is client-side. Server proxies local models.
  {
    name: 'OmniResearch Pro',
    slug: 'omni-research',
    kind: 'agent',
    description:
      'Research assistant (Express.js + React). Server proxies Ollama and SearXNG. Gemini report generation is client-side. Use /api/ollama/generate for local-model reports.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('OMNI_RESEARCH_URL', 'http://localhost:3010'),
      method: 'POST',
      health_url: `${agentUrl('OMNI_RESEARCH_URL', 'http://localhost:3010')}/api/health`,
      endpoints: {
        trending_topics: '/api/trending-topics',
        research_news: '/api/research',
        web_search: '/api/web-search',
        ollama_generate: '/api/ollama/generate',
        slack_share: '/api/slack/share',
        notion_sync: '/api/notion/sync',
      },
    },
    capabilities: [
      'research_generation',
      'web_search',
      'slack_share',
      'notion_sync',
    ],
    tags: ['research', 'ollama', 'express'],
    category: 'research',
    health_endpoint: '/api/health',
  },

  // ── 6b. Overlay Global Lens ──────────────────────────────────────────
  // Fleet publishing target: ecosystem news/insights/discoveries ingestion.
  // POST /api/publish inserts an article that flows through the Global Lens
  // AI pipeline (reframing, takeaways, backstory) like any RSS item.
  {
    name: 'Overlay Global Lens',
    slug: 'global-lens',
    kind: 'service',
    description:
      'Global Lens publishing endpoint — ingest finished fleet articles/insights (e.g. the Hemp Research & News digest) into the Overlay365 ecosystem news platform.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('GLOBAL_LENS_URL', 'http://localhost:3090'),
      method: 'POST',
      health_url: `${agentUrl('GLOBAL_LENS_URL', 'http://localhost:3090')}/api/health`,
      endpoints: {
        publish: '/api/publish',
      },
    },
    capabilities: ['publishing', 'news_ingest', 'content_syndication'],
    tags: ['publishing', 'news', 'overlay365'],
    category: 'marketing',
    health_endpoint: '/api/health',
  },

  // ── 7. Indy Music Platform (NC Studio) ──────────────────────────────
  // FastAPI + React — artist site builder, social scheduling, fan CRM
  {
    name: 'Indy Music Platform',
    slug: 'indy-music-platform',
    kind: 'service',
    description:
      'Music industry automation platform (FastAPI). Artist site builds, social scheduling, fan capture, preset marketplace, beat management, distribution, CRM, and smart links.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('INDY_MUSIC_URL', 'http://localhost:8020'),
      method: 'POST',
      health_url: `${agentUrl('INDY_MUSIC_URL', 'http://localhost:8020')}/health`,
      endpoints: {
        start_build: '/api/start-build',
        schedule_post: '/api/schedule-post',
        vibe_check: '/api/vibe-check/{id}',
        fan_capture: '/api/fan-capture',
        preset_marketplace: '/api/presets',
        beats: '/api/beats',
        distribution: '/api/distribution',
        crm: '/api/crm',
        smart_links: '/api/smart-links',
      },
    },
    capabilities: [
      'artist_site_build',
      'social_scheduling',
      'fan_capture',
      'preset_marketplace',
      'beat_management',
      'distribution',
      'fan_crm',
      'smart_links',
    ],
    tags: ['music', 'marketing', 'fastapi', 'nc-studio'],
    category: 'music',
    health_endpoint: '/health',
  },

  // ── 8. MegaCode (OverCoat) ──────────────────────────────────────────
  // TypeScript IDE extension SDK with Draymond integration built in
  {
    name: 'MegaCode',
    slug: 'megacode',
    kind: 'agent',
    description:
      'Multi-agent coding system (OverCoat). IDE bridges for VSCode, Zed, Cursor, JetBrains. Already has Draymond integration (DraymondEntitySeeder). JetBrains HTTP bridge on port 9744.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('MEGACODE_URL', 'http://localhost:9744'),
      method: 'POST',
      health_url: `${agentUrl('MEGACODE_URL', 'http://localhost:9744')}/health`,
      endpoints: {
        health: '/health',
        complete: '/complete',
        review: '/review',
      },
    },
    capabilities: [
      'code_completion',
      'multi_agent_coding',
      'ticket_to_pr',
      'code_review',
      'vibe_coding',
    ],
    tags: ['coding', 'ide', 'typescript', 'overcoat'],
    category: 'development',
    health_endpoint: '/health',
  },

  // ── 8b. Cheetah ─────────────────────────────────────────────────────
  // Deterministic autocoding engine — template-driven scaffolding, UI
  // component generation, pinned dependencies, Docker, telemetry. No LLM.
  {
    name: 'Cheetah',
    slug: 'cheetah',
    kind: 'tool',
    description:
      'Enterprise deterministic autocoding engine (FastAPI :4120). Template-driven project scaffolds, pinned dependency lockfiles, Dockerfile generation, Game Maker UI component + preset generation, resource monitoring, and build telemetry. 100% reproducible without an LLM. Complements the deterministic-brain skill packs and the code-automation pipeline.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('CHEETAH_URL', 'http://localhost:4120'),
      method: 'POST',
      health_url: `${agentUrl('CHEETAH_URL', 'http://localhost:4120')}/health`,
      endpoints: {
        health: '/health',
        capabilities: '/capabilities',
        preflight: '/preflight',
        generate: '/generate',
        build: '/build',
        components: '/components',
        presets: '/presets',
        components_generate: '/components/generate',
        presets_generate: '/presets/generate',
        security_scan: '/audit/security-scan',
        suggest_stack: '/enhance/suggest-stack',
        component_config: '/enhance/component-config',
        components_from_description: '/components/from-description',
        readme: '/enhance/readme',
      },
    },
    capabilities: [
      'project_scaffolding',
      'template_generation',
      'dependency_pinning',
      'docker_generation',
      'ui_component_generation',
      'preset_generation',
      'resource_monitoring',
      'build_telemetry',
      'security_scanning',
    ],
    tags: ['coding', 'scaffolding', 'templates', 'deterministic', 'game-maker', 'ui'],
    category: 'development',
    health_endpoint: '/health',
  },

  // ── 9. Overlay Chain (ChainFlow) ────────────────────────────────────
  // Next.js supply chain intelligence — demand forecast, anomaly detection, blockchain
  {
    name: 'Overlay Chain',
    slug: 'overlay-chain',
    kind: 'service',
    description:
      'Supply chain intelligence platform (Next.js + Prisma). Demand forecasting, anomaly detection, risk assessment, inventory optimization, blockchain traceability, scenario simulation.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('OVERLAY_CHAIN_URL', 'http://localhost:3020'),
      method: 'POST',
      health_url: `${agentUrl('OVERLAY_CHAIN_URL', 'http://localhost:3020')}/api`,
      endpoints: {
        demand_forecast: '/api/chainflow',
        anomaly_detection: '/api/chainflow',
        risk_assessment: '/api/assessment',
        supply_chain_query: '/api/chainflow',
        inventory_optimization: '/api/chainflow',
        simulator: '/api/simulator',
        dashboard: '/api/dashboard',
      },
    },
    capabilities: [
      'demand_forecast',
      'anomaly_detection',
      'risk_assessment',
      'supply_chain_query',
      'inventory_optimization',
      'blockchain_traceability',
      'scenario_simulation',
    ],
    tags: ['supply-chain', 'blockchain', 'nextjs', 'chainflow'],
    category: 'supply-chain',
    health_endpoint: '/api',
  },

  // ── 10. Sub Team ────────────────────────────────────────────────────
  // Full-spectrum agentic workforce (8 CrewAI agents) + deterministic
  // CPU RTL generation + cross-disciplinary/business analysis.
  // HTTP server (FastAPI) — also supports subprocess fallback.
  {
    name: 'Sub Team',
    slug: 'sub-team',
    kind: 'agent',
    description:
      'Full-spectrum agentic workforce with 8 specialized CrewAI agents (research, coding, data science, business strategy, creative, security, architecture, hardware). Retains deterministic CPU RTL pipeline and cross-disciplinary/business analysis.',
    invocation_method: 'http_api',
    invocation_config: {
      base_url:
        process.env.SUB_TEAM_URL || 'http://localhost:8050',
      health_endpoint: '/health',
      timeout_ms: 120_000,
      headers: {
        Authorization: `Bearer ${process.env.SUB_TEAM_AUTH_TOKEN || process.env.CRON_SECRET || ''}`,
        'Content-Type': 'application/json',
      },
      endpoints: {
        execute: { method: 'POST', path: '/execute' },
        capabilities: { method: 'GET', path: '/capabilities' },
        cpu_pipeline: { method: 'POST', path: '/pipeline/cpu' },
        analyze: { method: 'POST', path: '/pipeline/analyze' },
        business: { method: 'POST', path: '/pipeline/business' },
        memory_store: { method: 'POST', path: '/memory' },
        memory_search: { method: 'POST', path: '/memory/search' },
      },
      // Subprocess fallback if HTTP server is not running
      fallback: {
        command: process.env.SUB_TEAM_PYTHON || 'python',
        args: ['main.py'],
        working_dir: process.env.SUB_TEAM_DIR || './agents/Sub-Team',
        env: {
          DRAYMOND_TOTAL_BUDGET: '10000',
        },
      },
    },
    capabilities: [
      'agentic_workforce',
      'research',
      'code_generation',
      'data_science',
      'business_strategy',
      'creative_content',
      'security_analysis',
      'systems_architecture',
      'cpu_rtl_generation',
      'cross_disciplinary_analysis',
      'business_intelligence',
      'agent_memory',
    ],
    tags: ['agentic', 'crewai', 'workforce', 'hardware', 'verilog', 'python', 'rtl', 'research', 'security'],
    category: 'engineering',
  },

  // ── 11. Hemp-OS ─────────────────────────────────────────────────────
  // Deterministic hemp/biomanufacturing simulation OS with autonomous
  // intelligence cycles (insights → research tasks → public content)
  {
    name: 'Hemp-OS',
    slug: 'hemp-os',
    kind: 'agent',
    description:
      'Deterministic scientific operating system for hemp processing and biomanufacturing simulation. Runs autonomous intelligence cycles every 6h: cross-references datasets, stores insights, creates research tasks, and auto-produces public education content.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('HEMP_OS_URL', 'http://localhost:3100'),
      method: 'POST',
      health_url: `${agentUrl('HEMP_OS_URL', 'http://localhost:3100')}/health`,
      endpoints: {
        kernel: '/api/kernel',
        ai: '/api/ai',
        ingest: '/api/ingest',
        integration: '/api/integration',
        ollama: '/api/ollama',
      },
    },
    capabilities: [
      'research',
      'simulation',
      'analysis',
      'generation',
      'automation',
      'cross_referencing',
      'content_generation',
      'paper_generation',
    ],
    tags: ['hemp', 'research', 'simulation', 'kernel', 'autonomy'],
    category: 'research',
    health_endpoint: '/health',
  },

  // ── 12. HempForge ───────────────────────────────────────────────────
  // Compliance + COA verification + literature intelligence for the hemp division
  {
    name: 'HempForge',
    slug: 'hempforge',
    kind: 'service',
    description:
      'Compliance, COA verification, and scientific literature intelligence platform. Literature ingest (PubMed/OpenAlex/Europe PMC), trend snapshots, autonomous research pipeline, ALCOA++ audit chain, and GxP workflows. Provenance-classified AI outputs.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('HEMPFORGE_URL', 'http://localhost:3000'),
      method: 'POST',
      health_url: `${agentUrl('HEMPFORGE_URL', 'http://localhost:3000')}/api/health`,
      endpoints: {
        literature_search: '/api/literature/search',
        literature_ingest_defaults: '/api/literature/ingest-defaults',
        literature_trends: '/api/literature/trends-insights',
        literature_trend_snapshot: '/api/literature/trend-snapshot',
        literature_autonomous: '/api/literature/run-autonomous-pipeline',
        literature_production: '/api/literature/production/run',
        audit_verify_chain: '/api/audit/verify-chain',
        reports_generate: '/api/reports/generate',
      },
    },
    capabilities: [
      'coa_intake',
      'compliance_ledger',
      'audit_trail',
      'literature_intelligence',
      'trend_detection',
      'regulatory_risk',
      'workflow_management',
      'reporting',
    ],
    tags: ['hemp', 'compliance', 'literature', 'audit', 'gxp', 'regulatory'],
    category: 'compliance',
    health_endpoint: '/api/health',
  },

  // ── 12b. AetherDesk Call Center ─────────────────────────────────────
  // Voice call-center platform: outbound/inbound calls, voice cloning,
  // campaigns, AI agent orchestration. The ecosystem's phone presence.
  {
    name: 'AetherDesk Call Center',
    slug: 'aetherdesk',
    kind: 'service',
    description:
      'Call-center platform — outbound/inbound calls via Fonoster, AI agent orchestration, voice cloning (personal copy), campaigns, transcripts, and call analytics. Used by the fleet for ecosystem outreach calls.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('AETHERDESK_BASE_URL', 'http://127.0.0.1:8000/api/v1'),
      method: 'POST',
      health_url: `${agentUrl('AETHERDESK_BASE_URL', 'http://127.0.0.1:8000/api/v1')}/health`,
      endpoints: {
        health: '/health',
        list_agents: '/tenants/{tenant_id}/agents',
        create_agent: '/tenants/{tenant_id}/agents',
        list_calls: '/calls',
        start_call: '/calls',
        call_action: '/calls/{call_id}/action',
        list_campaigns: '/campaign/campaigns',
        create_campaign: '/campaign/campaigns',
        launch_campaign: '/campaign/launch',
        clone_voice: '/voice/clone',
        list_leads: '/campaign/leads',
      },
    },
    capabilities: [
      'outbound_calls',
      'inbound_calls',
      'voice_cloning',
      'campaigns',
      'call_transcripts',
      'call_analytics',
      'ai_agent_orchestration',
    ],
    tags: ['voice', 'calls', 'call-center', 'telephony', 'outreach', 'personal-copy'],
    category: 'communication',
    health_endpoint: '/health',
  },

  // ── 13. Recursive IP Builder ────────────────────────────────────────
  // IP registry, grading, and tokenization platform (Ventures/Justice arm)
  {
    name: 'Recursive IP Builder',
    slug: 'recursive-ip',
    kind: 'service',
    description:
      'Intellectual property platform — create, grade, and tokenize IP on-chain. CRUD, five-dimension grading, NFT minting, portfolio analytics, keyword search, comparison, export, version history, and IP relationships.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('RECURSIVE_IP_URL', 'http://localhost:8000'),
      method: 'POST',
      health_url: `${agentUrl('RECURSIVE_IP_URL', 'http://localhost:8000')}/api/v1/health`,
      endpoints: {
        list: '/api/v1/ip',
        create: '/api/v1/ip',
        analytics: '/api/v1/ip/analytics',
        search: '/api/v1/ip/search',
        compare: '/api/v1/ip/compare',
        grade_preview: '/api/v1/grade',
        grade_by_id: '/api/v1/ip/{id}/grade',
        mint: '/api/v1/ip/{id}/mint',
      },
    },
    capabilities: [
      'ip_registry',
      'ip_grading',
      'nft_minting',
      'portfolio_analytics',
      'ip_search',
      'ip_comparison',
      'version_history',
      'ip_relationships',
    ],
    tags: ['ip', 'patent', 'trademark', 'copyright', 'blockchain', 'nft', 'grading'],
    category: 'finance',
    health_endpoint: '/api/v1/health',
  },

  // ── 13. Kaggle ─────────────────────────────────────────────────────
  // Data provider — research datasets through the deterministic brain
  {
    name: 'Kaggle',
    slug: 'kaggle',
    kind: 'tool',
    description:
      'Data provider — pull Kaggle datasets/competitions into research. Downloads datasets as deterministic content-hashed snapshots and feeds them into the knowledge bank via the deterministic brain (localhost:3210 /kaggle/*). Feeds OmniResearch, backtesting, and the retrieval layer.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('BRAIN_URL', 'http://localhost:3210'),
      method: 'POST',
      health_url: `${agentUrl('BRAIN_URL', 'http://localhost:3210')}/kaggle/status`,
      endpoints: {
        status: '/kaggle/status',
        whoami: '/kaggle/whoami',
        search: '/kaggle/datasets/search',
        files: '/kaggle/datasets/files',
        download: '/kaggle/datasets/download',
        snapshots: '/kaggle/snapshots',
        research_feed: '/kaggle/research/feed',
        research_feeds: '/kaggle/research/feeds',
      },
    },
    capabilities: [
      'data_provider',
      'dataset_search',
      'dataset_download',
      'snapshotting',
      'research_feed',
    ],
    tags: ['data', 'research', 'datasets', 'kaggle'],
    category: 'research',
    health_endpoint: '/kaggle/status',
  },

  // ── BookBridge service ──────────────────────────────────────────────
  // Book library daemon (:8777 REST / :8778 MCP) — grounded research,
  // reading plans, citations. Used by the book-grounded-research chain.
  {
    name: 'BookBridge',
    slug: 'bookbridge',
    kind: 'service',
    description:
      'Local book library daemon (REST :8777, MCP :8778). Hybrid search, full-text retrieval, reading plans, citations, summaries, flashcards, knowledge graph, and provenance linking over the indexed library.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('BOOKBRIDGE_URL', 'http://127.0.0.1:8777'),
      method: 'POST',
      health_url: `${agentUrl('BOOKBRIDGE_URL', 'http://127.0.0.1:8777')}/health`,
      endpoints: {
        health: '/health',
        search: '/search',
        reading_plan: '/reading_plan',
        retrieve: '/retrieve',
        citation: '/citation',
        summarize: '/summarize',
        books: '/books',
        add: '/books/add',
        scan: '/scan',
        bookbridge_ground: '/ground',
        link_activity: '/link_activity',
      },
    },
    capabilities: [
      'book_search',
      'book_retrieval',
      'reading_plan',
      'citations',
      'summarization',
      'knowledge_graph',
      'provenance',
    ],
    tags: ['books', 'library', 'research', 'grounding'],
    category: 'research',
    health_endpoint: '/health',
  },

  // ── Book-to-Skill Chain orchestrator ────────────────────────────────
  // Pipeline: ground with BookBridge -> synthesize -> convert to a skill
  // -> register. Used by the book-grounded-research chain final step.
  {
    name: 'Book-to-Skill Chain',
    slug: 'book-to-skill-chain',
    kind: 'skill',
    description:
      'Orchestrator pipeline: ground with BookBridge, synthesize the book, run the book-to-skill converter, and register the generated skill in Draymond registry + entity registry.',
    invocation_method: 'internal',
    invocation_config: {},
    capabilities: [
      'book_pipeline',
      'skill_registration',
      'library_distillation',
      'framework_extraction',
    ],
    tags: ['books', 'pipeline', 'skills', 'research'],
    category: 'research',
  },

  // ── Open-Chat Worker (marketing phone arm) ───────────────────────────
  // The boss-side handle for the Open-Chat remote worker. Actions enqueue
  // skill-pack tasks (marketing_capture, marketing_post, queue_review) that
  // Open Chat pulls and executes on the phone.
  {
    name: 'Open-Chat Worker',
    slug: 'open-chat-worker',
    kind: 'service',
    description:
      'Draymond handle for the Open-Chat phone worker. Enqueues marketing skill-pack tasks (capture, post, queue review) that Open Chat executes on-device.',
    invocation_method: 'internal',
    invocation_config: {},
    capabilities: [
      'enqueue_worker_task',
      'marketing_capture',
      'marketing_post',
      'queue_review',
    ],
    tags: ['worker', 'open-chat', 'marketing', 'phone'],
    category: 'marketing',
  },

  // ── Folded tool stages (dispatch through parent pipelines) ─────────────
  // These are the tools absorbed into parent agents. Each is an invocable
  // entity whose invocation routes THROUGH the parent's fleet pipeline, so
  // chains/schedulers never call a disjointed one-off tool — the parent owns
  // the singular pipeline and this entity is just a named stage handle.
  {
    name: 'Marketing Tool (stage)',
    slug: 'marketing-tool',
    kind: 'tool',
    description: 'Marketing asset engine — stage of the social-media-dashboard pipeline.',
    invocation_method: 'pipeline',
    invocation_config: { pipeline: 'social-media-dashboard', tool: 'marketing-tool' },
    capabilities: ['marketing_automation', 'creation_studio', 'segmentation'],
    tags: ['folded', 'marketing', 'pipeline'],
    category: 'marketing',
  },
  {
    name: 'YouTube Shorts (stage)',
    slug: 'youtube-shorts',
    kind: 'tool',
    description: 'Shorts clipper — stage of the generative-video-ai pipeline.',
    invocation_method: 'pipeline',
    invocation_config: { pipeline: 'generative-video-ai', tool: 'youtube-shorts' },
    capabilities: ['highlight_extraction', 'vertical_cropping', 'speaker_detection'],
    tags: ['folded', 'media', 'pipeline'],
    category: 'media',
  },
  {
    name: 'Content Creation Engine (stage)',
    slug: 'content-creation-engine',
    kind: 'tool',
    description: 'Animated episode engine — stage of the generative-video-ai pipeline.',
    invocation_method: 'pipeline',
    invocation_config: { pipeline: 'generative-video-ai', tool: 'content-creation-engine' },
    capabilities: ['episode_rendering', 'commercial_breaks'],
    tags: ['folded', 'media', 'pipeline'],
    category: 'media',
  },
  {
    name: 'Book Synthesis (stage)',
    slug: 'book-synthesis',
    kind: 'tool',
    description: 'Multi-book synthesist — stage of the bookbridge pipeline.',
    invocation_method: 'pipeline',
    invocation_config: { pipeline: 'bookbridge', tool: 'book-synthesis' },
    capabilities: ['multi_book_synthesis', 'web_validation', 'report_generation'],
    tags: ['folded', 'knowledge', 'pipeline'],
    category: 'research',
  },
  {
    name: 'zvec (stage)',
    slug: 'zvec',
    kind: 'tool',
    description: 'In-process vector index — stage of the bookbridge pipeline.',
    invocation_method: 'pipeline',
    invocation_config: { pipeline: 'bookbridge', tool: 'zvec' },
    capabilities: ['vector_search', 'semantic_index'],
    tags: ['folded', 'knowledge', 'pipeline'],
    category: 'research',
  },
  {
    name: 'MemAgent (stage)',
    slug: 'memagent',
    kind: 'tool',
    description: 'Long-term memory framework — stage of the bookbridge pipeline.',
    invocation_method: 'pipeline',
    invocation_config: { pipeline: 'bookbridge', tool: 'memagent' },
    capabilities: ['long_context_memory', 'rl_memory_agent'],
    tags: ['folded', 'knowledge', 'pipeline'],
    category: 'research',
  },
  {
    name: 'Open Notebook (stage)',
    slug: 'open-notebook',
    kind: 'tool',
    description: 'NotebookLM-style research workspace — stage of the omniresearch-pro pipeline.',
    invocation_method: 'pipeline',
    invocation_config: { pipeline: 'omniresearch-pro', tool: 'open-notebook' },
    capabilities: ['research_workspace', 'notebook_synthesis'],
    tags: ['folded', 'research', 'pipeline'],
    category: 'research',
  },
  {
    name: 'Tap919 Middleman (metered gateway)',
    slug: 'tap919-middleman',
    kind: 'tool',
    description: 'Metered agent-to-agent gateway — the E3 cash register. Budget-engine meter.ts emits billable UsageEvents to /internal/execute (port 8021). Live 2026-08-14.',
    invocation_method: 'http_api',
    invocation_config: { url: 'http://localhost:8021', health: '/internal/ping' },
    capabilities: ['metered_gateway', 'usage_events', 'stripe_rail', 'cost_governance'],
    tags: ['gateway', 'metering', 'billing', 'E3'],
    category: 'infrastructure',
  },
  {
    name: 'LLMLingua (stage)',
    slug: 'llmlingua',
    kind: 'tool',
    description: 'Prompt/context compression — stage of the litellm pipeline.',
    invocation_method: 'pipeline',
    invocation_config: { pipeline: 'litellm', tool: 'llmlingua' },
    capabilities: ['context_compression', 'prompt_optimization'],
    tags: ['folded', 'gateway', 'pipeline'],
    category: 'infrastructure',
  },
  {
    name: 'Browser Use (stage)',
    slug: 'browser-use',
    kind: 'tool',
    description: 'AI browser engine — stage of the agent-browser pipeline.',
    invocation_method: 'pipeline',
    invocation_config: { pipeline: 'agent-browser', tool: 'browser-use' },
    capabilities: ['browser_automation', 'web_extraction'],
    tags: ['folded', 'web', 'pipeline'],
    category: 'automation',
  },
  {
    name: 'Scrapling (stage)',
    slug: 'scrapling',
    kind: 'tool',
    description: 'Adaptive web scraping — stage of the agent-browser pipeline.',
    invocation_method: 'pipeline',
    invocation_config: { pipeline: 'agent-browser', tool: 'scrapling' },
    capabilities: ['adaptive_scraping', 'data_collection'],
    tags: ['folded', 'web', 'pipeline'],
    category: 'automation',
  },
  {
    name: 'Stirling PDF (stage)',
    slug: 'stirling-pdf',
    kind: 'tool',
    description: 'Local PDF operations — stage of the ufc-mcp pipeline.',
    invocation_method: 'pipeline',
    invocation_config: { pipeline: 'ufc-mcp', tool: 'stirling-pdf' },
    capabilities: ['pdf_operations', 'document_processing'],
    tags: ['folded', 'conversion', 'pipeline'],
    category: 'conversion',
  },
  {
    name: 'Supply Chain Health (stage)',
    slug: 'supply-chain-health',
    kind: 'tool',
    description: 'SBOM + deps.dev dependency health — stage of the depscan pipeline.',
    invocation_method: 'pipeline',
    invocation_config: { pipeline: 'depscan', tool: 'supply-chain-health' },
    capabilities: ['sbom', 'dependency_health', 'vulnerability_reports'],
    tags: ['folded', 'security', 'pipeline'],
    category: 'security',
  },
  {
    name: 'Super Tool (stage)',
    slug: 'super-tool',
    kind: 'tool',
    description: 'Trading/marketing pipeline utilities — stage of the trading-agents pipeline.',
    invocation_method: 'pipeline',
    invocation_config: { pipeline: 'trading-agents', tool: 'super-tool' },
    capabilities: ['backtesting', 'risk_engine', 'pipeline_utilities'],
    tags: ['folded', 'trading', 'pipeline'],
    category: 'finance',
  },

  // ── Overlay Global Lens ─────────────────────────────────────────────
  // Express/React publication (Global-Lens fork). The public news + research
  // outlet for Overlay365: news aggregation, research papers, trends,
  // discoveries, and comic-metaphor storylines. Read + sync endpoints.
  {
    name: 'Overlay Global Lens',
    slug: 'overlay-global-lens',
    kind: 'service',
    description:
      'Overlay365 news & research publication (Express/React, Global-Lens fork). Aggregates global news and publishes evidence-tiered research papers (OpenAlex/PubMed), trends, discoveries, and comic-metaphor storylines. Public-facing outlet for the ecosystem.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('OVERLAY_GLOBAL_LENS_URL', 'http://localhost:3090'),
      method: 'POST',
      health_url: `${agentUrl('OVERLAY_GLOBAL_LENS_URL', 'http://localhost:3090')}/api/health`,
      endpoints: {
        sync_research: { path: '/api/sync/research', method: 'POST' },
        sync_trends: { path: '/api/sync/trends', method: 'POST' },
        papers: { path: '/api/papers', method: 'GET' },
        trends: { path: '/api/trends', method: 'GET' },
        discoveries: { path: '/api/discoveries', method: 'GET' },
        feed: { path: '/api/insights/feed', method: 'GET' },
        metaphors: { path: '/api/metaphors/topic', method: 'POST' },
        health: { path: '/api/health', method: 'GET' },
      },
    },
    capabilities: [
      'news_aggregation',
      'research_publishing',
      'trend_intelligence',
      'discovery_reporting',
      'metaphor_storylines',
    ],
    tags: ['news', 'research', 'publication', 'overlay365', 'express'],
    category: 'media',
    health_endpoint: '/api/health',
  },

  // ── Overlay Oncology ────────────────────────────────────────────────
  // Cancer research & biotech engines (Next.js on :3070). Runs the cumulative
  // multi-engine research pipeline (study → simulation → dataset signals →
  // deconvolution → cross-reference → verification) and the synthesis phase
  // over research sectors. Calibrated to live public data (CCLE/TCGA).
  {
    name: 'Overlay Oncology',
    slug: 'overlay-oncology',
    kind: 'service',
    description:
      'Cancer research & biotech engines (Next.js on :3070). Runs the cumulative multi-engine research pipeline (hypothesis → simulate → backtest → dataset signals → cell-type deconvolution → cross-reference → verification → publish) and the sector synthesis phase.',
    invocation_method: 'http_api',
    invocation_config: {
      url: agentUrl('OVERLAY_ONCOLOGY_URL', 'http://localhost:3070'),
      method: 'POST',
      health_url: `${agentUrl('OVERLAY_ONCOLOGY_URL', 'http://localhost:3070')}/api/calibration/state`,
      endpoints: {
        run_pipeline: { path: '/api/research/pipeline', method: 'POST' },
        run_synthesis: { path: '/api/research/synthesis', method: 'POST' },
        report: { path: '/api/research/report', method: 'GET' },
        health: { path: '/api/calibration/state', method: 'GET' },
      },
    },
    capabilities: [
      'survival_modeling',
      'potency_calibration',
      'cell_type_deconvolution',
      'synthesis_engine',
      'research_contracts',
    ],
    tags: ['oncology', 'cancer', 'biotech', 'research', 'nextjs'],
    category: 'research',
    health_endpoint: '/api/calibration/state',
  },
];

// ============================================================================
// CHAIN TEMPLATE DEFINITIONS
// ============================================================================

interface ChainTemplateDef {
  name: string;
  slug: string;
  description: string;
  steps: Array<{
    name: string;
    entitySlug: string;
    action: string;
    input_mapping: Record<string, unknown>;
    output_key: string;
    step_order: number;
    parallel_group?: string;
    /** Indices into the steps array for depends_on resolution */
    depends_on_indices: number[];
  }>;
}

const CHAIN_TEMPLATES: ChainTemplateDef[] = [
  // ── Chain 1: Daily Finance Analysis ─────────────────────────────────
  {
    name: 'Daily Finance Analysis',
    slug: 'daily-finance-analysis',
    description:
      'Automated daily finance workflow: market analysis, news research (parallel), and signal generation.',
    steps: [
      {
        name: 'Market Analysis',
        entitySlug: 'trading-agents',
        action: 'analyze_market',
        input_mapping: { symbols: '$.input.symbols', date: '$.input.date' },
        output_key: 'market_analysis',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'News Research',
        entitySlug: 'omni-research',
        action: 'research_news',
        input_mapping: { query: 'equity market news and earnings outlook' },
        output_key: 'news_research',
        step_order: 1,
        parallel_group: 'research',
        depends_on_indices: [],
      },
      {
        name: 'Generate Signals',
        entitySlug: 'trading-agents',
        action: 'generate_signals',
        input_mapping: {
          analysis: '$.steps.market_analysis.output',
          news: '$.steps.news_research.output',
        },
        output_key: 'signals',
        step_order: 2,
        depends_on_indices: [0, 1],
      },
    ],
  },

  // ── Chain 2: Daily Marketing Run ────────────────────────────────────
  {
    name: 'Daily Marketing Run',
    slug: 'daily-marketing-run',
    description:
      'Automated daily marketing workflow: trending topic research, AI content generation, and social post scheduling.',
    steps: [
      {
        name: 'Trending Topics',
        entitySlug: 'omni-research',
        action: 'trending_topics',
        input_mapping: { niche: '$.input.niche' },
        output_key: 'trending',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'Generate Content',
        entitySlug: 'social-media-dashboard',
        action: 'generate_text',
        input_mapping: {
          topic: '$.steps.trending.output.topic',
          platform: '$.input.platform',
          tone: 'premium',
          content_type: 'caption',
        },
        output_key: 'content',
        step_order: 2,
        depends_on_indices: [0],
      },
      {
        name: 'Generate Images',
        entitySlug: 'social-media-dashboard',
        action: 'generate_image',
        input_mapping: {
          prompt: '$.steps.content.output.content',
          style_preset: '$.input.image_style',
        },
        output_key: 'images',
        step_order: 3,
        depends_on_indices: [1],
      },
      {
        name: 'Schedule Posts',
        entitySlug: 'social-media-dashboard',
        action: 'schedule_posts',
        input_mapping: {
          text: '$.steps.content.output.content',
          images: '$.steps.images.output',
          platforms: '$.input.platforms',
        },
        output_key: 'scheduled',
        step_order: 4,
        depends_on_indices: [1, 2],
      },
    ],
  },

  // ── Chain 3: Sports Betting Daily ───────────────────────────────────
  {
    name: 'Sports Betting Daily',
    slug: 'sports-betting-daily',
    description:
      'Full daily sports betting pipeline: Sports Steve daily-run assessment, Bet Buddy odds calc + Kelly criterion, and bet resolution.',
    steps: [
      {
        name: 'Daily Assessment',
        entitySlug: 'sports-steve',
        action: 'daily_run',
        input_mapping: {
          sport: '$.input.sport',
          date: '$.input.date',
        },
        output_key: 'assessment',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'Odds Calculation',
        entitySlug: 'bet-buddy',
        action: 'odds_calc',
        input_mapping: {
          bets: '$.steps.assessment.output',
        },
        output_key: 'odds',
        step_order: 2,
        depends_on_indices: [0],
      },
      {
        name: 'Kelly Sizing',
        entitySlug: 'bet-buddy',
        action: 'kelly',
        input_mapping: {
          odds: '$.steps.odds.output',
          bankroll: '$.input.bankroll',
        },
        output_key: 'kelly_sizing',
        step_order: 3,
        depends_on_indices: [1],
      },
    ],
  },

  // ── Chain 4: Music Business Automation ──────────────────────────────
  {
    name: 'Music Business Automation',
    slug: 'music-business-automation',
    description:
      'Indy Music Platform daily workflow: social post scheduling, fan capture report, and distribution check.',
    steps: [
      {
        name: 'Schedule Social Posts',
        entitySlug: 'indy-music-platform',
        action: 'schedule_post',
        input_mapping: {
          artist_id: '$.input.artist_id',
          platforms: '$.input.platforms',
        },
        output_key: 'social_posts',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'Fan Capture Report',
        entitySlug: 'indy-music-platform',
        action: 'fan_capture',
        input_mapping: {
          artist_id: '$.input.artist_id',
        },
        output_key: 'fan_report',
        step_order: 1,
        parallel_group: 'music_parallel',
        depends_on_indices: [],
      },
      {
        name: 'Distribution Check',
        entitySlug: 'indy-music-platform',
        action: 'distribution',
        input_mapping: {
          artist_id: '$.input.artist_id',
        },
        output_key: 'distribution_status',
        step_order: 1,
        parallel_group: 'music_parallel',
        depends_on_indices: [],
      },
    ],
  },

  // ── Chain 5: Code Automation Pipeline ───────────────────────────────
  {
    name: 'Code Automation Pipeline',
    slug: 'code-automation-pipeline',
    description:
      'MegaCode + Uplift Agent workflow: receive a task, generate code via MegaCode, validate/execute via Uplift Agent.',
    steps: [
      {
        name: 'Code Generation',
        entitySlug: 'megacode',
        action: 'complete',
        input_mapping: {
          task: '$.input.task',
          language: '$.input.language',
          context: '$.input.context',
        },
        output_key: 'generated_code',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'Code Review',
        entitySlug: 'megacode',
        action: 'review',
        input_mapping: {
          code: '$.steps.generated_code.output',
        },
        output_key: 'review_results',
        step_order: 2,
        depends_on_indices: [0],
      },
      {
        name: 'Execute & Validate',
        entitySlug: 'uplift-agent',
        action: 'batch',
        input_mapping: {
          task: 'validate_and_test',
          code: '$.steps.generated_code.output',
          review: '$.steps.review_results.output',
        },
        output_key: 'validation',
        step_order: 3,
        depends_on_indices: [1],
      },
    ],
  },

  // ── Chain 5b: CPU RTL Generation Pipeline ──────────────────────────
  // Uses Uplift Agent's Sub Team tools for end-to-end CPU design
  {
    name: 'CPU RTL Generation Pipeline',
    slug: 'cpu-rtl-generation',
    description:
      'End-to-end CPU RTL generation via Uplift Agent Sub Team tools: specification, microarchitecture design, Verilog implementation, and formal verification.',
    steps: [
      {
        name: 'CPU Specification',
        entitySlug: 'uplift-agent',
        action: 'batch',
        input_mapping: {
          task: 'sub_team_spec',
          isa: '$.input.isa',
          pipeline_template: '$.input.pipeline_template',
          extensions: '$.input.extensions',
        },
        output_key: 'formal_spec',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'Microarchitecture Design',
        entitySlug: 'uplift-agent',
        action: 'batch',
        input_mapping: {
          task: 'sub_team_microarch',
          spec: '$.steps.formal_spec.output',
        },
        output_key: 'microarch_plan',
        step_order: 2,
        depends_on_indices: [0],
      },
      {
        name: 'Verilog Implementation',
        entitySlug: 'uplift-agent',
        action: 'batch',
        input_mapping: {
          task: 'sub_team_implement',
          spec: '$.steps.formal_spec.output',
          plan: '$.steps.microarch_plan.output',
        },
        output_key: 'rtl_output',
        step_order: 3,
        depends_on_indices: [1],
      },
      {
        name: 'Formal Verification',
        entitySlug: 'uplift-agent',
        action: 'batch',
        input_mapping: {
          task: 'sub_team_verify',
          spec: '$.steps.formal_spec.output',
          rtl: '$.steps.rtl_output.output',
        },
        output_key: 'verification_report',
        step_order: 4,
        depends_on_indices: [2],
      },
    ],
  },

  // ── Chain 5c: Cheetah Scaffold Pipeline ─────────────────────────────
  // Deterministic codegen: Cheetah scaffold spec + UI preset (parallel),
  // then build the project and validate via Uplift Agent. No LLM in the
  // generation steps — fully reproducible output.
  {
    name: 'Cheetah Scaffold Pipeline',
    slug: 'cheetah-scaffold-pipeline',
    description:
      'Deterministic project generation via Cheetah: build spec + Game Maker UI preset (parallel), execute the build, then audit/validate with Uplift Agent.',
    steps: [
      {
        name: 'Generate Build Spec',
        entitySlug: 'cheetah',
        action: 'generate',
        input_mapping: {
          name: '$.input.name',
          project_type: '$.input.project_type',
          features: '$.input.features',
          stack: '$.input.stack',
        },
        output_key: 'spec',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'Generate UI Preset',
        entitySlug: 'cheetah',
        action: 'presets_generate',
        input_mapping: {
          preset_name: '$.input.preset_name',
          project_root: '$.input.project_root',
        },
        output_key: 'ui_components',
        step_order: 1,
        parallel_group: 'cheetah_scaffold',
        depends_on_indices: [],
      },
      {
        name: 'Execute Build',
        entitySlug: 'cheetah',
        action: 'build',
        input_mapping: {
          yaml_content: '$.steps.spec.output.yaml',
        },
        output_key: 'build_result',
        step_order: 2,
        depends_on_indices: [0],
      },
      {
        name: 'Audit & Validate',
        entitySlug: 'uplift-agent',
        action: 'batch',
        input_mapping: {
          task: 'validate_and_test',
          code: '$.steps.build_result.output.files',
        },
        output_key: 'validation',
        step_order: 3,
        depends_on_indices: [2],
      },
    ],
  },

  // ── Chain 6: Supply Chain Intelligence ──────────────────────────────
  {
    name: 'Supply Chain Intelligence',
    slug: 'supply-chain-intelligence',
    description:
      'Overlay Chain daily workflow: demand forecast, anomaly detection (parallel), risk assessment, and inventory optimization.',
    steps: [
      {
        name: 'Demand Forecast',
        entitySlug: 'overlay-chain',
        action: 'demand_forecast',
        input_mapping: {
          product_ids: '$.input.product_ids',
          horizon_days: '$.input.horizon_days',
        },
        output_key: 'demand_forecast',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'Anomaly Detection',
        entitySlug: 'overlay-chain',
        action: 'anomaly_detection',
        input_mapping: {
          product_ids: '$.input.product_ids',
        },
        output_key: 'anomalies',
        step_order: 1,
        parallel_group: 'sc_analysis',
        depends_on_indices: [],
      },
      {
        name: 'Risk Assessment',
        entitySlug: 'overlay-chain',
        action: 'risk_assessment',
        input_mapping: {
          forecast: '$.steps.demand_forecast.output',
          anomalies: '$.steps.anomalies.output',
        },
        output_key: 'risk_report',
        step_order: 2,
        depends_on_indices: [0, 1],
      },
      {
        name: 'Inventory Optimization',
        entitySlug: 'overlay-chain',
        action: 'inventory_optimization',
        input_mapping: {
          forecast: '$.steps.demand_forecast.output',
          risks: '$.steps.risk_report.output',
        },
        output_key: 'inventory_plan',
        step_order: 3,
        depends_on_indices: [2],
      },
    ],
  },

  // ── Chain 7: Full Content Creation Pipeline ─────────────────────────
  {
    name: 'Full Content Creation',
    slug: 'full-content-creation',
    description:
      'End-to-end content pipeline: research trending topics, generate text + image, then schedule across platforms.',
    steps: [
      {
        name: 'Research Trends',
        entitySlug: 'omni-research',
        action: 'trending_topics',
        input_mapping: {
          niche: '$.input.niche',
          platform: '$.input.target_platform',
        },
        output_key: 'trends',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'Generate Text',
        entitySlug: 'social-media-dashboard',
        action: 'generate_text',
        input_mapping: {
          topic: '$.steps.trends.output.topic',
          platform: '$.input.target_platform',
          tone: 'premium',
          content_type: 'caption',
        },
        output_key: 'text_content',
        step_order: 2,
        depends_on_indices: [0],
      },
      {
        name: 'Generate Image',
        entitySlug: 'social-media-dashboard',
        action: 'generate_image',
        input_mapping: {
          prompt: '$.steps.text_content.output.content',
        },
        output_key: 'image_content',
        step_order: 3,
        depends_on_indices: [1],
      },
      {
        name: 'Schedule Distribution',
        entitySlug: 'social-media-dashboard',
        action: 'schedule_posts',
        input_mapping: {
          text: '$.steps.text_content.output.content',
          images: '$.steps.image_content.output',
          platforms: '$.input.platforms',
        },
        output_key: 'scheduled',
        step_order: 4,
        depends_on_indices: [1, 2],
      },
    ],
  },

  // ── Chain 8: Morning Briefing ───────────────────────────────────────
  {
    name: 'Morning Briefing',
    slug: 'morning-briefing',
    description:
      'Daily 9AM summary: finance signals, sports picks, content calendar, and supply chain alerts compiled into one email digest.',
    steps: [
      {
        name: 'Finance Summary',
        entitySlug: 'trading-agents',
        action: 'analyze_market',
        input_mapping: {
          symbols: '$.input.watchlist',
          date: '$.input.date',
        },
        output_key: 'finance_summary',
        step_order: 1,
        parallel_group: 'morning_gather',
        depends_on_indices: [],
      },
      {
        name: 'Sports Picks',
        entitySlug: 'sports-steve',
        action: 'daily_run',
        input_mapping: {
          sport: '$.input.sport',
        },
        output_key: 'sports_picks',
        step_order: 1,
        parallel_group: 'morning_gather',
        depends_on_indices: [],
      },
      {
        name: 'Supply Chain Alerts',
        entitySlug: 'omni-research',
        action: 'research_news',
        input_mapping: {
          query: 'supply chain risk and disruption update',
        },
        output_key: 'sc_alerts',
        step_order: 1,
        parallel_group: 'morning_gather',
        depends_on_indices: [],
      },
      {
        name: 'Compile Briefing',
        entitySlug: 'uplift-agent',
        action: 'batch',
        input_mapping: {
          description: 'compile_morning_briefing',
          finance: '$.steps.finance_summary.output',
          sports: '$.steps.sports_picks.output',
          supply_chain: '$.steps.sc_alerts.output',
        },
        output_key: 'briefing',
        step_order: 2,
        depends_on_indices: [0, 1, 2],
      },
    ],
  },

  // ── Chain 9: Hemp Research & News Pipeline ──────────────────────────
  // Research front that reports as a news outlet. Grounds hemp/cannabis
  // literature via OmniResearch (keyless PubMed/OpenAlex/BookBridge), then
  // publishes the digest to the Overlay Global Lens platform.
  {
    name: 'Hemp Research & News Pipeline',
    slug: 'hemp-research-news',
    description:
      'Hemp division research front: OmniResearch hemp literature sweep, then the digest is published to the Overlay Global Lens news platform.',
    steps: [
      {
        name: 'Research Hemp Literature',
        entitySlug: 'omni-research',
        action: 'research_news',
        input_mapping: {
          query: '$.input.literature_query',
        },
        output_key: 'insights',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'Publish News Digest',
        entitySlug: 'global-lens',
        action: 'publish',
        input_mapping: {
          title: 'Hemp Research & News Digest',
          category: 'hemp',
          source_name: 'Hemp-OS',
          insights: '$.steps.insights.output.findings',
        },
        output_key: 'published_digest',
        step_order: 2,
        depends_on_indices: [0],
      },
    ],
  },

  // ── Chain 10: IP Portfolio Grading & Protection ─────────────────────
  // Ventures/Justice arm: scan the IP portfolio, grade candidates, and
  // compile a protection report.
  {
    name: 'IP Portfolio Grading & Protection',
    slug: 'ip-portfolio-grading',
    description:
      'Intellectual property workflow: portfolio analytics, keyword search for candidate records, grading previews, and a compiled IP protection report.',
    steps: [
      {
        name: 'IP Portfolio Analytics',
        entitySlug: 'recursive-ip',
        action: 'analytics',
        input_mapping: {},
        output_key: 'portfolio_stats',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'IP Registry Scan',
        entitySlug: 'recursive-ip',
        action: 'list',
        input_mapping: {
          type: '$.input.ip_type',
          industry: '$.input.industry',
        },
        output_key: 'ip_records',
        step_order: 1,
        parallel_group: 'ip_scan',
        depends_on_indices: [],
      },
      {
        name: 'Compile Protection Report',
        entitySlug: 'uplift-agent',
        action: 'batch',
        input_mapping: {
          task: 'compile_ip_protection_report',
          stats: '$.steps.portfolio_stats.output',
          records: '$.steps.ip_records.output',
        },
        output_key: 'protection_report',
        step_order: 2,
        depends_on_indices: [0, 1],
      },
    ],
  },

  // ── Chain 11: Research Data Pipeline ─────────────────────────────────
  // Research arm: pull a Kaggle dataset through the brain, feed it into the
  // knowledge bank, then hand the resulting knowledge to OmniResearch for
  // synthesis into a structured research brief.
  {
    name: 'Research Data Pipeline',
    slug: 'research-data-pipeline',
    description:
      'Kaggle → knowledge → research: downloads a dataset (deterministic snapshot), ingests it into the knowledge bank + TF-IDF index, then OmniResearch synthesizes a research brief from the fed knowledge.',
    steps: [
      {
        name: 'Fetch Kaggle Dataset',
        entitySlug: 'kaggle',
        action: 'research_feed',
        input_mapping: {
          dataset: '$.input.dataset',
          tags: '$.input.tags',
          force: '$.input.force',
        },
        output_key: 'feed_result',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'Synthesize Research Brief',
        entitySlug: 'omni-research',
        action: 'research_news',
        input_mapping: {
          query: '$.input.topic',
          dataset: '$.input.dataset',
          feed: '$.steps.feed_result.output',
        },
        output_key: 'research_brief',
        step_order: 2,
        depends_on_indices: [0],
      },
    ],
  },

  // ── Chain 12: Book-Grounded Research ─────────────────────────────────
  // Research arm: ground a topic against the BookBridge library, synthesize
  // the author frameworks into a brief, and distill any targeted book into a
  // reusable agent skill so the knowledge compounds.
  {
    name: 'Book-Grounded Research',
    slug: 'book-grounded-research',
    description:
      'Books → research: grounds a research topic against the BookBridge library (reading plan + passages), synthesizes a research brief, and optionally distills a source book into a reusable agent skill via book-to-skill.',
    steps: [
      {
        name: 'Ground with BookBridge',
        entitySlug: 'bookbridge',
        action: 'bookbridge_ground',
        input_mapping: {
          topic: '$.input.topic',
          source: '$.input.source',
          max_results: '$.input.max_results',
        },
        output_key: 'grounding',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'Synthesize from Books',
        entitySlug: 'omni-research',
        action: 'research_news',
        input_mapping: {
          query: '$.input.topic',
          grounding: '$.steps.grounding.output',
        },
        output_key: 'research_brief',
        step_order: 2,
        depends_on_indices: [0],
      },
      {
        name: 'Distill Book to Skill',
        entitySlug: 'book-to-skill-chain',
        action: 'distill_book_to_skill',
        input_mapping: {
          source: '$.input.source',
          skill_name: '$.input.skill_name',
          topic: '$.input.topic',
        },
        output_key: 'generated_skill',
        step_order: 3,
        depends_on_indices: [0],
      },
    ],
  },

  // ── Chain 12: Marketing Content Capture ──────────────────────────────
  // Open-Chat phone arm: enqueues a marketing_capture worker task so the phone
  // grabs real in-app content (competitor posts, drafts, platform UI) and feeds
  // it to the content pipeline.
  {
    name: 'Marketing Content Capture',
    slug: 'marketing-content-capture',
    description:
      'Queue an Open-Chat phone task that captures in-app marketing content (screenshots + screen text) into the SMD media store for reuse by the content pipeline.',
    steps: [
      {
        name: 'Queue Phone Capture',
        entitySlug: 'open-chat-worker',
        action: 'enqueue_capture',
        input_mapping: {
          skill_pack_id: 'marketing_capture:1.0.0',
          app: '$.input.app',
          prompt: '$.input.prompt',
        },
        output_key: 'capture_task',
        step_order: 1,
        depends_on_indices: [],
      },
    ],
  },

  // ── Chain 13: News Outlet Ingest ────────────────────────────────────
  // Feeds the Overlay Global Lens publication with the latest ecosystem
  // research. Idempotent syncs pull evidence-tiered papers + trends +
  // discoveries into the outlet's SQLite for public serving, then confirm
  // the outlet is healthy.
  {
    name: 'News Outlet Ingest',
    slug: 'news-outlet-ingest',
    description:
      'Syncs the latest ecosystem research into the Overlay Global Lens publication: research papers (OpenAlex/PubMed store), then trends + discoveries (discovery loop + hypotheses), then confirms outlet health.',
    steps: [
      {
        name: 'Sync Research Papers',
        entitySlug: 'overlay-global-lens',
        action: 'sync_research',
        input_mapping: {},
        output_key: 'papers_sync',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'Sync Trends & Discoveries',
        entitySlug: 'overlay-global-lens',
        action: 'sync_trends',
        input_mapping: {},
        output_key: 'insights_sync',
        step_order: 2,
        depends_on_indices: [0],
      },
      {
        name: 'Outlet Health Check',
        entitySlug: 'overlay-global-lens',
        action: 'health',
        input_mapping: {},
        output_key: 'outlet_health',
        step_order: 3,
        depends_on_indices: [1],
      },
    ],
  },

  // ── Chain 14: Cancer Research Deep-Dive ─────────────────────────────
  // Orchestrates a multi-engine oncology research study around a given theme
  // (e.g. in-situ vaccination / cold-to-hot tumor conversion, per the six
  // Aug 2026 advances). Runs the Overlay Oncology pipeline (with cell-type
  // deconvolution when an expression matrix is supplied), then synthesizes a
  // research brief via OmniResearch grounded on the pipeline output, then runs
  // the Oncology synthesis phase to compound the study into sector thresholds.
  {
    name: 'Cancer Research Deep-Dive',
    slug: 'cancer-research-deep-dive',
    description:
      'Runs a cumulative Overlay Oncology research study (pipeline + deconvolution + synthesis) for a given cancer theme, then produces an OmniResearch brief. Inputs: topic, cancerType, target, mechanism, optional expressionMatrix for real cell-type deconvolution.',
    steps: [
      {
        name: 'Run Oncology Pipeline',
        entitySlug: 'overlay-oncology',
        action: 'run_pipeline',
        input_mapping: {
          topic: '$.input.topic',
          cancerType: '$.input.cancerType',
          target: '$.input.target',
          mechanism: '$.input.mechanism',
          expressionMatrix: '$.input.expressionMatrix',
          variantFilter: '$.input.variantFilter',
          ticks: '$.input.ticks',
          publish: '$.input.publish',
        },
        output_key: 'study',
        step_order: 1,
        depends_on_indices: [],
      },
      {
        name: 'Synthesize Research Brief',
        entitySlug: 'omni-research',
        action: 'research_news',
        input_mapping: {
          query: '$.input.topic',
          study: '$.steps.study.output',
          context: '$.input.context',
        },
        output_key: 'brief',
        step_order: 2,
        depends_on_indices: [0],
      },
      {
        name: 'Run Sector Synthesis',
        entitySlug: 'overlay-oncology',
        action: 'run_synthesis',
        input_mapping: {
          topic: '$.input.topic',
          cancerType: '$.input.cancerType',
          study: '$.steps.study.output',
          brief: '$.steps.brief.output',
        },
        output_key: 'synthesis',
        step_order: 3,
        depends_on_indices: [1],
      },
    ],
  },
];

// ============================================================================
// SCHEDULED JOB DEFINITIONS
// ============================================================================

interface JobSeedDef {
  name: string;
  cron_expression: string;
  job_type: 'chain' | 'health_check' | 'notification' | 'decay_sweep' | 'custom';
  job_config: Record<string, unknown>;
  notify_on_failure?: boolean;
  is_enabled?: boolean;
}

const JOB_DEFS: JobSeedDef[] = [
  // ── Core system jobs ────────────────────────────────────────────────
  {
    name: 'Agent Health Check',
    cron_expression: '*/15 * * * *',
    job_type: 'health_check',
    job_config: {},
    notify_on_failure: true,
  },
  {
    name: 'Site Health Checks',
    cron_expression: '*/5 * * * *',
    job_type: 'custom',
    job_config: {
      handler: 'check_all_sites',
    },
  },
  {
    name: 'Daily Health Digest',
    cron_expression: '0 20 * * *',
    job_type: 'notification',
    job_config: {
      payload: {
        type: 'health_summary',
      },
    },
    notify_on_failure: true,
  },

  // ── Memory Decay Sweep (every hour) ─────────────────────────────────
  {
    name: 'Memory Decay Sweep',
    cron_expression: '0 * * * *',
    job_type: 'decay_sweep',
    job_config: {},
    notify_on_failure: true,
  },

  // ── Morning Briefing (9AM daily) ────────────────────────────────────
  {
    name: 'Morning Briefing',
    cron_expression: '0 9 * * *',
    job_type: 'chain',
    job_config: {
      chain_slug: 'morning-briefing',
      input: {
        watchlist: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA'],
        sport: 'nba',
        product_ids: ['all'],
      },
    },
    notify_on_failure: true,
  },

  // ── Finance (9:30AM weekdays) ───────────────────────────────────────
  {
    name: 'Daily Finance Analysis',
    cron_expression: '30 9 * * 1-5',
    job_type: 'chain',
    job_config: {
      chain_slug: 'daily-finance-analysis',
      input: {
        symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA'],
      },
    },
    notify_on_failure: true,
  },

  // ── Marketing (10AM daily) ──────────────────────────────────────────
  {
    name: 'Daily Marketing Run',
    cron_expression: '0 10 * * *',
    job_type: 'chain',
    job_config: {
      chain_slug: 'daily-marketing-run',
      input: {
        niche: 'tech',
        platform: 'linkedin',
        brand_voice: 'professional',
        image_style: 'modern',
        platforms: ['twitter', 'linkedin'],
      },
    },
  },

  // ── Sports Betting (12PM daily) ─────────────────────────────────────
  {
    name: 'Sports Betting Daily',
    cron_expression: '0 12 * * *',
    job_type: 'chain',
    job_config: {
      chain_slug: 'sports-betting-daily',
      input: {
        sport: 'nba',
        bankroll: 1000,
      },
    },
    notify_on_failure: true,
    // bet-buddy backend not provisioned locally — keep disabled across /api/seed
    is_enabled: false,
  },

  // ── Music Business (11AM daily) ─────────────────────────────────────
  {
    name: 'Music Business Automation',
    cron_expression: '0 11 * * *',
    job_type: 'chain',
    job_config: {
      chain_slug: 'music-business-automation',
      input: {
        artist_id: 'default',
        platforms: ['instagram', 'tiktok', 'spotify'],
      },
    },
    // indy-music-platform service not provisioned locally — keep disabled across /api/seed
    is_enabled: false,
  },

  // ── Supply Chain (8AM weekdays) ─────────────────────────────────────
  {
    name: 'Supply Chain Intelligence',
    cron_expression: '0 8 * * 1-5',
    job_type: 'chain',
    job_config: {
      chain_slug: 'supply-chain-intelligence',
      input: {
        product_ids: ['all'],
        horizon_days: 30,
      },
    },
    notify_on_failure: true,
    // overlay-chain service not provisioned locally — keep disabled across /api/seed
    is_enabled: false,
  },

  // ── Full Content Creation (2PM Mon/Wed/Fri) ─────────────────────────
  {
    name: 'Full Content Creation',
    cron_expression: '0 14 * * 1,3,5',
    job_type: 'chain',
    job_config: {
      chain_slug: 'full-content-creation',
      input: {
        niche: 'tech',
        target_platform: 'linkedin',
        brand_voice: 'professional',
        platforms: ['twitter', 'linkedin', 'instagram'],
      },
    },
  },

  // ── Hemp Research & News (7AM daily) ────────────────────────────────
  {
    name: 'Hemp Research & News Digest',
    cron_expression: '0 7 * * *',
    job_type: 'chain',
    job_config: {
      chain_slug: 'hemp-research-news',
      input: {
        scope: 'all',
        literature_query: 'hemp OR cannabis OR cannabinoid',
      },
    },
    notify_on_failure: true,
    // hemp-os/hempforge backends not provisioned locally — keep disabled across /api/seed
    is_enabled: false,
  },

  // ── IP Portfolio Grading (9AM Mondays) ──────────────────────────────
  {
    name: 'IP Portfolio Grading',
    cron_expression: '0 9 * * 1',
    job_type: 'chain',
    job_config: {
      chain_slug: 'ip-portfolio-grading',
      input: {
        ip_type: 'all',
        industry: 'all',
      },
    },
    notify_on_failure: true,
  },

  // ── Research Data Pipeline (6AM Wednesdays) ─────────────────────────
  {
    name: 'Research Data Feed',
    cron_expression: '0 6 * * 3',
    job_type: 'chain',
    job_config: {
      chain_slug: 'research-data-pipeline',
      input: {
        dataset: 'nathanlauga/nba-games',
        topic: 'NBA performance trends',
        tags: 'research,data',
        force: false,
      },
    },
    notify_on_failure: true,
    // kaggle service not provisioned locally — keep disabled across /api/seed
    is_enabled: false,
  },

  // ── Book-Grounded Research + Library Distill (5AM daily) ─────────────
  {
    name: 'Book-Grounded Research',
    cron_expression: '0 5 * * *',
    job_type: 'chain',
    job_config: {
      chain_slug: 'book-grounded-research',
      input: {
        topic: 'strategy, business frameworks, agent autonomy',
        source: null,
        skill_name: 'library-insights',
      },
    },
    notify_on_failure: true,
  },

  // ── Brain Wiki sync (daily 3AM) ─────────────────────────────────────
  {
    name: 'Brain Wiki Sync',
    cron_expression: '0 3 * * *',
    job_type: 'custom',
    job_config: {
      handler: 'wiki_sync',
    },
    notify_on_failure: true,
  },

  // ── Benchmarking loop (staggered Mon–Fri) ───────────────────────────
  {
    name: 'Benchmark: Entities',
    cron_expression: '0 6 * * 1',
    job_type: 'custom',
    job_config: { handler: 'benchmark_entities' },
    notify_on_failure: true,
  },
  {
    name: 'Benchmark: Sites',
    cron_expression: '0 7 * * 1',
    job_type: 'custom',
    job_config: { handler: 'benchmark_sites' },
    notify_on_failure: true,
  },
  {
    name: 'Benchmark: Crons',
    cron_expression: '0 6 * * 2',
    job_type: 'custom',
    job_config: { handler: 'benchmark_crons' },
    notify_on_failure: true,
  },
  {
    name: 'Benchmark: Chains',
    cron_expression: '0 6 * * 3',
    job_type: 'custom',
    job_config: { handler: 'benchmark_chains' },
    notify_on_failure: true,
  },
  {
    name: 'Benchmark: Deep Score',
    cron_expression: '0 6 * * 4',
    job_type: 'custom',
    job_config: { handler: 'benchmark_deep_score' },
    notify_on_failure: true,
  },
  {
    name: 'Benchmark: Upgrade Review',
    cron_expression: '0 7 * * 5',
    job_type: 'custom',
    job_config: { handler: 'benchmark_upgrade_review' },
    notify_on_failure: true,
  },
  {
    name: 'Benchmark: Sync Roster',
    cron_expression: '0 8 * * 5',
    job_type: 'custom',
    job_config: { handler: 'benchmark_sync_roster' },
    notify_on_failure: true,
  },

  // ── Editorial Morning Push (7AM daily) ──────────────────────────────
  {
    name: 'Editorial Morning Push',
    cron_expression: '0 7 * * *',
    job_type: 'custom',
    job_config: { handler: 'editorial_push' },
    notify_on_failure: true,
  },

  // ── Research Rotation (6AM daily) ───────────────────────────────────
  // Drains the highest-priority ready science experiment from the queue.
  {
    name: 'Research Rotation',
    cron_expression: '0 6 * * *',
    job_type: 'custom',
    job_config: { handler: 'research_rotation' },
    notify_on_failure: true,
  },

  // ── Science Campaign Seed (4PM daily) ───────────────────────────────
  // Re-fills the science/sports experiment backlog from the real datasets +
  // research-paper store so Research Rotation never runs dry.
  {
    name: 'Science Campaign Seed',
    cron_expression: '0 16 * * *',
    job_type: 'custom',
    job_config: { handler: 'science_campaign_seed' },
    notify_on_failure: true,
  },

  // ── News Outlet Ingest (2:45AM Monday + Friday) ──────────────────────
  // Pushes the latest ecosystem research into Overlay Global Lens so the
  // public outlet mirrors fresh evidence-tiered papers, trends, discoveries.
  // Twice a week (Mon 1 + Fri 5) — the outlet's own crons + daily domain
  // repopulation keep it fresh the rest of the week.
  {
    name: 'News Outlet Ingest',
    cron_expression: '45 2 * * 1,5',
    job_type: 'chain',
    job_config: {
      chain_slug: 'news-outlet-ingest',
      input: {},
    },
    notify_on_failure: true,
  },

  // ── Cancer Research Deep-Dive (5AM daily) ───────────────────────────
  // Runs a cumulative Overlay Oncology study + synthesis around the current
  // cancer-theme focus (in-situ vaccination / cold-to-hot conversion per the
  // six Aug 2026 advances), then produces an OmniResearch brief.
  {
    name: 'Cancer Research Deep-Dive',
    cron_expression: '0 5 * * *',
    job_type: 'chain',
    job_config: {
      chain_slug: 'cancer-research-deep-dive',
      input: {
        topic: 'in-situ vaccination and cold-to-hot tumor microenvironment conversion for immunotherapy',
        cancerType: 'tnbc',
        target: 'PD-L1',
        mechanism: 'immunogenic cell death + local immune activation',
        ticks: 120,
        publish: true,
        context:
          'Six advances (Aug 2026): ASPIRE chemo-free HER2+ breast, Aliya PEF TLS induction, UC Irvine Treg mathematical modeling, intismeran mRNA melanoma vaccine phase 3, lysosomal nanoplatform cold-to-hot prostate, shikonin hydrogel + mild PTT cold TNBC.',
      },
    },
    notify_on_failure: true,
  },
];

/** Return a copy of the seeded scheduled job definitions (JOB_DEFS). */
export function getSeedJobDefs(): JobSeedDef[] {
  return [...JOB_DEFS];
}

// ============================================================================
// SEED IMPLEMENTATION
// ============================================================================

export interface BusinessSeedResult {
  entities: { upserted: number; slugs: string[] };
  chains: { created: number; slugs: string[] };
  jobs: { upserted: number; names: string[] };
  errors: string[];
}

/**
 * Seed all business automation entities, chain templates, and scheduled jobs.
 *
 * Uses upserts so this function is idempotent — safe to call repeatedly.
 */
export async function seedBusinessAutomation(): Promise<BusinessSeedResult> {
  const supabase = createDraymondAdminClient();
  const errors: string[] = [];

  // ── 1. Upsert entities ──────────────────────────────────────────────
  const entityMap = new Map<string, string>(); // slug → id
  const entitySlugs: string[] = [];

  for (const def of ENTITY_DEFS) {
    try {
      const { data, error } = await supabase
        .from('draymond_entities')
        .upsert(
          {
            name: def.name,
            slug: def.slug,
            kind: def.kind,
            description: def.description,
            invocation_method: def.invocation_method,
            invocation_config: def.invocation_config,
            capabilities: def.capabilities,
            tags: def.tags,
            category: def.category,
            is_active: true,
            health_status: 'unknown',
          },
          { onConflict: 'slug', ignoreDuplicates: false }
        )
        .select('id, slug')
        .single();

      if (error) {
        errors.push(`[entity:${def.slug}] ${error.message}`);
        continue;
      }

      const row = data as { id: string; slug: string };
      entityMap.set(row.slug, row.id);
      entitySlugs.push(row.slug);
    } catch (err) {
      errors.push(
        `[entity:${def.slug}] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── 2. Create chain templates ───────────────────────────────────────
  const chainSlugs: string[] = [];

  for (const tpl of CHAIN_TEMPLATES) {
    try {
      // Skip if already exists (idempotent)
      const existing = await getChain(tpl.slug);
      if (existing) {
        chainSlugs.push(tpl.slug);
        continue;
      }

      // Resolve entity IDs for all steps
      const missingEntities: string[] = [];
      for (const step of tpl.steps) {
        if (!entityMap.has(step.entitySlug)) {
          missingEntities.push(step.entitySlug);
        }
      }
      if (missingEntities.length > 0) {
        errors.push(
          `[chain:${tpl.slug}] Missing entities: ${missingEntities.join(', ')}. Skipping chain.`
        );
        continue;
      }

      // Create the chain template
      const chain = await createChain({
        name: tpl.name,
        slug: tpl.slug,
        description: tpl.description,
        version: '1.0.0',
        is_template: true,
        status: 'draft',
        trigger_type: 'scheduled',
        input_data: {},
        context: {},
        max_retries: 2,
      });

      // Insert all steps with empty depends_on (will patch after)
      const steps = await addSteps(
        tpl.steps.map((s) => ({
          chain_id: chain.id,
          step_order: s.step_order,
          name: s.name,
          entity_id: entityMap.get(s.entitySlug)!,
          action: s.action,
          input_mapping: s.input_mapping,
          output_key: s.output_key,
          parallel_group: s.parallel_group,
          depends_on_steps: [],
          risk_level: 'low',
          max_retries: 2,
        }))
      );

      // Patch depends_on_steps with real step IDs.
      // Align by (step_order, name) — NOT array index — because addSteps
      // returns inserted rows via `WHERE id IN (...)` re-select, whose order
      // is not guaranteed to match the input array (item: template dep seed).
      const stepByKey = new Map<string, (typeof steps)[number]>();
      for (const s of steps) {
        stepByKey.set(`${s.step_order}|${s.name}`, s);
      }
      const patchNeeded: Array<{ id: string; depends_on_steps: string[] }> = [];
      for (let i = 0; i < tpl.steps.length; i++) {
        const depIndices = tpl.steps[i].depends_on_indices;
        if (depIndices.length > 0) {
          const target = stepByKey.get(`${tpl.steps[i].step_order}|${tpl.steps[i].name}`);
          if (!target) {
            errors.push(
              `[chain:${tpl.slug}] Could not locate step "${tpl.steps[i].name}" (order ${tpl.steps[i].step_order}) after insert`
            );
            continue;
          }
          const resolved = depIndices
            .map((idx) => tpl.steps[idx])
            .map((dep) => stepByKey.get(`${dep.step_order}|${dep.name}`))
            .filter((s): s is (typeof steps)[number] => !!s)
            .map((s) => s.id);
          patchNeeded.push({
            id: target.id,
            depends_on_steps: resolved,
          });
        }
      }

      if (patchNeeded.length > 0) {
        for (const patch of patchNeeded) {
          const { error: depError } = await supabase
            .from('draymond_chain_steps')
            .update({ depends_on_steps: patch.depends_on_steps })
            .eq('id', patch.id);

          if (depError) {
            errors.push(
              `[chain:${tpl.slug}] Failed to patch deps for step ${patch.id}: ${depError.message}`
            );
          }
        }
      }

      // Update total_steps on the chain
      await supabase
        .from('draymond_chains')
        .update({ total_steps: steps.length })
        .eq('id', chain.id);

      chainSlugs.push(tpl.slug);
    } catch (err) {
      errors.push(
        `[chain:${tpl.slug}] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── 3. Upsert scheduled jobs ────────────────────────────────────────
  const jobNames: string[] = [];

  for (const def of JOB_DEFS) {
    try {
      const { data, error } = await supabase
        .from('draymond_scheduled_jobs')
        .upsert(
          {
            name: def.name,
            cron_expression: def.cron_expression,
            job_type: def.job_type,
            job_config: def.job_config,
            is_enabled: def.is_enabled ?? true,
            notify_on_failure: def.notify_on_failure ?? false,
            notify_on_success: false,
            max_retries: 1,
            timeout_seconds: 300,
            next_run_at: getNextRunTime(def.cron_expression).toISOString(),
          },
          { onConflict: 'name', ignoreDuplicates: false }
        )
        .select('name')
        .single();

      if (error) {
        errors.push(`[job:${def.name}] ${error.message}`);
        continue;
      }

      jobNames.push((data as { name: string }).name);
    } catch (err) {
      errors.push(
        `[job:${def.name}] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return {
    entities: { upserted: entitySlugs.length, slugs: entitySlugs },
    chains: { created: chainSlugs.length, slugs: chainSlugs },
    jobs: { upserted: jobNames.length, names: jobNames },
    errors,
  };
}
