// src/components/visualizer/state/types.ts
export type HealthState = 'healthy' | 'degraded' | 'down';
export type VehicleStatus = 'transit' | 'arrived' | 'failed';
export type LogKind = 'info' | 'success' | 'fail';

export interface Building {
  slug: string;
  name: string;
  category: string;
  port: number | null;
  health: HealthState;
  district: string;
  gridX: number;
  gridY: number;
  height: number;
}

export interface Vehicle {
  id: string;
  jobName: string;
  from: string;
  to: string;
  progress: number; // 0..1 along road path
  status: VehicleStatus;
  startedAt: number; // epoch ms — renderer interpolates progress from this
}

export interface Effect {
  id: string;
  kind: 'smoke' | 'explosion' | 'pulse' | 'beacon';
  slug: string;
  bornAt: number; // epoch ms
  ttl: number; // ms
}

export interface RadarBlip {
  jobId: string;
  name: string;
  nextRunAt: string | null;
}

export interface ShipLogEntry {
  id: string;
  ts: string;
  text: string;
  kind: LogKind;
}

export interface SnapshotPayload {
  services: Array<{
    slug: string;
    name: string;
    category: string;
    port: number | null;
    up: boolean;
  }>;
  agents: Array<{ slug: string; name: string; up: boolean }>;
  jobs: Array<{ id: string; name: string; next_run_at: string | null; last_run_status: string }>;
  moments: Array<{ id: string; kind: string; severity: string; title: string; source: string; acked: boolean }>;
  revenueUsd: number;
  degraded: boolean;
  servicesUp: number;
  servicesTotal: number;
  checkedAt: string;
}

export interface SimState {
  buildings: Record<string, Building>;
  vehicles: Record<string, Vehicle>;
  effects: Record<string, Effect>;
  radar: RadarBlip[];
  alerts: Array<{ id: string; kind: string; severity: string; title: string; source: string; acked: boolean }>;
  degraded: boolean;
  revenueUsd: number;
  servicesUp: number;
  servicesTotal: number;
  ticker: ShipLogEntry[];
  lastUpdate: string | null;
  signalLost: boolean;
}

export function isHealthState(v: unknown): v is HealthState {
  return v === 'healthy' || v === 'degraded' || v === 'down';
}
export function isVehicleStatus(v: unknown): v is VehicleStatus {
  return v === 'transit' || v === 'arrived' || v === 'failed';
}
export function isLogKind(v: unknown): v is LogKind {
  return v === 'info' || v === 'success' || v === 'fail';
}