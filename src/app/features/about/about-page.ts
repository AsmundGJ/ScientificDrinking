/** /about — what Pace is for, the science behind the curves, and strategy. */
import { Component } from '@angular/core';

@Component({
  selector: 'app-about-page',
  template: `
    <article class="prose">
      <h1>About Pace</h1>

      <section class="card">
        <h2>Purpose</h2>
        <p>
          Pace exists to <strong>maximize fun and minimize hangovers and impairment</strong> — in
          that order, and on the understanding that past a point they are the same goal. Most drink
          trackers are diaries: they tell you what you did. Pace is a forecast engine: it tells you
          what is about to happen to you, and plans forward from wherever you actually are. The plan
          is intent; the log is truth; the projection is always recomputed from the log — nothing is
          ever "missed", there is no catch-up, and the budget is a ceiling you may come in under,
          never a target you are failing to hit.
        </p>
      </section>

      <section class="card">
        <h2>How the BAC curve works</h2>
        <p>
          Every drink is converted to grams of ethanol: volume × strength × 0.789 (the density of
          ethanol). A 330 ml beer at 4.6% is ~12 g — one Danish unit (genstand).
        </p>
        <p>
          That alcohol does not appear in your blood instantly. The model has two compartments:
          the <strong>gut</strong>, which empties into the blood at a rate that depends on food
          (fast when fasted, up to four times slower after a big meal), and the
          <strong>blood</strong>, where concentration is what the big number shows. This is why the
          <em>Incoming</em> line matters: three quick beers can leave 20+ grams still in your gut —
          alcohol you have already committed to, that just hasn't landed yet.
        </p>
        <p>
          Concentration depends on body water. Two people drinking identically get different
          curves: total body water is estimated from your sex, age, height and weight (the Watson
          equations), which is why the app needs a profile and why a shared plan renders
          differently for a 95 kg friend.
        </p>
        <p>
          <strong>Why the curve falls at a steady rate:</strong> the liver enzyme that clears
          alcohol (alcohol dehydrogenase) is saturated at even modest BAC — it works at maximum
          capacity no matter how much is queued. Elimination is therefore
          <em>zero-order</em>: a fixed ~0.15‰ per hour, a straight line down, not the exponential
          decay most substances show. Two consequences drive the whole app. First, there is a hard,
          computable ceiling on sustainable intake — roughly one small beer every 75 minutes,
          indefinitely, for an 80 kg male; everything above that accumulates. Second, the descent
          cannot be hurried: no coffee, water, or willpower changes the slope. Only time.
        </p>
        <p class="muted">
          The solid line is reconstructed from your log; the dashed line is the forecast from your
          actual current state; the dotted blue line is the planned level your sober self drew.
          Displayed BAC is rounded to 0.05‰ because models like this easily carry ±30% error — and
          nothing here says anything about fitness to drive.
        </p>
      </section>

      <section class="card">
        <h2>The hydration and nutrition curves</h2>
        <p>
          The lower band is deliberately coarse — a motivation indicator, not a lab value.
          <strong>Hydration</strong> tracks a running water deficit: it drifts down over hours
          without water, drops faster while drinking (alcohol suppresses the hormone that tells
          your kidneys to retain water, so you urinate out more than the beer put in), and refills
          when you log water — rate-limited, because beyond roughly 750 ml/h the surplus is
          expensive urine. <strong>Nutrition</strong> is a satiety level: eating sets it by meal
          size and it decays over a few hours.
        </p>
        <p>
          Food also has a second, load-bearing role: stomach contents slow alcohol absorption.
          A meal before drinking flattens the same drinks into a visibly lower, later peak. Skip
          dinner and the identical evening produces a higher curve — the graph will show you this
          before it happens, which is the entire point of planning meals into the day.
        </p>
      </section>

      <section class="card">
        <h2>Strategies: sawtooth vs. holding a baseline</h2>
        <svg viewBox="0 0 720 150" role="img" aria-label="Sawtooth versus plateau comparison">
          <path d="M20,130 L120,50 L180,50 L700,50" class="line base" />
          <path d="M20,130 L90,60 L160,110 L230,55 L300,105 L370,55 L440,105 L510,55 L580,110 L700,128" class="line saw" />
          <text x="705" y="45" class="lbl base">hold 0.6</text>
          <text x="590" y="125" class="lbl saw">sawtooth</text>
        </svg>
        <p>
          The key fact is the <strong>Mellanby effect</strong>: at the very same BAC, you feel —
          and measurably are — more affected on the way <em>up</em> than on the way down. Acute
          tolerance develops within a single session, over about an hour. The pleasant part of
          drinking largely tracks the <em>rate of rise</em>, not the level.
        </p>
        <p>
          <strong>Holding a baseline</strong> (climb to ~0.6‰ and sip to stay there) therefore
          delivers one good hour. After that, Mellanby adaptation has caught up with the plateau:
          the euphoria fades while the impairment stays — you are fully impaired and barely feeling
          it. Its real advantages: socially smooth (no visibly sober stretches), no timing to think
          about, predictable. Its costs: continuous maintenance drinking means the most total
          alcohol for the least felt effect, judgment quietly degrades while confidence doesn't,
          sleep quality is worst (a full descent happens overnight), and across a festival week it
          ratchets tolerance fastest — which is how day five goes numb.
        </p>
        <p>
          <strong>The sawtooth</strong> rides up and comes partway back down, repeatedly. Each
          trough lets the Mellanby adaptation reset, so the next ascent actually registers — four
          good stretches instead of one, from <em>less</em> total alcohol. The troughs are not dead
          time; they are what make the next lift work, and they are where food and water go. Safety
          comes along for free: every climb starts from a low base, so a misjudged pour overshoots
          from 0.3, not from 0.6. Its costs are real too: it takes discipline and timing (which is
          what this app automates), the troughs can feel flat socially, and the descent phases are
          where "why don't I feel it?" tempts a top-up — the trend arrow on the Now page exists for
          exactly that moment.
        </p>
        <p>
          Pace plans the sawtooth on a festival cadence — a lift roughly every three hours, capped
          by the day's ceiling — because on a long day it is simultaneously the more fun and the
          less impaired strategy. The plateau is not offered: it is quietly the acute-tolerance
          trap.
        </p>
      </section>

      <section class="card">
        <h2>Hangovers, briefly</h2>
        <p>
          The next morning is mostly three debts: dehydration (the diuresis above), sleep
          disruption (alcohol suppresses REM sleep, and a descent spent asleep is a bad night's
          sleep), and metabolic byproducts proportional to total grams consumed. The sawtooth
          attacks all three — less total alcohol, water in every trough, and a last call early
          enough that the descent finishes before the night does. The <em>last call</em> line is
          framed as a time, not a prohibition: drink after it and you wake up impaired — and a
          morning spent on a descending limb blunts the whole next day's first lift.
        </p>
      </section>
    </article>
  `,
  styles: `
    .prose {
      max-width: 46rem;
      margin: 0 auto;
    }
    .card {
      margin-bottom: 0.9rem;
    }
    h2 {
      font-size: 1.1rem;
    }
    p {
      line-height: 1.55;
    }
    svg {
      width: 100%;
      height: auto;
      display: block;
      margin: 0.25rem 0 0.5rem;
    }
    .line {
      fill: none;
      stroke-width: 2.5;
    }
    .line.base {
      stroke: var(--dim);
    }
    .line.saw {
      stroke: var(--accent);
    }
    .lbl {
      font-size: 12px;
    }
    .lbl.base {
      fill: var(--dim);
    }
    .lbl.saw {
      fill: var(--accent);
    }
  `,
})
export class AboutPage {}
