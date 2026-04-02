import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Community News | The Uplift Lab',
  description:
    'Stay informed on news impacting Black communities — AI-analyzed for relevance across health, wealth, justice, education, and community.',
};

type NewsArticle = {
  id: string;
  title: string;
  description: string | null;
  url: string;
  published_at: string;
  source_name: string | null;
  image_url: string | null;
  black_impact: string | null;
  impact_sectors: string[] | null;
};

const SECTOR_STYLES: Record<string, string> = {
  health: 'bg-green-900/30 text-green-400',
  wealth: 'bg-yellow-900/30 text-yellow-400',
  justice: 'bg-purple-900/30 text-purple-400',
  education: 'bg-blue-900/30 text-blue-400',
  community: 'bg-red-900/30 text-red-400',
};

export default async function NewsPage(props: {
  searchParams: Promise<{ sector?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
  let query = (supabase as any)
    .from('news_articles')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(50);

  if (searchParams.sector) {
    query = query.contains('impact_sectors', [searchParams.sector]);
  }

  const { data: articles } = (await query) as { data: NewsArticle[] | null };

  const SECTORS = ['health', 'wealth', 'justice', 'education', 'community'];

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Hero bar */}
      <div className="bg-[#0a0a0a] border-b border-white/5 text-white">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold">Community News</h1>
          <p className="text-white/40 text-sm mt-0.5">
            AI-analyzed news impacting Black communities
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Sector filters */}
        <div className="flex flex-wrap gap-2 mb-8">
          <a
            href="/news"
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              !searchParams.sector
                ? 'bg-[#22c55e] text-[#0a0a0a]'
                : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            All
          </a>
          {SECTORS.map((s) => (
            <a
              key={s}
              href={`/news?sector=${s}`}
              className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${
                searchParams.sector === s
                  ? 'bg-[#22c55e] text-[#0a0a0a]'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              {s}
            </a>
          ))}
        </div>

        {/* Articles */}
        {articles && articles.length > 0 ? (
          <div className="space-y-6">
            {articles.map((article) => (
              <article key={article.id} className="glass-card p-6">
                <div className="flex flex-col md:flex-row gap-6">
                  {/* Image */}
                  {article.image_url && (
                    <div className="md:w-48 md:h-32 flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={article.image_url}
                        alt=""
                        className="w-full h-32 md:h-full object-cover rounded-lg"
                      />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h2 className="text-lg font-semibold text-white">
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-[#22c55e] transition-colors"
                        >
                          {article.title}
                        </a>
                      </h2>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-white/30 mb-3">
                      {article.source_name && <span>{article.source_name}</span>}
                      <span>
                        {new Date(article.published_at).toLocaleDateString(
                          'en-US',
                          { month: 'short', day: 'numeric', year: 'numeric' }
                        )}
                      </span>
                    </div>

                    {article.description && (
                      <p className="text-sm text-white/50 line-clamp-2 mb-3">
                        {article.description}
                      </p>
                    )}

                    {/* Impact analysis */}
                    {article.black_impact && (
                      <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 mb-3">
                        <p className="text-xs font-medium text-[#22c55e] mb-1">
                          Community Impact Analysis
                        </p>
                        <p className="text-sm text-white/60">
                          {article.black_impact}
                        </p>
                      </div>
                    )}

                    {/* Sector tags */}
                    {article.impact_sectors && article.impact_sectors.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {article.impact_sectors.map((sector) => (
                          <span
                            key={sector}
                            className={`px-2 py-0.5 text-xs rounded-full capitalize ${
                              SECTOR_STYLES[sector] ?? 'bg-white/10 text-white/50'
                            }`}
                          >
                            {sector}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="glass-card p-12 text-center">
            <p className="text-white/40 text-lg">
              {searchParams.sector
                ? `No articles found for "${searchParams.sector}".`
                : 'No news articles yet. Check back soon!'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
