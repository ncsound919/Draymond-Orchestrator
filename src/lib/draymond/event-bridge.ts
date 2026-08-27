// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Open Chat Event Bridge
// ============================================================================
// Centralised event publishing for real-time communication with Open Chat.
// All subsystems (chains, scheduler, monitors, notifications, invoker) call
// these helpers to push events to connected SSE clients.
//
// v2: Now also feeds events into the Reactive Event System for cross-chain
//     triggers and conditional chain spawning.
// ============================================================================

type OrchestratorEvent = {
  type: string;
  data: Record<string, unknown>;
  ts: string;
};

export type StreamSubscriber = (event: OrchestratorEvent) => void;
const streamSubscribers = new Set<StreamSubscriber>();

/** Subscribe to a live copy of every event published to the SSE bridge. Returns unsubscribe. */
export function subscribeToStream(cb: StreamSubscriber): () => void {
  streamSubscribers.add(cb);
  return () => streamSubscribers.delete(cb);
}

// NOTE: The publishEvent function lives in the events route module.
// We lazy-import it to avoid circular dependency issues with Next.js route modules.
let _publishEvent: ((event: OrchestratorEvent) => void) | null = null;

function getPublisher() {
  if (!_publishEvent) {
    try {
      // Dynamic require to break the circular dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@/app/api/v1/events/route');
      _publishEvent = mod.publishEvent;
    } catch {
      // Events route not available (e.g. during build or test)
      _publishEvent = () => {};
    }
  }
  return _publishEvent!;
}

// Lazy-import reactive system to avoid circular deps
let _onBridgeEvent: ((type: string, data: Record<string, unknown>) => Promise<void>) | null = null;

function getReactiveHandler() {
  if (!_onBridgeEvent) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('./reactive');
      _onBridgeEvent = mod.onBridgeEvent;
    } catch {
      _onBridgeEvent = async () => {};
    }
  }
  return _onBridgeEvent!;
}

// Lazy-import systemic interconnection (memory + self-learning + knowledge
// graph + agenda). Every emit() feeds all persistent stores automatically —
// no per-tool integration required.
let _onSystemicEvent: ((type: string, data: Record<string, unknown>) => Promise<void>) | null = null;

function getSystemicHandler() {
  if (!_onSystemicEvent) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('./systemic');
      _onSystemicEvent = mod.ingestEvent;
    } catch {
      _onSystemicEvent = async () => {};
    }
  }
  return _onSystemicEvent!;
}

export function emit(type: string, data: Record<string, unknown>): void {
  try {
    // Push to SSE clients (Open Chat)
    getPublisher()({ type, data, ts: new Date().toISOString() });

    // Feed into reactive event system (fire-and-forget)
    getReactiveHandler()(type, data).catch(() => {});

    // Feed into systemic stores: memory + self-learning + knowledge graph
    getSystemicHandler()(type, data).catch(() => {});

    // Feed into in-process subscribers (e.g. Ecosystem Visualizer)
    for (const sub of streamSubscribers) {
      try { sub({ type, data, ts: new Date().toISOString() }); } catch { /* never break the event path */ }
    }
  } catch {
    // Non-fatal: SSE push is best-effort
  }
}

// ── Chain Events ─────────────────────────────────────────────────────────────

export function emitChainStarted(chainId: string, chainName: string, totalSteps: number, agentId?: string): void {
  emit('chain.started', { chain_id: chainId, chain_name: chainName, total_steps: totalSteps, agent_id: agentId ?? null });
}

export function emitChainStepCompleted(chainId: string, stepName: string, stepIndex: number, totalSteps: number, durationMs: number): void {
  emit('chain.step_completed', { chain_id: chainId, step_name: stepName, step_index: stepIndex, total_steps: totalSteps, duration_ms: durationMs });
}

export function emitChainStepFailed(chainId: string, stepName: string, stepIndex: number, error: string): void {
  emit('chain.step_failed', { chain_id: chainId, step_name: stepName, step_index: stepIndex, error });
}

export function emitChainCompleted(chainId: string, chainName: string, completedSteps: number, failedSteps: number, durationMs: number): void {
  emit('chain.completed', { chain_id: chainId, chain_name: chainName, completed_steps: completedSteps, failed_steps: failedSteps, duration_ms: durationMs });
}

export function emitChainFailed(chainId: string, chainName: string, completedSteps: number, failedSteps: number, durationMs: number, error: string): void {
  emit('chain.failed', { chain_id: chainId, chain_name: chainName, completed_steps: completedSteps, failed_steps: failedSteps, duration_ms: durationMs, error });
}

// ── Agent/Entity Events ──────────────────────────────────────────────────────

export function emitAgentInvoked(entityId: string, entityName: string, action: string, method: string): void {
  emit('agent.invoked', { entity_id: entityId, entity_name: entityName, action, method });
}

export function emitAgentResult(entityId: string, entityName: string, success: boolean, durationMs: number, error?: string): void {
  emit('agent.result', { entity_id: entityId, entity_name: entityName, success, duration_ms: durationMs, error: error ?? null });
}

export function emitAgentRegistered(agentId: string, agentName: string, capabilities: string[]): void {
  emit('agent.registered', { agent: { id: agentId, name: agentName, capabilities, status: 'online' } });
}

export function emitAgentUpdated(agentId: string, agentName: string, status: string): void {
  emit('agent.updated', { agent: { id: agentId, name: agentName, status } });
}

// ── Monitor Events ───────────────────────────────────────────────────────────

export function emitSiteDown(monitorId: string, monitorName: string, url: string, statusCode: number | null, responseTimeMs: number | null, consecutiveFailures: number): void {
  emit('monitor.site_down', { monitor_id: monitorId, monitor_name: monitorName, url, status_code: statusCode, response_time_ms: responseTimeMs, consecutive_failures: consecutiveFailures });
}

export function emitSiteRecovered(monitorId: string, monitorName: string, url: string, statusCode: number | null, responseTimeMs: number | null): void {
  emit('monitor.site_recovered', { monitor_id: monitorId, monitor_name: monitorName, url, status_code: statusCode, response_time_ms: responseTimeMs });
}

export function emitHealthCheckComplete(totalMonitors: number, upCount: number, downCount: number): void {
  emit('monitor.health_check_complete', { total_monitors: totalMonitors, up_count: upCount, down_count: downCount });
}

// ── Scheduler Events ─────────────────────────────────────────────────────────

export function emitJobStarted(jobId: string, jobName: string, jobType: string): void {
  emit('scheduler.job_started', { job_id: jobId, job_name: jobName, job_type: jobType });
}

export function emitJobCompleted(jobId: string, jobName: string, jobType: string, durationMs: number): void {
  emit('scheduler.job_completed', { job_id: jobId, job_name: jobName, job_type: jobType, duration_ms: durationMs });
}

export function emitJobFailed(jobId: string, jobName: string, jobType: string, error: string): void {
  emit('scheduler.job_failed', { job_id: jobId, job_name: jobName, job_type: jobType, error });
}

// ── Notification Events (forward email notifications to SSE) ─────────────────

export function emitNotificationSent(notificationId: string, type: string, subject: string, priority: string, recipient: string): void {
  emit('notification.sent', { notification_id: notificationId, type, subject, priority, recipient });
}

export function emitNotificationFailed(notificationId: string, type: string, subject: string, error: string): void {
  emit('notification.failed', { notification_id: notificationId, type, subject, error });
}

// ── Open Chat Client Status ──────────────────────────────────────────────────

export function emitClientConnected(clientId: string, clientCount: number): void {
  emit('client.connected', { client_id: clientId, client_count: clientCount });
}

export function emitClientDisconnected(clientId: string, clientCount: number): void {
  emit('client.disconnected', { client_id: clientId, client_count: clientCount });
}
