/**
 * POST /api/pipeline
 *
 * Triggers a Hood Alchemy Content-Creation-Engine episode run.
 * Draymond calls this endpoint when it decides a new episode should be produced.
 *
 * Request body (JSON):
 *   {
 *     episode_id: string          // e.g. "ep_042"
 *     topic?: string              // optional seed topic for the script generator
 *     characters?: string[]       // optional character override
 *     dry_run?: boolean           // if true, only runs Step 1 (script) and returns
 *   }
 *
 * Response (JSON):
 *   { run_id: string, episode_id: string, status: "queued" | "running" | "error" }
 *
 * The actual pipeline runs asynchronously as a child process.
 * Use GET /api/pipeline/status?id=<run_id> (SSE) to stream progress.
 *
 * Pipeline steps dispatched:
 *   1. script_generator   — GPT-4o script generation
 *   2. audio_engine       — ElevenLabs TTS + AudioCraft SFX
 *   3. godot_renderer     — Godot headless render + FFmpeg stitch
 *   4. comfy_integration  — ComfyUI shot enhancement
 *   5. publisher          — Caption burn-in + YouTube upload
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import path from 'path'
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth'

// Path to the Content-Creation-Engine repo on the same host
const ENGINE_ROOT = process.env.CCE_ROOT ?? path.join(process.cwd(), '..', 'Content-Creation-Engine-')
const PYTHON_BIN = process.env.CCE_PYTHON ?? 'python3'

export async function POST(req: NextRequest) {
  const authError = authorizeRequest(req);
  if (authError) return authError;

  try {
    const result = await parseJsonBody<{ episode_id?: string; topic?: string; characters?: string[]; dry_run?: boolean }>(req);
    if (result.error) return result.error;
    const { episode_id, topic, characters, dry_run = false } = result.data

    if (!episode_id || typeof episode_id !== 'string') {
      return NextResponse.json(
        { error: 'episode_id is required and must be a string' },
        { status: 400 }
      )
    }

    const run_id = randomUUID()
    const supabase = await createClient()

    // Upsert episode record in Supabase
    // Note: The `episodes` table is not in the generated Supabase types (it's
    // created by the CCE migration, not Draymond). Use a type assertion to
    // bypass the strict generic constraint on `.from()`.
    const { error: dbError } = await (supabase.from('episodes') as any).upsert({
      id: episode_id,
      run_id,
      status: 'queued',
      topic: topic ?? null,
      characters: characters ?? null,
      dry_run,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      steps: {},
    })

    if (dbError) {
      console.error('[pipeline] Supabase upsert error:', dbError)
      return NextResponse.json({ error: sanitizeError(dbError) }, { status: 500 })
    }

    // Launch pipeline as async child process
    // pipeline.py reads CCE config from .env in ENGINE_ROOT
    const args = [
      path.join(ENGINE_ROOT, 'pipeline.py'),
      '--episode', episode_id,
      '--run-id', run_id,
    ]
    if (topic) args.push('--topic', topic.replace(/[^a-zA-Z0-9 _\-,.!?]/g, ''))
    if (dry_run) args.push('--dry-run')
    if (characters?.length) args.push('--characters', characters.join(','))

    const child = spawn(PYTHON_BIN, args, {
      cwd: ENGINE_ROOT,
      detached: true,   // survive Next.js request lifecycle
      stdio: 'ignore',  // output goes to pipeline log file inside ENGINE_ROOT
      env: { ...process.env },
    })
    child.unref()

    console.log(`[pipeline] Launched run ${run_id} for episode ${episode_id} (pid ${child.pid})`)

    return NextResponse.json(
      { run_id, episode_id, status: 'queued' },
      { status: 202 }
    )
  } catch (err) {
    console.error('[pipeline] POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
