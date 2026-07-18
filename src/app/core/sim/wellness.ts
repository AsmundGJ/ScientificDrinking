/**
 * Hydration & nutrition — the two curves that run under the BAC plot.
 * Deliberately coarse models: they exist to make "you haven't drunk water
 * in four hours" and "you skipped dinner" visible at a glance, not to be
 * precise. Pure TypeScript, same rules as the rest of core/sim.
 *
 * Hydration: a running water deficit (ml) that DRIFTS toward a "festival-
 * dry" level while no water is logged — a few hours without water shows a
 * clear, motivating sag, but it never flatlines to zero the way a naive
 * constant-loss model does. Ethanol adds diuresis on top; logged/planned
 * water pulls it back up — rate-limited, because beyond ~750 ml/h it's
 * expensive urine. Score = 1 − deficit/2000, clamped 0..1.
 *
 * Nutrition: a satiety level 0..1 set by eating (snack/meal/big) and
 * decaying exponentially (~3.5 h). It is display-only; ka remains the ONLY
 * channel through which food affects the BAC model.
 */
import { AppState, Fullness, Millis } from '../domain/types';
import { GENSTAND_GRAMS, MS_PER_HOUR, MS_PER_MINUTE } from './constants';
import { gramsForLoggedDrink } from './drinks';

export interface WellnessPoint {
  atMs: Millis;
  hydration: number; // 0..1, 1 = fully hydrated
  nutrition: number; // 0..1, 1 = just had a big meal
}

export interface WellnessState {
  deficitMl: number;
  gutWaterMl: number;
  nutrition: number;
}

/** Waking up neutral-ish: mildly under-hydrated, breakfast wearing off. */
export const WELLNESS_NEUTRAL: WellnessState = { deficitMl: 400, gutWaterMl: 0, nutrition: 0.6 };

/** Eating and hydrating are separate: food never carries hidden water. */
export interface WellnessEvents {
  drinks: { atMs: Millis; grams: number }[];
  waters: { atMs: Millis; ml: number }[];
  foods: { atMs: Millis; fullness: Fullness }[];
}

/** Deficit the curve drifts toward while no water is logged (score ≈ 0.45). */
const DRY_DRIFT_DEFICIT_ML = 1100;
/** Drift speed: ~4 h without water ≈ halfway to dry. */
const DRIFT_TAU_H = 5;
const DIURESIS_ML_PER_GRAM = 10;
const MAX_ABSORB_ML_PER_H = 750;
const DEFICIT_SCALE_ML = 2000;
const NUTRITION_TAU_H = 3.5;
const NUTRITION_BY_FULLNESS: Record<Fullness, number> = { snack: 0.5, meal: 0.8, big: 1 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function hydrationScore(s: WellnessState): number {
  return clamp01(1 - s.deficitMl / DEFICIT_SCALE_ML);
}

export function wellnessSeries(
  initial: WellnessState,
  ev: WellnessEvents,
  fromMs: Millis,
  toMs: Millis,
  dtMinutes = 5,
): { points: WellnessPoint[]; end: WellnessState } {
  const stepMs = dtMinutes * MS_PER_MINUTE;
  const dtH = dtMinutes / 60;
  const all = [
    ...ev.drinks.map((e) => ({ atMs: e.atMs, apply: (s: WellnessState) => ({ ...s, deficitMl: s.deficitMl + e.grams * DIURESIS_ML_PER_GRAM }) })),
    ...ev.waters.map((e) => ({ atMs: e.atMs, apply: (s: WellnessState) => ({ ...s, gutWaterMl: s.gutWaterMl + e.ml }) })),
    ...ev.foods.map((e) => ({
      atMs: e.atMs,
      apply: (s: WellnessState) => ({
        ...s,
        nutrition: Math.max(s.nutrition, NUTRITION_BY_FULLNESS[e.fullness]),
      }),
    })),
  ].sort((a, b) => a.atMs - b.atMs);

  let s: WellnessState = { ...initial };
  let ei = 0;
  const points: WellnessPoint[] = [];
  let t = fromMs;
  for (;;) {
    while (ei < all.length && all[ei]!.atMs <= t) {
      s = all[ei]!.apply(s);
      ei++;
    }
    points.push({ atMs: t, hydration: hydrationScore(s), nutrition: clamp01(s.nutrition) });
    if (t >= toMs) break;
    const dtMsEff = Math.min(stepMs, toMs - t);
    const h = dtMsEff / MS_PER_HOUR;
    const absorbed = Math.min(s.gutWaterMl, MAX_ABSORB_ML_PER_H * h);
    // Logged water works first; then thirst drifts the rest toward "dry".
    let deficit = Math.max(0, s.deficitMl - absorbed);
    deficit += (DRY_DRIFT_DEFICIT_ML - deficit) * (1 - Math.exp(-h / DRIFT_TAU_H));
    s = {
      gutWaterMl: s.gutWaterMl - absorbed,
      deficitMl: Math.max(0, deficit),
      nutrition: s.nutrition * Math.exp(-h / NUTRITION_TAU_H),
    };
    t += dtMsEff;
  }
  return { points, end: s };
}

/**
 * The page-level assembly: solid truth from the log up to now, dashed
 * forecast from planned hydrations/meals + planned drinks after now.
 */
export function wellnessProjection(
  app: AppState,
  nowMs: Millis,
  toMs: Millis,
  futureDrinkTimes: readonly Millis[] = [],
  drinkGrams: number = GENSTAND_GRAMS,
): { past: WellnessPoint[]; future: WellnessPoint[] } {
  const fromMs = nowMs - 24 * MS_PER_HOUR;
  const past: WellnessEvents = { drinks: [], waters: [], foods: [] };
  for (const e of app.log) {
    if (!('atMs' in e) || e.atMs < fromMs || e.atMs > nowMs) continue;
    if (e.kind === 'drink') past.drinks.push({ atMs: e.atMs, grams: gramsForLoggedDrink(e, app.presets) });
    // Electrolytes improve retention — count that water ~20% more effective.
    else if (e.kind === 'water') past.waters.push({ atMs: e.atMs, ml: e.ml * (e.electrolytes ? 1.2 : 1) });
    else if (e.kind === 'food') past.foods.push({ atMs: e.atMs, fullness: e.fullness });
  }
  const pastRes = wellnessSeries(WELLNESS_NEUTRAL, past, fromMs, nowMs);

  const future: WellnessEvents = {
    drinks: futureDrinkTimes.filter((t) => t > nowMs).map((atMs) => ({ atMs, grams: drinkGrams })),
    waters: [],
    foods: [],
  };
  for (const day of app.plan) {
    for (const hy of day.hydrations) {
      // Same electrolyte bonus as logged water: ~20% better retention.
      if (hy.atMs > nowMs) future.waters.push({ atMs: hy.atMs, ml: hy.ml * (hy.electrolytes ? 1.2 : 1) });
    }
    for (const m of day.meals) {
      if (m.atMs <= nowMs) continue;
      const tpl = app.mealTemplates.find((t) => t.id === m.templateId);
      if (tpl) future.foods.push({ atMs: m.atMs, fullness: tpl.fullness });
    }
  }
  const end = Math.max(toMs, nowMs);
  const futureRes = wellnessSeries(pastRes.end, future, nowMs, end);
  return { past: pastRes.points, future: futureRes.points };
}
