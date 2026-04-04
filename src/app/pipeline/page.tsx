/**
 * Hood Alchemy Dashboard
 * Route: /modules/hood-alchemy
 *
 * Live episode production monitor for the Content-Creation-Engine.
 * Shows active pipeline runs, step progress, and published video links.
 *
 * Features:
 *   - Trigger new episode runs (with optional topic + characters)
 *   - Live step progress via SSE (HoodAlchemyClient.streamProgress)
 *   - Episode history table from Supabase
 *   - Direct links to YouTube standard + Shorts uploads
 */

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  HoodAlchemyClient,
  Episode,
  PipelineStepName,
  StepEvent,
  DoneEvent,
} from '@/lib/hoodAlchemyClient'

// ---------------------------------------------------------------------------
// Step progress indicator
// ---------------------------------------------------------------------------

function StepBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending:  'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    running:  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 animate-pulse',
    done:     'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    skipped:  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
    error:    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  }
  const icons: Record<string, string> = {
    pending: '○', running: '⟳', done: '✓', skipped: '⚡', error: '✗',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? styles.pending}`}>
      {icons[status] ?? '○'} {status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Pipeline run tracker (live SSE)
// ---------------------------------------------------------------------------

interface RunState {
  run_id: string
  episode_id: string
  steps: Record<PipelineStepName, { status: string; message: string }>
  done: boolean
  youtube_url?: string
  shorts_url?: string
  error?: string
}

function ActiveRun({ run_id, episode_id }: { run_id: string; episode_id: string }) {
  const [state, setState] = useState<RunState>({
    run_id,
    episode_id,
    steps: Object.fromEntries(
      HoodAlchemyClient.STEP_ORDER.map(s => [s, { status: 'pending', message: '' }])
    ) as Record<PipelineStepName, { status: string; message: string }>,
    done: false,
  })

  useEffect(() => {
    const es = HoodAlchemyClient.streamProgress(run_id, {
      onStep: (e: StepEvent) => {
        setState(prev => ({
          ...prev,
          steps: { ...prev.steps, [e.step]: { status: e.status, message: e.message } },
        }))
      },
      onDone: (e: DoneEvent) => {
        setState(prev => ({
          ...prev,
          done: true,
          youtube_url: e.youtube_url ?? undefined,
          shorts_url: e.shorts_url ?? undefined,
        }))
      },
      onError: (e) => {
        setState(prev => ({ ...prev, error: e.message }))
      },
    })
    return () => es.close()
  }, [run_id])

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">{state.episode_id}</h3>
          <p className="text-xs text-gray-500 font-mono mt-0.5">{run_id.slice(0, 8)}…</p>
        </div>
        {state.done && !state.error && (
          <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 px-2 py-1 rounded-full font-medium">
            ✓ Published
          </span>
        )}
        {state.error && (
          <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 px-2 py-1 rounded-full font-medium">
            ✗ Error
          </span>
        )}
      </div>

      <div className="space-y-2">
        {HoodAlchemyClient.STEP_ORDER.map((step) => (
          <div key={step} className="flex items-center gap-3">
            <StepBadge status={state.steps[step]?.status ?? 'pending'} />
            <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">
              {HoodAlchemyClient.STEP_LABELS[step]}
            </span>
            {state.steps[step]?.message && (
              <span className="text-xs text-gray-400 truncate max-w-[200px]">
                {state.steps[step].message}
              </span>
            )}
          </div>
        ))}
      </div>

      {(state.youtube_url || state.shorts_url) && (
        <div className="mt-4 flex gap-3">
          {state.youtube_url && (
            <a
              href={state.youtube_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              ▶ Watch on YouTube
            </a>
          )}
          {state.shorts_url && (
            <a
              href={state.shorts_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-pink-600 dark:text-pink-400 hover:underline"
            >
              ▶ View Short
            </a>
          )}
        </div>
      )}

      {state.error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Episode history row
// ---------------------------------------------------------------------------

function EpisodeRow({ ep }: { ep: Episode }) {
  const completedSteps = Object.values(ep.steps).filter(s => s.status === 'done').length
  const totalSteps = HoodAlchemyClient.STEP_ORDER.length
  const pct = Math.round((completedSteps / totalSteps) * 100)

  return (
    <tr className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <td className="py-3 px-4 font-mono text-sm text-gray-900 dark:text-gray-100">{ep.id}</td>
      <td className="py-3 px-4">
        <StepBadge status={ep.status} />
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 w-24">
            <div
              className="bg-green-500 h-1.5 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">{completedSteps}/{totalSteps}</span>
        </div>
      </td>
      <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400 max-w-[200px] truncate">
        {ep.topic ?? '—'}
      </td>
      <td className="py-3 px-4">
        <div className="flex gap-2">
          {ep.youtube_url && (
            <a href={ep.youtube_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              YT
            </a>
          )}
          {ep.shorts_url && (
            <a href={ep.shorts_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-pink-600 dark:text-pink-400 hover:underline">
              Short
            </a>
          )}
        </div>
      </td>
      <td className="py-3 px-4 text-xs text-gray-400">
        {new Date(ep.created_at).toLocaleDateString()}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main dashboard page
// ---------------------------------------------------------------------------

export default function HoodAlchemyPage() {
  const [episodeId, setEpisodeId] = useState('')
  const [topic, setTopic] = useState('')
  const [characters, setCharacters] = useState('')
  const [dryRun, setDryRun] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [activeRuns, setActiveRuns] = useState<{ run_id: string; episode_id: string }[]>([])
  const [history, setHistory] = useState<Episode[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load episode history
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const eps = await HoodAlchemyClient.listEpisodes({ limit: 20 })
      setHistory(eps)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load episode history')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const handleTrigger = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!episodeId.trim()) return
    setTriggering(true)
    setError(null)
    try {
      const result = await HoodAlchemyClient.triggerEpisode({
        episode_id: episodeId.trim(),
        topic: topic.trim() || undefined,
        characters: characters.trim() ? characters.split(',').map(c => c.trim()) : undefined,
        dry_run: dryRun,
      })
      setActiveRuns(prev => [...prev, { run_id: result.run_id, episode_id: result.episode_id }])
      setEpisodeId('')
      setTopic('')
      setCharacters('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger pipeline')
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-10">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Hood Alchemy</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
          Content-Creation-Engine — script → audio → Godot → ComfyUI → YouTube
        </p>
      </div>

      {/* Trigger form */}
      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-sm">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Trigger Episode Run</h2>
        <form onSubmit={handleTrigger} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-1">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Episode ID *</label>
            <input
              type="text"
              value={episodeId}
              onChange={e => setEpisodeId(e.target.value)}
              placeholder="ep_042"
              required
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="sm:col-span-1">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Topic (optional)</label>
            <input
              type="text"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="Why everyone acts brand new"
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="sm:col-span-1">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Characters (comma-separated)</label>
            <input
              type="text"
              value={characters}
              onChange={e => setCharacters(e.target.value)}
              placeholder="Marcus, Darius, Keisha"
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="sm:col-span-1 flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
              <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)}
                className="rounded" />
              Dry run (script only)
            </label>
          </div>
          <div className="sm:col-span-2 flex items-center gap-4">
            <button
              type="submit"
              disabled={triggering || !episodeId.trim()}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {triggering ? 'Launching…' : 'Launch Pipeline'}
            </button>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
        </form>
      </section>

      {/* Active runs */}
      {activeRuns.length > 0 && (
        <section>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Active Runs</h2>
          <div className="space-y-4">
            {activeRuns.map(r => (
              <ActiveRun key={r.run_id} run_id={r.run_id} episode_id={r.episode_id} />
            ))}
          </div>
        </section>
      )}

      {/* Episode history */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Episode History</h2>
          <button onClick={loadHistory} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            ↻ Refresh
          </button>
        </div>
        {historyLoading ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center text-sm text-gray-400">
            Loading episodes…
          </div>
        ) : history.length === 0 ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center text-sm text-gray-400">
            No episodes yet. Trigger your first run above.
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  {['Episode', 'Status', 'Progress', 'Topic', 'Links', 'Date'].map(h => (
                    <th key={h} scope="col" className="py-2 px-4 text-left text-xs font-medium text-gray-500 dark:text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map(ep => <EpisodeRow key={ep.id} ep={ep} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
