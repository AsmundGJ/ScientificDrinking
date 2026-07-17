import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbDayPlan } from '../sim/testing/arbitraries';
import { decodePlan, encodePlan, planFromFragment, shareUrl } from './plan-codec';

describe('plan codec (lz-string over URL fragment)', () => {
  it('roundtrips any plan losslessly', () => {
    fc.assert(
      fc.property(fc.array(arbDayPlan(0), { minLength: 1, maxLength: 7 }), (plan) => {
        expect(decodePlan(encodePlan(plan))).toEqual(plan);
      }),
      { numRuns: 25 },
    );
  });

  it('rejects garbage without throwing', () => {
    expect(decodePlan('not-a-plan')).toBeNull();
    expect(decodePlan('')).toBeNull();
    expect(planFromFragment(null)).toBeNull();
    expect(planFromFragment('#nope')).toBeNull();
  });

  it('parses the fragment out of a share URL', () => {
    const plan = [
      {
        id: 'day1',
        dateMs: 0,
        anchors: [],
        meals: [],
        hydrations: [],
        sleep: { fromMs: 0, toMs: 1 },
        ceilingPermille: 0.8,
        minTroughPermille: 0.3,
        dailyBudget: 10,
      },
    ];
    const url = shareUrl('https://pace.app', plan);
    const fragment = url.split('#')[1] ?? null;
    expect(planFromFragment(fragment)).toEqual(plan);
  });

  it('the payload contains no profile — the plan is the shareable artifact', () => {
    const encoded = encodePlan([]);
    expect(encoded).not.toContain('weightKg');
  });
});
