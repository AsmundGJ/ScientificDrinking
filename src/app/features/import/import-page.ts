/**
 * /import — receives a shared plan from the URL fragment. Fragments never
 * hit a server; this works offline. The payload is the plan only — the
 * curve you'll see is computed from YOUR profile.
 */
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DayPlan } from '../../core/domain/types';
import { planFromFragment } from '../../core/share/plan-codec';
import { PaceStore } from '../../core/state/pace-store';
import { fmtDate } from '../../core/util/format';

@Component({
  selector: 'app-import-page',
  template: `
    <h1>Import plan</h1>
    @if (incoming(); as plan) {
      <div class="card">
        <p>
          Incoming plan: <strong>{{ plan.length }} day(s)</strong>,
          {{ fmtDate(plan[0]!.dateMs) }} – {{ fmtDate(plan[plan.length - 1]!.dateMs) }}.
        </p>
        <p class="muted">
          This link contains only the plan — anchors, ceilings, budgets. It will render through
          <em>your</em> weight and metabolism, so your curve will differ from the sender's.
          Days of yours that already started are kept unchanged.
        </p>
        <button class="btn-primary" (click)="accept(plan)">Accept plan</button>
      </div>
    } @else {
      <div class="card">
        <p>No readable plan in this link.</p>
        <p class="muted">Expected a URL like <code>/import#p=…</code> from the share button on /plan.</p>
      </div>
    }
  `,
})
export class ImportPage {
  private readonly store = inject(PaceStore);
  private readonly router = inject(Router);

  readonly fmtDate = fmtDate;
  readonly incoming = signal<DayPlan[] | null>(
    planFromFragment(typeof location === 'undefined' ? null : location.hash.replace(/^#/, '')),
  );

  accept(plan: DayPlan[]): void {
    // Arrives as its own event alongside whatever is already planned.
    this.store.importPlan(plan);
    void this.router.navigateByUrl('/plan');
  }
}
