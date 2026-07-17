/**
 * /setup — set-once config: profile (Watson r derived live), the drink
 * "cooler" (six presets max, no search box), and meal templates (typed in
 * once, sober, at a laptop — macros optional, fullness required).
 */
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DrinkPreset, Fullness, MealTemplate, Sex } from '../../core/domain/types';
import { MAX_BETA, MIN_BETA } from '../../core/sim/constants';
import { ethanolGrams, genstande, maintenanceGramsPerHour } from '../../core/sim/drinks';
import { watsonR } from '../../core/sim/watson';
import { PaceStore } from '../../core/state/pace-store';
import { uid } from '../../core/util/format';

@Component({
  selector: 'app-setup-page',
  imports: [FormsModule],
  template: `
    <h1>Setup</h1>

    <div class="card">
      <h3>Profile</h3>
      <div class="row">
        <label>Weight (kg) <input type="number" [(ngModel)]="weightKg" min="40" max="200" /></label>
        <label>Height (cm) <input type="number" [(ngModel)]="heightCm" min="140" max="220" /></label>
        <label>Age <input type="number" [(ngModel)]="age" min="18" max="99" /></label>
        <label>
          Sex
          <select [(ngModel)]="sex">
            <option value="male">male</option>
            <option value="female">female</option>
          </select>
        </label>
      </div>
      <label class="slider">
        Metabolism (beta): {{ beta.toFixed(2) }} ‰/h
        <input type="range" [(ngModel)]="beta" [min]="minBeta" [max]="maxBeta" step="0.01" />
      </label>
      <p class="muted">
        Anchors are sized in units (1 unit = 1 genstand = 12 g) directly on each plan day — the
        day's ceiling still caps everything, so a big ask can be truncated.
      </p>
      <p class="muted">
        Distribution factor r = {{ derived().r.toFixed(3) }} (Watson — computed, not editable).
        Sustainable: {{ derived().maintenance.toFixed(1) }} g/h ≈
        {{ derived().maintenanceGenstande.toFixed(2) }} genstande/h.
      </p>
      <button class="btn-primary" (click)="saveProfile()">Save profile</button>
    </div>

    <div class="card">
      <h3>Drinks — the cooler ({{ presets().length }}/6)</h3>
      <p class="muted">A festival is a closed world: declare the inventory once, log in one tap.</p>
      @for (p of presets(); track p.id; let first = $first) {
        <div class="row item">
          <span>
            {{ p.emoji }} {{ p.label }} — {{ p.volumeMl }} ml @ {{ p.abv }}% ≈
            {{ presetGenstande(p).toFixed(1) }} units
            @if (first) {
              <span class="standard">★ standard</span>
            }
          </span>
          <span>
            @if (!first) {
              <button (click)="makeStandard(p.id)" title="Plan in this drink">make standard</button>
            }
            <button (click)="removePreset(p.id)">remove</button>
          </span>
        </div>
      }
      <p class="muted">
        The ★ standard is the big button on /now and the pour the planner sizes suggestions in
        (until your log shows you mostly drink something else — then that takes over).
      </p>
      @if (presets().length < 6) {
        <div class="row">
          <input placeholder="Label" [(ngModel)]="newDrink.label" />
          <input type="number" placeholder="ml" [(ngModel)]="newDrink.volumeMl" />
          <input type="number" placeholder="ABV %" [(ngModel)]="newDrink.abv" step="0.1" />
          <input placeholder="🍺" [(ngModel)]="newDrink.emoji" size="3" />
          <button (click)="addPreset()">Add</button>
        </div>
      }
    </div>

    <div class="card">
      <h3>Meal templates</h3>
      <p class="muted">
        Fullness drives the model (required). Macros are along for the ride (optional). Water is
        deliberately separate — plan and log hydration as its own thing.
      </p>
      @for (m of mealTemplates(); track m.id) {
        <div class="row item">
          <span>{{ m.label }} — {{ m.fullness }} · {{ m.macros.kcal }} kcal</span>
          <button (click)="removeMeal(m.id)">remove</button>
        </div>
      }
      <div class="row">
        <input placeholder="Label" [(ngModel)]="newMeal.label" />
        <select [(ngModel)]="newMeal.fullness">
          <option value="snack">snack</option>
          <option value="meal">meal</option>
          <option value="big">big</option>
        </select>
        <input type="number" placeholder="kcal" [(ngModel)]="newMeal.kcal" />
        <input type="number" placeholder="protein g" [(ngModel)]="newMeal.proteinG" />
        <button (click)="addMeal()">Add</button>
      </div>
    </div>
  `,
  styles: `
    .card {
      margin-bottom: 0.75rem;
    }
    .row {
      display: flex;
      gap: 0.6rem;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .row label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .item {
      justify-content: space-between;
    }
    .standard {
      color: var(--accent);
      font-size: 0.8rem;
      margin-left: 0.4rem;
    }
    .slider {
      display: block;
      margin: 0.75rem 0;
    }
    input[type='number'] {
      width: 6.5rem;
    }
  `,
})
export class SetupPage {
  private readonly store = inject(PaceStore);

  readonly presets = this.store.presets;
  readonly mealTemplates = this.store.mealTemplates;
  readonly minBeta = MIN_BETA;
  readonly maxBeta = MAX_BETA;

  weightKg = 80;
  heightCm = 180;
  age = 25;
  sex: Sex = 'male';
  beta = 0.15;

  newDrink = { label: '', volumeMl: 330, abv: 4.6, emoji: '🍺' };
  newMeal = { label: '', fullness: 'meal' as Fullness, kcal: 0, proteinG: 0 };

  /** Re-derived live so the form shows consequences before saving. */
  private readonly formTick = signal(0);
  readonly derived = computed(() => {
    this.formTick();
    const body = { weightKg: this.weightKg, heightCm: this.heightCm, age: this.age, sex: this.sex };
    const r = watsonR(body);
    const maintenance = maintenanceGramsPerHour({ ...body, r, beta: this.beta });
    return { r, maintenance, maintenanceGenstande: genstande(maintenance) };
  });

  constructor() {
    effect(() => {
      const p = this.store.profile();
      this.weightKg = p.weightKg;
      this.heightCm = p.heightCm;
      this.age = p.age;
      this.sex = p.sex;
      this.beta = p.beta;
      this.formTick.update((n) => n + 1);
    });
    // ngModel writes plain fields; poke the tick so derived() refreshes.
    setInterval(() => this.formTick.update((n) => n + 1), 500);
  }

  saveProfile(): void {
    this.store.saveProfile({
      weightKg: this.weightKg,
      heightCm: this.heightCm,
      age: this.age,
      sex: this.sex,
      beta: this.beta,
    });
  }

  presetGenstande(p: DrinkPreset): number {
    return genstande(ethanolGrams(p.volumeMl, p.abv));
  }

  addPreset(): void {
    if (!this.newDrink.label) return;
    this.store.savePresets([...this.presets(), { id: uid(), ...this.newDrink }]);
    this.newDrink = { label: '', volumeMl: 330, abv: 4.6, emoji: '🍺' };
  }

  removePreset(id: string): void {
    this.store.savePresets(this.presets().filter((p) => p.id !== id));
  }

  /** Move a preset to the top — first preset = the standard drink. */
  makeStandard(id: string): void {
    const all = this.presets();
    const chosen = all.find((p) => p.id === id);
    if (chosen) this.store.savePresets([chosen, ...all.filter((p) => p.id !== id)]);
  }

  addMeal(): void {
    if (!this.newMeal.label) return;
    const t: MealTemplate = {
      id: uid(),
      label: this.newMeal.label,
      fullness: this.newMeal.fullness,
      macros: { kcal: this.newMeal.kcal, proteinG: this.newMeal.proteinG, carbsG: 0, fatG: 0 },
    };
    this.store.saveMealTemplates([...this.mealTemplates(), t]);
    this.newMeal = { label: '', fullness: 'meal', kcal: 0, proteinG: 0 };
  }

  removeMeal(id: string): void {
    this.store.saveMealTemplates(this.mealTemplates().filter((m) => m.id !== id));
  }
}
