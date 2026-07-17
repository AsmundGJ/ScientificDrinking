import { inject } from '@angular/core';
import { RedirectCommand, ResolveFn, Router } from '@angular/router';
import { DayPlan } from '../../core/domain/types';
import { PaceStore } from '../../core/state/pace-store';

/** Waits for persistence, then hands the day to the route (or bounces to /plan). */
export const dayPlanResolver: ResolveFn<DayPlan | RedirectCommand> = async (route) => {
  const store = inject(PaceStore);
  const router = inject(Router);
  await store.ready;
  const day = store.plan().find((d) => d.id === route.paramMap.get('dayId'));
  return day ?? new RedirectCommand(router.parseUrl('/plan'));
};
