// src/components/visualizer/state/reducer.ts
import { buildBuildings } from './layout';
import type { ShipLogEntry, SimState, SnapshotPayload, Vehicle } from './types';

export type SimAction =
  | { type: 'APPLY_SNAPSHOT'; payload: SnapshotPayload }
  | { type: 'JOB_STARTED'; jobId: string; jobName: string; jobType: string; to: string }
  | { type: 'JOB_COMPLETED'; jobId: string; jobName: string; jobType: string; to: string }
  | { type: 'JOB_FAILED'; jobId: string; jobName: string; jobType: string; to: string }
  | { type: 'SIGNAL_LOST' }
  | { type: 'SIGNAL_RESTORED' }
  | { type: 'TICK'; now: number };

let seq = 0;
function nextId(): string { seq += 1; return `sim-${seq}`; }
function log(text: string, kind: ShipLogEntry['kind'] = 'info', ts = new Date().toISOString()): ShipLogEntry {
  return { id: nextId(), ts, text, kind };
}

export function initialState(): SimState {
  return {
    buildings: {},
    vehicles: {},
    effects: {},
    radar: [],
    alerts: [],
    degraded: false,
    revenueUsd: 0,
    servicesUp: 0,
    servicesTotal: 0,
    ticker: [],
    lastUpdate: null,
    signalLost: false,
  };
}

export function simReducer(state: SimState, action: SimAction): SimState {
  switch (action.type) {
    case 'APPLY_SNAPSHOT': {
      const buildings = buildBuildings(action.payload);
      const radar = action.payload.jobs
        .filter((j) => j.next_run_at != null)
        .map((j) => ({ jobId: j.id, name: j.name, nextRunAt: j.next_run_at }));
      const alerts = action.payload.moments
        .filter((m) => !m.acked)
        .map((m) => ({ id: m.id, kind: m.kind, severity: m.severity, title: m.title, source: m.source, acked: false }));
      return {
        ...state,
        buildings,
        radar,
        alerts,
        degraded: action.payload.degraded,
        revenueUsd: action.payload.revenueUsd,
        servicesUp: action.payload.servicesUp,
        servicesTotal: action.payload.servicesTotal,
        lastUpdate: action.payload.checkedAt,
        signalLost: false,
      };
    }
    case 'JOB_STARTED': {
      const vehicle: Vehicle = { id: action.jobId, jobName: action.jobName, from: 'scheduler', to: action.to, progress: 0, status: 'transit', startedAt: Date.now() };
      return {
        ...state,
        vehicles: { ...state.vehicles, [action.jobId]: vehicle },
        ticker: [log(`\u2192 ${action.jobName}: started`, 'info'), ...state.ticker].slice(0, 60),
      };
    }
    case 'JOB_COMPLETED': {
      const v = state.vehicles[action.jobId];
      if (!v) return state;
      const pulseId = nextId();
      return {
        ...state,
        vehicles: { ...state.vehicles, [action.jobId]: { ...v, status: 'arrived', progress: 1 } },
        effects: {
          ...state.effects,
          [pulseId]: { id: pulseId, kind: 'pulse', slug: action.to, bornAt: Date.now(), ttl: 1500 },
        },
        ticker: [log(`\u2713 ${action.jobName}: completed`, 'success'), ...state.ticker].slice(0, 60),
      };
    }
    case 'JOB_FAILED': {
      const smokeId = nextId();
      return {
        ...state,
        effects: {
          ...state.effects,
          [smokeId]: { id: smokeId, kind: 'smoke', slug: action.to, bornAt: Date.now(), ttl: 8000 },
        },
        ticker: [log(`\u2717 ${action.jobName}: failed`, 'fail'), ...state.ticker].slice(0, 60),
      };
    }
    case 'SIGNAL_LOST':
      return { ...state, signalLost: true };
    case 'SIGNAL_RESTORED':
      return { ...state, signalLost: false };
    case 'TICK':
      return state;
    default:
      return state;
  }
}