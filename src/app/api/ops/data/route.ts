import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import {
  cryptoPrices, musicArtist, openAlexWorks, pubmedSearch, fdaDrugEvents, caselawCases,
  finnhubQuote, fredSeries, virusTotalUrlReport, theSportsDb, usdaFood,
} from '@/lib/draymond/data-apis';

export const dynamic = 'force-dynamic';

const SOURCES: Record<string, (p: string) => Promise<unknown>> = {
  crypto: (ids) => cryptoPrices(ids || 'bitcoin,ethereum,solana'),
  music: (q) => musicArtist(q || 'nirvana'),
  papers: (q) => openAlexWorks(q || 'artificial intelligence'),
  pubmed: (q) => pubmedSearch(q || 'cancer'),
  fda: (q) => fdaDrugEvents(q || 'aspirin'),
  caselaw: (q) => caselawCases(q || 'contract'),
  finnhub: (s) => finnhubQuote(s || 'AAPL'),
  fred: (s) => fredSeries(s || 'GDP'),
  virustotal: (u) => virusTotalUrlReport(u || 'https://overlay365.com'),
  sportsdb: () => theSportsDb(),
  usda: (q) => usdaFood(q || 'apple'),
};/** GET /api/ops/data?source=coingecko|music|papers|pubmed|fda|caselaw|finnhub|fred|virustotal|sportsdb|usda&q=... */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const url = new URL(request.url);
  const source = url.searchParams.get('source') ?? 'crypto';
  const q = url.searchParams.get('q') ?? '';
  const fn = SOURCES[source];
  if (!fn) {
    return NextResponse.json(
      { error: `unknown source — expected: ${Object.keys(SOURCES).join(', ')}` },
      { status: 400 },
    );
  }
  try {
    const data = await fn(q);
    return NextResponse.json({ source, data });
  } catch (err) {
    return NextResponse.json(
      { source, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
