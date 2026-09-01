import http from 'node:http';
import { complete } from './deepseek-client.js';
import { tools, executeTool } from './tools/index.js';

const PORT = Number(process.env.SQUAD_PORT || 8650);
const MAX_BODY_BYTES = 1 * 1024 * 1024;

export const SPECIALISTS = {
  riggs: {
    name: 'Riggs',
    codename: 'The Mechanic',
    role: 'Software Engineer',
    persona:
      'You are Riggs, a senior software engineer agent. You plan, debug, and explain ' +
      'technical work with precision. Use web_search to look up current docs and APIs, ' +
      'but at most 2 searches per task. Output clean, concrete solutions with exact ' +
      'commands and file-level guidance. Keep replies concise and actionable.',
    tools: ['get_time', 'get_health', 'web_search'],
  },
  moss: {
    name: 'Moss',
    codename: 'The Hunter',
    role: 'Research & OSINT Analyst',
    persona:
      'You are Moss, a research and OSINT analyst. You gather intelligence, enrich leads, ' +
      'and surface competitive or market facts. Use web_search to verify claims with sources, ' +
      'but run at most 3 searches per task — once you have enough, stop and synthesize. ' +
      'Summarize findings as structured briefs with citations and confidence levels. ' +
      'Never fabricate sources.',
    tools: ['get_time', 'web_search'],
  },
  scribe: {
    name: 'Scribe',
    codename: 'The Forger',
    role: 'Communications Agent',
    persona:
      'You are Scribe, a communications agent. You DRAFT, polish, and structure email, ' +
      'calendar, and document content for the operator to review and send. NOTE: email ' +
      'sending, calendar, and Drive integrations are NOT yet wired — never claim you sent ' +
      'or scheduled anything; always hand back polished drafts. Keep messages professional ' +
      'and concise.',
    tools: ['get_time'],
  },
  echo: {
    name: 'Echo',
    codename: 'The Operator',
    role: 'Call Center & Voice Agent',
    persona:
      'You are Echo, a call center operations agent. You triage leads, manage agents, and ' +
      'launch outbound campaigns through AetherDesk. Use aetherdesk_list_agents, ' +
      'aetherdesk_list_leads, and aetherdesk_launch_campaign to operate the center. ' +
      'Recommend call lists and campaign targets from lead data. Be precise with lead ' +
      'IDs and numbers.',
    tools: ['aetherdesk_list_agents', 'aetherdesk_list_leads', 'aetherdesk_launch_campaign', 'get_time'],
  },
  hype: {
    name: 'Hype',
    codename: 'The Showman',
    role: 'Media & Creative Agent',
    persona:
      'You are Hype, a media and creative agent. You script and produce narrated promo ' +
      'videos and marketing content. Use create_promo_video to generate narrated ' +
      'slide-videos, and at most 2 web_search calls for inspiration or facts. Write ' +
      'punchy, on-brand scripts with clear scene lines and a confident voiceover tone.',
    tools: ['create_promo_video', 'web_search', 'get_time'],
  },
};

export function systemFor(slug) {
  return SPECIALISTS[slug]?.persona ?? 'You are a helpful assistant.';
}

export function toolsFor(slug) {
  const allowed = new Set(SPECIALISTS[slug]?.tools ?? []);
  return tools.filter((t) => allowed.has(t.function.name));
}

export async function runSpecialist(slug, messages, sessionId) {
  const persona = systemFor(slug);
  const filtered = toolsFor(slug);
  const usedTools = [];
  let modelMessages = (messages || []).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? ''),
  }));
  let finalText = '';
  const maxRounds = 8;

  for (let round = 0; round < maxRounds; round++) {
    const result = await complete('deepseek-v4-flash', modelMessages, filtered, persona);
    if (result.toolCalls && result.toolCalls.length) {
      if (round >= maxRounds - 1) break;
      for (const tc of result.toolCalls) {
        let parsed;
        try {
          parsed = JSON.parse(tc.arguments || '{}');
        } catch {
          parsed = {};
        }
        const out = await executeTool(tc.name, parsed);
        usedTools.push(tc.name);
        modelMessages = modelMessages.concat([
          {
            role: 'assistant',
            content: '',
            reasoning_content: result.reasoningContent || undefined,
            tool_calls: [
              { id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments || '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) },
        ]);
      }
      continue;
    }
    finalText = (result.content || '').trim();
    break;
  }

  if (!finalText) {
    const synthesis = await complete(
      'deepseek-v4-flash',
      modelMessages,
      [],
      persona + '\n\nYou have already gathered the information you need. Provide your final answer now based on the tool results above. Be concise and do not call any tools.'
    );
    finalText = (synthesis.content || '').trim();
  }

  if (!finalText) finalText = 'The task could not be completed in time. (interrupted)';
  return { text: finalText, usedTools, sessionId: String(sessionId || 'default') };
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error('Request body too large');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
function setCors(req, res) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && LOOPBACK_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export const server = http.createServer(async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok', service: 'squad', agents: Object.keys(SPECIALISTS).length });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/v1/agents') {
    const list = Object.entries(SPECIALISTS).map(([slug, s]) => ({
      slug,
      name: s.name,
      codename: s.codename,
      role: s.role,
      tools: s.tools,
    }));
    sendJson(res, 200, { agents: list });
    return;
  }

  const m = url.pathname.match(/^\/api\/v1\/agents\/([a-z0-9-]+)\/invoke$/);
  if (req.method === 'POST' && m) {
    const slug = m[1];
    if (!SPECIALISTS[slug]) {
      sendJson(res, 404, { ok: false, error: `unknown specialist: ${slug}` });
      return;
    }
    let body;
    try {
      body = JSON.parse((await readBody(req)).toString('utf8'));
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
      return;
    }
    const action = String(body.action || '');
    const input =
      body.input && typeof body.input === 'object' && !Array.isArray(body.input)
        ? body.input
        : (() => {
            // Strip control fields from the forwarded input payload.
            const { action: _a, session_id: _s, ...rest } = body;
            return rest;
          })();
    const sessionId = body.session_id;
    const userMessage = action
      ? `Task: ${action}${input && Object.keys(input).length ? `\nInput: ${JSON.stringify(input)}` : ''}`
      : JSON.stringify(input);
    try {
      const result = await runSpecialist(slug, [{ role: 'user', content: userMessage }], sessionId);
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[squad-service] ${Object.keys(SPECIALISTS).length} specialists on http://127.0.0.1:${PORT}`);
  });
}
