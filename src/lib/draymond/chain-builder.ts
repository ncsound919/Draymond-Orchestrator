// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Dynamic Chain Builder
// ============================================================================
// Converts natural language descriptions into executable entity chains.
//
// Uses the LLM to:
// 1. Parse the user's intent into a sequence of steps
// 2. Map each step to a registered entity in the registry
// 3. Define input/output mappings between steps
// 4. Validate the chain before creation
// 5. Optionally create and execute it immediately
//
// Example: "Research competitors, then write a summary email"
//   → chain: [omniresearch → email-sender]
// ============================================================================

import { createDraymondAdminClient, createDraymondClient } from './client';
import { logEvent } from './index';
import { callLLM, callLocalModel } from './llm';
import { decomposeGoalToBlueprint } from './decomposer';
import { executeChain } from './chains';
import type {
  ChainBlueprintStep,
  ChainBlueprint,
  ChainBuildRequest,
  ChainBuildResult,
  DraymondChainStepInsert,
} from './types';

// ── Configuration ────────────────────────────────────────────────────────────

const BUILDER_MODEL = 'deepseek-v4-flash-free';
const BUILDER_TIMEOUT_MS = 20_000;
const MAX_STEPS = 10;

// ── Registry snapshot for the builder ────────────────────────────────────────

type BuilderEntityInfo = {
  slug: string;
  name: string;
  kind: string;
  description: string | null;
  capabilities: string[];
  category: string | null;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
};

// Entity catalog cache (1 minute TTL) so repeated chain builds don't re-fetch
// and re-serialize the full catalog on every request.
let _catalogCache: { data: BuilderEntityInfo[]; expires: number } | null = null;
const CATALOG_TTL_MS = 60_000;

/** Force-clear the catalog cache (e.g., after entity registration). */
export function invalidateChainBuilderCache(): void {
  _catalogCache = null;
}

async function getEntityCatalog(): Promise<BuilderEntityInfo[]> {
  if (_catalogCache && Date.now() < _catalogCache.expires) {
    return _catalogCache.data;
  }

  // Admin client so chain building works from server-side automation without
  // a Supabase user session (RLS on draymond_entities allows authenticated reads).
  const supabase = createDraymondAdminClient();

  const { data, error } = await supabase
    .from('draymond_entities')
    .select(
      'slug, name, kind, description, capabilities, category, input_schema, output_schema'
    )
    .eq('is_active', true)
    .order('name');

  if (error) throw new Error(`Failed to fetch entity catalog: ${error.message}`);

  const catalog = (data || []) as BuilderEntityInfo[];
  _catalogCache = { data: catalog, expires: Date.now() + CATALOG_TTL_MS };
  return catalog;
}

// ── LLM-based chain generation ───────────────────────────────────────────────

function buildChainBuilderPrompt(catalog: BuilderEntityInfo[]): string {
  const entityDescriptions = catalog
    .map(
      (e) =>
        `  - slug: "${e.slug}", name: "${e.name}", kind: ${e.kind}, ` +
        `capabilities: [${e.capabilities.join(', ')}], ` +
        `category: ${e.category ?? 'none'}, ` +
        `description: ${(e.description ?? 'none').slice(0, 120)}, ` +
        `input_schema: ${JSON.stringify(e.input_schema).slice(0, 120)}, ` +
        `output_schema: ${JSON.stringify(e.output_schema).slice(0, 120)}`
    )
    .join('\n');

  return [
    'You are Draymond\'s chain builder. Convert the user\'s natural language description into a structured chain of entity invocations.',
    '',
    'Available entities:',
    entityDescriptions || '  (none — create steps with best-guess slugs)',
    '',
    'Rules:',
    '- Each step must reference an entity slug from the catalog above',
    '- Define input_mapping using JSONPath notation (e.g., "$.steps.step-name.output.field")',
    '- The first step can reference "$.input.field" for chain-level inputs',
    '- Steps with depends_on will execute after their dependencies',
    '- Steps without depends_on (or in the same parallel_group) can run in parallel',
    '- output_key is the key under which this step\'s output is stored',
    '',
    'Respond ONLY with valid JSON (no markdown fences):',
    '{',
    '  "name": "chain-name-slug",',
    '  "description": "Human-readable description",',
    '  "steps": [',
    '    {',
    '      "name": "step-name",',
    '      "description": "What this step does",',
    '      "entity_slug": "entity-slug",',
    '      "action": "the action to invoke",',
    '      "input_mapping": { "param": "$.input.field" },',
    '      "output_key": "step_output_name",',
    '      "depends_on": ["previous-step-name"],',
    '      "parallel_group": "group-a (optional)",',
    '      "confidence_threshold": 0.7,',
    '      "risk_level": "low|medium|high"',
    '    }',
    '  ],',
    '  "estimated_duration_ms": 5000,',
    '  "estimated_cost_cents": 10,',
    '  "confidence": 0.0-1.0,',
    '  "reasoning": "Why this chain structure was chosen",',
    '  "warnings": ["Any concerns about this chain"]',
    '}',
  ].join('\n');
}

async function generateBlueprint(
  request: ChainBuildRequest,
  catalog: BuilderEntityInfo[]
): Promise<ChainBlueprint> {
  const systemPrompt = buildChainBuilderPrompt(catalog);

  let userMessage = `Build a chain for the following user request:\n<user_request>${request.description}</user_request>`;
  if (request.constraints) {
    const c = request.constraints;
    const parts: string[] = [];
    if (c.max_steps) parts.push(`max ${c.max_steps} steps`);
    if (c.max_duration_ms) parts.push(`max ${c.max_duration_ms}ms duration`);
    if (c.max_cost_cents) parts.push(`max ${c.max_cost_cents} cents cost`);
    if (c.required_entities?.length) parts.push(`must use: ${c.required_entities.join(', ')}`);
    if (c.excluded_entities?.length) parts.push(`must NOT use: ${c.excluded_entities.join(', ')}`);
    if (c.parallel_allowed === false) parts.push('sequential only — no parallelism');
    if (parts.length > 0) userMessage += `\n<constraints>${parts.join('; ')}</constraints>`;
  }
  if (request.context) {
    userMessage += `\n<context>${JSON.stringify(request.context)}</context>`;
  }

  // Ground the chain-builder with the book library when enabled
  // (DRAYMOND_BOOK_GROUNDING=true and BookBridge reachable). Failures are
  // non-fatal — the chain still builds on the prompt alone.
  if (process.env.DRAYMOND_BOOK_GROUNDING === 'true') {
    try {
      const { groundWithBooks } = await import('../bookbridge');
      const grounding = await groundWithBooks(request.description, 3, 0.2);
      if (grounding.grounded && grounding.passages.length) {
        userMessage +=
          `\n<library_grounding>Relevant passages from the knowledge library (verify claims against these):\n` +
          grounding.passages
            .map((p) => `- [${p.book}] ${p.passage}`)
            .join('\n') +
          `\n</library_grounding>`;
      }
    } catch {
      // bookbridge offline — proceed ungrounded
    }
  }

  // Tier 0 — deterministic chain blueprint (zero-LLM) referencing real catalog
  // entities by hint-matching. Rejected downstream when no entity resolves, in
  // which case we fall through to local/paid.
  try {
    const deterministic = decomposeGoalToBlueprint(request.description, catalog);
    if (deterministic) {
      try {
        return parseBlueprintResponse(deterministic, catalog);
      } catch {
        console.warn('[chain-builder] deterministic blueprint rejected — using local/paid.');
      }
    }
  } catch {
    // deterministic unavailable — fall through
  }

  // Try the cheap local Ollama tier first; only accept it if it parses into a
  // valid blueprint referencing catalog entities. A 0.6B model often produces
  // incomplete chains, so reject anything that doesn't validate and fall back
  // to the paid provider. Mirrors the IDE's local-then-validate pattern.
  try {
    const local = await callLocalModel({
      system: systemPrompt,
      userMessage,
      maxTokens: 1500,
      responseFormat: { type: 'json_object' },
    });
    try {
      return parseBlueprintResponse(local, catalog);
    } catch {
      console.warn('[chain-builder] local blueprint invalid — using paid provider.');
    }
  } catch {
    console.warn('[chain-builder] local model unavailable — using paid provider.');
  }

  const content = await callLLM({
    provider: 'opencode-free',
    model: BUILDER_MODEL,
    system: systemPrompt,
    userMessage,
    maxTokens: 1500,
    temperature: 0.2,
    timeoutMs: BUILDER_TIMEOUT_MS,
    toonify: true,
    fallbackKey: 'chain-builder.generateBlueprint',
  });

  return parseBlueprintResponse(content, catalog);
}

function parseBlueprintResponse(
  raw: string,
  catalog: BuilderEntityInfo[]
): ChainBlueprint {
  // Strip markdown fences
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to parse chain blueprint JSON: ${stripped.slice(0, 100)}`);
  }

  const catalogSlugs = new Set(catalog.map((e) => e.slug));

  const steps: ChainBlueprintStep[] = [];
  const rawSteps = Array.isArray(obj.steps) ? (obj.steps as Array<Record<string, unknown>>) : [];

  for (const s of rawSteps.slice(0, MAX_STEPS)) {
    const rawSlug = typeof s.entity_slug === 'string' ? s.entity_slug : '';
    // Validate the entity_slug exists in the catalog; leave empty if not found
    // (validation step downstream will catch unresolved slugs)
    const entitySlug = catalogSlugs.has(rawSlug) ? rawSlug : '';

    steps.push({
      name: typeof s.name === 'string' ? s.name : `step-${steps.length + 1}`,
      description: typeof s.description === 'string' ? s.description : '',
      entity_slug: entitySlug,
      action: typeof s.action === 'string' ? s.action : 'default',
      input_mapping:
        s.input_mapping && typeof s.input_mapping === 'object'
          ? (s.input_mapping as Record<string, string>)
          : {},
      output_key: typeof s.output_key === 'string' ? s.output_key : `step_${steps.length + 1}`,
      depends_on: Array.isArray(s.depends_on) ? (s.depends_on as string[]) : [],
      parallel_group:
        typeof s.parallel_group === 'string' ? s.parallel_group : undefined,
      confidence_threshold:
        typeof s.confidence_threshold === 'number' ? s.confidence_threshold : undefined,
      risk_level: typeof s.risk_level === 'string' ? s.risk_level : undefined,
    });
  }

  // Generate slug from name
  const name = typeof obj.name === 'string' ? obj.name : 'auto-chain';
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);

  return {
    name,
    slug: `${slug}-${Date.now().toString(36)}`,
    description: typeof obj.description === 'string' ? obj.description : '',
    steps,
    estimated_duration_ms:
      typeof obj.estimated_duration_ms === 'number' ? obj.estimated_duration_ms : 0,
    estimated_cost_cents:
      typeof obj.estimated_cost_cents === 'number' ? obj.estimated_cost_cents : 0,
    confidence:
      typeof obj.confidence === 'number'
        ? Math.max(0, Math.min(1, obj.confidence))
        : 0.5,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
    warnings: Array.isArray(obj.warnings)
      ? (obj.warnings as string[]).filter((w) => typeof w === 'string')
      : [],
    generated_at: new Date().toISOString(),
  };
}

// ── Validation ───────────────────────────────────────────────────────────────

async function validateBlueprint(
  blueprint: ChainBlueprint,
  catalog: BuilderEntityInfo[]
): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
  missing_entities: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingEntities: string[] = [];

  const catalogSlugs = new Set(catalog.map((e) => e.slug));
  const stepNames = new Set(blueprint.steps.map((s) => s.name));

  if (blueprint.steps.length === 0) {
    errors.push('Chain has no steps');
  }

  // Duplicate step names make depends_on ambiguous and collide ctx.steps keys.
  const seenNames = new Set<string>();
  for (const step of blueprint.steps) {
    if (seenNames.has(step.name)) {
      errors.push(`Duplicate step name "${step.name}" — names must be unique`);
    }
    seenNames.add(step.name);
  }

  // Index steps by name to detect FORWARD dependencies: a step that depends
  // on a LATER step compiles cleanly but deterministically fails at runtime
  // ("Dependencies not met").
  const orderByName = new Map(blueprint.steps.map((s, i) => [s.name, i]));

  for (const step of blueprint.steps) {
    // Check entity exists
    if (!catalogSlugs.has(step.entity_slug)) {
      missingEntities.push(step.entity_slug);
      errors.push(
        `Step "${step.name}" references unknown entity "${step.entity_slug}"`
      );
    }

    // Check dependencies are valid
    for (const dep of step.depends_on) {
      if (!stepNames.has(dep)) {
        errors.push(
          `Step "${step.name}" depends on unknown step "${dep}"`
        );
        continue;
      }
      if (dep === step.name) {
        errors.push(`Step "${step.name}" depends on itself`);
        continue;
      }
      const depIdx = orderByName.get(dep);
      const ownIdx = orderByName.get(step.name);
      if (depIdx !== undefined && ownIdx !== undefined && depIdx >= ownIdx) {
        errors.push(
          `Step "${step.name}" (order ${ownIdx}) depends on "${dep}" (order ${depIdx}) — dependencies must appear EARLIER in the chain`
        );
      }
    }
  }

  // Check for cycles
  if (hasCycle(blueprint.steps)) {
    errors.push('Chain contains a dependency cycle');
  }

  // Add blueprint warnings
  warnings.push(...blueprint.warnings);

  if (blueprint.steps.length > 7) {
    warnings.push(`Chain has ${blueprint.steps.length} steps — consider simplifying`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missing_entities: [...new Set(missingEntities)],
  };
}

function hasCycle(steps: ChainBlueprintStep[]): boolean {
  const visited = new Set<string>();
  const inStack = new Set<string>();

  const stepMap = new Map(steps.map((s) => [s.name, s]));

  function dfs(name: string): boolean {
    if (inStack.has(name)) return true;
    if (visited.has(name)) return false;

    visited.add(name);
    inStack.add(name);

    const step = stepMap.get(name);
    if (step) {
      for (const dep of step.depends_on) {
        if (dfs(dep)) return true;
      }
    }

    inStack.delete(name);
    return false;
  }

  for (const step of steps) {
    if (dfs(step.name)) return true;
  }

  return false;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a chain from a natural language description.
 *
 * Returns a blueprint with validation results. If `autoCreate` is true and
 * validation passes, the chain is created in the database ready to execute.
 */
export async function buildChain(
  request: ChainBuildRequest,
  autoCreate: boolean = false
): Promise<ChainBuildResult> {
  const catalog = await getEntityCatalog();
  const blueprint = await generateBlueprint(request, catalog);
  const validation = await validateBlueprint(blueprint, catalog);

  let chainId: string | undefined;

  if (autoCreate && validation.valid) {
    chainId = await createChainFromBlueprint(blueprint);
  }

  // Log the build
  await logEvent({
    agent_id: 'draymond-chain-builder',
    category: 'action',
    severity: validation.valid ? 'info' : 'warning',
    event_type: 'chain_built',
    message: `Built chain "${blueprint.name}" (${blueprint.steps.length} steps, confidence: ${blueprint.confidence}) — ${validation.valid ? 'valid' : 'invalid'}`,
    metadata: {
      chain_slug: blueprint.slug,
      step_count: blueprint.steps.length,
      confidence: blueprint.confidence,
      valid: validation.valid,
      errors: validation.errors,
      auto_created: !!chainId,
    },
    reasoning: blueprint.reasoning,
  }).catch(() => {});

  return {
    blueprint,
    chain_id: chainId,
    auto_created: !!chainId,
    validation,
  };
}

/**
 * Build and immediately execute a chain from natural language.
 * Only executes if validation passes and confidence is above threshold.
 */
export async function buildAndExecuteChain(
  request: ChainBuildRequest,
  minConfidence: number = 0.7
): Promise<{
  build: ChainBuildResult;
  executed: boolean;
  execution_error?: string;
}> {
  const result = await buildChain(request, true);

  if (
    !result.validation.valid ||
    !result.chain_id ||
    result.blueprint.confidence < minConfidence
  ) {
    return {
      build: result,
      executed: false,
      execution_error: !result.validation.valid
        ? `Validation failed: ${result.validation.errors.join(', ')}`
        : result.blueprint.confidence < minConfidence
          ? `Confidence ${result.blueprint.confidence} below threshold ${minConfidence}`
          : 'Chain not created',
    };
  }

  // Chain was created — execute it
  try {
    await executeChain(result.chain_id);
    return { build: result, executed: true };
  } catch (err) {
    return {
      build: result,
      executed: false,
      execution_error: `Execution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Chain creation from blueprint ────────────────────────────────────────────

async function createChainFromBlueprint(
  blueprint: ChainBlueprint,
): Promise<string> {
  const supabase = await createDraymondClient();

  // Resolve entity IDs
  const { data: entities } = await supabase
    .from('draymond_entities')
    .select('id, slug')
    .in(
      'slug',
      blueprint.steps.map((s) => s.entity_slug)
    );

  const entityIdMap = new Map(
    ((entities || []) as Array<{ id: string; slug: string }>).map((e) => [e.slug, e.id])
  );

  // Create the chain template
  const { data: chain, error: chainError } = await supabase
    .from('draymond_chains')
    .insert({
      name: blueprint.name,
      slug: blueprint.slug,
      description: blueprint.description,
      is_template: false,
      status: 'active',
      trigger_type: 'manual',
      total_steps: blueprint.steps.length,
      max_retries: 2,
    })
    .select('id')
    .single();

  if (chainError) throw new Error(`Failed to create chain: ${chainError.message}`);

  const chainId = (chain as { id: string }).id;

  // Create steps — ensure every entity_slug resolved to an ID
  const stepInserts: DraymondChainStepInsert[] = blueprint.steps.map((step, i) => {
    const entityId = entityIdMap.get(step.entity_slug);
    if (!entityId) {
      throw new Error(
        `Step "${step.name}" references entity "${step.entity_slug}" which was not found in the registry`
      );
    }
    return {
      chain_id: chainId,
      step_order: i + 1,
      name: step.name,
      description: step.description,
      entity_id: entityId,
      action: step.action,
      input_mapping: step.input_mapping,
      output_key: step.output_key,
      depends_on_steps: step.depends_on,
      parallel_group: step.parallel_group,
      confidence_threshold: step.confidence_threshold,
      risk_level: step.risk_level ?? 'low',
      max_retries: 2,
    };
  });

  const { error: stepsError } = await supabase
    .from('draymond_chain_steps')
    .insert(stepInserts);

  if (stepsError) throw new Error(`Failed to create chain steps: ${stepsError.message}`);

  return chainId;
}
