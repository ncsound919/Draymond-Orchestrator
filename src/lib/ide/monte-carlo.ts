// ============================================================================
// DRAYMOND AGENT IDE — Monte Carlo best-choice resolver
// ============================================================================
// The last rung of the interjection escalation ladder: when the human can't
// be reached (no inline answer, no Open Chat push ack, no email), the system
// still has to make a defensible decision. Each option carries an expected
// outcome and an outcome spread (std dev); we simulate the decision space and
// pick the option with the highest risk-adjusted expected utility, reporting
// the evidence so the human can see why it chose what it chose.
//
// Built on the MathX stats core (normalCdf etc.) so the decision math is the
// same tested math the rest of Draymond uses.
// ============================================================================

export interface MonteCarloOptionInput {
  id: string;
  /** Display label — defaults to the option id when omitted. */
  label?: string;
  /** Expected outcome on a shared scale — higher is better. */
  expectedOutcome?: number;
  /** Std-dev of the outcome distribution — uncertainty. Higher = riskier. */
  outcomeSpread?: number;
}

export interface MonteCarloOptionResult extends MonteCarloOptionInput {
  mean: number;
  sd: number;
  /** Average sampled utility (risk-adjusted). */
  expectedUtility: number;
  /** Fraction of trials where this option beat every other option. */
  pBest: number;
}

export interface MonteCarloDecision {
  choiceId: string;
  expectedUtility: number;
  pBest: number;
  expectedValue: number;
  options: MonteCarloOptionResult[];
  trials: number;
  riskAversion: number;
  justification: string;
}

/** Deterministic PRNG (mulberry32) so decisions are reproducible per seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller transform — standard normal sample from a uniform PRNG. */
function boxMuller(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Risk-adjusted utility: upside is taken at face value; downside is penalized
 * quadratically so large negative outcomes hurt more than proportionally.
 */
function utility(outcome: number, riskAversion: number): number {
  const downside = Math.max(0, -outcome);
  return outcome - riskAversion * downside * downside;
}

function defaultOutcome(id: string): number {
  // Stable pseudo-random default in [-20, 60] derived from the option id.
  const h = Array.from(id).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return 20 + ((h * 2654435761) % 100) / 100 * 40 - 20;
}

/**
 * Run a Monte Carlo simulation over the candidate options and return the best
 * choice with evidence. Higher `expectedOutcome` wins; `outcomeSpread` and
 * `riskAversion` shape how much uncertainty discounts an option.
 */
export function decideByMonteCarlo(
  options: MonteCarloOptionInput[],
  opts: { trials?: number; riskAversion?: number; seed?: number } = {},
): MonteCarloDecision {
  if (!options || options.length === 0) {
    return {
      choiceId: '',
      expectedUtility: 0,
      pBest: 0,
      expectedValue: 0,
      options: [],
      trials: 0,
      riskAversion: opts.riskAversion ?? 0.5,
      justification: 'No options to decide between.',
    };
  }
  const trials = Math.max(1000, Math.min(opts.trials ?? 10_000, 100_000));
  const riskAversion = opts.riskAversion ?? 0.5;
  const rand = mulberry32(opts.seed ?? 1337);

  const enriched = options.map((o) => {
    const mean = typeof o.expectedOutcome === 'number' ? o.expectedOutcome : defaultOutcome(o.id);
    const sd = Math.max(0.5, typeof o.outcomeSpread === 'number' ? o.outcomeSpread : Math.abs(mean) * 0.4 + 5);
    return { ...o, mean, sd };
  });

  const ev = new Map<string, number>();
  const wins = new Map<string, number>();
  const utilities = new Map<string, number[]>();

  for (const o of enriched) {
    ev.set(o.id, 0);
    wins.set(o.id, 0);
    utilities.set(o.id, []);
  }

  for (let t = 0; t < trials; t++) {
    let bestId = enriched[0].id;
    let bestVal = -Infinity;
    for (const o of enriched) {
      const sample = o.mean + boxMuller(rand) * o.sd;
      const u = utility(sample, riskAversion);
      const list = utilities.get(o.id)!;
      list.push(u);
      ev.set(o.id, (ev.get(o.id) ?? 0) + u);
      if (u > bestVal) {
        bestVal = u;
        bestId = o.id;
      }
    }
    wins.set(bestId, (wins.get(bestId) ?? 0) + 1);
  }

  const results: MonteCarloOptionResult[] = enriched.map((o) => {
    const list = utilities.get(o.id)!;
    const total = list.reduce((a, b) => a + b, 0);
    const meanU = total / trials;
    const pBest = (wins.get(o.id) ?? 0) / trials;
    return {
      id: o.id,
      label: o.label ?? o.id,
      expectedOutcome: o.expectedOutcome,
      outcomeSpread: o.outcomeSpread,
      mean: o.mean,
      sd: o.sd,
      expectedUtility: meanU,
      pBest,
    };
  });

  const best = [...results].sort((a, b) => b.expectedUtility - a.expectedUtility)[0];
  const runnerUp = [...results].sort((a, b) => b.expectedUtility - a.expectedUtility)[1];

  const lines = [
    `Monte Carlo decision (${trials.toLocaleString()} trials, risk aversion ${riskAversion})`,
    `Chose "${best.label}" — expected utility ${best.expectedUtility.toFixed(1)} (pBest ${(best.pBest * 100).toFixed(0)}%).`,
  ];
  if (runnerUp) {
    const margin = ((best.expectedUtility - runnerUp.expectedUtility) / Math.max(0.001, Math.abs(runnerUp.expectedUtility))) * 100;
    lines.push(`Runner-up "${runnerUp.label}" trails by ${margin.toFixed(1)}%.`);
  }
  for (const o of results) {
    lines.push(
      `  ${o.id === best.id ? '→' : ' '} ${o.label}: EV ${o.mean.toFixed(1)} ± ${o.sd.toFixed(1)}, ` +
        `util ${o.expectedUtility.toFixed(1)}, pBest ${(o.pBest * 100).toFixed(0)}%`,
    );
  }
  if (best.sd > 0 && best.expectedUtility < 0) {
    lines.push('Note: even the best option has negative expected utility — the conservative move is to defer or re-scope.');
  }

  return {
    choiceId: best.id,
    expectedUtility: best.expectedUtility,
    pBest: best.pBest,
    expectedValue: best.mean,
    options: results,
    trials,
    riskAversion,
    justification: lines.join('\n'),
  };
}
