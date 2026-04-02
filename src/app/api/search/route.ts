import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateEmbedding } from '@/lib/embeddings';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();

  if (!q) {
    return NextResponse.json({ error: 'Missing query parameter "q"' }, { status: 400 });
  }

  // NaN guard on limit and threshold
  const rawLimit = Number(searchParams.get('limit') ?? '20');
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 100);

  const rawThreshold = Number(searchParams.get('threshold') ?? '0.5');
  const threshold = Number.isNaN(rawThreshold) || rawThreshold < 0 || rawThreshold > 1 ? 0.5 : rawThreshold;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let embedding: number[];
  try {
    embedding = await generateEmbedding(q);
  } catch {
    // Fall back to text search if embedding generation fails
    return textSearch(supabase, q, limit);
  }

  // Run semantic search across all three tables in parallel
  const [posts, listings, news] = await Promise.all([
    supabase.rpc('match_posts', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: limit,
    }),
    supabase.rpc('match_listings', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: limit,
    }),
    supabase.rpc('match_news', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: limit,
    }),
  ]);

  return NextResponse.json({
    query: q,
    posts: posts.data ?? [],
    listings: listings.data ?? [],
    news: news.data ?? [],
  });
}

/**
 * Fallback text-based search when embedding generation is unavailable.
 */
async function textSearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic Supabase client
  supabase: any,
  q: string,
  limit: number
) {
  const pattern = `%${q}%`;

  const [posts, listings, news] = await Promise.all([
    supabase
      .from('posts')
      .select('id, title, body, type, module, created_at')
      .or(`title.ilike.${pattern},body.ilike.${pattern}`)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('registry_listings')
      .select('id, name, description, category, location_city, location_state')
      .or(`name.ilike.${pattern},description.ilike.${pattern}`)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('news_articles')
      .select('id, title, description, url, published_at, source_name, black_impact, impact_sectors')
      .or(`title.ilike.${pattern},description.ilike.${pattern}`)
      .order('published_at', { ascending: false })
      .limit(limit),
  ]);

  return NextResponse.json({
    query: q,
    fallback: true,
    posts: posts.data ?? [],
    listings: listings.data ?? [],
    news: news.data ?? [],
  });
}
