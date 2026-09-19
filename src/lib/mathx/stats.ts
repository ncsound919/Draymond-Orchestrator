// ============================================================================
// DRAYMOND MATHX — statistics core (pure TS, dependency-free)
// ============================================================================
// The single source of truth for the orchestrator's and brain's math. Runs
// identically in the Node cron runtime and (through the /math lab) the browser.
// Every formula is tested in tests/mathx/stats.test.ts against hand-computed
// values so "mathematically astute" is a testable property, not a claim.
//
// Implementations:
//   percentile          — linear-interpolated sample quantile (R type 7)
//   betaPosterior       — Bayesian posterior for a Bernoulli rate with a
//                         Beta(priorA, priorB) conjugate prior; mean, sd and a
//                         credible interval via the inverse regularized
//                         incomplete beta (Numerical Recipes betacf + bisection)
//   shrinkage           — James–Stein-style estimator toward a prior strength
//   ewma                — exponentially weighted moving average (trend series)
//   cusum               — two-sided CUSUM statistical process control alarms
//   normalCdf           — Abramowitz & Stegun 7.1.26 approximation
//   sigmoid             — logistic map with overflow clamp
// ============================================================================

// -- Lgamma (Lanczos approximation, Numerical Recipes) -----------------------

function lgamma(x: number): number {
  const cof = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// -- Continued fraction for the incomplete beta (Numerical Recipes betacf) --

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (a <= 0 || b <= 0) throw new RangeError('a and b must be > 0');
  const bt = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Inverse regularized incomplete beta — deterministic bisection (max 1e-12). */
export function inverseRegularizedIncompleteBeta(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  if (a <= 0 || b <= 0) throw new RangeError('a and b must be > 0');
  let lo = 0;
  let hi = 1;
  let x = 0.5;
  for (let i = 0; i < 100; i++) {
    const v = regularizedIncompleteBeta(x, a, b);
    if (Math.abs(v - p) < 1e-12) break;
    if (v < p) lo = x;
    else hi = x;
    x = (lo + hi) / 2;
  }
  return x;
}

// -- Public stats API --------------------------------------------------------

/**
 * Linear-interpolated sample percentile (R type 7, the default in most stats
 * packages). Returns 0 for an empty array.
 *
 *   percentile([1,2,3,4], 0.5) ≈ 2.5
 *   percentile([1,2,3,4], 0.0) === 1
 *   percentile([1,2,3,4], 1.0) === 4
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const clamped = Math.max(0, Math.min(1, p));
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * clamped;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  const frac = h - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

export interface BetaPosterior {
  successes: number;
  failures: number;
  alpha: number;
  beta: number;
  mean: number;
  sd: number;
  ciLow: number;
  ciHigh: number;
  /** Credible-interval width — wider = more uncertain. */
  width: number;
}

/**
 * Bayesian posterior for a Bernoulli success rate under a Beta(priorA, priorB)
 * conjugate prior. With n successes / m failures the posterior is
 * Beta(n + priorA, m + priorB); the mean, standard deviation, and a
 * (1 - alphaLevel) equal-tailed credible interval follow analytically.
 *
 * Hand-computed check: betaPosterior(9, 1, 1, 1) → Beta(10, 2),
 * mean = 10/12 ≈ 0.83333, sd = sqrt(10·2 / (12²·13)) ≈ 0.10335.
 */
export function betaPosterior(
  successes: number,
  failures: number,
  priorA = 1,
  priorB = 1,
  alphaLevel = 0.05,
): BetaPosterior {
  const alpha = Math.max(0, successes) + Math.max(0, priorA);
  const beta = Math.max(0, failures) + Math.max(0, priorB);
  const total = alpha + beta;
  const mean = alpha / total;
  const sd = Math.sqrt((alpha * beta) / (total * total * (total + 1)));
  const ciLow = inverseRegularizedIncompleteBeta(alphaLevel / 2, alpha, beta);
  const ciHigh = inverseRegularizedIncompleteBeta(1 - alphaLevel / 2, alpha, beta);
  return {
    successes,
    failures,
    alpha,
    beta,
    mean,
    sd,
    ciLow,
    ciHigh,
    width: ciHigh - ciLow,
  };
}

/**
 * Shrink an observed rate toward a prior mean with a given strength (pseudo
 * count). Small samples are pulled hard toward the prior; large samples keep
 * the observed rate. This is the fix for "2-for-2 == 200-for-200" scoring.
 *
 *   shrinkage(1, 2, 0.75, 5) = (5·0.75 + 2·1) / (5 + 2) = 5.75/7 ≈ 0.8214
 */
export function shrinkage(
  rate: number,
  n: number,
  priorMean = 0.75,
  priorStrength = 5,
): number {
  const strength = Math.max(0, priorStrength);
  const count = Math.max(0, n);
  if (strength + count === 0) return rate;
  return (strength * priorMean + count * rate) / (strength + count);
}

export interface EwmaResult {
  series: number[];
  last: number | null;
  /** Halflife in samples (how far back ~50% of the weight reaches). */
  halflife: number;
}

/**
 * Exponentially weighted moving average. Standard form with the smoothing
 * applied to the raw series: s_1 = x_1, s_t = λ·x_t + (1-λ)·s_{t-1}.
 * `lambda` ∈ (0, 1]; higher = more weight on recent points.
 */
export function ewma(values: number[], lambda = 0.3): EwmaResult {
  const l = Math.max(Number.EPSILON, Math.min(1, lambda));
  const series: number[] = [];
  if (values.length === 0) return { series, last: null, halflife: halflifeOf(l) };
  let s = values[0];
  series.push(s);
  for (let i = 1; i < values.length; i++) {
    s = l * values[i] + (1 - l) * s;
    series.push(s);
  }
  return { series, last: s, halflife: halflifeOf(l) };
}

function halflifeOf(lambda: number): number {
  if (lambda <= 0) return Infinity;
  return Math.log(0.5) / Math.log(1 - lambda);
}

export interface CusumAlarm {
  index: number;
  direction: 'high' | 'low';
  /** Cumulative deviation at the alarm point (standardized units × sigma). */
  magnitude: number;
}

export interface CusumResult {
  alarms: CusumAlarm[];
  lastHigh: number;
  lastLow: number;
  direction: 'high' | 'low' | null;
}

/**
 * Two-sided CUSUM (Page, 1954) for sustained process drift.
 *
 *   S+_t = max(0, S+_{t-1} + (x_t - target) / sigma - k)
 *   S-_t = max(0, S-_t-1 + (target - x_t) / sigma - k)
 *
 * An alarm fires when S+ exceeds `h` (upward drift) or S- exceeds `h` (downward
 * drift). k is the slack (usually 0.5), h the decision interval (usually 4-5).
 * Unlike "failed its last run", CUSUM ignores single-point noise and flags
 * *sustained* degradation.
 */
export function cusum(
  values: number[],
  opts: { target: number; sigma?: number; k?: number; h?: number },
): CusumResult {
  const sigma = opts.sigma && opts.sigma > 0 ? opts.sigma : 1;
  const k = opts.k ?? 0.5;
  const h = opts.h ?? 5;
  const alarms: CusumAlarm[] = [];
  let sPlus = 0;
  let sMinus = 0;
  for (let i = 0; i < values.length; i++) {
    const z = (values[i] - opts.target) / sigma;
    sPlus = Math.max(0, sPlus + z - k);
    sMinus = Math.max(0, sMinus - z - k);
    if (sPlus > h) {
      alarms.push({ index: i, direction: 'high', magnitude: sPlus });
      sPlus = 0;
    }
    if (sMinus > h) {
      alarms.push({ index: i, direction: 'low', magnitude: sMinus });
      sMinus = 0;
    }
  }
  const direction = sPlus > sMinus ? 'high' : sMinus > sPlus ? 'low' : null;
  return { alarms, lastHigh: sPlus, lastLow: sMinus, direction };
}

/**
 * Standard normal CDF via Abramowitz & Stegun 7.1.26 (max error 7.5e-8).
 *
 *   normalCdf(0)   ≈ 0.5
 *   normalCdf(1.96) ≈ 0.975
 */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erfc =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - erfc * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/** Logistic map with an overflow clamp. sigmoid(0) = 0.5, monotone in x. */
export function sigmoid(x: number): number {
  if (x >= 0) {
    const e = Math.exp(-x);
    return 1 / (1 + e);
  }
  const e = Math.exp(x);
  return e / (1 + e);
}
