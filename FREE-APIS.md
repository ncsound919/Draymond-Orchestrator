# Free APIs to Power Overlay365 — Acquisition Plan

Aligned to the 4 revenue engines + operations. All have **free tiers** — acquire
the mission-critical ones first, wire into the news/ops layer.

---

## E1 · Platform tiers (Health / Wealth / Justice)

| API | Free tier | Use | Status |
|---|---|---|---|
| **Finnhub** | US stocks/fundamentals free | Wealth tier: prices, fundamentals | 🔲 to acquire |
| **Alpha Vantage** | 25 req/day | Wealth: stocks/forex/crypto | 🔲 |
| **CoinGecko** | free, 30/min | Wealth: crypto | 🔲 |
| **FRED** | free | Wealth: macro insights | 🔲 |
| **FDA OpenFDA** | free | Health: drug/device data | 🔲 |
| **USDA FoodData Central** | free | Health: nutrition | 🔲 |
| **Open Food Facts** | free | Health: food products | 🔲 |
| **Caselaw Access Project** | free | Justice: court opinions | 🔲 |
| **CourtListener** | free | Justice: dockets/cases | 🔲 |

## E2 · B2B (Aetherdesk + marketing)

| API | Free tier | Use | Status |
|---|---|---|---|
| **Resend** | 3k emails/mo | Agentmail + client comms | 🔲 |
| **Twilio SendGrid** | 100/day | Notifications | 🔲 |
| **Cal.com API** | free | Aetherdesk appointment booking | 🔲 |
| **Hunter** | 25 lookups/mo | Lead gen (marketing) | 🔲 |
| **Abstract Email Validation** | free | Lead quality | 🔲 |
| **ip-api.com** | free | Geotag inbound calls | 🔲 |

## E3 · Tooling / security (Auditor + sellable audits)

| API | Free tier | Use | Status |
|---|---|---|---|
| **VirusTotal** | 500 req/day | Malware/url intel in audits | 🔲 |
| **Shodan** | 100 credits | Internet exposure | 🔲 |
| **AbuseIPDB** | free | IP reputation | 🔲 |
| **Have I Been Pwned** | free | Breach checks in audits | 🔲 |
| **UrlScan.io** | 50/mo | Web page intel | 🔲 |
| **SecurityTrails** | free | Domain/DNS intel | 🔲 |

## E4 · Vertical (sports / music / research)

| API | Free tier | Use | Status |
|---|---|---|---|
| **TheSportsDB** | free | Sports stats/intel (Sports Steve) | 🔲 |
| **MusicBrainz** | free | Music metadata (music-rights) | 🔲 |
| **iTunes Search API** | free | Music lookup | 🔲 |
| **OpenAlex** | free | Research papers (open-notebook) | 🔲 |
| **PubMed E-utilities** | free | Bio/health research | 🔲 |
| **Crossref** | free | DOI/citations (BookBridge) | 🔲 |

## Operations / LLM (mission-wide)

| API | Free tier | Use | Status |
|---|---|---|---|
| **OpenRouter** | free credits | LLM routing (litellm) | 🔲 |
| **Groq** | free, fast | Fast inference fallback | 🔲 |
| **HuggingFace Inference** | free | Open models | 🔲 |
| **SerpAPI / Google CSE** | 100/day | Search | 🔲 |
| **Tavily** | 1k/mo | Agent research | 🔲 |
| **OpenWeatherMap** | free | Ops/scheduling | 🔲 |
| **Nominatim (OSM)** | free | Geocoding local biz | 🔲 |
| **ExchangeRate-API** | free | Finance conversions | 🔲 |
| **ip-api.com** | free | Geo analytics | 🔲 |

---

## Suggested acquisition order (mission-critical first)
1. **Finnhub + FRED + CoinGecko** → Wealth tier features (E1)
2. **OpenFDA + USDA** → Health tier (E1)
3. **Caselaw Access Project + CourtListener** → Justice tier (E1)
4. **VirusTotal + Shodan + UrlScan** → Security audits (E3)
5. **TheSportsDB** → Sports intel (E4)
6. **MusicBrainz** → Music rights (E4)
7. **Resend + Cal.com** → Aetherdesk client ops (E2)
8. **OpenAlex + PubMed** → Research service (E4)

Each key goes into `.env.local` (gitignored) and is read by the ops layer; add
them to `docs/` as a reference PDF/key sheet like the News APIs.

## Wiring note
The news/ops layer (`src/lib/draymond/`) already ingests from env-configured
APIs — new keys follow the same pattern (add to `.env.local`, add a fetcher to
the relevant module, add to the daily/`ops` route).
