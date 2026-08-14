// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Shared SSRF Guard Helpers
// ============================================================================
// Single source of truth for "is this host safe to call" across every fleet
// guard (invoker.ts, hooks.ts, reactive.ts). Three signals:
//
//   1. Development mode (NODE_ENV !== 'production') — the fleet runs locally,
//      so private/local hosts are allowed.
//   2. ALLOW_LOCAL_AGENTS=1|true — explicit opt-in to allow localhost and
//      private hosts in ANY environment (set in the PM2 ecosystem config so
//      the production runtime sees it).
//   3. LOCAL_SERVICE_ALLOWLIST — comma-separated exact hostnames that are
//      trusted fleet services, honored even in production. An explicit
//      allowlist beats a blanket allow: only the listed hosts pass.
//
// All three guards read this module so behaviour stays consistent.
// ============================================================================

/**
 * True when the fleet is allowed to call local/private hosts unconditionally
 * (development mode or explicit ALLOW_LOCAL_AGENTS opt-in).
 */
export function localAgentsAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const flag = process.env.ALLOW_LOCAL_AGENTS;
  return flag === '1' || flag === 'true';
}

/**
 * Read LOCAL_SERVICE_ALLOWLIST as a set of lowercase exact hostnames.
 * Example: "localhost,127.0.0.1,services.internal"
 */
export function localServiceAllowlist(): Set<string> {
  const raw = process.env.LOCAL_SERVICE_ALLOWLIST ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * True when a hostname may be called without tripping the SSRF guard.
 * Development mode and ALLOW_LOCAL_AGENTS are blanket allowances; the
 * allowlist is the explicit, production-safe path.
 */
export function hostIsLocalServiceAllowed(hostname: string): boolean {
  if (localAgentsAllowed()) return true;
  return localServiceAllowlist().has(hostname.toLowerCase());
}
