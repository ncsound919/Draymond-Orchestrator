import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { mathChat } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

/** POST /api/math/chat — Math X narrative answer (mode prefix + context). */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{
    messages?: Array<{ role: string; content: string }>;
    mode?: string;
    domain?: string;
    retrieved?: Array<{ source: string; text: string; score: number }>;
    execution?: { stdout?: string; error?: string };
  }>(request);
  if (parsed.error) return parsed.error;
  const { messages, mode, domain, retrieved, execution } = parsed.data;

  const clean = Array.isArray(messages)
    ? messages
        .filter(
          (m): m is { role: 'user' | 'assistant'; content: string } =>
            !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
        )
        .slice(-50)
    : [];
  if (clean.length === 0) {
    return NextResponse.json({ error: 'messages is required' }, { status: 400 });
  }

  try {
    const result = await mathChat({ messages: clean, mode, domain, retrieved, execution });
    return NextResponse.json(result);
  } catch (err) {
    return mathErrorResponse(err);
  }
}
