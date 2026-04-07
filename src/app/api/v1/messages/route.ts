// ============================================================================
// /api/v1/messages — Chat history sync (GET & POST)
// ============================================================================
// GET  — Retrieve messages for a session with cursor-based pagination
// POST — Insert one or more messages into the draymond_messages table
//
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { createDraymondAdminClient } from '@/lib/draymond/client';

export const dynamic = 'force-dynamic';

// Valid roles for message validation
const VALID_ROLES = ['user', 'assistant', 'system'] as const;
type MessageRole = (typeof VALID_ROLES)[number];

// ── GET /api/v1/messages ────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);

    const session_id = url.searchParams.get('session_id');
    if (!session_id) {
      return NextResponse.json(
        { ok: false, error: 'Missing required query param: session_id' },
        { status: 400 },
      );
    }

    // Cap limit to prevent abuse
    const limitRaw = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(500, parseInt(limitRaw ?? '100', 10) || 100));

    const before = url.searchParams.get('before');

    const supabase = createDraymondAdminClient();
    let query = supabase
      .from('draymond_messages')
      .select('*')
      .eq('session_id', session_id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: messages, error } = await query;

    if (error) throw error;

    return NextResponse.json({ ok: true, messages });
  } catch (err) {
    console.error('[API /api/v1/messages GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

// ── POST /api/v1/messages ───────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    session_id: string;
    messages: Array<{ role: string; content: string; metadata?: Record<string, unknown> }>;
  }>(request);
  if (parseError) return parseError;

  try {
    // Validate session_id
    if (!body.session_id || typeof body.session_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: session_id' },
        { status: 400 },
      );
    }

    // Validate messages array
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: messages (must be a non-empty array)' },
        { status: 400 },
      );
    }

    // Validate each message
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];

      if (!VALID_ROLES.includes(msg.role as MessageRole)) {
        return NextResponse.json(
          { ok: false, error: `messages[${i}].role must be one of: ${VALID_ROLES.join(', ')}` },
          { status: 400 },
        );
      }

      if (!msg.content || typeof msg.content !== 'string') {
        return NextResponse.json(
          { ok: false, error: `messages[${i}].content must be a non-empty string` },
          { status: 400 },
        );
      }
    }

    // Build rows for insert
    const rows = body.messages.map((msg) => ({
      session_id: body.session_id,
      role: msg.role,
      content: msg.content,
      metadata: msg.metadata ?? {},
    }));

    const supabase = createDraymondAdminClient();
    const { error } = await supabase
      .from('draymond_messages')
      .insert(rows);

    if (error) throw error;

    return NextResponse.json({ ok: true, inserted: rows.length }, { status: 201 });
  } catch (err) {
    console.error('[API /api/v1/messages POST]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
