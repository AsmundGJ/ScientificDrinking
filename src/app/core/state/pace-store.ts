/**
 * The single signals store. Components read computed projections and call
 * log/plan methods; every mutation goes through the StateRepository seam.
 * All simulation stays in core/sim — this file only wires state to it.
 */
import { computed, inject, Injectable, signal } from '@angular/core';
import {
  AppState,
  DayPlan,
  DrinkPreset,
  Fullness,
  LogEntry,
  MealTemplate,
  Millis,
  PlanEvent,
  Profile,
  Sex,
} from '../domain/types';
import { DEFAULT_BETA, MS_PER_DAY, MS_PER_HOUR } from '../sim/constants';
import { dayCeiling, standardFestivalDay } from '../sim/planner';
import { typicalDrinkGrams } from '../sim/projection';
import { project } from '../sim/projection';
import { watsonR } from '../sim/watson';
import { uid } from '../util/format';
import { EMPTY_STATE } from './defaults';
import { StateRepository } from './state-repository';

@Injectable({ providedIn: 'root' })
export class PaceStore {
  private readonly repo = inject(StateRepository);

  private readonly _state = signal<AppState>(EMPTY_STATE);
  readonly state = this._state.asReadonly();

  /** Wall clock as a signal, ticked every 30 s — the `now` in f(log, plan, now). */
  readonly now = signal<Millis>(Date.now());

  /** Resolvers await this so routes don't render before persistence has loaded. */
  readonly ready: Promise<void>;

  readonly profile = computed(() => this._state().profile);
  readonly presets = computed(() => this._state().presets);
  readonly mealTemplates = computed(() => this._state().mealTemplates);
  readonly events = computed(() => this._state().events);
  readonly plan = computed(() => this._state().plan);
  readonly log = computed(() => this._state().log);

  /** THE derivation. Everything the UI shows about BAC comes from here. */
  readonly projection = computed(() => project(this._state(), this.now()));

  constructor() {
    this.ready = this.repo.load().then((s) => this._state.set(s));
    setInterval(() => this.now.set(Date.now()), 30_000);
  }

  // ── Logging (append-only; undo is the one exception, see StateRepository) ──

  logDrink(presetId: string, fraction: 0.25 | 0.5 | 0.75 | 1 = 1, atMs = Date.now()): string {
    return this.appendEntry({ kind: 'drink', id: uid(), atMs, presetId, fraction });
  }

  logFood(fullness: Fullness, templateId?: string, atMs = Date.now()): string {
    const entry: LogEntry = templateId
      ? { kind: 'food', id: uid(), atMs, fullness, templateId }
      : { kind: 'food', id: uid(), atMs, fullness };
    return this.appendEntry(entry);
  }

  logWater(ml = 500, electrolytes = false, atMs = Date.now()): string {
    return this.appendEntry({ kind: 'water', id: uid(), atMs, ml, electrolytes });
  }

  logSleep(fromMs: Millis, toMs: Millis): string {
    return this.appendEntry({ kind: 'sleep', id: uid(), fromMs, toMs });
  }

  logFeel(rating: 1 | 2 | 3 | 4 | 5, atMs = Date.now()): string {
    return this.appendEntry({ kind: 'feel', id: uid(), atMs, rating });
  }

  /** 5-second undo affordance. */
  undo(id: string): void {
    this.removeEntry(id);
  }

  /** User-facing correction: delete a wrongly logged entry. */
  removeEntry(id: string): void {
    this._state.update((s) => ({ ...s, log: s.log.filter((e) => e.id !== id) }));
    void this.repo.removeEntry(id);
  }

  /** User-facing correction: replace an entry (matched by id) with an edited one. */
  updateEntry(entry: LogEntry): void {
    this._state.update((s) => ({ ...s, log: s.log.map((e) => (e.id === entry.id ? entry : e)) }));
    void this.repo.replaceEntry(entry);
  }

  /** −15m/−30m scrub on the undo snackbar — you WILL forget for 20 minutes. */
  shiftEntryTime(id: string, deltaMs: number): void {
    this._state.update((s) => ({
      ...s,
      log: s.log.map((e) => (e.id === id && 'atMs' in e ? { ...e, atMs: e.atMs + deltaMs } : e)),
    }));
    void this.repo.shiftEntryTime(id, deltaMs);
  }

  /** Change a logged drink to 25/50/75% — warm abandoned beer is real. */
  setDrinkFraction(id: string, fraction: 0.25 | 0.5 | 0.75 | 1): void {
    const entry = this._state().log.find((e) => e.id === id);
    if (entry?.kind === 'drink') this.updateEntry({ ...entry, fraction });
  }

  // ── Plan (immutable once the day starts) ──────────────────────────────────

  /**
   * Replaces the plan. Days that have already started stay editable
   * (anchors, meals, sleep), with one hard exception: neither the ceiling
   * nor the budget can be RAISED mid-day. The planner cannot be talked
   * into more headroom by the person it exists to protect.
   */
  savePlan(next: DayPlan[]): void {
    const nowMs = this.now();
    const current = this._state().plan;
    const merged = next.map((d) => {
      const existing = current.find((c) => c.id === d.id);
      const started = existing && existing.dateMs <= nowMs;
      if (!started) return d;
      return {
        ...d,
        ceilingPermille: Math.min(d.ceilingPermille, existing.ceilingPermille),
        dailyBudget: Math.min(d.dailyBudget, existing.dailyBudget),
      };
    });
    // Started days that the new plan tried to drop stay too — intent vs
    // reality must remain comparable afterwards.
    for (const c of current) {
      if (c.dateMs <= nowMs && !merged.some((d) => d.id === c.id)) merged.push(c);
    }
    merged.sort((a, b) => a.dateMs - b.dateMs);
    this._state.update((s) => ({ ...s, plan: merged }));
    void this.repo.savePlan(merged);
  }

  /** Replace a single day (same rules as savePlan). */
  updateDay(day: DayPlan): void {
    this.savePlan(this._state().plan.map((d) => (d.id === day.id ? day : d)));
  }

  /** Remove a day. Started days are kept by the savePlan guard. */
  removeDay(id: string): void {
    this.savePlan(this._state().plan.filter((d) => d.id !== id));
  }

  /** A sensible default day: two anchors, two meals, two water moments. */
  private makeDefaultDay(dateMs: Millis, index: number, eventId: string): DayPlan {
    return {
      id: uid(),
      eventId,
      dateMs,
      anchors: [
        { id: uid(), atMs: dateMs + 17 * MS_PER_HOUR, label: 'Afternoon act', units: 2 },
        { id: uid(), atMs: dateMs + 22 * MS_PER_HOUR, label: 'Headliner', units: 4 },
      ],
      meals: [
        { atMs: dateMs + 12 * MS_PER_HOUR, templateId: 'rugbrod-tun' },
        { atMs: dateMs + 19 * MS_PER_HOUR, templateId: 'festival-burger' },
      ],
      hydrations: [
        { atMs: dateMs + 15 * MS_PER_HOUR, ml: 500 },
        { atMs: dateMs + 21 * MS_PER_HOUR, ml: 500 },
      ],
      sleep: { fromMs: dateMs + 26 * MS_PER_HOUR, toMs: dateMs + 33 * MS_PER_HOUR },
      // Ceilings taper DOWN across the event — day five is more conservative.
      ceilingPermille: dayCeiling(0.9, index, 0),
      minTroughPermille: 0.3,
      dailyBudget: 10,
    };
  }

  /** Create a named event (festival/trip) with one day per date in the range. */
  addEvent(name: string, startMs: Millis, endMs: Millis): string {
    const event: PlanEvent = { id: uid(), name: name.trim() || 'Festival' };
    const nDays = Math.max(1, Math.round((endMs - startMs) / MS_PER_DAY) + 1);
    const days = Array.from({ length: nDays }, (_, i) =>
      this.makeDefaultDay(startMs + i * MS_PER_DAY, i, event.id),
    );
    this.saveEvents([...this._state().events, event]);
    this.savePlan([...this._state().plan, ...days]);
    return event.id;
  }

  /** Append one day to an event, right after its last day. */
  addDayToEvent(eventId: string): string {
    const days = this._state().plan.filter((d) => d.eventId === eventId);
    const last = [...days].sort((a, b) => a.dateMs - b.dateMs)[days.length - 1];
    let dateMs: Millis;
    if (last) {
      dateMs = last.dateMs + MS_PER_DAY;
    } else {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      dateMs = d.getTime();
    }
    const day = this.makeDefaultDay(dateMs, days.length, eventId);
    this.savePlan([...this._state().plan, day]);
    return day.id;
  }

  /**
   * Fill every day of an event with the standard festival day: meals and
   * water on the clock, lifts every ~3 h sized to the profile (first lift
   * 0 → ceiling, later ones topping up from the partial decay). Replaces
   * anchors, meals and hydrations; each day's own ceiling/trough is used.
   */
  applyStandardFestivalToEvent(eventId: string): void {
    const s = this._state();
    const drinkGrams = typicalDrinkGrams(s);
    for (const day of s.plan.filter((d) => d.eventId === eventId)) {
      const res = standardFestivalDay(
        day.dateMs,
        day.sleep.fromMs,
        day.ceilingPermille,
        day.minTroughPermille,
        s.profile,
        s.mealTemplates,
        { drinkGrams },
      );
      this.updateDay({
        ...day,
        anchors: res.anchors.map((a) => ({ ...a, id: uid() })),
        meals: res.meals,
        hydrations: res.hydrations,
        dailyBudget: res.totalPours,
      });
    }
  }

  /** Remove an event and its days (started days are kept by the savePlan guard). */
  removeEvent(eventId: string): void {
    this.savePlan(this._state().plan.filter((d) => d.eventId !== eventId));
    // Keep the event itself if any (started) days survived the guard.
    const stillUsed = this._state().plan.some((d) => d.eventId === eventId);
    if (!stillUsed) this.saveEvents(this._state().events.filter((e) => e.id !== eventId));
  }

  /** Accept a shared plan: it arrives as its own event. */
  importPlan(days: DayPlan[]): void {
    const event: PlanEvent = { id: uid(), name: 'Imported plan' };
    this.saveEvents([...this._state().events, event]);
    this.savePlan([
      ...this._state().plan,
      ...days.map((d) => ({ ...d, eventId: event.id })),
    ]);
  }

  private saveEvents(events: PlanEvent[]): void {
    this._state.update((s) => ({ ...s, events }));
    void this.repo.saveEvents(events);
  }

  /** Default week: a 7-day event starting at startMs. */
  generateDefaultWeek(startMs: Millis): void {
    this.addEvent('Festival week', startMs, startMs + 6 * MS_PER_DAY);
  }

  // ── Config ────────────────────────────────────────────────────────────────

  saveProfile(input: { weightKg: number; heightCm: number; age: number; sex: Sex; beta?: number }): void {
    const profile: Profile = {
      ...input,
      beta: input.beta ?? DEFAULT_BETA,
      r: watsonR(input), // r is always derived, never edited
    };
    this._state.update((s) => ({ ...s, profile }));
    this.persistConfig();
  }

  savePresets(presets: DrinkPreset[]): void {
    this._state.update((s) => ({ ...s, presets: presets.slice(0, 6) })); // six max — a cooler, not a search box
    this.persistConfig();
  }

  saveMealTemplates(mealTemplates: MealTemplate[]): void {
    this._state.update((s) => ({ ...s, mealTemplates }));
    this.persistConfig();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private appendEntry(entry: LogEntry): string {
    this._state.update((s) => ({ ...s, log: [...s.log, entry] }));
    void this.repo.append(entry);
    return entry.id;
  }

  private persistConfig(): void {
    const { profile, presets, mealTemplates } = this._state();
    void this.repo.saveConfig({ profile, presets, mealTemplates });
  }
}
