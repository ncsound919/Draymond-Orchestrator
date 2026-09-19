// ============================================================================
// DRAYMOND — Bridge Server (remote-control work queue)
// ============================================================================
// Server-side half of the Uplift bridge protocol. Open-Chat's
// UpliftBridgeClient polls THIS service for work, acks/heartbeats work items,
// and posts session events back. Draymond runs the sessions.
//
// Wire contract (mirrors the bridge worker reference):
//   POST   /v1/environments/bridge                     register environment
//   GET    /v1/environments/{envId}/work/poll          poll for work
//   POST   /v1/environments/{envId}/work/{workId}/ack  ack a work item
//   POST   /v1/environments/{envId}/work/{workId}/heartbeat  extend lease
//   POST   /v1/environments/{envId}/work/{workId}/stop force-stop
//   DELETE /v1/environments/bridge/{envId}             deregister
//   POST   /v1/sessions/{sessionId}/events             send session event
//
// Pure server-side module — no Next.js request context. Uses an in-memory
// work store so it is unit-testable without a database.
// ============================================================================

import { randomBytes, randomUUID, createHash } from 'crypto';
import { ndjsonSafeStringify } from './ndjson';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BridgeWorkerType = 'claude_code' | 'claude_code_assistant' | string;

export interface BridgeEnvironment {
  environment_id: string;
  environment_secret: string;
  machine_name: string;
  worker_type: BridgeWorkerType;
  /** Backend-issued env id this environment was resumed onto, if any. */
  reuse_environment_id?: string;
  max_sessions: number;
  /** API base URL baked into work secrets so the worker targets the right host. */
  api_base_url: string;
  created_at: string;
  last_poll_at: number | null;
  /** Clients this environment has spawned, keyed by session id. */
  sessions: Map<string, BridgeSession>;
  /** Pending work items, FIFO. */
  queue: BridgeWorkItem[];
}

export interface BridgeSession {
  session_id: string;
  environment_id: string;
  title: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  created_at: string;
  updated_at: string;
  /** Session ingress token issued to the worker (Bearer on session calls). */
  session_ingress_token: string;
  /** Inbound/outbound message log for the session. */
  events: SessionEvent[];
}

export interface SessionEvent {
  type: 'user' | 'assistant' | 'tool_start' | 'result' | 'error' | string;
  content?: string;
  summary?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface BridgeWorkItem {
  id: string;
  type: 'work';
  environment_id: string;
  state: 'queued' | 'in_progress' | 'completed' | 'failed' | 'interrupted';
  data: {
    type: 'session' | 'healthcheck';
    id: string;
  };
  /** base64url-encoded JSON work secret (version, token, api_base_url). */
  secret: string;
  /** Lease expiry (ms epoch). Heartbeat extends it. */
  lease_until: number;
  created_at: string;
  /** When true the work item was force-stopped by the operator. */
  stop_requested?: boolean;
}

export interface BridgeConfig {
  dir: string;
  machineName: string;
  branch: string;
  gitRepoUrl: string | null;
  maxSessions: number;
  spawnMode?: 'single-session' | 'worktree' | 'same-dir';
  workerType?: string;
  bridgeId?: string;
  environmentId?: string;
}

export interface RegisterResult {
  environment_id: string;
  environment_secret: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Work lease TTL in ms (5 minutes, matches the reference protocol). */
export const WORK_LEASE_TTL_MS = 5 * 60 * 1000;
/** Environments idle for longer than this are garbage-collected. */
export const ENV_TTL_MS = 24 * 60 * 60 * 1000;
/** Sweep interval for idle-env reclamation. */
export const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * In-memory bridge store. Intentionally plain (maps + timestamps) so tests
 * can exercise the full lifecycle without a DB. A future migration can back
 * it with the SQLite store while keeping this interface.
 */
export class BridgeStore {
  private environments = new Map<string, BridgeEnvironment>();

  constructor() {
    // Idle-environment reaper. Unref so the timer never holds the process open.
    const sweep = setInterval(() => this.sweepIdleEnvironments(), SWEEP_INTERVAL_MS);
    sweep.unref?.();
  }

  private static secret(): string {
    return randomBytes(24).toString('base64url');
  }

  private static id(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }

  /** Encode the work secret (base64url JSON) handed to the worker. */
  private static encodeSecret(session: BridgeSession, apiBaseUrl: string): string {
    const payload = {
      version: 1,
      session_ingress_token: session.session_ingress_token,
      api_base_url: apiBaseUrl,
      auth: [{ type: 'bearer', token: session.session_ingress_token }],
    };
    return Buffer.from(ndjsonSafeStringify(payload), 'utf-8').toString('base64url');
  }

  // -- Environment lifecycle -----------------------------------------------

  register(config: BridgeConfig, apiBaseUrl: string): RegisterResult {
    const environmentId = config.environmentId
      ? // Reuse the backend-issued id on resume (idempotent re-registration).
        config.environmentId
      : BridgeStore.id('env');

    const existing = this.environments.get(environmentId);
    if (existing) {
      existing.last_poll_at = Date.now();
      existing.machine_name = config.machineName;
      existing.worker_type = config.workerType ?? 'claude_code';
      existing.max_sessions = config.maxSessions;
      existing.api_base_url = apiBaseUrl || existing.api_base_url;
      return {
        environment_id: existing.environment_id,
        environment_secret: existing.environment_secret,
      };
    }

    const env: BridgeEnvironment = {
      environment_id: environmentId,
      environment_secret: BridgeStore.secret(),
      machine_name: config.machineName,
      worker_type: config.workerType ?? 'claude_code',
      reuse_environment_id: config.environmentId,
      max_sessions: config.maxSessions,
      api_base_url: apiBaseUrl,
      created_at: new Date().toISOString(),
      last_poll_at: Date.now(),
      sessions: new Map(),
      queue: [],
    };
    this.environments.set(environmentId, env);
    return {
      environment_id: environmentId,
      environment_secret: env.environment_secret,
    };
  }

  /** Look up an environment, validating its secret. */
  private getEnvironment(environmentId: string, secret: string): BridgeEnvironment | null {
    const env = this.environments.get(environmentId);
    if (!env) return null;
    if (!timingSafeStrEq(env.environment_secret, secret)) return null;
    return env;
  }

  /** Public read for status endpoints. */
  getEnvironmentPublic(environmentId: string): BridgeEnvironment | null {
    return this.environments.get(environmentId) ?? null;
  }

  deregister(environmentId: string, secret: string): boolean {
    const env = this.getEnvironment(environmentId, secret);
    if (!env) return false;
    this.environments.delete(environmentId);
    return true;
  }

  // -- Work queue ----------------------------------------------------------

  /**
   * Enqueue a session work item for a worker environment. Returns the work
   * item so callers can surface the session id immediately.
   */
  enqueueSession(
    environmentId: string,
    secret: string,
    opts: {
      sessionId?: string;
      title?: string;
      apiBaseUrl?: string;
    } = {},
  ): { work: BridgeWorkItem; session: BridgeSession } | null {
    const env = this.getEnvironment(environmentId, secret);
    if (!env) return null;

    const sessionId = opts.sessionId ?? BridgeStore.id('sess');
    const ingressToken = BridgeStore.secret();
    const session: BridgeSession = {
      session_id: sessionId,
      environment_id: environmentId,
      title: opts.title ?? 'Remote session',
      status: 'running',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      session_ingress_token: ingressToken,
      events: [],
    };
    env.sessions.set(sessionId, session);

    const work: BridgeWorkItem = {
      id: BridgeStore.id('work'),
      type: 'work',
      environment_id: environmentId,
      state: 'queued',
      data: { type: 'session', id: sessionId },
      secret: BridgeStore.encodeSecret(
        session,
        opts.apiBaseUrl ?? env.api_base_url,
      ),
      lease_until: Date.now() + WORK_LEASE_TTL_MS,
      created_at: new Date().toISOString(),
    };
    env.queue.push(work);

    return { work, session };
  }

  /**
   * Poll for work. Returns the next queued/in-progress work item or null.
   * The worker acks it afterward; until then it stays queued so a reconnect
   * re-claims the same work.
   */
  pollForWork(environmentId: string, secret: string): BridgeWorkItem | null {
    const env = this.getEnvironment(environmentId, secret);
    if (!env) return null;
    env.last_poll_at = Date.now();
    return env.queue.find((w) => w.state === 'queued' || w.state === 'in_progress') ?? null;
  }

  ackWork(environmentId: string, workId: string, token: string): boolean {
    const env = this.environments.get(environmentId);
    if (!env) return false;
    const work = env.queue.find((w) => w.id === workId);
    if (!work) return false;
    const session = env.sessions.get(work.data.id);
    if (session && !timingSafeStrEq(session.session_ingress_token, token)) {
      return false;
    }
    if (work.state === 'queued') {
      work.state = 'in_progress';
      work.lease_until = Date.now() + WORK_LEASE_TTL_MS;
    }
    return true;
  }

  /**
   * Extend the work item lease. Returns lease status; a terminal session
   * state is reported so the worker can stop heartbeating.
   */
  heartbeatWork(
    environmentId: string,
    workId: string,
    token: string,
  ): { lease_extended: boolean; state: string } | null {
    const env = this.environments.get(environmentId);
    if (!env) return null;
    const work = env.queue.find((w) => w.id === workId);
    if (!work) return null;
    const session = env.sessions.get(work.data.id);
    if (session && !timingSafeStrEq(session.session_ingress_token, token)) {
      return null;
    }

    if (work.stop_requested) {
      work.state = 'interrupted';
      return { lease_extended: false, state: 'interrupted' };
    }

    work.lease_until = Date.now() + WORK_LEASE_TTL_MS;
    work.state = 'in_progress';
    const terminal = session?.status === 'completed' || session?.status === 'failed';
    return { lease_extended: true, state: terminal ? session.status : 'running' };
  }

  stopWork(environmentId: string, workId: string, token: string, force: boolean): boolean {
    const env = this.environments.get(environmentId);
    if (!env) return false;
    const work = env.queue.find((w) => w.id === workId);
    if (!work) return false;
    const session = env.sessions.get(work.data.id);
    if (session && !timingSafeStrEq(session.session_ingress_token, token)) {
      return false;
    }
    work.stop_requested = true;
    work.state = force ? 'interrupted' : work.state;
    if (session && force) {
      session.status = 'interrupted';
      session.updated_at = new Date().toISOString();
    }
    return true;
  }

  // -- Sessions ------------------------------------------------------------

  /** Append a session event (user / assistant / tool / error). */
  appendSessionEvent(
    environmentId: string,
    sessionId: string,
    token: string,
    event: SessionEvent,
  ): boolean {
    const env = this.environments.get(environmentId);
    if (!env) return false;
    const session = env.sessions.get(sessionId);
    if (!session) return false;
    if (!timingSafeStrEq(session.session_ingress_token, token)) return false;
    session.events.push({ ...event, timestamp: event.timestamp ?? Date.now() });
    session.updated_at = new Date().toISOString();
    return true;
  }

  getSessionEvents(environmentId: string, sessionId: string): SessionEvent[] {
    const env = this.environments.get(environmentId);
    if (!env) return [];
    return env.sessions.get(sessionId)?.events ?? [];
  }

  /**
   * Reverse lookup: find the environment that owns a session id. Used by the
   * session-events route, which only receives a session id + token.
   */
  findEnvironmentBySession(
    sessionId: string,
  ): { environment_id: string; session_ingress_token: string } | null {
    for (const env of this.environments.values()) {
      const session = env.sessions.get(sessionId);
      if (session) {
        return {
          environment_id: env.environment_id,
          session_ingress_token: session.session_ingress_token,
        };
      }
    }
    return null;
  }

  completeSession(environmentId: string, sessionId: string, status: BridgeSession['status']): void {
    const env = this.environments.get(environmentId);
    const session = env?.sessions.get(sessionId);
    if (!session) return;
    session.status = status;
    session.updated_at = new Date().toISOString();
  }

  // -- Maintenance ---------------------------------------------------------

  /** Remove environments that have been idle longer than ENV_TTL_MS. */
  sweepIdleEnvironments(now: number = Date.now()): number {
    let removed = 0;
    for (const [id, env] of this.environments) {
      const last = env.last_poll_at ?? now;
      if (now - last > ENV_TTL_MS) {
        this.environments.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /** Diagnostic snapshot (status endpoint). */
  snapshot(): {
    environments: number;
    sessions: number;
    work: number;
  } {
    let sessions = 0;
    let work = 0;
    for (const env of this.environments.values()) {
      sessions += env.sessions.size;
      work += env.queue.length;
    }
    return { environments: this.environments.size, sessions, work };
  }

  /** Reset the store (tests). */
  reset(): void {
    this.environments.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timingSafeStrEq(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  let diff = 0;
  for (let i = 0; i < hashA.length; i++) diff |= hashA[i] ^ hashB[i];
  return diff === 0;
}

/** Validate an ID before interpolating it into a URL path. */
export function validateBridgeId(id: string, label: string): void {
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ${label}: contains unsafe characters`);
  }
}
