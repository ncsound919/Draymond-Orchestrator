/**
 * POST /api/v1/chain-builder     — Build a chain from natural language description
 * POST /api/v1/chain-builder     — Build and optionally execute a chain
 *
 * Request body (JSON):
 *   {
 *     description: string,           — Natural language chain description
 *     constraints?: {                — Optional constraints
 *       max_steps?: number,
 *       max_duration_ms?: number,
 *       max_cost_cents?: number,
 *       required_entities?: string[],
 *       excluded_entities?: string[],
 *       parallel_allowed?: boolean,
 *     },
 *     context?: Record<string, unknown>, — Additional context for the LLM
 *     auto_execute?: boolean,         — If true, build and execute immediately
 *     min_confidence?: number,        — Min confidence to auto-execute (default 0.7)
 *   }
 *
 * Auth: Bearer token checked against CRON_SECRET env var.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { buildChain, buildAndExecuteChain } from '@/lib/draymond/chain-builder';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const bodyResult = await parseJsonBody<{
    description?: string;
    constraints?: {
      max_steps?: number;
      max_duration_ms?: number;
      max_cost_cents?: number;
      required_entities?: string[];
      excluded_entities?: string[];
      parallel_allowed?: boolean;
    };
    context?: Record<string, unknown>;
    auto_execute?: boolean;
    min_confidence?: number;
  }>(request);
  if (bodyResult.error) return bodyResult.error;

  const body = bodyResult.data;

  if (!body.description || typeof body.description !== 'string' || body.description.trim().length === 0) {
    return NextResponse.json(
      { error: 'description is required (natural language chain description)' },
      { status: 400 },
    );
  }

  const description = body.description.trim();
  if (description.length > 2000) {
    return NextResponse.json(
      { error: 'description must be 2000 characters or fewer' },
      { status: 400 },
    );
  }

  try {
    if (body.auto_execute) {
      const minConfidence = typeof body.min_confidence === 'number'
        ? Math.max(0, Math.min(1, body.min_confidence))
        : 0.7;

      const result = await buildAndExecuteChain(
        {
          description,
          constraints: body.constraints,
          context: body.context,
        },
        minConfidence,
      );

      return NextResponse.json({
        blueprint: result.build.blueprint,
        chain_id: result.build.chain_id,
        auto_created: result.build.auto_created,
        validation: result.build.validation,
        executed: result.executed,
        execution_error: result.execution_error,
      }, { status: result.executed ? 200 : 422 });
    } else {
      // Build only — don't execute, optionally auto-create in DB
      const autoCreate = true; // Always create if valid — user can execute later
      const result = await buildChain(
        {
          description,
          constraints: body.constraints,
          context: body.context,
        },
        autoCreate,
      );

      return NextResponse.json({
        blueprint: result.blueprint,
        chain_id: result.chain_id,
        auto_created: result.auto_created,
        validation: result.validation,
      }, { status: result.validation.valid ? 201 : 422 });
    }
  } catch (err) {
    console.error('[api/v1/chain-builder] POST error:', err);
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
