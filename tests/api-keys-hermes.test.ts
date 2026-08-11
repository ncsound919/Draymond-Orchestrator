import { afterEach, describe, expect, it } from 'vitest';
import { auditApiKeys, FREE_API_REGISTRY } from '../src/lib/draymond/api-keys';

const SAVED: Record<string, string | undefined> = {};

function setEnv(k: string, v: string | undefined) {
  if (!(k in SAVED)) SAVED[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

afterEach(() => {
  for (const k of Object.keys(SAVED)) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe('FREE_API_REGISTRY — Hermes api_server', () => {
  it('includes a Hermes api_server entry referencing API_SERVER_* env vars', () => {
    const entry = FREE_API_REGISTRY.find((e) => e.name === 'Hermes api_server');
    expect(entry, 'registry entry missing').toBeDefined();
    expect(entry!.engine).toBe('ops');
    expect(entry!.envVars).toEqual(
      expect.arrayContaining(['API_SERVER_HOST', 'API_SERVER_PORT', 'API_SERVER_KEY']),
    );
    expect(entry!.noKey).toBe(false);
  });

  it('reports the entry as configured when all three env vars are present', () => {
    setEnv('API_SERVER_HOST', '127.0.0.1');
    setEnv('API_SERVER_PORT', '8642');
    setEnv('API_SERVER_KEY', 'unit-test-key');
    const result = auditApiKeys();
    const item = result.items.find((i) => i.name === 'Hermes api_server');
    expect(item?.state).toBe('configured');
  });

  it('reports the entry as missing when API_SERVER_KEY is absent', () => {
    setEnv('API_SERVER_HOST', undefined);
    setEnv('API_SERVER_PORT', undefined);
    setEnv('API_SERVER_KEY', undefined);
    const result = auditApiKeys();
    const item = result.items.find((i) => i.name === 'Hermes api_server');
    expect(item?.state).toBe('missing');
  });
});
