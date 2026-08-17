import { NextRequest, NextResponse } from 'next/server';
import { appendAuditLog } from '@/lib/audit';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';
import { callLLM } from '@/lib/draymond/llm';

const VALID_AGENTS = new Set([
  'megacode', 'uplift', 'rex', 'maya', 'finn', 'cleo', 'lexa',
  'riggs', 'moss', 'scribe', 'echo', 'hype',
]);
const MAX_GOAL_LEN = 500;
const MAX_CONTEXT_KEYS = 20;
const LLM_TIMEOUT_MS = 25_000;

const AGENT_ROLES: Record<string, string> = {
  megacode: 'web and software development, code generation, file I/O, git operations',
  rex: 'sales outreach, pipeline tracking, CRM updates, follow-up sequences',
  maya: 'marketing content, social media, email campaigns, copywriting',
  finn: 'invoicing, expense tracking, financial summaries, billing',
  cleo: 'project management, scheduling, SOPs, task tracking',
  lexa: 'client onboarding, check-ins, satisfaction tracking, communication',
  uplift: 'general research, web browsing, complex multi-step reasoning, coordination',
  riggs: 'software engineering, debugging, code review, API research',
  moss: 'research and OSINT, lead enrichment, competitive intelligence, source verification',
  scribe: 'communications, email drafting and sending, calendar scheduling, document management',
  echo: 'call center operations, lead triage, outbound campaigns, agent monitoring',
  hype: 'media and creative, promo videos, scriptwriting, marketing copy',
};

interface ValidatedTask {
  id: string;
  description: string;
  agent: string;
  priority: string;
  context: Record<string, unknown>;
}

interface DecomposeResponse {
  tasks: ValidatedTask[];
  recommended_mode: 'parallel' | 'sequential';
  reasoning: string;
}

/**
 * Strip markdown code fences, extract JSON, validate structure.
 * Enforces agent allowlist so a jailbroken LLM can't inject arbitrary agents.
 */
function parseLLMResponse(raw: string): DecomposeResponse {
  // Remove optional markdown code fences
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(stripped);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an object');
    obj = parsed as Record<string, unknown>;
  } catch {
    throw new Error(
      'LLM returned non-JSON — retry or simplify the goal',
    );
  }

  if (!Array.isArray(obj.tasks))
    throw new Error('LLM response missing tasks array');

  const tasks: ValidatedTask[] = (obj.tasks as unknown[]).map((t, i) => {
    if (!t || typeof t !== 'object') throw new Error(`tasks[${i}] is not an object`);
    const task = t as Record<string, unknown>;
    const rawAgent = typeof task.agent === 'string' ? task.agent.toLowerCase() : '';
    return {
      id: typeof task.id === 'string' ? task.id.trim().slice(0, 64) : `task-${i + 1}`,
      description:
        typeof task.description === 'string'
          ? task.description.slice(0, 2000)
          : '',
      // Strict allowlist — fallback to uplift for unknown names
      agent: VALID_AGENTS.has(rawAgent) ? rawAgent : 'uplift',
      priority: ['high', 'normal', 'low'].includes(task.priority as string)
        ? (task.priority as string)
        : 'normal',
      context:
        task.context && typeof task.context === 'object' && !Array.isArray(task.context)
          ? (task.context as Record<string, unknown>)
          : {},
    };
  });

  return {
    tasks,
    recommended_mode:
      obj.recommended_mode === 'sequential' ? 'sequential' : 'parallel',
    reasoning:
      typeof obj.reasoning === 'string' ? obj.reasoning.slice(0, 1000) : '',
  };
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const bodyResult = await parseJsonBody(request);
    if (bodyResult.error) return bodyResult.error;
    const body = bodyResult.data as Record<string, unknown>;

    const goal =
      typeof body?.goal === 'string' ? body.goal.trim() : '';
    if (!goal)
      return NextResponse.json({ error: 'goal is required' }, { status: 400 });
    if (goal.length > MAX_GOAL_LEN)
      return NextResponse.json(
        { error: `goal must be ${MAX_GOAL_LEN} characters or fewer` },
        { status: 400 },
      );

    // Sanitize context — accept plain object only, limit keys
    let context: Record<string, unknown> = {};
    if (body?.context && typeof body.context === 'object' && !Array.isArray(body.context)) {
      const raw = body.context as Record<string, unknown>;
      context = Object.fromEntries(
        Object.entries(raw).slice(0, MAX_CONTEXT_KEYS),
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    const systemPrompt = [
      'You are Draymond, the orchestrator for a solopreneur OS.',
      'Decompose the goal into specific tasks and assign each to the right agent.',
      '',
      'Agents and specialties:',
      ...Object.entries(AGENT_ROLES).map(([k, v]) => `- ${k}: ${v}`),
      '',
      'Respond ONLY with a valid JSON object — no markdown fences, no prose:',
      '{',
      '  "tasks": [{ "id": "task-1", "description": "...", "agent": "agent_name", "priority": "high|normal|low", "context": {} }],',
      '  "recommended_mode": "parallel|sequential",',
      '  "reasoning": "brief explanation"',
      '}',
    ].join('\n');

    let content: string;
    try {
      content = await callLLM({
        provider: 'opencode-free',
        system: systemPrompt,
        userMessage: `Goal: ${goal}\n<context>${JSON.stringify(context)}</context>`,
        maxTokens: 800,
        temperature: 0.2,
        timeoutMs: LLM_TIMEOUT_MS,
        toonify: true,
        fallbackKey: 'api.swarm.decompose',
        fallbackContext: { userMessage: goal },
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError')
        throw new Error('LLM timed out — try again');
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!content)
      throw new Error('Empty response from LLM');

    const parsed = parseLLMResponse(content);

    await appendAuditLog({
      event: 'task_decomposition',
      goal,
      task_count: parsed.tasks.length,
      mode: parsed.recommended_mode,
      agent: 'draymond',
    });

    return NextResponse.json(parsed);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Decomposition failed' },
      { status: 500 },
    );
  }
}
