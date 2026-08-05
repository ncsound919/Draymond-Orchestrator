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
  kind: 'agent' | 'service';
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
    invocation_method: 'api_call',
    invocation_config: {
      url: agentUrl('UPLIFT_BASE_URL', 'http://localhost:8000'),
      health_url: `${agentUrl('UPLIFT_BASE_URL', 'http://localhost:8000')}/health`,
      endpoints: {
        batch: '/batch',
        batch_multi: '/batch/multi',
        task_status: '/task/{id}',
        session: '/session/{id}',
        audit: '/audit',
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
      module: 'tradingagents',
      entry_point: 'main',
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
      health_url: `${agentUrl('SPORTS_STEVE_URL', 'http://localhost:8010')}/health`,
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
        odds_calc: '/api/odds',
        kelly: '/api/kelly',
        bankroll: '/api/bankroll',
        ocr: '/api/ocr',
        stats: '/api/stats',
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
        ollama_generate: '/api/ollama/generate',
        web_search: '/api/web-search',
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
        input_mapping: { query: '$.input.symbols' },
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
          topics: '$.steps.trending.output',
          brand: '$.input.brand_voice',
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
          content: '$.steps.content.output',
          style: '$.input.image_style',
        },
        output_key: 'images',
        step_order: 2,
        parallel_group: 'content_gen',
        depends_on_indices: [0],
      },
      {
        name: 'Schedule Posts',
        entitySlug: 'social-media-dashboard',
        action: 'schedule_posts',
        input_mapping: {
          text: '$.steps.content.output',
          images: '$.steps.images.output',
          platforms: '$.input.platforms',
        },
        output_key: 'scheduled',
        step_order: 3,
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
      'End-to-end content pipeline: research trending topics, generate text + image + video (parallel), then schedule across platforms.',
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
          topics: '$.steps.trends.output',
          brand: '$.input.brand_voice',
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
          prompt: '$.steps.text_content.output',
        },
        output_key: 'image_content',
        step_order: 2,
        parallel_group: 'media_gen',
        depends_on_indices: [0],
      },
      {
        name: 'Generate Video',
        entitySlug: 'social-media-dashboard',
        action: 'generate_video',
        input_mapping: {
          script: '$.steps.text_content.output',
        },
        output_key: 'video_content',
        step_order: 2,
        parallel_group: 'media_gen',
        depends_on_indices: [0],
      },
      {
        name: 'Schedule Distribution',
        entitySlug: 'social-media-dashboard',
        action: 'schedule_posts',
        input_mapping: {
          text: '$.steps.text_content.output',
          image: '$.steps.image_content.output',
          video: '$.steps.video_content.output',
          platforms: '$.input.platforms',
        },
        output_key: 'scheduled',
        step_order: 3,
        depends_on_indices: [1, 2, 3],
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
        entitySlug: 'overlay-chain',
        action: 'anomaly_detection',
        input_mapping: {
          product_ids: '$.input.product_ids',
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
          task: 'compile_morning_briefing',
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
      type: 'health_summary',
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
];

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

      // Patch depends_on_steps with real step IDs
      const patchNeeded: Array<{ id: string; depends_on_steps: string[] }> = [];
      for (let i = 0; i < tpl.steps.length; i++) {
        const depIndices = tpl.steps[i].depends_on_indices;
        if (depIndices.length > 0) {
          patchNeeded.push({
            id: steps[i].id,
            depends_on_steps: depIndices.map((idx) => steps[idx].id),
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
            is_enabled: true,
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
