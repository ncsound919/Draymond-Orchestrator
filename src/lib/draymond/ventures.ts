// ============================================================================
// DRAYMOND VENTURES — ABCD venture submission, money-gate, and outcome logging
// ============================================================================
// The Overlay Strategist's Venture Scout composes new ventures as chain recipes
// referencing existing entities. This module validates the recipe, classifies
// risk, creates the chain template + steps, gates execution (low/medium
// auto-run; high/critical → human review), and records outcomes to
// self-learning so future compositions improve.
// ============================================================================

import { randomBytes } from 'crypto';
import { createDraymondAdminClient } from './client';
import { getEntity } from './registry';
import { createChain, addSteps, instantiateChain, executeChain } from './chains';
import type { ActionRiskLevel, DraymondChain, DraymondChainStepInsert } from './types';
import { publishApprovalNotification } from './ntfy';
import type { DraymondAction } from './types';

export interface VentureStepInput {
  entity_slug: string;
  action: string;
  input_mapping?: Record<string, unknown>;
  output_key?: string;
  depends_on?: string[];
}

export interface VentureSubmitInput {
  name: string;
  description?: string;
  revenue_lane: 'service' | 'subscription' | 'checkout' | 'tooling';
  revenue_note?: string;
  steps: VentureStepInput[];
  risk_level?: ActionRiskLevel;
  agent_id?: string;
}

export interface VentureRecord {
  id: string;
  chain_id: string;
  name: string;
  revenue_lane: VentureSubmitInput['revenue_lane'];
  risk_level: ActionRiskLevel;
  status: 'running' | 'pending_review' | 'completed' | 'failed' | 'rejected';
  created_at: string;
}

// Keywords that escalate a step's risk. Payments are always critical.
const PAYMENT_HINTS = ['billing', 'checkout', 'purchase', 'pay', 'stripe', 'gumroad', 'charge'];
const EXTERNAL_HINTS = ['schedule_posts', 'publish', 'social', 'post', 'send_email', 'share', 'notify'];
const IRREVERSIBLE_HINTS = ['mint', 'transfer', 'deploy', 'delete', 'withdraw', 'execute_trade'];

/** Classify a venture's overall risk from its step actions. */
export function classifyVentureRisk(steps: VentureStepInput[]): ActionRiskLevel {
  for (const s of steps) {
    const a = s.action.toLowerCase();
    if (PAYMENT_HINTS.some((h) => a.includes(h))) return 'critical';
    if (EXTERNAL_HINTS.some((h) => a.includes(h)) || IRREVERSIBLE_HINTS.some((h) => a.includes(h))) return 'high';
  }
  return 'low';
}

const DIR = process.env.DRAYMOND_REGISTRY_DIR ?? process.cwd();
const RECORDS_FILE = `${DIR}/.draymond/ventures.json`;

async function readRecords(): Promise<VentureRecord[]> {
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(RECORDS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { records?: VentureRecord[] };
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

async function writeRecords(records: VentureRecord[]): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(`${DIR}/.draymond`, { recursive: true });
  await writeFile(RECORDS_FILE, JSON.stringify({ records: records.slice(-200), updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
}

export async function listVentures(): Promise<VentureRecord[]> {
  return readRecords();
}

/** Validate that every referenced entity exists and is active. */
export async function validateVentureRefs(steps: VentureStepInput[]): Promise<Map<string, string>> {
  const slugs = new Map<string, string>();
  for (const s of steps) {
    const entity = await getEntity(s.entity_slug);
    if (!entity) throw new Error(`Venture references unknown entity "${s.entity_slug}"`);
    slugs.set(s.entity_slug, entity.id);
  }
  return slugs;
}

/**
 * Create the chain template + steps for a venture.
 * Returns the created chain. Uses existing createChain + addSteps.
 */
export async function createVentureChain(input: VentureSubmitInput): Promise<DraymondChain> {
  const slug = `venture-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'venture'}`;
  const chain = await createChain({
    name: input.name,
    slug,
    description: input.description ?? input.revenue_note ?? '',
    is_template: false,
    created_by: 'overlay-strategist',
    agent_id: input.agent_id,
    status: 'draft',
    trigger_type: 'manual',
    context: { venture: true, revenue_lane: input.revenue_lane },
  });

  const idBySlug = await validateVentureRefs(input.steps);
  const steps: DraymondChainStepInsert[] = input.steps.map((s, i) => ({
    chain_id: chain.id,
    step_order: i + 1,
    name: `${s.entity_slug}:${s.action}`,
    description: `${s.entity_slug}.${s.action}`,
    entity_id: idBySlug.get(s.entity_slug)!,
    action: s.action,
    input_mapping: s.input_mapping ?? {},
    output_key: s.output_key,
    depends_on_steps: s.depends_on ?? [],
    risk_level: 'low',
  }));
  await addSteps(steps);
  return chain;
}

/** Execute a venture chain (instantiate from template id + run). */
export async function executeVentureChain(chain: DraymondChain): Promise<{ ok: boolean; detail: string }> {
  try {
    const instance = await instantiateChain(chain.slug, {}, undefined, chain.agent_id ?? undefined);
    await executeChain(instance.id, chain.agent_id ?? undefined);
    return { ok: true, detail: `venture ${chain.name} executed` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Submit a venture. Low/medium risk → create + run immediately.
 * High/critical → create chain, mint a review token, push ntfy approval,
 * return status 'pending_review'.
 */
export async function submitVenture(input: VentureSubmitInput): Promise<VentureRecord & { action_id?: string }> {
  const risk = classifyVentureRisk(input.steps);
  const chain = await createVentureChain(input);

  const record: VentureRecord = {
    id: `vn_${Date.now()}`,
    chain_id: chain.id,
    name: input.name,
    revenue_lane: input.revenue_lane,
    risk_level: risk,
    status: 'running',
    created_at: new Date().toISOString(),
  };

  if (risk === 'high' || risk === 'critical') {
    // Money-gate: queue a human-review action and push ntfy approve/reject.
    const supabase = createDraymondAdminClient();
    const reviewToken = randomBytes(32).toString('hex');
    const { data: actionRecord, error } = await supabase
      .from('draymond_actions')
      .insert({
        agent_id: input.agent_id ?? 'overlay-strategist',
        session_id: `venture-${record.id}`,
        action_type: `venture:${record.id}`,
        description: `Run venture "${input.name}" (${risk}) — ${input.revenue_lane} lane. ${input.revenue_note ?? ''}`,
        payload: { venture_id: record.id, chain_id: chain.id, steps: input.steps },
        confidence_score: 0.9,
        risk_level: risk,
        status: 'pending_review',
        requires_human_review: true,
        review_token: reviewToken,
        review_token_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(`Failed to queue venture review: ${error.message}`);

    record.status = 'pending_review';
    await writeRecords(await readRecords().then((r) => [...r, record]));

    const action = { ...(actionRecord as DraymondAction), review_token: reviewToken };
    publishApprovalNotification(action).catch(() => {});
    return { ...record, action_id: actionRecord.id };
  }

  // Low/medium — autopilot: run now.
  const outcome = await executeVentureChain(chain);
  record.status = outcome.ok ? 'completed' : 'failed';
  await writeRecords(await readRecords().then((r) => [...r, record]));

  const { recordOutcome } = await import('./self-learning');
  await recordOutcome({
    agentId: 'overlay-strategist',
    kind: 'manual',
    summary: `venture ${input.name} ${outcome.ok ? 'completed' : 'failed'}`,
    success: outcome.ok,
    detail: outcome.detail,
  }).catch(() => {});

  return record;
}
