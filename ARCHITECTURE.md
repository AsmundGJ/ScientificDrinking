# Pace — architecture notes

A personal, offline-first pacing tool for a week-long festival. Forecast engine, not diary:
it tells you what is about to happen to you, and plans forward from wherever you actually are.

## The one invariant

```
projection = f(log, plan, now)
```

The log is truth (append-only). The plan is intent (immutable once a day starts). They are
never reconciled — nothing is ever "missed", the forecast just recomputes from actual state.

## Layout

```
src/app/
  core/
    domain/types.ts        Domain model. Plan stores intent, never drink timestamps.
    sim/                   PURE TypeScript. Zero Angular, zero DI, zero Date.now().
      watson.ts            TBW → distribution factor r (computed, never edited)
      drinks.ts            ethanol mass arithmetic, maintenance ceiling
      ka.ts                the food coupling — the only channel food → model
      engine.ts            two-compartment step()/simulate() at 1-min resolution
      planner.ts           sawtooth: tooth windows from anchors, greedy ceiling-
                           probed allocation, dayCeiling (sign: day 5 is MORE
                           conservative), lastCall
      projection.ts        the derivation everything renders from
      testing/arbitraries.ts  fast-check generators
    share/plan-codec.ts    DayPlan[] ⇄ lz-string URL fragment (plan only, never profile)
    state/
      state-repository.ts  abstract seam; HttpRepository swaps in on one line later
      local-repository.ts  localStorage (~50 KB/week — sufficient, offline-proof)
      pace-store.ts        signals store; projection = computed(project(state, now))
    util/format.ts         display rounding to 0.05‰, time formatting
  features/
    now/now-page.ts        live mode: big number, INCOMING, trend arrow, fat log
                           buttons, undo-never-confirm, feel 1–5
    plan/                  week overview, day detail (shared x-axis SVG panel),
                           resolver for /plan/:dayId (lazy)
    setup/                 profile + presets + meal templates, behind the gear
    import/                receives #p=… fragment
```

## Why it's shaped this way

- **Sim core is pure** so the tests write themselves (vitest + fast-check). The headline
  property: *skipping a planned drink never causes a later ceiling breach*. Also proven:
  budgets never exceeded nor rolled over, no projected peak above ceiling, fasted ≤ fed
  allocation, projection purity, replan idempotence.
- **Planner derives drink times on every log event** — drift tolerance falls out for free;
  there is no catch-up concept because there is nothing to catch up to.
- **Repository seam** (abstract class + DI) so the later Spring Boot backend is a one-line
  provider swap; the simulation stays client-side forever (it must run in airplane mode).
- **PWA + localStorage** because 30,000 people share one cell tower at the moment of use.

## Safety posture (structural, not copy)

Displayed BAC rounds to 0.05‰. No legal-limit line, no drive indicator, persistent
disclaimer. The ceiling cannot be raised mid-day through any UI path. beta never rises
across days (tolerance is felt, not real — the user loses the sensor, not the impairment).
No debt counters anywhere; budget is a cap you may come in under.

## Running

```
npm start        # dev server
npm test         # vitest via @angular/build:unit-test (39 tests)
npm run build    # production build + service worker
```

## Next (post-festival, from the build order)

Anchor dragging with live curve deformation, hydration/sleep lanes on the day chart,
felt-vs-modelled week chart, then the Java port of the simulator differential-tested
against this one (fast-check ↔ jqwik).
