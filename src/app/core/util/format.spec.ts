import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR } from '../sim/constants';
import { dayTimeToMs, roundPermille, sleepRangeToMs } from './format';

const H = MS_PER_HOUR;
// A real local midnight — these helpers are wall-clock based on purpose.
const DAY = new Date(2026, 6, 1).getTime();

describe('sleepRangeToMs', () => {
  it('normal festival night: 02:00 → 09:00 lands on the following morning', () => {
    const r = sleepRangeToMs(DAY, '02:00', '09:00');
    expect(r.fromMs - DAY).toBe(26 * H);
    expect(r.toMs - DAY).toBe(33 * H);
  });

  it('early night: 23:00 → 08:00 spans midnight', () => {
    const r = sleepRangeToMs(DAY, '23:00', '08:00');
    expect(r.fromMs - DAY).toBe(23 * H);
    expect(r.toMs - DAY).toBe(32 * H);
  });

  it('REGRESSION: night-shift sleep 07:00 → 14:00 is a valid forward interval', () => {
    const r = sleepRangeToMs(DAY, '07:00', '14:00');
    expect(r.fromMs - DAY).toBe(31 * H); // tomorrow 07:00
    expect(r.toMs - DAY).toBe(38 * H); // tomorrow 14:00 — NOT today 14:00
    expect(r.toMs).toBeGreaterThan(r.fromMs);
  });
});

describe('helpers', () => {
  it('dayTimeToMs rollover: hours before 06:00 belong to the following day', () => {
    expect(dayTimeToMs(DAY, '22:00') - DAY).toBe(22 * H);
    expect(dayTimeToMs(DAY, '01:30') - DAY).toBe(25.5 * H);
  });

  it('display rounding is 0.05‰ — never three decimals', () => {
    expect(roundPermille(0.6321)).toBeCloseTo(0.65, 9);
    expect(roundPermille(0.61)).toBeCloseTo(0.6, 9);
  });
});
