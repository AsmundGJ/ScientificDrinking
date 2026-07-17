/**
 * The persistence seam. Components never touch storage — they talk to the
 * store, the store talks to this. Later, an HttpRepository swaps in on one
 * line in app.config.ts with zero component changes: textbook Angular DI.
 */
import { AppState, DayPlan, LogEntry, PlanEvent } from '../domain/types';

export abstract class StateRepository {
  abstract load(): Promise<AppState>;
  /** The log is append-only. */
  abstract append(entry: LogEntry): Promise<void>;
  /** User-facing correction: delete a wrongly logged entry. */
  abstract removeEntry(id: string): Promise<void>;
  /** User-facing correction: replace an entry (same id) with an edited one. */
  abstract replaceEntry(entry: LogEntry): Promise<void>;
  /** Used by the −15m/−30m scrub on the undo snackbar. */
  abstract shiftEntryTime(id: string, deltaMs: number): Promise<void>;
  abstract savePlan(plan: DayPlan[]): Promise<void>;
  abstract saveEvents(events: PlanEvent[]): Promise<void>;
  abstract saveConfig(config: Pick<AppState, 'profile' | 'presets' | 'mealTemplates'>): Promise<void>;
}
