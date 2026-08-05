// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Unified Entity Registry Service
// ============================================================================
// CRUD operations, search, dependency resolution, and relation management
// for every agent, tool, skill, extension, MCP server, and service
// in the Uplift Lab ecosystem.
// ============================================================================

import { createDraymondAdminClient, createDraymondClient } from './client';
import { logEvent } from './index';
import type {
  DraymondEntity,
  DraymondEntityInsert,
  DraymondEntityRelation,
  DraymondEntityRelationInsert,
  EntitySearchFilters,
  EntityKind,
} from './types';

// ============================================================================
// ENTITY CRUD
// ============================================================================

/**
 * Register a new entity in the unified registry.
 */
export async function registerEntity(
  input: DraymondEntityInsert
): Promise<DraymondEntity> {
  if (!input.slug || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(input.slug)) {
    throw new Error(`Invalid slug "${input.slug}": must be lowercase alphanumeric with hyphens, min 2 chars`);
  }
  if (!input.name?.trim()) {
    throw new Error('Entity name is required');
  }

  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_entities')
    .upsert(
      {
        name: input.name,
        slug: input.slug,
        kind: input.kind,
        description: input.description,
        version: input.version ?? '1.0.0',
        icon_url: input.icon_url,
        tags: input.tags ?? [],
        category: input.category,
        sector: input.sector,
        invocation_method: input.invocation_method ?? 'internal',
        invocation_config: input.invocation_config ?? {},
        capabilities: input.capabilities ?? [],
        input_schema: input.input_schema ?? {},
        output_schema: input.output_schema ?? {},
        depends_on: input.depends_on ?? [],
        source_type: input.source_type,
        source_url: input.source_url,
        download_path: input.download_path,
        is_free: input.is_free ?? true,
        price_cents: input.price_cents,
        stripe_link: input.stripe_link,
        is_integrated: input.is_integrated ?? false,
        platform_page: input.platform_page,
        linked_agent_id: input.linked_agent_id,
        confidence_threshold_override: input.confidence_threshold_override,
        risk_level_default: input.risk_level_default ?? 'low',
        max_retries: input.max_retries ?? 2,
        timeout_seconds: input.timeout_seconds ?? 300,
        is_active: input.is_active ?? true,
        health_status: input.health_status ?? 'unknown',
      },
      { onConflict: 'slug', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to register entity "${input.slug}": ${error.message}`);

  return data as DraymondEntity;
}

/**
 * Register multiple entities at once (batch upsert).
 */
export async function registerEntities(
  inputs: DraymondEntityInsert[]
): Promise<{ registered: number; errors: string[] }> {
  const errors: string[] = [];
  let registered = 0;

  // Process in batches of 20 to avoid overwhelming the DB
  const batchSize = 20;
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((input) => registerEntity(input))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === 'fulfilled') {
        registered++;
      } else {
        errors.push(`[${batch[j].slug}] ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}`);
      }
    }
  }

  return { registered, errors };
}

/**
 * Get a single entity by slug or ID.
 */
export async function getEntity(
  slugOrId: string
): Promise<DraymondEntity | null> {
  // Admin client so server-side automation (orchestrate, chain executor) can
  // resolve entities without a Supabase user session — the draymond_entities
  // RLS policy only allows reads for authenticated users.
  const supabase = createDraymondAdminClient();

  // Try by slug first, then by ID
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);

  const { data, error } = await supabase
    .from('draymond_entities')
    .select('*')
    .eq(isUuid ? 'id' : 'slug', slugOrId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch entity: ${error.message}`);
  }

  return (data as DraymondEntity) ?? null;
}

/**
 * Update an existing entity.
 */
export async function updateEntity(
  id: string,
  updates: Partial<DraymondEntityInsert>
): Promise<DraymondEntity> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_entities')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update entity ${id}: ${error.message}`);
  return data as DraymondEntity;
}

/**
 * Deactivate an entity (soft delete).
 */
export async function deactivateEntity(id: string): Promise<void> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_entities')
    .update({ is_active: false })
    .eq('id', id)
    .select('id')
    .single();

  if (error) throw new Error(`Failed to deactivate entity: ${error.message}`);
  if (!data) throw new Error(`Entity ${id} not found`);
}

// ============================================================================
// ENTITY SEARCH & DISCOVERY
// ============================================================================

/**
 * Search entities with flexible filters.
 */
export async function searchEntities(
  filters: EntitySearchFilters = {}
): Promise<DraymondEntity[]> {
  const supabase = await createDraymondClient();

  let query = supabase
    .from('draymond_entities')
    .select('*')
    .order('kind')
    .order('name');

  if (filters.kind) query = query.eq('kind', filters.kind);
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.sector) query = query.eq('sector', filters.sector);
  if (filters.is_integrated !== undefined) query = query.eq('is_integrated', filters.is_integrated);
  if (filters.is_active !== undefined) query = query.eq('is_active', filters.is_active);
  if (filters.capability) query = query.contains('capabilities', [filters.capability]);
  if (filters.tag) query = query.contains('tags', [filters.tag]);
  if (filters.search) {
    // Sanitize PostgREST metacharacters to prevent filter injection
    const sanitized = filters.search.replace(/[%_.,()]/g, '');
    if (sanitized.length > 0) {
      query = query.or(
        `name.ilike.%${sanitized}%,description.ilike.%${sanitized}%,slug.ilike.%${sanitized}%`
      );
    }
  }
  if (filters.offset !== undefined) {
    const lim = filters.limit ?? 50;
    query = query.range(filters.offset, filters.offset + lim - 1);
  } else if (filters.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to search entities: ${error.message}`);
  return (data || []) as DraymondEntity[];
}

/**
 * Find all entities that can perform a specific capability.
 */
export async function findByCapability(
  capability: string
): Promise<DraymondEntity[]> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_entities')
    .select('*')
    .contains('capabilities', [capability])
    .eq('is_active', true)
    .order('kind')
    .order('name');

  if (error) throw new Error(`Failed to find entities by capability: ${error.message}`);
  return (data || []) as DraymondEntity[];
}

/**
 * Get entity counts grouped by kind.
 */
export async function getEntityCounts(): Promise<Record<EntityKind, number>> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_entities')
    .select('kind')
    .eq('is_active', true);

  if (error) throw new Error(`Failed to get entity counts: ${error.message}`);

  const counts: Record<string, number> = {
    agent: 0,
    tool: 0,
    skill: 0,
    extension: 0,
    mcp_server: 0,
    service: 0,
    pipeline: 0,
  };

  for (const row of (data || []) as Array<{ kind: string }>) {
    counts[row.kind] = (counts[row.kind] || 0) + 1;
  }

  return counts as Record<EntityKind, number>;
}

/**
 * Get all unique capabilities across all active entities.
 */
export async function getAllCapabilities(): Promise<string[]> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_entities')
    .select('capabilities')
    .eq('is_active', true);

  if (error) throw new Error(`Failed to get capabilities: ${error.message}`);

  const capSet = new Set<string>();
  for (const row of (data || []) as Array<{ capabilities: string[] }>) {
    for (const cap of (row.capabilities ?? [])) {
      capSet.add(cap);
    }
  }

  return Array.from(capSet).sort();
}

// ============================================================================
// ENTITY RELATIONS
// ============================================================================

/**
 * Create a relation between two entities.
 */
export async function createRelation(
  input: DraymondEntityRelationInsert
): Promise<DraymondEntityRelation> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_entity_relations')
    .upsert(
      {
        source_entity_id: input.source_entity_id,
        target_entity_id: input.target_entity_id,
        relation_type: input.relation_type,
        metadata: input.metadata ?? {},
      },
      { onConflict: 'source_entity_id,target_entity_id,relation_type' }
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to create relation: ${error.message}`);
  return data as DraymondEntityRelation;
}

/**
 * Get all relations for an entity (both incoming and outgoing).
 */
export async function getEntityRelations(
  entityId: string
): Promise<{ outgoing: DraymondEntityRelation[]; incoming: DraymondEntityRelation[] }> {
  const supabase = await createDraymondClient();

  const [outResult, inResult] = await Promise.all([
    supabase
      .from('draymond_entity_relations')
      .select('*')
      .eq('source_entity_id', entityId),
    supabase
      .from('draymond_entity_relations')
      .select('*')
      .eq('target_entity_id', entityId),
  ]);

  if (outResult.error) throw new Error(`Failed to fetch outgoing relations: ${outResult.error.message}`);
  if (inResult.error) throw new Error(`Failed to fetch incoming relations: ${inResult.error.message}`);

  return {
    outgoing: (outResult.data || []) as DraymondEntityRelation[],
    incoming: (inResult.data || []) as DraymondEntityRelation[],
  };
}

// ============================================================================
// DEPENDENCY RESOLUTION
// ============================================================================

/**
 * Resolve all transitive dependencies for an entity.
 * Returns a flat list of all entities this one depends on (direct + transitive).
 */
export async function resolveDependencies(
  entityId: string,
  visited: Set<string> = new Set()
): Promise<DraymondEntity[]> {
  if (visited.has(entityId)) return []; // Prevent cycles
  visited.add(entityId);

  const supabase = await createDraymondClient();

  const { data: entity, error } = await supabase
    .from('draymond_entities')
    .select('depends_on')
    .eq('id', entityId)
    .single();

  if (error) {
    console.error(`[Draymond Registry] Failed to resolve deps for ${entityId}: ${error.message}`);
    return [];
  }

  if (!entity) return [];

  const depIds = (entity as { depends_on: string[] }).depends_on || [];
  if (depIds.length === 0) return [];

  const { data: deps, error: depsError } = await supabase
    .from('draymond_entities')
    .select('*')
    .in('id', depIds);

  if (depsError) {
    console.error(`[Draymond Registry] Failed to fetch deps for ${entityId}: ${depsError.message}`);
    return [];
  }

  const directDeps = (deps || []) as DraymondEntity[];

  // Recursively resolve transitive dependencies
  const transitiveDeps: DraymondEntity[] = [];
  for (const dep of directDeps) {
    const nested = await resolveDependencies(dep.id, visited);
    transitiveDeps.push(...nested);
  }

  const allDeps = [...directDeps, ...transitiveDeps];
  const seen = new Set<string>();
  return allDeps.filter(d => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}

/**
 * Check if all dependencies for an entity are satisfied (active & healthy).
 */
export async function checkDependencyHealth(
  entityId: string
): Promise<{ satisfied: boolean; missing: string[]; unhealthy: string[] }> {
  const deps = await resolveDependencies(entityId);
  const missing: string[] = [];
  const unhealthy: string[] = [];

  for (const dep of deps) {
    if (!dep.is_active) {
      missing.push(`${dep.name} (${dep.slug}) — inactive`);
    } else if (dep.health_status === 'offline' || dep.health_status === 'degraded') {
      unhealthy.push(`${dep.name} (${dep.slug}) — ${dep.health_status}`);
    }
  }

  return {
    satisfied: missing.length === 0 && unhealthy.length === 0,
    missing,
    unhealthy,
  };
}

// ============================================================================
// REGISTRY STATS (for dashboard)
// ============================================================================

/**
 * Get comprehensive registry statistics.
 */
export async function getRegistryStats(): Promise<{
  total: number;
  by_kind: Record<EntityKind, number>;
  integrated: number;
  capabilities_count: number;
  free_count: number;
  paid_count: number;
}> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_entities')
    .select('kind, is_integrated, is_free, capabilities')
    .eq('is_active', true);

  if (error) throw new Error(`Failed to get registry stats: ${error.message}`);

  const rows = (data || []) as Array<{
    kind: EntityKind;
    is_integrated: boolean;
    is_free: boolean;
    capabilities: string[];
  }>;

  const by_kind: Record<string, number> = {
    agent: 0, tool: 0, skill: 0, extension: 0,
    mcp_server: 0, service: 0, pipeline: 0,
  };

  const capSet = new Set<string>();
  let integrated = 0;
  let free_count = 0;
  let paid_count = 0;

  for (const row of rows) {
    by_kind[row.kind] = (by_kind[row.kind] || 0) + 1;
    if (row.is_integrated) integrated++;
    if (row.is_free) free_count++;
    else paid_count++;
    for (const cap of (row.capabilities ?? [])) capSet.add(cap);
  }

  return {
    total: rows.length,
    by_kind: by_kind as Record<EntityKind, number>,
    integrated,
    capabilities_count: capSet.size,
    free_count,
    paid_count,
  };
}

// ============================================================================
// ENTITY INVOCATION TRACKING
// ============================================================================

/**
 * Record that an entity was invoked (updates last_invoked_at).
 * Also logs an audit event.
 */
export async function recordInvocation(
  entityId: string,
  agentId?: string,
  sessionId?: string,
  userId?: string
): Promise<void> {
  const supabase = await createDraymondClient();

  const { error } = await supabase
    .from('draymond_entities')
    .update({ last_invoked_at: new Date().toISOString() })
    .eq('id', entityId);

  if (error) {
    console.error(`[Draymond Registry] Failed to record invocation for ${entityId}: ${error.message}`);
  }

  if (agentId) {
    try {
      await logEvent({
        agent_id: agentId,
        session_id: sessionId,
        user_id: userId,
        category: 'action',
        severity: 'info',
        event_type: 'entity_invoked',
        message: `Entity ${entityId} invoked`,
        metadata: { entity_id: entityId },
      });
    } catch (logErr) {
      console.error('[Draymond Registry] Failed to log invocation event:', logErr);
    }
  }
}
