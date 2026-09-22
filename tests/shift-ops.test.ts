import { describe, it, expect } from 'vitest';
import {
  OPS_SECTOR_CONTRACT,
  OPS_SECTOR_KILL_SWITCHES,
  OPS_REPAIR_CHAIN,
  FINANCE_WIRING,
  NIGHT_RESEARCH_WINDOW,
  idempotencyKey,
} from '../src/lib/draymond/shift-ops';

describe('OPS_SECTOR_CONTRACT (Axiom/OpenHub operating sector)', () => {
  it('pins Axiom on :3198 and OpenHub on :3010', () => {
    const axiom = OPS_SECTOR_CONTRACT.services.find((s) => s.slug === 'axiom');
    const openhub = OPS_SECTOR_CONTRACT.services.find((s) => s.slug === 'openhub');
    expect(axiom?.port).toBe(3198);
    expect(openhub?.port).toBe(3010);
  });

  it('leaves the openhub pm2 entry to Agent A (not owned by Agent D)', () => {
    const openhub = OPS_SECTOR_CONTRACT.services.find((s) => s.slug === 'openhub');
    expect(openhub?.managedBy).toMatch(/Agent A/i);
  });

  it('keeps every kill-switch at "0"', () => {
    expect(OPS_SECTOR_KILL_SWITCHES.length).toBe(4);
    for (const sw of OPS_SECTOR_KILL_SWITCHES) {
      expect(sw.value).toBe('0');
    }
    expect(OPS_SECTOR_KILL_SWITCHES.map((s) => s.env)).toEqual(
      expect.arrayContaining([
        'DRAYMOND_AUTOSTART_SERVICES',
        'DRAYMOND_SECTOR_LIFECYCLE',
        'DRAYMOND_FAILOVER_MATRIX',
        'DRAYMOND_REPAIR_BENCHMARK_ENABLED',
      ])
    );
  });

  it('describes the repair trigger chain in locked order', () => {
    const stages = OPS_REPAIR_CHAIN.map((s) => s.stage);
    expect(stages).toEqual([
      'job failure',
      'classify',
      'cooldown',
      'Axiom project loop',
      'codegen',
      'S9 verify gate',
    ]);
    expect(OPS_SECTOR_CONTRACT.repairChain).toBe(OPS_REPAIR_CHAIN);
  });
});

describe('FINANCE_WIRING (money path → ERPNext adapter :4100)', () => {
  it('targets the ERPNext adapter on :4100, not the stale :4000', () => {
    expect(FINANCE_WIRING.adapter.port).toBe(4100);
    expect(FINANCE_WIRING.adapter.url).toBe('http://127.0.0.1:4100');
    expect(FINANCE_WIRING.adapter.ingestPath).toBe('/api/v1/ledger/ingest');
    expect(FINANCE_WIRING.adapter.method).toBe('POST');
    const stale = FINANCE_WIRING.staleServices.find((s) => s.port === 4000);
    expect(stale).toBeTruthy();
  });

  it('documents the adapter payload contract', () => {
    expect(FINANCE_WIRING.adapter.payload).toEqual([
      'kind',
      'id',
      'amount_cents',
      'occurred_at?',
      'memo?',
    ]);
  });

  it('posts idempotently on `${kind}:${id}`', () => {
    expect(idempotencyKey('charge.settled', 'ch_1')).toBe('charge.settled:ch_1');
    expect(FINANCE_WIRING.adapter.idempotencyKeyRule).toBe('${kind}:${id}');
  });

  it('is fail-soft and settled-revenue-only', () => {
    expect(FINANCE_WIRING.adapter.failSoft).toBe(true);
    expect(FINANCE_WIRING.settledOnly).toBe(true);
  });

  it('describes the full money flow end to end', () => {
    expect(FINANCE_WIRING.flow).toEqual([
      'checkout (customer pays)',
      'Stripe webhook (app/api/business/stripe-webhook)',
      'treasury-state.ts ledger (settled revenue; same store as the treasury_pulse pull)',
      'business-pipeline stages (lead → … → paid)',
      'paid',
    ]);
  });
});

describe('NIGHT_RESEARCH_WINDOW (marketing alignment)', () => {
  it('is 22:00–06:00', () => {
    expect(NIGHT_RESEARCH_WINDOW.start).toBe('22:00');
    expect(NIGHT_RESEARCH_WINDOW.end).toBe('06:00');
  });
});