// ============================================================================
// DRAYMOND — Deterministic Goal Decomposer
// ============================================================================
// A zero-LLM replacement for the paid task-decomposition call. Small local
// models (qwen3:0.6b) grade POORLY on decomposition (shallow/placeholder
// output), and deepseek costs money for it. This tool turns a goal into a
// concrete, agent-assigned task plan deterministically via category detection
// + templates, so the swarm decompose path is fully self-contained.
//
// Returns a JSON string matching the swarm decompose schema:
//   { "tasks": [{ id, description, agent, priority, context }],
//     "recommended_mode": "parallel"|"sequential", "reasoning": "..." }
// Returns null when it cannot produce a usable plan (caller falls through to
// local/paid).
// ============================================================================

export interface DecomposedTask {
  id: string;
  description: string;
  agent: string;
  priority: 'high' | 'normal' | 'low';
  context: Record<string, unknown>;
}

export interface Decomposition {
  tasks: DecomposedTask[];
  recommended_mode: 'parallel' | 'sequential';
  reasoning: string;
}

interface CategoryTemplate {
  name: string;
  re: RegExp;
  /** (agentName, role) pairs in order of preference, matched against available agents. */
  agentHints: string[];
  recommended_mode: 'parallel' | 'sequential';
  /** Build the task descriptions; each uses `goal`. */
  build: (goal: string) => Array<{ description: string; priority: DecomposedTask['priority'] }>;
}

const CATEGORIES: CategoryTemplate[] = [
  {
    name: 'content',
    re: /\b(blog|post|article|copy|caption|newsletter|social|marketing|campaign|email|content|advert|seo|landing copy)\b/i,
    agentHints: ['content', 'marketing', 'writer', 'social', 'editor', 'research'],
    recommended_mode: 'sequential',
    build: (goal) => [
      { description: `Research the topic and audience for: ${goal}`, priority: 'high' },
      { description: `Outline the structure and key points for: ${goal}`, priority: 'high' },
      { description: `Draft the full content for: ${goal}`, priority: 'high' },
      { description: `Review, edit for tone/voice, and finalize for: ${goal}`, priority: 'normal' },
    ],
  },
  {
    name: 'software',
    re: /\b(build|feature|app|application|api|endpoint|website|webpage|landing page|react|component|scaffold|integration|automation|bot|service|dashboard|script)\b/i,
    agentHints: ['code', 'developer', 'engineer', 'software', 'build', 'fullstack', 'frontend', 'backend', 'scaffold', 'repo'],
    recommended_mode: 'sequential',
    build: (goal) => [
      { description: `Scaffold the structure and define requirements for: ${goal}`, priority: 'high' },
      { description: `Implement the core functionality for: ${goal}`, priority: 'high' },
      { description: `Wire integrations, config, and tests for: ${goal}`, priority: 'normal' },
      { description: `Review, verify, and finalize the build for: ${goal}`, priority: 'normal' },
    ],
  },
  {
    name: 'research',
    re: /\b(research|analyze|investigate|deep.dive|study|report|findings|competitive|market research|due diligence|landscape)\b/i,
    agentHints: ['research', 'analyst', 'intel', 'investigator', 'strategy', 'writer'],
    recommended_mode: 'parallel',
    build: (goal) => [
      { description: `Gather primary sources and data for: ${goal}`, priority: 'high' },
      { description: `Analyze findings and extract insights for: ${goal}`, priority: 'high' },
      { description: `Synthesize into a structured report for: ${goal}`, priority: 'normal' },
    ],
  },
  {
    name: 'data',
    re: /\b(data|metrics|analytics|dashboard|pipeline|optimize|forecast|report|database|etl|numbers|kpi)\b/i,
    agentHints: ['data', 'analyst', 'pipeline', 'engineer', 'report', 'ops'],
    recommended_mode: 'sequential',
    build: (goal) => [
      { description: `Source and prepare the data needed for: ${goal}`, priority: 'high' },
      { description: `Build/run the computation or pipeline for: ${goal}`, priority: 'high' },
      { description: `Summarize results and surface insights for: ${goal}`, priority: 'normal' },
    ],
  },
];

function pickNames(names: string[], hints: string[]): string[] {
  const hintMap = hints.map((h) => h.toLowerCase());
  const preferred = names.filter((n) => hintMap.some((h) => n.toLowerCase().includes(h)));
  return (preferred.length > 0 ? preferred : names).slice(0, 4);
}

function pickAgents(available: Record<string, string>, hints: string[]): string[] {
  const entries = Object.entries(available ?? {});
  if (entries.length === 0) return [];
  const hintMap = hints.map((h) => h.toLowerCase());
  // Match hints against BOTH the agent name and its specialty description, so
  // e.g. "marketing" picks maya("marketing content, copywriting"), not the
  // first agent in the registry.
  const preferred = entries
    .filter(([name, role]) => hintMap.some((h) => `${name} ${role}`.toLowerCase().includes(h)))
    .map(([name]) => name);
  return pickNames(preferred.length > 0 ? preferred : entries.map(([name]) => name), hints);
}

/** Category a goal falls into (content/software/research/data/generic). */
export function detectCategory(goal: string): string {
  const g = (goal ?? '').trim();
  return CATEGORIES.find((c) => c.re.test(g))?.name ?? 'generic';
}

function categoryTemplate(goal: string): CategoryTemplate {
  const g = (goal ?? '').trim();
  const found = CATEGORIES.find((c) => c.re.test(g));
  if (found) return found;
  return {
    name: 'generic',
    re: /.*/,
    agentHints: [],
    recommended_mode: 'sequential',
    build: (goalStr: string) => [
      { description: `Clarify requirements and success criteria for: ${goalStr}`, priority: 'high' },
      { description: `Execute the core work for: ${goalStr}`, priority: 'high' },
      { description: `Verify the outcome for: ${goalStr}`, priority: 'normal' },
    ],
  };
}

/**
 * Build a deterministic decomposition for a goal. `agents` maps agent name →
 * specialty (e.g. the fleet AGENT_ROLES). Returns null when unusable (no
 * agents available / empty goal).
 */
export function buildDecomposition(goal: string, agents: Record<string, string>): Decomposition | null {
  const g = (goal ?? '').trim();
  if (!g) return null;

  const category = categoryTemplate(g);
  if (category.agentHints.length === 0 && Object.keys(agents ?? {}).length > 0) {
    category.agentHints = Object.keys(agents);
  }

  const picked = pickAgents(agents, category.agentHints);
  if (picked.length === 0) return null;

  const steps = category.build(g);
  const tasks: DecomposedTask[] = steps.map((step, i) => ({
    id: `task-${i + 1}`,
    description: step.description,
    agent: picked[i % picked.length],
    priority: step.priority,
    context: { goal: g, category: category.name, step: i + 1 },
  }));

  return {
    tasks,
    recommended_mode: category.recommended_mode,
    reasoning: `Deterministic decomposition of "${g}" into ${tasks.length} tasks (category: ${category.name}).`,
  };
}

/** JSON-string form of a decomposition, or null when it can't be produced. */
export function decomposeGoal(goal: string, agents: Record<string, string>): string | null {
  const d = buildDecomposition(goal, agents);
  if (!d) return null;
  try {
    return JSON.stringify(d);
  } catch {
    return null;
  }
}

// -- IDE steps adapter ---------------------------------------------------------
// The IDE session-manager wants {"steps":[{"id","title","kind","agent","prompt",
// "dependsOn"}],"note"}. Emits it deterministically, constrained to the IDE's
// allowed kinds and agents. Returns null when unusable.

const IDE_KIND_BY_CATEGORY: Record<string, string> = {
  content: 'codegen',
  software: 'codegen',
  research: 'analyze',
  data: 'analyze',
  generic: 'codegen',
};

export function decomposeGoalToIdeSteps(
  goal: string,
  allowedKinds: ReadonlySet<string>,
  allowedAgents: ReadonlySet<string>,
): string | null {
  const g = (goal ?? '').trim();
  if (!g) return null;
  const category = categoryTemplate(g);
  const agents = [...allowedAgents];
  const picked = pickNames(agents, category.agentHints);
  const lead = picked.length > 0 ? picked[0] : agents[0] ?? 'uplift';
  const kind = allowedKinds.has(IDE_KIND_BY_CATEGORY[category.name])
    ? IDE_KIND_BY_CATEGORY[category.name]
    : [...allowedKinds][0] ?? 'codegen';

  const steps = category.build(g).map((s, i) => ({
    id: `s${i + 1}`,
    title: s.description.split(':')[0].trim(),
    kind,
    agent: picked[i % (picked.length || 1)] ?? lead,
    prompt: s.description,
    // sequential category → chain steps; parallel → independent
    dependsOn: category.recommended_mode === 'sequential' && i > 0 ? [`s${i}`] : [],
  }));

  try {
    return JSON.stringify({
      steps,
      note: `Deterministic ${category.name} plan (${steps.length} steps).`,
    });
  } catch {
    return null;
  }
}

// -- Chain blueprint adapter ---------------------------------------------------
// The chain-builder wants a ChainBlueprint referencing real catalog entities.
// Emits it deterministically by matching category hints against catalog
// slug/name. Steps with no matching entity get an empty entity_slug and are
// rejected downstream (falls through to local/paid).

export interface CatalogEntityLike {
  slug: string;
  name?: string;
  kind?: string;
}

export function decomposeGoalToBlueprint(
  goal: string,
  catalog: CatalogEntityLike[],
): string | null {
  const g = (goal ?? '').trim();
  if (!g || !Array.isArray(catalog) || catalog.length === 0) return null;
  const category = categoryTemplate(g);

  const slugs = catalog.map((e) => e.slug);
  // Match category hints against slug+name+kind so e.g. "research" finds moss.
  const hintMap = category.agentHints.map((h) => h.toLowerCase());
  const preferred = catalog
    .filter((e) => hintMap.some((h) => `${e.slug} ${e.name ?? ''} ${e.kind ?? ''}`.toLowerCase().includes(h)))
    .map((e) => e.slug);
  const picked = pickNames(preferred.length > 0 ? preferred : slugs, category.agentHints);

  const steps = category.build(g).map((s, i) => {
    const entitySlug = picked[i % (picked.length || 1)] ?? '';
    const entity = catalog.find((e) => e.slug === entitySlug);
    return {
      name: entity?.name ?? (entitySlug || `step-${i + 1}`),
      description: s.description,
      entity_slug: entitySlug,
      action: 'default',
      input_mapping: {},
      output_key: `step_${i + 1}`,
      depends_on: category.recommended_mode === 'sequential' && i > 0 ? [picked[0]] : [],
    };
  });

  try {
    return JSON.stringify({
      name: g.slice(0, 120),
      description: `Deterministic ${category.name} chain for: ${g}`,
      steps,
      reasoning: `Built deterministically by the goal decomposer (category: ${category.name}).`,
      confidence: 0.5,
    });
  } catch {
    return null;
  }
}
