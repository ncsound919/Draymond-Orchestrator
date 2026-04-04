/**
 * GET /api/pipeline/episodes/:id
 *
 * Returns a single episode by episode_id from Supabase.
 * Used by HoodAlchemyClient.getEpisode(id) in the Hood Alchemy dashboard.
 *
 * Response: Episode | 404
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'Missing episode id' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('episodes')
    .select('id, run_id, status, topic, characters, dry_run, steps, youtube_url, shorts_url, error, created_at, updated_at')
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 })
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
