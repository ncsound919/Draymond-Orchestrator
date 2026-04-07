/**
 * POST /api/v1/subscriptions     — Create a new event subscription
 * GET  /api/v1/subscriptions     — List all subscriptions
 * PUT  /api/v1/subscriptions     — Toggle a subscription's active state
 * DELETE /api/v1/subscriptions   — Delete a subscription
 *
 * POST body:
 *   { name, description?, pattern: { event_type, conditions?, debounce_ms? },
 *     action_type: invoke_entity|execute_chain|emit_event|webhook,
 *     action_config: { entity_slug?, chain_slug?, event_type?, webhook_url?, input_mapping? },
 *     created_by? }
 *
 * PUT body:
 *   { subscription_id, is_active: boolean }
 *
 * DELETE body:
 *   { subscription_id }
 *
 * GET query params:
 *   active_only — boolean (default false)
 *
 * Auth: Bearer token checked against CRON_SECRET env var.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError, requireValidIds } from '@/lib/draymond/api-auth';
import {
  createSubscription,
  listSubscriptions,
  toggleSubscription,
  deleteSubscription,
} from '@/lib/draymond/reactive';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const activeOnly = url.searchParams.get('active_only') === 'true';
    const subscriptions = await listSubscriptions(activeOnly);
    return NextResponse.json({ subscriptions, total: subscriptions.length });
  } catch (err) {
    console.error('[api/v1/subscriptions] GET error:', err);
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const bodyResult = await parseJsonBody<{
    name?: string;
    description?: string;
    pattern?: {
      event_type?: string;
      conditions?: Record<string, unknown>;
      debounce_ms?: number;
    };
    action_type?: string;
    action_config?: Record<string, unknown>;
    created_by?: string;
  }>(request);
  if (bodyResult.error) return bodyResult.error;

  const body = bodyResult.data;

  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  if (!body.pattern?.event_type) {
    return NextResponse.json(
      { error: 'pattern.event_type is required' },
      { status: 400 },
    );
  }

  const validActions = ['invoke_entity', 'execute_chain', 'emit_event', 'webhook'];
  if (!body.action_type || !validActions.includes(body.action_type)) {
    return NextResponse.json(
      { error: `action_type must be one of: ${validActions.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const subscription = await createSubscription({
      name: body.name,
      description: body.description,
      pattern: {
        event_type: body.pattern.event_type,
        conditions: body.pattern.conditions,
        debounce_ms: body.pattern.debounce_ms,
      },
      action_type: body.action_type as 'invoke_entity' | 'execute_chain' | 'emit_event' | 'webhook',
      action_config: body.action_config ?? {},
      created_by: body.created_by,
    });

    return NextResponse.json({ subscription }, { status: 201 });
  } catch (err) {
    console.error('[api/v1/subscriptions] POST error:', err);
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const bodyResult = await parseJsonBody<{
    subscription_id?: string;
    is_active?: boolean;
  }>(request);
  if (bodyResult.error) return bodyResult.error;

  const body = bodyResult.data;

  if (!body.subscription_id || typeof body.subscription_id !== 'string') {
    return NextResponse.json({ error: 'subscription_id is required' }, { status: 400 });
  }
  if (typeof body.is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active (boolean) is required' }, { status: 400 });
  }

  // Validate ID format before passing to database
  const badId = requireValidIds({ subscription_id: body.subscription_id });
  if (badId) return badId;

  try {
    await toggleSubscription(body.subscription_id, body.is_active);
    return NextResponse.json({ success: true, subscription_id: body.subscription_id, is_active: body.is_active });
  } catch (err) {
    console.error('[api/v1/subscriptions] PUT error:', err);
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const bodyResult = await parseJsonBody<{
    subscription_id?: string;
  }>(request);
  if (bodyResult.error) return bodyResult.error;

  const body = bodyResult.data;

  if (!body.subscription_id || typeof body.subscription_id !== 'string') {
    return NextResponse.json({ error: 'subscription_id is required' }, { status: 400 });
  }

  // Validate ID format before passing to database
  const badId = requireValidIds({ subscription_id: body.subscription_id });
  if (badId) return badId;

  try {
    await deleteSubscription(body.subscription_id);
    return NextResponse.json({ success: true, deleted: body.subscription_id });
  } catch (err) {
    console.error('[api/v1/subscriptions] DELETE error:', err);
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
