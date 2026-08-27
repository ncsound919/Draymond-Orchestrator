import { describe, expect, it } from 'vitest';
import { subscribeToStream, emit } from '../../src/lib/draymond/event-bridge';

describe('event-bridge stream subscription', () => {
  it('delivers emitted events to subscribers', () => {
    const received: unknown[] = [];
    const unsub = subscribeToStream((e) => received.push(e));
    emit('scheduler.job_started', { job_id: 'j1', job_name: 'x', job_type: 'chain' });
    expect(received.length).toBe(1);
    expect((received[0] as { type: string }).type).toBe('scheduler.job_started');
    unsub();
  });

  it('stops delivering after unsubscribe', () => {
    const received: unknown[] = [];
    const unsub = subscribeToStream((e) => received.push(e));
    unsub();
    emit('scheduler.job_completed', { job_id: 'j2', job_name: 'y', job_type: 'chain' });
    expect(received.length).toBe(0);
  });
});