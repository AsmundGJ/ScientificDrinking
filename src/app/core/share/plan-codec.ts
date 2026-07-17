/**
 * Plan sharing with zero infrastructure: DayPlan[] → lz-string → URL fragment.
 * Fragments never hit a server; works offline; paste it in the group chat.
 *
 * The plan is the shareable artifact. The profile is personal and is NEVER
 * part of the payload — a friend opens the link, enters their own weight,
 * and sees THEIR curve for YOUR plan.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { migrateDayPlan } from '../domain/migrate';
import { DayPlan } from '../domain/types';

export function encodePlan(plan: readonly DayPlan[]): string {
  return compressToEncodedURIComponent(JSON.stringify(plan));
}

export function decodePlan(encoded: string): DayPlan[] | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed) || !parsed.every(isDayPlan)) return null;
    // Normalize links produced by older versions.
    return parsed.map(migrateDayPlan);
  } catch {
    return null;
  }
}

export function shareUrl(origin: string, plan: readonly DayPlan[]): string {
  return `${origin}/import#p=${encodePlan(plan)}`;
}

export function planFromFragment(fragment: string | null): DayPlan[] | null {
  if (!fragment) return null;
  const match = /(?:^|&)p=([^&]+)/.exec(fragment);
  return match?.[1] ? decodePlan(match[1]) : null;
}

function isDayPlan(x: unknown): x is DayPlan {
  if (typeof x !== 'object' || x === null) return false;
  const d = x as Record<string, unknown>;
  return (
    typeof d['id'] === 'string' &&
    typeof d['dateMs'] === 'number' &&
    Array.isArray(d['anchors']) &&
    Array.isArray(d['meals']) &&
    typeof d['sleep'] === 'object' &&
    d['sleep'] !== null &&
    typeof d['ceilingPermille'] === 'number' &&
    typeof d['minTroughPermille'] === 'number' &&
    typeof d['dailyBudget'] === 'number'
  );
}
