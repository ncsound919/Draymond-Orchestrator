// ============================================================================
// RELEASE CREW FORMATION — the software factory: who builds, gates, ships, sells
// ============================================================================
// The marketing team has a formation (marketing-formation.ts). This is the
// OTHER half of the ecosystem: the crew that actually produces new tools and
// releases them. It binds the ecosystem's real dev tools into one pipeline so a
// release train can be scheduled and held accountable as a whole:
//
//   scout -> design -> build -> toolchain -> gate -> ship -> market -> learn
//
// The dev team is assembled from the ecosystem, exactly as the operator
// specified: omniresearch (scout), recourse + recursive-ip (design),
// axiom + opencode + deterministic-brain (build), Overlay Cheetah + the MCP
// stack (toolchain), grader/reporank/codenexus/quality-suite/trust-layer
// (gate), openhub (ship). Marketing is a HANDOFF — the released artifact is
// handed to the existing marketing formation; the factory does not invent
// demand, it reuses the plans already on disk.
//
// It is deliberately a data structure, not prose, so it can be rendered
// (releaseFormationMarkdown) and validated (validateReleaseFormation) for
// drift. A cell with no lead, a position reporting to a ghost, or a duplicate
// slug fails loud.
//
// Honesty contract (AGENTS.md brutal-honesty override):
//   - basis labels where each member's output comes from.
//   - `external: true` / `available: false` mark tools that are NOT in the
//     tree or not running. The gate reports them unavailable — it never fakes
//     a build, a test pass, or a release.
//   - math-x is LLM-routed and is explicitly OUTSIDE the no-LLM guarantee.
//   - The factory proposes; the operator disposes. Kill-switches stay OFF.
// ============================================================================

import type { Duty } from './fleet-duty';

/** The functional cells of the factory. */
export type ReleaseCell =
  | 'command'
  | 'scout'
  | 'design'
  | 'build'
  | 'toolchain'
  | 'gate'
  | 'ship'
  | 'market'
  | 'learn';

export interface ReleaseCellDef {
  id: ReleaseCell;
  name: string;
  mandate: string;
  /** Position slug that leads the cell. */
  lead: string;
}

/** Where a member's output actually comes from. */
export type ReleaseBasis =
  | 'deterministic'
  | 'ai'
  | 'measured'
  | 'orchestration'
  | 'knowledge'
  | 'external';

export type ReleaseRank = 'commander' | 'lead' | 'member' | 'external';

export interface ReleasePosition {
  slug: string;
  name: string;
  role: string;
  cell: ReleaseCell;
  rank: ReleaseRank;
  duty: Duty;
  /** Slug of the position this one reports to, or null for the outside commander. */
  reportsTo: string | null;
  cadence: string;
  inputs: string[];
  outputs: string[];
  /** Gates/contracts this position's output must pass before it is acted on. */
  gates: string[];
  basis: ReleaseBasis;
  kind: 'agent' | 'tool' | 'service' | 'pipeline' | 'library' | 'component';
  /** Repo-relative location, or null for a pure orchestrator / not-in-tree tool. */
  location: string | null;
  port?: number;
  invocation: 'http_api' | 'cli_command' | 'subprocess' | 'internal' | 'pipeline' | 'file';
  /** True when the tool is external (not cloned/in the tree) or not yet running. */
  external?: boolean;
  /** False when the tool is known but not presently available (honest). */
  available?: boolean;
  notes?: string;
}

export const RELEASE_CELLS: ReleaseCellDef[] = [
  { id: 'command', name: 'Command', mandate: 'Direct the train: schedule, provision, gate, own cost + governance. One flagship item per train.', lead: 'draymond' },
  { id: 'scout', name: 'Scout', mandate: 'Decide what to build and why: deep research + strategy ranking of candidate items.', lead: 'omniresearch-pro' },
  { id: 'design', name: 'Design', mandate: 'Turn the brief into a buildable architecture, IP plan, and the DESIGN.md token contract.', lead: 'recourse' },
  { id: 'build', name: 'Build', mandate: 'Generate the artifact: codegen engine, headless coder, and the deterministic swarm in bounded increments.', lead: 'axiom' },
  { id: 'toolchain', name: 'Toolchain', mandate: 'The deterministic MCP layer the build+gate cells drive: scaffold, rules, UI presets, conversion, verification.', lead: 'cheetah' },
  { id: 'gate', name: 'Gate', mandate: 'Independent QA + security + provenance. The implementer never grades its own work.', lead: 'grader' },
  { id: 'ship', name: 'Ship', mandate: 'Package and release the gated artifact (build bundle, GitHub Releases, paid download surface).', lead: 'openhub' },
  { id: 'market', name: 'Market', mandate: 'Hand the released artifact to the existing marketing formation. Reuse plans on disk; never invent demand.', lead: 'marketing-formation' },
  { id: 'learn', name: 'Learn', mandate: 'Close the loop: post-mortem into memory + genomes so the next train starts smarter.', lead: 'dev-brain' },
];

/**
 * The release crew — every position with its real provenance. Slugs match
 * draymond_entities.slug / ports.ts where the member is registered there.
 */
export const RELEASE_FORMATION: ReleasePosition[] = [
  // ── Command ───────────────────────────────────────────────────────────────
  {
    slug: 'draymond',
    name: 'Draymond',
    role: 'Outside Commander — fleet brain; schedules the train, provisions services, enforces the governance gate and cost cap.',
    cell: 'command',
    rank: 'commander',
    duty: 'always-on',
    reportsTo: null,
    cadence: 'Continuous (day flow + release crons)',
    inputs: ['day flow', 'release items', 'cost cap', 'governance policy'],
    outputs: ['release train schedule', 'service provisioning', 'gate verdicts'],
    gates: [],
    basis: 'orchestration',
    kind: 'agent',
    location: 'Draymond-Orchestrator',
    port: 3444,
    invocation: 'http_api',
  },

  // ── Scout ─────────────────────────────────────────────────────────────────
  {
    slug: 'omniresearch-pro',
    name: 'OmniResearch',
    role: 'Scout lead — deep research on candidate items; models via LiteLLM, decisions via Dev-Brain, verify/repair via Recourse.',
    cell: 'scout',
    rank: 'lead',
    duty: 'on-call',
    reportsTo: 'draymond',
    cadence: 'Per item intake; weekly scan',
    inputs: ['research question', 'registry entities', 'trend feeds'],
    outputs: ['research brief', 'candidate item shortlist'],
    gates: ['Dev-Brain strategy ranking', 'provenance via Recourse'],
    basis: 'ai',
    kind: 'agent',
    location: 'agents/omniresearch 2',
    port: 3012,
    invocation: 'http_api',
  },
  {
    slug: 'strategy-team',
    name: 'Strategy Team (Overlay Strategist)',
    role: 'Intelligence — ranks the candidate items via Dev-Brain /api/strategy/decide.',
    cell: 'scout',
    rank: 'external',
    duty: 'always-on',
    reportsTo: 'draymond',
    cadence: 'Daily 06:30 scan; weekly ranking',
    inputs: ['candidate items', 'registry', 'umami trends'],
    outputs: ['ranked item list'],
    gates: ['Dev-Brain strategy decision tree'],
    basis: 'deterministic',
    kind: 'agent',
    location: null,
    invocation: 'http_api',
  },

  // ── Design ────────────────────────────────────────────────────────────────
  {
    slug: 'recourse',
    name: 'Recourse',
    role: 'Design lead — autonomous self-developing architecture OS: template-driven component building, sandboxed tool registry, self-healing repair, dream engine, provenance chain.',
    cell: 'design',
    rank: 'lead',
    duty: 'shift',
    reportsTo: 'draymond',
    cadence: 'Per item (design freeze)',
    inputs: ['research brief', 'repo context'],
    outputs: ['architecture plan', 'component templates', 'provenance chain'],
    gates: ['sandboxed tool registry', 'provenance verify'],
    basis: 'deterministic',
    kind: 'agent',
    location: 'agents/recourse',
    port: 3050,
    invocation: 'http_api',
  },
  {
    slug: 'recursive-ip',
    name: 'Recursive IP',
    role: 'Design member — recursive IP builder; turns a brief into reusable, licensed IP structure.',
    cell: 'design',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'recourse',
    cadence: 'Per item',
    inputs: ['brief', 'IP constraints'],
    outputs: ['IP structure', 'reusable components'],
    gates: ['recourse provenance'],
    basis: 'deterministic',
    kind: 'service',
    location: null,
    port: 3410,
    invocation: 'http_api',
  },

  // ── Build ─────────────────────────────────────────────────────────────────
  {
    slug: 'axiom',
    name: 'Axiom',
    role: 'Build lead — codegen execution engine + Recourse bridge; runs the project loop (opencode -> det-brain -> cheetah -> LLM fallback), tests, rollback.',
    cell: 'build',
    rank: 'lead',
    duty: 'shift',
    reportsTo: 'draymond',
    cadence: 'Per item (build window)',
    inputs: ['architecture plan', 'DESIGN.md', 'goal'],
    outputs: ['code diff', 'built artifact', 'loop evidence'],
    gates: ['S9 verify gate', 'independent QA', 'failure classification'],
    basis: 'ai',
    kind: 'pipeline',
    location: 'agents/axiom',
    port: 3198,
    invocation: 'http_api',
  },
  {
    slug: 'opencode',
    name: 'opencode (headless)',
    role: 'Build member — headless codegen engine (Go tier) dispatched by Axiom; primary codegen in the no-fallback path.',
    cell: 'build',
    rank: 'member',
    duty: 'shift',
    reportsTo: 'axiom',
    cadence: 'Per item (per iteration)',
    inputs: ['development doc', 'bounded goal'],
    outputs: ['code diff'],
    gates: ['Axiom S9 verify gate'],
    basis: 'ai',
    kind: 'service',
    location: null,
    port: 4096,
    invocation: 'http_api',
  },
  {
    slug: 'deterministic-brain',
    name: 'Deterministic Brain',
    role: 'Build member — DCA swarm orchestrator (Recognition -> Labeling -> Intervention); deterministic plan→execute→publish; also the scheduler backbone.',
    cell: 'build',
    rank: 'member',
    duty: 'always-on',
    reportsTo: 'axiom',
    cadence: 'Continuous (swarm sweep)',
    inputs: ['goal', 'tool registry'],
    outputs: ['deterministic plan', 'swarm execution'],
    gates: ['MCP tool availability', 'no-LLM guarantee (except flagged tools)'],
    basis: 'deterministic',
    kind: 'agent',
    location: 'agents/deterministic-brain',
    port: 3210,
    invocation: 'http_api',
  },

  // ── Toolchain (Overlay Cheetah + MCPs) ─────────────────────────────────────
  {
    slug: 'cheetah',
    name: 'Overlay Cheetah V3 Pro',
    role: 'Toolchain lead — deterministic scaffold + schema/CRUD engine + component gen + verify gates (cheetah_scaffold/schema/component/gates). Not a pm2 service; invoked by Axiom.',
    cell: 'toolchain',
    rank: 'lead',
    duty: 'on-call',
    reportsTo: 'axiom',
    cadence: 'Per item (generation)',
    inputs: ['DESIGN.md tokens', 'entity DSL', 'plan'],
    outputs: ['scaffolded app', 'schema/CRUD', 'gate results'],
    gates: ['cheetah_gates verify', 'design token contract'],
    basis: 'deterministic',
    kind: 'tool',
    location: '01_Platforms/ECOS-Environmental-Initiatives/docs/T2F/overlayCheetah_v3_pro',
    invocation: 'cli_command',
    notes: 'Python deterministic codemod. Components still hardcode Tailwind colors — tokenization pending (see 2026-09-22 deterministic-coder plan).',
  },
  {
    slug: 'business-logic-mcp',
    name: 'Business-Logic-MCP',
    role: 'Toolchain member — business rules, state machines, footguns + deterministic validation/codegen (37 tools).',
    cell: 'toolchain',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'cheetah',
    cadence: 'Per build (pre-generation validation)',
    inputs: ['entity schema', 'payloads', 'plan'],
    outputs: ['validation verdicts', 'transition guards'],
    gates: ['deterministic (no LLM)'],
    basis: 'deterministic',
    kind: 'tool',
    location: '05_Apps/Business-Logic-MCP',
    invocation: 'internal',
    notes: 'MCP over stdio. The deterministic-brain bridge was broken (wrong path) — verify before trusting.',
  },
  {
    slug: 'og-glass',
    name: 'OG-Glass (UI presets MCP)',
    role: 'Toolchain member — UI design-system provider (tokens.json + component JSON, 9 presets); source of the frontend token contract.',
    cell: 'toolchain',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'cheetah',
    cadence: 'Per item (design tokens)',
    inputs: ['preset choice'],
    outputs: ['DESIGN.md tokens', 'component presets'],
    gates: ['ui-preset-mcp-server /health'],
    basis: 'deterministic',
    kind: 'tool',
    location: null,
    invocation: 'internal',
    external: true,
    available: false,
    notes: 'Public repo, NOT cloned into the tree (Phase 0 pending). Report unavailable until present.',
  },
  {
    slug: 'ufc-mcp',
    name: 'UFC-MCP',
    role: 'Toolchain member — Universal File Converter MCP v2.2.0 (21 tools: audio/video/img/doc/xlsx/archive/font/3D/email/music/biotech/fintech/logistics/dev/stats/chem/astro/geo).',
    cell: 'toolchain',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'cheetah',
    cadence: 'Per build (asset/spec conversion)',
    inputs: ['spec/doc/asset files'],
    outputs: ['converted artifacts'],
    gates: ['deterministic'],
    basis: 'deterministic',
    kind: 'tool',
    location: 'agents/UFC-MCP-main',
    invocation: 'internal',
  },
  {
    slug: 'middle-man-mcp',
    name: 'Middle-Man-MCP',
    role: 'Toolchain member — deterministic MCP gateway: registry + health + relay with circuit breaker, retry, response cache.',
    cell: 'toolchain',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'cheetah',
    cadence: 'Per build (proxy hop)',
    inputs: ['MCP tool calls'],
    outputs: ['relayed calls + metrics'],
    gates: ['circuit breaker', 'retry policy'],
    basis: 'orchestration',
    kind: 'tool',
    location: null,
    invocation: 'internal',
    external: true,
    available: false,
    notes: 'Private repo, NOT in the tree. Gate treats the glue as optional (direct bridges work without it).',
  },
  {
    slug: 'sub-team',
    name: 'Sub-Team',
    role: 'Toolchain member — deterministic formal-grammar sub-agents (spec→microarch→impl→verify) + business/cross-disciplinary analysis; MCP server.',
    cell: 'toolchain',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'cheetah',
    cadence: 'Per build (formal sub-work)',
    inputs: ['formal spec'],
    outputs: ['verified RTL / analysis'],
    gates: ['formal verify'],
    basis: 'deterministic',
    kind: 'tool',
    location: 'agents/Sub-Team-main',
    port: 8050,
    invocation: 'http_api',
  },
  {
    slug: 'the-beta-team',
    name: 'The-Beta-Team',
    role: 'Toolchain member — E2E/acceptance gate: playwright/selenium/airtest adapters + benchmarks + reports; runs the generated app.',
    cell: 'toolchain',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'cheetah',
    cadence: 'Per item (acceptance run)',
    inputs: ['built app', 'generated specs'],
    outputs: ['results.json', 'acceptance verdict'],
    gates: ['requires a real build — honest SKIP when absent'],
    basis: 'measured',
    kind: 'tool',
    location: '01_Platforms/ECOS-Environmental-Initiatives/docs/T2F/overlayCheetah_v3_pro/The-Beta-Team-main',
    invocation: 'cli_command',
    notes: 'Present locally alongside cheetah. Gate only runs when a scaffolded app exists.',
  },
  {
    slug: 'math-x',
    name: 'math-x',
    role: 'Toolchain member — analytics/validation (Pyodide/DuckDB/Monte-Carlo/verify) for numeric business rules.',
    cell: 'toolchain',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'cheetah',
    cadence: 'Per item (numeric checks)',
    inputs: ['numeric rules', 'datasets'],
    outputs: ['numeric validation'],
    gates: ['ONLY deterministic subsystems — LLM-routed parts are OUTSIDE the no-LLM guarantee'],
    basis: 'ai',
    kind: 'tool',
    location: null,
    invocation: 'internal',
    external: true,
    available: false,
    notes: 'LLM-routed by default (/api/verify = Claude + SymPy). Do not present as deterministic.',
  },

  // ── Gate (independent QA + security + provenance) ──────────────────────────
  {
    slug: 'grader',
    name: 'Grader',
    role: 'Gate lead — data-backed grade (sync /api/grade); independent verification of the built artifact.',
    cell: 'gate',
    rank: 'lead',
    duty: 'on-call',
    reportsTo: 'draymond',
    cadence: 'Per item (post-build)',
    inputs: ['built artifact', 'spec'],
    outputs: ['grade', 'findings'],
    gates: ['fresh context — no access to implementer findings'],
    basis: 'deterministic',
    kind: 'agent',
    location: 'agents/Grader-main',
    port: 3201,
    invocation: 'http_api',
  },
  {
    slug: 'reporank',
    name: 'RepoRank',
    role: 'Gate member — repo depth scoring + remediation + milestone/gate/drift progress.',
    cell: 'gate',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'grader',
    cadence: 'Per item (post-build)',
    inputs: ['repo'],
    outputs: ['score', 'remediation list'],
    gates: ['deterministic'],
    basis: 'deterministic',
    kind: 'agent',
    location: 'agents/reporank',
    port: 3200,
    invocation: 'http_api',
  },
  {
    slug: 'codenexus',
    name: 'CodeNexus',
    role: 'Gate member — agentic PR review + fix: webhook → diff → security scan → comment → auto-fix → verify → push.',
    cell: 'gate',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'grader',
    cadence: 'Per item (diff review)',
    inputs: ['diff', 'spec'],
    outputs: ['review', 'security findings'],
    gates: ['deterministic deep-audit lenses'],
    basis: 'deterministic',
    kind: 'agent',
    location: 'agents/CodeNexus-main/control-plane',
    port: 3205,
    invocation: 'http_api',
  },
  {
    slug: 'quality-suite',
    name: 'Quality Suite',
    role: 'Gate member — collective QA runner: RepoRank (static/smells/deps/builds), Grader (security/errors/compliance/tests), Benchmark Olympics (runtime/leaks/races/perf). One runner, one JSON contract.',
    cell: 'gate',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'grader',
    cadence: 'Per item (release gate)',
    inputs: ['repo', 'profile'],
    outputs: ['quality JSON', 'repair-team dispatch'],
    gates: ['measured:false reported honestly — no fabricated scores'],
    basis: 'measured',
    kind: 'tool',
    location: 'packages/quality-suite',
    invocation: 'cli_command',
    notes: 'Owns reporank/grader/olympics profiles. Replaces fabricated asan/tsan constants.',
  },
  {
    slug: 'trust-layer',
    name: 'Trust Layer',
    role: 'Gate member — auditor-credible proof: hash → merkle → anchors (rekor/ots/tsa) → proof → verify → seal. Provenance for every shipped artifact.',
    cell: 'gate',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'grader',
    cadence: 'Per item (on ship)',
    inputs: ['artifact hash'],
    outputs: ['proof', 'seal SVG', 'verifiable anchor'],
    gates: ['anchors rekor/ots/tsa'],
    basis: 'measured',
    kind: 'service',
    location: 'packages/trust-layer',
    port: 3101,
    invocation: 'http_api',
  },
  {
    slug: 'claw-protect',
    name: 'Claw-Protect',
    role: 'Gate member — secrets / prompt-injection scanner; security gate before release.',
    cell: 'gate',
    rank: 'member',
    duty: 'always-on',
    reportsTo: 'grader',
    cadence: 'Continuous (idle between sweeps)',
    inputs: ['repo', 'diff'],
    outputs: ['security verdict'],
    gates: ['critical findings block the release'],
    basis: 'deterministic',
    kind: 'agent',
    location: 'agents/Claw-Protect-main',
    port: 3300,
    invocation: 'http_api',
  },

  // ── Ship ──────────────────────────────────────────────────────────────────
  {
    slug: 'openhub',
    name: 'OpenHub',
    role: 'Ship lead — operator console / release desk; proxies /api/axiom/*, /api/recourse/*, /api/ops/stack-verify.',
    cell: 'ship',
    rank: 'lead',
    duty: 'shift',
    reportsTo: 'draymond',
    cadence: 'Per item (release window)',
    inputs: ['gated artifact', 'proof'],
    outputs: ['release decision', 'operator console state'],
    gates: ['gate pass', 'trust-layer proof', 'operator approval'],
    basis: 'orchestration',
    kind: 'service',
    location: null,
    port: 3010,
    invocation: 'http_api',
  },
  {
    slug: 'next-build',
    name: 'Next Build',
    role: 'Ship member — one-shot production build (ecosystem.next-build.config.js).',
    cell: 'ship',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'openhub',
    cadence: 'Per item (build bundle)',
    inputs: ['source tree'],
    outputs: ['production bundle'],
    gates: ['build must succeed (no ship on failed build)'],
    basis: 'deterministic',
    kind: 'pipeline',
    location: 'Draymond-Orchestrator',
    invocation: 'subprocess',
  },
  {
    slug: 'release-channel',
    name: 'Release Channel',
    role: 'Ship member — the distribution surface: GitHub Releases (desktop installers) + paid downloads served from data/paid-releases via /api/downloads/*.',
    cell: 'ship',
    rank: 'member',
    duty: 'on-call',
    reportsTo: 'openhub',
    cadence: 'Per item (on release)',
    inputs: ['bundle', 'proof', 'changelog'],
    outputs: ['published release', 'download surface'],
    gates: ['trust-layer proof attached', 'changelog present'],
    basis: 'orchestration',
    kind: 'component',
    location: 'Draymond-Orchestrator',
    invocation: 'internal',
    notes: 'DRAYMOND_RELEASES_DIR (default ./data/paid-releases).',
  },

  // ── Market (handoff to the existing marketing formation) ───────────────────
  {
    slug: 'marketing-formation',
    name: 'Marketing Formation (Draymond-led)',
    role: 'Market lead — receives the released artifact and runs it through the Draymond-led marketing formation (Weekly Marketing Pulse, publish queue). Reuses plans on disk.',
    cell: 'market',
    rank: 'external',
    duty: 'shift',
    reportsTo: 'draymond',
    cadence: 'Per release; daily marketing pulse',
    inputs: ['released artifact', 'release notes', 'existing launch plans'],
    outputs: ['marketing pulse', 'publish queue'],
    gates: ['marketing public_communication gate', 'PUBLISH_DRY_RUN'],
    basis: 'orchestration',
    kind: 'agent',
    location: 'Draymond-Orchestrator',
    invocation: 'internal',
    notes: 'Full campaign unit lives in marketing-formation.ts (8 cells). This is the single handoff point.',
  },

  // ── Learn ─────────────────────────────────────────────────────────────────
  {
    slug: 'dev-brain',
    name: 'Dev-Brain',
    role: 'Learn lead + governance advisor — deterministic FSM reasoning, decision trees, operator-COO genome; post-mortem and knowledge promotion.',
    cell: 'learn',
    rank: 'external',
    duty: 'always-on',
    reportsTo: 'draymond',
    cadence: 'On every strategy call; weekly post-mortem',
    inputs: ['release outcome', 'gate findings', 'operator ethos'],
    outputs: ['ranked lessons', 'genome updates'],
    gates: ['Anti-Ouroboros: generated knowledge cannot supersede verified knowledge without a human'],
    basis: 'deterministic',
    kind: 'agent',
    location: 'Dev-Brain',
    port: 3450,
    invocation: 'http_api',
  },
  {
    slug: 'memory',
    name: 'Ecosystem Memory',
    role: 'Learn member — append-only brain memory + journals + hypotheses; the civilization keeps its accumulated knowledge across agent lifetimes.',
    cell: 'learn',
    rank: 'member',
    duty: 'always-on',
    reportsTo: 'dev-brain',
    cadence: 'Continuous (append-only)',
    inputs: ['post-mortems', 'release records'],
    outputs: ['MEMORY.md entries', 'learning journals'],
    gates: ['append-only protocol', 'ownership respected (never rewrite .draymond JSON)'],
    basis: 'knowledge',
    kind: 'library',
    location: '.draymond',
    invocation: 'file',
  },
];

/** Slugs of every release-crew position. */
export function releaseCrewSlugs(): string[] {
  return RELEASE_FORMATION.map((p) => p.slug);
}

/** True when a slug belongs to the release crew. */
export function isReleaseCrewMember(slug: string): boolean {
  return RELEASE_FORMATION.some((p) => p.slug === slug);
}

/** Positions grouped by the provenance of their outputs. */
export function releaseCrewByBasis(): Record<ReleaseBasis, ReleasePosition[]> {
  const out: Record<ReleaseBasis, ReleasePosition[]> = {
    deterministic: [],
    ai: [],
    measured: [],
    orchestration: [],
    knowledge: [],
    external: [],
  };
  for (const p of RELEASE_FORMATION) out[p.basis].push(p);
  return out;
}

/** Concise summary for chat / reports / chain context. */
export function releaseCrewSummary(): string {
  const by = releaseCrewByBasis();
  return (
    `Release crew (${RELEASE_FORMATION.length}); commander: draymond | ` +
    `deterministic [${by.deterministic.map((p) => p.slug).join(', ')}] | ` +
    `AI [${by.ai.map((p) => p.slug).join(', ')}] | ` +
    `measured [${by.measured.map((p) => p.slug).join(', ')}] | ` +
    `orchestration [${by.orchestration.map((p) => p.slug).join(', ')}] | ` +
    `knowledge [${by.knowledge.map((p) => p.slug).join(', ')}] | ` +
    `external [${by.external.map((p) => p.slug).join(', ')}]`
  );
}

// ============================================================================
// RHYTHM — one release train per item, event-driven, not a fixed daily job
// ============================================================================

export interface ReleaseRhythmEntry {
  phase: 'intake' | 'design-freeze' | 'build' | 'gate' | 'ship' | 'market' | 'learn';
  /** What starts this phase. Cadence is per-item; only intake/learn are on a clock. */
  trigger: string;
  owner: string;
  purpose: string;
}

export const RELEASE_RHYTHM: ReleaseRhythmEntry[] = [
  { phase: 'intake', trigger: 'Weekly (Mon 06:30) + on-demand', owner: 'omniresearch-pro', purpose: 'Research + rank candidate items; pick ONE flagship for the train.' },
  { phase: 'design-freeze', trigger: 'Item selected', owner: 'recourse', purpose: 'Architecture + IP + DESIGN.md token contract; freeze the buildable plan.' },
  { phase: 'build', trigger: 'Design frozen', owner: 'axiom', purpose: 'Generate in bounded increments (toolchain drives scaffold/rules/presets).' },
  { phase: 'gate', trigger: 'Build complete', owner: 'grader', purpose: 'Independent QA + security + provenance. No self-grading.' },
  { phase: 'ship', trigger: 'Gate pass', owner: 'openhub', purpose: 'Build bundle, attach trust-layer proof, publish to the release channel.' },
  { phase: 'market', trigger: 'On ship', owner: 'marketing-formation', purpose: 'Hand to the marketing formation; reuse existing plans on disk.' },
  { phase: 'learn', trigger: 'Weekly + on ship', owner: 'dev-brain', purpose: 'Post-mortem into memory + genomes; feed the next train.' },
];

/** Standing rules the whole factory operates under. */
export const RELEASE_RULES_OF_ENGAGEMENT: string[] = [
  'The factory produces new tools. It does not invent demand — marketing re-uses the launch plans already on disk.',
  'Deterministic core decides and generates where possible; AI generates where needed; measurement reports. Never present generated output as verified until the gate passes.',
  'Independent QA: the implementer never grades its own work. The gate runs fresh-context (HoH 3-role: planner / developer / QA).',
  'Every external or MCP tool reports its own availability. Uncloned, unbuilt, or down is reported as unavailable — never substituted with fabricated output.',
  'Anti-Ouroboros: LLM-derived knowledge cannot supersede verified knowledge without a human.',
  'Nothing ships without a trust-layer proof and a governance-gate pass; PUBLISH_DRY_RUN stays default on.',
  'Kill-switches stay OFF — manual cluster mode is deliberate. The factory proposes; the operator disposes.',
  'One flagship item per release train; bounded, locally-complete increments (a coherent observable behavior, not a file count).',
];

export interface ReleaseFormation {
  cells: ReleaseCellDef[];
  positions: ReleasePosition[];
  rhythm: ReleaseRhythmEntry[];
  rules: string[];
}

/** The formation as data. */
export function releaseFormation(): ReleaseFormation {
  return {
    cells: RELEASE_CELLS,
    positions: RELEASE_FORMATION,
    rhythm: RELEASE_RHYTHM,
    rules: RELEASE_RULES_OF_ENGAGEMENT,
  };
}

/**
 * Validate the formation against itself. Returns every problem found (empty =
 * healthy). Checks: no duplicate slugs, every reportsTo is known, every cell
 * has a known lead, every cell is populated, and no field is missing.
 */
export function validateReleaseFormation(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const known = new Set<string>(RELEASE_FORMATION.map((p) => p.slug));

  // No duplicate positions.
  const seen = new Set<string>();
  for (const p of RELEASE_FORMATION) {
    if (seen.has(p.slug)) problems.push(`duplicate position for "${p.slug}"`);
    seen.add(p.slug);
    if (p.reportsTo && !known.has(p.reportsTo)) {
      problems.push(`position "${p.slug}" reports to unknown "${p.reportsTo}"`);
    }
    if (!p.cadence) problems.push(`position "${p.slug}" has no cadence`);
    if (!Array.isArray(p.outputs) || p.outputs.length === 0) {
      problems.push(`position "${p.slug}" declares no outputs`);
    }
  }

  // Every cell lead must exist and the cell must be populated.
  for (const c of RELEASE_CELLS) {
    if (!known.has(c.lead)) problems.push(`cell "${c.id}" lead "${c.lead}" is not a formation position`);
    if (!RELEASE_FORMATION.some((p) => p.cell === c.id)) {
      problems.push(`cell "${c.id}" has no positions`);
    }
  }

  return { ok: problems.length === 0, problems };
}

/** Render the formation to markdown for docs / OPS-CATALOG / chat. */
export function releaseFormationMarkdown(): string {
  const lines: string[] = [];
  lines.push('# Release Crew Formation (Software Factory)');
  lines.push('');
  lines.push('Command: Draymond (:3444, outside commander). Pipeline: scout -> design -> build -> toolchain -> gate -> ship -> market -> learn.');
  lines.push('');
  lines.push('## Cells');
  lines.push('');
  lines.push('| Cell | Mandate | Lead |');
  lines.push('|------|---------|------|');
  for (const c of RELEASE_CELLS) lines.push(`| ${c.name} | ${c.mandate} | ${c.lead} |`);
  lines.push('');
  lines.push('## Positions');
  lines.push('');
  lines.push('| Position | Cell | Rank | Duty | Reports to | Basis | Cadence |');
  lines.push('|----------|------|------|------|------------|-------|---------|');
  for (const p of RELEASE_FORMATION) {
    const flag = p.available === false ? ' _(unavailable)_' : '';
    lines.push(
      `| ${p.name} (\`${p.slug}\`)${flag} | ${p.cell} | ${p.rank} | ${p.duty} | ${p.reportsTo ?? '—'} | ${p.basis} | ${p.cadence} |`
    );
  }
  lines.push('');
  lines.push('## Release Rhythm');
  lines.push('');
  lines.push('| Phase | Trigger | Owner | Purpose |');
  lines.push('|-------|---------|-------|---------|');
  for (const r of RELEASE_RHYTHM) lines.push(`| ${r.phase} | ${r.trigger} | ${r.owner} | ${r.purpose} |`);
  lines.push('');
  lines.push('## Rules of Engagement');
  lines.push('');
  for (const r of RELEASE_RULES_OF_ENGAGEMENT) lines.push(`- ${r}`);
  return lines.join('\n');
}
