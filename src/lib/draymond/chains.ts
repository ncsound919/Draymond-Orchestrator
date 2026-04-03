// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Chain Execution Engine
// ============================================================================
// Composable workflows: resolve step dependencies, execute in order
// (respecting parallel groups), pipe output→input between steps,
// confidence-gate each step, handle retries/failures, log to audit trail.
// ============================================================================

import { createDraymondClient } from './client';
import { logEvent, evaluateConfidence, submitAction } from './index';
import { getEntity, recordInvocation } from './registry';
import type {
  DraymondChain,
  DraymondChainInsert,
  DraymondChainStep,
  DraymondChainStepInsert,
  ChainExecutionContext,
  ChainExecutionPlanStep,
  StepStatus,
  ChainStatus,
  ActionRiskLevel,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default confidence threshold for auto-execution of chain steps (if not set per-step). */
const DEFAULT_CONFIDENCE_THRESHOLD_AUTO = 0.75;

/** Review threshold is 70% of the auto threshold (below this, the action is blocked). */
const CONFIDENCE_REVIEW_FACTOR = 0.7;

/**
 * Placeholder confidence score used when the entity executor does not return
 * an actual confidence score. Agents should override this once real scoring is implemented.
 */
const DEFAULT_ENTITY_CONFIDENCE_SCORE = 0.85;

/** Default chain execution timeout in milliseconds (5 minutes). */
const DEFAULT_CHAIN_TIMEOUT_MS = 5 * 60 * 1000;

/** Default maximum number of chains returned by listChains. */
const DEFAULT_CHAIN_LIST_LIMIT = 50;

// ============================================================================
// CHAIN CRUD
// ============================================================================

/**
 * Create a new chain (template or instance).
 */
export async function createChain(
  input: DraymondChainInsert
): Promise<DraymondChain> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_chains')
    .insert({
      name: input.name,
      slug: input.slug,
      description: input.description,
      version: input.version ?? '1.0.0',
      is_template: input.is_template ?? true,
      template_id: input.template_id,
      created_by: input.created_by,
      agent_id: input.agent_id,
      status: input.status ?? 'draft',
      trigger_type: input.trigger_type ?? 'manual',
      trigger_config: input.trigger_config ?? {},
      input_data: input.input_data ?? {},
      context: input.context ?? {},
      max_retries: input.max_retries ?? 1,
      session_id: input.session_id,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create chain "${input.slug}": ${error.message}`);
  return data as DraymondChain;
}

/**
 * Get a chain by slug or ID.
 */
export async function getChain(
  slugOrId: string
): Promise<DraymondChain | null> {
  const supabase = await createDraymondClient();

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);

  const { data, error } = await supabase
    .from('draymond_chains')
    .select('*')
    .eq(isUuid ? 'id' : 'slug', slugOrId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch chain: ${error.message}`);
  }

  return (data as DraymondChain) ?? null;
}

/**
 * List chains with optional filters.
 */
export async function listChains(filters?: {
  is_template?: boolean;
  status?: ChainStatus;
  created_by?: string;
  limit?: number;
}): Promise<DraymondChain[]> {
  const supabase = await createDraymondClient();

  let query = supabase
    .from('draymond_chains')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.is_template !== undefined) query = query.eq('is_template', filters.is_template);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.created_by) query = query.eq('created_by', filters.created_by);
  query = query.limit(filters?.limit ?? DEFAULT_CHAIN_LIST_LIMIT);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list chains: ${error.message}`);
  return (data || []) as DraymondChain[];
}

// ============================================================================
// CHAIN STEP CRUD
// ============================================================================

/**
 * Add a step to a chain.
 */
export async function addStep(
  input: DraymondChainStepInsert
): Promise<DraymondChainStep> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_chain_steps')
    .insert({
      chain_id: input.chain_id,
      step_order: input.step_order,
      name: input.name,
      description: input.description,
      entity_id: input.entity_id,
      action: input.action,
      input_mapping: input.input_mapping ?? {},
      output_key: input.output_key,
      condition: input.condition,
      depends_on_steps: input.depends_on_steps ?? [],
      parallel_group: input.parallel_group,
      confidence_threshold: input.confidence_threshold,
      risk_level: input.risk_level ?? 'low',
      max_retries: Math.min(input.max_retries ?? 2, 10),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add step: ${error.message}`);

  return data as DraymondChainStep;
}

/**
 * Add multiple steps to a chain at once.
 */
export async function addSteps(
  inputs: DraymondChainStepInsert[]
): Promise<DraymondChainStep[]> {
  if (inputs.length === 0) return [];

  const supabase = await createDraymondClient();

  const rows = inputs.map((input) => ({
    chain_id: input.chain_id,
    step_order: input.step_order,
    name: input.name,
    description: input.description,
    entity_id: input.entity_id,
    action: input.action,
    input_mapping: input.input_mapping ?? {},
    output_key: input.output_key,
    condition: input.condition,
    depends_on_steps: input.depends_on_steps ?? [],
    parallel_group: input.parallel_group,
    confidence_threshold: input.confidence_threshold,
    risk_level: input.risk_level ?? 'low',
    max_retries: Math.min(input.max_retries ?? 2, 10),
  }));

  const { data, error } = await supabase
    .from('draymond_chain_steps')
    .insert(rows)
    .select();

  if (error) throw new Error(`Failed to add steps: ${error.message}`);
  return (data || []) as DraymondChainStep[];
}

/**
 * Get all steps for a chain, ordered by step_order.
 */
export async function getChainSteps(
  chainId: string
): Promise<DraymondChainStep[]> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_chain_steps')
    .select('*')
    .eq('chain_id', chainId)
    .order('step_order');

  if (error) throw new Error(`Failed to get chain steps: ${error.message}`);
  return (data || []) as DraymondChainStep[];
}

/**
 * Get the execution plan for a chain (uses SQL function for entity joins).
 */
export async function getExecutionPlan(
  chainId: string
): Promise<ChainExecutionPlanStep[]> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .rpc('draymond_get_chain_execution_plan', { p_chain_id: chainId });

  if (error) throw new Error(`Failed to get execution plan: ${error.message}`);
  return (data || []) as ChainExecutionPlanStep[];
}

// ============================================================================
// CHAIN EXECUTION ENGINE
// ============================================================================

/**
 * Instantiate a chain template for execution.
 * Creates a copy of the template with status = 'active'.
 */
export async function instantiateChain(
  templateSlugOrId: string,
  input: Record<string, unknown>,
  createdBy?: string,
  agentId?: string
): Promise<DraymondChain> {
  const template = await getChain(templateSlugOrId);
  if (!template) throw new Error(`Chain template "${templateSlugOrId}" not found`);
  if (!template.is_template) throw new Error(`Chain "${templateSlugOrId}" is not a template`);

  // Create the instance
  const instance = await createChain({
    name: `${template.name} — Run ${new Date().toISOString().slice(0, 19)}`,
    slug: `${template.slug}-run-${Date.now()}`,
    description: template.description ?? undefined,
    version: template.version,
    is_template: false,
    template_id: template.id,
    created_by: createdBy,
    agent_id: agentId,
    status: 'active',
    trigger_type: 'api',
    input_data: input,
    context: { ...input },
    max_retries: template.max_retries,
  });

  // Copy steps from template
  const templateSteps = await getChainSteps(template.id);
  if (templateSteps.length > 0) {
    // Insert steps WITHOUT depends_on_steps first (they reference template IDs)
    const newSteps = await addSteps(
      templateSteps.map((s) => ({
        chain_id: instance.id,
        step_order: s.step_order,
        name: s.name,
        description: s.description ?? undefined,
        entity_id: s.entity_id,
        action: s.action,
        input_mapping: s.input_mapping,
        output_key: s.output_key ?? undefined,
        condition: s.condition ?? undefined,
        depends_on_steps: [], // Temporarily empty — remapped below
        parallel_group: s.parallel_group ?? undefined,
        confidence_threshold: s.confidence_threshold ?? undefined,
        risk_level: s.risk_level,
        max_retries: s.max_retries,
      }))
    );

    // Build ID remapping: template step ID → new instance step ID
    // Steps are returned in insertion order, matching templateSteps order
    const idMap = new Map<string, string>();
    for (let i = 0; i < templateSteps.length; i++) {
      idMap.set(templateSteps[i].id, newSteps[i].id);
    }

    // Remap depends_on_steps from template IDs to instance IDs
    const stepsNeedingUpdate: Array<{ id: string; depends_on_steps: string[] }> = [];
    for (let i = 0; i < templateSteps.length; i++) {
      const originalDeps = templateSteps[i].depends_on_steps;
      if (originalDeps.length > 0) {
        const remappedDeps = originalDeps
          .map((depId) => idMap.get(depId))
          .filter((id): id is string => id !== undefined);
        
        if (remappedDeps.length !== originalDeps.length) {
          console.warn(
            `[Draymond Chains] Some dependency IDs could not be remapped for step "${templateSteps[i].name}" — ` +
            `original: [${originalDeps.join(', ')}], remapped: [${remappedDeps.join(', ')}]`
          );
        }

        stepsNeedingUpdate.push({ id: newSteps[i].id, depends_on_steps: remappedDeps });
      }
    }

    // Batch update the remapped dependencies
    if (stepsNeedingUpdate.length > 0) {
      const supabaseForDeps = await createDraymondClient();
      for (const { id, depends_on_steps } of stepsNeedingUpdate) {
        const { error: depError } = await supabaseForDeps
          .from('draymond_chain_steps')
          .update({ depends_on_steps })
          .eq('id', id);
        
        if (depError) {
          console.error(`[Draymond Chains] Failed to remap dependencies for step ${id}: ${depError.message}`);
        }
      }
    }
  }

  // Update total_steps on the instance
  const supabase = await createDraymondClient();
  await supabase
    .from('draymond_chains')
    .update({ total_steps: templateSteps.length })
    .eq('id', instance.id);

  return { ...instance, total_steps: templateSteps.length };
}

/**
 * Resolve input data for a step using its input_mapping and the execution context.
 * Supports JSONPath-like references: $.input.X, $.context.X, $.steps.STEP_KEY.output.X
 */
function resolveInputMapping(
  mapping: Record<string, unknown>,
  ctx: ChainExecutionContext
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(mapping)) {
    if (typeof value === 'string' && value.startsWith('$.')) {
      resolved[key] = resolveJsonPath(value, ctx);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Simple JSONPath resolver for chain context.
 * Supports: $.input.X, $.context.X, $.steps.STEP_KEY.output.X, $.steps.STEP_KEY.input.X
 */
function resolveJsonPath(
  path: string,
  ctx: ChainExecutionContext
): unknown {
  const parts = path.replace('$.', '').split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = ctx;

  for (const part of parts) {
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') {
      return undefined;
    }
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }

  return current;
}

/**
 * Evaluate a step condition against the execution context.
 * Returns true if the step should run, false if it should be skipped.
 */
function evaluateCondition(
  condition: Record<string, unknown> | null,
  ctx: ChainExecutionContext
): boolean {
  if (!condition) return true; // No condition = always run

  const field = condition.field as string;
  const operator = condition.operator as string;
  const target = condition.value;

  if (!field || !operator) return true;

  const actual = resolveJsonPath(field, ctx);

  switch (operator) {
    case 'eq': return actual === target;
    case 'neq': return actual !== target;
    case 'gt': return (actual as number) > (target as number);
    case 'gte': return (actual as number) >= (target as number);
    case 'lt': return (actual as number) < (target as number);
    case 'lte': return (actual as number) <= (target as number);
    case 'contains': return typeof actual === 'string' && actual.includes(target as string);
    case 'exists': return actual !== undefined && actual !== null;
    case 'not_exists': return actual === undefined || actual === null;
    default:
      console.warn(`[Draymond Chains] Unknown condition operator: ${condition.operator}`);
      return false; // Fail-closed: unknown operators block execution
  }
}

/**
 * Update a step's status and timing in the database.
 * Accepts an optional pre-created client to avoid redundant connections per execution.
 */
async function updateStepStatus(
  stepId: string,
  status: StepStatus,
  extra?: {
    started_at?: string;
    completed_at?: string;
    duration_ms?: number;
    input_data?: Record<string, unknown>;
    output_data?: Record<string, unknown>;
    error_message?: string;
    retry_count?: number;
    action_id?: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any
): Promise<void> {
  const supabase = supabaseClient ?? await createDraymondClient();

  const { error } = await supabase
    .from('draymond_chain_steps')
    .update({ status, ...extra })
    .eq('id', stepId);

  if (error) {
    console.error(`[Draymond Chains] Failed to update step status: ${error.message}`);
  }
}

/**
 * Update the chain's status and metrics.
 * Accepts an optional pre-created client to avoid redundant connections per execution.
 */
async function updateChainStatus(
  chainId: string,
  status: ChainStatus,
  extra?: {
    started_at?: string;
    completed_at?: string;
    completed_steps?: number;
    failed_steps?: number;
    total_duration_ms?: number;
    output_data?: Record<string, unknown>;
    error_message?: string;
    context?: Record<string, unknown>;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any
): Promise<void> {
  const supabase = supabaseClient ?? await createDraymondClient();

  const { error } = await supabase
    .from('draymond_chains')
    .update({ status, ...extra })
    .eq('id', chainId);

  if (error) {
    console.error(`[Draymond Chains] Failed to update chain status: ${error.message}`);
  }
}

/**
 * Execute a single step within a chain.
 * This is the core atomic unit of the execution engine.
 * Accepts an optional pre-created Supabase client to avoid repeated connections.
 */
async function executeStep(
  step: DraymondChainStep,
  ctx: ChainExecutionContext,
  agentId?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any
): Promise<{
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  duration_ms: number;
}> {
  const startTime = Date.now();
  let attempt = step.retry_count;

  while (true) {
    try {
      // Mark step as running
      await updateStepStatus(step.id, 'running', {
        started_at: new Date().toISOString(),
      }, supabaseClient);

      // Resolve entity
      const entity = await getEntity(step.entity_id);
      if (!entity) {
        throw new Error(`Entity ${step.entity_id} not found in registry`);
      }
      if (!entity.is_active) {
        throw new Error(`Entity "${entity.name}" is inactive`);
      }

      // Resolve input
      const resolvedInput = Object.keys(step.input_mapping).length > 0
        ? resolveInputMapping(step.input_mapping, ctx)
        : ctx.input;

      // Update step with resolved input
      await updateStepStatus(step.id, 'running', {
        input_data: resolvedInput,
      }, supabaseClient);

      // Confidence gate check (if threshold is set)
      if (step.confidence_threshold && agentId) {
        // TODO: When entity execution returns confidence scores, use the real score here
        const confidenceScore = DEFAULT_ENTITY_CONFIDENCE_SCORE;
        const decision = evaluateConfidence(
          confidenceScore,
          (step.risk_level || 'low') as ActionRiskLevel,
          step.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD_AUTO,
          (step.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD_AUTO) * CONFIDENCE_REVIEW_FACTOR
        );

        if (decision.action === 'block') {
          await updateStepStatus(step.id, 'blocked', {
            error_message: decision.reasoning,
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
          }, supabaseClient);
          return {
            success: false,
            output: {},
            error: `Blocked by confidence gate: ${decision.reasoning}`,
            duration_ms: Date.now() - startTime,
          };
        }

        if (decision.action === 'queue_for_review') {
          // Submit as action for human review
          const { action } = await submitAction({
            agent_id: agentId,
            action_type: `chain_step:${step.action}`,
            description: `Chain step "${step.name}" requires review (entity: ${entity.name})`,
            payload: resolvedInput,
            confidence_score: confidenceScore,
            risk_level: (step.risk_level || 'low') as ActionRiskLevel,
          });

          await updateStepStatus(step.id, 'pending_review', {
            action_id: action.id,
            error_message: 'Queued for human review',
          }, supabaseClient);

          return {
            success: false,
            output: {},
            error: 'Step queued for human review',
            duration_ms: Date.now() - startTime,
          };
        }
      }

      // Execute based on invocation method
      // For now, we produce a structured invocation record.
      // Actual execution happens via the entity's invocation method.
      const output: Record<string, unknown> = {
        entity_id: entity.id,
        entity_name: entity.name,
        entity_kind: entity.kind,
        action: step.action,
        invocation_method: entity.invocation_method,
        invocation_config: entity.invocation_config,
        resolved_input: resolvedInput,
        status: 'invocation_ready',
        message: `Step "${step.name}" resolved. Entity "${entity.name}" (${entity.invocation_method}) ready for invocation with action "${step.action}".`,
      };

      // Record the invocation
      await recordInvocation(entity.id, agentId, undefined, undefined);

      const duration_ms = Date.now() - startTime;

      // Mark step completed
      await updateStepStatus(step.id, 'completed', {
        completed_at: new Date().toISOString(),
        duration_ms,
        output_data: output,
      }, supabaseClient);

      // Log audit event
      if (agentId) {
        await logEvent({
          agent_id: agentId,
          category: 'action',
          severity: 'info',
          event_type: 'chain_step_completed',
          message: `Step "${step.name}" completed (entity: ${entity.name}, action: ${step.action})`,
          metadata: {
            chain_id: ctx.chain_id,
            step_id: step.id,
            entity_id: entity.id,
            duration_ms,
          },
        });
      }

      return { success: true, output, duration_ms };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const duration_ms = Date.now() - startTime;

      // Check if we should retry (iterative — no recursion)
      if (attempt < step.max_retries) {
        try {
          await updateStepStatus(step.id, 'retrying', {
            error_message: errorMessage,
            retry_count: attempt + 1,
          }, supabaseClient);
        } catch (dbErr) {
          console.error('[Draymond Chains] Failed to update retry status:', dbErr);
        }

        // Backoff delay before next attempt
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        attempt++;
        continue; // next iteration of while loop
      }

      // Mark step as failed — wrap in try/catch to prevent unhandled rejections
      try {
        await updateStepStatus(step.id, 'failed', {
          completed_at: new Date().toISOString(),
          duration_ms,
          error_message: errorMessage,
        }, supabaseClient);
      } catch (dbErr) {
        console.error('[Draymond Chains] Failed to record step failure:', dbErr);
      }

      if (agentId) {
        try {
          await logEvent({
            agent_id: agentId,
            category: 'action',
            severity: 'error',
            event_type: 'chain_step_failed',
            message: `Step "${step.name}" failed: ${errorMessage}`,
            metadata: {
              chain_id: ctx.chain_id,
              step_id: step.id,
              duration_ms,
              retries: attempt,
            },
          });
        } catch (logErr) {
          console.error('[Draymond Chains] Failed to log step failure event:', logErr);
        }
      }

      return { success: false, output: {}, error: errorMessage, duration_ms };
    }
  }
}

/**
 * Execute a chain instance.
 * This is the main entry point for running a chain/pipeline.
 *
 * Execution strategy:
 * 1. Steps are grouped by step_order and parallel_group
 * 2. Steps with the same parallel_group execute concurrently
 * 3. Steps with depends_on_steps wait until all dependencies complete
 * 4. Conditional steps are skipped if their condition evaluates to false
 * 5. Each step's output is stored in the execution context
 * 6. The chain fails if a non-optional step fails (after retries)
 */
export async function executeChain(
  chainId: string,
  agentId?: string,
  options?: { timeout_ms?: number }
): Promise<ChainExecutionContext> {
  const chain = await getChain(chainId);
  if (!chain) throw new Error(`Chain ${chainId} not found`);
  if (chain.is_template) throw new Error(`Cannot execute a template chain. Instantiate it first.`);
  if (chain.status === 'running') throw new Error(`Chain ${chainId} is already running`);

  const steps = await getChainSteps(chainId);
  if (steps.length === 0) throw new Error(`Chain ${chainId} has no steps`);

  // Validate: detect cycles in dependency graph
  const cycles = detectCycles(steps);
  if (cycles.length > 0) {
    throw new Error(`Chain ${chainId} has dependency cycles involving: ${cycles.join(', ')}`);
  }

  // Validate: detect output_key collisions in parallel steps
  const collisions = detectOutputKeyCollisions(steps);
  if (collisions.length > 0) {
    const details = collisions.map((c) => `"${c.key}" used by [${c.steps.join(', ')}]`).join('; ');
    console.warn(`[Draymond Chains] output_key collisions in chain ${chainId}: ${details}`);
  }

  // Chain-level timeout (default 5 minutes)
  const timeoutMs = options?.timeout_ms ?? DEFAULT_CHAIN_TIMEOUT_MS;
  const chainStartTime = Date.now();

  // Single shared client for the entire chain execution — avoids one new
  // connection per status update across potentially dozens of steps.
  const supabase = await createDraymondClient();

  // Initialize execution context
  const ctx: ChainExecutionContext = {
    chain_id: chainId,
    input: chain.input_data,
    context: { ...chain.context },
    steps: {},
  };

  // Mark chain as running
  await updateChainStatus(chainId, 'running', {
    started_at: new Date().toISOString(),
    total_duration_ms: undefined,
  }, supabase);

  if (agentId) {
    await logEvent({
      agent_id: agentId,
      category: 'action',
      severity: 'info',
      event_type: 'chain_started',
      message: `Chain "${chain.name}" started with ${steps.length} steps`,
      metadata: { chain_id: chainId, total_steps: steps.length },
    });
  }

  let completedSteps = 0;
  let failedSteps = 0;
  const completedStepIds = new Set<string>();

  // Group steps by step_order for sequential execution of groups
  const stepGroups = new Map<number, DraymondChainStep[]>();
  for (const step of steps) {
    const group = stepGroups.get(step.step_order) || [];
    group.push(step);
    stepGroups.set(step.step_order, group);
  }

  // Execute step groups in order
  const sortedOrders = Array.from(stepGroups.keys()).sort((a, b) => a - b);

  for (const order of sortedOrders) {
    // Timeout check before each group
    if (Date.now() - chainStartTime > timeoutMs) {
      await updateChainStatus(chainId, 'failed', {
        completed_at: new Date().toISOString(),
        completed_steps: completedSteps,
        failed_steps: failedSteps,
        total_duration_ms: Date.now() - chainStartTime,
        error_message: `Chain timed out after ${timeoutMs}ms`,
      }, supabase);
      throw new Error(`Chain ${chainId} timed out after ${timeoutMs}ms`);
    }

    const group = stepGroups.get(order)!;

    // Within a group, further sub-group by parallel_group
    const parallelGroups = new Map<string, DraymondChainStep[]>();
    const sequentialSteps: DraymondChainStep[] = [];

    for (const step of group) {
      if (step.parallel_group) {
        const pg = parallelGroups.get(step.parallel_group) || [];
        pg.push(step);
        parallelGroups.set(step.parallel_group, pg);
      } else {
        sequentialSteps.push(step);
      }
    }

    // Execute parallel groups concurrently
    const parallelResults = await Promise.all(
      Array.from(parallelGroups.entries()).map(async ([, pgSteps]) => {
        return Promise.all(
          pgSteps.map(async (step) => {
            // Check dependencies
            const depsComplete = step.depends_on_steps.every((depId) =>
              completedStepIds.has(depId)
            );
            if (!depsComplete) {
              await updateStepStatus(step.id, 'waiting', undefined, supabase);
              return { step, success: false, skipped: true, error: 'Dependencies not met', output: {} as Record<string, unknown>, duration_ms: 0 };
            }

            // Check condition
            if (!evaluateCondition(step.condition, ctx)) {
              await updateStepStatus(step.id, 'skipped', undefined, supabase);
              return { step, success: false, skipped: true, error: undefined, output: {} as Record<string, unknown>, duration_ms: 0 };
            }

            const result = await executeStep(step, ctx, agentId, supabase);
            return { step, ...result, skipped: false };
          })
        );
      })
    );

    // Process parallel results
    for (const groupResults of parallelResults) {
      for (const result of groupResults) {
        const outputKey = result.step.output_key || `step_${result.step.step_order}`;
        if (!result.skipped) {
          ctx.steps[outputKey] = {
            status: result.success ? 'completed' : 'failed',
            input: result.step.input_data,
            output: result.output || {},
            error: result.error,
            duration_ms: result.duration_ms,
          };
          if (result.output && result.step.output_key) {
            ctx.context[result.step.output_key] = result.output;
          }
        }
        if (result.success) {
          completedSteps++;
          completedStepIds.add(result.step.id);
        } else if (!result.skipped) {
          failedSteps++;
        } else if (result.error === 'Dependencies not met') {
          failedSteps++;
        }
        // Skipped steps (condition false) are not counted as completed or failed
      }
    }

    // Execute sequential steps
    for (const step of sequentialSteps) {
      // Check dependencies
      const depsComplete = step.depends_on_steps.every((depId) =>
        completedStepIds.has(depId)
      );
      if (!depsComplete) {
        await updateStepStatus(step.id, 'waiting', undefined, supabase);
        failedSteps++;
        continue;
      }

      // Check condition
      if (!evaluateCondition(step.condition, ctx)) {
        await updateStepStatus(step.id, 'skipped', undefined, supabase);
        // Skipped steps are not completed — do not count or track as completed
        continue;
      }

      const result = await executeStep(step, ctx, agentId, supabase);
      const outputKey = step.output_key || `step_${step.step_order}`;

      ctx.steps[outputKey] = {
        status: result.success ? 'completed' : 'failed',
        input: step.input_data,
        output: result.output,
        error: result.error,
        duration_ms: result.duration_ms,
      };

      if (result.output && step.output_key) {
        ctx.context[step.output_key] = result.output;
      }

      if (result.success) {
        completedSteps++;
        completedStepIds.add(step.id);
      } else {
        failedSteps++;
        // If a sequential step fails, we could stop the chain
        // For now we continue to give maximum output
      }
    }

    // Update chain progress after each group
    await updateChainStatus(chainId, 'running', {
      completed_steps: completedSteps,
      failed_steps: failedSteps,
      context: ctx.context,
    }, supabase);
  }

  // Finalize chain
  const totalDuration = Date.now() - chainStartTime;
  const finalStatus: ChainStatus =
    failedSteps > 0 ? 'failed' : 'completed';

  await updateChainStatus(chainId, finalStatus, {
    completed_at: new Date().toISOString(),
    completed_steps: completedSteps,
    failed_steps: failedSteps,
    total_duration_ms: totalDuration,
    output_data: ctx.context,
    context: ctx.context,
    error_message:
      failedSteps > 0
        ? `${failedSteps} of ${steps.length} steps failed`
        : undefined,
  }, supabase);

  if (agentId) {
    await logEvent({
      agent_id: agentId,
      category: 'action',
      severity: failedSteps > 0 ? 'warning' : 'info',
      event_type: `chain_${finalStatus}`,
      message: `Chain "${chain.name}" ${finalStatus}: ${completedSteps}/${steps.length} steps completed, ${failedSteps} failed`,
      metadata: {
        chain_id: chainId,
        total_steps: steps.length,
        completed_steps: completedSteps,
        failed_steps: failedSteps,
        total_duration_ms: totalDuration,
      },
    });
  }

  return ctx;
}

// ============================================================================
// CHAIN VALIDATION UTILITIES
// ============================================================================

/**
 * Detect cycles in the dependency graph of chain steps.
 * Returns an array of step names involved in cycles, or empty if no cycles.
 */
export function detectCycles(steps: DraymondChainStep[]): string[] {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycleSteps: string[] = [];

  function dfs(stepId: string): boolean {
    if (inStack.has(stepId)) return true; // cycle detected
    if (visited.has(stepId)) return false;

    visited.add(stepId);
    inStack.add(stepId);

    const step = stepMap.get(stepId);
    if (step) {
      for (const depId of step.depends_on_steps) {
        if (dfs(depId)) {
          const depStep = stepMap.get(depId);
          cycleSteps.push(depStep?.name || depId);
          return true;
        }
      }
    }

    inStack.delete(stepId);
    return false;
  }

  for (const step of steps) {
    if (!visited.has(step.id) && dfs(step.id)) {
      cycleSteps.push(step.name);
    }
  }

  return cycleSteps;
}

/**
 * Detect output_key collisions among steps that share the same step_order
 * (parallel steps). Returns pairs of conflicting step names.
 */
export function detectOutputKeyCollisions(
  steps: DraymondChainStep[]
): Array<{ key: string; steps: string[] }> {
  const collisions: Array<{ key: string; steps: string[] }> = [];
  const groups = new Map<number, DraymondChainStep[]>();

  for (const step of steps) {
    const group = groups.get(step.step_order) || [];
    group.push(step);
    groups.set(step.step_order, group);
  }

  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    const keyMap = new Map<string, string[]>();
    for (const step of group) {
      const key = step.output_key || `step_${step.step_order}`;
      const existing = keyMap.get(key) || [];
      existing.push(step.name);
      keyMap.set(key, existing);
    }
    for (const [key, names] of keyMap) {
      if (names.length > 1) {
        collisions.push({ key, steps: names });
      }
    }
  }

  return collisions;
}

// ============================================================================
// CHAIN UTILITIES
// ============================================================================

/**
 * Delete a chain and all its steps (cascade).
 */
export async function deleteChain(chainId: string): Promise<void> {
  const supabase = await createDraymondClient();

  const { error } = await supabase
    .from('draymond_chains')
    .delete()
    .eq('id', chainId);

  if (error) throw new Error(`Failed to delete chain: ${error.message}`);
}

/**
 * Get chain execution summary (for dashboard display).
 */
export async function getChainSummary(chainId: string): Promise<{
  chain: DraymondChain;
  steps: DraymondChainStep[];
  plan: ChainExecutionPlanStep[];
}> {
  const chain = await getChain(chainId);
  if (!chain) throw new Error(`Chain ${chainId} not found`);

  const [steps, plan] = await Promise.all([
    getChainSteps(chainId),
    getExecutionPlan(chainId),
  ]);

  return { chain, steps, plan };
}
