// ============================================================================
// DRAYMOND FREE-API KEY REGISTRY — the "fill the free API list" audit
// ============================================================================
// Maps every API in Draymond/FREE-APIS.md to the env var(s) it needs, checks
// which are configured, and reports a machine-readable status the fleet (the
// brain-decision engine, the repair team, ops dashboards) can act on.
//
// Keys live ONLY in .env.local (gitignored) — this module never stores keys,
// only "configured? yes/no" so secrets never leak into logs, the registry, or
// email.
//
// The fleet workflow:
//   1. api_key_audit (scheduled) runs this and records an outcome to
//      self-learning.
//   2. The brain-decision engine reads keyStatus() and routes MISSING
//      mission-critical keys to the acquisition list (signup URL) so a
//      coding/ops agent can generate the key or the human fills it.
//   3. When a key is added to .env.local, the next audit marks it configured.
// ============================================================================

export type ApiKeyState = 'configured' | 'missing' | 'no-key-needed';

export interface ApiKeyEntry {
  /** Short name matching FREE-APIS.md. */
  name: string;
  /** Revenue engine / category (E1-E4, ops). */
  engine: string;
  /** Env var(s) that must be set. */
  envVars: string[];
  /** True when the API works without a key (some free tiers are keyless). */
  noKey: boolean;
  /** Acquisition URL so the fleet/human can get the key. */
  signupUrl?: string;
  /** What the API powers in the ecosystem. */
  use: string;
  /** Which fetcher uses it (module.function), when wired. */
  fetcher?: string;
}

export const FREE_API_REGISTRY: ApiKeyEntry[] = [
  // ── E1 · Platform tiers ─────────────────────────────────────────────────
  { name: 'Finnhub', engine: 'E1', envVars: ['FINNHUB_API_KEY'], noKey: false, signupUrl: 'https://finnhub.io/register', use: 'Wealth: US stock prices/fundamentals', fetcher: 'data-apis.finnhubQuote' },
  { name: 'Alpha Vantage', engine: 'E1', envVars: ['ALPHAVANTAGE_API_KEY'], noKey: false, signupUrl: 'https://www.alphavantage.co/support/#api-key', use: 'Wealth: stocks/forex/crypto' },
  { name: 'CoinGecko', engine: 'E1', envVars: [], noKey: true, use: 'Wealth: crypto prices', fetcher: 'data-apis.cryptoPrices' },
  { name: 'FRED', engine: 'E1', envVars: ['FRED_API_KEY'], noKey: false, signupUrl: 'https://fred.stlouisfed.org/docs/api/api_key.html', use: 'Wealth: macro insights', fetcher: 'data-apis.fredSeries' },
  { name: 'OpenFDA', engine: 'E1', envVars: [], noKey: true, use: 'Health: drug/device data', fetcher: 'data-apis.fdaDrugEvents' },
  { name: 'USDA FoodData Central', engine: 'E1', envVars: ['USDA_API_KEY'], noKey: false, signupUrl: 'https://fdc.nal.usda.gov/api-key-signup.html', use: 'Health: nutrition', fetcher: 'data-apis.usdaFood' },
  { name: 'Open Food Facts', engine: 'E1', envVars: [], noKey: true, use: 'Health: food products' },
  { name: 'Caselaw Access Project', engine: 'E1', envVars: ['CASELAW_TOKEN'], noKey: false, signupUrl: 'https://api.case.law/v1/signup', use: 'Justice: court opinions', fetcher: 'data-apis.caselawCases' },
  { name: 'CourtListener', engine: 'E1', envVars: ['COURTLISTENER_API_KEY'], noKey: false, signupUrl: 'https://www.courtlistener.com/accounts/register/', use: 'Justice: dockets/cases' },

  // ── E2 · B2B (Aetherdesk + marketing) ──────────────────────────────────
  { name: 'Stripe (billing)', engine: 'E2', envVars: ['STRIPE_SECRET_KEY'], noKey: false, signupUrl: 'https://dashboard.stripe.com/apikeys', use: 'Billing — settled revenue for the Treasurer (treasury.ts)', fetcher: 'treasury.fetchStripeCharges' },
  { name: 'Resend', engine: 'E2', envVars: ['RESEND_API_KEY'], noKey: false, signupUrl: 'https://resend.com/api-keys', use: 'Agentmail + client comms' },
  { name: 'Twilio SendGrid', engine: 'E2', envVars: ['SENDGRID_API_KEY'], noKey: false, signupUrl: 'https://signup.sendgrid.com/', use: 'Notifications' },
  { name: 'Cal.com API', engine: 'E2', envVars: ['CALCOM_API_KEY'], noKey: false, signupUrl: 'https://app.cal.com/settings/developer/api-keys', use: 'Aetherdesk appointment booking' },
  { name: 'Hunter', engine: 'E2', envVars: ['HUNTER_API_KEY'], noKey: false, signupUrl: 'https://hunter.io/users/sign_up', use: 'Lead gen (marketing)' },
  { name: 'Abstract Email Validation', engine: 'E2', envVars: ['ABSTRACT_EMAIL_API_KEY'], noKey: false, signupUrl: 'https://www.abstractapi.com/api/email-validation', use: 'Lead quality' },
  { name: 'ip-api.com', engine: 'E2', envVars: [], noKey: true, use: 'Geotag inbound calls' },

  // ── E3 · Tooling / security ────────────────────────────────────────────
  { name: 'VirusTotal', engine: 'E3', envVars: ['VIRUSTOTAL_API_KEY'], noKey: false, signupUrl: 'https://www.virustotal.com/gui/join-us', use: 'Malware/url intel in audits', fetcher: 'data-apis.virusTotalUrlReport' },
  { name: 'Shodan', engine: 'E3', envVars: ['SHODAN_API_KEY'], noKey: false, signupUrl: 'https://account.shodan.io/register', use: 'Internet exposure' },
  { name: 'AbuseIPDB', engine: 'E3', envVars: ['ABUSEIPDB_API_KEY'], noKey: false, signupUrl: 'https://www.abuseipdb.com/register', use: 'IP reputation' },
  { name: 'Have I Been Pwned', engine: 'E3', envVars: ['HIBP_API_KEY'], noKey: false, signupUrl: 'https://haveibeenpwned.com/API/Key', use: 'Breach checks in audits' },
  { name: 'UrlScan.io', engine: 'E3', envVars: ['URLSCAN_API_KEY'], noKey: false, signupUrl: 'https://urlscan.io/user/sign_up', use: 'Web page intel' },
  { name: 'SecurityTrails', engine: 'E3', envVars: ['SECURITYTRAILS_API_KEY'], noKey: false, signupUrl: 'https://securitytrails.com/app/signup', use: 'Domain/DNS intel' },

  // ── E4 · Vertical (sports / music / research) ──────────────────────────
  { name: 'TheSportsDB', engine: 'E4', envVars: ['THESPORTSDB_API_KEY'], noKey: false, signupUrl: 'https://www.thesportsdb.com/free_api.php', use: 'Sports stats/intel (Sports Steve)', fetcher: 'data-apis.theSportsDb' },
  { name: 'MusicBrainz', engine: 'E4', envVars: [], noKey: true, use: 'Music metadata (music-rights)', fetcher: 'data-apis.musicArtist' },
  { name: 'iTunes Search API', engine: 'E4', envVars: [], noKey: true, use: 'Music lookup' },
  { name: 'OpenAlex', engine: 'E4', envVars: [], noKey: true, use: 'Research papers (open-notebook)', fetcher: 'data-apis.openAlexWorks' },
  { name: 'PubMed E-utilities', engine: 'E4', envVars: [], noKey: true, use: 'Bio/health research', fetcher: 'data-apis.pubmedSearch' },
  { name: 'Crossref', engine: 'E4', envVars: [], noKey: true, use: 'DOI/citations (BookBridge)' },

  // ── Operations / LLM ───────────────────────────────────────────────────
  { name: 'OpenRouter', engine: 'ops', envVars: ['OPENROUTER_API_KEY'], noKey: false, signupUrl: 'https://openrouter.ai/keys', use: 'LLM routing (litellm)' },
  { name: 'Groq', engine: 'ops', envVars: ['GROQ_API_KEY'], noKey: false, signupUrl: 'https://console.groq.com/keys', use: 'Fast inference fallback' },
  { name: 'HuggingFace Inference', engine: 'ops', envVars: ['HF_API_KEY'], noKey: false, signupUrl: 'https://huggingface.co/settings/tokens', use: 'Open models' },
  { name: 'SerpAPI / Google CSE', engine: 'ops', envVars: ['SERPAPI_KEY'], noKey: false, signupUrl: 'https://serpapi.com/manage-api-key', use: 'Search' },
  { name: 'Tavily', engine: 'ops', envVars: ['TAVILY_API_KEY'], noKey: false, signupUrl: 'https://tavily.com/', use: 'Agent research' },
  { name: 'OpenWeatherMap', engine: 'ops', envVars: ['OPENWEATHER_API_KEY'], noKey: false, signupUrl: 'https://home.openweathermap.org/users/sign_up', use: 'Ops/scheduling' },
  { name: 'Nominatim (OSM)', engine: 'ops', envVars: [], noKey: true, use: 'Geocoding local biz' },
  { name: 'ExchangeRate-API', engine: 'ops', envVars: ['EXCHANGERATE_API_KEY'], noKey: false, signupUrl: 'https://www.exchangerate-api.com/sign-up', use: 'Finance conversions' },

  // ── News (already wired in src/lib/draymond/news.ts) ───────────────────
  { name: 'NewsAPI', engine: 'ops', envVars: ['NEWSAPI_KEY'], noKey: false, signupUrl: 'https://newsapi.org/register', use: 'News ingest', fetcher: 'news.ingestNews' },
  { name: 'GNews', engine: 'ops', envVars: ['GNEWS_API_KEY'], noKey: false, signupUrl: 'https://gnews.io/register', use: 'News ingest', fetcher: 'news.ingestNews' },
  { name: 'WorldNews API', engine: 'ops', envVars: ['WORLDNEWS_API_KEY'], noKey: false, signupUrl: 'https://worldnewsapi.com/register', use: 'News ingest', fetcher: 'news.ingestNews' },

  // ── Kaggle (new-style KGAT_ token) ─────────────────────────────────────
  { name: 'Kaggle', engine: 'E4', envVars: ['KAGGLE_API_TOKEN'], noKey: false, signupUrl: 'https://www.kaggle.com/settings/api', use: 'Datasets/competitions for research + backtesting', fetcher: 'data-apis.kaggleSearchDatasets' },
];

/**
 * Audit which API keys are configured (reads process.env only — never the
 * values). Returns per-API state plus aggregate counts.
 */
export function auditApiKeys(): {
  checkedAt: string;
  configured: number;
  missing: number;
  noKey: number;
  total: number;
  items: Array<ApiKeyEntry & { state: ApiKeyState; env: string }>;
  missingNames: string[];
} {
  const items = FREE_API_REGISTRY.map((entry) => {
    if (entry.noKey) return { ...entry, state: 'no-key-needed' as const, env: '' };
    const present = entry.envVars.filter((v) => Boolean(process.env[v]));
    const state: ApiKeyState = present.length > 0 ? 'configured' : 'missing';
    return { ...entry, state, env: present.join(',') };
  });

  const configured = items.filter((i) => i.state === 'configured').length;
  const missing = items.filter((i) => i.state === 'missing').length;
  const noKey = items.filter((i) => i.state === 'no-key-needed').length;

  return {
    checkedAt: new Date().toISOString(),
    configured,
    missing,
    noKey,
    total: items.length,
    items,
    missingNames: items.filter((i) => i.state === 'missing').map((i) => i.name),
  };
}

/** Mission-critical keys still missing (drives the fleet acquisition list). */
export function missingCriticalKeys(limit = 12): Array<{ name: string; envVars: string[]; signupUrl?: string; engine: string }> {
  return auditApiKeys().items
    .filter((i) => i.state === 'missing')
    .filter((i) => i.engine !== 'ops') // ops are nice-to-have; engine keys are mission
    .slice(0, limit)
    .map((i) => ({ name: i.name, envVars: i.envVars, signupUrl: i.signupUrl, engine: i.engine }));
}
