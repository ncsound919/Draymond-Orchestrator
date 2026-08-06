/**
 * External data APIs — free-tier sources powering the 4 engines.
 *
 * No-key fetchers (verified live): CoinGecko, MusicBrainz, OpenAlex, PubMed,
 * OpenFDA, Caselaw Access Project.
 * Key-gated fetchers (read from env, fail-soft): Finnhub, FRED, VirusTotal,
 * TheSportsDB, USDA FoodData.
 *
 * Deterministic: returns normalized data or an explicit not-available error.
 */

const UA = "overlay365-fleet/1.0";

async function getJson(url: string, headers: Record<string, string> = {}, timeout = 15_000): Promise<unknown> {
  const res = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function apiKey(name: string): string {
  return process.env[name] ?? "";
}

// ── No-key sources ─────────────────────────────────────────────────────────

export async function cryptoPrices(ids = "bitcoin,ethereum,solana"): Promise<Record<string, number>> {
  const data = (await getJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
  )) as Record<string, { usd?: number }>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) out[k] = v.usd ?? 0;
  return out;
}

export async function musicArtist(query: string): Promise<Array<{ id: string; name: string; type?: string }>> {
  const data = (await getJson(
    `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=5`
  )) as { artists?: Array<{ id: string; name: string; type?: string }> };
  return data.artists ?? [];
}

export async function openAlexWorks(query: string, perPage = 5): Promise<Array<{ title: string; doi?: string; year?: number; cited_by?: number }>> {
  const data = (await getJson(
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${perPage}`
  )) as { results?: Array<{ title: string; doi?: string; publication_year?: number; cited_by_count?: number }> };
  return (data.results ?? []).map((r) => ({
    title: r.title, doi: r.doi, year: r.publication_year, cited_by: r.cited_by_count,
  }));
}

export async function pubmedSearch(query: string, max = 5): Promise<Array<{ id: string; title?: string }>> {
  const search = (await getJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=${max}`
  )) as { esearchresult?: { idlist?: string[] } };
  const ids = search.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];
  const summary = (await getJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`
  )) as { result?: Record<string, { title?: string }> };
  return ids.map((id) => ({ id, title: summary.result?.[id]?.title }));
}

export async function fdaDrugEvents(drug: string, limit = 5): Promise<Array<{ patient?: { reaction?: Array<{ reactionmeddrapt?: string }> } }>> {
  const data = (await getJson(
    `https://api.fda.gov/drug/event.json?search=${encodeURIComponent(drug)}&limit=${limit}`
  )) as { results?: Array<{ patient?: { reaction?: Array<{ reactionmeddrapt?: string }> } }> };
  return data.results ?? [];
}

export async function caselawCases(query: string, pageSize = 5): Promise<{ ok: boolean; cases?: Array<{ name_abbreviation: string; decision_date?: string }>; detail?: string }> {
  // Caselaw Access Project now requires a token on /v1.
  const token = apiKey("CASELAW_TOKEN");
  if (!token) return { ok: false, detail: "CASELAW_TOKEN not configured" };
  try {
    const data = (await getJson(
      `https://api.case.law/v1/cases/?search=${encodeURIComponent(query)}&page_size=${pageSize}`,
      { Authorization: `Token ${token}` }
    )) as { results?: Array<{ name_abbreviation: string; decision_date?: string; court?: { name?: string } }> };
    return { ok: true, cases: data.results ?? [] };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ── Key-gated sources ──────────────────────────────────────────────────────

export async function finnhubQuote(symbol: string): Promise<{ ok: boolean; price?: number; change_pct?: number; detail?: string }> {
  const key = apiKey("FINNHUB_API_KEY");
  if (!key) return { ok: false, detail: "FINNHUB_API_KEY not configured" };
  try {
    const data = (await getJson(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${key}`)) as { c?: number; dp?: number };
    return { ok: data.c != null, price: data.c, change_pct: data.dp };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function fredSeries(seriesId: string): Promise<{ ok: boolean; latest?: number; detail?: string }> {
  const key = apiKey("FRED_API_KEY");
  if (!key) return { ok: false, detail: "FRED_API_KEY not configured" };
  try {
    const data = (await getJson(
      `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${key}&file_type=json&sort_order=desc&limit=1`
    )) as { observations?: Array<{ value?: string }> };
    const v = data.observations?.[0]?.value;
    return { ok: v != null, latest: v != null ? Number(v) : undefined };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function theSportsDb(sport = "basketball", league = "NBA"): Promise<{ ok: boolean; detail?: string }> {
  const key = apiKey("THESPORTSDB_API_KEY");
  if (!key) return { ok: false, detail: "THESPORTSDB_API_KEY not configured" };
  try {
    await getJson(`https://www.thesportsdb.com/api/v1/json/${key}/search_all_leagues.php?s=${sport}`);
    return { ok: true, detail: `league ${league} reachable` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function usdaFood(query: string): Promise<{ ok: boolean; count?: number; detail?: string }> {
  const key = apiKey("USDA_API_KEY");
  if (!key) return { ok: false, detail: "USDA_API_KEY not configured" };
  try {
    const data = (await getJson(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&api_key=${key}&pageSize=3`
    )) as { totalHits?: number };
    return { ok: true, count: data.totalHits };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function virusTotalUrlReport(url: string): Promise<{ ok: boolean; malicious?: number; detail?: string }> {
  const key = apiKey("VIRUSTOTAL_API_KEY");
  if (!key) return { ok: false, detail: "VIRUSTOTAL_API_KEY not configured" };
  try {
    const data = (await getJson(
      `https://www.virustotal.com/api/v3/urls/${Buffer.from(url).toString("base64url")}`, { "x-apikey": key }
    )) as { data?: { attributes?: { last_analysis_stats?: { malicious?: number } } } };
    return { ok: true, malicious: data.data?.attributes?.last_analysis_stats?.malicious ?? 0 };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
