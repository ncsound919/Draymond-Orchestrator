// ============================================================================
// DRAYMOND AGENT IDE — session manager
// ============================================================================
// The orchestrator behind the agent-based IDE. A session is a goal + a crew +
// an ordered step plan. The manager:
//   • creates sessions (classify → assemble crew → decompose to steps),
//   • runs them (dispatch steps to Uplift / Mutly / AgentBrowser, honoring
//     pause gates and decision gates),
//   • runs the review gate (Codegang local + RepoRank/Grader) before "done",
//   • resolves human interjections (pause / resume / redirect / message /
//     abort) and decisions (approve / reject),
//   • emits every transition as an SSE event for the /ide surface.
// ============================================================================

import { randomUUID } from 'crypto';
import path from 'node:path';
import type {
  IdeSession,
  IdeStep,
  IdeDecision,
  IdeEvent,
  IdeStepAgent,
  IdeStepKind,
  IdeCrew,
  IdeChatMessage,
  IdeRepairAction,
} from './types';
import { saveSession, loadSession } from './session-store';
import { publishSessionEvent } from './event-bus';
import { runUpliftStep } from './uplift-executor';
import {
  mutlyScan,
  mutlySymbols,
  mutlyAnalyze,
  mutlyPipelineStart,
  mutlyPipelineStatus,
  mutlyIsUp,
} from './mutly-client';
import { runReviewGate } from './review-gate';
import { beginEscalation, waitForDecision, releaseDecision, releaseSessionWaiters, hasDecisionWaiter } from './escalate';
import { recordSessionMemory, getMemorySeed } from './session-memory';
import { gitStatus, gitDiff, gitCommit } from './git-client';
import { runWorkspaceCommand } from './command-runner';
import { probeService } from './service-probe';
import { collectRemediation } from './repair-skills';
import { applyRemediationAction } from './repair-executor';
import { runOpencodeCodegen } from './opencode-client';
import { TOOL_PORTS } from '../draymond/ports';
import { resolveCodingTools, codingStackSummary } from '../draymond/coding-stack';
import { classifyFailure } from '../draymond/repair-team';
import { callLLM, callLocalModel } from '../draymond/llm';

const MAX_EVENTS = 400;
const MAX_CHAT = 120;
const MAX_STEPS = 12;
const MAX_REVIEW_PASSES = 2;
const MAX_CONCURRENT = Number(process.env.IDE_MAX_CONCURRENT ?? 3);

// ── Runtime registry (per-session control state) ────────────────────────────

interface Runtime {
  /** True while a runner owns this session (prevents double-run). */
  running: boolean;
  canceled: boolean;
  paused: boolean;
  gate: Promise<void> | null;
  releaseGate: (() => void) | null;
  /** Aborts in-flight engine work (uplift dispatch) on abort. */
  controller: AbortController;
}

const runtimes = new Map<string, Runtime>();

function ensureRuntime(sessionId: string): Runtime {
  let r = runtimes.get(sessionId);
  if (!r) {
    r = { running: false, canceled: false, paused: false, gate: null, releaseGate: null, controller: new AbortController() };
    runtimes.set(sessionId, r);
  }
  return r;
}

function runtimeFor(sessionId: string): Runtime | undefined {
  return runtimes.get(sessionId);
}

// ── Serialized per-session file saves ───────────────────────────────────────
// Parallel steps mutate the same session object; event pushes are synchronous
// but file writes are async. Chain the writes per session so a fast step never
// clobbers a slower step's freshly-appended events in the on-disk snapshot.

const saveQueues = new Map<string, Promise<void>>();

function enqueueSave(sessionId: string, write: () => Promise<void>): Promise<void> {
  const prev = saveQueues.get(sessionId) ?? Promise.resolve();
  const next = prev.then(write, write);
  saveQueues.set(sessionId, next);
  return next;
}

// ── Small helpers ───────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

function truncate(text: string, max = 4000): string {
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

function makeId(): string {
  return randomUUID();
}

function makeStep(
  session: IdeSession,
  index: number,
  kind: IdeStepKind,
  agent: IdeStepAgent,
  title: string,
  prompt: string,
  dependsOn?: string[],
): IdeStep {
  return { id: makeId(), index, title, kind, agent, prompt, status: 'queued', dependsOn: dependsOn && dependsOn.length ? dependsOn : undefined };
}

async function emitAndSave(session: IdeSession, type: IdeEvent['type'], data: Record<string, unknown>, stepId?: string): Promise<void> {
  const event: IdeEvent = { id: makeId(), ts: now(), type, sessionId: session.id, stepId, data };
  session.events.push(event);
  if (session.events.length > MAX_EVENTS) session.events = session.events.slice(-MAX_EVENTS);
  session.updatedAt = now();
  publishSessionEvent(session.id, event);
  try {
    await enqueueSave(session.id, () => saveSession(session));
  } catch (err) {
    // Fail-soft: a disk write error must never kill the run — keep the live
    // in-memory session going and record the failure on the session.
    console.error(`[IDE] save failed for ${session.id}:`, err instanceof Error ? err.message : err);
    session.note = session.note ? `${session.note} — save error` : 'save error';
  }
}

function appendChat(session: IdeSession, role: IdeChatMessage['role'], content: string): void {
  session.chat.push({ id: makeId(), role, content, ts: now() });
  if (session.chat.length > MAX_CHAT) session.chat = session.chat.slice(-MAX_CHAT);
}

// ── Goal classification + crew ──────────────────────────────────────────────

type GoalKind = 'repair' | 'build' | 'refactor' | 'debug' | 'review' | 'other';

function classifyGoal(goal: string): GoalKind {
  const g = goal.toLowerCase();
  if (/(fix|repair|broken|failing|bug|crash|timeout|regression|error)/.test(g)) return 'repair';
  if (/(refactor|clean up|restructure|optimize|rewrite)/.test(g)) return 'refactor';
  if (/(debug|investigate|trace|why is|not working)/.test(g)) return 'debug';
  if (/(review|audit|score|grade|analyze quality|deep scan)/.test(g)) return 'review';
  if (/(build|create|add feature|implement|write code|scaffold|new app|endpoint|component)/.test(g)) return 'build';
  return 'other';
}

function buildCrew(goal: string, kind: GoalKind): IdeCrew {
  const codegen = resolveCodingTools('codegen');
  const ide = resolveCodingTools('ide');
  const review = resolveCodingTools('review');
  const lead = codegen[0] ?? 'uplift-agent';
  const members = [...ide, 'codegang', ...review.slice(0, 2), 'big-homie'].filter(
    (m, i, arr) => arr.indexOf(m) === i && m !== lead,
  );
  const reason =
    kind === 'repair'
      ? `repair crew (${classifyFailure(goal)}): coding agents patch, Codegang/RepoRank/Grader verify, Big Homie gates`
      : `coding team from the master coding stack (${codingStackSummary()}): Uplift Agent writes, Mutly indexes/tests, Codegang+RepoRank+Grader verify`;
  return { lead, members, reason };
}

// ── Plan decomposition ──────────────────────────────────────────────────────

const ALLOWED_KINDS = new Set<IdeStepKind>(['plan', 'codegen', 'edit', 'scan', 'analyze', 'symbols', 'test', 'typecheck', 'build', 'review', 'browser-check', 'command', 'git-status', 'git-diff', 'git-commit', 'diagnose', 'repair', 'verify', 'message']);
const ALLOWED_AGENTS = new Set<IdeStepAgent>(['uplift', 'mutly', 'agent-browser', 'megacode', 'big-homie', 'codegang', 'opencode']);

const ALLOWED_REPAIR_TYPES = new Set(['patch', 'env-set', 'command', 'preset', 'restart']);
const REPAIR_PRESETS = new Set(['install', 'install-ci', 'prisma-generate', 'pip-install', 'typecheck', 'lint', 'test', 'build']);

function normalizeRepairAction(raw: Record<string, unknown>): IdeRepairAction | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const type = String(raw.type ?? '');
  if (!ALLOWED_REPAIR_TYPES.has(type)) return undefined;
  const action: IdeRepairAction = { type: type as IdeRepairAction['type'] };
  if (typeof raw.file === 'string') action.file = raw.file;
  if (typeof raw.find === 'string') action.find = raw.find;
  if (typeof raw.replace === 'string') action.replace = raw.replace;
  if (typeof raw.envFile === 'string') action.envFile = raw.envFile;
  if (typeof raw.key === 'string') action.key = raw.key;
  if (typeof raw.value === 'string') action.value = raw.value;
  if (Array.isArray(raw.args)) action.args = raw.args.map(String);
  if (typeof raw.dir === 'string') action.dir = raw.dir;
  if (typeof raw.preset === 'string' && REPAIR_PRESETS.has(raw.preset)) action.preset = raw.preset as IdeRepairAction['preset'];
  if (typeof raw.service === 'string') action.service = raw.service;
  if (typeof raw.port === 'number') action.port = raw.port;
  return action;
}

/** Find a known service slug mentioned in a prompt. */
function extractServiceSlug(prompt: string): string | null {
  const p = prompt.toLowerCase();
  for (const tool of TOOL_PORTS) {
    if (tool.slug.length > 2 && p.includes(tool.slug.toLowerCase())) return tool.slug;
  }
  return null;
}

async function decomposeToSteps(goal: string, kind: GoalKind, crew: IdeCrew): Promise<IdeStep[]> {
  try {
    // Seed the plan with what the team already knows: L1/L2 memory assets
    // (BM25) + L3 team lessons from the self-learning store.
    const seed = await getMemorySeed(goal, 2, 2);
    const memoryLines = seed.memories.map(
      (h) => `- goal: ${h.record.goal} | result: ${h.record.summary} | steps: ${h.record.stepSummary} | review: ${h.record.review}${h.record.note ? ` | note: ${h.record.note}` : ''}`,
    );
    const lessonLines = seed.lessons.map((l) => `- lesson (${l.agentId}): ${l.lesson}`);
    const seedLines = [...memoryLines, ...lessonLines];
    const memoryBlock = seedLines.length > 0 ? `\n\nPast lessons from similar sessions (do not repeat their failures):\n${seedLines.join('\n')}` : '';

    const planSystem = [
        'You are Draymond\'s coding-team planner. Break the goal into an ordered, minimal plan (3-8 steps).',
        'Each step is JSON: {id, title, kind, agent, prompt, dependsOn}.',
        `kind must be one of: ${[...ALLOWED_KINDS].join(', ')}.`,
        `agent must be one of: ${[...ALLOWED_AGENTS].join(', ')}.`,
        'id is a short label like "s1", "s2". dependsOn is an ARRAY of earlier step ids this step needs done first;',
        'an empty array (or omitted) means the step can run IMMEDIATELY — run independent steps in parallel.',
        'Guidance: code writing/editing → uplift; indexing/scanning/analyzing/tests → mutly; web/QA → agent-browser;',
        'final deep analysis/review → codegang. Keep prompts self-contained (the agent gets no other context).',
        'For REPAIR tasks (fix/repair/diagnose a broken service, agent, or dependency): emit steps with kind',
        'diagnose → repair → verify, where diagnose probes the service (probeService), repair applies a fix, and',
        'verify re-checks. A repair step may carry a structured `repair` object to apply deterministically:',
        '{type: "env-set", key, value, envFile} | {type: "patch", file, find, replace} |',
        '{type: "preset", preset: "install"|"install-ci"|"prisma-generate"|"pip-install", dir} |',
        '{type: "command", args: [...], dir} | {type: "restart", service}]. Only emit repair actions that are',
        'deterministic and safe; otherwise emit kind "repair" with a prompt describing the fix for the team.',
        'Reply with ONLY a JSON object: {"steps": [...], "note": "one-line plan summary"}.',
      ].join('\n');
    const planUser = `Goal: ${goal}\nKind: ${kind}\nLead: ${crew.lead}\nMembers: ${crew.members.join(', ')}${memoryBlock}`;

    // Try the cheap local model first; only accept it if every step uses a
    // valid kind + agent (llama3.2:1b can emit non-standard kinds). Otherwise
    // fall back to the paid provider, then the deterministic plan.
    let content: string | null = null;
    try {
      const local = await callLocalModel({ system: planSystem, userMessage: planUser, maxTokens: 1400 });
      const localParsed = JSON.parse(local.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()) as {
        steps?: Array<{ kind?: string; agent?: string }>;
      };
      const stepsOk = Array.isArray(localParsed.steps) &&
        localParsed.steps.length >= 2 &&
        localParsed.steps.every((s) => ALLOWED_KINDS.has(s.kind as IdeStepKind) && ALLOWED_AGENTS.has(s.agent as IdeStepAgent));
      if (stepsOk) content = local;
      else console.warn('[IDE] local plan rejected (invalid kind/agent). Using paid provider.');
    } catch {
      console.warn('[IDE] local plan unavailable. Using paid provider.');
    }

    if (!content) {
      content = await callLLM({
        provider: 'opencode-free',
        system: planSystem,
        userMessage: planUser,
        maxTokens: 1400,
        temperature: 0.2,
        timeoutMs: 30_000,
        responseFormat: { type: 'json_object' },
        fallbackKey: 'ide.decomposeToSteps',
      });
    }

    const parsed = JSON.parse(content) as {
      steps?: Array<{
        id?: string; title?: string; kind?: string; agent?: string; prompt?: string; dependsOn?: string[];
        repair?: Record<string, unknown>;
      }>;
    };
    const llmSteps = (parsed.steps ?? []).filter(Boolean).slice(0, MAX_STEPS);

    // Build generated ids first, remember each LLM id's position.
    const idIndex = new Map<string, number>();
    const built = llmSteps.map((s, i) => {
      if (s.id) idIndex.set(String(s.id), i);
      const step = makeStep(
        {} as IdeSession,
        i,
        ALLOWED_KINDS.has(s.kind as IdeStepKind) ? (s.kind as IdeStepKind) : 'codegen',
        ALLOWED_AGENTS.has(s.agent as IdeStepAgent) ? (s.agent as IdeStepAgent) : 'uplift',
        (s.title ?? `Step ${i + 1}`).slice(0, 120),
        (s.prompt ?? goal).slice(0, 3000),
      );
      if (s.repair) step.repair = normalizeRepairAction(s.repair);
      return { s, step };
    });

    // Resolve dependsOn → generated ids, restricted to earlier steps only.
    const idToGenerated = new Map<string, string>();
    built.forEach(({ s, step }) => {
      if (s.id) idToGenerated.set(String(s.id), step.id);
    });
    for (let i = 0; i < built.length; i++) {
      const { s, step } = built[i];
      const deps = (s.dependsOn ?? [])
        .map((d) => String(d))
        .filter((d) => {
          const idx = idIndex.get(d);
          return idx !== undefined && idx < i && idToGenerated.has(d);
        })
        .map((d) => idToGenerated.get(d) as string);
      if (deps.length) step.dependsOn = deps;
    }

    const steps = built.map((b) => b.step);
    if (steps.length >= 2) return steps;
  } catch {
    // fall through to deterministic plan
  }
  return fallbackPlan(kind, goal);
}

function fallbackPlan(kind: GoalKind, goal: string): IdeStep[] {
  type Raw = { agent: IdeStepAgent; kind: IdeStepKind; title: string; prompt: string; deps: number[] };
  const base = (agent: IdeStepAgent, kind: IdeStepKind, title: string, prompt: string): Omit<Raw, 'deps'> => ({ agent, kind, title, prompt });
  const raw: Raw[] = [];
  if (kind === 'review') {
    raw.push({ ...base('mutly', 'scan', 'Scan workspace', `Index the workspace and extract symbols for "${goal}".`), deps: [] });
    raw.push({ ...base('codegang', 'review', 'Deep analysis', `Deep analysis of the changed files for "${goal}".`), deps: [0] });
  } else if (kind === 'repair') {
    raw.push({ ...base('uplift', 'plan', 'Diagnose', `Diagnose the failure for: "${goal}". Identify the root cause.`), deps: [] });
    raw.push({ ...base('uplift', 'codegen', 'Implement fix', `Implement a targeted fix for: "${goal}". Keep the change minimal.`), deps: [0] });
    raw.push({ ...base('mutly', 'test', 'Verify', `Run the test suite / typecheck to verify the fix for: "${goal}".`), deps: [1] });
    raw.push({ ...base('codegang', 'review', 'Review gate', `Deep analysis of the changed files for: "${goal}".`), deps: [1, 2] });
  } else {
    raw.push({ ...base('uplift', 'plan', 'Plan', `Break down "${goal}" and plan the implementation steps.`), deps: [] });
    raw.push({ ...base('uplift', 'codegen', 'Implement', `Implement: "${goal}". Produce concrete code changes.`), deps: [0] });
    // scan + test both depend only on the implementation → run in parallel.
    raw.push({ ...base('mutly', 'scan', 'Index & scan', `Index the workspace and scan for issues after the changes.`), deps: [1] });
    raw.push({ ...base('mutly', 'test', 'Verify', `Run the test suite / typecheck to verify: "${goal}".`), deps: [1] });
    raw.push({ ...base('codegang', 'review', 'Review gate', `Deep analysis of the changed files for: "${goal}".`), deps: [2, 3] });
  }
  const steps = raw.map((s, i) => makeStep({} as IdeSession, i, s.kind, s.agent, s.title, s.prompt));
  raw.forEach((s, i) => {
    const deps = s.deps.map((idx) => steps[idx]?.id).filter(Boolean) as string[];
    if (deps.length) steps[i].dependsOn = deps;
  });
  return steps;
}

// ── Decision helpers ────────────────────────────────────────────────────────

async function createDecision(
  session: IdeSession,
  input: { prompt: string; risk: IdeDecision['risk']; reason: string; options: IdeDecision['options'] },
): Promise<IdeDecision> {
  const decision: IdeDecision = {
    id: makeId(),
    prompt: input.prompt,
    risk: input.risk,
    reason: input.reason,
    status: 'pending',
    method: 'chat',
    options: input.options,
  };
  session.decisions.push(decision);
  session.phase = 'waiting_decision';
  await emitAndSave(session, 'decision.required', {
    decisionId: decision.id,
    prompt: decision.prompt,
    risk: decision.risk,
    reason: decision.reason,
    options: decision.options,
  });
  // Fire-and-forget the escalation ladder; it releases the waiter when done.
  void beginEscalation(session, decision);
  return decision;
}

function awaitDecision(sessionId: string, decisionId: string): Promise<IdeDecision> {
  return waitForDecision(sessionId, decisionId);
}

// ── Step execution ──────────────────────────────────────────────────────────

function extractUrl(prompt: string): string | null {
  const m = /https?:\/\/[^\s)">]+/.exec(prompt);
  return m ? m[0] : null;
}

/** Split a unified `git diff` into per-file chunks (boundary: `diff --git`). */
function splitDiffByFile(diff: string): Array<{ path: string; diff: string }> {
  const files: Array<{ path: string; diff: string }> = [];
  const blocks = diff.split(/(?=^diff --git )/m);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const m = /^diff --git a\/(.+?) b\//.exec(block);
    files.push({ path: m?.[1] ?? 'workspace', diff: block });
  }
  return files.slice(0, 12);
}

/** Write a conventional commit message from a diff via the LLM (with fallback). */
async function generateCommitMessage(goal: string, diff: string): Promise<string> {
  if (!diff.trim()) {
    return `chore(ide): ${goal.slice(0, 80)}`;
  }
  try {
    // Commit messages are a single short line — ideal for the cheap local tier.
    const message = await callLocalModel({
      system:
        'You are a senior engineer writing a commit message. Given the goal and the diff, return ONLY a single conventional commit message line ' +
        '(e.g. "fix(api): handle null tenant on payouts"). No markdown, no quotes, no body.',
      userMessage: `Goal: ${goal}\n\nDiff:\n${diff.slice(0, 4000)}`,
      maxTokens: 120,
      fallbackKey: 'ide.generateCommitMessage',
    });
    const clean = message.trim().replace(/^`+|`+$/g, '').replace(/\n+/g, ' ').slice(0, 200);
    return clean || `chore(ide): ${goal.slice(0, 80)}`;
  } catch {
    return `chore(ide): ${goal.slice(0, 80)}`;
  }
}

async function runStep(session: IdeSession, step: IdeStep): Promise<void> {
  step.status = 'running';
  step.startedAt = now();
  await emitAndSave(session, 'step.started', { step: stepSummaries(session, step) }, step.id);

  try {
    // ── Git + command kinds run regardless of the assigned agent ────────────
    if (step.kind === 'git-status') {
      const res = await gitStatus(session.workspace);
      step.detail = res.success ? truncate(res.output) : `git status failed: ${res.error ?? 'unknown'}`;
      step.status = 'done';
      await emitAndSave(session, 'step.completed', { step: stepSummaries(session, step) }, step.id);
      return;
    }

    if (step.kind === 'git-diff') {
      const res = await gitDiff(session.workspace);
      if (res.success && res.output.trim()) {
        step.detail = truncate(res.output);
        for (const f of splitDiffByFile(res.output)) {
          await emitAndSave(session, 'file.diff', { file: f.path, diff: truncate(f.diff, 2000) }, step.id);
        }
      } else {
        step.detail = res.success ? 'no working-tree changes' : `git diff failed: ${res.error ?? 'unknown'}`;
      }
      step.status = 'done';
      await emitAndSave(session, 'step.completed', { step: stepSummaries(session, step) }, step.id);
      return;
    }

    if (step.kind === 'git-commit') {
      const diffRes = await gitDiff(session.workspace);
      const message = await generateCommitMessage(step.prompt, diffRes.success ? diffRes.output : '');
      const res = await gitCommit(session.workspace, message);
      if (res.success) {
        step.detail = `committed ${res.output.trim()} — ${message}`;
        step.status = 'done';
        await emitAndSave(session, 'step.completed', { step: stepSummaries(session, step) }, step.id);
      } else {
        step.status = 'failed';
        step.error = `git commit failed: ${res.error ?? 'unknown'}`;
        await emitAndSave(session, 'step.failed', { error: step.error }, step.id);
      }
      return;
    }

    if (step.kind === 'command') {
      const result = await runWorkspaceCommand(session.workspace, step.prompt);
      step.detail = result.success
        ? result.output || `${result.preset} passed`
        : `${result.command} → ${result.error ?? 'failed'}\n${result.output}`;
      step.tests = [{ name: step.title, status: result.success ? 'pass' : 'error', detail: result.output.slice(0, 1200) }];
      if (result.success) {
        step.status = 'done';
        await emitAndSave(session, 'step.completed', { step: stepSummaries(session, step) }, step.id);
      } else {
        step.status = 'failed';
        step.error = `${result.command} failed: ${result.error ?? 'unknown'}`;
        await emitAndSave(session, 'step.failed', { error: step.error }, step.id);
      }
      return;
    }

    // ── Repair-team steps: diagnose → repair → verify ───────────────────────
    if (step.kind === 'diagnose') {
      const slug = extractServiceSlug(step.prompt);
      if (!slug) {
        step.status = 'failed';
        step.error = 'diagnose step needs a known service slug in its prompt';
        await emitAndSave(session, 'step.failed', { error: step.error }, step.id);
        return;
      }
      const diagnosis = await probeService(slug);
      const tool = TOOL_PORTS.find((t) => t.slug === slug);
      const remediation = await collectRemediation({
        path: tool?.cwd ? path.resolve(process.cwd(), tool.cwd) : session.workspace,
        probe: diagnosis,
      });
      const lines = [
        `${slug} → ${diagnosis.signature}`,
        `listening=${diagnosis.listening} http=${diagnosis.httpCode ?? 'n/a'} port=${diagnosis.port ?? 'n/a'}`,
        ...diagnosis.notes,
        `remediation sources: ${remediation.sources.join(', ') || 'none'} · ${remediation.items.length} action(s)`,
      ];
      step.detail = lines.join('\n');
      await emitAndSave(session, 'diagnosis', { slug, signature: diagnosis.signature, listening: diagnosis.listening, httpCode: diagnosis.httpCode, items: remediation.items.length }, step.id);
      step.status = 'done';
      await emitAndSave(session, 'step.completed', { step: stepSummaries(session, step) }, step.id);
      return;
    }

    if (step.kind === 'repair') {
      // Prefer a structured repair action; otherwise re-collect remediation and apply the first actionable item.
      if (step.repair) {
        const outcome = await applyRemediationAction(step.repair, session.workspace ?? process.cwd());
        step.detail = outcome.detail;
        if (outcome.ok) {
          step.status = 'done';
          await emitAndSave(session, 'step.completed', { step: stepSummaries(session, step) }, step.id);
        } else {
          step.status = 'failed';
          step.error = outcome.detail;
          await emitAndSave(session, 'step.failed', { error: step.error }, step.id);
        }
        return;
      }
      const slug = extractServiceSlug(step.prompt);
      const tool = TOOL_PORTS.find((t) => t.slug === slug);
      const diagnosis = slug ? await probeService(slug) : undefined;
      const remediation = await collectRemediation({
        path: tool?.cwd ? path.resolve(process.cwd(), tool.cwd) : session.workspace,
        repoUrl: session.repoUrl,
        probe: diagnosis,
      });
      const actionable = remediation.items.find((i) => i.apply);
      if (!actionable) {
        step.status = 'failed';
        step.error = `no actionable remediation found${remediation.items.length ? ` (${remediation.items.length} informational)` : ''}`;
        await emitAndSave(session, 'step.failed', { error: step.error }, step.id);
        return;
      }
      const outcome = await applyRemediationAction(actionable.apply!, session.workspace ?? process.cwd());
      step.detail = `${actionable.title}: ${outcome.detail}`;
      if (outcome.ok) {
        step.status = 'done';
        await emitAndSave(session, 'step.completed', { step: stepSummaries(session, step) }, step.id);
      } else {
        step.status = 'failed';
        step.error = outcome.detail;
        await emitAndSave(session, 'step.failed', { error: step.error }, step.id);
      }
      return;
    }

    if (step.kind === 'verify') {
      const slug = extractServiceSlug(step.prompt);
      if (!slug) {
        step.status = 'failed';
        step.error = 'verify step needs a known service slug in its prompt';
        await emitAndSave(session, 'step.failed', { error: step.error }, step.id);
        return;
      }
      // Services take time to boot after a repair — retry up to ~30s.
      let diagnosis = await probeService(slug);
      const attempts = 6;
      for (let i = 0; i < attempts && !(diagnosis.signature === 'healthy' || diagnosis.signature === 'reachable'); i++) {
        await new Promise((r) => setTimeout(r, 5000));
        diagnosis = await probeService(slug);
      }
      const passed = diagnosis.signature === 'healthy' || diagnosis.signature === 'reachable';
      step.detail = `${slug} verify → ${diagnosis.signature} (listening=${diagnosis.listening}, http=${diagnosis.httpCode ?? 'n/a'})`;
      if (passed) {
        step.status = 'done';
        await emitAndSave(session, 'step.completed', { step: stepSummaries(session, step) }, step.id);
      } else {
        step.status = 'failed';
        step.error = `${slug} still ${diagnosis.signature}`;
        await emitAndSave(session, 'step.failed', { error: step.error }, step.id);
      }
      return;
    }

    switch (step.agent) {
      case 'uplift':
      case 'megacode':
      case 'opencode': {
        const prefix = session.redirect ? `[Human redirect] ${session.redirect}\n\n` : '';
        session.redirect = undefined;
        let result: { success: boolean; content: string; files: { path: string; action: 'created' | 'edited' | 'deleted' | 'untouched' }[]; error?: string };
        if (step.agent === 'opencode') {
          const r = await runOpencodeCodegen({ prompt: `${prefix}${step.prompt}`, workspace: session.workspace ?? process.cwd() });
          result = { success: r.success, content: r.content, files: [], error: r.error };
        } else {
          const rt = runtimeFor(session.id);
          result = await runUpliftStep({
            description: `${prefix}${step.prompt}`,
            sessionId: session.id,
            signal: rt?.controller?.signal,
          });
        }
        if (result.success) {
          step.status = 'done';
          step.detail = truncate(result.content);
          step.files = result.files;
          for (const f of result.files) {
            await emitAndSave(session, 'file.changed', { file: f }, step.id);
          }
          await emitAndSave(session, 'step.completed', { step: stepSummaries(session, step) }, step.id);
        } else {
          step.status = 'failed';
          step.error = result.error ?? 'uplift step failed';
          await emitAndSave(session, 'step.failed', { error: step.error }, step.id);
        }
        return;
      }

      case 'mutly': {
        const up = await mutlyIsUp();
        if (!up) {
          step.status = 'done';
          step.detail = 'mutly daemon offline — step noted, review gate will still verify';
          await emitAndSave(session, 'message', { text: 'Mutly daemon is offline (agents/Codegang serves local analysis meanwhile).' }, step.id);
          await emitAndSave(session, 'step.completed', { step: stepSummaries(session, step) }, step.id);
          return;
        }
        if (step.kind === 'scan') {
          const res = await mutlyScan();
          step.detail = truncate(JSON.stringify(res));
        } else if (step.kind === 'symbols') {
          const res = await mutlySymbols();
          step.detail = `${Array.isArray(res) ? res.length : 0} symbols indexed`;
        } else if (step.kind === 'analyze') {
          const res = await mutlyAnalyze({ path: session.workspace, goal: step.prompt });
          step.detail = truncate(JSON.stringify(res));
        } else if (step.kind === 'test' || step.kind === 'typecheck' || step.kind === 'build') {
          try {
            const started = await mutlyPipelineStart({ path: session.workspace, goal: step.prompt });
            if (started.pipelineId) {
              await new Promise((r) => setTimeout(r, 4000));
              const st = await mutlyPipelineStatus(started.pipelineId);
              step.detail = `pipeline ${st.status ?? 'started'}${st.phase ? ` · phase ${st.phase}` : ''}`;
              step.tests = [{ name: step.title, status: st.status === 'complete' ? 'pass' : st.status === 'error' ? 'error' : 'pending', detail: truncate(JSON.stringify(st), 1200) }];
            } else {
              step.detail = 'pipeline start returned no id';
            }
          } catch (err) {
            step.detail = `mutly pipeline unavailable: ${err instanceof Error ? err.message : String(err)}`;
          }
        } else {
          step.detail = `mutly ${step.kind} — done`;
        }
        step.status = 'done';
        await emitAndSave(session, 'step.completed', { step: stepSummaries(session, step) }, step.id);
        return;
      }

      case 'agent-browser': {
        const url = extractUrl(step.prompt);
        if (!url) {
          step.detail = 'browser-check skipped — no URL in prompt';
        } else {
          try {
            const { browserFetch } = await import('@/lib/agentbrowser');
            const res = await browserFetch(url, 'get-content');
            step.detail = res.success
              ? `loaded ${url} — ${res.content?.length ?? 0} chars`
              : `browser check failed: ${res.error ?? 'unknown'}`;
          } catch (err) {
            step.detail = `browser check error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        step.status = 'done';
        await emitAndSave(session, 'step.completed', { step: stepSummaries(session, step) }, step.id);
        return;
      }

      case 'codegang':
      case 'big-homie':
      default: {
        step.status = 'done';
        step.detail = `${step.agent} — handled by the review gate at the end of the run`;
        await emitAndSave(session, 'step.completed', { step: stepSummaries(session, step) }, step.id);
        return;
      }
    }
  } catch (err) {
    step.status = 'failed';
    step.error = err instanceof Error ? err.message : String(err);
    await emitAndSave(session, 'step.failed', { error: step.error }, step.id);
  }
}

function stepSummaries(session: IdeSession, step: IdeStep) {
  return {
    id: step.id,
    index: step.index,
    title: step.title,
    kind: step.kind,
    agent: step.agent,
    status: step.status,
    detail: step.detail,
    files: step.files,
    tests: step.tests,
  };
}

/** Cooperative pause gate — waits while the session is paused. */
async function gateOnPause(runtime: Runtime, session: IdeSession): Promise<boolean> {
  while (runtime.paused && !runtime.canceled) {
    if (session.phase !== 'paused') {
      session.phase = 'paused';
      await emitAndSave(session, 'session.paused', {});
    }
    if (!runtime.gate) {
      runtime.gate = new Promise<void>((resolve) => {
        runtime.releaseGate = resolve;
      });
    }
    await runtime.gate;
  }
  if (runtime.canceled) return false;
  if (session.phase === 'paused') {
    session.phase = 'running';
    await emitAndSave(session, 'session.resumed', {});
  }
  return true;
}

// ── Review gate loop ────────────────────────────────────────────────────────

async function runReviewLoop(session: IdeSession, runtime: Runtime): Promise<void> {
  let reviewPass = 0;
  while (true) {
    if (runtime.canceled) return;
    if (!(await gateOnPause(runtime, session))) return;

    session.phase = 'reviewing';
    await emitAndSave(session, 'session.started', { phase: 'reviewing', note: 'review gate' });

    const { review } = await runReviewGate(session);
    session.review = {
      scorer: review.scorer,
      score: review.score,
      grade: review.grade,
      summary: review.summary,
      detail: review.detail,
      error: review.error,
      gateThreshold: review.gateThreshold,
      passed: review.passed,
    };

    if (review.passed) return;
    if (reviewPass >= MAX_REVIEW_PASSES) {
      session.note = 'review gate still failing after fixes';
      await emitAndSave(session, 'message', { text: `Review gate still below threshold after ${MAX_REVIEW_PASSES} fix passes — stopping with ${review.score ?? 'n/a'}/100.` });
      return;
    }

    // Gate failed → human decision (with escalation).
    const decision = await createDecision(session, {
      prompt: `Review gate scored ${review.score ?? 'n/a'} / ${review.gateThreshold} threshold. ${review.summary}`,
      risk: 'medium',
      reason: review.detail ?? review.summary,
      options: [
        { id: 'fix', label: 'Team fixes the findings', description: 'Add a repair step and re-run the review', expectedOutcome: 82, outcomeSpread: 12 },
        { id: 'approve', label: 'Approve anyway', description: 'Accept the current score and finish', expectedOutcome: 45, outcomeSpread: 20 },
        { id: 'reject', label: 'Reject', description: 'Stop the session without completion', expectedOutcome: -12, outcomeSpread: 10 },
      ],
    });
    const resolved = await awaitDecision(session.id, decision.id);
    if (runtime.canceled) return;
    // createDecision moved the session to waiting_decision; the run resumes now.
    session.phase = 'running';

    if (resolved.status === 'rejected') {
      session.note = 'human rejected the review outcome';
      return;
    }
    if (resolved.resolution === 'approve') return;
    if (resolved.resolution === 'reject') {
      session.note = 'human rejected the work';
      return;
    }
    // fix pass
    if (!(await gateOnPause(runtime, session))) return;
    reviewPass += 1;
    const fixStep = makeStep(
      session,
      session.steps.length,
      'codegen',
      'uplift',
      `Fix pass ${reviewPass}`,
      `Address these review findings, then the gate re-runs:\n${review.summary}\n${review.detail ?? ''}`,
    );
    session.steps.push(fixStep);
    await emitAndSave(session, 'step.started', { step: stepSummaries(session, fixStep) }, fixStep.id);
    await runStep(session, fixStep);
    if (fixStep.status === 'failed') return;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface CreateIdeSessionInput {
  goal: string;
  createdBy: string;
  workspace?: string;
  repoUrl?: string;
  context?: Record<string, unknown>;
}

export async function createIdeSession(input: CreateIdeSessionInput): Promise<IdeSession> {
  const goal = input.goal.trim();
  const kind = classifyGoal(goal);
  const crew = buildCrew(goal, kind);
  const steps = await decomposeToSteps(goal, kind, crew);

  const session: IdeSession = {
    id: makeId(),
    goal,
    phase: 'assembling',
    crew,
    steps,
    decisions: [],
    events: [],
    chat: [{ id: makeId(), role: 'system', content: `Coding team assembled. Lead: ${crew.lead}. Members: ${crew.members.join(', ')}.`, ts: now() }],
    createdBy: input.createdBy,
    createdAt: now(),
    updatedAt: now(),
    workspace: input.workspace,
    repoUrl: input.repoUrl,
  };

  await saveSession(session);
  await emitAndSave(session, 'session.created', { goal, kind });
  await emitAndSave(session, 'crew.assembled', { crew });
  return session;
}

export async function startIdeSession(sessionId: string): Promise<IdeSession> {
  const runtime = ensureRuntime(sessionId);
  // Concurrency lock: the runtime map is synchronous, so checking + setting the
  // flag before any await makes the double-run guard atomic.
  if (runtime.running) {
    const existing = await loadSession(sessionId);
    if (existing) return existing;
    throw new Error('IDE session not found');
  }
  runtime.running = true;

  try {
    const session = await loadSession(sessionId);
    if (!session) throw new Error('IDE session not found');
    // Don't re-run sessions that are finished or parked on a human decision.
    if (session.phase === 'done' || session.phase === 'error' || session.phase === 'paused' || session.phase === 'waiting_decision') {
      return session;
    }
    if (session.phase !== 'assembling') return session;

    session.phase = 'running';
    await emitAndSave(session, 'session.started', { goal: session.goal });

    // DAG runner: repeatedly dispatch the steps whose dependencies are all done,
    // running each ready batch in parallel (concurrency-capped).
    const isSatisfied = (step: IdeStep): boolean => {
      const deps = step.dependsOn ?? [];
      if (deps.length === 0) return true;
      return deps.every((depId) => {
        const dep = session.steps.find((s) => s.id === depId);
        return dep ? dep.status === 'done' : true; // missing dep treated as satisfied
      });
    };
    const remaining = (): IdeStep[] => session.steps.filter((s) => s.status === 'queued' || s.status === 'waiting');

    while (true) {
      if (runtime.canceled) break;
      if (!(await gateOnPause(runtime, session))) break;

      const pending = remaining();
      if (pending.length === 0) break;

      const ready = pending.filter(isSatisfied);
      if (ready.length === 0) {
        // Deadlock or a failed dependency chain — mark the stalled steps failed.
        const blockedIds = new Set<string>();
        for (const step of pending) {
          const failedDep = (step.dependsOn ?? []).find((depId) => {
            const dep = session.steps.find((s) => s.id === depId);
            return dep?.status === 'failed';
          });
          if (failedDep) {
            step.status = 'failed';
            step.error = 'blocked: a dependency failed';
            await emitAndSave(session, 'step.failed', { error: step.error }, step.id);
            blockedIds.add(step.id);
          }
        }
        if (blockedIds.size === 0) {
          // True cycle — give up on the rest.
          for (const step of pending) {
            step.status = 'failed';
            step.error = 'cyclic dependency — could not schedule';
            await emitAndSave(session, 'step.failed', { error: step.error }, step.id);
          }
        }
        break;
      }

      // Run the ready batch in parallel with a concurrency cap.
      const slots = Math.max(1, Math.min(MAX_CONCURRENT, ready.length));
      const batches: IdeStep[][] = [];
      for (let i = 0; i < ready.length; i += slots) batches.push(ready.slice(i, i + slots));

      for (const batch of batches) {
        if (runtime.canceled) break;
        if (!(await gateOnPause(runtime, session))) break;
        await Promise.all(batch.map((step) => runStep(session, step)));
      }
    }

    if (!runtime.canceled) {
      await runReviewLoop(session, runtime);
    }

    const aborted = runtime.canceled;
    session.phase = 'done';
    if (aborted) session.note = session.note ?? 'aborted by user';
    await emitAndSave(session, 'session.completed', { aborted, note: session.note });

    // Distill the session into the team's long-term memory (fail-soft, async).
    await recordSessionMemory(session).catch(() => {});
    return session;
  } finally {
    runtime.running = false;
    runtimes.delete(sessionId);
  }
}

export type InterjectAction = 'pause' | 'resume' | 'message' | 'redirect' | 'abort';

export async function interjectIdeSession(
  sessionId: string,
  action: InterjectAction,
  payload: { content?: string } = {},
): Promise<IdeSession> {
  const session = await loadSession(sessionId);
  if (!session) throw new Error('IDE session not found');
  const runtime = ensureRuntime(sessionId);

  switch (action) {
    case 'pause': {
      if (session.phase === 'running' || session.phase === 'reviewing' || session.phase === 'waiting_decision') {
        runtime.paused = true;
        session.phase = 'paused';
        await emitAndSave(session, 'session.paused', {});
      }
      break;
    }
    case 'resume': {
      const wasPaused = runtime.paused;
      runtime.paused = false;
      if (runtime.releaseGate) {
        runtime.releaseGate();
        runtime.gate = null;
        runtime.releaseGate = null;
      }
      if (session.phase === 'paused') session.phase = 'running';
      if (wasPaused) {
        await emitAndSave(session, 'session.resumed', {});
      }
      break;
    }
    case 'message': {
      appendChat(session, 'user', payload.content ?? '');
      await emitAndSave(session, 'message', { text: payload.content ?? '' });
      break;
    }
    case 'redirect': {
      session.redirect = payload.content ?? '';
      appendChat(session, 'system', `Human redirect: ${payload.content}`);
      await emitAndSave(session, 'message', { text: `Redirect set — next step will be redirected: ${payload.content}` });
      break;
    }
    case 'abort': {
      runtime.canceled = true;
      runtime.paused = false;
      runtime.controller.abort(); // cancel in-flight engine work
      if (runtime.releaseGate) {
        runtime.releaseGate();
        runtime.gate = null;
        runtime.releaseGate = null;
      }
      session.note = 'aborted by user';
      session.phase = 'done';

      // Release any waiter the runner is blocked on so it can unwind and emit
      // the terminal event itself (avoids a duplicate session.completed).
      const hasRunner = runtime.running;
      releaseSessionWaiters(sessionId);
      if (!hasRunner) {
        await emitAndSave(session, 'session.completed', { aborted: true, note: session.note });
      }
      runtimes.delete(sessionId);
      break;
    }
  }

  session.updatedAt = now();
  await saveSession(session);
  return session;
}

export interface ResolveDecisionInput {
  approved: boolean;
  reviewer?: string;
  optionId?: string;
}

export async function resolveIdeDecision(
  sessionId: string,
  decisionId: string,
  input: ResolveDecisionInput,
): Promise<IdeDecision> {
  const session = await loadSession(sessionId);
  if (!session) throw new Error('IDE session not found');
  const decision = session.decisions.find((d) => d.id === decisionId);
  if (!decision) throw new Error('Decision not found');
  if (decision.status !== 'pending') throw new Error('Decision already resolved');

  decision.status = input.approved ? 'approved' : 'rejected';
  decision.method = 'chat';
  // Normalize the no-optionId path (e.g. the ntfy Approve/Reject buttons) onto
  // the same vocabulary the review loop branches on: 'approve' | 'reject'.
  decision.resolution = input.optionId ?? (input.approved ? 'approve' : 'reject');
  decision.resolvedAt = now();
  appendChat(session, 'system', `Decision ${decision.status}: ${decision.prompt}`);

  if (session.phase === 'waiting_decision') {
    session.phase = 'running';
  }
  await emitAndSave(session, 'decision.resolved', {
    decisionId,
    status: decision.status,
    resolution: decision.resolution,
    reviewer: input.reviewer ?? 'human',
  });
  await saveSession(session);
  releaseDecision(sessionId, decisionId, decision);
  return decision;
}

export async function getIdeSession(sessionId: string): Promise<IdeSession | null> {
  const session = await loadSession(sessionId);
  if (!session) return null;

  // Recovery: a session stranded in waiting_decision (e.g. after a server
  // restart) has no live runner or ladder. Re-arm the escalation ladder so a
  // pending decision still gets escalated / auto-decided and the run can
  // complete. Skipped when a runner is already waiting on the decision.
  if (session.phase === 'waiting_decision') {
    for (const d of session.decisions) {
      if (d.status === 'pending' && !hasDecisionWaiter(session.id, d.id)) {
        void beginEscalation(session, d);
      }
    }
  }
  return session;
}

export { listSessions as listIdeSessions } from './session-store';
