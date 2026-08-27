// Locks the truth-gate: credential-class brain fallback must escalate (the
// root cause is UNREPAIRED), never record 'fixed'. Regression test for the
// Aug-2026 research-brief-delivery 401 loop masking.
import { describe, expect, it, afterAll, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repairFailedJob } from '../src/lib/draymond/repair-team';
import { TokenErrorType } from '../src/lib/draymond/chain-execution-fallback';
import type { ChainExecutionResult } from '../src/lib/draymond/chain-execution-fallback';

// Hermetic registry dir so the brain-fallback repair path never touches the
// real .draymond logs.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-truth-gate-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

// The coding-repair dispatch must never hit a real process.
vi.mock('../src/lib/draymond/coding-repair', () => ({
  dispatchCodingRepair: vi.fn(async () => ({
    action: 'handed-off',
    detail: 'coding crew (test mock) proposed a fix',
    dispatch: { kind: 'codegen', engine: 'test-mock', result: 'mock', duration_ms: 1 },
  })),
}));

// Deterministic mock of the brain fallback executor — controlled per-test.
// vi.hoisted keeps the mock fn reference valid inside the hoisted vi.mock
// factory; importOriginal preserves the real TokenErrorType enum (repair-team
// imports it directly).
const { executeChainWithBrainFallbackMock } = vi.hoisted(() => ({
  executeChainWithBrainFallbackMock: vi.fn(),
}));
vi.mock('../src/lib/draymond/chain-execution-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/draymond/chain-execution-fallback')>();
  return {
    ...actual,
    executeChainWithBrainFallback: (...args: unknown[]) =>
      executeChainWithBrainFallbackMock(...args) as ReturnType<typeof executeChainWithBrainFallbackMock>,
  };
});

afterAll(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  executeChainWithBrainFallbackMock.mockReset();
});

describe('repair truth-gate — credential fallback is never "fixed"', () => {
  it('escalates (not fixes) when the brain fallback masks an EXPIRED_TOKEN', async () => {
    executeChainWithBrainFallbackMock.mockResolvedValue({
      success: true,
      chain_id: 'j-cred',
      chain_name: 'Research Data Feed',
      fallback_used: true,
      errorType: TokenErrorType.EXPIRED_TOKEN,
      output: 'brain stopgap produced output',
    } as ChainExecutionResult);

    const report = await repairFailedJob(
      { id: 'j-cred', name: 'Research Data Feed', job_type: 'chain', job_config: {} },
      '401 Unauthorized — token expired',
      { updateJobConfig: async () => {} },
    );

    expect(report.action).toBe('escalated');
    expect(report.detail).toContain('UNREPAIRED');
    expect(report.detail).toContain('credential rotation required');
  });

  it('escalates (not fixes) for INVALID_CREDENTIALS too', async () => {
    executeChainWithBrainFallbackMock.mockResolvedValue({
      success: true,
      chain_id: 'j-cred2',
      chain_name: 'Morning Briefing',
      fallback_used: true,
      errorType: TokenErrorType.INVALID_CREDENTIALS,
      output: 'brain stopgap produced output',
    } as ChainExecutionResult);

    const report = await repairFailedJob(
      { id: 'j-cred2', name: 'Morning Briefing', job_type: 'chain', job_config: {} },
      'invalid credentials for provider',
      { updateJobConfig: async () => {} },
    );

    expect(report.action).toBe('escalated');
    expect(report.detail).toContain('UNREPAIRED');
  });

  it('records a benign service-outage fallback as fixed', async () => {
    executeChainWithBrainFallbackMock.mockResolvedValue({
      success: true,
      chain_id: 'j-svc',
      chain_name: 'Social Publish Drainer',
      fallback_used: true,
      errorType: TokenErrorType.SERVICE_UNAVAILABLE,
      output: 'brain completed chain after outage',
    } as ChainExecutionResult);

    const report = await repairFailedJob(
      { id: 'j-svc', name: 'Social Publish Drainer', job_type: 'chain', job_config: {} },
      '503 Service Unavailable',
      { updateJobConfig: async () => {} },
    );

    expect(report.action).toBe('fixed');
    expect(report.detail).toContain('service outage');
  });
});