import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AppState, DayPlan, LogEntry, Profile } from '../domain/types';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from './constants';
import { project, projectIntentWeek } from './projection';
import { arbDayPlan } from './testing/arbitraries';

const profile: Profile = { weightKg: 80, heightCm: 180, age: 30, sex: 'male', r: 0.68, beta: 0.15 };
const presets = [{ id: 'beer50', label: 'Fadøl 50', volumeMl: 500, abv: 4.6, emoji: '🍻' }];

const DAY_START = 100 * MS_PER_HOUR; // arbitrary epoch-ish origin, keeps everything positive

const arbLog: fc.Arbitrary<LogEntry[]> = fc.array(
  fc.oneof(
    fc
      .record({
        id: fc.uuid(),
        min: fc.integer({ min: 0, max: 10 * 60 }),
        fraction: fc.constantFrom<0.25 | 0.5 | 0.75 | 1>(0.25, 0.5, 0.75, 1),
      })
      .map(
        (x): LogEntry => ({
          kind: 'drink',
          id: x.id,
          atMs: DAY_START + x.min * MS_PER_MINUTE,
          presetId: 'beer50',
          fraction: x.fraction,
        }),
      ),
    fc
      .record({
        id: fc.uuid(),
        min: fc.integer({ min: 0, max: 10 * 60 }),
        fullness: fc.constantFrom<'snack' | 'meal' | 'big'>('snack', 'meal', 'big'),
      })
      .map(
        (x): LogEntry => ({ kind: 'food', id: x.id, atMs: DAY_START + x.min * MS_PER_MINUTE, fullness: x.fullness }),
      ),
    fc
      .record({ id: fc.uuid(), min: fc.integer({ min: 0, max: 10 * 60 }) })
      .map(
        (x): LogEntry => ({
          kind: 'water',
          id: x.id,
          atMs: DAY_START + x.min * MS_PER_MINUTE,
          ml: 500,
          electrolytes: false,
        }),
      ),
  ),
  { maxLength: 12 },
);

const arbApp: fc.Arbitrary<AppState> = fc
  .record({ day: arbDayPlan(DAY_START), log: arbLog })
  .map(({ day, log }) => ({ profile, presets, mealTemplates: [], events: [], plan: [day], log }));

describe('projection = f(log, plan, now) — properties', () => {
  it('is pure: same inputs give identical output, no hidden state', () => {
    fc.assert(
      fc.property(arbApp, fc.integer({ min: 0, max: 12 * 60 }), (app, nowMin) => {
        const now = DAY_START + nowMin * MS_PER_MINUTE;
        const a = project(app, now);
        const b = project(app, now);
        expect(b).toEqual(a);
      }),
      { numRuns: 15 },
    );
  });

  it('feel and water entries never change the BAC projection', () => {
    fc.assert(
      fc.property(arbApp, fc.integer({ min: 0, max: 12 * 60 }), (app, nowMin) => {
        const now = DAY_START + nowMin * MS_PER_MINUTE;
        const noise: LogEntry[] = [
          { kind: 'feel', id: 'f1', atMs: now - MS_PER_HOUR, rating: 3 },
          { kind: 'water', id: 'w1', atMs: now - MS_PER_HOUR, ml: 700, electrolytes: true },
        ];
        const a = project(app, now);
        const b = project({ ...app, log: [...app.log, ...noise] }, now);
        expect(b.current).toEqual(a.current);
        expect(b.peakPermille).toBe(a.peakPermille);
      }),
      { numRuns: 15 },
    );
  });
});

describe('projection — behaviour', () => {
  const base: AppState = { profile, presets, mealTemplates: [], events: [], plan: [], log: [] };

  it('INCOMING: right after three quick beers, the peak is still ahead of you', () => {
    const now = DAY_START + 2 * MS_PER_HOUR;
    const log: LogEntry[] = [0, 10, 20].map((min, i) => ({
      kind: 'drink',
      id: `d${i}`,
      atMs: now - 25 * MS_PER_MINUTE + min * MS_PER_MINUTE,
      presetId: 'beer50',
      fraction: 1,
    }));
    const proj = project({ ...base, log }, now);
    expect(proj.incomingGrams).toBeGreaterThan(5); // still in the gut
    expect(proj.incomingPermille).toBeGreaterThan(0.05); // still to arrive
    expect(proj.peakAtMs).toBeGreaterThan(now); // you have already made this decision
    expect(proj.trend).toBe('rising');
  });

  it('residual BAC at wake: the morning starts from it, not from zero', () => {
    // Stop drinking at 03:00 at ~1.2‰ → six hours later BAC ≈ 0.3‰, not 0.
    const stopMs = DAY_START;
    const log: LogEntry[] = [0, 1, 2, 3, 4, 5].map((i) => ({
      kind: 'drink',
      id: `d${i}`,
      atMs: stopMs - (5 - i) * 30 * MS_PER_MINUTE,
      presetId: 'beer50',
      fraction: 1,
    }));
    const morning = project({ ...base, log }, stopMs + 6 * MS_PER_HOUR);
    expect(morning.current.bac).toBeGreaterThan(0.1);
  });

  it('intent chain carries state across midnight — day two does not start at zero', () => {
    const mkDay = (dateMs: number): DayPlan => ({
      id: `day-${dateMs}`,
      dateMs,
      anchors: [{ id: 'a', atMs: dateMs + 23.5 * MS_PER_HOUR, label: 'Late set', units: 4 }],
      meals: [],
      hydrations: [],
      sleep: { fromMs: dateMs + 26 * MS_PER_HOUR, toMs: dateMs + 33 * MS_PER_HOUR },
      ceilingPermille: 1.0,
      minTroughPermille: 0.3,
      dailyBudget: 10,
    });
    const d1 = mkDay(DAY_START);
    const d2 = mkDay(DAY_START + MS_PER_DAY);
    const week = projectIntentWeek([d1, d2], profile, []);
    const day2 = week.perDay.get(d2.id)!;
    const firstPoint = day2.points[0]!;
    // A 23:30 full-lift anchor leaves residual BAC at 00:00 — carried over.
    expect(firstPoint.atMs).toBe(d2.dateMs);
    expect(firstPoint.bac).toBeGreaterThan(0.1);
    // And the concatenated chain is continuous (no duplicate/reset at the seam).
    const seam = week.points.filter((p) => p.atMs === d2.dateMs);
    expect(seam).toHaveLength(1);
    expect(seam[0]!.bac).toBeCloseTo(firstPoint.bac, 9);
  });

  it("REGRESSION: following the suggestions with your actual beer doesn't overshoot the ceiling", () => {
    // The Smukfest day-1 scenario: 14:00 anchor asking 4 units, user drinks 50 cl fadøl (1.5 units).
    const dateMs = DAY_START;
    const day = {
      id: 'smuk1',
      dateMs,
      anchors: [{ id: 'a', atMs: dateMs + 8 * MS_PER_HOUR, label: 'First lift', units: 4 }],
      meals: [],
      hydrations: [],
      sleep: { fromMs: dateMs + 26 * MS_PER_HOUR, toMs: dateMs + 33 * MS_PER_HOUR },
      ceilingPermille: 0.9,
      minTroughPermille: 0.3,
      dailyBudget: 10,
    };
    const app: AppState = { profile, presets, mealTemplates: [], events: [], plan: [day], log: [] };
    const now = dateMs + 4 * MS_PER_HOUR;
    const proj = project(app, now);
    expect(proj.plannedDrinkTimes.length).toBeGreaterThan(0);
    // Log EXACTLY the suggestions as the real preset (18.15 g each):
    const followed: AppState = {
      ...app,
      log: proj.plannedDrinkTimes.map((atMs, i) => ({
        kind: 'drink' as const,
        id: `d${i}`,
        atMs,
        presetId: 'beer50',
        fraction: 1 as const,
      })),
    };
    const after = project(followed, dateMs + 12 * MS_PER_HOUR);
    const dayPeak = Math.max(...after.past.filter((p) => p.atMs >= dateMs).map((p) => p.bac));
    expect(dayPeak).toBeLessThanOrEqual(0.9 + 0.02); // grid tolerance, nowhere near 1.0
  });

  it('an unlogged (missed) drink is headroom: projection simply recomputes lower', () => {
    const now = DAY_START + 3 * MS_PER_HOUR;
    const logged: LogEntry[] = [
      { kind: 'drink', id: 'd1', atMs: now - MS_PER_HOUR, presetId: 'beer50', fraction: 1 },
    ];
    const withDrink = project({ ...base, log: logged }, now);
    const without = project({ ...base, log: [] }, now);
    expect(without.current.bac).toBeLessThanOrEqual(withDrink.current.bac);
  });
});
