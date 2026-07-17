/** Seed data so the app is usable before /setup has ever been visited. */
import { AppState, DrinkPreset, MealTemplate, Profile } from '../domain/types';
import { DEFAULT_BETA } from '../sim/constants';
import { watsonR } from '../sim/watson';

const body = { sex: 'male' as const, age: 25, heightCm: 180, weightKg: 80 };

export const DEFAULT_PROFILE: Profile = {
  ...body,
  r: watsonR(body),
  beta: DEFAULT_BETA,
};

/**
 * A cooler, not a search box: you drink the same three things for seven
 * days. The FIRST preset is the standard drink — it's the big button on
 * /now and the pour the planner plans in until the log says otherwise.
 * Default standard: a normal 33 cl can at 4.6% ≈ exactly 1 unit.
 */
export const DEFAULT_PRESETS: DrinkPreset[] = [
  { id: 'tuborg33', label: 'Tuborg 33', volumeMl: 330, abv: 4.6, emoji: '🍺' },
  { id: 'fadol50', label: 'Fadøl 50', volumeMl: 500, abv: 4.6, emoji: '🍻' },
  { id: 'cider33', label: 'Cider 33', volumeMl: 330, abv: 4.5, emoji: '🍏' },
];

export const DEFAULT_MEAL_TEMPLATES: MealTemplate[] = [
  {
    id: 'rugbrod-tun',
    label: 'Rugbrød med tun',
    fullness: 'meal',
    macros: { kcal: 620, proteinG: 38, carbsG: 55, fatG: 24 },
  },
  {
    id: 'festival-burger',
    label: 'Festival burger',
    fullness: 'big',
    macros: { kcal: 950, proteinG: 35, carbsG: 80, fatG: 50 },
  },
  {
    id: 'musli-bar',
    label: 'Müslibar',
    fullness: 'snack',
    macros: { kcal: 180, proteinG: 5, carbsG: 25, fatG: 7 },
  },
];

export const EMPTY_STATE: AppState = {
  profile: DEFAULT_PROFILE,
  presets: DEFAULT_PRESETS,
  mealTemplates: DEFAULT_MEAL_TEMPLATES,
  events: [],
  plan: [],
  log: [],
};
