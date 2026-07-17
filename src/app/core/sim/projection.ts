/**
 * projection = f(log, plan, now)
 *
 * Nothing else. The log is truth (what happened), the plan is a forecast
 * (what we intend), and this function derives everything the UI shows.
 * Pure: same inputs → same output. No hidden state, no Date.now().
 */
import { Anchor, AppState, DayPlan, LogEntry, MealTemplate, Millis, Profile } from '../domain/types';
import { GENSTAND_GRAMS, MS_PER_DAY, MS_PER_HOUR } from './constants';
import { ethanolGrams, gramsForLoggedDrink } from './drinks';
import { bacRatePerHour, simulate } from './engine';
import { kaAt } from './ka';
import { dayCeiling, lastCallMs, planDay } from './planner';
import { CurvePoint, DrinkEvent, FoodEvent, SimState, ZERO_STATE } from './types';

export type Trend = 'rising' | 'falling' | 'holding';

export interface Projection {
  nowMs: Millis;
  current: SimState;
  trend: Trend;
  /** Additional ‰ still to arrive from the gut — the most important line in the app. */
  incomingPermille: number;
  incomingGrams: number;
  /** Peak of what is ALREADY committed (no further drinks). */
  peakPermille: number;
  peakAtMs: Millis;
  /** Reconstructed history (solid line behind now). */
  past: CurvePoint[];
  /** Forward with planned drinks (dashed line ahead). */
  future: CurvePoint[];
  /** Forward with zero further drinks. */
  inertia: CurvePoint[];
  plannedDrinkTimes: Millis[];
  nextPlannedDrinkMs: Millis | null;
  /** Can one more drink land right now without breaching the ceiling? */
  roomForOneNow: boolean;
  nextAnchor: Anchor | null;
  lastCallMs: Millis | null;
  effectiveCeiling: number | null;
  day: DayPlan | null;
}

/** Food events from the log (the only way food touches BAC). */
export function foodEventsFromLog(log: readonly LogEntry[]): FoodEvent[] {
  const out: FoodEvent[] = [];
  for (const e of log) if (e.kind === 'food') out.push({ atMs: e.atMs, fullness: e.fullness });
  return out;
}

export function drinkEventsFromLog(app: AppState): DrinkEvent[] {
  const out: DrinkEvent[] = [];
  for (const e of app.log) {
    if (e.kind === 'drink') out.push({ atMs: e.atMs, grams: gramsForLoggedDrink(e, app.presets) });
  }
  return out;
}

/** The DayPlan whose 24 h window contains nowMs, with its index, or null. */
export function dayPlanFor(plan: readonly DayPlan[], nowMs: Millis): { day: DayPlan; index: number } | null {
  for (let i = 0; i < plan.length; i++) {
    const d = plan[i]!;
    if (nowMs >= d.dateMs && nowMs < d.dateMs + MS_PER_DAY) return { day: d, index: i };
  }
  return null;
}

/** Sleep debt over the last 24 h, normalised 0..1 against an 8 h night. No data = no debt claimed. */
export function sleepDebtNorm(log: readonly LogEntry[], nowMs: Millis): number {
  const from = nowMs - MS_PER_DAY;
  let sleptMs = 0;
  let sawAny = false;
  for (const e of log) {
    if (e.kind !== 'sleep') continue;
    sawAny = true;
    const a = Math.max(e.fromMs, from);
    const b = Math.min(e.toMs, nowMs);
    if (b > a) sleptMs += b - a;
  }
  if (!sawAny) return 0;
  const sleptH = sleptMs / MS_PER_HOUR;
  return Math.min(1, Math.max(0, (8 - sleptH) / 8));
}

function countDrinksLogged(log: readonly LogEntry[], fromMs: Millis, toMs: Millis): number {
  let n = 0;
  for (const e of log) if (e.kind === 'drink' && e.atMs >= fromMs && e.atMs < toMs) n++;
  return n;
}

/**
 * Grams in the drink the user actually taps: their most-logged preset,
 * falling back to the first preset, falling back to one genstand. The
 * planner MUST plan in this — planning 12 g phantom drinks while the user
 * logs 18 g real ones is how you overshoot a ceiling by a third.
 */
export function typicalDrinkGrams(app: AppState): number {
  const counts = new Map<string, number>();
  for (const e of app.log) {
    if (e.kind === 'drink') counts.set(e.presetId, (counts.get(e.presetId) ?? 0) + 1);
  }
  let best = app.presets[0] ?? null;
  let bestN = -1;
  for (const p of app.presets) {
    const n = counts.get(p.id) ?? 0;
    if (n > bestN) {
      best = p;
      bestN = n;
    }
  }
  return best ? ethanolGrams(best.volumeMl, best.abv) : GENSTAND_GRAMS;
}

function plannedFoods(day: DayPlan, mealTemplates: readonly MealTemplate[]): FoodEvent[] {
  const foods: FoodEvent[] = [];
  for (const m of day.meals) {
    const tpl = mealTemplates.find((t) => t.id === m.templateId);
    if (tpl) foods.push({ atMs: m.atMs, fullness: tpl.fullness });
  }
  return foods;
}

export interface IntentWeek {
  /** Per-day intent segments (points cover that day's 24 h). */
  perDay: Map<string, { points: CurvePoint[]; times: Millis[] }>;
  /** The whole chain, continuous across day boundaries. */
  points: CurvePoint[];
  times: Millis[];
}

/**
 * The planned level as a CONTINUOUS chain: each day starts from the
 * previous day's end state, not from zero — waking up a little drunk is
 * part of the model, and day 4's last call shapes day 5's curve.
 */
export function projectIntentWeek(
  plan: readonly DayPlan[],
  profile: Profile,
  mealTemplates: readonly MealTemplate[],
  drinkGrams: number = GENSTAND_GRAMS,
): IntentWeek {
  const days = [...plan].sort((a, b) => a.dateMs - b.dateMs);
  const perDay = new Map<string, { points: CurvePoint[]; times: Millis[] }>();
  const points: CurvePoint[] = [];
  const times: Millis[] = [];
  let state = ZERO_STATE;
  let cursorMs: Millis | null = null;

  for (const day of days) {
    // Decay through any gap between events/days.
    if (cursorMs !== null && day.dateMs > cursorMs) {
      const gap = simulate(state, cursorMs, day.dateMs, profile, [], []);
      points.push(...gap.points.slice(1));
      state = gap.end;
    }
    const foods = plannedFoods(day, mealTemplates);
    const res = planDay(day, state, day.dateMs, day.ceilingPermille, profile, foods, 0, { drinkGrams });
    const sim = simulate(
      state,
      day.dateMs,
      day.dateMs + MS_PER_DAY,
      profile,
      res.times.map((atMs) => ({ atMs, grams: drinkGrams })),
      foods,
    );
    perDay.set(day.id, { points: sim.points, times: res.times });
    points.push(...(points.length > 0 ? sim.points.slice(1) : sim.points));
    times.push(...res.times);
    state = sim.end;
    cursorMs = day.dateMs + MS_PER_DAY;
  }
  return { perDay, points, times };
}

const RECONSTRUCT_LOOKBACK_MS = 24 * MS_PER_HOUR;
const RECONSTRUCT_MAX_LOOKBACK_MS = 14 * MS_PER_DAY;
const TREND_EPSILON_PERMILLE_PER_H = 0.02;

/**
 * The one derivation. Reconstructs current state from the log (residual BAC
 * at wake is real — the morning starts from it, not from zero), then plans
 * forward from wherever the user actually is.
 */
export function project(app: AppState, nowMs: Millis, horizonH = 12): Projection {
  const p = app.profile;
  const foods = foodEventsFromLog(app.log);
  const drinks = drinkEventsFromLog(app);

  // ── Past: reconstruct from the earliest log entry (capped at 14 days),
  // at least 24 h back — the curve is continuous across midnights, so a
  // slightly drunk morning carries over instead of resetting to zero.
  let earliest = nowMs;
  for (const e of app.log) {
    const t = 'atMs' in e ? e.atMs : e.fromMs;
    if (t < earliest) earliest = t;
  }
  const fromMs = Math.max(
    nowMs - RECONSTRUCT_MAX_LOOKBACK_MS,
    Math.min(earliest, nowMs - RECONSTRUCT_LOOKBACK_MS),
  );
  const past = simulate(
    ZERO_STATE,
    fromMs,
    nowMs,
    p,
    drinks.filter((d) => d.atMs >= fromMs),
    foods,
  );
  const current = past.end;

  // ── Day context
  const found = dayPlanFor(app.plan, nowMs);
  const day = found?.day ?? null;
  const effectiveCeiling = found
    ? dayCeiling(found.day.ceilingPermille, found.index, sleepDebtNorm(app.log, nowMs))
    : null;

  // Planned future meals count as expected food for the forecast.
  const forecastFoods: FoodEvent[] = [...foods];
  if (day) {
    for (const m of day.meals) {
      if (m.atMs > nowMs) {
        const tpl = app.mealTemplates.find((t) => t.id === m.templateId);
        if (tpl) forecastFoods.push({ atMs: m.atMs, fullness: tpl.fullness });
      }
    }
  }

  // ── Inertia: what is already committed. INCOMING lives here.
  const endMs = nowMs + horizonH * MS_PER_HOUR;
  const inertia = simulate(current, nowMs, endMs, p, [], forecastFoods);
  const incomingPermille = Math.max(0, inertia.peakPermille - current.bac);

  // ── Forward plan from actual state, in the drink the user actually logs.
  const drinkGrams = typicalDrinkGrams(app);
  let plannedDrinkTimes: Millis[] = [];
  if (day && effectiveCeiling !== null) {
    const logged = countDrinksLogged(app.log, day.dateMs, day.dateMs + MS_PER_DAY);
    plannedDrinkTimes = planDay(day, current, nowMs, effectiveCeiling, p, forecastFoods, logged, {
      drinkGrams,
    }).times;
  }
  const future = simulate(
    current,
    nowMs,
    endMs,
    p,
    plannedDrinkTimes.map((atMs) => ({ atMs, grams: drinkGrams })),
    forecastFoods,
  );

  // ── Room for one now? Probe with the user's actual drink, same rule the planner uses.
  let roomForOneNow = false;
  if (effectiveCeiling !== null) {
    const probe = simulate(
      { gutGrams: current.gutGrams + drinkGrams, bac: current.bac },
      nowMs,
      nowMs + 3 * MS_PER_HOUR,
      p,
      [],
      forecastFoods,
      { collectPoints: false },
    );
    roomForOneNow = probe.peakPermille <= effectiveCeiling;
  }

  // ── Trend arrow: costs nothing, and is the honest answer to
  // "why don't I feel it?" mid-descent.
  const rate = bacRatePerHour(current, p, kaAt(nowMs, foods));
  const trend: Trend =
    rate > TREND_EPSILON_PERMILLE_PER_H ? 'rising' : rate < -TREND_EPSILON_PERMILLE_PER_H ? 'falling' : 'holding';

  const nextAnchor =
    app.plan
      .flatMap((d) => d.anchors)
      .filter((a) => a.atMs > nowMs)
      .sort((a, b) => a.atMs - b.atMs)[0] ?? null;

  const lastCall = day
    ? lastCallMs(day.sleep.toMs, current.bac, incomingPermille, 0, p.beta)
    : null;

  return {
    nowMs,
    current,
    trend,
    incomingPermille,
    incomingGrams: current.gutGrams,
    peakPermille: inertia.peakPermille,
    peakAtMs: inertia.peakAtMs,
    past: past.points,
    future: future.points,
    inertia: inertia.points,
    plannedDrinkTimes,
    nextPlannedDrinkMs: plannedDrinkTimes.find((t) => t > nowMs) ?? null,
    roomForOneNow,
    nextAnchor,
    lastCallMs: lastCall,
    effectiveCeiling,
    day,
  };
}
