import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  generateEmbedding,
  postEmbedText,
  listingEmbedText,
  newsEmbedText,
} from '@/lib/embeddings';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export async function POST(req: NextRequest) {
  const authError = authorizeRequest(req);
  if (authError) return authError;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // NaN guard on limit
  const body = await req.json().catch(() => ({}));
  const rawLimit = Number(body.limit ?? 50);
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 500);
  const table = body.table as string | undefined; // 'posts' | 'registry_listings' | 'news_articles' | undefined (all)

  const results = {
    posts: { updated: 0, errors: 0 },
    listings: { updated: 0, errors: 0 },
    news: { updated: 0, errors: 0 },
  };

  // Backfill posts
  if (!table || table === 'posts') {
    const { data: posts } = await supabase
      .from('posts')
      .select('id, title, body, tags, type, module')
      .is('embedding', null)
      .eq('status', 'active')
      .limit(limit);

    for (const post of posts ?? []) {
      try {
        const text = postEmbedText(post);
        const embedding = await generateEmbedding(text);
        await supabase.from('posts').update({ embedding }).eq('id', post.id);
        results.posts.updated++;
      } catch {
        results.posts.errors++;
      }
    }
  }

  // Backfill registry listings
  if (!table || table === 'registry_listings') {
    const { data: listings } = await supabase
      .from('registry_listings')
      .select('id, name, description, category, location_city, location_state')
      .is('embedding', null)
      .eq('status', 'approved')
      .limit(limit);

    for (const listing of listings ?? []) {
      try {
        const text = listingEmbedText(listing);
        const embedding = await generateEmbedding(text);
        await supabase.from('registry_listings').update({ embedding }).eq('id', listing.id);
        results.listings.updated++;
      } catch {
        results.listings.errors++;
      }
    }
  }

  // Backfill news articles
  if (!table || table === 'news_articles') {
    const { data: articles } = await supabase
      .from('news_articles')
      .select('id, title, description, black_impact')
      .is('embedding', null)
      .limit(limit);

    for (const article of articles ?? []) {
      try {
        const text = newsEmbedText(article);
        const embedding = await generateEmbedding(text);
        await supabase.from('news_articles').update({ embedding }).eq('id', article.id);
        results.news.updated++;
      } catch {
        results.news.errors++;
      }
    }
  }

  return NextResponse.json({ backfilled: results });
}
