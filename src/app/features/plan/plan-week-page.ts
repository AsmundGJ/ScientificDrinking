/**
 * /plan — events overview. An event is a festival/trip (e.g. "Smukfest,
 * Aug 2–9"); clicking one opens its days. Planning mode: sober, laptop.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PaceStore } from '../../core/state/pace-store';
import { genstande, maintenanceGramsPerHour } from '../../core/sim/drinks';
import { shareUrl } from '../../core/share/plan-codec';
import { fmtDate } from '../../core/util/format';

@Component({
  selector: 'app-plan-week-page',
  imports: [FormsModule, RouterLink],
  template: `
    <h1>Events</h1>

    <!-- The gap nobody believes until they see it plotted. -->
    <p class="muted">
      Your sustainable ceiling: {{ maintenance().gPerH.toFixed(1) }} g/h ≈
      {{ maintenance().genstandePerH.toFixed(2) }} genstande/h — one small beer every
      ~{{ maintenance().minutesPerGenstand.toFixed(0) }} minutes, indefinitely. Everything above that
      accumulates. Plans spend that headroom where it matters.
    </p>

    @if (eventCards().length === 0) {
      <div class="card">
        <p>No events yet. Add a festival below, or generate a quick 7-day one.</p>
        <button class="btn-primary" (click)="generate()">Generate default week</button>
      </div>
    } @else {
      <div class="grid">
        @for (ev of eventCards(); track ev.id) {
          <a class="card evcard" [routerLink]="['/plan/event', ev.id]">
            <h3>{{ ev.name }}</h3>
            <p class="muted">{{ ev.range }}</p>
            <p>{{ ev.dayCount }} day(s)</p>
          </a>
        }
      </div>
    }

    <div class="card addform">
      <h3>Add event</h3>
      <div class="row">
        <label>Name <input [(ngModel)]="newName" placeholder="Smukfest" /></label>
        <label>From <input type="date" [(ngModel)]="newFrom" /></label>
        <label>To <input type="date" [(ngModel)]="newTo" /></label>
        <button class="btn-primary" (click)="addEvent()">Add event</button>
      </div>
      <p class="muted">One day is created per date — open the event to tune each day.</p>
    </div>

    @if (plan().length > 0) {
      <div class="actions">
        <button (click)="share()">{{ copied() ? 'Link copied ✓' : 'Share all plans (URL, no server)' }}</button>
      </div>
    }
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 0.75rem;
    }
    .evcard {
      color: inherit;
      text-decoration: none;
      display: block;
    }
    .evcard:hover {
      border-color: var(--accent);
    }
    .addform {
      margin-top: 1rem;
    }
    .row {
      display: flex;
      gap: 0.75rem;
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .row label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .actions {
      margin-top: 1rem;
    }
  `,
})
export class PlanWeekPage {
  private readonly store = inject(PaceStore);

  readonly plan = this.store.plan;
  readonly copied = signal(false);

  newName = '';
  newFrom = '';
  newTo = '';

  readonly maintenance = computed(() => {
    const gPerH = maintenanceGramsPerHour(this.store.profile());
    const genstandePerH = genstande(gPerH);
    return { gPerH, genstandePerH, minutesPerGenstand: 60 / genstandePerH };
  });

  readonly eventCards = computed(() =>
    this.store.events().map((ev) => {
      const days = this.store
        .plan()
        .filter((d) => d.eventId === ev.id)
        .sort((a, b) => a.dateMs - b.dateMs);
      const first = days[0];
      const last = days[days.length - 1];
      return {
        id: ev.id,
        name: ev.name,
        dayCount: days.length,
        range: first && last ? `${fmtDate(first.dateMs)} – ${fmtDate(last.dateMs)}` : 'no days yet',
      };
    }),
  );

  addEvent(): void {
    const from = this.parseDate(this.newFrom);
    if (from === null) return;
    const to = this.parseDate(this.newTo) ?? from;
    this.store.addEvent(this.newName, Math.min(from, to), Math.max(from, to));
    this.newName = '';
    this.newFrom = '';
    this.newTo = '';
  }

  private parseDate(value: string): number | null {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d).getTime(); // local midnight
  }

  generate(): void {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    this.store.generateDefaultWeek(start.getTime());
  }

  /** Share the plan, never the profile — a friend sees THEIR curve for YOUR plan. */
  share(): void {
    void navigator.clipboard.writeText(shareUrl(location.origin, this.plan())).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }
}
