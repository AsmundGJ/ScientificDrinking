import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR } from './constants';
import { WELLNESS_NEUTRAL, wellnessSeries } from './wellness';

const H = MS_PER_HOUR;

describe('wellness (hydration + nutrition display curves)', () => {
  it('a few hours without water gives a clear, motivating dip', () => {
    const r = wellnessSeries(WELLNESS_NEUTRAL, { drinks: [], waters: [], foods: [] }, 0, 24 * H);
    const at = (t: number) => r.points.find((p) => p.atMs === t)!;
    expect(at(4 * H).hydration).toBeLessThan(0.67); // visible within the afternoon
    // …but it never flatlines to zero (that's the earlier bug, kept fixed)
    for (const p of r.points) expect(p.hydration).toBeGreaterThan(0.35);
  });

  it('drinking pushes hydration down, visibly', () => {
    const drinking = wellnessSeries(
      WELLNESS_NEUTRAL,
      { drinks: [0, 1, 2, 3, 4, 5].map((h) => ({ atMs: h * H, grams: 18 })), waters: [], foods: [] },
      0,
      8 * H,
    );
    const min = Math.min(...drinking.points.map((p) => p.hydration));
    expect(min).toBeLessThan(0.6);
  });

  it('logged water restores hydration, visibly', () => {
    const drinks = [0, 1, 2, 3].map((h) => ({ atMs: h * H, grams: 18 }));
    const dry = wellnessSeries(WELLNESS_NEUTRAL, { drinks, waters: [], foods: [] }, 0, 6 * H);
    const watered = wellnessSeries(
      WELLNESS_NEUTRAL,
      { drinks, waters: [{ atMs: 4 * H, ml: 700 }], foods: [] },
      0,
      6 * H,
    );
    const at = (r: typeof dry, t: number) => r.points.find((p) => p.atMs === t)!;
    expect(at(watered, 5 * H).hydration).toBeGreaterThan(at(dry, 5 * H).hydration + 0.15);
  });

  it('nutrition decays and a meal restores it', () => {
    const r = wellnessSeries(
      WELLNESS_NEUTRAL,
      { drinks: [], waters: [], foods: [{ atMs: 5 * H, fullness: 'big' }] },
      0,
      6 * H,
    );
    const preMeal = r.points.find((p) => p.atMs === 5 * H - H)!;
    const postMeal = r.points.find((p) => p.atMs === 5 * H + H / 2)!;
    expect(preMeal.nutrition).toBeLessThan(WELLNESS_NEUTRAL.nutrition);
    expect(postMeal.nutrition).toBeGreaterThan(preMeal.nutrition);
    // Bounded 0..1 always
    for (const p of r.points) {
      expect(p.nutrition).toBeGreaterThanOrEqual(0);
      expect(p.nutrition).toBeLessThanOrEqual(1);
      expect(p.hydration).toBeGreaterThanOrEqual(0);
      expect(p.hydration).toBeLessThanOrEqual(1);
    }
  });
});
