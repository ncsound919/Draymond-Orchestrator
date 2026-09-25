// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Chain Step Input Schemas
// ============================================================================
// Schema-validates chain step inputs BEFORE invocation (industry pattern:
// Trigger.dev schemaTask, CrewAI output_pydantic, OpenClaw TypeBox RPC
// validation). Registered (entitySlug, action) → zod schema. A step whose
// resolved input violates its schema is rejected with a clear "field — reason"
// error instead of burning a failed HTTP round-trip (e.g. the Full Content
// Creation 422 "Field required: prompt" storm).
//
// Validation is opt-in: entities without a registered schema pass through
// unchanged. See plans/ecosystem-intel-implementation.md Step 3.
// ============================================================================

import { z } from 'zod';

type StepSchema = z.ZodObject<z.ZodRawShape>;

const SCHEMAS = new Map<string, StepSchema>();

function register(entitySlug: string, action: string, schema: StepSchema): void {
  SCHEMAS.set(`${entitySlug}/${action}`, schema);
}

// -- Known offenders ----------------------------------------------------------

// Text generation must receive a non-empty topic; image generation a non-empty
// prompt; scheduling non-empty text. These guard the overlay marketing action
// bridge (SMD decommissioned 2026-09-24).
register(
  'overlay-marketing-actions',
  'generate_text',
  z.object({ topic: z.string().min(1, 'topic is required') }),
);
register(
  'overlay-marketing-actions',
  'generate_image',
  z.object({ prompt: z.string().min(1, 'prompt is required') }),
);
register(
  'overlay-marketing-actions',
  'schedule_posts',
  z.object({ text: z.string().min(1, 'text is required') }),
);
register(
  'generative-video-ai',
  'generate_image',
  z.object({ prompt: z.string().min(1, 'prompt is required') }),
);

// -- Lookup + validation ------------------------------------------------------

export function getStepSchema(entitySlug: string, action: string): StepSchema | undefined {
  return SCHEMAS.get(`${entitySlug}/${action}`);
}

export type StepInputCheck = { ok: true } | { ok: false; error: string };

/**
 * Validate a RESOLVED step input (after `input_mapping` is resolved against
 * chain context) against the registered schema. Unknown (entitySlug, action)
 * combos pass — this is opt-in.
 */
export function validateStepInput(
  entitySlug: string,
  action: string,
  input: unknown
): StepInputCheck {
  const schema = getStepSchema(entitySlug, action);
  if (!schema) return { ok: true };

  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.length ? issue.path.join('.') : 'input';
    const reason = issue?.message ?? 'invalid';
    return {
      ok: false,
      error: `Schema violation for ${entitySlug}/${action}: field "${path}" — ${reason}`,
    };
  }
  return { ok: true };
}

/**
 * Structural guard for an `input_mapping` at enqueue/definition time, before
 * `$` references resolve: every field required by the schema must appear as a
 * key in the mapping. Resolves entity_id → slug via the registry (best-effort;
 * skips when the entity cannot be resolved).
 */
export async function validateInputMapping(
  entityId: string,
  action: string,
  inputMapping: Record<string, unknown>
): Promise<StepInputCheck> {
  try {
    const { getEntity } = await import('./registry');
    const entity = await getEntity(entityId);
    if (!entity) return { ok: true };
    const schema = getStepSchema(entity.slug, action);
    if (!schema) return { ok: true };

    const requiredKeys = Object.keys(schema.shape);
    for (const key of requiredKeys) {
      if (!(key in inputMapping)) {
        return {
          ok: false,
          error: `Missing required field in input_mapping for ${entity.slug}/${action}: "${key}"`,
        };
      }
    }
    return { ok: true };
  } catch {
    return { ok: true }; // best-effort — never block chain creation on a lookup error
  }
}
