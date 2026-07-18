/**
 * The planner. `plan` stores intent (anchors, ceilings, budgets) — never
 * drink timestamps. Individual drink times are DERIVED here and recomputed
 * on every log event, which is what makes drift-tolerance fall out for free.
 *
 * Sawtooth, not plateau: euphoria tracks dBAC/dt, so we plan short ascents
 * ending at each anchor, with decay to a trough in between. The troughs are
 * what make the next lift work; they're also where food and water go.
 */
import { Anchor, DayPlan, Fullness, MealTemplate, Millis, Profile } from '../domain/types';
import { DT_H, GENSTAND_GRAMS, MS_PER_HOUR, MS_PER_MINUTE } from './constants';
import { simulate, step } from './engine';
import { kaAt } from './ka';
import { DrinkEvent, FoodEvent, SimState } from './types';

export interface PlanWindow {
  fromMs: Millis;
  toMs: Millis;
}

export interface PlannerOptions {
  /** Minimum spacing between planned drinks. Two drinks in one minute is not a plan. */
  minSpacingMs?: number;
  /** How far each tentative drink is simulated forward to check the ceiling. */
  probeHorizonH?: number;
  /** Planning unit drink: one genstand (12 g). */
  drinkGrams?: number;
  dtH?: number;
}

const DEFAULTS: Required<PlannerOptions> = {
  minSpacingMs: 20 * MS_PER_MINUTE,
  probeHorizonH: 3,
  drinkGrams: GENSTAND_GRAMS,
  dtH: DT_H,
};

/**
 * Greedy allocation inside one tooth window. Tentatively adds a drink,
 * simulates 3 h forward, keeps it only if no projected peak breaches the
 * ceiling. If the ceiling would be breached the budget silently truncates —
 * the plan quietly shrinks, it never demands a sprint.
 */
export function planDrinks(
  initial: SimState,
  window: PlanWindow,
  budget: number,
  ceiling: number,
  p: Profile,
  foods: readonly FoodEvent[] = [],
  options: PlannerOptions = {},
): Millis[] {
  const o = { ...DEFAULTS, ...options };
  const stepMs = Math.max(1, Math.round(o.dtH * MS_PER_HOUR));
  const times: Millis[] = [];
  let s: SimState = { ...initial };
  let nextAllowedMs = window.fromMs;

  for (let t = window.fromMs; t < window.toMs; t += stepMs) {
    if (times.length >= budget) break;

    if (t >= nextAllowedMs) {
      const probe = simulate(
        { gutGrams: s.gutGrams + o.drinkGrams, bac: s.bac },
        t,
        t + o.probeHorizonH * MS_PER_HOUR,
        p,
        [],
        foods,
        { dtH: o.dtH, collectPoints: false },
      );
      if (probe.peakPermille <= ceiling) {
        times.push(t);
        s = { gutGrams: s.gutGrams + o.drinkGrams, bac: s.bac };
        nextAllowedMs = t + o.minSpacingMs;
      }
    }
    s = step(s, o.dtH, p, kaAt(t, foods));
  }
  return times;
}

/** Minimum tooth duration. */
export const TOOTH_LEAD_MS = 45 * MS_PER_MINUTE;

export interface Tooth {
  anchor: Anchor;
  window: PlanWindow;
}

/** How long a tooth of n pours takes at the minimum spacing. */
export function toothDurationMs(pours: number, minSpacingMs: number = DEFAULTS.minSpacingMs): Millis {
  return Math.max(TOOTH_LEAD_MS, (pours - 1) * minSpacingMs + 25 * MS_PER_MINUTE);
}

/**
 * Tooth windows, planned FORWARD from each anchor: the anchor time is when
 * you START drinking — much easier to schedule than "be ascending by".
 * The window scales with the ask: more pours at minimum spacing simply
 * take longer.
 */
export function toothWindows(
  day: DayPlan,
  minSpacingMs: number = DEFAULTS.minSpacingMs,
  drinkGrams: number = GENSTAND_GRAMS,
): Tooth[] {
  return [...day.anchors]
    .sort((a, b) => a.atMs - b.atMs)
    .map((anchor) => {
      const pours = anchorPours(anchor, drinkGrams);
      return {
        anchor,
        window: { fromMs: anchor.atMs, toMs: anchor.atMs + toothDurationMs(pours, minSpacingMs) },
      };
    });
}

/**
 * The anchor asks in units (12 g genstande). The ceiling still has the
 * final say and truncates rather than breach.
 */
export function toothBudget(anchor: Anchor): number {
  return Math.max(1, Math.round(anchor.units));
}

/**
 * Units → actual pours. THE critical conversion: the planner must plan in
 * the drink the user will actually log. A 50 cl festival beer is 1.5 units;
 * "4 units" is 3 big beers, not 4 — planning in 12 g phantom drinks while
 * the user taps 18 g real ones overshoots the ceiling by a third.
 */
export function anchorPours(anchor: Anchor, drinkGrams: number = GENSTAND_GRAMS): number {
  return Math.max(1, Math.round((toothBudget(anchor) * GENSTAND_GRAMS) / drinkGrams));
}

export interface DayPlanResult {
  /** Derived drink times, one planning-unit drink (12 g) each. */
  times: Millis[];
  perTooth: { anchorId: string; times: Millis[] }[];
}

/**
 * Plan the rest of a day from actual current state. Past anchors are simply
 * gone — no catch-up concept exists because there is nothing to catch up to.
 * Unspent budget from earlier windows has already evaporated.
 */
export function planDay(
  day: DayPlan,
  initial: SimState,
  nowMs: Millis,
  ceiling: number,
  p: Profile,
  foods: readonly FoodEvent[] = [],
  drinksLoggedToday = 0,
  options: PlannerOptions = {},
): DayPlanResult {
  const o = { ...DEFAULTS, ...options };
  let remaining = Math.max(0, day.dailyBudget - drinksLoggedToday);
  let s: SimState = { ...initial };
  let cursorMs = nowMs;
  const perTooth: DayPlanResult['perTooth'] = [];
  const all: Millis[] = [];

  for (const { anchor, window } of toothWindows(day, o.minSpacingMs, o.drinkGrams)) {
    if (remaining <= 0) break;
    if (window.toMs <= nowMs) continue; // missed = headroom, not debt

    // Decay (no drinks) from the cursor to the window start.
    const from = Math.max(window.fromMs, cursorMs);
    if (from > cursorMs) {
      s = simulate(s, cursorMs, from, p, [], foods, { dtH: o.dtH, collectPoints: false }).end;
      cursorMs = from;
    }

    const budget = Math.min(remaining, anchorPours(anchor, o.drinkGrams));

    // Respect the trough: don't start the tooth until BAC has decayed to
    // minTrough (resets sensitivity, prevents ratcheting) — but never wait
    // so long that the tooth can no longer fit before its anchor. With
    // closely spaced anchors the trough gate yields; the ceiling probes in
    // planDrinks still enforce the hard safety cap either way.
    const neededMs = Math.max(0, (budget - 1) * o.minSpacingMs) + 5 * MS_PER_MINUTE;
    const latestStartMs = window.toMs - neededMs;
    let startMs = cursorMs;
    const stepMs = Math.max(1, Math.round(o.dtH * MS_PER_HOUR));
    while (startMs < window.toMs && startMs < latestStartMs && s.bac > day.minTroughPermille) {
      s = step(s, o.dtH, p, kaAt(startMs, foods));
      startMs += stepMs;
    }

    const times = planDrinks(s, { fromMs: startMs, toMs: window.toMs }, budget, ceiling, p, foods, o);

    // Advance the sim through the window with the allocated drinks on board.
    const events: DrinkEvent[] = times.map((atMs) => ({ atMs, grams: o.drinkGrams }));
    s = simulate(s, startMs, window.toMs, p, events, foods, { dtH: o.dtH, collectPoints: false }).end;
    cursorMs = window.toMs;

    remaining -= times.length;
    perTooth.push({ anchorId: anchor.id, times });
    all.push(...times);
  }

  return { times: all, perTooth };
}

export interface LiftScheduleSpec {
  /** Active drinking window (e.g. 14:00 → sleep). */
  fromMs: Millis;
  toMs: Millis;
  ceiling: number;
  trough: number;
}

export interface LiftSchedule {
  anchors: Omit<Anchor, 'id'>[];
  /** Total in 12 g units. */
  totalUnits: number;
  /** Total in actual pours — what dailyBudget counts. */
  totalPours: number;
}

export interface LiftScheduleOptions {
  minSpacingMs?: number;
  /** Grams per actual pour (the user's usual drink). */
  drinkGrams?: number;
  /** Time between lift starts. Festival cadence, not full-decay physics. */
  intervalMs?: number;
}

/** ~3 h between lift starts: a festival rhythm, not a lab protocol. */
export const DEFAULT_LIFT_INTERVAL_MS = 3 * MS_PER_HOUR;

/**
 * Festival-cadence lifts: starts every ~3 h (full ceiling↔trough cycles
 * would put 4–5 h between peaks — too long for a festival). The FIRST lift
 * climbs from zero to the ceiling; later lifts are sized to whatever the
 * partial decay left behind, floored at the trough. For an ~80 kg male at
 * 0.6/0.3 this yields 4/2/2/2 units at 14:00, 17:00, 20:00, 23:00. Anchor
 * time is when you START drinking. The ceiling probes still rule at
 * plan time — this is intent, not a licence.
 */
export function standardDaySchedule(
  spec: LiftScheduleSpec,
  p: Profile,
  options: LiftScheduleOptions = {},
): LiftSchedule {
  const minSpacingMs = options.minSpacingMs ?? DEFAULTS.minSpacingMs;
  const drinkGrams = options.drinkGrams ?? GENSTAND_GRAMS;
  const intervalMs = options.intervalMs ?? DEFAULT_LIFT_INTERVAL_MS;
  const unitsFor = (risePermille: number) =>
    Math.max(1, Math.round((risePermille * p.r * p.weightKg * 1.4) / GENSTAND_GRAMS));
  const poursFor = (units: number) => Math.max(1, Math.round((units * GENSTAND_GRAMS) / drinkGrams));

  const anchors: Omit<Anchor, 'id'>[] = [];
  let totalUnits = 0;
  let totalPours = 0;
  let baseline = 0; // estimated BAC when the lift starts
  let atMs = spec.fromMs;
  for (let i = 1; ; i++) {
    const rise = Math.max(0.1, spec.ceiling - baseline);
    const units = unitsFor(rise);
    const pours = poursFor(units);
    const ascentMs = toothDurationMs(pours, minSpacingMs);
    if (atMs + ascentMs > spec.toMs) break;
    anchors.push({ atMs, label: `Lift ${i}`, units });
    totalUnits += units;
    totalPours += pours;
    // Baseline at the next lift: decay from the ceiling once the ascent is done,
    // floored at the trough (the planner's trough gate holds there anyway).
    const gapDecayH = Math.max(0, (intervalMs - ascentMs) / MS_PER_HOUR);
    baseline = Math.max(spec.trough, spec.ceiling - p.beta * gapDecayH);
    atMs += intervalMs;
  }
  return { anchors, totalUnits, totalPours };
}

export interface StandardFestivalDay extends LiftSchedule {
  meals: { atMs: Millis; templateId: string }[];
  hydrations: { atMs: Millis; ml: number; electrolytes?: boolean }[];
}

/**
 * The full standard festival day: meals and water on the clock, lifts from
 * standardDaySchedule. Eating sits in the gaps between lifts; hydration is
 * its own thing, spread across the day.
 */
export function standardFestivalDay(
  dateMs: Millis,
  sleepFromMs: Millis,
  ceiling: number,
  trough: number,
  p: Profile,
  mealTemplates: readonly MealTemplate[],
  options: LiftScheduleOptions = {},
): StandardFestivalDay {
  const h = (hours: number) => dateMs + hours * MS_PER_HOUR;
  const lifts = standardDaySchedule(
    { fromMs: h(14), toMs: Math.min(sleepFromMs, h(26)), ceiling, trough },
    p,
    options,
  );
  const byFullness = (f: Fullness) => mealTemplates.find((t) => t.fullness === f) ?? mealTemplates[0];
  const mealPlan: [number, Fullness][] = [
    [10, 'meal'], // breakfast
    [12, 'snack'],
    [16, 'snack'],
    [18, 'big'], // dinner
    [22, 'meal'], // late medium meal
  ];
  const meals = mealPlan.flatMap(([hh, f]) => {
    const t = byFullness(f);
    return t ? [{ atMs: h(hh), templateId: t.id }] : [];
  });
  // The last water of the night carries electrolytes — the one that fights
  // tomorrow morning hardest.
  const hydrations = [9, 12, 14, 16.25, 18, 20, 23].map((hh) => ({
    atMs: h(hh),
    ml: 500,
    electrolytes: hh === 23,
  }));
  return { ...lifts, meals, hydrations };
}

/**
 * Day-level ceiling. The sign is the point: day five is MORE conservative,
 * not less. beta is NEVER raised across days — functional tolerance is
 * tolerance to *feeling* drunk; the user loses the sensor, not the
 * impairment, and the model must not lose it too.
 */
export function dayCeiling(base: number, daysIn: number, sleepDebtNorm: number): number {
  const debt = Math.min(1, Math.max(0, sleepDebtNorm));
  return base * (1 - 0.05 * daysIn) * (1 - 0.1 * debt);
}

/**
 * Last call, framed as a time, never a prohibition:
 * "Drink after 01:20 and you wake up impaired."
 * Day 4's last call determines day 5's responsiveness.
 */
export function lastCallMs(
  wakeMs: Millis,
  bac: number,
  pendingBacPermille: number,
  targetWakeBac: number,
  beta: number,
): Millis {
  return wakeMs - ((bac + pendingBacPermille - targetWakeBac) / beta) * MS_PER_HOUR;
}
