/** /plan/event/:eventId — the days of one festival/trip. */
import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PaceStore } from '../../core/state/pace-store';
import { fmtDate, fmtPermille, fmtTime } from '../../core/util/format';

@Component({
  selector: 'app-event-page',
  imports: [RouterLink],
  template: `
    <p><a routerLink="/plan" class="muted">← All events</a></p>
    <h1>{{ eventName() }}</h1>

    @if (days().length === 0) {
      <p class="muted">No days yet — add the first one.</p>
    } @else {
      <div class="grid">
        @for (day of days(); track day.id; let i = $index) {
          <a class="card daycard" [routerLink]="['/plan', day.id]">
            <h3>Day {{ i + 1 }} · {{ fmtDate(day.dateMs) }}</h3>
            <p class="muted">
              @for (a of day.anchors; track a.id) {
                <span>{{ fmtTime(a.atMs) }} {{ a.label }} · </span>
              }
            </p>
            <p>ceiling {{ fmtPermille(day.ceilingPermille) }} · budget ≤ {{ day.dailyBudget }} drinks</p>
          </a>
        }
      </div>
    }

    <div class="actions">
      <button class="btn-primary" (click)="addDay()">+ Add day</button>
      <button (click)="applyStandard()" title="Fill every day with the standard festival day">
        📋 Standard festival days
      </button>
      <button class="danger" (click)="removeEvent()">Delete event</button>
    </div>
    <p class="muted">
      Standard festival day: meals and water on the clock, a lift roughly every 3 hours — the
      first sized to reach the day's ceiling, later ones topping up after partial decay. Sized to
      your profile; each day's own ceiling/trough is used.
    </p>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 0.75rem;
    }
    .daycard {
      color: inherit;
      text-decoration: none;
      display: block;
    }
    .daycard:hover {
      border-color: var(--accent);
    }
    .actions {
      margin-top: 1rem;
      display: flex;
      gap: 0.6rem;
    }
    .danger {
      border-color: #a33;
      color: #e88;
    }
  `,
})
export class EventPage {
  private readonly store = inject(PaceStore);
  private readonly router = inject(Router);

  /** Route param, bound via withComponentInputBinding. */
  readonly eventId = input.required<string>();

  readonly fmtDate = fmtDate;
  readonly fmtTime = fmtTime;
  readonly fmtPermille = fmtPermille;

  readonly eventName = computed(
    () => this.store.events().find((e) => e.id === this.eventId())?.name ?? 'Event',
  );

  readonly days = computed(() =>
    this.store
      .plan()
      .filter((d) => d.eventId === this.eventId())
      .sort((a, b) => a.dateMs - b.dateMs),
  );

  addDay(): void {
    this.store.addDayToEvent(this.eventId());
  }

  applyStandard(): void {
    this.store.applyStandardFestivalToEvent(this.eventId());
  }

  removeEvent(): void {
    this.store.removeEvent(this.eventId());
    void this.router.navigateByUrl('/plan');
  }
}
