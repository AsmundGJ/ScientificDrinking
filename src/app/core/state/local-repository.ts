/**
 * localStorage persistence. A whole week is ~50 KB — genuinely sufficient,
 * and it works with 30,000 people on one cell tower, which IndexedDB
 * elegance does not improve on.
 */
import { Injectable } from '@angular/core';
import { migrateDayPlan } from '../domain/migrate';
import { AppState, DayPlan, LogEntry, PlanEvent } from '../domain/types';
import { EMPTY_STATE } from './defaults';
import { StateRepository } from './state-repository';

const KEY = 'pace.v1.state';
const DEFAULT_EVENT_ID = 'default-event';

/** Upgrade stored state written by older versions of the schema. */
function normalize(state: AppState): AppState {
  const plan = state.plan.map(migrateDayPlan);
  let events = state.events ?? [];
  if (events.length === 0 && plan.length > 0) {
    events = [{ id: DEFAULT_EVENT_ID, name: 'My festival' }];
    for (const d of plan) d.eventId = d.eventId ?? DEFAULT_EVENT_ID;
  }
  return { ...state, plan, events };
}

@Injectable()
export class LocalRepository extends StateRepository {
  private read(): AppState {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(EMPTY_STATE);
      return normalize({ ...structuredClone(EMPTY_STATE), ...(JSON.parse(raw) as Partial<AppState>) });
    } catch {
      return structuredClone(EMPTY_STATE);
    }
  }

  private write(state: AppState): void {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  override load(): Promise<AppState> {
    return Promise.resolve(this.read());
  }

  override append(entry: LogEntry): Promise<void> {
    const s = this.read();
    s.log = [...s.log, entry];
    this.write(s);
    return Promise.resolve();
  }

  override replaceEntry(entry: LogEntry): Promise<void> {
    const s = this.read();
    s.log = s.log.map((e) => (e.id === entry.id ? entry : e));
    this.write(s);
    return Promise.resolve();
  }

  override removeEntry(id: string): Promise<void> {
    const s = this.read();
    s.log = s.log.filter((e) => e.id !== id);
    this.write(s);
    return Promise.resolve();
  }

  override shiftEntryTime(id: string, deltaMs: number): Promise<void> {
    const s = this.read();
    s.log = s.log.map((e) => (e.id === id && 'atMs' in e ? { ...e, atMs: e.atMs + deltaMs } : e));
    this.write(s);
    return Promise.resolve();
  }

  override savePlan(plan: DayPlan[]): Promise<void> {
    const s = this.read();
    s.plan = plan;
    this.write(s);
    return Promise.resolve();
  }

  override saveEvents(events: PlanEvent[]): Promise<void> {
    const s = this.read();
    s.events = events;
    this.write(s);
    return Promise.resolve();
  }

  override saveConfig(config: Pick<AppState, 'profile' | 'presets' | 'mealTemplates'>): Promise<void> {
    const s = this.read();
    this.write({ ...s, ...config });
    return Promise.resolve();
  }
}
