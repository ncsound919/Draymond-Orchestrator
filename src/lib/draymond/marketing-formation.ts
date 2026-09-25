// ============================================================================
// MARKETING OPERATIVE FORMATION — who does what, for whom, on what rhythm
// ============================================================================
// The marketing team (marketing-team.ts) is the roster. This module is the
// FORMATION: the operating structure that turns that roster into an actual
// unit — cells, chain of command, duty type (always-on / shift / on-call),
// cadence, inputs, outputs, and the gates each position must pass.
//
// It is deliberately a data structure, not prose, so it can be rendered
// (marketingFormationMarkdown) and validated (validateMarketingFormation)
// against the live roster. drift between this and marketing-team.ts fails loud.
//
// Command model:
//   Draymond (fleet brain, :3444) .... commander — schedules, provisions, gates,
//                                      owns cost/governance and the pulse.
//   (SMD was the field commander; decommissioned 2026-09-24. Draymond commands
//    the team directly — there is no observer agent.)
//   Dev-Brain (:3450) ................ advisor + governance (public_communication
//                                      guardrail). Advises; never executes.
//   Strategy team .................... intelligence cell lead (venture ranking).
//
// Honesty contract: a position's outputs are only ever what its basis in
// marketing-team.ts can actually produce. AI assets are labeled; measured
// results require imported data; unavailable integrations report unavailable.
// ============================================================================

import { MARKETING_TEAM, marketingTeamSlugs, type MarketingTeamMember } from './marketing-team';
import type { Duty } from './fleet-duty';

/** The functional cells of the formation. */
export type MarketingCell =
  | 'command'
  | 'intelligence'
  | 'production'
  | 'distribution'
  | 'audience'
  | 'measurement'
  | 'knowledge'
  | 'governance';

export interface MarketingCellDef {
  id: MarketingCell;
  name: string;
  mandate: string;
  /** marketing-team slug (or external orchestrator slug) that leads the cell. */
  lead: string;
}

/** Slugs that command/advise the formation but are not marketing-team members. */
export const EXTERNAL_ORCHESTRATORS = ['draymond', 'strategy-team', 'dev-brain'] as const;
export type ExternalOrchestrator = (typeof EXTERNAL_ORCHESTRATORS)[number];

export const MARKETING_CELLS: MarketingCellDef[] = [
  { id: 'command', name: 'Command', mandate: 'Direct the unit, consolidate the Weekly Marketing Pulse, own the publish queue.', lead: 'draymond' },
  { id: 'intelligence', name: 'Intelligence & Strategy', mandate: 'Rank the next strategy bets and feed trend/evidence signals into command.', lead: 'strategy-team' },
  { id: 'production', name: 'Production', mandate: 'Make the assets: voice-checked copy, calendar, formats, video, graphics.', lead: 'overlay-content' },
  { id: 'distribution', name: 'Distribution', mandate: 'Publish and attribute: social scheduling, real posting, short links, automation.', lead: 'oss-postiz' },
  { id: 'audience', name: 'Audience & Revenue', mandate: 'Own the audience: email list, CRM pipeline, lead capture. Owned > rented.', lead: 'oss-listmonk' },
  { id: 'measurement', name: 'Measurement', mandate: 'Report what actually happened: engagement, anomalies, trend feeds.', lead: 'overlay-marketing-tracker' },
  { id: 'knowledge', name: 'Knowledge', mandate: 'Hold the copy/positioning/SEO skill files and brand corpora.', lead: 'marketingskills' },
  { id: 'governance', name: 'Governance', mandate: 'Gate public communication, spend and high-blast-radius sends.', lead: 'dev-brain' },
];

export type MarketingRank = 'commander' | 'lead' | 'member' | 'external';

export interface MarketingPosition {
  slug: string;
  name: string;
  role: string;
  cell: MarketingCell;
  rank: MarketingRank;
  duty: Duty;
  /** Slug of the position this one reports to, or null for the outside commander. */
  reportsTo: string | null;
  cadence: string;
  inputs: string[];
  outputs: string[];
  /** Gates/contracts this position's output must pass before it is acted on. */
  gates: string[];
}

/** Per-member formation spec. Every MARKETING_TEAM slug MUST have an entry. */
const POSITION_SPECS: Record<
  string,
  Omit<MarketingPosition, 'slug' | 'name' | 'role'>
> = {
  // -- Command --------------------------------------------------------------
  // (The field-commander position was social-media-dashboard; SMD was
  // decommissioned 2026-09-24. Command is Draymond — see EXTERNAL_FORMATION.)

  // -- Production -----------------------------------------------------------
  'overlay-marketing-voice': {
    cell: 'production',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'draymond',
    cadence: 'Per pulse / per draft batch',
    inputs: ['draft posts', 'brand corpora'],
    outputs: ['voice verdicts (review/clean)', 'missing-corpus warnings'],
    gates: ['assertVoiceRules', 'assertDraftPosts'],
  },
  'overlay-marketing-scheduler': {
    cell: 'production',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'draymond',
    cadence: 'Per pulse / per week',
    inputs: ['topic seeds', 'calendar rules'],
    outputs: ['platform calendar'],
    gates: [],
  },
  'overlay-marketing-format': {
    cell: 'production',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'draymond',
    cadence: 'Per pulse / per draft batch',
    inputs: ['draft posts'],
    outputs: ['format issues per platform'],
    gates: ['PLATFORMS allow-list'],
  },
  'overlay-content': {
    cell: 'production',
    rank: 'lead',
    duty: 'shift',
    reportsTo: 'draymond',
    cadence: 'Daily 10:30 media pipeline',
    inputs: ['topic / script', 'BYO provider key'],
    outputs: ['60-second video', 'FieldStation42 TV schedule entries'],
    gates: ['human publish gate (PUBLISH_DRY_RUN)', 'AI-generated media label'],
  },
  'content-creation-engine': {
    cell: 'production',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'overlay-content',
    cadence: 'On demand',
    inputs: ['episode brief'],
    outputs: ['animated episode'],
    gates: ['ComfyUI availability check (reports unavailable, never runs blind)'],
  },
  'youtube-shorts': {
    cell: 'production',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'overlay-content',
    cadence: 'On demand',
    inputs: ['long-form video'],
    outputs: ['vertical shorts'],
    gates: [],
  },
  'image-gen': {
    cell: 'production',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'overlay-content',
    cadence: 'Per draft post (when integrations enabled)',
    inputs: ['draft text'],
    outputs: ['social graphic (AI-generated, labeled)'],
    gates: ['UFC-MCP normalization', 'AI-generated label'],
  },
  // -- Distribution ---------------------------------------------------------
  'oss-postiz': {
    cell: 'distribution',
    rank: 'lead',
    duty: 'shift',
    reportsTo: 'draymond',
    cadence: 'Up 08:00, down 22:30',
    inputs: ['approved posts', 'generated images'],
    outputs: ['scheduled posts'],
    gates: ['Postiz channel config', 'PUBLISH_DRY_RUN'],
  },
  'agent-browser': {
    cell: 'distribution',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'oss-postiz',
    cadence: 'On approval (Postiz fallback)',
    inputs: ['approved draft', 'target platform'],
    outputs: ['published post (platforms Postiz OAuth cannot cover)', 'resulting screenshot'],
    gates: ['human confirmation gate', 'PUBLISH_DRY_RUN'],
  },
  'oss-shlink': {
    cell: 'distribution',
    rank: 'member',
    duty: 'shift',
    reportsTo: 'oss-postiz',
    cadence: 'Up with the stack (08:00)',
    inputs: ['campaign links'],
    outputs: ['short links', 'click attribution'],
    gates: [],
  },
  'oss-temporal-ui': {
    cell: 'distribution',
    rank: 'member',
    duty: 'shift',
    reportsTo: 'oss-postiz',
    cadence: 'Up with the stack (08:00)',
    inputs: [],
    outputs: ['scheduling workflow visibility'],
    gates: [],
  },
  'oss-windmill': {
    cell: 'distribution',
    rank: 'member',
    duty: 'shift',
    reportsTo: 'oss-postiz',
    cadence: 'Up with the stack (08:00)',
    inputs: ['automation scripts'],
    outputs: ['unified-publish orchestration'],
    gates: [],
  },

  // -- Audience & Revenue ---------------------------------------------------
  'oss-listmonk': {
    cell: 'audience',
    rank: 'lead',
    duty: 'shift',
    reportsTo: 'draymond',
    cadence: 'Up with the stack; sends per campaign',
    inputs: ['list-growth actions', 'newsletter draft'],
    outputs: ['sends', 'owned list'],
    gates: ['consent'],
  },
  'oss-twenty': {
    cell: 'audience',
    rank: 'member',
    duty: 'shift',
    reportsTo: 'oss-listmonk',
    cadence: 'Up with the stack (08:00)',
    inputs: ['leads'],
    outputs: ['pipeline / dealflow (E2-b2b)'],
    gates: [],
  },
  'oss-formbricks': {
    cell: 'audience',
    rank: 'member',
    duty: 'shift',
    reportsTo: 'oss-listmonk',
    cadence: 'Up with the stack (08:00)',
    inputs: ['survey / lead form'],
    outputs: ['leads', 'NPS'],
    gates: [],
  },

  // -- Measurement ----------------------------------------------------------
  'overlay-marketing-tracker': {
    cell: 'measurement',
    rank: 'lead',
    duty: 'on-call',
    reportsTo: 'draymond',
    cadence: 'Per pulse (weekly cadence)',
    inputs: ['engagement rows'],
    outputs: ['performance report', 'anomalies'],
    gates: ['requires imported data — reports unavailable otherwise'],
  },
  'oss-umami': {
    cell: 'measurement',
    rank: 'member',
    duty: 'always-on',
    reportsTo: 'overlay-marketing-tracker',
    cadence: 'Continuous',
    inputs: ['site events'],
    outputs: ['trend / anomaly feed'],
    gates: [],
  },
  'open-seo': {
    cell: 'measurement',
    rank: 'member',
    duty: 'always-on',
    reportsTo: 'overlay-marketing-tracker',
    cadence: 'Continuous (health probe)',
    inputs: ['site URLs', 'campaign links'],
    outputs: ['SEO health / crawl reports', 'analytics feed'],
    gates: ['health probe'],
  },

  // -- Knowledge ------------------------------------------------------------
  marketingskills: {
    cell: 'knowledge',
    rank: 'lead',
    duty: 'always-on',
    reportsTo: 'draymond',
    cadence: 'Continuous (read live)',
    inputs: ['topic'],
    outputs: ['copy / positioning / SEO guidance context'],
    gates: ['read live from disk — never fabricated'],
  },
};

/** External command/advisor positions (not marketing-team members). */
const EXTERNAL_FORMATION: MarketingPosition[] = [
  {
    slug: 'draymond',
    name: 'Draymond',
    role: 'Commander (fleet brain) — schedules/provisions/gates the unit, owns the pulse and publish queue',
    cell: 'command',
    rank: 'commander',
    duty: 'always-on',
    reportsTo: null,
    cadence: 'Continuous (day flow + crons; daily 10:00 pulse, nightly 20:00 prep)',
    inputs: ['day flow', 'cost cap', 'governance policy', 'marketing strategy calls', 'voice verdicts', 'tracker performance'],
    outputs: ['scheduling', 'service provisioning', 'governance gate verdicts', 'Weekly Marketing Pulse memo', 'publish queue'],
    gates: [],
  },
  {
    slug: 'strategy-team',
    name: 'Strategy Team (Overlay Strategist)',
    role: 'Intelligence lead — ranks the next strategy bets',
    cell: 'intelligence',
    rank: 'external',
    duty: 'always-on',
    reportsTo: 'draymond',
    cadence: 'Daily 06:30 scan; weekly ranking',
    inputs: ['registry entities/chains', 'umami trends', 'github feedback'],
    outputs: ['venture ranking via Dev-Brain /api/strategy/decide'],
    gates: [],
  },
  {
    slug: 'dev-brain',
    name: 'Dev-Brain',
    role: 'Advisor + governance — deterministic marketing matrix and public_communication guardrail',
    cell: 'governance',
    rank: 'external',
    duty: 'always-on',
    reportsTo: 'draymond',
    cadence: 'On every strategy call',
    inputs: ['channels', 'campaigns', 'candidate strategies'],
    outputs: ['channel allocation (/api/marketing/decide)', 'publish risk verdict'],
    gates: ['public_communication decision tree'],
  },
];

/** The full formation: every marketing-team member in a cell, plus externals. */
export const MARKETING_FORMATION: MarketingPosition[] = [
  ...MARKETING_TEAM.map((m: MarketingTeamMember) => {
    const spec = POSITION_SPECS[m.slug];
    if (!spec) {
      // Fail loud at module load: a roster member with no formation slot is drift.
      throw new Error(`marketing-formation: no POSITION_SPECS entry for marketing-team member "${m.slug}"`);
    }
    return { slug: m.slug, name: m.name, role: m.role, ...spec };
  }),
  ...EXTERNAL_FORMATION,
];

/** The operating rhythm, aligned to day-orchestrator.ts. */
export interface MarketingRhythmEntry {
  phase: 'morning' | 'midday' | 'evening' | 'weekly';
  time: string;
  call: string;
  owner: string;
  purpose: string;
}

export const MARKETING_RHYTHM: MarketingRhythmEntry[] = [
  { phase: 'morning', time: '06:30', call: 'strategy_team', owner: 'strategy-team', purpose: 'Intelligence scan: intel brief + venture scout' },
  { phase: 'morning', time: '08:00', call: 'oss_marketing_stack (up)', owner: 'draymond', purpose: 'Stand up the OSS stack (distribution + audience cells)' },
  { phase: 'midday', time: '10:00', call: 'marketing-pulse', owner: 'draymond', purpose: 'Content + top-of-funnel pulse' },
  { phase: 'midday', time: '10:30', call: 'overlay-content', owner: 'overlay-content', purpose: 'Media / video pipeline' },
  { phase: 'evening', time: '20:00', call: 'daily-marketing-run', owner: 'draymond', purpose: 'Build next-day content + tools' },
  { phase: 'evening', time: '22:30', call: 'oss_marketing_stack (status)', owner: 'overlay-marketing-tracker', purpose: 'Measurement snapshot before night stop' },
  { phase: 'weekly', time: 'weekly', call: 'Marketing Pulse memo', owner: 'draymond', purpose: 'Consolidated memo + strategy ranking via the strategy team' },
];

/** Standing rules the whole formation operates under. */
export const MARKETING_RULES_OF_ENGAGEMENT: string[] = [
  'Deterministic core decides, AI generates, measurement reports. Never present AI output as measured performance.',
  'Dev-Brain is the advisor; Draymond is the executor. Unreachable layers are reported, never substituted with fabricated results.',
  'Owned audience (email list, CRM) outranks rented reach (social) when allocating effort.',
  'Every pulse action item cites the member it came from (command’s rule).',
  'Draft inputs fail closed: assertDraftPosts + assertVoiceRules reject malformed posts before any member sees them.',
  'Publishing is human-gated: PUBLISH_DRY_RUN defaults on; high-blast-radius sends require the public_communication gate.',
  'Every integration reports its own availability. Down is reported as down — no invented post, video, image, or metric.',
];

export interface MarketingFormation {
  cells: MarketingCellDef[];
  positions: MarketingPosition[];
  rhythm: MarketingRhythmEntry[];
  rules: string[];
}

/** The formation as data. */
export function marketingFormation(): MarketingFormation {
  return {
    cells: MARKETING_CELLS,
    positions: MARKETING_FORMATION,
    rhythm: MARKETING_RHYTHM,
    rules: MARKETING_RULES_OF_ENGAGEMENT,
  };
}

/**
 * Validate the formation against the live roster. Returns every problem found
 * (empty = healthy). Checks: every roster member is slotted, every position's
 * slug is real, every cell lead exists, and no member is double-slotted.
 */
export function validateMarketingFormation(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const roster = new Set(marketingTeamSlugs());
  const externals = new Set<string>(EXTERNAL_ORCHESTRATORS);
  const known = new Set<string>([...roster, ...externals]);

  // Every roster member must have a position.
  const slotted = new Set(MARKETING_FORMATION.map((p) => p.slug));
  for (const slug of roster) {
    if (!slotted.has(slug)) problems.push(`roster member "${slug}" has no formation position`);
  }

  // No duplicate positions.
  const seen = new Set<string>();
  for (const p of MARKETING_FORMATION) {
    if (seen.has(p.slug)) problems.push(`duplicate position for "${p.slug}"`);
    seen.add(p.slug);
    if (!known.has(p.slug)) problems.push(`position "${p.slug}" is neither a marketing-team member nor a known external`);
    if (p.reportsTo && !known.has(p.reportsTo)) problems.push(`position "${p.slug}" reports to unknown "${p.reportsTo}"`);
  }

  // Every cell lead must exist as a position.
  for (const c of MARKETING_CELLS) {
    if (!seen.has(c.lead)) problems.push(`cell "${c.id}" lead "${c.lead}" is not a formation position`);
  }

  // Every roster member must sit in exactly one cell.
  const cellCount = new Map<string, number>();
  for (const p of MARKETING_FORMATION) {
    if (roster.has(p.slug)) cellCount.set(p.slug, (cellCount.get(p.slug) ?? 0) + 1);
  }
  for (const [slug, count] of cellCount) {
    if (count !== 1) problems.push(`roster member "${slug}" appears in ${count} positions (want exactly 1)`);
  }

  return { ok: problems.length === 0, problems };
}

/** Render the formation to markdown for docs / OPS-CATALOG / chat. */
export function marketingFormationMarkdown(): string {
  const lines: string[] = [];
  lines.push('# Marketing Operative Formation');
  lines.push('');
  lines.push(`Command: Draymond (:3444, fleet brain + field commander). Advisor/governance: Dev-Brain (:3450).`);
  lines.push('');
  lines.push('## Cells');
  lines.push('');
  lines.push('| Cell | Mandate | Lead |');
  lines.push('|------|---------|------|');
  for (const c of MARKETING_CELLS) lines.push(`| ${c.name} | ${c.mandate} | ${c.lead} |`);
  lines.push('');
  lines.push('## Positions');
  lines.push('');
  lines.push('| Position | Cell | Rank | Duty | Reports to | Cadence |');
  lines.push('|----------|------|------|------|------------|---------|');
  for (const p of MARKETING_FORMATION) {
    lines.push(`| ${p.name} (\`${p.slug}\`) | ${p.cell} | ${p.rank} | ${p.duty} | ${p.reportsTo ?? '—'} | ${p.cadence} |`);
  }
  lines.push('');
  lines.push('## Operating Rhythm');
  lines.push('');
  lines.push('| Phase | Time | Call | Owner | Purpose |');
  lines.push('|-------|------|------|-------|---------|');
  for (const r of MARKETING_RHYTHM) lines.push(`| ${r.phase} | ${r.time} | ${r.call} | ${r.owner} | ${r.purpose} |`);
  lines.push('');
  lines.push('## Rules of Engagement');
  lines.push('');
  for (const r of MARKETING_RULES_OF_ENGAGEMENT) lines.push(`- ${r}`);
  return lines.join('\n');
}
