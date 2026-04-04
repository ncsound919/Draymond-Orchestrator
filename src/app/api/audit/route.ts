import { NextRequest, NextResponse } from 'next/server';
import { readAuditLog, appendAuditLog, AuditEntry } from '@/lib/audit';

const MIN_LIMIT = 1;
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Clamp limit — reject garbage values gracefully
    const rawLimit = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
    const limit = isNaN(rawLimit)
      ? DEFAULT_LIMIT
      : Math.max(MIN_LIMIT, Math.min(rawLimit, MAX_LIMIT));

    const agent = searchParams.get('agent') ?? undefined;
    const session_id = searchParams.get('session_id') ?? undefined;
    const sinceRaw = searchParams.get('since');

    // Validate 'since' strictly — NaN must be a 400, not a silent pass-through
    let sinceTs: number | null = null;
    if (sinceRaw) {
      const parsed = new Date(sinceRaw).getTime();
      if (isNaN(parsed))
        return NextResponse.json(
          { error: "Invalid 'since' parameter — use ISO 8601 format (e.g. 2026-04-01T00:00:00Z)" },
          { status: 400 },
        );
      sinceTs = parsed;
    }

    let entries = await readAuditLog();

    if (agent) entries = entries.filter((e) => e.agent === agent);
    if (session_id) entries = entries.filter((e) => e.session_id === session_id);
    if (sinceTs !== null) {
      entries = entries.filter((e) => {
        if (!e.timestamp) return false;
        const ts = new Date(e.timestamp).getTime();
        return !isNaN(ts) && ts >= sinceTs!;
      });
    }

    const paginated = entries.slice(-limit).reverse();

    return NextResponse.json({
      entries: paginated,
      total: entries.length,
      returned: paginated.length,
      limit,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read audit log' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 },
      );

    const entry = body as Partial<AuditEntry>;
    if (
      !entry.event ||
      typeof entry.event !== 'string' ||
      !entry.event.trim()
    )
      return NextResponse.json(
        { error: 'event field is required and must be a non-empty string' },
        { status: 400 },
      );

    await appendAuditLog(entry);
    return NextResponse.json({ ok: true, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to write audit log' },
      { status: 500 },
    );
  }
}
