/**
 * Ethanol mass arithmetic. Pure conversions — the reason "one 50 cl
 * festival beer" and "one genstand" can live in the same model.
 */
import { DrinkPreset, LogEntry, Profile } from '../domain/types';
import { ETHANOL_DENSITY_G_PER_ML, GENSTAND_GRAMS } from './constants';

/** Grams of ethanol in a pour. 330 ml @ 4.6% ≈ 12 g ≈ 1 genstand. */
export function ethanolGrams(volumeMl: number, abvPercent: number): number {
  return volumeMl * (abvPercent / 100) * ETHANOL_DENSITY_G_PER_ML;
}

export function genstande(grams: number): number {
  return grams / GENSTAND_GRAMS;
}

/**
 * Grams for a logged drink entry: per-entry corrections (volumeMl/abv) win
 * over the preset, and the "didn't finish it" fraction applies last.
 */
export function gramsForLoggedDrink(
  entry: Extract<LogEntry, { kind: 'drink' }>,
  presets: readonly DrinkPreset[],
): number {
  const preset = presets.find((p) => p.id === entry.presetId);
  const volumeMl = entry.volumeMl ?? preset?.volumeMl;
  const abv = entry.abv ?? preset?.abv;
  // Unknown preset and no overrides: assume one genstand rather than zero —
  // losing alcohol from the model is the non-conservative direction.
  const fullGrams =
    volumeMl !== undefined && abv !== undefined ? ethanolGrams(volumeMl, abv) : GENSTAND_GRAMS;
  return fullGrams * entry.fraction;
}

/**
 * The hard, computable ceiling on sustainable intake (zero-order elimination):
 * grams/hour you can drink forever without BAC rising.
 * 80 kg male, r ≈ 0.68, beta 0.15 → ≈ 8 g/h ≈ 0.68 genstande/h.
 * Nobody believes this until they see it plotted.
 */
export function maintenanceGramsPerHour(p: Profile): number {
  return p.beta * p.r * p.weightKg;
}
