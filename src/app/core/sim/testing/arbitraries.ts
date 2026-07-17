/** fast-check arbitraries shared by the sim specs. */
import fc from 'fast-check';
import { Anchor, DayPlan, Profile, Sex } from '../../domain/types';
import { MS_PER_HOUR, MS_PER_MINUTE } from '../constants';
import { watsonR } from '../watson';

export const arbProfile: fc.Arbitrary<Profile> = fc
  .record({
    weightKg: fc.integer({ min: 50, max: 120 }),
    heightCm: fc.integer({ min: 150, max: 200 }),
    age: fc.integer({ min: 18, max: 60 }),
    sex: fc.constantFrom<Sex>('male', 'female'),
    beta: fc.double({ min: 0.1, max: 0.2, noNaN: true }),
  })
  .map((b) => ({ ...b, r: watsonR(b) }));

/** A tooth-scale allocation scenario. Everything minute-aligned so the
 * verification pass shares the planner's integration grid exactly. */
export const arbToothScenario = fc.record({
  p: arbProfile,
  bac0: fc.double({ min: 0, max: 0.3, noNaN: true }),
  windowMinutes: fc.integer({ min: 30, max: 120 }),
  budget: fc.integer({ min: 0, max: 6 }),
  ceiling: fc.double({ min: 0.4, max: 1.0, noNaN: true }),
});

const arbAnchor = (dayStartMs: number): fc.Arbitrary<Anchor> =>
  fc.record({
    id: fc.uuid(),
    // minute-aligned, between 2 h and 14 h into the day
    atMs: fc.integer({ min: 120, max: 14 * 60 }).map((min) => dayStartMs + min * MS_PER_MINUTE),
    label: fc.constantFrom('Main stage', 'Headliner', 'DJ set'),
    units: fc.integer({ min: 1, max: 5 }),
  });

export const arbDayPlan = (dayStartMs = 0): fc.Arbitrary<DayPlan> =>
  fc
    .record({
      id: fc.uuid(),
      anchors: fc.array(arbAnchor(dayStartMs), { minLength: 1, maxLength: 3 }),
      ceilingPermille: fc.double({ min: 0.5, max: 1.0, noNaN: true }),
      minTroughPermille: fc.double({ min: 0.15, max: 0.35, noNaN: true }),
      dailyBudget: fc.integer({ min: 0, max: 12 }),
    })
    .map((d) => ({
      ...d,
      dateMs: dayStartMs,
      meals: [],
      hydrations: [],
      sleep: { fromMs: dayStartMs + 19 * MS_PER_HOUR, toMs: dayStartMs + 29 * MS_PER_HOUR },
    }));
