/**
 * Schema migrations for stored state and shared links written by older
 * versions of the app. Applied on every load/decode.
 */
import { Anchor, DayPlan } from './types';

interface LegacyAnchor extends Omit<Anchor, 'units'> {
  units?: number;
  /** Pre-units schema. */
  lift?: 'gentle' | 'full';
}

interface LegacyDayPlan extends Omit<DayPlan, 'anchors' | 'hydrations'> {
  anchors: LegacyAnchor[];
  hydrations?: DayPlan['hydrations'];
}

export function migrateDayPlan(day: DayPlan): DayPlan {
  const d = day as LegacyDayPlan;
  return {
    ...day,
    hydrations: d.hydrations ?? [],
    anchors: d.anchors.map((a) => ({
      id: a.id,
      atMs: a.atMs,
      label: a.label,
      units: a.units ?? (a.lift === 'full' ? 4 : 2),
    })),
  };
}
