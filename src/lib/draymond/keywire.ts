// ============================================================================
// DRAYMOND Keywire vault client (server-side)
// ============================================================================
// Keywire-first credential resolution (see ECOSYSTEM_INTEGRATIONS.md): secrets
// live in the Keywire vault (project prj-mt7jrul1 / env production) and are
// resolved here at runtime — never hardcoded in .env files.
//
// Pattern mirrors agents/AgentBrowser-main/src/lib/keywire.ts: exchange the
// raw `kw_st_live_*` service token for a short-lived JWT, fetch the decrypted
// secret map once per TTL from the export endpoint, resolve keys (memory-only,
// short TTL cache, never logged).
//
// Degrades gracefully (found:false + reason) — callers record an honest
// "not configured" instead of guessing.
// ============================================================================

const TTL_MS = 60_000;
const cache = new Map<string, { value: string; at: number }>();
let mapCache: { map: Record<string, string>; at: number } | null = null;

export interface SecretResult {
  found: boolean;
  value?: string;
  reason?: string;
}

function vaultUrl(): string {
  return process.env.KEYWIRE_URL || 'http://localhost:3000';
}

function projectEnv(): { project: string; env: string } {
  return {
    project: process.env.KEYWIRE_PROJECT_ID || 'prj-mt7jrul1',
    env: process.env.KEYWIRE_ENV_SLUG || 'production',
  };
}

// Raw `kw_st_live_*` service tokens are NOT JWTs: they must be exchanged for a
// short-lived JWT via /api/v1/auth/service-token/exchange before they can be
// sent as a Bearer. Cache the JWT until shortly before it expires.
let jwtCache: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  const raw = process.env.KEYWIRE_SERVICE_TOKEN;
  if (!raw) return null;
  if (jwtCache && Date.now() < jwtCache.exp) return jwtCache.token;
  try {
    const res = await fetch(`${vaultUrl()}/api/v1/auth/service-token/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: raw }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken?: string; expiresIn?: number };
    if (!data?.accessToken) return null;
    const ttlMs = (Number(data.expiresIn) || 900) * 1000;
    jwtCache = { token: data.accessToken, exp: Date.now() + Math.max(ttlMs - 60_000, 30_000) };
    return jwtCache.token;
  } catch {
    return null;
  }
}

// Fetch the decrypted secret map once per TTL from the export endpoint.
async function getSecretMap(): Promise<Record<string, string> | null> {
  if (!process.env.KEYWIRE_SERVICE_TOKEN) return null;

  if (mapCache && Date.now() - mapCache.at < TTL_MS) return mapCache.map;
  const { project, env } = projectEnv();
  const accessToken = await getAccessToken();
  if (!accessToken) return null;
  try {
    const res = await fetch(
      `${vaultUrl()}/api/v1/projects/${project}/envs/${env}/export?format=env`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const text = await res.text();
    const map: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
      if (m) map[m[1]] = m[2];
    }
    mapCache = { map, at: Date.now() };
    return map;
  } catch {
    return null;
  }
}

export async function getSecret(key: string): Promise<SecretResult> {
  const token = process.env.KEYWIRE_SERVICE_TOKEN;
  if (!token) return { found: false, reason: 'keywire_unconfigured' };

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return { found: true, value: cached.value };
  }

  const map = await getSecretMap();
  if (!map) {
    return { found: false, reason: 'keywire_unreachable' };
  }

  const value = map[key];
  if (value != null && value.length > 0) {
    cache.set(key, { value, at: Date.now() });
    return { found: true, value };
  }
  return { found: false, reason: 'not_found' };
}

// Vault-first credential resolution with a plaintext-env fallback. Prefer this
// over reading a credential directly from process.env: once the secret lives in
// the vault it is used, and nothing breaks (env fallback) until provisioning is
// complete. Returns '' when neither source has it.
export async function getSecretOrEnv(key: string): Promise<string> {
  const r = await getSecret(key);
  if (r.found && r.value) return r.value;
  return process.env[key] || '';
}

/** Clear all caches (tests + credential rotation). */
export function clearSecretCache(): void {
  cache.clear();
  mapCache = null;
  jwtCache = null;
}

// -- Startup secret sync ------------------------------------------------------
// Chain header interpolation (${VAR} in entity configs) reads process.env at
// CALL time, so vault-only secrets must be mirrored into the environment once
// at boot. Memory-only: nothing is ever written to disk. Env values already
// set are never overwritten (explicit config wins over the vault).
export const STARTUP_VAULT_KEYS = ['GL_PUBLISH_KEY'] as const;

export async function syncVaultSecretsToEnv(
  keys: readonly string[] = STARTUP_VAULT_KEYS
): Promise<{ synced: string[]; missing: string[]; skipped: string[] }> {
  const synced: string[] = [];
  const missing: string[] = [];
  const skipped: string[] = [];
  for (const key of keys) {
    if (process.env[key]) {
      skipped.push(key);
      continue;
    }
    try {
      const value = await getSecretOrEnv(key);
      if (value) {
        process.env[key] = value;
        synced.push(key);
      } else {
        missing.push(key);
      }
    } catch {
      missing.push(key);
    }
  }
  return { synced, missing, skipped };
}
