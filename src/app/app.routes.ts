/**
 * Routes split along the seam between two genuinely different contexts:
 * planning mode (home, sober, laptop — wants density) and live mode
 * (17:40, day four, phone at 12%, one hand holding a beer — wants ONE
 * number). /now is the default during the festival; /setup hides behind
 * the gear icon, not the top of the home page.
 */
import { Routes } from '@angular/router';
import { dayPlanResolver } from './features/plan/day-plan-resolver';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'now' },
  {
    path: 'now',
    loadComponent: () => import('./features/now/now-page').then((m) => m.NowPage),
  },
  {
    path: 'plan',
    loadComponent: () => import('./features/plan/plan-week-page').then((m) => m.PlanWeekPage),
  },
  {
    path: 'plan/event/:eventId',
    loadComponent: () => import('./features/plan/event-page').then((m) => m.EventPage),
  },
  {
    path: 'plan/:dayId',
    loadComponent: () => import('./features/plan/plan-day-page').then((m) => m.PlanDayPage),
    resolve: { day: dayPlanResolver },
  },
  {
    path: 'setup',
    loadComponent: () => import('./features/setup/setup-page').then((m) => m.SetupPage),
  },
  {
    path: 'import',
    loadComponent: () => import('./features/import/import-page').then((m) => m.ImportPage),
  },
  { path: '**', redirectTo: 'now' },
];
