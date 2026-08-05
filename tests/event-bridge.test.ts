import { describe, expect, it } from 'vitest';
import {
  emitChainStarted,
  emitChainStepCompleted,
  emitChainStepFailed,
  emitChainCompleted,
  emitChainFailed,
  emitAgentInvoked,
  emitAgentResult,
  emitAgentRegistered,
  emitAgentUpdated,
  emitSiteDown,
  emitSiteRecovered,
  emitHealthCheckComplete,
  emitJobStarted,
  emitJobCompleted,
  emitJobFailed,
  emitNotificationSent,
  emitNotificationFailed,
  emitClientConnected,
  emitClientDisconnected,
} from '../src/lib/draymond/event-bridge';

// The emitter lazily requires the events route (which resolves to a no-op in
// tests), so every emit helper should complete without throwing.
describe('event-bridge emit helpers', () => {
  it('emits chain lifecycle events', () => {
    expect(() => emitChainStarted('c1', 'Daily', 3, 'a1')).not.toThrow();
    expect(() => emitChainStepCompleted('c1', 's1', 1, 3, 50)).not.toThrow();
    expect(() => emitChainStepFailed('c1', 's1', 1, 'boom')).not.toThrow();
    expect(() => emitChainCompleted('c1', 'Daily', 3, 0, 100)).not.toThrow();
    expect(() => emitChainFailed('c1', 'Daily', 1, 2, 100, 'err')).not.toThrow();
  });

  it('emits agent events', () => {
    expect(() => emitAgentInvoked('e1', 'Echo', 'run', 'http_api')).not.toThrow();
    expect(() => emitAgentResult('e1', 'Echo', true, 5)).not.toThrow();
    expect(() => emitAgentResult('e1', 'Echo', false, 5, 'nope')).not.toThrow();
    expect(() => emitAgentRegistered('e1', 'Echo', ['calls'])).not.toThrow();
    expect(() => emitAgentUpdated('e1', 'Echo', 'online')).not.toThrow();
  });

  it('emits monitor events', () => {
    expect(() => emitSiteDown('m1', 'Site', 'https://x', 500, 100, 3)).not.toThrow();
    expect(() => emitSiteRecovered('m1', 'Site', 'https://x', 200, 40)).not.toThrow();
    expect(() => emitHealthCheckComplete(3, 2, 1)).not.toThrow();
  });

  it('emits scheduler and notification events', () => {
    expect(() => emitJobStarted('j1', 'daily', 'custom')).not.toThrow();
    expect(() => emitJobCompleted('j1', 'daily', 'custom', 200)).not.toThrow();
    expect(() => emitJobFailed('j1', 'daily', 'custom', 'err')).not.toThrow();
    expect(() => emitNotificationSent('n1', 'email', 'subject', 'normal', 'a@b.c')).not.toThrow();
    expect(() => emitNotificationFailed('n1', 'email', 'subject', 'err')).not.toThrow();
  });

  it('emits client connection events', () => {
    expect(() => emitClientConnected('cli-1', 2)).not.toThrow();
    expect(() => emitClientDisconnected('cli-1', 1)).not.toThrow();
  });
});
