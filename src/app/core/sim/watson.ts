/**
 * Watson total-body-water estimate → Widmark-style distribution factor r.
 * Better than a flat 0.68/0.55 constant because r actually varies with
 * body composition, and the whole app is a function of r * weight.
 */
import { Sex } from '../domain/types';
import { BLOOD_WATER_FRACTION } from './constants';

export interface Body {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
}

/** Total body water, litres (Watson 1980). */
export function totalBodyWaterL(b: Body): number {
  return b.sex === 'male'
    ? 2.447 - 0.09516 * b.age + 0.1074 * b.heightCm + 0.3362 * b.weightKg
    : -2.097 + 0.1069 * b.heightCm + 0.2466 * b.weightKg;
}

/** Distribution factor r = TBW / (weight × water fraction of blood). */
export function watsonR(b: Body): number {
  return totalBodyWaterL(b) / (b.weightKg * BLOOD_WATER_FRACTION);
}
