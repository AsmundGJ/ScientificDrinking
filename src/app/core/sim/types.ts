/**
 * Simulation-facing types. Everything in core/sim is pure TypeScript:
 * no Angular, no DI, no signals, no Date.now(). Time always arrives
 * as an argument.
 */
import { Fullness, Millis } from '../domain/types';

/** Two-compartment state: ethanol still in the gut, and blood concentration. */
export interface SimState {
  /** Ethanol not yet absorbed, grams. */
  gutGrams: number;
  /** Blood alcohol concentration, ‰ (promille). */
  bac: number;
}

export const ZERO_STATE: SimState = { gutGrams: 0, bac: 0 };

/** A quantity of ethanol entering the gut at a moment. */
export interface DrinkEvent {
  atMs: Millis;
  grams: number;
}

/** Food entering the stomach — the only channel through which food touches the model. */
export interface FoodEvent {
  atMs: Millis;
  fullness: Fullness;
}

export interface CurvePoint {
  atMs: Millis;
  bac: number;
  gutGrams: number;
}
