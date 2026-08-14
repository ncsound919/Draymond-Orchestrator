import { complete } from './deepseek-client.js';
import { tools, executeTool } from './tools/index.js';
import { matchSkills } from './skills.js';
import { getContext, appendTurn } from './memory.js';

const DEFAULT_MAX_ROUNDS = 8;

function buildSystem(memoryCtx, userMessage) {
  const skillPacks = matchSkills(userMessage);
  const lines = [];
  lines.push(
    'You are Hermes, a warm, helpful companion on the user\'s phone. ' +
    'Talk like a friend: natural, plain language, no jargon, no field names, ' +
    'no JSON, no markdown unless it genuinely helps (a short list is fine). ' +
    'Answer the user\'s actual question first, then offer next steps. ' +
    'If a tool is available and relevant, quietly use it to get real information ' +
    'or take actions — but never describe the internal tool-call loop, steps, ' +
    'IDs, or reasoning to the user. Keep replies short and conversational.'
  );
  if (memoryCtx?.summary) lines.push(`\n[Earlier context]\n${memoryCtx.summary}`);
  if (skillPacks.length) {
    lines.push(`\n[Active capabilities]\n${skillPacks.map((s) => `- ${s.instruction}`).join('\n')}`);
  }
  return lines.join('\n');
}

/**
 * Run the agent loop. Returns { text, usedTools, sessionId }.
 * Persists the visible turn to memory.
 */
export async function runAgent(messages, sessionId, opts = {}) {
  const maxRounds = opts.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const sid = String(sessionId || 'default');
  const userMessage = (messages || []).slice(-1)[0]?.content || '';

  const memoryCtx = await getContext(sid);

  const promptMessages = [
    ...(memoryCtx.turns || []).map((t) => ({ role: t.role, content: t.content })),
    ...(messages || []).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? ''),
    })),
  ];

  const system = buildSystem(memoryCtx, userMessage);
  const usedTools = [];

  let modelMessages = promptMessages;
  let finalText = '';

  for (let round = 0; round < maxRounds; round++) {
    const result = await complete('deepseek-v4-flash', modelMessages, tools, system);

    if (result.toolCalls && result.toolCalls.length) {
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
          { role: 'assistant', content: '', reasoning_content: result.reasoningContent || undefined, tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments || '{}' } }] },
          { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) },
        ]);
      }
      continue;
    }

    finalText = (result.content || '').trim();
    break;
  }

  if (!finalText) {
    finalText = 'The task could not be completed in time. (interrupted)';
  }

  if (userMessage) {
    await appendTurn(sid, { role: 'user', content: userMessage }).catch(() => {});
  }
  await appendTurn(sid, { role: 'assistant', content: finalText }).catch(() => {});

  return { text: finalText, usedTools, sessionId: sid };
}
