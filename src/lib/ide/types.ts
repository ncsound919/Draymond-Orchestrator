// ============================================================================
// DRAYMOND AGENT IDE — session/step/event/decision types
// ============================================================================
// The agent-based IDE lets a human chat with a coding/repair team, watch them
// work step-by-step, and interject (pause / redirect / approve / message).
// These types back the /ide surface, the /api/ide/* routes, and the IDE
// session manager.
// ============================================================================

/** Lifecycle phase of an IDE session. */
export type IdePhase =
  | 'assembling' // crew + plan being built
  | 'running' // steps executing
  | 'waiting_decision' // blocked on a human decision (risk gate)
  | 'paused' // human paused the team
  | 'reviewing' // post-edit review gate in progress
  | 'done'
  | 'error';

/** Status of a single step inside the plan. */
export type IdeStepStatus = 'queued' | 'running' | 'waiting' | 'done' | 'failed';

/** Which execution engine handles the step. */
export type IdeStepAgent = 'uplift' | 'mutly' | 'agent-browser' | 'megacode' | 'big-homie' | 'codegang' | 'opencode';

/** What kind of work the step performs. */
export type IdeStepKind =
  | 'plan'
  | 'codegen'
  | 'edit'
  | 'scan'
  | 'analyze'
  | 'symbols'
  | 'test'
  | 'typecheck'
  | 'build'
  | 'review'
  | 'browser-check'
  | 'command'
  | 'git-status'
  | 'git-diff'
  | 'git-commit'
  | 'diagnose'
  | 'repair'
  | 'verify'
  | 'message';

export interface IdeFileChange {
  path: string;
  action: 'created' | 'edited' | 'deleted' | 'untouched';
  summary?: string;
}

export interface IdeTestResult {
  name: string;
  status: 'pass' | 'fail' | 'error' | 'pending';
  duration_ms?: number;
  detail?: string;
}

/** Structured repair action the repair team can apply deterministically. */
export type IdeRepairActionType = 'patch' | 'env-set' | 'command' | 'preset' | 'restart';

export interface IdeRepairAction {
  type: IdeRepairActionType;
  /** patch */
  file?: string;
  find?: string;
  replace?: string;
  /** env-set */
  envFile?: string;
  key?: string;
  value?: string;
  /** command / preset */
  args?: string[];
  dir?: string;
  preset?: 'install' | 'install-ci' | 'prisma-generate' | 'pip-install' | 'typecheck' | 'lint' | 'test' | 'build';
  /** restart */
  service?: string;
  port?: number;
}

export interface IdeStep {
  id: string;
  index: number;
  title: string;
  kind: IdeStepKind;
  agent: IdeStepAgent;
  prompt: string;
  status: IdeStepStatus;
  /** Ids of steps that must finish successfully before this one runs. Empty/omitted = runnable immediately (in parallel). */
  dependsOn?: string[];
  /** Structured repair action (for diagnose/repair steps). */
  repair?: IdeRepairAction;
  detail?: string;
  files?: IdeFileChange[];
  tests?: IdeTestResult[];
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export type IdeDecisionStatus = 'pending' | 'approved' | 'rejected' | 'auto_decided' | 'timed_out';
export type IdeDecisionMethod = 'chat' | 'openchat' | 'email' | 'montecarlo';

export interface IdeDecisionOption {
  id: string;
  label: string;
  description?: string;
  params?: Record<string, unknown>;
  /** Monte Carlo estimate inputs: expected outcome (higher = better) and spread. */
  expectedOutcome?: number;
  outcomeSpread?: number;
}

export interface IdeDecision {
  id: string;
  prompt: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  status: IdeDecisionStatus;
  method: IdeDecisionMethod;
  options: IdeDecisionOption[];
  escalatedAt?: string;
  resolvedAt?: string;
  resolution?: string;
}

export type IdeEventType =
  | 'session.created'
  | 'crew.assembled'
  | 'session.started'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'step.waiting'
  | 'file.changed'
  | 'file.diff'
  | 'test.result'
  | 'diagnosis'
  | 'review.verdict'
  | 'message'
  | 'decision.required'
  | 'decision.escalated'
  | 'decision.resolved'
  | 'session.paused'
  | 'session.resumed'
  | 'session.completed'
  | 'session.error';

export interface IdeEvent {
  id: string;
  ts: string;
  type: IdeEventType;
  sessionId: string;
  stepId?: string;
  data: Record<string, unknown>;
}

export interface IdeChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: string;
}

/** The assembled coding/repair crew for a session. */
export interface IdeCrew {
  lead: string;
  members: string[];
  reason: string;
}

export interface IdeSession {
  id: string;
  goal: string;
  phase: IdePhase;
  crew: IdeCrew;
  steps: IdeStep[];
  decisions: IdeDecision[];
  events: IdeEvent[];
  chat: IdeChatMessage[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  workspace?: string;
  repoUrl?: string;
  note?: string;
  /** Pending human redirect — prepended to the next step's prompt then cleared. */
  redirect?: string;
  /** Review gate results from RepoRank / Grader. */
  review?: {
    scorer: string;
    score: number | null;
    grade?: string;
    summary: string;
    detail?: string;
    error?: string;
    gateThreshold: number;
    passed: boolean;
  };
}
