import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { newsDigest, renderNewsDigest } from '@/lib/draymond/news';

export const dynamic = 'force-dynamic';

/** GET /api/ops/news?tag=health|wealth|justice|business|ai|callcenter */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const tag = new URL(request.url).searchParams.get('tag') ?? undefined;
  const { items, updatedAt } = await newsDigest(tag);
  return NextResponse.json({ count: items.length, updatedAt, items, markdown: renderNewsDigest(items.slice(0, 10)) });
}
