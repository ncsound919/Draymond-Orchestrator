// ============================================================================
// DRAYMOND FLEET PIPELINES — one dispatcher per parent agent
// ============================================================================
// Every parent agent that absorbed overlapping tools owns a single pipeline:
// a deterministic ordered set of stages, each pointing at the FOLDED tool's
// real runnable entrypoint (command/args/cwd or HTTP port). Chains, schedulers,
// and the repair team dispatch to the PARENT slug and let the pipeline resolve
// which stage runs — never disjointed one-off tools.
//
// This is the operational counterpart to `.draymond/registry.json` `foldedInto`
// metadata: the registry records WHAT was folded; this module records HOW the
// folded tool actually runs.
// ============================================================================

import path from 'node:path';

export type PipelineStageKind = 'http' | 'subprocess' | 'cli' | 'mcp';

export interface PipelineStage {
  /** Folded tool id (matches registry.json foldedInto entries). */
  tool: string;
  /** Human label. */
  label: string;
  /** What this stage produces. */
  purpose: string;
  kind: PipelineStageKind;
  /** HTTP tools — canonical port (see ports.ts). */
  port?: number;
  healthPath?: string;
  /** Working dir relative to the Draymond repo root (for cli/subprocess). */
  cwd?: string;
  /** Base command (for cli/subprocess). */
  command?: string;
  /** Static args (for cli/subprocess). */
  args?: string[];
  /** Env var override for the base URL / command. */
  env?: string;
  /** MCP server config (for mcp kind). */
  mcpServer?: string;
}

export interface FleetPipeline {
  /** Parent agent slug. */
  parent: string;
  label: string;
  purpose: string;
  /** Ordered stages — the pipeline runs these in sequence. */
  stages: PipelineStage[];
  /** Relative path to the consolidated dependency manifest (pip). */
  requirements?: string;
}

// Repo-root-relative dirs for the folded integrations (04_Integrations lives
// one level up from the Draymond repo root).
const INT = (name: string) => path.join('..', '04_Integrations', 'integrations', name);

// ============================================================================
// THE PIPELINES
// ============================================================================

export const FLEET_PIPELINES: FleetPipeline[] = [
  {
    parent: 'social-media-dashboard',
    requirements: 'pipelines/social-media-dashboard/requirements.txt',
    label: 'Marketing production pipeline',
    purpose: 'Voice-check → calendar → format audit → engagement tracking → asset production. One entry point for the whole marketing engine.',
    stages: [
      {
        tool: 'overlay-marketing-voice',
        label: 'Brand voice guard',
        purpose: 'Deterministic brand-tone check on every planned post.',
        kind: 'cli',
        command: 'npx',
        args: ['tsx', path.join('..', 'overlay365', 'agent-team', 'agents', 'marketing', 'index.ts'), 'voice'],
      },
      {
        tool: 'overlay-marketing-scheduler',
        label: 'Editorial calendar',
        purpose: 'Turns topic seeds into a weekly cross-platform posting plan.',
        kind: 'cli',
        command: 'npx',
        args: [path.join('..', 'overlay365', 'agent-team', 'agents', 'marketing', 'index.ts'), 'schedule'],
      },
      {
        tool: 'overlay-marketing-format',
        label: 'Format auditor',
        purpose: 'Character / hashtag / link checks per platform — pass/fail.',
        kind: 'cli',
        command: 'npx',
        args: [path.join('..', 'overlay365', 'agent-team', 'agents', 'marketing', 'index.ts'), 'format'],
      },
      {
        tool: 'overlay-marketing-tracker',
        label: 'Engagement tracker',
        purpose: 'Aggregate impressions/engagements, flag anomalies, keep nulls visible.',
        kind: 'cli',
        command: 'npx',
        args: [path.join('..', 'overlay365', 'agent-team', 'agents', 'marketing', 'index.ts'), 'track'],
      },
      {
        tool: 'marketing-tool',
        label: 'Marketing asset engine',
        purpose: 'Automation dashboards, creation studio, strategies, video generation.',
        kind: 'subprocess',
        command: 'python',
        args: ['marketing_tool.py'],
        cwd: INT('Marketing-Tool'),
        env: 'MARKETING_TOOL_CWD',
      },
    ],
  },
  {
    parent: 'generative-video-ai',
    requirements: 'pipelines/generative-video-ai/requirements.txt',
    label: 'Media production pipeline',
    purpose: 'Shorts extraction → animated episode rendering → studio generation. One media backend.',
    stages: [
      {
        tool: 'youtube-shorts',
        label: 'Shorts clipper',
        purpose: 'Extract highlights and crop vertical shorts from long-form video.',
        kind: 'subprocess',
        command: 'python',
        args: ['main.py'],
        cwd: path.join('agents', 'AI-Youtube-Shorts-Generator-main'),
        env: 'YOUTUBE_SHORTS_CWD',
      },
      {
        tool: 'content-creation-engine',
        label: 'Animated episode engine',
        purpose: 'MP3 sources → fully-rendered animated episodes with commercial breaks.',
        kind: 'subprocess',
        command: 'python',
        args: ['run_episode.py'],
        cwd: INT('Content-Creation-Engine-'),
        env: 'CONTENT_CREATION_CWD',
      },
      {
        tool: 'generative-video-ai',
        label: 'Generation studio',
        purpose: '200+ image/video models for creative asset production.',
        kind: 'http',
        port: 8055,
        healthPath: '/',
        env: 'GENERATIVE_VIDEO_URL',
      },
    ],
  },
  {
    parent: 'bookbridge',
    requirements: 'pipelines/bookbridge/requirements.txt',
    label: 'Knowledge & memory pipeline',
    purpose: 'Library search → synthesis → vector index → long-term memory. One grounded-knowledge backend.',
    stages: [
      {
        tool: 'bookbridge',
        label: 'Book library daemon',
        purpose: 'Hybrid search, full-text retrieval, citations over the 133-book library.',
        kind: 'http',
        port: 8777,
        healthPath: '/health',
        env: 'BOOKBRIDGE_URL',
      },
      {
        tool: 'book-synthesis',
        label: 'Multi-book synthesist',
        purpose: 'Up to 5 books → web-validated, illustrated reports with confidence scores.',
        kind: 'subprocess',
        command: 'python',
        args: ['knowledge_synthesizer.py'],
        cwd: path.join('agents', 'Book-Synthesis-Engine-main'),
        env: 'BOOK_SYNTHESIS_CWD',
      },
      {
        tool: 'zvec',
        label: 'Vector index',
        purpose: 'In-process vector database powering semantic search.',
        kind: 'cli',
        command: 'python',
        args: ['-m', 'zvec'],
        cwd: INT('zvec'),
        env: 'ZVEC_CWD',
      },
      {
        tool: 'memagent',
        label: 'Long-term memory',
        purpose: 'RL-based memory agent for arbitrarily long context.',
        kind: 'subprocess',
        command: 'python',
        args: ['-m', 'memagent'],
        cwd: INT('MemAgent'),
        env: 'MEMAGENT_CWD',
      },
    ],
  },
  {
    parent: 'omniresearch-pro',
    requirements: 'pipelines/omniresearch-pro/requirements.txt',
    label: 'Research pipeline',
    purpose: 'Deep research → notebook workspace. One research engine.',
    stages: [
      {
        tool: 'omniresearch-pro',
        label: 'Deep research',
        purpose: 'Multi-source synthesis with citations.',
        kind: 'http',
        port: 3010,
        healthPath: '/api/health',
        env: 'OMNI_RESEARCH_URL',
      },
      {
        tool: 'open-notebook',
        label: 'Notebook workspace',
        purpose: 'NotebookLM-style research workspace (api/main.py).',
        kind: 'subprocess',
        command: 'python',
        args: ['-m', 'uvicorn', 'api.main:app', '--host', '127.0.0.1', '--port', '3030'],
        cwd: INT('open-notebook'),
        env: 'OPEN_NOTEBOOK_CWD',
      },
    ],
  },
  {
    parent: 'litellm',
    requirements: 'pipelines/litellm/requirements.txt',
    label: 'LLM gateway pipeline',
    purpose: 'Provider gateway → token billing middleware → context compression. One model-routing path.',
    stages: [
      {
        tool: 'litellm',
        label: 'Provider gateway',
        purpose: 'Unified LLM provider gateway (OpenAI-compatible).',
        kind: 'http',
        port: 4100,
        healthPath: '/health',
        env: 'LITELLM_URL',
      },
      {
        tool: 'tap919-middleman',
        label: 'Metered gateway',
        purpose: 'Metered agent gateway — billable UsageEvents to the E3 cash register.',
        kind: 'http',
        port: 8021,
        healthPath: '/internal/ping',
        env: 'MIDDLEMAN_URL',
      },
      {
        tool: 'llmlingua',
        label: 'Context compressor',
        purpose: 'Prompt/context compression before hitting the model.',
        kind: 'cli',
        command: 'python',
        args: ['-m', 'llmlingua'],
        cwd: INT('LLMLingua'),
        env: 'LLMLINGUA_CWD',
      },
    ],
  },
  {
    parent: 'agent-browser',
    requirements: 'pipelines/agent-browser/requirements.txt',
    label: 'Web automation pipeline',
    purpose: 'Browser control → adaptive scraping → fleet orchestration. One web layer.',
    stages: [
      {
        tool: 'browser-use',
        label: 'Browser engine',
        purpose: 'Programmatic browser control for agents.',
        kind: 'cli',
        command: 'python',
        args: ['-m', 'browser_use.cli'],
        cwd: INT('browser-use'),
        env: 'BROWSER_USE_CWD',
      },
      {
        tool: 'scrapling',
        label: 'Adaptive scraper',
        purpose: 'Stealth-aware adaptive web scraping / data collection.',
        kind: 'cli',
        command: 'python',
        args: ['-m', 'scrapling.cli'],
        cwd: INT('Scrapling'),
        env: 'SCRAPLING_CWD',
      },
      {
        tool: 'agent-browser',
        label: 'Orchestrator',
        purpose: 'Playwright automation, Overlay365 QA, ecosystem gateway.',
        kind: 'http',
        port: 3700,
        healthPath: '/api/system/health',
        env: 'AGENTBROWSER_URL',
      },
    ],
  },
  {
    parent: 'ufc-mcp',
    requirements: 'pipelines/ufc-mcp/requirements.txt',
    label: 'File conversion pipeline',
    purpose: 'Universal conversion + local PDF ops. One converter.',
    stages: [
      {
        tool: 'ufc-mcp',
        label: 'Universal converter',
        purpose: 'Audio/video/image/document conversion via FFmpeg, no cloud.',
        kind: 'mcp',
        mcpServer: path.join('agents', 'UFC-MCP-main'),
        env: 'UFC_MCP_CMD',
      },
      {
        tool: 'stirling-pdf',
        label: 'PDF operations',
        purpose: 'Local PDF operations (merge/split/OCR/sign) on :8080.',
        kind: 'http',
        port: 8080,
        healthPath: '/',
        env: 'STIRLING_PDF_URL',
      },
    ],
  },
  {
    parent: 'depscan',
    requirements: 'pipelines/depscan/requirements.txt',
    label: 'Dependency security pipeline',
    purpose: 'SCA scan + SBOM/deps.dev health. One dependency-audit path.',
    stages: [
      {
        tool: 'depscan',
        label: 'Dep-scan (SCA)',
        purpose: 'Dependency CVE scanning.',
        kind: 'cli',
        command: 'python',
        args: ['-m', 'depscan.cli'],
        cwd: INT('dep-scan'),
        env: 'DEPScan_URL',
      },
      {
        tool: 'supply-chain-health',
        label: 'SBOM health (heisenberg)',
        purpose: 'SBOM + deps.dev package health, bulk assessment.',
        kind: 'cli',
        command: 'python',
        args: ['-m', 'heisenberg.main'],
        cwd: INT('heisenberg-ssc-health-check'),
        env: 'SUPPLY_CHAIN_CWD',
      },
    ],
  },
  {
    parent: 'trading-agents',
    requirements: 'pipelines/trading-agents/requirements.txt',
    label: 'Trading pipeline',
    purpose: 'Market analysis → risk engine / backtesting. One finance path.',
    stages: [
      {
        tool: 'trading-agents',
        label: 'Market analysis',
        purpose: 'Multi-agent market signal synthesis and strategy generation.',
        kind: 'subprocess',
        command: 'python',
        args: [path.join('agents', 'TradingAgents-main', 'main.py')],
        env: 'TRADING_AGENTS_URL',
      },
      {
        tool: 'super-tool',
        label: 'Risk engine',
        purpose: 'Backtesting (backtrader), unified risk engine, pipeline utilities.',
        kind: 'subprocess',
        command: 'python',
        args: [path.join('agents', 'super_tool', 'trading_pipeline.py')],
        env: 'SUPER_TOOL_CWD',
      },
    ],
  },
];

// ============================================================================
// LOOKUPS
// ============================================================================

const PIPELINE_BY_PARENT = new Map(FLEET_PIPELINES.map((p) => [p.parent, p]));
const STAGE_BY_TOOL = new Map<string, { pipeline: FleetPipeline; stage: PipelineStage }>();
for (const p of FLEET_PIPELINES) {
  for (const s of p.stages) {
    STAGE_BY_TOOL.set(s.tool, { pipeline: p, stage: s });
  }
}

/** Full pipeline for a parent agent slug (the folded host). */
export function pipelineFor(parent: string): FleetPipeline | undefined {
  return PIPELINE_BY_PARENT.get(parent);
}

/** Folded-tool id → owning pipeline + stage (reverse lookup). */
export function stageFor(tool: string): { pipeline: FleetPipeline; stage: PipelineStage } | undefined {
  return STAGE_BY_TOOL.get(tool);
}

/** All folded tool ids wired into pipelines (the ones that actually run). */
export function wiredFoldedTools(): string[] {
  return [...STAGE_BY_TOOL.keys()];
}

/**
 * Consolidated dependency manifest for a pipeline (pip `-r` file). Every
 * folded stage's real requirements are included so one install provisions the
 * whole pipeline. Returns undefined when the pipeline has no pip manifest.
 */
export function pipelineRequirements(parent: string): string | undefined {
  return PIPELINE_BY_PARENT.get(parent)?.requirements;
}

/** Every pipeline that has a consolidated dependency manifest. */
export function pipelinesWithRequirements(): Array<{ parent: string; requirements: string }> {
  return FLEET_PIPELINES.filter((p) => p.requirements).map((p) => ({
    parent: p.parent,
    requirements: p.requirements as string,
  }));
}

/** `pip install -r <manifest>` for every pipeline that has one. */
export function installAllPipelinesCommand(): string[] {
  return pipelinesWithRequirements().map((p) => `pip install -r ${p.requirements}`);
}

/**
 * Resolve the runnable base for a stage — either a canonical HTTP URL (env
 * override aware) or the cwd + command + args of the subprocess/CLI stage.
 * Returns null when the stage cannot be resolved to a concrete run target.
 */
export function resolveStageRun(
  stage: PipelineStage,
): { url?: string; cwd?: string; command?: string; args?: string[] } | null {
  if (stage.kind === 'http' && stage.port) {
    const envVal = stage.env ? process.env[stage.env] : undefined;
    if (envVal && /^https?:\/\//i.test(envVal)) {
      return { url: `${envVal.replace(/\/+$/, '')}${stage.healthPath ?? '/'}` };
    }
    return { url: `http://localhost:${stage.port}${stage.healthPath ?? '/'}` };
  }
  if ((stage.kind === 'cli' || stage.kind === 'subprocess') && stage.command) {
    return { cwd: stage.cwd, command: stage.command, args: stage.args ?? [] };
  }
  return null;
}

/** One-line summary of every pipeline (for repair reports / chain context). */
export function pipelineSummary(): string {
  return FLEET_PIPELINES.map(
    (p) => `${p.parent}: ${p.stages.map((s) => s.tool).join(' → ')}${p.requirements ? ` [reqs]` : ''}`
  ).join(' | ');
}
