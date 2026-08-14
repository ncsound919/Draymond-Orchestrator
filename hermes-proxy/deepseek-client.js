const OPENCODE_ZEN_URL = 'https://opencode.ai/zen/v1/chat/completions';
const OPENCODE_GO_URL = 'https://opencode.ai/zen/go/v1/chat/completions';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const PROVIDER_TIMEOUT_MS = 90_000;

/**
 * OpenAI-compatible providers in fallback order. All serve the DeepSeek V4
 * Flash family (the 0731 official build). opencode-free is the daily free
 * tier; opencode-go is the paid Go subscription; deepseek is the direct API.
 */
const OPENAI_PROVIDERS = [
  { name: 'opencode-free', url: OPENCODE_ZEN_URL, model: 'deepseek-v4-flash-free', env: 'OPENCODE_API_KEY' },
  { name: 'opencode-go', url: OPENCODE_GO_URL, model: 'deepseek-v4-flash', env: 'OPENCODE_API_KEY' },
  { name: 'deepseek', url: DEEPSEEK_URL, model: 'deepseek-v4-flash', env: 'DEEPSEEK_API_KEY' },
];

async function chatCompletions(url, key, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function parseChoice(data) {
  const choice = data.choices?.[0];
  const message = choice?.message ?? {};
  const toolCalls = (message.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name,
    arguments: tc.function?.arguments || '{}',
  }));
  return {
    content: message.content || '',
    toolCalls,
    reasoningContent: message.reasoning_content || '',
  };
}

/**
 * Gemini fallback (Google Generative Language API). Handles plain completions
 * and best-effort function calling via functionDeclarations.
 */
async function geminiComplete(messages, tools, system, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

  const contents = [];
  for (const m of messages || []) {
    if (m.role === 'tool') continue; // Gemini needs functionResponse pairing; skip for best-effort
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content ?? '') }],
    });
  }
  if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: 'Continue.' }] });

  const body = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens || 1024 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools && tools.length) {
    body.tools = [{
      functionDeclarations: tools
        .map((t) => t.function)
        .filter((f) => f && f.name),
    }];
  }

  const url = `${GEMINI_BASE_URL}/${model}:generateContent`;

  // `AQ.` keys are Google's new auth-key format. Official docs send them via
  // x-goog-api-key, but some accounts need the OAuth Bearer header — try both.
  const attempts = [
    { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  ];

  let lastErr;
  for (const headers of attempts) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`);
      }
      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts ?? [];

      let content = '';
      const toolCalls = [];
      for (const p of parts) {
        if (p.text) content += p.text;
        if (p.functionCall) {
          toolCalls.push({
            id: `gc-${Math.random().toString(36).slice(2, 10)}`,
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args || {}),
          });
        }
      }
      return { content, toolCalls, reasoningContent: '' };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('Gemini auth failed');
}

/**
 * One-shot DeepSeek V4 Flash (0731) chat completion with a provider fallback
 * chain. OpenAI-compatible function calling for the primary tiers.
 *
 * Order: opencode free → opencode Go paid → DeepSeek direct → Gemini.
 *
 * Returns { content, toolCalls, reasoningContent }.
 */
export async function complete(model, messages, tools, system, maxTokens) {
  const providers = OPENAI_PROVIDERS.filter((p) => process.env[p.env]);

  let lastErr;
  for (const p of providers) {
    const body = {
      model: p.model,
      messages: system
        ? [{ role: 'system', content: system }, ...messages]
        : messages,
      stream: false,
    };
    if (tools && tools.length) body.tools = tools;
    if (maxTokens) body.max_tokens = maxTokens;
    try {
      const data = await chatCompletions(p.url, process.env[p.env], body);
      return parseChoice(data);
    } catch (err) {
      lastErr = err;
      console.warn(`[deepseek-client] ${p.name} failed: ${err.message}. Trying next.`);
    }
  }

  if (providers.length === 0) {
    lastErr = new Error('No OpenAI-compatible provider configured (OPENCODE_API_KEY or DEEPSEEK_API_KEY)');
  }

  try {
    return await geminiComplete(messages, tools, system, maxTokens);
  } catch (gemErr) {
    console.warn(`[deepseek-client] gemini failed: ${gemErr.message}`);
    throw lastErr ?? gemErr;
  }
}
