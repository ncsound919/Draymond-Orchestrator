import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getSecret,
  getSecretOrEnv,
  syncVaultSecretsToEnv,
  clearSecretCache,
} from '../src/lib/draymond/keywire';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const SAVED: Record<string, string | undefined> = {};
const VAULT_ENV = ['KEYWIRE_URL', 'KEYWIRE_SERVICE_TOKEN', 'KEYWIRE_PROJECT_ID', 'KEYWIRE_ENV_SLUG'];

function setEnv(vars: Record<string, string | undefined>): void {
  for (const k of [...VAULT_ENV, 'GL_PUBLISH_KEY']) {
    if (!(k in SAVED)) SAVED[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
}

beforeEach(() => {
  clearSecretCache();
  fetchMock.mockReset();
});

afterEach(() => {
  clearSecretCache();
  for (const k of Object.keys(SAVED)) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
  delete SAVED['__touched'];
});

const exchangeOk = () =>
  new Response(JSON.stringify({ accessToken: 'jwt-test', expiresIn: 900 }), { status: 200 });
const exportOk = (body: string) => new Response(body, { status: 200 });

describe('keywire vault client', () => {
  it('resolves a vault secret (exchange + export)', async () => {
    setEnv({ KEYWIRE_SERVICE_TOKEN: 'kw_st_live_testtoken0123456789' });
    fetchMock
      .mockResolvedValueOnce(exchangeOk())
      .mockResolvedValueOnce(exportOk('GL_PUBLISH_KEY="vault-secret-abc"\nOTHER="x"\n'));
    const r = await getSecret('GL_PUBLISH_KEY');
    expect(r).toEqual({ found: true, value: 'vault-secret-abc' });
  });

  it('reports keywire_unconfigured without a token', async () => {
    setEnv({ KEYWIRE_SERVICE_TOKEN: undefined });
    const r = await getSecret('GL_PUBLISH_KEY');
    expect(r.found).toBe(false);
    expect(r.reason).toBe('keywire_unconfigured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getSecretOrEnv prefers the vault, falls back to env', async () => {
    setEnv({ KEYWIRE_SERVICE_TOKEN: 'kw_st_live_testtoken0123456789', GL_PUBLISH_KEY: 'env-value' });
    fetchMock
      .mockResolvedValueOnce(exchangeOk())
      .mockResolvedValueOnce(exportOk('GL_PUBLISH_KEY="vault-value"\n'));
    expect(await getSecretOrEnv('GL_PUBLISH_KEY')).toBe('vault-value');

    // Vault unreachable -> env fallback.
    clearSecretCache();
    fetchMock.mockReset().mockRejectedValue(new Error('down'));
    expect(await getSecretOrEnv('GL_PUBLISH_KEY')).toBe('env-value');
  });

  it('syncVaultSecretsToEnv mirrors missing keys into process.env only', async () => {
    setEnv({ KEYWIRE_SERVICE_TOKEN: 'kw_st_live_testtoken0123456789', GL_PUBLISH_KEY: undefined });
    fetchMock
      .mockResolvedValueOnce(exchangeOk())
      .mockResolvedValueOnce(exportOk('GL_PUBLISH_KEY="vault-secret-abc"\n'));
    const r = await syncVaultSecretsToEnv(['GL_PUBLISH_KEY', 'MISSING_KEY']);
    expect(r.synced).toEqual(['GL_PUBLISH_KEY']);
    expect(r.missing).toEqual(['MISSING_KEY']);
    expect(process.env.GL_PUBLISH_KEY).toBe('vault-secret-abc');

    // Second run: already set -> skipped, no fetch.
    fetchMock.mockReset();
    const r2 = await syncVaultSecretsToEnv(['GL_PUBLISH_KEY']);
    expect(r2.skipped).toEqual(['GL_PUBLISH_KEY']);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
