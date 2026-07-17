/**
 * /plan/:dayId — day detail + editor. The 24 h graph has ←/→ arrows on
 * both sides to step through the event's days; the curve carries state
 * over from the previous day (waking up a little drunk is modelled, not
 * reset). Under the graph: the day's events as a time-sorted, editable
 * list — anchors, meals, hydration, sleep, ceilings.
 */
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Anchor, DayPlan, MealTemplate, Millis } from '../../core/domain/types';
import { MS_PER_DAY, MS_PER_HOUR } from '../../core/sim/constants';
import { standardFestivalDay } from '../../core/sim/planner';
import { projectIntentWeek, typicalDrinkGrams } from '../../core/sim/projection';
import { wellnessProjection } from '../../core/sim/wellness';
import { PaceStore } from '../../core/state/pace-store';
import {
  dayTimeToMs,
  fmtDate,
  fmtPermille,
  fmtTime,
  msToTimeInput,
  sleepRangeToMs,
  uid,
} from '../../core/util/format';
import { CurvePanel, TimelineMeal } from './curve-panel';

interface AnchorRow {
  kind: 'anchor';
  id: string;
  time: string;
  label: string;
  units: number;
}
interface MealRow {
  kind: 'meal';
  time: string;
  templateId: string;
}
interface HydrateRow {
  kind: 'hydrate';
  time: string;
  ml: number;
}
type EvRow = AnchorRow | MealRow | HydrateRow;

@Component({
  selector: 'app-plan-day-page',
  imports: [FormsModule, RouterLink, CurvePanel],
  template: `
    @if (day(); as day) {
      <p>
        <a [routerLink]="backLink()" class="muted">← {{ eventName() }}</a>
      </p>
      <h1>{{ fmtDate(day.dateMs) }}</h1>
      <p class="muted">
        ceiling {{ fmtPermille(view().ceiling) }} · trough {{ fmtPermille(day.minTroughPermille) }} ·
        budget ≤ {{ day.dailyBudget }} drinks · {{ view().planned.length }} drinks ahead
      </p>

      <div class="graphrow">
        <button class="arrow" [disabled]="!prevId()" (click)="go(prevId())" aria-label="Previous day">←</button>
        <div class="card grow">
          <!-- 08:00 → 08:00: the night and the next morning are part of the story. -->
          <app-curve-panel
            [startMs]="day.dateMs + eightAmMs"
            [endMs]="day.dateMs + eightAmMs + dayMs"
            [days]="store.plan()"
            [mealTemplates]="store.mealTemplates()"
            [past]="view().past"
            [future]="view().future"
            [intent]="view().intent"
            [nowMs]="view().nowMs"
            [ceiling]="view().ceiling"
            [trough]="day.minTroughPermille"
            [plannedDrinkTimes]="view().planned"
            [log]="store.log()"
            [wellnessPast]="wellness().past"
            [wellnessFuture]="wellness().future"
            (mealClick)="selectedMeal.set($event)"
          />
        </div>
        <button class="arrow" [disabled]="!nextId()" (click)="go(nextId())" aria-label="Next day">→</button>
      </div>

      @if (selectedMeal(); as m) {
        <div class="card detail">
          <h3>{{ fmtTime(m.atMs) }} — {{ m.label }}</h3>
          @if (templateFor(m.templateId); as t) {
            <p class="muted">
              {{ t.fullness }} · {{ t.macros.kcal }} kcal / {{ t.macros.proteinG }} g protein
            </p>
            <!-- Inline retro-logging: tap a planned event → "did this". -->
            <button (click)="didThis(m, t)">Did this</button>
          }
          <button (click)="selectedMeal.set(null)">Close</button>
        </div>
      }

      <!-- The editable, time-sorted event list. -->
      <div class="card">
        <h3>Day schedule</h3>
        @if (started()) {
          <p class="muted">
            This day has started: everything stays editable, but ceiling and budget can only be
            lowered — the planner can't be talked into more headroom mid-day.
          </p>
        }

        @for (row of rows; track $index) {
          <div class="row">
            <input type="time" [(ngModel)]="row.time" />
            @switch (row.kind) {
              @case ('anchor') {
                <span class="tag">anchor</span>
                <input [(ngModel)]="row.label" placeholder="Label" />
                <label>units <input type="number" [(ngModel)]="row.units" min="1" max="12" /></label>
              }
              @case ('meal') {
                <span class="tag meal">meal</span>
                <select [(ngModel)]="row.templateId">
                  @for (t of store.mealTemplates(); track t.id) {
                    <option [value]="t.id">{{ t.label }} ({{ t.fullness }})</option>
                  }
                </select>
              }
              @case ('hydrate') {
                <span class="tag hydrate">hydrate</span>
                <label>ml <input type="number" [(ngModel)]="row.ml" min="100" max="2000" step="100" /></label>
              }
            }
            <span class="spacer"></span>
            <button (click)="removeRow($index)">remove</button>
          </div>
        }

        <div class="row addrow">
          <button (click)="addAnchor()">+ anchor</button>
          <button (click)="addMeal()">+ meal</button>
          <button (click)="addHydrate()">+ hydrate</button>
          <button
            (click)="fillStandardDay()"
            title="Full festival day: meals & water on the clock, a lift every ~3 h sized to your body"
          >
            📋 Standard festival day
          </button>
        </div>

        <div class="row">
          <span class="tag sleep">sleep</span>
          <label>from <input type="time" [(ngModel)]="sleepFrom" /></label>
          <label>wake <input type="time" [(ngModel)]="sleepTo" /></label>
        </div>

        <div class="row">
          <label>ceiling ‰ <input type="number" [(ngModel)]="ceiling" min="0.2" max="1.5" step="0.05" /></label>
          <label>trough ‰ <input type="number" [(ngModel)]="trough" min="0" max="0.6" step="0.05" /></label>
          <label>budget <input type="number" [(ngModel)]="budget" min="0" max="20" /></label>
        </div>

        <div class="row actions">
          <button class="btn-primary" (click)="save()">Save day</button>
          <button (click)="sync()">Discard changes</button>
          <span class="spacer"></span>
          @if (!started()) {
            <button class="danger" (click)="removeDay()">Delete day</button>
          }
        </div>
      </div>

      <div class="card">
        <h3>Planned drinks (derived, replanned on every log)</h3>
        @if (view().planned.length === 0) {
          <p class="muted">Nothing ahead — either the day is done or the ceiling is doing its job.</p>
        } @else {
          <p>
            @for (t of view().planned; track t) {
              <span class="chip">{{ fmtTime(t) }}</span>
            }
          </p>
        }
        <p class="muted">
          Unspent drinks from earlier windows do not reappear. Budget is a ceiling you may come in
          under, never a target you're failing to hit.
        </p>
      </div>
    }
  `,
  styles: `
    .graphrow {
      display: flex;
      gap: 0.5rem;
      align-items: stretch;
    }
    .graphrow .grow {
      flex: 1;
      min-width: 0;
    }
    .arrow {
      font-size: 1.4rem;
      padding: 0 0.6rem;
    }
    .chip {
      display: inline-block;
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0.15rem 0.6rem;
      margin: 0 0.3rem 0.3rem 0;
    }
    .card {
      margin: 0.75rem 0;
    }
    .row {
      display: flex;
      gap: 0.6rem;
      align-items: center;
      flex-wrap: wrap;
      padding: 0.3rem 0;
    }
    .tag {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--accent);
      width: 4rem;
    }
    .tag.meal {
      color: var(--good);
    }
    .tag.hydrate,
    .tag.sleep {
      color: var(--blue);
    }
    .spacer {
      flex: 1;
    }
    .row label {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .row input[type='number'] {
      width: 5rem;
    }
    .danger {
      border-color: #a33;
      color: #e88;
    }
    .detail button {
      margin-right: 0.5rem;
    }
  `,
})
export class PlanDayPage {
  readonly store = inject(PaceStore);
  private readonly router = inject(Router);

  /** Route param, bound via withComponentInputBinding. */
  readonly dayId = input.required<string>();

  readonly day = computed(() => this.store.plan().find((d) => d.id === this.dayId()) ?? null);
  readonly selectedMeal = signal<TimelineMeal | null>(null);
  readonly dayMs = MS_PER_DAY;
  readonly eightAmMs = 8 * MS_PER_HOUR;
  readonly fmtDate = fmtDate;
  readonly fmtTime = fmtTime;
  readonly fmtPermille = fmtPermille;

  // ── Editor working copy (plain fields; committed on Save) ────────────────
  rows: EvRow[] = [];
  sleepFrom = '02:00';
  sleepTo = '09:00';
  ceiling = 0.9;
  trough = 0.3;
  budget = 10;

  constructor() {
    // Resync the working copy whenever the (saved) day changes.
    effect(() => {
      this.day();
      this.sync();
    });
  }

  readonly backLink = computed(() => {
    const ev = this.day()?.eventId;
    return ev ? ['/plan/event', ev] : ['/plan'];
  });

  readonly eventName = computed(() => {
    const ev = this.day()?.eventId;
    return this.store.events().find((e) => e.id === ev)?.name ?? 'All events';
  });

  /** Days of the same event, for ←/→ navigation. */
  private readonly eventDays = computed(() => {
    const ev = this.day()?.eventId;
    return this.store
      .plan()
      .filter((d) => d.eventId === ev)
      .sort((a, b) => a.dateMs - b.dateMs);
  });
  private readonly dayIndex = computed(() => this.eventDays().findIndex((d) => d.id === this.dayId()));
  readonly prevId = computed(() => this.eventDays()[this.dayIndex() - 1]?.id ?? null);
  readonly nextId = computed(() => this.eventDays()[this.dayIndex() + 1]?.id ?? null);

  go(id: string | null): void {
    if (id) void this.router.navigate(['/plan', id]);
  }

  readonly started = computed(() => {
    const d = this.day();
    return d !== null && d.dateMs <= this.store.now();
  });

  private readonly isToday = computed(() => {
    const d = this.day();
    const n = this.store.now();
    return d !== null && n >= d.dateMs && n < d.dateMs + MS_PER_DAY;
  });

  /** The chained intent for the whole plan — days carry state over. */
  private readonly intentWeek = computed(() =>
    projectIntentWeek(
      this.store.plan(),
      this.store.profile(),
      this.store.mealTemplates(),
      typicalDrinkGrams(this.store.state()),
    ),
  );

  /** Hydration + nutrition: truth from the log, forecast from the plan. */
  readonly wellness = computed(() => {
    const day = this.day();
    if (!day) return { past: [], future: [] };
    const now = this.store.now();
    const today = this.store.projection().day;
    const endOfToday = today ? today.dateMs + MS_PER_DAY : now;
    const drinks = [
      ...this.store.projection().plannedDrinkTimes,
      ...this.intentWeek().times.filter((t) => t > endOfToday),
    ];
    return wellnessProjection(
      this.store.state(),
      now,
      day.dateMs + this.eightAmMs + MS_PER_DAY,
      drinks,
      typicalDrinkGrams(this.store.state()),
    );
  });

  readonly view = computed(() => {
    const day = this.day();
    if (!day) return { past: [], future: [], intent: [], nowMs: null, planned: [], ceiling: 0 };
    const intent = this.intentWeek().perDay.get(day.id) ?? { points: [], times: [] };
    if (this.isToday()) {
      const p = this.store.projection();
      return {
        past: p.past,
        future: p.future,
        intent: this.intentWeek().points,
        nowMs: p.nowMs as Millis | null,
        planned: p.plannedDrinkTimes,
        ceiling: p.effectiveCeiling ?? day.ceilingPermille,
      };
    }
    // Not today: the planned level IS the curve (carried over from prior days).
    return {
      past: [],
      future: [],
      intent: this.intentWeek().points,
      nowMs: null,
      planned: intent.times,
      ceiling: day.ceilingPermille,
    };
  });

  templateFor(id: string): MealTemplate | null {
    return this.store.mealTemplates().find((t) => t.id === id) ?? null;
  }

  /** Macros come along for free when the tap matches the planned template. */
  didThis(m: TimelineMeal, t: MealTemplate): void {
    this.store.logFood(t.fullness, t.id, m.atMs);
    this.selectedMeal.set(null);
  }

  // ── Editor ────────────────────────────────────────────────────────────────

  sync(): void {
    const d = this.day();
    if (!d) return;
    const rows: (EvRow & { atMs: Millis })[] = [
      ...d.anchors.map((a) => ({
        kind: 'anchor' as const,
        id: a.id,
        time: msToTimeInput(a.atMs),
        label: a.label,
        units: a.units,
        atMs: a.atMs,
      })),
      ...d.meals.map((m) => ({
        kind: 'meal' as const,
        time: msToTimeInput(m.atMs),
        templateId: m.templateId,
        atMs: m.atMs,
      })),
      ...d.hydrations.map((hy) => ({
        kind: 'hydrate' as const,
        time: msToTimeInput(hy.atMs),
        ml: hy.ml,
        atMs: hy.atMs,
      })),
    ];
    rows.sort((a, b) => a.atMs - b.atMs);
    this.rows = rows;
    this.sleepFrom = msToTimeInput(d.sleep.fromMs);
    this.sleepTo = msToTimeInput(d.sleep.toMs);
    this.ceiling = d.ceilingPermille;
    this.trough = d.minTroughPermille;
    this.budget = d.dailyBudget;
  }

  addAnchor(): void {
    this.rows = [...this.rows, { kind: 'anchor', id: uid(), time: '20:00', label: 'Anchor', units: 2 }];
  }

  addMeal(): void {
    const first = this.store.mealTemplates()[0];
    this.rows = [...this.rows, { kind: 'meal', time: '18:00', templateId: first?.id ?? '' }];
  }

  addHydrate(): void {
    this.rows = [...this.rows, { kind: 'hydrate', time: '21:00', ml: 500 }];
  }

  removeRow(index: number): void {
    this.rows = this.rows.filter((_, i) => i !== index);
  }

  /**
   * The standard festival day: meals and water on the clock, a lift every
   * ~3 h sized to the profile — first lift climbs to the ceiling, later
   * lifts top up whatever the partial decay left. Uses the ceiling/trough
   * currently in the form (e.g. 0.6 / 0.3) — tweak first, then fill.
   */
  fillStandardDay(): void {
    const d = this.day();
    if (!d) return;
    const res = standardFestivalDay(
      d.dateMs,
      dayTimeToMs(d.dateMs, this.sleepFrom, 12),
      this.ceiling,
      this.trough,
      this.store.profile(),
      this.store.mealTemplates(),
      { drinkGrams: typicalDrinkGrams(this.store.state()) },
    );
    const rows: EvRow[] = [
      ...res.anchors.map(
        (a): EvRow => ({ kind: 'anchor', id: uid(), time: msToTimeInput(a.atMs), label: a.label, units: a.units }),
      ),
      ...res.meals.map((m): EvRow => ({ kind: 'meal', time: msToTimeInput(m.atMs), templateId: m.templateId })),
      ...res.hydrations.map((hy): EvRow => ({ kind: 'hydrate', time: msToTimeInput(hy.atMs), ml: hy.ml })),
    ];
    this.rows = rows.sort((a, b) => dayTimeToMs(d.dateMs, a.time) - dayTimeToMs(d.dateMs, b.time));
    this.budget = res.totalPours;
  }

  save(): void {
    const d = this.day();
    if (!d) return;
    const anchors: Anchor[] = [];
    const meals: DayPlan['meals'] = [];
    const hydrations: DayPlan['hydrations'] = [];
    for (const row of this.rows) {
      const atMs = dayTimeToMs(d.dateMs, row.time);
      if (row.kind === 'anchor') {
        anchors.push({ id: row.id, atMs, label: row.label, units: Math.max(1, Math.round(row.units)) });
      } else if (row.kind === 'meal' && row.templateId) {
        meals.push({ atMs, templateId: row.templateId });
      } else if (row.kind === 'hydrate') {
        hydrations.push({ atMs, ml: row.ml });
      }
    }
    anchors.sort((a, b) => a.atMs - b.atMs);
    meals.sort((a, b) => a.atMs - b.atMs);
    hydrations.sort((a, b) => a.atMs - b.atMs);
    this.store.updateDay({
      ...d,
      anchors,
      meals,
      hydrations,
      // "23:00" = tonight, "02:00"/"07:00" = tomorrow; wake wraps to stay after
      // the start, so night-shift sleeps like 07:00 → 14:00 work.
      sleep: sleepRangeToMs(d.dateMs, this.sleepFrom, this.sleepTo),
      ceilingPermille: this.ceiling,
      minTroughPermille: this.trough,
      dailyBudget: this.budget,
    });
  }

  removeDay(): void {
    const d = this.day();
    if (!d) return;
    this.store.removeDay(d.id);
    void this.router.navigateByUrl('/plan');
  }
}
