import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { generateEmbedding, newsEmbedText } from '@/lib/embeddings';

const QWEN_BASE_URL = 'https://qwen-turbo.shengyi.cc/v1';

const ImpactSchema = z.object({
  black_impact: z
    .string()
    .describe(
      '2-3 sentence analysis of how this news story specifically impacts Black communities in the US. Focus on direct effects on health, wealth, education, justice, or community.'
    ),
  impact_sectors: z
    .array(
      z.enum(['health', 'wealth', 'justice', 'education', 'community'])
    )
    .describe('1-3 sectors most affected by this news'),
});

type NewsApiArticle = {
  title: string;
  description?: string;
  url: string;
  publishedAt?: string;
  source?: { name?: string };
  urlToImage?: string;
};

async function analyzeWithQwen(
  title: string,
  description: string
): Promise<{ black_impact: string; impact_sectors: string[] }> {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    return {
      black_impact: 'AI analysis unavailable — QWEN_API_KEY not configured.',
      impact_sectors: ['community'],
    };
  }

  const qwen = createOpenAI({ baseURL: QWEN_BASE_URL, apiKey });

  const { object } = await generateObject({
    model: qwen('qwen-turbo'),
    schema: ImpactSchema,
    prompt: `Analyze this news article for its impact on Black communities in the US.\n\nTitle: ${title}\nDescription: ${description}`,
    temperature: 0.3,
  });

  return object;
}

async function fetchFromNewsAPI(): Promise<NewsApiArticle[]> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) return [];

  const queries = [
    'Black community',
    'racial equity',
    'HBCU',
    'Black entrepreneurs',
    'criminal justice reform',
  ];
  const query = queries.join(' OR ');

  try {
    const res = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=10`,
      { headers: { 'X-Api-Key': apiKey } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.articles ?? [];
  } catch {
    return [];
  }
}

async function fetchFromGNews(): Promise<NewsApiArticle[]> {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://gnews.io/api/v4/search?q=${encodeURIComponent('Black community OR racial equity')}&lang=en&max=10&apikey=${apiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.articles ?? []).map(
      (a: { title: string; description?: string; url: string; publishedAt?: string; source?: { name?: string }; image?: string }) => ({
        title: a.title,
        description: a.description,
        url: a.url,
        publishedAt: a.publishedAt,
        source: a.source,
        urlToImage: a.image,
      })
    );
  } catch {
    return [];
  }
}

async function fetchFromWorldNewsAPI(): Promise<NewsApiArticle[]> {
  const apiKey = process.env.WORLDNEWS_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://api.worldnewsapi.com/search-news?text=${encodeURIComponent('Black community racial equity')}&language=en&number=10`,
      { headers: { 'x-api-key': apiKey } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.news ?? []).map(
      (a: { title: string; text?: string; url: string; publish_date?: string; source_country?: string; image?: string }) => ({
        title: a.title,
        description: a.text?.slice(0, 300),
        url: a.url,
        publishedAt: a.publish_date,
        source: { name: a.source_country ?? 'World News' },
        urlToImage: a.image,
      })
    );
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  // Authenticate via CRON_SECRET
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: 'Missing Supabase credentials' },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Fetch from all configured news sources
  const [newsApiArticles, gnewsArticles, worldNewsArticles] = await Promise.all([
    fetchFromNewsAPI(),
    fetchFromGNews(),
    fetchFromWorldNewsAPI(),
  ]);

  const allArticles = [...newsApiArticles, ...gnewsArticles, ...worldNewsArticles];

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = allArticles.filter((a) => {
    if (!a.url || seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const article of unique) {
    try {
      // Check if URL already exists in DB
      const { data: existing } = await supabase
        .from('news_articles')
        .select('id')
        .eq('url', article.url)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Analyze with Qwen AFTER confirming it's not a duplicate
      const analysis = await analyzeWithQwen(
        article.title,
        article.description ?? ''
      );

      // Generate embedding
      let embedding: number[] | null = null;
      try {
        embedding = await generateEmbedding(
          newsEmbedText({
            title: article.title,
            description: article.description,
            black_impact: analysis.black_impact,
          })
        );
      } catch {
        // Embedding failure is non-fatal
      }

      const { error: insertError } = await supabase
        .from('news_articles')
        .insert({
          title: article.title,
          description: article.description ?? null,
          url: article.url,
          published_at: article.publishedAt ?? new Date().toISOString(),
          source_name: article.source?.name ?? 'Unknown',
          image_url: article.urlToImage ?? null,
          black_impact: analysis.black_impact,
          impact_sectors: analysis.impact_sectors,
          embedding,
        });

      if (insertError) {
        errors.push(`${article.title}: ${insertError.message}`);
      } else {
        inserted++;
      }
    } catch (err) {
      errors.push(
        `${article.title}: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  return NextResponse.json({
    total: unique.length,
    inserted,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
