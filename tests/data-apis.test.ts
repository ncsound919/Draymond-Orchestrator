import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cryptoPrices,
  musicArtist,
  openAlexWorks,
  pubmedSearch,
  fdaDrugEvents,
  caselawCases,
  finnhubQuote,
  fredSeries,
  theSportsDb,
  usdaFood,
  virusTotalUrlReport,
  financialBrief,
} from '../src/lib/draymond/data-apis';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

function stubJson(json: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(json), { status })));
}

describe('data-apis: no-key fetchers', () => {
  it('cryptoPrices parses usd values and defaults missing to 0', async () => {
    stubJson({ bitcoin: { usd: 60000 }, ethereum: {} });
    const out = await cryptoPrices('bitcoin,ethereum');
    expect(out).toEqual({ bitcoin: 60000, ethereum: 0 });
  });

  it('musicArtist returns artists or an empty list', async () => {
    stubJson({ artists: [{ id: 'a1', name: 'Artist', type: 'Group' }] });
    expect(await musicArtist('artist')).toEqual([{ id: 'a1', name: 'Artist', type: 'Group' }]);
    stubJson({});
    expect(await musicArtist('none')).toEqual([]);
  });

  it('openAlexWorks maps results and handles empty', async () => {
    stubJson({
      results: [{ title: 'T', doi: '10.1', publication_year: 2020, cited_by_count: 5 }],
    });
    expect(await openAlexWorks('ai', 3)).toEqual([{ title: 'T', doi: '10.1', year: 2020, cited_by: 5 }]);
    stubJson({});
    expect(await openAlexWorks('ai', 3)).toEqual([]);
  });

  it('pubmedSearch returns ids with titles or an empty list when no hits', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const json = url.includes('esearch')
        ? { esearchresult: { idlist: ['1', '2'] } }
        : { result: { '1': { title: 'Paper A' }, '2': {} } };
      return new Response(JSON.stringify(json), { status: 200 });
    }));
    expect(await pubmedSearch('cancer', 5)).toEqual([
      { id: '1', title: 'Paper A' },
      { id: '2', title: undefined },
    ]);
    stubJson({ esearchresult: { idlist: [] } });
    expect(await pubmedSearch('nothing', 5)).toEqual([]);
  });

  it('fdaDrugEvents returns results or empty', async () => {
    stubJson({ results: [{ patient: { reaction: [] } }] });
    const out = await fdaDrugEvents('aspirin');
    expect(out).toHaveLength(1);
    stubJson({});
    expect(await fdaDrugEvents('none')).toEqual([]);
  });
});

describe('data-apis: key-gated fetchers', () => {
  it('caselawCases fails soft without a token', async () => {
    expect(await caselawCases('x')).toEqual({ ok: false, detail: 'CASELAW_TOKEN not configured' });
  });

  it('caselawCases returns cases with a token', async () => {
    process.env.CASELAW_TOKEN = 't';
    stubJson({ results: [{ name_abbreviation: 'Case v. X', decision_date: '2020-01-01' }] });
    const out = await caselawCases('x');
    expect(out.ok).toBe(true);
    expect(out.cases).toEqual([{ name_abbreviation: 'Case v. X', decision_date: '2020-01-01' }]);
  });

  it('caselawCases fails soft when fetch throws', async () => {
    process.env.CASELAW_TOKEN = 't';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    expect(await caselawCases('x')).toEqual({ ok: false, detail: 'boom' });
  });

  it('finnhubQuote fails soft without a key', async () => {
    expect(await finnhubQuote('AAPL')).toEqual({ ok: false, detail: 'FINNHUB_API_KEY not configured' });
  });

  it('finnhubQuote returns price with a key', async () => {
    process.env.FINNHUB_API_KEY = 'k';
    stubJson({ c: 150.5, dp: 1.2 });
    expect(await finnhubQuote('AAPL')).toEqual({ ok: true, price: 150.5, change_pct: 1.2 });
  });

  it('finnhubQuote fails soft when fetch throws', async () => {
    process.env.FINNHUB_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect(await finnhubQuote('AAPL')).toEqual({ ok: false, detail: 'network' });
  });

  it('fredSeries fails soft without a key', async () => {
    expect(await fredSeries('GDP')).toEqual({ ok: false, detail: 'FRED_API_KEY not configured' });
  });

  it('fredSeries returns latest value with a key', async () => {
    process.env.FRED_API_KEY = 'k';
    stubJson({ observations: [{ value: '12.34' }] });
    expect(await fredSeries('GDP')).toEqual({ ok: true, latest: 12.34 });
  });

  it('fredSeries fails soft when fetch throws', async () => {
    process.env.FRED_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await fredSeries('GDP')).toEqual({ ok: false, detail: 'down' });
  });

  it('theSportsDb fails soft without a key and succeeds with one', async () => {
    expect(await theSportsDb()).toEqual({ ok: false, detail: 'THESPORTSDB_API_KEY not configured' });
    process.env.THESPORTSDB_API_KEY = 'k';
    stubJson({});
    expect(await theSportsDb()).toEqual({ ok: true, detail: 'league NBA reachable' });
  });

  it('usdaFood fails soft without a key and returns count with one', async () => {
    expect(await usdaFood('milk')).toEqual({ ok: false, detail: 'USDA_API_KEY not configured' });
    process.env.USDA_API_KEY = 'k';
    stubJson({ totalHits: 42 });
    expect(await usdaFood('milk')).toEqual({ ok: true, count: 42 });
  });

  it('virusTotalUrlReport fails soft without a key and returns count with one', async () => {
    expect(await virusTotalUrlReport('https://x')).toEqual({ ok: false, detail: 'VIRUSTOTAL_API_KEY not configured' });
    process.env.VIRUSTOTAL_API_KEY = 'k';
    stubJson({ data: { attributes: { last_analysis_stats: { malicious: 2 } } } });
    expect(await virusTotalUrlReport('https://x')).toEqual({ ok: true, malicious: 2 });
  });
});

describe('financialBrief', () => {
  it('degrades gracefully when every source fails', async () => {
    process.env.FINNHUB_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const brief = await financialBrief();
    expect(brief.crypto).toEqual({});
    expect(brief.papers).toEqual([]);
    expect(brief.brief).toContain('BTC=n/a');
  });

  it('bundles market data when sources respond', async () => {
    process.env.FINNHUB_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ bitcoin: { usd: 65000 } }), { status: 200 })));
    const brief = await financialBrief();
    expect(brief.brief).toContain('BTC=$65000');
    expect(brief.brief).toContain('stocks n/a');
  });
});
