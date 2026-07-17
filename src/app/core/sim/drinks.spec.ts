import { describe, expect, it } from 'vitest';
import { Profile } from '../domain/types';
import { ethanolGrams, genstande, gramsForLoggedDrink, maintenanceGramsPerHour } from './drinks';

const preset = { id: 'tuborg33', label: 'Tuborg 33', volumeMl: 330, abv: 4.6, emoji: '🍺' };

describe('ethanol mass', () => {
  it('33 cl beer @ 4.6% ≈ 12 g ≈ 1 genstand', () => {
    const g = ethanolGrams(330, 4.6);
    expect(g).toBeCloseTo(11.98, 2);
    expect(genstande(g)).toBeCloseTo(1.0, 1);
  });

  it('50 cl festival beer @ 4.6% ≈ 18 g ≈ 1.5 genstande', () => {
    const g = ethanolGrams(500, 4.6);
    expect(g).toBeCloseTo(18.15, 2);
    expect(genstande(g)).toBeCloseTo(1.5, 1);
  });

  it('4 cl spirit @ 40% ≈ 12.6 g', () => {
    expect(ethanolGrams(40, 40)).toBeCloseTo(12.62, 2);
  });

  it('per-entry corrections (volume/ABV) override the preset', () => {
    const corrected = gramsForLoggedDrink(
      { kind: 'drink', id: 'x', atMs: 0, presetId: 'tuborg33', fraction: 1, volumeMl: 500, abv: 7.0 },
      [preset],
    );
    expect(corrected).toBeCloseTo(ethanolGrams(500, 7.0), 6);
    expect(corrected).not.toBeCloseTo(ethanolGrams(330, 4.6), 1);
  });

  it('honours the "didn\'t finish it" fraction', () => {
    const full = gramsForLoggedDrink(
      { kind: 'drink', id: 'x', atMs: 0, presetId: 'tuborg33', fraction: 1 },
      [preset],
    );
    const half = gramsForLoggedDrink(
      { kind: 'drink', id: 'x', atMs: 0, presetId: 'tuborg33', fraction: 0.5 },
      [preset],
    );
    expect(half).toBeCloseTo(full / 2, 6);
  });
});

describe('maintenance rate (the zero-order ceiling)', () => {
  it('≈ 8 g/h for an 80 kg male with r 0.68, beta 0.15', () => {
    const p: Profile = { weightKg: 80, heightCm: 180, age: 30, sex: 'male', r: 0.68, beta: 0.15 };
    expect(maintenanceGramsPerHour(p)).toBeCloseTo(8.16, 2);
  });
});
