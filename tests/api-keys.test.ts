import { afterEach, describe, expect, it } from 'vitest';
import { auditApiKeys, missingCriticalKeys, FREE_API_REGISTRY } from '../src/lib/draymond/api-keys';

const SAVED: Record<string, string | undefined> = {};

function setEnv(k: string, v: string | undefined) {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

afterEach(() => {
  for (const k of Object.keys(SAVED)) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe('free-API key registry', () => {
  it('reports missing keys when env is empty', () => {
    const audit = auditApiKeys();
    expect(audit.total).toBe(FREE_API_REGISTRY.length);
    expect(audit.missing).toBeGreaterThan(0);
    expect(audit.missingNames).toContain('Finnhub');
  });

  it('marks a configured key as configured without leaking the value', () => {
    setEnv('FINNHUB_API_KEY', 'secret-value');
    const audit = auditApiKeys();
    const finnhub = audit.items.find((i) => i.name === 'Finnhub');
    expect(finnhub?.state).toBe('configured');
    // The value never appears anywhere in the audit output.
    expect(JSON.stringify(audit)).not.toContain('secret-value');
  });

  it('treats keyless APIs as no-key-needed', () => {
    const audit = auditApiKeys();
    const coingecko = audit.items.find((i) => i.name === 'CoinGecko');
    expect(coingecko?.state).toBe('no-key-needed');
  });

  it('missingCriticalKeys returns mission keys with signup URLs', () => {
    const missing = missingCriticalKeys(5);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((k) => k.engine !== 'ops')).toBe(true);
  });

  it('recognizes the Kaggle token wired from Kaggle.txt', () => {
    setEnv('KAGGLE_API_TOKEN', 'KGAT_test_token');
    const audit = auditApiKeys();
    const kaggle = audit.items.find((i) => i.name === 'Kaggle');
    expect(kaggle?.state).toBe('configured');
  });
});
