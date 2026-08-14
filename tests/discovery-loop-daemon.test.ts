import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

// Mock the runner so the daemon tests never spawn a real process.
vi.mock('../src/lib/draymond/discovery-loop-runner', () => ({
  runDiscoveryLoopScript: vi.fn(async () => ({ ok: true, stdout: 'mock discovery-loop output', durationMs: 7 })),
}));

import { runDiscoveryLoopScript } from '../src/lib/draymond/discovery-loop-runner';
import { startDiscoveryLoopDaemon, stopDiscoveryLoopDaemon } from '../src/lib/draymond/discovery-loop-daemon';

const mockedRun = vi.mocked(runDiscoveryLoopScript);

describe('discovery loop daemon', () => {
  beforeEach(() => {
    delete process.env.DRAYMOND_DISCOVERY_LOOP_ENABLED;
    delete process.env.DRAYMOND_DISCOVERY_LOOP_INTERVAL_MS;
    stopDiscoveryLoopDaemon();
    mockedRun.mockClear();
  });

  afterEach(() => {
    stopDiscoveryLoopDaemon();
    delete process.env.DRAYMOND_DISCOVERY_LOOP_ENABLED;
  });

  it('runs an immediate catch-up tick on start (one iteration)', async () => {
    startDiscoveryLoopDaemon();
    await vi.waitFor(() => expect(mockedRun).toHaveBeenCalledTimes(1));
    expect(mockedRun.mock.calls[0][0]?.iterations).toBe(1);
    expect(mockedRun.mock.calls[0][0]?.repair).toBe(true);
  });

  it('is idempotent — starting twice only runs one catch-up tick', async () => {
    startDiscoveryLoopDaemon();
    startDiscoveryLoopDaemon();
    startDiscoveryLoopDaemon();
    await vi.waitFor(() => expect(mockedRun).toHaveBeenCalledTimes(1));
  });

  it('respects the kill switch and does not tick', async () => {
    process.env.DRAYMOND_DISCOVERY_LOOP_ENABLED = '0';
    startDiscoveryLoopDaemon();
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it('stop clears the daemon cleanly', async () => {
    startDiscoveryLoopDaemon();
    await vi.waitFor(() => expect(mockedRun).toHaveBeenCalledTimes(1));
    expect(() => stopDiscoveryLoopDaemon()).not.toThrow();
    // Starting again after stop works (single catch-up tick).
    mockedRun.mockClear();
    startDiscoveryLoopDaemon();
    await vi.waitFor(() => expect(mockedRun).toHaveBeenCalledTimes(1));
  });
});
