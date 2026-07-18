/**
 * /now — live mode. One huge number, the INCOMING line, fat log buttons.
 * Logging lives HERE, not on its own route.
 *
 * Corrections: taps log instantly (undo, never confirm), and the day's
 * entries are listed below with full edit (time, size, ABV, fraction) and
 * remove — a wrong tap should never be permanent.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DrinkPreset, Fullness, LogEntry } from '../../core/domain/types';
import { MS_PER_DAY, MS_PER_HOUR } from '../../core/sim/constants';
import { gramsForLoggedDrink } from '../../core/sim/drinks';
import { dayPlanFor, projectIntentWeek, typicalDrinkGrams } from '../../core/sim/projection';
import { wellnessProjection } from '../../core/sim/wellness';
import { PaceStore } from '../../core/state/pace-store';
import { fmtPermille, fmtTime, msToTimeInput, withTimeFromInput } from '../../core/util/format';
import { CurvePanel } from '../plan/curve-panel';

interface UndoState {
  id: string;
  label: string;
  kind: 'drink' | 'food' | 'water' | 'sleep';
}

/** Editable working copy of a log entry (selects carry strings). */
interface EditDraft {
  id: string;
  kind: LogEntry['kind'];
  time: string;
  volumeMl: number;
  abv: number;
  fraction: string;
  fullness: Fullness;
  ml: number;
  electrolytes: boolean;
  rating: string;
  sleepFrom: string;
  sleepTo: string;
}

@Component({
  selector: 'app-now-page',
  imports: [FormsModule, CurvePanel],
  template: `
    <section class="now">
      <div class="hero card">
        <div class="bigrow">
          <span class="bac">{{ bacText() }}</span>
          <span class="trend" [class.rising]="proj().trend === 'rising'">
            {{ trendArrow() }} {{ proj().trend }}
          </span>
        </div>

        <dl class="stats">
          <div class="stat incoming">
            <dt>Incoming</dt>
            <dd>
              +{{ incomingText() }}
              <span class="muted">· {{ proj().incomingGrams.toFixed(0) }} g in your stomach</span>
            </dd>
          </div>
          <div class="stat">
            <dt>Peak</dt>
            <dd>{{ peakText() }}</dd>
          </div>
          <div class="stat">
            <dt>Next lift</dt>
            <dd>{{ nextLiftText() }}</dd>
          </div>
        </dl>

        <!-- Capacity, never debt: same data as "2 behind schedule", opposite behaviour. -->
        <p class="capacity">{{ capacityText() }}</p>
        @if (lastCallText(); as lc) {
          <p class="muted">Drink after {{ lc }} and you wake up impaired.</p>
        }
        @if (lateFestivalNote()) {
          <p class="muted">You're at your day-1 BAC. The difference is sleep, not alcohol.</p>
        }
      </div>

      <!-- Feel: one tap, 1–5. On day five this is what makes the number credible. -->
      <div class="feelrow">
        <span class="muted">Feel</span>
        @for (n of ratings; track n) {
          <button class="feel" (click)="logFeel(n)">{{ n }}</button>
        }
      </div>

      <!-- Log the pour, not the finish. Undo, never confirm. -->
      <div class="logbar">
        @if (topPreset(); as top) {
          <button class="btn-big btn-primary" (click)="logDrink(top)">+1 {{ top.emoji }}</button>
        }
        <button class="btn-big" (click)="logWater()">+ water</button>
        <button class="btn-big" (click)="logElectrolyteWater()">+ water ⚡</button>
        <button class="btn-big" (click)="foodOpen.set(!foodOpen())">+ food</button>
        <button class="btn-big" (click)="sleepOpen.set(!sleepOpen())">+ sleep</button>
      </div>

      @if (sleepOpen()) {
        <div class="logbar sleepform">
          <label>slept from <input type="time" [(ngModel)]="sleepFromInput" /></label>
          <label>woke <input type="time" [(ngModel)]="sleepToInput" /></label>
          <button class="btn-primary" (click)="logSleep()">Log sleep</button>
        </div>
      }

      @if (foodOpen()) {
        <!-- ka is load-bearing and must never cost more than one tap. No database. -->
        <div class="logbar">
          <button class="btn-big" (click)="logFood('snack')">snack</button>
          <button class="btn-big" (click)="logFood('meal')">meal</button>
          <button class="btn-big" (click)="logFood('big')">big meal</button>
        </div>
      }

      @if (restPresets().length > 0) {
        <div class="presetrow">
          @for (p of restPresets(); track p.id) {
            <button (click)="logDrink(p)">{{ p.emoji }} {{ p.label }}</button>
          }
        </div>
      }

      <!-- Today's log: timestamps, edit sizes/ABV/fraction, remove. -->
      <div class="card loglist">
        <h3>Logged</h3>
        @if (rows().length === 0) {
          <p class="muted">Nothing logged yet.</p>
        }
        @for (row of rows(); track row.entry.id) {
          @if (editing()?.id === row.entry.id && editing(); as e) {
            <div class="row editrow">
              <input type="time" [(ngModel)]="e.time" />
              @switch (e.kind) {
                @case ('drink') {
                  <label>ml <input type="number" [(ngModel)]="e.volumeMl" min="10" max="2000" /></label>
                  <label>ABV % <input type="number" [(ngModel)]="e.abv" min="0" max="96" step="0.1" /></label>
                  <label>
                    drank
                    <select [(ngModel)]="e.fraction">
                      <option value="0.25">25%</option>
                      <option value="0.5">50%</option>
                      <option value="0.75">75%</option>
                      <option value="1">100%</option>
                    </select>
                  </label>
                }
                @case ('food') {
                  <select [(ngModel)]="e.fullness">
                    <option value="snack">snack</option>
                    <option value="meal">meal</option>
                    <option value="big">big</option>
                  </select>
                }
                @case ('water') {
                  <label>ml <input type="number" [(ngModel)]="e.ml" min="0" max="3000" step="100" /></label>
                  <label><input type="checkbox" [(ngModel)]="e.electrolytes" /> electrolytes</label>
                }
                @case ('feel') {
                  <select [(ngModel)]="e.rating">
                    @for (n of ratings; track n) {
                      <option [value]="n">{{ n }}</option>
                    }
                  </select>
                }
                @case ('sleep') {
                  <label>from <input type="time" [(ngModel)]="e.sleepFrom" /></label>
                  <label>woke <input type="time" [(ngModel)]="e.sleepTo" /></label>
                }
              }
              <span class="spacer"></span>
              <button class="btn-primary" (click)="saveEdit()">Save</button>
              <button (click)="editing.set(null)">Cancel</button>
            </div>
          } @else {
            <div class="row">
              <span class="when">{{ fmtTime(row.atMs) }}</span>
              <span class="what">{{ row.label }}</span>
              <span class="muted detail">{{ row.detail }}</span>
              <span class="spacer"></span>
              <button class="small" (click)="startEdit(row.entry)">edit</button>
              <button class="small x" (click)="remove(row.entry.id)" aria-label="Remove">✕</button>
            </div>
          }
        }
      </div>

      <!-- Where you are, where you're headed, and the line you planned.
           One continuous curve — pan back to see yesterday carry over. -->
      <div class="graphrow">
        <button class="arrow" (click)="pan(-1)" aria-label="Back in time">←</button>
        <div class="card grow">
          <app-curve-panel
            [startMs]="window().startMs"
            [endMs]="window().endMs"
            [days]="store.plan()"
            [mealTemplates]="store.mealTemplates()"
            [past]="proj().past"
            [future]="proj().future"
            [intent]="intentPoints()"
            [nowMs]="proj().nowMs"
            [ceiling]="proj().effectiveCeiling"
            [trough]="proj().day?.minTroughPermille ?? null"
            [plannedDrinkTimes]="proj().plannedDrinkTimes"
            [log]="store.log()"
            [wellnessPast]="wellness().past"
            [wellnessFuture]="wellness().future"
          />
          @if (panOffset() !== 0) {
            <button class="backtonow" (click)="panOffset.set(0)">back to now</button>
          }
        </div>
        <button class="arrow" (click)="pan(1)" aria-label="Forward in time">→</button>
      </div>

      @if (undoState(); as u) {
        <div class="snackbar">
          <span>{{ u.label }}</span>
          <button (click)="scrub(-15)">−15m</button>
          <button (click)="scrub(-30)">−30m</button>
          @if (u.kind === 'drink') {
            <button (click)="fraction(u.id, 0.5)" title="Didn't finish it">½</button>
          }
          <button class="btn-primary" (click)="undoTap()">UNDO</button>
        </div>
      }
    </section>
  `,
  styles: `
    .bigrow {
      display: flex;
      align-items: baseline;
      gap: 1rem;
    }
    .bac {
      font-size: 4.5rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .trend {
      color: var(--dim);
      font-size: 1.25rem;
    }
    .trend.rising {
      color: var(--accent);
    }
    .stats {
      display: grid;
      gap: 0.4rem;
      margin: 0.75rem 0 0;
    }
    .stat {
      display: flex;
      gap: 0.75rem;
      align-items: baseline;
    }
    dt {
      width: 6.5rem;
      color: var(--dim);
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.06em;
    }
    dd {
      margin: 0;
      font-size: 1.1rem;
    }
    .incoming dd {
      color: var(--accent);
      font-weight: 600;
    }
    .capacity {
      color: var(--good);
    }
    .feelrow {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      margin: 1rem 0;
    }
    .feel {
      width: 2.5rem;
    }
    .logbar {
      display: flex;
      gap: 0.6rem;
      margin-top: 0.75rem;
    }
    @media (max-width: 640px) {
      .logbar {
        flex-wrap: wrap;
      }
      .logbar .btn-big {
        flex: 1 1 40%;
      }
      .bac {
        font-size: 3.4rem;
      }
    }
    .presetrow {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.75rem;
      flex-wrap: wrap;
    }
    .sleepform {
      align-items: center;
    }
    .sleepform label {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .graphrow {
      display: flex;
      gap: 0.5rem;
      align-items: stretch;
      margin-top: 1rem;
    }
    .graphrow .grow {
      flex: 1;
      min-width: 0;
      margin-top: 0;
      position: relative;
    }
    .arrow {
      font-size: 1.4rem;
      padding: 0 0.6rem;
    }
    .backtonow {
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      font-size: 0.8rem;
    }
    /* Must come AFTER the base .graphrow rules: equal specificity,
       source order decides. Arrows move UNDER the graph on phones. */
    @media (max-width: 640px) {
      .graphrow {
        flex-wrap: wrap;
        gap: 0.3rem;
      }
      .graphrow .grow {
        order: -1;
        flex: 1 1 100%;
      }
      .graphrow .arrow {
        flex: 1;
        padding: 0.4rem 0;
      }
    }
    .card {
      margin-top: 1rem;
    }
    .loglist .row {
      display: flex;
      gap: 0.6rem;
      align-items: center;
      padding: 0.35rem 0;
      border-bottom: 1px solid var(--line);
      flex-wrap: wrap;
    }
    .loglist .row:last-child {
      border-bottom: none;
    }
    .when {
      font-variant-numeric: tabular-nums;
      color: var(--dim);
      width: 3.2rem;
      flex-shrink: 0;
    }
    .detail {
      font-size: 0.8rem;
    }
    .spacer {
      flex: 1;
    }
    .small {
      padding: 0.3rem 0.55rem;
      font-size: 0.85rem;
    }
    .small.x {
      color: var(--dim);
    }
    .editrow label {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      white-space: nowrap;
    }
    .editrow input[type='number'] {
      width: 4.2rem;
      padding: 0.35rem 0.35rem;
    }
  `,
})
export class NowPage {
  readonly store = inject(PaceStore);

  readonly proj = this.store.projection;
  readonly foodOpen = signal(false);
  readonly sleepOpen = signal(false);
  /** Graph pan, in 12 h steps. 0 = centred on now. */
  readonly panOffset = signal(0);
  sleepFromInput = '02:00';
  sleepToInput = '09:00';
  readonly undoState = signal<UndoState | null>(null);
  readonly editing = signal<EditDraft | null>(null);
  readonly ratings = [1, 2, 3, 4, 5] as const;
  readonly fmtTime = fmtTime;
  private undoTimer: ReturnType<typeof setTimeout> | null = null;

  /** Six presets max, ordered by frequency of use this week — the cooler sorts itself. */
  private readonly presetsByUse = computed(() => {
    const counts = new Map<string, number>();
    for (const e of this.store.log()) {
      if (e.kind === 'drink') counts.set(e.presetId, (counts.get(e.presetId) ?? 0) + 1);
    }
    return [...this.store.presets()].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  });
  readonly topPreset = computed(() => this.presetsByUse()[0] ?? null);
  readonly restPresets = computed(() => this.presetsByUse().slice(1));

  readonly bacText = computed(() => fmtPermille(this.proj().current.bac));
  readonly trendArrow = computed(
    () => ({ rising: '↗', falling: '↘', holding: '→' })[this.proj().trend],
  );
  readonly incomingText = computed(() => fmtPermille(this.proj().incomingPermille));

  readonly peakText = computed(() => {
    const p = this.proj();
    return p.peakAtMs > p.nowMs
      ? `${fmtPermille(p.peakPermille)} at ${fmtTime(p.peakAtMs)}`
      : `${fmtPermille(p.peakPermille)} — behind you`;
  });

  readonly nextLiftText = computed(() => {
    const a = this.proj().nextAnchor;
    return a ? `${fmtTime(a.atMs)} (${a.label})` : '—';
  });

  readonly capacityText = computed(() => {
    const p = this.proj();
    if (p.effectiveCeiling === null) return 'No plan for today — set one up under Plan.';
    const room = p.roomForOneNow ? 'room for 1 now' : 'no room right now — the trough is part of the plan';
    const next = p.nextPlannedDrinkMs ? `, next at ${fmtTime(p.nextPlannedDrinkMs)}` : '';
    return `${room}${next}`;
  });

  readonly lastCallText = computed(() => {
    const p = this.proj();
    return p.lastCallMs && p.lastCallMs > p.nowMs ? fmtTime(p.lastCallMs) : null;
  });

  /** Day 4+: felt-vs-actual has quietly diverged; say it out loud. */
  readonly lateFestivalNote = computed(() => {
    const found = dayPlanFor(this.store.plan(), this.store.now());
    return found !== null && found.index >= 3 && this.proj().current.bac > 0.2;
  });

  // ── Graph ─────────────────────────────────────────────────────────────────

  readonly window = computed(() => {
    const offset = this.panOffset() * 12 * MS_PER_HOUR;
    const day = this.proj().day;
    // 08:00 → 08:00: the night and the next morning are part of the story.
    if (day) {
      const eight = day.dateMs + 8 * MS_PER_HOUR;
      return { startMs: eight + offset, endMs: eight + MS_PER_DAY + offset };
    }
    const now = this.store.now();
    return { startMs: now - 6 * MS_PER_HOUR + offset, endMs: now + 12 * MS_PER_HOUR + offset };
  });

  pan(direction: number): void {
    this.panOffset.update((n) => n + direction);
  }

  /** Planned level, chained across every planned day — continuous while panning. */
  private readonly intentWeek = computed(() =>
    projectIntentWeek(
      this.store.plan(),
      this.store.profile(),
      this.store.mealTemplates(),
      typicalDrinkGrams(this.store.state()),
    ),
  );
  readonly intentPoints = computed(() => this.intentWeek().points);

  /** Hydration + nutrition: truth from the log, forecast from the plan. */
  readonly wellness = computed(() => {
    const now = this.store.now();
    const day = this.proj().day;
    const endOfToday = day ? day.dateMs + MS_PER_DAY : now;
    const drinks = [
      ...this.proj().plannedDrinkTimes,
      ...this.intentWeek().times.filter((t) => t > endOfToday),
    ];
    return wellnessProjection(
      this.store.state(),
      now,
      this.window().endMs,
      drinks,
      typicalDrinkGrams(this.store.state()),
    );
  });

  logSleep(): void {
    const now = this.store.now();
    let toMs = withTimeFromInput(now, this.sleepToInput);
    if (toMs > now) toMs -= MS_PER_DAY;
    let fromMs = withTimeFromInput(toMs, this.sleepFromInput);
    if (fromMs >= toMs) fromMs -= MS_PER_DAY;
    this.store.logSleep(fromMs, toMs);
    this.sleepOpen.set(false);
  }

  // ── Log list ──────────────────────────────────────────────────────────────

  readonly rows = computed(() => {
    const since = this.window().startMs;
    const presets = this.store.presets();
    return this.store
      .log()
      .map((entry) => {
        const atMs = 'atMs' in entry ? entry.atMs : entry.fromMs;
        return { entry, atMs, ...this.describe(entry, presets) };
      })
      .filter((r) => r.atMs >= since)
      .sort((a, b) => b.atMs - a.atMs);
  });

  private describe(entry: LogEntry, presets: readonly DrinkPreset[]): { label: string; detail: string } {
    switch (entry.kind) {
      case 'drink': {
        const preset = presets.find((p) => p.id === entry.presetId);
        const volumeMl = entry.volumeMl ?? preset?.volumeMl;
        const abv = entry.abv ?? preset?.abv;
        const grams = gramsForLoggedDrink(entry, presets);
        return {
          label: `${preset?.emoji ?? '🥃'} ${preset?.label ?? 'Drink'}`,
          detail: `${volumeMl ?? '?'} ml @ ${abv ?? '?'}% · ${entry.fraction * 100}% · ${grams.toFixed(0)} g`,
        };
      }
      case 'food':
        return { label: `🍽 ${entry.fullness}`, detail: entry.templateId ?? '' };
      case 'water':
        return { label: '💧 water', detail: `${entry.ml} ml${entry.electrolytes ? ' + electrolytes' : ''}` };
      case 'sleep':
        return { label: '😴 sleep', detail: `until ${fmtTime(entry.toMs)}` };
      case 'feel':
        return { label: `feel ${entry.rating}/5`, detail: '' };
    }
  }

  startEdit(entry: LogEntry): void {
    const presets = this.store.presets();
    const preset = entry.kind === 'drink' ? presets.find((p) => p.id === entry.presetId) : undefined;
    this.editing.set({
      id: entry.id,
      kind: entry.kind,
      time: msToTimeInput('atMs' in entry ? entry.atMs : entry.fromMs),
      volumeMl: entry.kind === 'drink' ? (entry.volumeMl ?? preset?.volumeMl ?? 330) : 330,
      abv: entry.kind === 'drink' ? (entry.abv ?? preset?.abv ?? 4.6) : 4.6,
      fraction: entry.kind === 'drink' ? String(entry.fraction) : '1',
      fullness: entry.kind === 'food' ? entry.fullness : 'meal',
      ml: entry.kind === 'water' ? entry.ml : 500,
      electrolytes: entry.kind === 'water' ? entry.electrolytes : false,
      rating: entry.kind === 'feel' ? String(entry.rating) : '3',
      sleepFrom: entry.kind === 'sleep' ? msToTimeInput(entry.fromMs) : '02:00',
      sleepTo: entry.kind === 'sleep' ? msToTimeInput(entry.toMs) : '09:00',
    });
  }

  saveEdit(): void {
    const e = this.editing();
    if (!e) return;
    const original = this.store.log().find((x) => x.id === e.id);
    if (!original) {
      this.editing.set(null);
      return;
    }
    if (original.kind === 'sleep') {
      let toMs = withTimeFromInput(original.toMs, e.sleepTo);
      let fromMs = withTimeFromInput(toMs, e.sleepFrom);
      if (fromMs >= toMs) fromMs -= MS_PER_DAY;
      this.store.updateEntry({ ...original, fromMs, toMs });
      this.editing.set(null);
      return;
    }
    const atMs = withTimeFromInput(original.atMs, e.time);
    let updated: LogEntry;
    switch (original.kind) {
      case 'drink':
        updated = {
          ...original,
          atMs,
          volumeMl: e.volumeMl,
          abv: e.abv,
          fraction: Number(e.fraction) as 0.25 | 0.5 | 0.75 | 1,
        };
        break;
      case 'food':
        updated = { ...original, atMs, fullness: e.fullness };
        break;
      case 'water':
        updated = { ...original, atMs, ml: e.ml, electrolytes: e.electrolytes };
        break;
      case 'feel':
        updated = { ...original, atMs, rating: Number(e.rating) as 1 | 2 | 3 | 4 | 5 };
        break;
    }
    this.store.updateEntry(updated);
    this.editing.set(null);
  }

  remove(id: string): void {
    this.store.removeEntry(id);
    if (this.editing()?.id === id) this.editing.set(null);
  }

  // ── Logging ───────────────────────────────────────────────────────────────

  logDrink(preset: DrinkPreset): void {
    const id = this.store.logDrink(preset.id);
    this.showUndo({ id, label: `+1 ${preset.emoji} ${preset.label}`, kind: 'drink' });
  }

  logWater(): void {
    const id = this.store.logWater();
    this.showUndo({ id, label: '+0.5 L water', kind: 'water' });
  }

  logElectrolyteWater(): void {
    const id = this.store.logWater(500, true);
    this.showUndo({ id, label: '+0.5 L water ⚡', kind: 'water' });
  }

  logFood(fullness: Fullness): void {
    this.foodOpen.set(false);
    const id = this.store.logFood(fullness);
    this.showUndo({ id, label: `+ ${fullness}`, kind: 'food' });
  }

  logFeel(rating: number): void {
    this.store.logFeel(rating as 1 | 2 | 3 | 4 | 5);
  }

  undoTap(): void {
    const u = this.undoState();
    if (u) this.store.undo(u.id);
    this.clearUndo();
  }

  /** Default to now, allow scrubbing back — you WILL forget for 20 minutes. */
  scrub(minutes: number): void {
    const u = this.undoState();
    if (u) this.store.shiftEntryTime(u.id, minutes * 60_000);
  }

  fraction(id: string, f: 0.25 | 0.5 | 0.75 | 1): void {
    this.store.setDrinkFraction(id, f);
    this.clearUndo();
  }

  private showUndo(u: UndoState): void {
    this.undoState.set(u);
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = setTimeout(() => this.clearUndo(), 5000);
  }

  private clearUndo(): void {
    this.undoState.set(null);
  }
}
