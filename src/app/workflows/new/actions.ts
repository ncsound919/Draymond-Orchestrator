'use server';

import { createChain, addSteps } from '@/lib/draymond/chains';
import { redirect } from 'next/navigation';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_TRIGGER_TYPES = ['manual', 'scheduled', 'api', 'webhook'] as const;
const VALID_RISK_LEVELS = ['safe', 'low', 'medium', 'high', 'critical'] as const;

type TriggerType = typeof VALID_TRIGGER_TYPES[number];
type RiskLevel = typeof VALID_RISK_LEVELS[number];

function validateWorkflowInput(formData: unknown): {
  ok: true;
  data: {
    name: string;
    slug: string;
    description: string;
    trigger_type: TriggerType;
    steps: Array<{
      name: string;
      entity_id: string;
      action: string;
      step_order: number;
      risk_level: RiskLevel;
    }>;
  };
} | { ok: false; error: string } {
  if (!formData || typeof formData !== 'object') {
    return { ok: false, error: 'Invalid input' };
  }

  const d = formData as Record<string, unknown>;

  if (!d.name || typeof d.name !== 'string' || d.name.trim().length === 0) {
    return { ok: false, error: 'Name is required' };
  }
  if (d.name.length > 200) {
    return { ok: false, error: 'Name must be 200 characters or fewer' };
  }

  if (!d.slug || typeof d.slug !== 'string' || d.slug.trim().length === 0) {
    return { ok: false, error: 'Slug is required' };
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(d.slug)) {
    return { ok: false, error: 'Slug must be lowercase alphanumeric with hyphens' };
  }
  if (d.slug.length > 100) {
    return { ok: false, error: 'Slug must be 100 characters or fewer' };
  }

  if (d.description !== undefined && typeof d.description !== 'string') {
    return { ok: false, error: 'Description must be a string' };
  }
  if (typeof d.description === 'string' && d.description.length > 2000) {
    return { ok: false, error: 'Description must be 2000 characters or fewer' };
  }

  if (!d.trigger_type || typeof d.trigger_type !== 'string') {
    return { ok: false, error: 'Trigger type is required' };
  }
  if (!VALID_TRIGGER_TYPES.includes(d.trigger_type as TriggerType)) {
    return { ok: false, error: `Invalid trigger type: ${d.trigger_type}` };
  }

  if (!Array.isArray(d.steps)) {
    return { ok: false, error: 'Steps must be an array' };
  }

  const validatedSteps = [];
  for (let i = 0; i < d.steps.length; i++) {
    const s = d.steps[i] as Record<string, unknown>;
    if (!s.name || typeof s.name !== 'string' || s.name.trim().length === 0) {
      return { ok: false, error: `Step ${i + 1}: name is required` };
    }
    if (!s.entity_id || typeof s.entity_id !== 'string') {
      return { ok: false, error: `Step ${i + 1}: entity_id is required` };
    }
    if (!s.action || typeof s.action !== 'string' || s.action.trim().length === 0) {
      return { ok: false, error: `Step ${i + 1}: action is required` };
    }
    const riskLevel = (s.risk_level as string) || 'low';
    if (!VALID_RISK_LEVELS.includes(riskLevel as RiskLevel)) {
      return { ok: false, error: `Step ${i + 1}: invalid risk level "${riskLevel}"` };
    }
    validatedSteps.push({
      name: s.name.trim(),
      entity_id: s.entity_id,
      action: s.action.trim(),
      step_order: typeof s.step_order === 'number' ? s.step_order : i + 1,
      risk_level: riskLevel as RiskLevel,
    });
  }

  return {
    ok: true,
    data: {
      name: d.name.trim(),
      slug: d.slug.trim(),
      description: typeof d.description === 'string' ? d.description.trim() : '',
      trigger_type: d.trigger_type as TriggerType,
      steps: validatedSteps,
    },
  };
}

// ---------------------------------------------------------------------------
// Server action
// ---------------------------------------------------------------------------

/**
 * Server action — create a workflow template and its steps in one shot.
 */
export async function createWorkflow(formData: {
  name: string;
  slug: string;
  description: string;
  trigger_type: string;
  steps: Array<{
    name: string;
    entity_id: string;
    action: string;
    step_order: number;
    risk_level: string;
  }>;
}) {
  // Validate input at runtime
  const validation = validateWorkflowInput(formData);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const { data } = validation;

  const chain = await createChain({
    name: data.name,
    slug: data.slug,
    description: data.description || undefined,
    is_template: true,
    status: 'draft',
    trigger_type: data.trigger_type,
  });

  if (data.steps.length > 0) {
    await addSteps(
      data.steps.map((s) => ({
        chain_id: chain.id,
        step_order: s.step_order,
        name: s.name,
        entity_id: s.entity_id,
        action: s.action,
        risk_level: s.risk_level,
      }))
    );
  }

  // redirect() must be called outside try/catch — it throws NEXT_REDIRECT
  redirect(`/workflows/${chain.id}`);
}
