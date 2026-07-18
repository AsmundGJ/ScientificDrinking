/**
 * Domain types for Pace.
 *
 * The invariant that rules everything:
 *
 *     projection = f(log, plan, now)
 *
 * `plan` stores intent (never drink timestamps). `log` stores truth
 * (append-only). They are never reconciled.
 */

export type Millis = number;

export type Sex = 'male' | 'female';

export interface Profile {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  /** Widmark distribution factor, derived via Watson TBW. Computed, never edited directly. */
  r: number;
  /** Elimination rate in ‰/h. Default 0.15, user-adjustable 0.10–0.20. NEVER rises across days. */
  beta: number;
}

export interface DrinkPreset {
  id: string;
  label: string; // "Tuborg 33"
  volumeMl: number; // 330
  abv: number; // 4.6
  emoji: string;
}

export type Fullness = 'snack' | 'meal' | 'big';

export interface Macros {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * Eating and hydrating are SEPARATE concerns: meals drive ka (and the
 * nutrition curve), water lives in its own hydrate events. No hidden
 * hydration rides along with food.
 */
export interface MealTemplate {
  id: string;
  label: string; // "Rugbrød med tun"
  /** Drives ka — REQUIRED, load-bearing. */
  fullness: Fullness;
  /** Typed in once, sober, at a laptop. Appears nowhere in the math. */
  macros: Macros;
}

/** The intent, planned sober. Immutable once the day starts. */
export interface Anchor {
  id: string;
  atMs: Millis; // 22:00 — the headliner
  label: string;
  /**
   * Units (genstande, 12 g each) allocated to this ascent. The clearest
   * possible reference: what you actually pour. The day ceiling still has
   * the final say — the planner truncates rather than breach it.
   */
  units: number;
}

/** A festival / trip: a named container of consecutive DayPlans. */
export interface PlanEvent {
  id: string;
  name: string; // "Smukfest"
}

export interface DayPlan {
  id: string;
  /** The event this day belongs to. */
  eventId?: string;
  dateMs: Millis; // start of the (logical) day
  anchors: Anchor[];
  meals: { atMs: Millis; templateId: string }[];
  /** Planned water moments — shown as their own markers on the timeline. */
  hydrations: { atMs: Millis; ml: number; electrolytes?: boolean }[];
  sleep: { fromMs: Millis; toMs: Millis };
  /** Hard cap on any projected peak. No UI path may raise it mid-day. */
  ceilingPermille: number;
  /** Must decay to this before the next lift. Resets sensitivity (fun) AND prevents ratcheting (safety). */
  minTroughPermille: number;
  /** Max drinks — a cap you may come in under, never a target. Never rolls over. */
  dailyBudget: number;
}

/**
 * Truth. Append-first: entries are written immediately and never silently
 * mutated by the app. The user may correct their own log (wrong tap, wrong
 * size) via explicit edit/remove — a correction changes what "truth" says
 * happened, it is not a second bookkeeping system.
 */
export type LogEntry =
  | {
      kind: 'drink';
      id: string;
      atMs: Millis;
      presetId: string;
      fraction: 0.25 | 0.5 | 0.75 | 1;
      /** Per-entry corrections; when absent the preset's values apply. */
      volumeMl?: number;
      abv?: number;
    }
  | { kind: 'food'; id: string; atMs: Millis; fullness: Fullness; templateId?: string }
  | { kind: 'water'; id: string; atMs: Millis; ml: number; electrolytes: boolean }
  | { kind: 'sleep'; id: string; fromMs: Millis; toMs: Millis }
  | { kind: 'feel'; id: string; atMs: Millis; rating: 1 | 2 | 3 | 4 | 5 };

export interface AppState {
  profile: Profile;
  presets: DrinkPreset[];
  mealTemplates: MealTemplate[];
  /** Festivals / trips; each groups a run of days in `plan`. */
  events: PlanEvent[];
  plan: DayPlan[];
  log: LogEntry[];
}
