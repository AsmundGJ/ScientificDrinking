/** Display helpers. Pure. */
import { Millis } from '../domain/types';
import { DISPLAY_ROUNDING_PERMILLE } from '../sim/constants';

/**
 * Displayed BAC is rounded to 0.05‰ — never three decimals. The model
 * carries ±30% error easily; false precision reads as false authority.
 */
export function roundPermille(x: number): number {
  return Math.round(x / DISPLAY_ROUNDING_PERMILLE) * DISPLAY_ROUNDING_PERMILLE;
}

export function fmtPermille(x: number): string {
  return `${roundPermille(x).toFixed(2)}‰`;
}

export function fmtTime(ms: Millis): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDate(ms: Millis): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "HH:MM" value for a <input type="time">. */
export function msToTimeInput(ms: Millis): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Replace the time-of-day of `originalMs`, keeping its date. */
export function withTimeFromInput(originalMs: Millis, hhmm: string): Millis {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(originalMs);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.getTime();
}

/**
 * Map "HH:MM" onto a festival day that runs past midnight: times before
 * `rolloverHour` (default 06:00) belong to the FOLLOWING calendar day.
 */
export function dayTimeToMs(dayStartMs: Millis, hhmm: string, rolloverHour = 6): Millis {
  const [h, m] = hhmm.split(':').map(Number);
  const hours = h ?? 0;
  const d = new Date(dayStartMs);
  d.setHours(hours, m ?? 0, 0, 0);
  const base = d.getTime();
  return hours < rolloverHour ? base + 24 * 3_600_000 : base;
}

/**
 * Planned sleep range for a festival day. Sleep start uses the 12:00
 * rollover ("23:00" = tonight, "02:00"/"07:00" = tomorrow morning); the
 * wake time is then wrapped forward until it lies AFTER the start — so a
 * night-shift sleep of 07:00 → 14:00 lands on tomorrow 07:00–14:00
 * instead of producing an inverted interval.
 */
export function sleepRangeToMs(
  dayStartMs: Millis,
  fromHHMM: string,
  toHHMM: string,
): { fromMs: Millis; toMs: Millis } {
  const fromMs = dayTimeToMs(dayStartMs, fromHHMM, 12);
  let toMs = dayTimeToMs(dayStartMs, toHHMM, 12);
  while (toMs <= fromMs) toMs += 24 * 3_600_000;
  return { fromMs, toMs };
}

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
