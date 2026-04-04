/**
 * Hood Alchemy Client
 *
 * Typed client library for interacting with the Content-Creation-Engine
 * pipeline from anywhere inside Draymond.
 *
 * Usage (from any component or server action):
 *
 *   import { HoodAlchemyClient } from '@/lib/hoodAlchemyClient'
 *
 *   // Trigger a run
 *   const { run_id } = await HoodAlchemyClient.triggerEpisode({
 *     episode_id: 'ep_042',
 *     topic: 'Why everyone acts brand new',
 *   })
 *
 *   // Stream progress
 *   HoodAlchemyClient.streamProgress(run_id, {
 *     onStep: (e) => console.log(e.step, e.status),
 *     onDone: (e) => console.log('Published:', e.youtube_url),
 *     onError: (e) => console.error(e.message),
 *   })
 *
 *   // Get episode list
 *   const episodes = await HoodAlchemyClient.listEpisodes({ limit: 20 })
 *
 *   // Get single episode
 *   const episode = await HoodAlchemyClient.getEpisode('ep_042')
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineStepName =
  | 'script_generator'
  | 'audio_engine'
  | 'godot_renderer'
  | 'comfy_integration'
  | 'publisher'

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'

export interface StepState {
  status: StepStatus
  message?: string
  started_at?: string
  completed_at?: string
}

export interface Episode {
  id: string
  run_id: string
  status: 'queued' | 'running' | 'done' | 'error'
  topic?: string
  characters?: string[]
  dry_run: boolean
  steps: Record<PipelineStepName, StepState>
  youtube_url?: string
  shorts_url?: string
  error?: string
  created_at: string
  updated_at: string
}

export interface TriggerOptions {
  episode_id: string
  topic?: string
  characters?: string[]
  dry_run?: boolean
}

export interface TriggerResult {
  run_id: string
  episode_id: string
  status: 'queued' | 'running' | 'error'
}

export interface StepEvent {
  run_id: string
  episode_id: string
  step: PipelineStepName
  status: StepStatus
  message: string
  timestamp: string
}

export interface DoneEvent {
  run_id: string
  episode_id: string
  youtube_url: string | null
  shorts_url: string | null
}

export interface ErrorEvent {
  run_id: string
  episode_id: string
  step: string
  message: string
}

export interface StreamHandlers {
  onStep?: (event: StepEvent) => void
  onDone?: (event: DoneEvent) => void
  onError?: (event: ErrorEvent) => void
}

export interface ListOptions {
  limit?: number
  offset?: number
  status?: Episode['status']
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const BASE = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000')

export const HoodAlchemyClient = {
  /**
   * Trigger a new episode pipeline run.
   * Returns immediately with run_id — pipeline runs async.
   */
  async triggerEpisode(opts: TriggerOptions): Promise<TriggerResult> {
    const res = await fetch(`${BASE}/api/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(`Pipeline trigger failed: ${err.error ?? res.statusText}`)
    }
    return res.json()
  },

  /**
   * Subscribe to real-time step progress via SSE.
   * Returns an EventSource — call .close() to unsubscribe.
   */
  streamProgress(run_id: string, handlers: StreamHandlers): EventSource {
    const es = new EventSource(`${BASE}/api/pipeline/status?id=${encodeURIComponent(run_id)}`)

    es.addEventListener('step', (e) => {
      try { handlers.onStep?.(JSON.parse(e.data) as StepEvent) } catch {}
    })
    es.addEventListener('done', (e) => {
      try {
        handlers.onDone?.(JSON.parse(e.data) as DoneEvent)
        es.close()
      } catch {}
    })
    es.addEventListener('error', (e) => {
      try {
        // SSE 'error' fires both on server-sent errors and on connection drops.
        // Only parse data if there's a data payload.
        const data = (e as MessageEvent).data
        if (data) handlers.onError?.(JSON.parse(data) as ErrorEvent)
      } catch {}
    })

    return es
  },

  /**
   * List episodes from Supabase via server action.
   * Works in both server and client components.
   */
  async listEpisodes(opts: ListOptions = {}): Promise<Episode[]> {
    const params = new URLSearchParams()
    if (opts.limit) params.set('limit', String(opts.limit))
    if (opts.offset) params.set('offset', String(opts.offset))
    if (opts.status) params.set('status', opts.status)
    const res = await fetch(`${BASE}/api/pipeline/episodes?${params}`, { cache: 'no-store' })
    if (!res.ok) return []
    return res.json()
  },

  /**
   * Get a single episode by ID.
   */
  async getEpisode(episode_id: string): Promise<Episode | null> {
    const res = await fetch(`${BASE}/api/pipeline/episodes/${encodeURIComponent(episode_id)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    return res.json()
  },

  /**
   * Step labels for display in the dashboard.
   */
  STEP_LABELS: {
    script_generator: 'Script Generation',
    audio_engine: 'Audio & SFX',
    godot_renderer: 'Godot Render',
    comfy_integration: 'ComfyUI Enhancement',
    publisher: 'Captions & Publish',
  } satisfies Record<PipelineStepName, string>,

  STEP_ORDER: [
    'script_generator',
    'audio_engine',
    'godot_renderer',
    'comfy_integration',
    'publisher',
  ] as PipelineStepName[],
}
