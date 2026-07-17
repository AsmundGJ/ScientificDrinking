import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DayPlan, Profile } from '../domain/types';
import { GENSTAND_GRAMS, MS_PER_HOUR, MS_PER_MINUTE } from './constants';
import { simulate } from './engine';
import {
  dayCeiling,
  lastCallMs,
  planDay,
  planDrinks,
  standardDaySchedule,
  standardFestivalDay,
  toothBudget,
} from './planner';
import { arbDayPlan, arbProfile, arbToothScenario } from './testing/arbitraries';
import { DrinkEvent, FoodEvent, ZERO_STATE } from './types';

const EPS = 1e-9;
const RUNS = { numRuns: 30 };

const refMale: Profile = { weightKg: 80, heightCm: 180, age: 30, sex: 'male', r: 0.68, beta: 0.15 };

const asDrinks = (times: readonly number[]): DrinkEvent[] =>
  times.map((atMs) => ({ atMs, grams: GENSTAND_GRAMS }));

describe('planDrinks — properties', () => {
  it('never allocates more than the budget', () => {
    fc.assert(
      fc.property(arbToothScenario, ({ p, bac0, windowMinutes, budget, ceiling }) => {
        const times = planDrinks(
          { gutGrams: 0, bac: bac0 },
          { fromMs: 0, toMs: windowMinutes * MS_PER_MINUTE },
          budget,
          ceiling,
          p,
        );
        expect(times.length).toBeLessThanOrEqual(budget);
      }),
      RUNS,
    );
  });

  it('no projected peak ever exceeds the ceiling', () => {
    fc.assert(
      fc.property(arbToothScenario, ({ p, bac0, windowMinutes, budget, ceiling }) => {
        const windowMs = windowMinutes * MS_PER_MINUTE;
        const initial = { gutGrams: 0, bac: bac0 };
        const times = planDrinks(initial, { fromMs: 0, toMs: windowMs }, budget, ceiling, p);
        const r = simulate(initial, 0, windowMs + 3 * MS_PER_HOUR, p, asDrinks(times), [], {
          collectPoints: false,
        });
        expect(r.peakPermille).toBeLessThanOrEqual(ceiling + EPS);
      }),
      RUNS,
    );
  });

  it('HEADLINE: skipping any planned drink never causes a later ceiling breach', () => {
    fc.assert(
      fc.property(
        arbToothScenario,
        fc.nat(),
        ({ p, bac0, windowMinutes, budget, ceiling }, skipSeed) => {
          const windowMs = windowMinutes * MS_PER_MINUTE;
          const initial = { gutGrams: 0, bac: bac0 };
          const times = planDrinks(initial, { fromMs: 0, toMs: windowMs }, budget, ceiling, p);
          if (times.length === 0) return;
          const skipped = times.filter((_, i) => i !== skipSeed % times.length);
          const r = simulate(initial, 0, windowMs + 3 * MS_PER_HOUR, p, asDrinks(skipped), [], {
            collectPoints: false,
          });
          expect(r.peakPermille).toBeLessThanOrEqual(ceiling + EPS);
        },
      ),
      RUNS,
    );
  });

  it('fasted (ka 6.0) yields no more drinks than fed (big meal) for the same window and ceiling', () => {
    fc.assert(
      fc.property(arbToothScenario, ({ p, bac0, windowMinutes, budget, ceiling }) => {
        const window = { fromMs: 0, toMs: windowMinutes * MS_PER_MINUTE };
        const initial = { gutGrams: 0, bac: bac0 };
        const fed: FoodEvent[] = [{ atMs: 0, fullness: 'big' }];
        const nFasted = planDrinks(initial, window, budget, ceiling, p, []).length;
        const nFed = planDrinks(initial, window, budget, ceiling, p, fed).length;
        expect(nFasted).toBeLessThanOrEqual(nFed);
      }),
      RUNS,
    );
  });

  it('fasted is strictly fewer in the reference tight-ceiling case', () => {
    // Same window, same ceiling: eating a real meal is mechanically a pacing tool.
    const window = { fromMs: 0, toMs: 1.5 * MS_PER_HOUR };
    const nFasted = planDrinks(ZERO_STATE, window, 8, 0.35, refMale, []).length;
    const nFed = planDrinks(ZERO_STATE, window, 8, 0.35, refMale, [{ atMs: 0, fullness: 'big' }]).length;
    expect(nFasted).toBeLessThan(nFed);
  });
});

describe('planDay — properties', () => {
  it('budget never rolls over: total allocated ≤ dailyBudget − already logged', () => {
    fc.assert(
      fc.property(arbDayPlan(0), arbProfile, fc.integer({ min: 0, max: 6 }), (day, p, logged) => {
        const res = planDay(day, ZERO_STATE, 0, day.ceilingPermille, p, [], logged);
        expect(res.times.length).toBeLessThanOrEqual(Math.max(0, day.dailyBudget - logged));
      }),
      RUNS,
    );
  });

  it('day-level: no peak breaches the ceiling, even skipping one drink', () => {
    fc.assert(
      fc.property(arbDayPlan(0), arbProfile, fc.nat(), (day, p, skipSeed) => {
        const res = planDay(day, ZERO_STATE, 0, day.ceilingPermille, p, []);
        const endMs = 17 * MS_PER_HOUR;
        const full = simulate(ZERO_STATE, 0, endMs, p, asDrinks(res.times), [], { collectPoints: false });
        expect(full.peakPermille).toBeLessThanOrEqual(day.ceilingPermille + EPS);
        if (res.times.length > 0) {
          const skipped = res.times.filter((_, i) => i !== skipSeed % res.times.length);
          const r = simulate(ZERO_STATE, 0, endMs, p, asDrinks(skipped), [], { collectPoints: false });
          expect(r.peakPermille).toBeLessThanOrEqual(day.ceilingPermille + EPS);
        }
      }),
      RUNS,
    );
  });

  it('replanning is idempotent: same inputs, same plan', () => {
    fc.assert(
      fc.property(arbDayPlan(0), arbProfile, (day, p) => {
        const a = planDay(day, ZERO_STATE, 0, day.ceilingPermille, p, []);
        const b = planDay(day, ZERO_STATE, 0, day.ceilingPermille, p, []);
        expect(b).toEqual(a);
      }),
      RUNS,
    );
  });
});

describe('planDay — unit sizing and consecutive anchors (regressions)', () => {
  const mkDay = (anchors: { atMs: number; units: number }[]): DayPlan => ({
    id: 'day',
    dateMs: 0,
    anchors: anchors.map((a, i) => ({ id: `a${i}`, atMs: a.atMs, label: `A${i}`, units: a.units })),
    meals: [],
    hydrations: [],
    sleep: { fromMs: 26 * MS_PER_HOUR, toMs: 33 * MS_PER_HOUR },
    ceilingPermille: 1.2,
    minTroughPermille: 0.3,
    dailyBudget: 12,
  });

  it('an anchor gets exactly its units when the ceiling allows', () => {
    const two = planDay(mkDay([{ atMs: 6 * MS_PER_HOUR, units: 2 }]), ZERO_STATE, 0, 1.2, refMale);
    const five = planDay(mkDay([{ atMs: 6 * MS_PER_HOUR, units: 5 }]), ZERO_STATE, 0, 1.2, refMale);
    expect(two.times).toHaveLength(2);
    expect(five.times).toHaveLength(5);
    const peakOf = (times: number[]) =>
      simulate(ZERO_STATE, 0, 9 * MS_PER_HOUR, refMale, asDrinks(times), [], { collectPoints: false })
        .peakPermille;
    expect(peakOf(five.times)).toBeGreaterThan(peakOf(two.times));
  });

  it('a tight ceiling truncates the ask — units are a request, not a right', () => {
    const res = planDay(mkDay([{ atMs: 6 * MS_PER_HOUR, units: 8 }]), ZERO_STATE, 0, 0.5, refMale);
    expect(res.times.length).toBeLessThan(8);
  });

  it('REGRESSION: plans in the actual pour size — 4 units ≈ 3 big beers, and no overshoot', () => {
    const fadol50 = 18.15; // 50 cl @ 4.6%
    const day = { ...mkDay([{ atMs: 6 * MS_PER_HOUR, units: 4 }]), ceilingPermille: 0.7 };
    const res = planDay(day, ZERO_STATE, 0, 0.7, refMale, [], 0, { drinkGrams: fadol50 });
    // 4 units = 48 g → 3 big beers, not 4 phantom 12 g drinks.
    expect(res.times.length).toBeLessThanOrEqual(3);
    // Following the suggestions with the REAL drink stays under the ceiling.
    const sim = simulate(
      ZERO_STATE,
      0,
      9 * MS_PER_HOUR,
      refMale,
      res.times.map((atMs) => ({ atMs, grams: fadol50 })),
      [],
      { collectPoints: false },
    );
    expect(sim.peakPermille).toBeLessThanOrEqual(0.7 + EPS);
  });

  it('consecutive anchors each get their own lift (trough gate yields, ceiling still rules)', () => {
    const day = mkDay([
      { atMs: 6 * MS_PER_HOUR, units: 4 },
      { atMs: 7.5 * MS_PER_HOUR, units: 4 },
    ]);
    const res = planDay(day, ZERO_STATE, 0, 1.2, refMale);
    const secondTooth = res.times.filter((t) => t >= 7.5 * MS_PER_HOUR);
    expect(secondTooth.length).toBeGreaterThan(0);
    // Safety unchanged: the combined day never breaches the ceiling.
    const r = simulate(ZERO_STATE, 0, 11 * MS_PER_HOUR, refMale, asDrinks(res.times), [], {
      collectPoints: false,
    });
    expect(r.peakPermille).toBeLessThanOrEqual(1.2 + EPS);
  });
});

describe('standardDaySchedule — festival cadence', () => {
  it('80 kg male at 0.6/0.3: four lifts, 4/2/2/2 units, 3 h apart, starting 14:00', () => {
    const spec = { fromMs: 14 * MS_PER_HOUR, toMs: 26 * MS_PER_HOUR, ceiling: 0.6, trough: 0.3 };
    const res = standardDaySchedule(spec, refMale);
    expect(res.anchors.map((a) => a.units)).toEqual([4, 2, 2, 2]);
    expect(res.anchors.map((a) => a.atMs / MS_PER_HOUR)).toEqual([14, 17, 20, 23]);
    expect(res.totalUnits).toBe(10);
  });

  it('keeps peaks close together and under the ceiling — no giant 5 h cycles', () => {
    const ceiling = 0.6;
    const trough = 0.3;
    const spec = { fromMs: 14 * MS_PER_HOUR, toMs: 26 * MS_PER_HOUR, ceiling, trough };
    const res = standardDaySchedule(spec, refMale);
    for (let i = 1; i < res.anchors.length; i++) {
      expect(res.anchors[i]!.atMs - res.anchors[i - 1]!.atMs).toBeLessThanOrEqual(3 * MS_PER_HOUR);
    }
    const day: DayPlan = {
      id: 'd',
      dateMs: 0,
      anchors: res.anchors.map((a, i) => ({ ...a, id: `a${i}` })),
      meals: [],
      hydrations: [],
      sleep: { fromMs: 26 * MS_PER_HOUR, toMs: 33 * MS_PER_HOUR },
      ceilingPermille: ceiling,
      minTroughPermille: trough,
      dailyBudget: res.totalPours,
    };
    const plan = planDay(day, ZERO_STATE, 0, ceiling, refMale);
    const sim = simulate(ZERO_STATE, 0, 27 * MS_PER_HOUR, refMale, asDrinks(plan.times), []);
    expect(sim.peakPermille).toBeGreaterThan(0.45); // actually gets up there
    expect(sim.peakPermille).toBeLessThanOrEqual(ceiling + EPS); // never over
  });

  it('standardFestivalDay: meals in the gaps, hydration all day, budget = total pours', () => {
    const templates = [
      { id: 'm1', label: 'Meal', fullness: 'meal' as const, macros: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 } },
      { id: 's1', label: 'Snack', fullness: 'snack' as const, macros: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 } },
      { id: 'b1', label: 'Big', fullness: 'big' as const, macros: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 } },
    ];
    const res = standardFestivalDay(0, 26 * MS_PER_HOUR, 0.6, 0.3, refMale, templates);
    expect(res.anchors.length).toBe(4);
    expect(res.meals.length).toBe(5);
    expect(res.hydrations.length).toBe(7);
    expect(res.totalPours).toBe(10); // 12 g standard pour
  });
});

describe('sizing and framing helpers', () => {
  it('toothBudget: an anchor asks in units, floored at one', () => {
    expect(toothBudget({ id: 'a', atMs: 0, label: '', units: 3 })).toBe(3);
    expect(toothBudget({ id: 'a', atMs: 0, label: '', units: 0 })).toBe(1);
  });

  it('dayCeiling: day five is MORE conservative, and sleep debt lowers it further', () => {
    expect(dayCeiling(0.8, 4, 0)).toBeLessThan(dayCeiling(0.8, 0, 0));
    expect(dayCeiling(0.8, 4, 1)).toBeLessThan(dayCeiling(0.8, 4, 0));
  });

  it('lastCall: stopping at 1.2‰ six hours before wake leaves residual BAC (wake impaired)', () => {
    // 1.2‰ at beta 0.15 needs 8 h to clear → last call is 8 h before wake.
    const wake = 9 * MS_PER_HOUR;
    const lc = lastCallMs(wake, 1.2, 0, 0, 0.15);
    expect(lc).toBeCloseTo(wake - 8 * MS_PER_HOUR, 6);
  });
});
