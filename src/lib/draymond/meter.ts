// ============================================================================
// MIDDLEMAN METER — emit metered usage events to the Tap919 Middleman gateway.
// ============================================================================
// Fail-soft: metering NEVER blocks or throws. If the middleman is down or
// unconfigured, we log once and continue. This is the billing rail — it should
// never take down the fleet that's generating the revenue.
//
// The middleman converts these UsageEvents into Stripe meters (per-model,
// per-metric), which is what makes the Agent-Ops "cost-governance" story
// monetizable.
// ============================================================================

const MIDDLEMAN_URL = () => process.env.MIDDLEMAN_URL ?? '';
const MIDDLEMAN_DEFAULT_TENANT = 'draymond-fleet';

let _warned = false;

interface UsageEvent {
  model: string;
  units: number;
  unit_type: 'per_1k_tokens' | 'per_task' | 'per_call';
  provider: string;
  tenant_id?: string;
  meta?: Record<string, unknown>;
}

/**
 * Emit a metered usage event to the middleman. Never throws.
 * Skips silently when MIDDLEMAN_URL is unset (dashboard runs the budget engine
 * as-is; the billing rail is additive).
 */
export async function meterUsage(event: UsageEvent): Promise<void> {
  const url = MIDDLEMAN_URL();
  if (!url) return;

  try {
    const res = await fetch(`${url}/internal/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': event.tenant_id ?? MIDDLEMAN_DEFAULT_TENANT,
      },
      body: JSON.stringify({
        model: event.model,
        input: 'metered-usage',
        params: {
          metered: true,
          metered_units: event.units,
          unit_type: event.unit_type,
          provider: event.provider,
          meta: event.meta ?? {},
        },
      }),
      signal: AbortSignal.timeout(1500),
    });

    if (!res.ok) {
      console.warn(`[meter] middleman returned ${res.status} for ${event.model}`);
    }
  } catch (err) {
    if (!_warned) {
      console.warn(`[meter] middleman unreachable (${MIDDLEMAN_URL()}) — metering paused: ${err instanceof Error ? err.message : String(err)}`);
      _warned = true;
    }
  }
}

/**
 * Map an LLM call into a middleman UsageEvent and emit it.
 * Convenience wrapper used by the budget engine's consumeTokens hook.
 */
export async function meterProviderCall(provider: string, tokens: number): Promise<void> {
  const model = providerToModelId(provider);
  const units = tokens / 1000;
  await meterUsage({
    model,
    units,
    unit_type: 'per_1k_tokens',
    provider,
    meta: { source: 'draymond-budget-engine', tokens },
  });
}

/** Provider slug -> middleman abstract model id (the `provider:` prefix pattern). */
function providerToModelId(provider: string): string {
  const slug = provider.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return `draymond:${slug}`;
}