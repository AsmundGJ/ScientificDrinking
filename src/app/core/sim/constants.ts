import { Fullness } from '../domain/types';

/** Ethanol density, g/ml. */
export const ETHANOL_DENSITY_G_PER_ML = 0.789;

/** Danish genstand = 12 g ethanol. Also the planner's unit drink. */
export const GENSTAND_GRAMS = 12;

/** Water fraction of blood — converts Watson TBW to a Widmark-style r. */
export const BLOOD_WATER_FRACTION = 0.806;

/** Absorption rate constant (per hour) on an empty stomach. */
export const KA_FASTED = 6.0;

/** ka immediately after eating, by stomach fullness. */
export const KA_BY_FULLNESS: Record<Fullness, number> = {
  snack: 4.5,
  meal: 3.0,
  big: 1.5,
};

/** ka relaxes back toward fasted as the stomach empties (~90 min). */
export const KA_RELAX_TAU_H = 1.5;

/** Default elimination rate, ‰/h. */
export const DEFAULT_BETA = 0.15;
export const MIN_BETA = 0.1;
export const MAX_BETA = 0.2;

/** Simulation resolution: 1 minute. A 12 h projection is ~720 steps — instant. */
export const DT_H = 1 / 60;

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Displayed BAC is rounded to this. The model carries ±30% error easily; three decimals would be a lie. */
export const DISPLAY_ROUNDING_PERMILLE = 0.05;
