// ============================================================================
// MARKETING TEAM — Draymond's marketing roster + the Dev-Brain strategy seam
// ============================================================================
// One module that (a) declares who is on the marketing team and what each
// member actually is, and (b) runs a marketing strategy through Dev-Brain's
// deterministic decision layer.
//
// The team (Draymond commands directly — there is no fake observer agent):
//   - Draymond (fleet brain) — leads; consolidates the weekly Marketing Pulse
//     from the deterministic members (Voice Keeper, Scheduler, Format Auditor,
//     Tracker). The deterministic core lives at
//     01_Platforms/Overlay365/agent-team/agents/marketing/.
//   - The four members — deterministic brand-voice / calendar / format /
//     engagement checks (no LLM in the core).
//   - The Content Engine — the BYO-model 60-second video pipeline
//     (02_Pillars/Overlay Music/Software/Overlay-Content-main; the ecosystem's
//     generative-video-ai service fronts it). This is the production arm.
//   - OpenSEO — the SEO data + Google Search Console engine (agents/open-seo).
//   - The OSS stack + image generation + the 50-skill library.
//
// The strategy seam (runMarketingStrategy):
//   1. Weight channels/campaigns via Dev-Brain POST /api/marketing/decide
//      (through marketing-decision.ts — deterministic, auditable, no LLM).
//   2. Rank the candidate strategies via the STRATEGY TEAM
//      (strategy-team.ts -> Dev-Brain POST /api/strategy/decide).
//   3. Return both matrices + honest notes when a layer is unreachable.
//
// Honesty contract (AGENTS.md brutal-honesty override): every member declares
// its `basis` — deterministic checks, AI model output, real measurement,
// knowledge files, or pure orchestration. Nothing here fabricates reach,
// engagement, or a rendered asset. AI-generated assets are never presented as
// measured results. If a layer is down, the caller is told.
// ============================================================================

import { execFile, exec } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getAllSkills } from '@/lib/registry/agent-store';
import { OSS_MARKETING_TEAM } from './oss-marketing';
import { probeService } from './service-manager';
import { devBrainGenomes, type DevBrainGenome } from './dev-brain';
import {
  decideMarketingMix,
  defaultMarketingMix,
  type MarketingCampaign,
  type MarketingChannel,
  type MarketingDecision,
} from './marketing-decision';
import { rankProposalsViaDevBrain } from './strategy-team';

/** Where a member's numbers actually come from. */
export type MarketingBasis = 'deterministic' | 'ai' | 'measured' | 'orchestration' | 'knowledge';

export interface MarketingTeamMember {
  /** Entity slug — matches draymond_entities.slug / ports.ts where registered. */
  slug: string;
  name: string;
  role: string;
  basis: MarketingBasis;
  kind: 'agent' | 'tool' | 'service' | 'pipeline' | 'library';
  /** Repo-relative location, or null for a pure orchestrator. */
  location: string | null;
  /** Env var that points at the service, when it is an HTTP service. */
  env?: string;
  port?: number | null;
  endpoint?: string | null;
  /** ports.ts slug to probe when it differs from `slug`. Enables health probes. */
  probeSlug?: string;
  invocation: 'http_api' | 'cli_command' | 'subprocess' | 'internal' | 'pipeline' | 'file';
  notes: string;
}

const MARKETING_AGENT_DIR = '01_Platforms/Overlay365/agent-team/agents/marketing';
const CONTENT_ENGINE_LOCATION = '02_Pillars/Overlay Music/Software/Overlay-Content-main';

/** The OSS stack (Postiz, Listmonk, Twenty, Formbricks, Umami, Shlink, Windmill, Temporal UI). */
const OSS_MEMBERS: MarketingTeamMember[] = OSS_MARKETING_TEAM.map((m) => ({
  slug: m.slug,
  name: m.name,
  role: `OSS marketing stack member (${m.compose})`,
  // Email/CRM are measured (real send + revenue data); the rest orchestrate.
  basis: m.slug === 'oss-listmonk' || m.slug === 'oss-twenty' ? 'measured' : 'orchestration',
  kind: 'service',
  location: '04_Integrations/oss-marketing-stack',
  port: m.port,
  endpoint: m.health,
  probeSlug: m.slug,
  invocation: 'http_api',
  notes: m.startupHint ?? 'docker compose managed by Draymond.',
}));

/** The marketing team — lead + members, then the production/tooling arm. */
export const MARKETING_TEAM: MarketingTeamMember[] = [
  // ── The deterministic core (Overlay365 agent-team) ─────────────────────────
  {
    slug: 'overlay-marketing-voice',
    name: 'The Voice Keeper',
    role: 'Brand-voice compliance (forbidden/required/pattern rules against the brand corpora)',
    basis: 'deterministic',
    kind: 'agent',
    location: MARKETING_AGENT_DIR,
    invocation: 'internal',
    notes: 'Corpus-driven; reports "corpus missing" honestly rather than passing everything.',
  },
  {
    slug: 'overlay-marketing-scheduler',
    name: 'The Scheduler',
    role: 'Content calendar construction across platforms',
    basis: 'deterministic',
    kind: 'agent',
    location: MARKETING_AGENT_DIR,
    invocation: 'internal',
    notes: 'Rule-based calendar; no LLM.',
  },
  {
    slug: 'overlay-marketing-format',
    name: 'The Format Auditor',
    role: 'Per-platform format limits (length, hashtags, structure)',
    basis: 'deterministic',
    kind: 'agent',
    location: MARKETING_AGENT_DIR,
    invocation: 'internal',
    notes: 'Fails loud on malformed drafts before they reach a platform.',
  },
  {
    slug: 'overlay-marketing-tracker',
    name: 'The Tracker',
    role: 'Engagement / anomaly analysis from imported rows',
    basis: 'measured',
    kind: 'agent',
    location: MARKETING_AGENT_DIR,
    invocation: 'internal',
    notes: 'Reports "unavailable" with no imported data — never invents impressions or engagement.',
  },

  // ── Production arm: the Content Engine (and its pipeline siblings) ──────────
  {
    slug: 'overlay-content',
    name: 'Content Engine',
    role: 'BYO-model 60-second video pipeline (script → voice → video → assembly → TV-style schedule)',
    basis: 'ai',
    kind: 'pipeline',
    location: CONTENT_ENGINE_LOCATION,
    env: 'GENERATIVE_VIDEO_URL',
    port: 8055,
    endpoint: '/',
    probeSlug: 'generative-video-ai',
    invocation: 'http_api',
    notes: 'SaaS ContentEngine (React/Express/Prisma; agent-ready JSON API). Fronted in the fleet by generative-video-ai. Output is AI-generated media — label it as such, never present as measured performance.',
  },
  {
    slug: 'content-creation-engine',
    name: 'Content Creation Engine (stage)',
    role: 'Animated-episode engine — stage of the generative-video-ai pipeline',
    basis: 'ai',
    kind: 'pipeline',
    location: '04_Integrations/integrations/Content-Creation-Engine-',
    invocation: 'pipeline',
    notes: 'Python pipeline; needs ComfyUI (:8188) + models + keys, so usually reports unavailable at runtime. Distinct from the SaaS ContentEngine above.',
  },
  {
    slug: 'youtube-shorts',
    name: 'YouTube Shorts (stage)',
    role: 'Shorts clipper — highlight extraction + vertical cropping',
    basis: 'ai',
    kind: 'pipeline',
    location: '04_Integrations/integrations/Generative-Video-AI',
    invocation: 'pipeline',
    notes: 'Stage of the generative-video-ai pipeline.',
  },
  {
    slug: 'image-gen',
    name: 'Image Generation (keyless)',
    role: 'AI social-graphic generation (pollinations)',
    basis: 'ai',
    kind: 'service',
    location: null,
    env: 'IMAGE_GEN_BASE',
    port: null,
    endpoint: 'https://image.pollinations.ai/',
    invocation: 'http_api',
    notes: 'Keyless. Every output is labeled AI-generated. Normalized via UFC-MCP ImageProcessor.',
  },

  // ── Knowledge arm: the 50-skill marketing library + SEO engine ─────────────
  {
    slug: 'marketingskills',
    name: 'Marketing Skills Library',
    role: 'Copy/positioning/SEO skill files loaded as prompt context',
    basis: 'knowledge',
    kind: 'library',
    location: '04_Integrations/integrations/marketingskills/skills',
    invocation: 'file',
    notes: 'Real markdown SKILL.md files read live. Loaded as guidance, not as measured fact.',
  },
  {
    slug: 'open-seo',
    name: 'OpenSEO',
    role: 'SEO engine — keyword research, rank tracking, backlinks, site audits, AI visibility, GSC',
    basis: 'measured',
    kind: 'service',
    location: 'agents/open-seo',
    env: 'OPEN_SEO_URL',
    port: 3006,
    endpoint: '/api/health',
    probeSlug: 'open-seo',
    invocation: 'http_api',
    notes: 'Real DataForSEO-backed data (needs DATAFORSEO_API_KEY from Keywire); reports unavailable without it — never invents rankings.',
  },

  // ── Browser automation (real posting fallback) ─────────────────────────────
  {
    slug: 'agent-browser',
    name: 'AgentBrowser (posting fallback)',
    role: 'Browser automation fallback for platforms Postiz OAuth cannot cover',
    basis: 'orchestration',
    kind: 'service',
    location: 'agents/AgentBrowser-main',
    env: 'AGENTBROWSER_URL',
    port: 3700,
    probeSlug: 'agent-browser',
    invocation: 'http_api',
    notes: 'Real logged-in-profile browser automation. Postiz is the primary publisher; use this only for platforms OAuth cannot cover. PUBLISH_DRY_RUN defaults on.',
  },

  // ── OSS stack ─────────────────────────────────────────────────────────────
  ...OSS_MEMBERS,
];

/** Slugs of every marketing-team member. */
export function marketingTeamSlugs(): string[] {
  return MARKETING_TEAM.map((m) => m.slug);
}

/** True when a slug belongs to the marketing team. */
export function isMarketingTeamMember(slug: string): boolean {
  return MARKETING_TEAM.some((m) => m.slug === slug);
}

/** Members grouped by the provenance of their outputs. */
export function marketingTeamByBasis(): Record<MarketingBasis, MarketingTeamMember[]> {
  const out: Record<MarketingBasis, MarketingTeamMember[]> = {
    deterministic: [],
    ai: [],
    measured: [],
    orchestration: [],
    knowledge: [],
  };
  for (const m of MARKETING_TEAM) out[m.basis].push(m);
  return out;
}

/** Concise summary for chat / reports / chain context. */
export function marketingTeamSummary(): string {
  const by = marketingTeamByBasis();
  return (
    `Marketing team (${MARKETING_TEAM.length}); lead: draymond (fleet brain) | ` +
    `deterministic [${by.deterministic.map((m) => m.slug).join(', ')}] | ` +
    `AI [${by.ai.map((m) => m.slug).join(', ')}] | ` +
    `measured [${by.measured.map((m) => m.slug).join(', ')}] | ` +
    `orchestration [${by.orchestration.map((m) => m.slug).join(', ')}] | ` +
    `knowledge [${by.knowledge.map((m) => m.slug).join(', ')}]`
  );
}

// ============================================================================
// INVENTORY — gather the ecosystem's marketing tools + skills + brains
// ============================================================================

const MARKETINGSKILLS_ROOT =
  process.env.MARKETINGSKILLS_ROOT ||
  path.resolve(process.cwd(), '..', '04_Integrations', 'integrations', 'marketingskills', 'skills');

export interface MarketingSkillEntry {
  id: string;
  name: string;
  slug: string;
  path: string;
  author?: string;
}

export interface MarketingSkillsGathered {
  /** Skills registered in .draymond/registry.json with category 'marketing'. */
  registered: MarketingSkillEntry[];
  registeredCount: number;
  /** Skill directories present on disk under MARKETINGSKILLS_ROOT. */
  onDiskCount: number;
  root: string;
  byAuthor: Record<string, number>;
}

/** Gather the marketing skills: registry entries + on-disk library count. */
export async function gatherMarketingSkills(): Promise<MarketingSkillsGathered> {
  let registered: MarketingSkillEntry[] = [];
  try {
    const all = await getAllSkills();
    registered = all
      .filter((s) => (s.category ?? '').toLowerCase() === 'marketing')
      .map((s) => ({ id: s.id, name: s.name, slug: s.slug, path: s.path, author: s.author }));
  } catch {
    registered = [];
  }

  let onDiskCount = 0;
  try {
    if (existsSync(MARKETINGSKILLS_ROOT)) {
      onDiskCount = readdirSync(MARKETINGSKILLS_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
    }
  } catch {
    onDiskCount = 0;
  }

  const byAuthor: Record<string, number> = {};
  for (const s of registered) {
    const key = s.author ?? 'unattributed';
    byAuthor[key] = (byAuthor[key] ?? 0) + 1;
  }

  return { registered, registeredCount: registered.length, onDiskCount, root: MARKETINGSKILLS_ROOT, byAuthor };
}

/** The Dev-Brain marketing leader genomes (the "brains" behind the votes). Never throws. */
export async function gatherMarketingGenomes(): Promise<DevBrainGenome[]> {
  try {
    const res = await devBrainGenomes('marketing');
    return res?.genomes ?? [];
  } catch {
    return [];
  }
}

export interface MarketingInventory {
  summary: string;
  roster: MarketingTeamMember[];
  skills: MarketingSkillsGathered;
  genomes: DevBrainGenome[];
}

/** Everything the marketing team is made of, in one call (skills + brains + roster). */
export async function gatherMarketingInventory(): Promise<MarketingInventory> {
  const [skills, genomes] = await Promise.all([gatherMarketingSkills(), gatherMarketingGenomes()]);
  return { summary: marketingTeamSummary(), roster: MARKETING_TEAM, skills, genomes };
}

// ============================================================================
// HEALTH PROBES — bounded, best-effort, opt-in
// ============================================================================

export interface MarketingProbe {
  slug: string;
  name: string;
  up: boolean;
  detail: string;
  port: number | null;
}

/** Probe every marketing member that has a ports.ts slug. Bounded + parallel. */
export async function marketingTeamProbes(): Promise<MarketingProbe[]> {
  return Promise.all(
    MARKETING_TEAM.filter((m) => m.probeSlug).map(async (m) => {
      const probe = await probeService(m.probeSlug as string, 3000);
      return { slug: m.slug, name: m.name, up: probe.up, detail: probe.detail, port: m.port ?? null };
    })
  );
}

// ============================================================================
// STRATEGY SEAM — Dev-Brain marketing allocation + strategy-team ranking
// ============================================================================

const DEFAULT_STRATEGY_PROBLEM =
  'Marketing strategy: allocate the owned/rented channel mix and rank the next strategy bets by attributable revenue, ' +
  'CAC payback, audience ownership durability, and speed to first signal. Highest weight = fund/ship first.';

/** Default channel mix (mirrors defaultMarketingMix; owned audience weighted first). */
const DEFAULT_CHANNELS: MarketingChannel[] = [
  { id: 'listmonk', name: 'Listmonk — email', platform: 'listmonk', description: 'Owned audience, highest LTV.' },
  { id: 'twenty', name: 'Twenty — CRM', platform: 'twenty', description: 'Pipeline + dealflow (E2-b2b).' },
  { id: 'postiz', name: 'Postiz — social', platform: 'postiz', description: 'Rented reach, fast iteration.' },
  { id: 'shlink', name: 'Shlink — links', platform: 'shlink', description: 'Attribution backbone.' },
  { id: 'formbricks', name: 'Formbricks — surveys', platform: 'formbricks', description: 'Lead capture + NPS.' },
  { id: 'umami', name: 'Umami — analytics', platform: 'umami', description: 'Trend/anomaly feed.' },
];

export interface MarketingStrategyProposal {
  id: string;
  title: string;
  description: string;
  tags?: string[];
}

/**
 * Seed strategy archetypes ranked by the strategy team when the caller supplies
 * none. These are grounded marketing archetypes (each backed by Dev-Brain
 * marketing genomes), NOT measured results — replace with real venture
 * proposals when available.
 */
export const DEFAULT_STRATEGY_PROPOSALS: MarketingStrategyProposal[] = [
  { id: 'owned-audience-compounding', title: 'Owned-audience compounding', description: 'Grow the email list + CRM pipeline first; every campaign feeds an owned asset (Godin, Pulizzi, Baer).', tags: ['owned', 'lifecycle'] },
  { id: 'attention-arbitrage', title: 'Attention arbitrage', description: 'Volume + platform-native posting on the cheapest reach channel (Vaynerchuk, Holiday, Shah).', tags: ['social', 'viral'] },
  { id: 'search-compounding', title: 'Search & discoverability compounding', description: 'Own high-intent queries and zero-click surfaces as a durable moat (Patel, Fishkin).', tags: ['seo', 'inbound'] },
  { id: 'positioning-category', title: 'Positioning & category design', description: 'Reframe the competitive context and own a word (Dunford, Ries, Lochhead, Neumeier).', tags: ['positioning', 'brand'] },
  { id: 'lifecycle-activation', title: 'Lifecycle & activation', description: 'Onboarding, activation and PLG loops over top-of-funnel spend (Verna, Cancel, Winters, Sharp).', tags: ['plg', 'lifecycle'] },
  { id: 'proof-and-trust', title: 'Proof, service & word-of-mouth', description: 'Turn service quality and evidence into referrals rather than paid interruption (Baer, Cialdini, Handley).', tags: ['trust', 'referral'] },
];

export interface MarketingStrategyInput {
  problem?: string;
  channels?: MarketingChannel[];
  campaigns?: MarketingCampaign[];
  /** Candidate strategies to rank via the strategy team. Defaults to the seed archetypes. */
  proposals?: MarketingStrategyProposal[];
  strategyKey?: 'balanced_pareto' | 'capital_efficiency' | 'hyper_velocity' | 'risk_containment';
}

export interface MarketingStrategy {
  generatedAt: string;
  problem: string;
  /** Channel/campaign allocation from Dev-Brain POST /api/marketing/decide. */
  allocation: MarketingDecision['allocation'];
  guard: MarketingDecision['guard'];
  marketingDevBrainConsulted: boolean;
  /** Candidate strategies that were ranked. */
  candidateStrategies: MarketingStrategyProposal[];
  /** Ranking from the strategy team (Dev-Brain POST /api/strategy/decide). */
  strategyTeam: {
    consulted: boolean;
    rankedIds: string[];
    recommendedId: string | null;
    matrix: unknown;
  } | null;
  recommended: { channelId: string | null; strategyId: string | null; rationale: string };
  /** Plain-language caveats when a layer was unreachable or a result is a fallback. */
  honestNotes: string[];
}

/**
 * Run one marketing strategy pass: weight the channel mix via Dev-Brain's
 * marketing adapter, then rank the candidate strategies via the strategy team.
 * Never throws — unreachable layers are reported, not faked.
 */
export async function runMarketingStrategy(input: MarketingStrategyInput = {}): Promise<MarketingStrategy> {
  const problem = input.problem ?? DEFAULT_STRATEGY_PROBLEM;
  const channels = input.channels ?? DEFAULT_CHANNELS;
  const honestNotes: string[] = [];

  // 1. Marketing mix allocation (Dev-Brain /api/marketing/decide).
  const mix = await decideMarketingMix({
    problem,
    channels,
    campaigns: input.campaigns,
    strategyKey: input.strategyKey ?? 'capital_efficiency',
  });
  if (!mix.devBrainConsulted) {
    honestNotes.push(
      'Dev-Brain /api/marketing/decide unreachable — allocation is an equal-weight fallback, not a deterministic ranking.'
    );
  }

  // 2. Strategy-team ranking of the candidate bets (Dev-Brain /api/strategy/decide).
  const candidates = input.proposals && input.proposals.length > 0 ? input.proposals : DEFAULT_STRATEGY_PROPOSALS;
  let strategyTeam: MarketingStrategy['strategyTeam'] = null;
  if (candidates.length >= 2) {
    const ranked = await rankProposalsViaDevBrain(candidates);
    if (ranked) {
      const rankedIds = ranked.rankedIds;
      const matrix = ranked.matrix as { recommendedOptionId?: string };
      strategyTeam = {
        consulted: true,
        rankedIds,
        recommendedId: matrix?.recommendedOptionId ?? rankedIds[0] ?? null,
        matrix: ranked.matrix,
      };
    } else {
      honestNotes.push(
        'Strategy team (Dev-Brain /api/strategy/decide) unreachable — no cross-team ranking; seed strategies are unordered.'
      );
    }
  } else {
    honestNotes.push('Fewer than 2 candidate strategies supplied — strategy-team ranking skipped.');
  }

  const topChannel = mix.allocation.find((a) => a.recommended) ?? mix.allocation[0] ?? null;
  const recommendedId = strategyTeam?.recommendedId ?? null;
  const recommendedTitle = recommendedId
    ? candidates.find((c) => `venture:${c.title}` === recommendedId || c.id === recommendedId)?.title ?? recommendedId
    : null;

  const rationale = [
    topChannel
      ? `Fund first: ${topChannel.id} (weight ${topChannel.weight}%). ${topChannel.rationale}`
      : 'No channel allocation available.',
    recommendedTitle
      ? `Strategy team lead bet: ${recommendedTitle}.`
      : 'No strategy-team ranking available.',
  ].join(' ');

  return {
    generatedAt: new Date().toISOString(),
    problem,
    allocation: mix.allocation,
    guard: mix.guard,
    marketingDevBrainConsulted: mix.devBrainConsulted,
    candidateStrategies: candidates,
    strategyTeam,
    recommended: { channelId: topChannel?.id ?? null, strategyId: recommendedId, rationale },
    honestNotes,
  };
}

// ============================================================================
// OPERATIONAL PULSE — the Observer's daily reading of real state
// ============================================================================
// Reads what is actually there: the SMD publish queue (local file, mirrors SMD
// src/ai/api.py), Dev-Brain's channel mix, and the Overlay365 deterministic
// team's weekly pulse (via serve.ts). Nothing is fetched speculatively.

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/** The Overlay365 deterministic marketing team dir (mirrors agentTeamDir). */
export function marketingTeamDir(): string {
  if (process.env.MARKETING_TEAM_DIR) return process.env.MARKETING_TEAM_DIR;
  return path.resolve(
    process.cwd(),
    '..',
    '01_Platforms',
    'Overlay365',
    'agent-team',
    'agents',
    'marketing'
  );
}

export interface DeterministicPulseSummary {
  ok: boolean;
  error?: string;
  weekOf?: string;
  voiceStatus?: string;
  calendarCount?: number;
  formatFails?: number;
  actionItems?: string[];
  markdown?: string;
}

/**
 * Run the Overlay365 deterministic marketing team's pulse via its serve.ts CLI
 * (JSON in → JSON out). Bounded 90s, never throws. This is the real Voice
 * Keeper + Scheduler + Format Auditor + Tracker consolidation — no LLM.
 */
export async function runDeterministicPulse(input: {
  weekOf?: string;
  topicSeeds?: string[];
  draftPosts?: Array<{ id: string; text: string; platform: string }>;
  useIntegrations?: boolean;
} = {}): Promise<DeterministicPulseSummary> {
  const dir = marketingTeamDir();
  try {
    await /*turbopackIgnore: true*/ stat(dir);
  } catch {
    return { ok: false, error: `marketing team not found at ${dir}` };
  }

  let tmpDir: string | null = null;
  try {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'marketing-team-'));
    const inputFile = path.join(tmpDir, 'request.json');
    const request = {
      weekOf: input.weekOf,
      topicSeeds: input.topicSeeds ?? ['brand update'],
      draftPosts: input.draftPosts,
      useIntegrations: input.useIntegrations ?? false,
    };
    await writeFile(inputFile, JSON.stringify(request), 'utf-8');

    const serveRel = 'serve.ts';
    const inputRel = `--input=${inputFile}`;
    const opts = { cwd: dir, timeout: 90_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true };
    // win32: npx is a .cmd shim — execFile cannot spawn it directly (ENOENT).
    const { stdout } = await (process.platform === 'win32'
      ? execAsync(`npx tsx ${serveRel} "${inputRel}"`, opts)
      : execFileAsync('npx', ['tsx', serveRel, inputRel], opts));

    let parsed: { ok?: boolean; error?: string; weekOf?: string; pulse?: Record<string, unknown>; markdown?: string };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { ok: false, error: 'unparseable output from marketing serve' };
    }
    if (!parsed.ok) return { ok: false, error: parsed.error ?? 'marketing serve returned not-ok' };

    const pulse = (parsed.pulse ?? {}) as {
      voice?: { corpusStatus?: string };
      calendar?: unknown[];
      formatFails?: unknown[];
      actionItems?: string[];
    };
    return {
      ok: true,
      weekOf: parsed.weekOf,
      voiceStatus: pulse.voice?.corpusStatus,
      calendarCount: Array.isArray(pulse.calendar) ? pulse.calendar.length : 0,
      formatFails: Array.isArray(pulse.formatFails) ? pulse.formatFails.length : 0,
      actionItems: Array.isArray(pulse.actionItems) ? pulse.actionItems.slice(0, 12) : [],
      markdown: parsed.markdown,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 800) };
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The marketing publish queue — the OSS publish pipeline's single input. The
 * Postiz drainer consumes it; there is no SMD service anymore (decommissioned
 * 2026-09-24). Read/written as a JSON array of { platform, ... } items.
 */
export const MARKETING_QUEUE_FILE =
  process.env.MARKETING_QUEUE_FILE ??
  path.resolve(process.cwd(), 'data', 'marketing-queue.json');

export interface MarketingPulseStatus {
  generatedAt: string;
  queueFile: string;
  queueFound: boolean;
  pendingPosts: number;
  byPlatform: Record<string, number>;
  /** Set only when the queue file exists but could not be read/parsed. */
  queueError: string | null;
  mix: { devBrainConsulted: boolean; topChannel: string | null; guard: MarketingDecision['guard'] };
  /** The Overlay365 deterministic team's pulse, or null when not run. */
  deterministic: DeterministicPulseSummary | null;
  note: string;
}

export interface MarketingPulseOptions {
  /**
   * Run the Overlay365 deterministic team (spawns tsx). Default: enabled,
   * disable with DRAYMOND_MARKETING_PULSE_SPAWN=0 or withDeterministic:false.
   */
  withDeterministic?: boolean;
  topicSeeds?: string[];
}

/**
 * The daily operational pulse. Never throws — an absent queue file, an
 * unreadable queue, an unreachable Dev-Brain, or an unreachable deterministic
 * team is reported as such, not masked.
 */
export async function runMarketingPulse(opts: MarketingPulseOptions = {}): Promise<MarketingPulseStatus> {
  let queueFound = false;
  let pendingPosts = 0;
  let queueError: string | null = null;
  const byPlatform: Record<string, number> = {};

  try {
    if (existsSync(MARKETING_QUEUE_FILE)) {
      queueFound = true;
      const raw = JSON.parse(readFileSync(MARKETING_QUEUE_FILE, 'utf8')) as unknown;
      const items = Array.isArray(raw) ? raw : [];
      pendingPosts = items.length;
      for (const item of items) {
        const platform = (item as { platform?: unknown })?.platform;
        const key = typeof platform === 'string' && platform ? platform : 'unknown';
        byPlatform[key] = (byPlatform[key] ?? 0) + 1;
      }
    }
  } catch (err) {
    queueFound = false;
    pendingPosts = 0;
    queueError = err instanceof Error ? err.message : String(err);
  }

  let mix: MarketingPulseStatus['mix'] = { devBrainConsulted: false, topChannel: null, guard: null };
  try {
    const decision = await defaultMarketingMix();
    const top = decision.allocation.find((a) => a.recommended) ?? decision.allocation[0] ?? null;
    mix = { devBrainConsulted: decision.devBrainConsulted, topChannel: top?.id ?? null, guard: decision.guard };
  } catch {
    // best-effort; mix stays null
  }

  const withDeterministic = opts.withDeterministic ?? process.env.DRAYMOND_MARKETING_PULSE_SPAWN !== '0';
  const deterministic = withDeterministic
    ? await runDeterministicPulse({ topicSeeds: opts.topicSeeds })
    : null;

  const note = queueError
    ? `Marketing queue at ${MARKETING_QUEUE_FILE} could not be read (${queueError}).`
    : queueFound
      ? `${pendingPosts} post(s) pending in the marketing publish queue.`
      : `Marketing queue file not found at ${MARKETING_QUEUE_FILE} — no pending posts reported.`;

  return {
    generatedAt: new Date().toISOString(),
    queueFile: MARKETING_QUEUE_FILE,
    queueFound,
    pendingPosts,
    byPlatform,
    queueError,
    mix,
    deterministic,
    note,
  };
}

// ============================================================================
// PUBLISH DRAIN — the OSS publish pipeline's single actor (Postiz)
// ============================================================================
// Drains MARKETING_QUEUE_FILE through the overlay marketing action bridge,
// which posts to Postiz (POST /api/v2/post). PUBLISH_DRY_RUN defaults ON: with
// it on nothing is sent and every item is reported HELD — never published.

export interface MarketingPublishOutcome {
  index: number;
  platform: string | null;
  ok: boolean;
  detail: string;
}

export interface MarketingPublishDrainResult {
  dryRun: boolean;
  queueFile: string;
  queueFound: boolean;
  checked: number;
  published: number;
  held: number;
  outcomes: MarketingPublishOutcome[];
  note: string;
}

/** Invoke one overlay-marketing action via its ENTITY_INPUT CLI. Never throws. */
async function invokeMarketingAction(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const actionsPath = path.join(marketingTeamDir(), 'actions.ts');
  // Windows-safe: run tsx's compiled CLI through node, never the npx.cmd shim.
  const tsxCli = path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const opts = {
    cwd: process.cwd(),
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, ENTITY_INPUT: JSON.stringify(payload) },
  };
  try {
    const { stdout } = await execFileAsync(process.execPath, [tsxCli, actionsPath], opts);
    const parsed = JSON.parse(stdout) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : { ok: false, error: 'non-object output from marketing actions' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Drain the marketing publish queue through Postiz. Never throws. A missing or
 * unreadable queue, a dry run, or a down Postiz are all reported as such.
 */
export async function runMarketingPublishDrain(): Promise<MarketingPublishDrainResult> {
  const dryRun = process.env.PUBLISH_DRY_RUN !== '0';
  let items: Array<Record<string, unknown>> = [];
  let queueFound = false;
  try {
    if (existsSync(MARKETING_QUEUE_FILE)) {
      queueFound = true;
      const raw = JSON.parse(readFileSync(MARKETING_QUEUE_FILE, 'utf8')) as unknown;
      if (Array.isArray(raw)) items = raw as Array<Record<string, unknown>>;
    }
  } catch (err) {
    return {
      dryRun,
      queueFile: MARKETING_QUEUE_FILE,
      queueFound: false,
      checked: 0,
      published: 0,
      held: 0,
      outcomes: [],
      note: `Marketing queue could not be read: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!queueFound) {
    return {
      dryRun,
      queueFile: MARKETING_QUEUE_FILE,
      queueFound: false,
      checked: 0,
      published: 0,
      held: 0,
      outcomes: [],
      note: `Marketing queue file not found at ${MARKETING_QUEUE_FILE} — nothing to drain.`,
    };
  }

  if (dryRun) {
    return {
      dryRun: true,
      queueFile: MARKETING_QUEUE_FILE,
      queueFound: true,
      checked: items.length,
      published: 0,
      held: items.length,
      outcomes: items.map((it, i) => ({
        index: i,
        platform: typeof it.platform === 'string' ? it.platform : null,
        ok: false,
        detail: 'held: PUBLISH_DRY_RUN is on',
      })),
      note: `PUBLISH_DRY_RUN is on — ${items.length} post(s) held, nothing published.`,
    };
  }

  const outcomes: MarketingPublishOutcome[] = [];
  let published = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const platform = typeof item.platform === 'string' ? item.platform : null;
    const text =
      typeof item.text === 'string' ? item.text : typeof item.content === 'string' ? item.content : '';
    if (!text) {
      outcomes.push({ index: i, platform, ok: false, detail: 'held: no text/content field' });
      continue;
    }
    const res = await invokeMarketingAction({ action: 'schedule_posts', text });
    const ok = res.ok === true;
    if (ok) published++;
    outcomes.push({
      index: i,
      platform,
      ok,
      detail: ok
        ? `published${typeof res.post_id === 'string' ? ` (${res.post_id})` : ''}`
        : String(res.error ?? 'failed'),
    });
  }
  return {
    dryRun: false,
    queueFile: MARKETING_QUEUE_FILE,
    queueFound: true,
    checked: items.length,
    published,
    held: outcomes.length - published,
    outcomes,
    note: `${published}/${items.length} post(s) published via Postiz; ${outcomes.length - published} held.`,
  };
}

// ============================================================================
// TEAM STATUS — roster + inventory + optional health probes
// ============================================================================

export interface MarketingTeamStatus {
  summary: string;
  members: number;
  skills: MarketingSkillsGathered;
  genomes: DevBrainGenome[];
  probes: MarketingProbe[] | null;
}

/** Marketing team status. Set opts.probe to hit the live endpoints (bounded ~3s). */
export async function marketingTeamStatus(opts: { probe?: boolean } = {}): Promise<MarketingTeamStatus> {
  const [skills, genomes] = await Promise.all([gatherMarketingSkills(), gatherMarketingGenomes()]);
  const probes = opts.probe ? await marketingTeamProbes() : null;
  return { summary: marketingTeamSummary(), members: MARKETING_TEAM.length, skills, genomes, probes };
}
