/**
 * Two-compartment forward simulation.
 *
 * NOT naive Widmark (instant absorption, straight line down) — that model
 * hides the pipeline, which is exactly the thing that matters for pacing.
 * Here the gut empties by first-order kinetics (rate ka, food-dependent)
 * into blood that eliminates at a fixed zero-order rate (beta).
 */
import { Millis, Profile } from '../domain/types';
import { DT_H, MS_PER_HOUR } from './constants';
import { kaAt } from './ka';
import { CurvePoint, DrinkEvent, FoodEvent, SimState } from './types';

/** One integration step of dtH hours at absorption rate ka. */
export function step(s: SimState, dtH: number, p: Profile, ka: number): SimState {
  const absorbed = s.gutGrams * (1 - Math.exp(-ka * dtH));
  const gutGrams = s.gutGrams - absorbed;
  const rise = absorbed / (p.r * p.weightKg); // ‰ gained
  const bac = Math.max(0, s.bac + rise - p.beta * dtH); // ‰ lost, floored at 0
  return { gutGrams, bac };
}

export interface SimOptions {
  dtH?: number;
  /** Skip point collection for hot paths (planner probes). */
  collectPoints?: boolean;
}

export interface SimResult {
  points: CurvePoint[];
  end: SimState;
  peakPermille: number;
  peakAtMs: Millis;
}

/**
 * Simulate [fromMs, toMs]. Drinks with atMs inside the range are dropped
 * into the gut at their timestamps; drinks before fromMs must already be
 * folded into `initial` by the caller. Foods may include earlier events —
 * they still shape ka.
 */
export function simulate(
  initial: SimState,
  fromMs: Millis,
  toMs: Millis,
  p: Profile,
  drinks: readonly DrinkEvent[] = [],
  foods: readonly FoodEvent[] = [],
  opts: SimOptions = {},
): SimResult {
  const dtH = opts.dtH ?? DT_H;
  const collect = opts.collectPoints ?? true;
  const stepMs = Math.max(1, Math.round(dtH * MS_PER_HOUR));

  const ds = drinks
    .filter((d) => d.atMs >= fromMs && d.atMs <= toMs)
    .sort((a, b) => a.atMs - b.atMs);

  let s: SimState = { ...initial };
  let di = 0;
  const points: CurvePoint[] = [];
  let peak = -Infinity;
  let peakAt = fromMs;

  let t = fromMs;
  for (;;) {
    // Ingest every drink due by t (a drink between grid points lands on the
    // next boundary — ≤1 min late, i.e. never under-predicts near-term BAC).
    while (di < ds.length && ds[di]!.atMs <= t) {
      s = { gutGrams: s.gutGrams + ds[di]!.grams, bac: s.bac };
      di++;
    }
    if (collect) points.push({ atMs: t, bac: s.bac, gutGrams: s.gutGrams });
    if (s.bac > peak) {
      peak = s.bac;
      peakAt = t;
    }
    if (t >= toMs) break;
    const dtMsEff = Math.min(stepMs, toMs - t);
    s = step(s, dtMsEff / MS_PER_HOUR, p, kaAt(t, foods));
    t += dtMsEff;
  }

  return { points, end: s, peakPermille: peak, peakAtMs: peakAt };
}

/** Instantaneous dBAC/dt (‰/h) — absorption inflow minus elimination. */
export function bacRatePerHour(s: SimState, p: Profile, ka: number): number {
  return (s.gutGrams * ka) / (p.r * p.weightKg) - (s.bac > 0 ? p.beta : 0);
}
