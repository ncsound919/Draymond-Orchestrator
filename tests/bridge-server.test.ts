import { describe, expect, it } from 'vitest';
import { BridgeStore } from '../src/lib/draymond/bridge-server';

const API_BASE = 'http://127.0.0.1:3444';

function makeEnv(store: BridgeStore, name = 'open-chat-client') {
  return store.register(
    {
      dir: '/',
      machineName: name,
      branch: 'main',
      gitRepoUrl: null,
      maxSessions: 1,
      workerType: 'chat',
    },
    API_BASE,
  );
}

describe('BridgeStore — environment lifecycle', () => {
  it('registers an environment and returns id + secret', () => {
    const store = new BridgeStore();
    const result = makeEnv(store);
    expect(result.environment_id).toMatch(/^env_/);
    expect(result.environment_secret.length).toBeGreaterThan(16);
    store.reset();
  });

  it('resume re-registration reuses the same environment', () => {
    const store = new BridgeStore();
    const first = makeEnv(store);
    const resumed = store.register(
      {
        dir: '/',
        machineName: 'open-chat-client',
        branch: 'main',
        gitRepoUrl: null,
        maxSessions: 1,
        workerType: 'chat',
        environmentId: first.environment_id,
      },
      API_BASE,
    );
    expect(resumed).toEqual(first);
    store.reset();
  });

  it('deregister removes the environment', () => {
    const store = new BridgeStore();
    const result = makeEnv(store);
    expect(store.deregister(result.environment_id, 'wrong-secret')).toBe(false);
    expect(store.deregister(result.environment_id, result.environment_secret)).toBe(true);
    store.reset();
  });

  it('sweeps idle environments', () => {
    const store = new BridgeStore();
    makeEnv(store);
    // 25h idle -> reaped
    expect(store.sweepIdleEnvironments(Date.now() + 25 * 60 * 60 * 1000)).toBe(1);
    store.reset();
  });
});

describe('BridgeStore — work queue', () => {
  it('polls null when idle, returns work after enqueue', () => {
    const store = new BridgeStore();
    const env = makeEnv(store);
    expect(store.pollForWork(env.environment_id, env.environment_secret)).toBeNull();

    const { work } = store.enqueueSession(env.environment_id, env.environment_secret, {
      title: 'Test task',
    })!;
    expect(work.state).toBe('queued');
    expect(work.data.type).toBe('session');

    const polled = store.pollForWork(env.environment_id, env.environment_secret)!;
    expect(polled.id).toBe(work.id);
    expect(polled.secret).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    store.reset();
  });

  it('work secret decodes to a version-1 token carrying api_base_url', () => {
    const store = new BridgeStore();
    const env = makeEnv(store);
    const { work } = store.enqueueSession(env.environment_id, env.environment_secret, {})!;
    const raw = Buffer.from(work.secret, 'base64url').toString('utf-8');
    const secret = JSON.parse(raw);
    expect(secret.version).toBe(1);
    expect(typeof secret.session_ingress_token).toBe('string');
    expect(secret.api_base_url).toBe(API_BASE);
    store.reset();
  });

  it('pollForWork rejects a bad environment secret', () => {
    const store = new BridgeStore();
    const env = makeEnv(store);
    store.enqueueSession(env.environment_id, env.environment_secret, {});
    expect(store.pollForWork(env.environment_id, 'bad-secret')).toBeNull();
    store.reset();
  });

  it('ack transitions queued -> in_progress with the session token', () => {
    const store = new BridgeStore();
    const env = makeEnv(store);
    const { work, session } = store.enqueueSession(env.environment_id, env.environment_secret, {})!;
    expect(store.ackWork(env.environment_id, work.id, 'wrong-token')).toBe(false);
    expect(store.ackWork(env.environment_id, work.id, session.session_ingress_token)).toBe(true);
    const polled = store.pollForWork(env.environment_id, env.environment_secret)!;
    expect(polled.state).toBe('in_progress');
    store.reset();
  });

  it('heartbeat extends the lease and reports running', () => {
    const store = new BridgeStore();
    const env = makeEnv(store);
    const { work, session } = store.enqueueSession(env.environment_id, env.environment_secret, {})!;
    store.ackWork(env.environment_id, work.id, session.session_ingress_token);

    const hb = store.heartbeatWork(env.environment_id, work.id, session.session_ingress_token)!;
    expect(hb.lease_extended).toBe(true);
    expect(hb.state).toBe('running');
    store.reset();
  });

  it('heartbeat reports interrupted after a forced stop', () => {
    const store = new BridgeStore();
    const env = makeEnv(store);
    const { work, session } = store.enqueueSession(env.environment_id, env.environment_secret, {})!;
    store.ackWork(env.environment_id, work.id, session.session_ingress_token);
    expect(store.stopWork(env.environment_id, work.id, session.session_ingress_token, true)).toBe(true);

    const hb = store.heartbeatWork(env.environment_id, work.id, session.session_ingress_token)!;
    expect(hb.lease_extended).toBe(false);
    expect(hb.state).toBe('interrupted');
    store.reset();
  });
});

describe('BridgeStore — sessions', () => {
  it('appends and reads session events', () => {
    const store = new BridgeStore();
    const env = makeEnv(store);
    const { session } = store.enqueueSession(env.environment_id, env.environment_secret, {})!;

    expect(
      store.appendSessionEvent(env.environment_id, session.session_id, 'bad-token', {
        type: 'user',
        content: 'nope',
        timestamp: Date.now(),
      }),
    ).toBe(false);

    expect(
      store.appendSessionEvent(
        env.environment_id,
        session.session_id,
        session.session_ingress_token,
        { type: 'user', content: 'hello', timestamp: Date.now() },
      ),
    ).toBe(true);

    const events = store.getSessionEvents(env.environment_id, session.session_id);
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe('hello');
    store.reset();
  });

  it('findEnvironmentBySession resolves the owning environment', () => {
    const store = new BridgeStore();
    const env = makeEnv(store);
    const { session } = store.enqueueSession(env.environment_id, env.environment_secret, {})!;
    const found = store.findEnvironmentBySession(session.session_id);
    expect(found?.environment_id).toBe(env.environment_id);
    expect(found?.session_ingress_token).toBe(session.session_ingress_token);
    store.reset();
  });

  it('completing a session reports the terminal state on heartbeat', () => {
    const store = new BridgeStore();
    const env = makeEnv(store);
    const { work, session } = store.enqueueSession(env.environment_id, env.environment_secret, {})!;
    store.ackWork(env.environment_id, work.id, session.session_ingress_token);
    store.completeSession(env.environment_id, session.session_id, 'completed');

    const hb = store.heartbeatWork(env.environment_id, work.id, session.session_ingress_token)!;
    expect(hb.state).toBe('completed');
    store.reset();
  });

  it('snapshot counts environments, sessions, and work items', () => {
    const store = new BridgeStore();
    const env = makeEnv(store);
    store.enqueueSession(env.environment_id, env.environment_secret, {});
    const snap = store.snapshot();
    expect(snap.environments).toBe(1);
    expect(snap.sessions).toBe(1);
    expect(snap.work).toBe(1);
    store.reset();
  });
});
