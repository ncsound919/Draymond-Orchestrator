/**
 * GET /api/pipeline/status?id=<run_id>
 *
 * Server-Sent Events stream for real-time pipeline step progress.
 * The dashboard and any Draymond agent can subscribe to this endpoint
 * to receive live updates as each step completes.
 *
 * Events emitted:
 *   event: step
 *   data: { run_id, episode_id, step, status, message, timestamp }
 *
 *   event: done
 *   data: { run_id, episode_id, youtube_url?, shorts_url? }
 *
 *   event: error
 *   data: { run_id, episode_id, step, message }
 *
 * Implementation:
 *   Polls the Supabase `episodes` table every 2s for step updates.
 *   The Python pipeline writes step results to the Supabase row via
 *   the CCE_SUPABASE_URL + CCE_SUPABASE_KEY env vars in .env.
 *   This keeps the SSE stream stateless — no in-memory pub/sub needed.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const POLL_INTERVAL_MS = 2000
const MAX_POLL_DURATION_MS = 4 * 60 * 60 * 1000 // 4 hours max

const PIPELINE_STEPS = [
  'script_generator',
  'audio_engine',
  'godot_renderer',
  'comfy_integration',
  'publisher',
] as const

type StepName = typeof PIPELINE_STEPS[number]
type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'

interface StepState {
  status: StepStatus
  message?: string
  started_at?: string
  completed_at?: string
}

interface EpisodeRow {
  id: string
  run_id: string
  status: string
  steps: Record<StepName, StepState>
  youtube_url?: string
  shorts_url?: string
  error?: string
  updated_at: string
}

export async function GET(req: NextRequest) {
  const run_id = req.nextUrl.searchParams.get('id')

  if (!run_id) {
    return new Response('Missing run id', { status: 400 })
  }

  const encoder = new TextEncoder()
  const supabase = await createClient()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        )
      }

      const deadline = Date.now() + MAX_POLL_DURATION_MS
      const seen: Record<string, StepStatus> = {}
      let lastUpdated = ''

      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))

        const { data, error } = await supabase
          .from('episodes')
          .select('id, run_id, status, steps, youtube_url, shorts_url, error, updated_at')
          .eq('run_id', run_id)
          .single()

        if (error || !data) continue

        const row = data as EpisodeRow
        if (row.updated_at === lastUpdated) continue
        lastUpdated = row.updated_at

        // Emit step events for any newly completed/errored steps
        for (const step of PIPELINE_STEPS) {
          const state = row.steps?.[step]
          if (!state) continue
          const key = `${step}:${state.status}`
          if (seen[step] === state.status) continue
          seen[step] = state.status

          if (state.status !== 'pending') {
            send('step', {
              run_id,
              episode_id: row.id,
              step,
              status: state.status,
              message: state.message ?? '',
              timestamp: state.completed_at ?? new Date().toISOString(),
            })
          }
        }

        // Terminal states
        if (row.status === 'done') {
          send('done', {
            run_id,
            episode_id: row.id,
            youtube_url: row.youtube_url ?? null,
            shorts_url: row.shorts_url ?? null,
          })
          controller.close()
          return
        }

        if (row.status === 'error') {
          send('error', {
            run_id,
            episode_id: row.id,
            step: 'unknown',
            message: row.error ?? 'Pipeline error',
          })
          controller.close()
          return
        }
      }

      // Timeout
      send('error', { run_id, episode_id: '', step: 'timeout', message: 'Pipeline timed out' })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  })
}
