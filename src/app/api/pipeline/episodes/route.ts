/**
 * GET /api/pipeline/episodes
 *
 * Returns a paginated list of episodes from the Supabase `episodes` table.
 * Used by HoodAlchemyClient.listEpisodes() in the Hood Alchemy dashboard.
 *
 * Query params:
 *   limit?  — max rows (default 20, max 100)
 *   offset? — for pagination
 *   status? — filter by episode status: queued | running | done | error
 *
 * Response: Episode[]
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeRequest } from '@/lib/draymond/api-auth'

export async function GET(req: NextRequest) {
  const authError = authorizeRequest(req);
  if (authError) return authError;

  const { searchParams } = req.nextUrl
  const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '20', 10), 100)
  const offset = parseInt(searchParams.get('offset') ?? '0',  10)
  const status = searchParams.get('status')

  const supabase = await createClient()

  let query = supabase
    .from('episodes')
    .select('id, run_id, status, topic, characters, dry_run, steps, youtube_url, shorts_url, error, created_at, updated_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [], {
    headers: { 'Cache-Control': 'no-store' },
  })
}
