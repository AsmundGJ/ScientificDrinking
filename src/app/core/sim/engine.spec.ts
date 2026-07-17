import { describe, expect, it } from 'vitest';
import { Profile } from '../domain/types';
import { DT_H, KA_FASTED, MS_PER_HOUR } from './constants';
import { simulate, step } from './engine';
import { SimState, ZERO_STATE } from './types';

const p: Profile = { weightKg: 80, heightCm: 180, age: 30, sex: 'male', r: 0.68, beta: 0.15 };

describe('step()', () => {
  it('conserves mass: grams gained in blood equal grams absorbed from gut', () => {
    const noElim: Profile = { ...p, beta: 0 };
    let s: SimState = { gutGrams: 30, bac: 0 };
    const total = (x: SimState) => x.gutGrams + x.bac * noElim.r * noElim.weightKg;
    const before = total(s);
    for (let i = 0; i < 240; i++) s = step(s, DT_H, noElim, KA_FASTED);
    expect(total(s)).toBeCloseTo(before, 9);
  });

  it('floors BAC at zero, never negative', () => {
    let s: SimState = { gutGrams: 0, bac: 0.02 };
    for (let i = 0; i < 120; i++) {
      s = step(s, DT_H, p, KA_FASTED);
      expect(s.bac).toBeGreaterThanOrEqual(0);
    }
    expect(s.bac).toBe(0);
  });

  it('decays linearly at exactly beta with an empty gut', () => {
    let s: SimState = { gutGrams: 0, bac: 1.0 };
    for (let i = 0; i < 120; i++) s = step(s, DT_H, p, KA_FASTED); // 2 h
    expect(s.bac).toBeCloseTo(1.0 - 2 * p.beta, 9);
  });
});

describe('simulate()', () => {
  it('a drink produces a delayed peak — the pipeline naive Widmark hides', () => {
    const r = simulate(ZERO_STATE, 0, 3 * MS_PER_HOUR, p, [{ atMs: 0, grams: 24 }]);
    expect(r.peakPermille).toBeGreaterThan(0.2);
    expect(r.peakAtMs).toBeGreaterThan(10 * 60_000); // not instant
    expect(r.end.bac).toBeLessThan(r.peakPermille); // descending by 3 h
  });

  it('same drinks on a big meal peak ~lower than fasted', () => {
    const drinks = [{ atMs: 0, grams: 24 }];
    const fasted = simulate(ZERO_STATE, 0, 4 * MS_PER_HOUR, p, drinks, []);
    const fed = simulate(ZERO_STATE, 0, 4 * MS_PER_HOUR, p, drinks, [{ atMs: 0, fullness: 'big' }]);
    expect(fed.peakPermille).toBeLessThan(fasted.peakPermille * 0.85);
  });

  it('missing a meal produces a visibly higher curve from identical drinks', () => {
    const drinks = [{ atMs: MS_PER_HOUR, grams: 36 }];
    const withMeal = simulate(ZERO_STATE, 0, 5 * MS_PER_HOUR, p, drinks, [{ atMs: 0, fullness: 'meal' }]);
    const skipped = simulate(ZERO_STATE, 0, 5 * MS_PER_HOUR, p, drinks, []);
    expect(skipped.peakPermille).toBeGreaterThan(withMeal.peakPermille);
  });

  it('collects one point per minute', () => {
    const r = simulate(ZERO_STATE, 0, MS_PER_HOUR, p);
    expect(r.points).toHaveLength(61);
    expect(r.points[0]!.atMs).toBe(0);
    expect(r.points[60]!.atMs).toBe(MS_PER_HOUR);
  });
});
