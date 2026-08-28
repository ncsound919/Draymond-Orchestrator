import { subscribeToStream } from '@/lib/draymond/event-bridge';
import type { StreamSubscriber } from '@/lib/draymond/event-bridge';
import { requireDraymondAuth } from '@/lib/draymond/auth';

export interface SseEnvelope {
  type: string;
  data: Record<string, unknown>;
  ts: string;
}

export function encodeSse(env: SseEnvelope): string {
  return `data: ${JSON.stringify(env)}\n\n`;
}

export function parseSseLine(line: string): SseEnvelope {
  return JSON.parse(line.replace(/^data: /, '')) as SseEnvelope;
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  const host = request.headers.get('host') ?? '';
  // same-origin guard: the visualizer page and this route share the Draymond host
  if (origin && !origin.includes(host)) {
    return new Response('forbidden', { status: 403 });
  }
  const auth = await requireDraymondAuth();
  if (auth.error) return auth.error;
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(encodeSse({
        type: 'connected',
        data: { message: 'visualizer stream connected' },
        ts: new Date().toISOString(),
      })));
      const sub: StreamSubscriber = (env) => {
        try { controller.enqueue(encoder.encode(encodeSse(env))); } catch { /* client gone */ }
      };
      unsub = subscribeToStream(sub);
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(`: ping\n\n`)), 15000);
    },
    cancel() {
      if (unsub) unsub();
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
    },
  });
}