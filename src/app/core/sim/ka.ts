/**
 * ka — the food coupling. The ONLY channel through which food enters the
 * model, and it's load-bearing: fed vs fasted changes peak height ~30%
 * from identical drinks.
 *
 * ka is never set directly; it is derived from the most recent food event
 * and relaxes back toward the fasted baseline as the stomach empties.
 */
import { Millis } from '../domain/types';
import { KA_BY_FULLNESS, KA_FASTED, KA_RELAX_TAU_H, MS_PER_HOUR } from './constants';
import { FoodEvent } from './types';

export function kaFromLastFood(nowMs: Millis, lastFood: FoodEvent | null): number {
  if (!lastFood || lastFood.atMs > nowMs) return KA_FASTED;
  const dtH = (nowMs - lastFood.atMs) / MS_PER_HOUR;
  const kaFood = KA_BY_FULLNESS[lastFood.fullness];
  return KA_FASTED - (KA_FASTED - kaFood) * Math.exp(-dtH / KA_RELAX_TAU_H);
}

/** Most recent food at or before nowMs, or null. Input need not be sorted. */
export function lastFoodBefore(nowMs: Millis, foods: readonly FoodEvent[]): FoodEvent | null {
  let best: FoodEvent | null = null;
  for (const f of foods) {
    if (f.atMs <= nowMs && (best === null || f.atMs > best.atMs)) best = f;
  }
  return best;
}

export function kaAt(nowMs: Millis, foods: readonly FoodEvent[]): number {
  return kaFromLastFood(nowMs, lastFoodBefore(nowMs, foods));
}
