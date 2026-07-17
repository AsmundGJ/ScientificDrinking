import { describe, expect, it } from 'vitest';
import { totalBodyWaterL, watsonR } from './watson';

describe('Watson body water / distribution factor', () => {
  it('computes TBW for a reference male (30 y, 180 cm, 80 kg)', () => {
    const tbw = totalBodyWaterL({ sex: 'male', age: 30, heightCm: 180, weightKg: 80 });
    // 2.447 - 0.09516*30 + 0.1074*180 + 0.3362*80
    expect(tbw).toBeCloseTo(45.82, 2);
  });

  it('computes TBW for a reference female (25 y, 165 cm, 60 kg)', () => {
    const tbw = totalBodyWaterL({ sex: 'female', age: 25, heightCm: 165, weightKg: 60 });
    // -2.097 + 0.1069*165 + 0.2466*60
    expect(tbw).toBeCloseTo(30.34, 2);
  });

  it('derives r ≈ 0.71 for the reference male', () => {
    const r = watsonR({ sex: 'male', age: 30, heightCm: 180, weightKg: 80 });
    expect(r).toBeCloseTo(0.7106, 3);
  });

  it('derives r ≈ 0.63 for the reference female', () => {
    const r = watsonR({ sex: 'female', age: 25, heightCm: 165, weightKg: 60 });
    expect(r).toBeCloseTo(0.6273, 3);
  });

  it('age lowers r for males (TBW shrinks with age)', () => {
    const young = watsonR({ sex: 'male', age: 20, heightCm: 180, weightKg: 80 });
    const old = watsonR({ sex: 'male', age: 60, heightCm: 180, weightKg: 80 });
    expect(old).toBeLessThan(young);
  });
});
