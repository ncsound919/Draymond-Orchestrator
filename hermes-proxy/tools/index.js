/**
 * Hermes tool registry — OpenAI function-calling schema + dispatcher.
 * `tools` is the array passed to the LLM; `executeTool(name, args)` runs one.
 */

function tool(name, description, parameters = {}) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties: parameters, additionalProperties: false },
    },
  };
}

export const tools = [
  tool('get_time', 'Get the current server date and time.', { timezone: { type: 'string', description: 'IANA timezone, optional' } }),
  tool('get_health', 'Check the health of this Hermes gateway.'),
  tool('web_search', 'Search the web for current information.', {
    query: { type: 'string', description: 'Search query' },
  }),
  tool('calendar_create_event', 'Create a calendar event.', {
    title: { type: 'string', description: 'Event title' },
    start: { type: 'string', description: 'ISO start time' },
    end: { type: 'string', description: 'ISO end time' },
  }),
  tool('drive_create_document', 'Create a Google Drive document.', {
    title: { type: 'string', description: 'Document title' },
    content: { type: 'string', description: 'Document body' },
  }),
  tool('gmail_send', 'Send an email via Gmail.', {
    to: { type: 'string', description: 'Recipient address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email body' },
  }),
  tool('gmail_search', 'Search Gmail messages.', {
    query: { type: 'string', description: 'Search query' },
  }),
  tool('drive_search', 'Search Google Drive files.', {
    query: { type: 'string', description: 'Search query' },
  }),
  tool('aetherdesk_list_agents', 'List AetherDesk call-center agents.'),
  tool('aetherdesk_list_leads', 'List AetherDesk campaign leads.'),
  tool('aetherdesk_launch_campaign', 'Launch an AetherDesk outbound campaign.', {
    profile_id: { type: 'string', description: 'Caller profile id' },
    lead_limit: { type: 'number', description: 'Max leads to call' },
  }),
  tool('create_promo_video', 'Generate a promotional video from a script.', {
    script: { type: 'string', description: 'Video script' },
  }),
];

// Port 3010 is OpenHub; OmniResearch lives on 3012.
const OMNI_URL = process.env.OMNI_RESEARCH_URL || 'http://127.0.0.1:3012';
const AETHERDESK_URL = process.env.AETHERDESK_BASE_URL || 'http://127.0.0.1:8002';
// Internal key — same value AetherDesk expects as x-api-key.
const AETHERDESK_KEY =
  process.env.AETHERDESK_API_KEY || process.env.INTERNAL_API_KEY || '';

async function fetchJson(url, opts = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

const TOOL_IMPL = {
  async get_time(args) {
    const tz = args?.timezone || 'UTC';
    try {
      return { ok: true, now: new Date().toLocaleString('en-US', { timeZone: tz }) };
    } catch {
      return { ok: true, now: new Date().toISOString() };
    }
  },
  async get_health() {
    return { ok: true, status: 'healthy', uptimeMs: process.uptime() * 1000 };
  },
  // REAL: routed through OmniResearch (:3012) multi-harvest — keyless
  // ArXiv/OpenAlex/Wikipedia/PubMed fan-out (no /api/web-search on Omni).
  async web_search(args) {
    const query = String(args?.query || '').trim();
    if (!query) return { ok: false, error: 'query is required' };
    try {
      const { status, ok, body } = await fetchJson(`${OMNI_URL}/api/integrations/multi-harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, maxPerSource: 5 }),
        timeoutMs: 30000,
      });
      if (!ok) return { ok: false, error: `omni-research HTTP ${status}` };
      const sources = Array.isArray(body?.sources)
        ? body.sources
        : Array.isArray(body?.results)
          ? body.results
          : [];
      const results = sources.slice(0, 8).map((r) => ({
        title: String(r.title ?? r.name ?? ''),
        url: String(r.url ?? r.link ?? ''),
        snippet: String(r.summary ?? r.abstract ?? r.snippet ?? r.excerpt ?? '').slice(0, 400),
        source: String(r.source ?? r.database ?? ''),
      }));
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: `web_search failed: ${err instanceof Error ? err.message : err}` };
    }
  },
  async calendar_create_event() {
    return { ok: false, error: 'calendar integration not configured' };
  },
  async drive_create_document() {
    return { ok: false, error: 'drive integration not configured' };
  },
  async gmail_send() {
    return { ok: false, error: 'gmail integration not configured' };
  },
  async gmail_search() {
    return { ok: false, error: 'gmail integration not configured' };
  },
  async drive_search() {
    return { ok: false, error: 'drive integration not configured' };
  },
  // REAL: wired to the AetherDesk API (:8002) with the internal key.
  async aetherdesk_list_agents() {
    if (!AETHERDESK_KEY) return { ok: false, error: 'aetherdesk not configured (no internal key)' };
    try {
      const { status, ok, body } = await fetchJson(
        `${AETHERDESK_URL}/api/v1/tenants/TENANT-001/agents`,
        { headers: { 'x-api-key': AETHERDESK_KEY } },
      );
      if (!ok) return { ok: false, error: `aetherdesk HTTP ${status}` };
      return { ok: true, agents: Array.isArray(body) ? body : body?.agents ?? [] };
    } catch (err) {
      return { ok: false, error: `aetherdesk_list_agents failed: ${err instanceof Error ? err.message : err}` };
    }
  },
  async aetherdesk_list_leads() {
    if (!AETHERDESK_KEY) return { ok: false, error: 'aetherdesk not configured (no internal key)' };
    try {
      const { status, ok, body } = await fetchJson(
        `${AETHERDESK_URL}/api/v1/campaign/leads?status=new`,
        { headers: { 'x-api-key': AETHERDESK_KEY } },
      );
      if (!ok) return { ok: false, error: `aetherdesk HTTP ${status}` };
      return { ok: true, leads: Array.isArray(body) ? body : [] };
    } catch (err) {
      return { ok: false, error: `aetherdesk_list_leads failed: ${err instanceof Error ? err.message : err}` };
    }
  },
  async aetherdesk_launch_campaign(args) {
    if (!AETHERDESK_KEY) return { ok: false, error: 'aetherdesk not configured (no internal key)' };
    try {
      const { status, ok, body } = await fetchJson(
        `${AETHERDESK_URL}/api/v1/campaign/launch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': AETHERDESK_KEY },
          body: JSON.stringify({
            profile_id: String(args?.profile_id || 'default'),
            max_concurrent: Number(args?.max_concurrent || 1),
            lead_limit: Number(args?.lead_limit || 10),
          }),
        },
        30000,
      );
      if (!ok) return { ok: false, error: `aetherdesk HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}` };
      return { ok: true, campaign: body };
    } catch (err) {
      return { ok: false, error: `aetherdesk_launch_campaign failed: ${err instanceof Error ? err.message : err}` };
    }
  },
  async create_promo_video() {
    return { ok: false, error: 'video generation not configured' };
  },
};

export async function executeTool(name, args = {}) {
  const impl = TOOL_IMPL[name];
  if (!impl) return { ok: false, error: `unknown tool: ${name}` };
  try {
    return await impl(args);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
