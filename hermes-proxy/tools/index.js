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
  async web_search() {
    // Placeholder — wire a real search provider to enable.
    return { ok: false, error: 'web_search provider not configured' };
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
  async aetherdesk_list_agents() {
    return { ok: false, error: 'aetherdesk not configured' };
  },
  async aetherdesk_list_leads() {
    return { ok: false, error: 'aetherdesk not configured' };
  },
  async aetherdesk_launch_campaign() {
    return { ok: false, error: 'aetherdesk not configured' };
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
