import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { exportContent, type ExportFormat } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

const FORMATS: ExportFormat[] = ['markdown', 'latex', 'jupyter', 'plain'];

/** POST /api/math/export — format content as markdown / latex / jupyter / plain. */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{ content?: string; format?: string; title?: string; mode?: string }>(request);
  if (parsed.error) return parsed.error;
  const { content, format, title, mode } = parsed.data;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }
  const fmt = (FORMATS.includes(format as ExportFormat) ? format : 'markdown') as ExportFormat;

  try {
    const result = await exportContent(content, fmt, title, mode);
    return new Response(result.body, {
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    });
  } catch (err) {
    return mathErrorResponse(err);
  }
}
