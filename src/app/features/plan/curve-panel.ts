/**
 * The shared x-axis panel: timeline emblems on top, BAC curves directly
 * below, pixel-aligned, with a guide line dropping from every emblem so
 * cause sits visibly above effect. Raw SVG on purpose.
 *
 * Emblems: ◆ anchor · ● meal · ● hydrate. Logged reality shows as small
 * dots along the bottom (drink/water/food) and shaded bands for slept
 * sleep. The window is arbitrary — the curve is continuous across
 * midnights, so panning through a week shows one unbroken line.
 *
 * Series: past (solid truth) · future (dashed forecast) · intent (dotted
 * planned level). Ghost, don't shame: planned events that passed unlogged
 * fade to 30% — no red, no MISSED badge.
 */
import { Component, computed, input, output } from '@angular/core';
import { DayPlan, LogEntry, MealTemplate, Millis } from '../../core/domain/types';
import { MS_PER_HOUR } from '../../core/sim/constants';
import { CurvePoint } from '../../core/sim/types';
import { WellnessPoint } from '../../core/sim/wellness';
import { fmtTime } from '../../core/util/format';

export interface TimelineMeal {
  atMs: Millis;
  label: string;
  templateId: string;
}

export interface LoggedMark {
  atMs: Millis;
  kind: 'drink' | 'water' | 'food';
}

const W = 960;
const H = 410;
const PLOT_LEFT = 40;
const LANE_Y = 36;
const PLOT_TOP = 72;
const PLOT_BOTTOM = 292;
/** Lower band: hydration + nutrition, 0..1. Shares the x-axis. */
const BAND_TOP = 322;
const BAND_BOTTOM = 394;

@Component({
  selector: 'app-curve-panel',
  template: `
    <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" preserveAspectRatio="xMidYMid meet" role="img">
      <!-- time grid + labels (grid spans BAC plot AND wellness band) -->
      @for (tick of ticks(); track tick.ms) {
        <line [attr.x1]="tick.x" [attr.x2]="tick.x" [attr.y1]="laneY" [attr.y2]="bandBottom" class="grid" />
        <text [attr.x]="tick.x" [attr.y]="plotBottom + 12" class="ticklabel">{{ tick.label }}</text>
      }

      <!-- y-axis: BAC in ‰ -->
      @for (yt of yTicks(); track yt.value) {
        <line [attr.x1]="plotLeft" [attr.x2]="w" [attr.y1]="yt.y" [attr.y2]="yt.y" class="ygrid" />
        <text [attr.x]="plotLeft - 5" [attr.y]="yt.y + 3" class="ylabel">{{ yt.label }}</text>
      }

      <!-- slept sleep: shaded bands over the plot -->
      @for (b of sleptBands(); track b.x) {
        <rect [attr.x]="b.x" [attr.y]="plotTop" [attr.width]="b.width" [attr.height]="plotBottom - plotTop" class="sleptband" />
      }

      <!-- planned sleep: lane block + light band over the plot (slept sleep shades darker) -->
      @for (sr of sleepRects(); track sr.x) {
        <rect [attr.x]="sr.x" [attr.y]="laneY - 24" [attr.width]="sr.width" height="9" class="sleep" rx="3" />
        <rect [attr.x]="sr.x" [attr.y]="plotTop" [attr.width]="sr.width" [attr.height]="plotBottom - plotTop" class="plannedband">
          <title>planned sleep</title>
        </rect>
      }

      <!-- anchors ◆ with guide line; label shows the units it asks for -->
      @for (a of anchorMarks(); track a.id) {
        <g [attr.opacity]="a.ghost ? 0.3 : 1">
          <line [attr.x1]="a.x" [attr.x2]="a.x" [attr.y1]="laneY + 2" [attr.y2]="plotBottom" class="guide" />
          <path [attr.d]="diamond(a.x, laneY - 6)" class="anchor">
            <title>{{ a.label }} — {{ a.units }} units</title>
          </path>
          <text [attr.x]="a.x" [attr.y]="laneY - 16" class="eventlabel">{{ a.label }} · {{ a.units }}u</text>
        </g>
      }

      <!-- meals ● with guide line -->
      @for (m of mealMarks(); track m.atMs) {
        <g [attr.opacity]="m.ghost ? 0.3 : 1">
          <line [attr.x1]="m.x" [attr.x2]="m.x" [attr.y1]="laneY + 10" [attr.y2]="plotBottom" class="guide" />
          <circle [attr.cx]="m.x" [attr.cy]="laneY + 4" r="6" class="meal" (click)="mealClick.emit(m.meal)">
            <title>{{ m.meal.label }}</title>
          </circle>
        </g>
      }

      <!-- hydrate ● with guide line -->
      @for (hy of hydrateMarks(); track hy.atMs) {
        <g [attr.opacity]="hy.ghost ? 0.3 : 1">
          <line [attr.x1]="hy.x" [attr.x2]="hy.x" [attr.y1]="laneY + 20" [attr.y2]="plotBottom" class="guide" />
          <circle [attr.cx]="hy.x" [attr.cy]="laneY + 16" r="4" class="hydrate">
            <title>{{ hy.ml }} ml water</title>
          </circle>
        </g>
      }

      <!-- planned drink ticks on the axis -->
      @for (d of drinkMarks(); track d.ms) {
        <circle [attr.cx]="d.x" [attr.cy]="plotBottom" r="3" class="plandrink" />
      }

      <!-- the plan's own ceiling (not a legal limit — there is no such line here) -->
      @if (ceilingY(); as cy) {
        <line [attr.x1]="plotLeft" [attr.x2]="w" [attr.y1]="cy" [attr.y2]="cy" class="ceiling" />
        <text [attr.x]="plotLeft + 4" [attr.y]="cy - 4" class="ticklabel">ceiling</text>
      }

      <!-- the trough: decay to here before the next lift — it's part of the plan -->
      @if (troughY(); as ty) {
        <line [attr.x1]="plotLeft" [attr.x2]="w" [attr.y1]="ty" [attr.y2]="ty" class="troughline" />
        <text [attr.x]="plotLeft + 4" [attr.y]="ty - 4" class="ticklabel troughlabel">trough</text>
      }

      <!-- planned level (intent), then forecast, then truth on top -->
      @if (intentPath(); as d) {
        <path [attr.d]="d" class="curve intent" />
      }
      @if (futurePath(); as d) {
        <path [attr.d]="d" class="curve future" />
      }
      @if (pastPath(); as d) {
        <path [attr.d]="d" class="curve past" />
      }

      <!-- ── wellness band: hydration + nutrition, sharing the x-axis ── -->
      <line [attr.x1]="plotLeft" [attr.x2]="w" [attr.y1]="bandTop" [attr.y2]="bandTop" class="grid" />
      <text [attr.x]="plotLeft - 5" [attr.y]="bandTop + 4" class="ylabel">1</text>
      <text [attr.x]="plotLeft - 5" [attr.y]="bandBottom + 3" class="ylabel">0</text>
      <text [attr.x]="w - 4" [attr.y]="bandTop + 12" class="bandlabel hydlabel">hydration</text>
      <text [attr.x]="w - 4" [attr.y]="bandTop + 24" class="bandlabel nutlabel">food</text>
      @if (hydrationPastPath(); as d) {
        <path [attr.d]="d" class="wcurve hyd" />
      }
      @if (hydrationFuturePath(); as d) {
        <path [attr.d]="d" class="wcurve hyd dashed" />
      }
      @if (nutritionPastPath(); as d) {
        <path [attr.d]="d" class="wcurve nut" />
      }
      @if (nutritionFuturePath(); as d) {
        <path [attr.d]="d" class="wcurve nut dashed" />
      }

      <!-- logged reality, pinned ON its curve: drinks on BAC, water on
           hydration, meals on the food curve -->
      @for (e of loggedMarks(); track e.atMs) {
        <circle [attr.cx]="e.x" [attr.cy]="e.y" r="3.5" [class]="'logged ' + e.kind">
          <title>{{ e.title }}</title>
        </circle>
      }

      @if (nowX(); as x) {
        <line [attr.x1]="x" [attr.x2]="x" [attr.y1]="laneY - 28" [attr.y2]="bandBottom" class="nowrule" />
        <text [attr.x]="x + 4" [attr.y]="laneY - 30" class="ticklabel">now</text>
      }
    </svg>
    <p class="legend muted">
      <span class="key past">━ so far</span>
      <span class="key future">╌ prediction</span>
      @if (intent().length > 0) {
        <span class="key intent">┈ planned</span>
      }
      <span class="key anchor">◆ anchor</span>
      <span class="key meal">● meal</span>
      <span class="key hydrate">● hydrate</span>
      <span class="key hydrate">— hydration</span>
      <span class="key meal">— food</span>
      <span class="key">· logged dots sit on their curve · shaded = slept</span>
    </p>
  `,
  styles: `
    svg {
      width: 100%;
      height: auto;
      display: block;
    }
    .grid {
      stroke: var(--line);
      stroke-width: 1;
    }
    .ygrid {
      stroke: var(--line);
      stroke-width: 0.5;
      opacity: 0.6;
    }
    .ticklabel {
      fill: var(--dim);
      font-size: 10px;
    }
    .ylabel {
      fill: var(--dim);
      font-size: 10px;
      text-anchor: end;
    }
    .eventlabel {
      fill: var(--text);
      font-size: 10px;
      text-anchor: middle;
    }
    .guide {
      stroke: var(--dim);
      stroke-width: 0.75;
      stroke-dasharray: 2 3;
      opacity: 0.45;
    }
    .anchor {
      fill: var(--accent);
    }
    .meal {
      fill: var(--good);
      cursor: pointer;
    }
    .hydrate {
      fill: var(--blue);
    }
    .plandrink {
      fill: var(--accent);
    }
    .logged.drink {
      fill: var(--accent);
      stroke: var(--bg);
    }
    .logged.water {
      fill: var(--blue);
      stroke: var(--bg);
    }
    .logged.food {
      fill: var(--good);
      stroke: var(--bg);
    }
    .sleep {
      fill: var(--blue);
      opacity: 0.5;
    }
    .sleptband {
      fill: var(--blue);
      opacity: 0.14;
    }
    .plannedband {
      fill: var(--blue);
      opacity: 0.06;
    }
    .curve {
      fill: none;
      stroke-width: 2;
    }
    .past {
      stroke: var(--text);
    }
    .future {
      stroke: var(--accent);
      stroke-dasharray: 5 4;
    }
    .intent {
      stroke: var(--blue);
      stroke-dasharray: 2 4;
      stroke-width: 1.5;
    }
    .ceiling {
      stroke: var(--dim);
      stroke-dasharray: 2 3;
    }
    .troughline {
      stroke: var(--good);
      stroke-dasharray: 2 3;
      opacity: 0.7;
    }
    .troughlabel {
      fill: var(--good);
    }
    .nowrule {
      stroke: var(--blue);
      stroke-width: 1.5;
    }
    .wcurve {
      fill: none;
      stroke-width: 1.5;
    }
    .wcurve.hyd {
      stroke: var(--blue);
    }
    .wcurve.nut {
      stroke: var(--good);
    }
    .wcurve.dashed {
      stroke-dasharray: 5 4;
      opacity: 0.8;
    }
    .bandlabel {
      font-size: 10px;
      text-anchor: end;
    }
    .hydlabel {
      fill: var(--blue);
    }
    .nutlabel {
      fill: var(--good);
    }
    .legend {
      font-size: 0.72rem;
      margin: 0.25rem 0 0;
    }
    .legend .key {
      margin-right: 0.6rem;
    }
    .legend .key.past {
      color: var(--text);
    }
    .legend .key.future {
      color: var(--accent);
    }
    .legend .key.intent {
      color: var(--blue);
    }
    .legend .key.anchor,
    .legend .key.drinkdot {
      color: var(--accent);
    }
    .legend .key.meal {
      color: var(--good);
    }
    .legend .key.hydrate {
      color: var(--blue);
    }
  `,
})
export class CurvePanel {
  /** Visible window — arbitrary; pan freely, the curves are continuous. */
  readonly startMs = input.required<Millis>();
  readonly endMs = input.required<Millis>();
  /** All days whose decorations may fall inside the window. */
  readonly days = input<DayPlan[]>([]);
  readonly mealTemplates = input<readonly MealTemplate[]>([]);
  readonly past = input<CurvePoint[]>([]);
  readonly future = input<CurvePoint[]>([]);
  /** The planned level — pure intent, chained across days. */
  readonly intent = input<CurvePoint[]>([]);
  readonly nowMs = input<Millis | null>(null);
  readonly ceiling = input<number | null>(null);
  /** The plan's minTrough — decay target between lifts. */
  readonly trough = input<number | null>(null);
  readonly plannedDrinkTimes = input<Millis[]>([]);
  /** The log, for reality markers (drinks/water/food dots + slept bands). */
  readonly log = input<readonly LogEntry[]>([]);
  /** Hydration/nutrition series: solid truth + dashed forecast. */
  readonly wellnessPast = input<WellnessPoint[]>([]);
  readonly wellnessFuture = input<WellnessPoint[]>([]);

  readonly mealClick = output<TimelineMeal>();

  readonly w = W;
  readonly h = H;
  readonly laneY = LANE_Y;
  readonly plotLeft = PLOT_LEFT;
  readonly plotTop = PLOT_TOP;
  readonly plotBottom = PLOT_BOTTOM;
  readonly bandTop = BAND_TOP;
  readonly bandBottom = BAND_BOTTOM;

  private x(ms: Millis): number {
    const t = (ms - this.startMs()) / (this.endMs() - this.startMs());
    return Math.max(PLOT_LEFT, Math.min(W, PLOT_LEFT + t * (W - PLOT_LEFT)));
  }

  private inWindow(ms: Millis): boolean {
    return ms >= this.startMs() && ms <= this.endMs();
  }

  private readonly yMax = computed(() => {
    let m = this.ceiling() ?? 0;
    const scan = (pts: readonly CurvePoint[]) => {
      for (const p of pts) if (this.inWindow(p.atMs) && p.bac > m) m = p.bac;
    };
    scan(this.past());
    scan(this.future());
    scan(this.intent());
    return Math.max(0.6, m * 1.15);
  });

  private y(bac: number): number {
    return PLOT_BOTTOM - (bac / this.yMax()) * (PLOT_BOTTOM - PLOT_TOP);
  }

  private path(points: readonly CurvePoint[]): string | null {
    const inRange = points.filter((p) => this.inWindow(p.atMs));
    if (inRange.length < 2) return null;
    const dec = inRange.filter((_, i) => i % 3 === 0 || i === inRange.length - 1);
    return dec.map((p, i) => `${i === 0 ? 'M' : 'L'}${this.x(p.atMs).toFixed(1)},${this.y(p.bac).toFixed(1)}`).join(' ');
  }

  readonly pastPath = computed(() => this.path(this.past()));
  readonly futurePath = computed(() => this.path(this.future()));
  readonly intentPath = computed(() => this.path(this.intent()));

  /** 0..1 → wellness band y. */
  private wy(v: number): number {
    return BAND_BOTTOM - Math.min(1, Math.max(0, v)) * (BAND_BOTTOM - BAND_TOP);
  }

  private wpath(points: readonly WellnessPoint[], sel: (p: WellnessPoint) => number): string | null {
    const inRange = points.filter((p) => this.inWindow(p.atMs));
    if (inRange.length < 2) return null;
    return inRange
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${this.x(p.atMs).toFixed(1)},${this.wy(sel(p)).toFixed(1)}`)
      .join(' ');
  }

  readonly hydrationPastPath = computed(() => this.wpath(this.wellnessPast(), (p) => p.hydration));
  readonly hydrationFuturePath = computed(() => this.wpath(this.wellnessFuture(), (p) => p.hydration));
  readonly nutritionPastPath = computed(() => this.wpath(this.wellnessPast(), (p) => p.nutrition));
  readonly nutritionFuturePath = computed(() => this.wpath(this.wellnessFuture(), (p) => p.nutrition));

  readonly nowX = computed(() => {
    const n = this.nowMs();
    return n !== null && this.inWindow(n) ? this.x(n) : null;
  });
  readonly ceilingY = computed(() => {
    const c = this.ceiling();
    return c !== null ? this.y(c) : null;
  });
  readonly troughY = computed(() => {
    const t = this.trough();
    return t !== null && t > 0 ? this.y(t) : null;
  });

  readonly ticks = computed(() => {
    const out: { ms: Millis; x: number; label: string }[] = [];
    for (let ms = this.startMs(); ms <= this.endMs(); ms += 3 * MS_PER_HOUR) {
      out.push({ ms, x: this.x(ms), label: fmtTime(ms) });
    }
    return out;
  });

  /** BAC axis: pick a step that yields ≤ 6 labelled lines. */
  readonly yTicks = computed(() => {
    const max = this.yMax();
    const step = [0.1, 0.2, 0.25, 0.5].find((s) => max / s <= 6) ?? 0.5;
    const out: { value: number; y: number; label: string }[] = [];
    for (let v = 0; v <= max + 1e-9; v += step) {
      out.push({ value: v, y: this.y(v), label: v.toFixed(2) });
    }
    return out;
  });

  private ghost(atMs: Millis, loggedKind?: LoggedMark['kind']): boolean {
    const now = this.nowMs();
    if (now === null || atMs >= now) return false;
    if (!loggedKind) return true;
    return !this.log().some(
      (e) =>
        'atMs' in e &&
        Math.abs(e.atMs - atMs) < MS_PER_HOUR &&
        ((loggedKind === 'food' && e.kind === 'food') || (loggedKind === 'water' && e.kind === 'water')),
    );
  }

  readonly anchorMarks = computed(() =>
    this.days()
      .flatMap((d) => d.anchors)
      .filter((a) => this.inWindow(a.atMs))
      .map((a) => ({
        id: a.id,
        x: this.x(a.atMs),
        label: a.label,
        units: a.units,
        ghost: this.ghost(a.atMs),
      })),
  );

  readonly mealMarks = computed(() => {
    const templates = this.mealTemplates();
    return this.days()
      .flatMap((d) => d.meals)
      .filter((m) => this.inWindow(m.atMs))
      .map((m) => {
        const label = templates.find((t) => t.id === m.templateId)?.label ?? 'Meal';
        return {
          atMs: m.atMs,
          x: this.x(m.atMs),
          meal: { atMs: m.atMs, templateId: m.templateId, label } satisfies TimelineMeal,
          ghost: this.ghost(m.atMs, 'food'),
        };
      });
  });

  readonly hydrateMarks = computed(() =>
    this.days()
      .flatMap((d) => d.hydrations)
      .filter((hy) => this.inWindow(hy.atMs))
      .map((hy) => ({
        atMs: hy.atMs,
        ml: hy.ml,
        x: this.x(hy.atMs),
        ghost: this.ghost(hy.atMs, 'water'),
      })),
  );

  readonly drinkMarks = computed(() =>
    this.plannedDrinkTimes()
      .filter((ms) => this.inWindow(ms))
      .map((ms) => ({ ms, x: this.x(ms) })),
  );

  /** Value of a time series at a moment (nearest point), or null. */
  private nearest<T extends { atMs: Millis }>(series: readonly T[], atMs: Millis): T | null {
    let best: T | null = null;
    let bestDist = Infinity;
    for (const p of series) {
      const d = Math.abs(p.atMs - atMs);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return bestDist <= 10 * 60_000 ? best : null;
  }

  /**
   * Logged reality, pinned onto its own curve: drinks sit on the BAC line,
   * water on the hydration line, food on the nutrition line.
   */
  readonly loggedMarks = computed(() => {
    const bacSeries = [...this.past(), ...this.future()];
    const wellSeries = [...this.wellnessPast(), ...this.wellnessFuture()];
    const out: { atMs: Millis; x: number; y: number; kind: LoggedMark['kind']; title: string }[] = [];
    for (const e of this.log()) {
      if (e.kind !== 'drink' && e.kind !== 'water' && e.kind !== 'food') continue;
      if (!this.inWindow(e.atMs)) continue;
      let y: number;
      let title: string;
      if (e.kind === 'drink') {
        const p = this.nearest(bacSeries, e.atMs);
        y = p ? this.y(p.bac) : this.plotBottom - 8;
        title = `${fmtTime(e.atMs)} drink`;
      } else if (e.kind === 'water') {
        const p = this.nearest(wellSeries, e.atMs);
        y = p ? this.wy(p.hydration) : this.bandBottom - 8;
        title = `${fmtTime(e.atMs)} water ${e.ml} ml`;
      } else {
        const p = this.nearest(wellSeries, e.atMs);
        y = p ? this.wy(p.nutrition) : this.bandBottom - 8;
        title = `${fmtTime(e.atMs)} ${e.fullness}`;
      }
      out.push({ atMs: e.atMs, x: this.x(e.atMs), y, kind: e.kind, title });
    }
    return out;
  });

  /** Slept sleep from the log: shaded bands. */
  readonly sleptBands = computed(() => {
    const out: { x: number; width: number }[] = [];
    for (const e of this.log()) {
      if (e.kind !== 'sleep') continue;
      const a = Math.max(e.fromMs, this.startMs());
      const b = Math.min(e.toMs, this.endMs());
      if (b > a) out.push({ x: this.x(a), width: this.x(b) - this.x(a) });
    }
    return out;
  });

  /** Planned sleep blocks in the lane, per day. */
  readonly sleepRects = computed(() => {
    const out: { x: number; width: number }[] = [];
    for (const d of this.days()) {
      const a = Math.max(d.sleep.fromMs, this.startMs());
      const b = Math.min(d.sleep.toMs, this.endMs());
      if (b > a) out.push({ x: this.x(a), width: this.x(b) - this.x(a) });
    }
    return out;
  });

  diamond(cx: number, cy: number): string {
    return `M${cx},${cy - 6} L${cx + 6},${cy} L${cx},${cy + 6} L${cx - 6},${cy} Z`;
  }
}
