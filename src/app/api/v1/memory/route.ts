/**
 * POST /api/v1/memory/search     — Search memories using multi-strategy matching
 * GET  /api/v1/memory/search     — Get shared memories or memory insights
 * POST /api/v1/memory/share      — Grant memory access to another agent
 * POST /api/v1/memory/revoke     — Revoke memory access
 * POST /api/v1/memory/decay      — Trigger a memory decay sweep
 *
 * Auth: Bearer token checked against CRON_SECRET env var.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError, requireValidIds } from '@/lib/draymond/api-auth';
import {
  searchMemories,
  getSharedMemories,
  grantMemoryAccess,
  revokeMemoryAccess,
  getMemoryInsights,
  runDecaySweep,
} from '@/lib/draymond/memory-intelligence';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const view = url.searchParams.get('view') ?? 'insights';
    const agentId = url.searchParams.get('agent_id');

    if (!agentId) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }

    // Validate ID formats before passing to database
    const badId = requireValidIds({ agent_id: agentId });
    if (badId) return badId;

    switch (view) {
      case 'insights': {
        const insights = await getMemoryInsights(agentId);
        return NextResponse.json({ insights });
      }

      case 'shared': {
        const userId = url.searchParams.get('user_id');
        if (!userId) {
          return NextResponse.json({ error: 'user_id is required for shared view' }, { status: 400 });
        }
        const ownerAgentId = url.searchParams.get('owner_agent_id') ?? undefined;

        // Validate ID formats
        const badSharedId = requireValidIds({ user_id: userId, owner_agent_id: ownerAgentId });
        if (badSharedId) return badSharedId;

        const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 100);
        const memories = await getSharedMemories(agentId, userId, ownerAgentId, limit);
        return NextResponse.json({ memories, total: memories.length });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid view. Must be insights or shared.' },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error('[api/v1/memory] GET error:', err);
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const bodyResult = await parseJsonBody<{
    action?: string;
    // search params
    agent_id?: string;
    user_id?: string;
    query?: string;
    limit?: number;
    include_expired?: boolean;
    min_importance?: number;
    tiers?: string[];
    // share params
    memory_id?: string;
    owner_agent_id?: string;
    granted_agent_id?: string;
    permission?: string;
    expires_at?: string;
  }>(request);
  if (bodyResult.error) return bodyResult.error;

  const body = bodyResult.data;
  const action = body.action ?? 'search';

  try {
    switch (action) {
      case 'search': {
        if (!body.agent_id) {
          return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
        }
        if (!body.user_id) {
          return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
        }
        if (!body.query || typeof body.query !== 'string') {
          return NextResponse.json({ error: 'query is required' }, { status: 400 });
        }

        // Validate ID formats before database queries
        const badSearchId = requireValidIds({ agent_id: body.agent_id, user_id: body.user_id });
        if (badSearchId) return badSearchId;

        const results = await searchMemories(body.agent_id, body.user_id, body.query, {
          limit: body.limit,
          include_expired: body.include_expired,
          min_importance: body.min_importance,
          tiers: body.tiers as ('core' | 'important' | 'contextual' | 'ephemeral')[] | undefined,
        });

        return NextResponse.json({ results, total: results.length });
      }

      case 'share': {
        if (!body.memory_id || !body.owner_agent_id || !body.granted_agent_id) {
          return NextResponse.json(
            { error: 'memory_id, owner_agent_id, and granted_agent_id are required' },
            { status: 400 },
          );
        }

        // Validate ID formats
        const badShareId = requireValidIds({
          memory_id: body.memory_id,
          owner_agent_id: body.owner_agent_id,
          granted_agent_id: body.granted_agent_id,
        });
        if (badShareId) return badShareId;

        const validPermissions = ['read', 'read_write'];
        const permission = body.permission ?? 'read';
        if (!validPermissions.includes(permission)) {
          return NextResponse.json(
            { error: `permission must be one of: ${validPermissions.join(', ')}` },
            { status: 400 },
          );
        }

        const grant = await grantMemoryAccess({
          memory_id: body.memory_id,
          owner_agent_id: body.owner_agent_id,
          granted_agent_id: body.granted_agent_id,
          permission: permission as 'read' | 'read_write',
          expires_at: body.expires_at,
        });

        return NextResponse.json({ grant }, { status: 201 });
      }

      case 'revoke': {
        if (!body.memory_id || !body.owner_agent_id || !body.granted_agent_id) {
          return NextResponse.json(
            { error: 'memory_id, owner_agent_id, and granted_agent_id are required' },
            { status: 400 },
          );
        }

        // Validate ID formats
        const badRevokeId = requireValidIds({
          memory_id: body.memory_id,
          owner_agent_id: body.owner_agent_id,
          granted_agent_id: body.granted_agent_id,
        });
        if (badRevokeId) return badRevokeId;

        await revokeMemoryAccess(body.memory_id, body.owner_agent_id, body.granted_agent_id);
        return NextResponse.json({ success: true });
      }

      case 'decay': {
        const result = await runDecaySweep();
        return NextResponse.json({ result });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Must be search, share, revoke, or decay.' },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error('[api/v1/memory] POST error:', err);
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
