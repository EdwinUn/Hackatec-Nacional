import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { OperatorApi } from '../../core/api/operator-api';
import { BuoyCondition, Collection, Material, MaterialAmount } from '../../core/models/operator.models';
import { StationsService } from '../../core/services/stations.service';
import { WASTE_META } from '../../shared/utils/wqi.util';

const MATERIALS: { key: Material; label: string; waste: 'plastic' | 'organic' | 'glass' | 'other' | 'metal' }[] = [
  { key: 'plastico', label: 'Plástico', waste: 'plastic' },
  { key: 'organico', label: 'Orgánico', waste: 'organic' },
  { key: 'vidrio', label: 'Vidrio', waste: 'glass' },
  { key: 'otros', label: 'Otros', waste: 'other' },
  { key: 'metal', label: 'Metal', waste: 'metal' },
];

const CONDITIONS: { value: BuoyCondition; label: string }[] = [
  { value: 'ok', label: 'Buena' },
  { value: 'saturada', label: 'Saturada' },
  { value: 'danada', label: 'Dañada' },
  { value: 'faltan_piezas', label: 'Faltan piezas' },
];

type Amounts = Record<Material, { kg: number | null; piezas: number | null }>;
const blank = (): Amounts => ({ plastico: { kg: null, piezas: null }, organico: { kg: null, piezas: null }, vidrio: { kg: null, piezas: null }, otros: { kg: null, piezas: null }, metal: { kg: null, piezas: null } });

/** Quick emptying survey for a skimmer buoy: kg and pieces of each material + the physical state of the buoy. */
@Component({
  selector: 'app-skimmer-survey',
  imports: [FormsModule, Button, Dialog, InputText, Textarea],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: .6rem; }
    select.num { text-align: left; }
    input.num::-webkit-outer-spin-button, input.num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    input.num { -moz-appearance: textfield; appearance: textfield; }
    label.lbl, .lbl { display: flex; flex-direction: column; gap: .3rem; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--atl-muted, #64706b); font-weight: 600; }
    .form { display: flex; flex-direction: column; gap: .9rem; }
    .mats { display: grid; gap: .5rem; }
    .mat { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: center; gap: .5rem; }
    .mat .name { display: flex; align-items: center; gap: .45rem; font-weight: 650; font-size: .9rem; }
    .dot { width: .7rem; height: .7rem; border-radius: 50%; flex: none; }
    .head { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: .5rem; padding-bottom: .2rem; }
    input.num { width: 100%; min-width: 0; padding: .55rem .6rem; border: 1px solid var(--atl-line, #eaecf0); border-radius: 12px; background: #fff; font: inherit; font-size: 1rem; text-align: right; font-variant-numeric: tabular-nums; &:focus { outline: 2px solid var(--atl-blue, #00b4d8); border-color: transparent; } }
    .total { display: flex; justify-content: space-between; padding: .7rem .9rem; border-radius: 14px; background: #eef9fc; font-weight: 700; font-variant-numeric: tabular-nums; }
    .err { color: #b91c1c; font-size: .85rem; margin: 0; }
    .conds { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; }
    .cond { padding: .55rem .4rem; border: 1px solid var(--atl-line, #eaecf0); border-radius: 12px; background: #fff; color: var(--atl-ink, #1b263b); font: inherit; font-size: .85rem; font-weight: 650; cursor: pointer; text-transform: none; letter-spacing: 0; }
    .cond.on { background: #00b4d8; border-color: #00b4d8; color: #0d1b2a; }
  `,
  template: `
    <p-dialog [visible]="visible()" (visibleChange)="visible.set($event)" [modal]="true" [style]="{ width: 'min(480px, 94vw)' }" [draggable]="false" header="Encuesta de vaciado · Boya skimmer" appendTo="body">
      <form class="form" (ngSubmit)="submit()">
        <div class="grid">
          <label class="lbl">Estación
            <select [ngModel]="station()" (ngModelChange)="station.set($event)" name="station" class="num" style="text-align:left" required>
              <option value="" disabled>Elige…</option>
              @for (s of stations.stations(); track s.id) { <option [value]="s.id">{{ s.name }}</option> }
            </select>
          </label>
          <label class="lbl">Código de boya
            <input pInputText name="buoy" [ngModel]="buoy()" (ngModelChange)="buoy.set($event)" placeholder="SK-01" maxlength="60" required />
          </label>
        </div>

        <div class="lbl">Estado de la boya
          <div class="conds" role="radiogroup" aria-label="Estado físico de la boya">
            @for (c of conditions; track c.value) {
              <button type="button" class="cond" role="radio" [attr.aria-checked]="condition() === c.value" [class.on]="condition() === c.value" (click)="condition.set(c.value)">{{ c.label }}</button>
            }
          </div>
        </div>

        <div class="mats" role="group" aria-label="Material recolectado">
          <div class="head lbl"><span>Material</span><span style="text-align:right">kg</span><span style="text-align:right">Piezas</span></div>
          @for (m of materials; track m.key) {
            <div class="mat">
              <span class="name"><span class="dot" [style.background]="color(m.waste)"></span>{{ m.label }}</span>
              <input class="num" type="number" inputmode="decimal" min="0" step="0.1" placeholder="0" [name]="m.key + '-kg'" [attr.aria-label]="m.label + ', kilogramos'" [ngModel]="amounts()[m.key].kg" (ngModelChange)="set(m.key, 'kg', $event)" />
              <input class="num" type="number" inputmode="numeric" min="0" step="1" placeholder="0" [name]="m.key + '-pz'" [attr.aria-label]="m.label + ', piezas'" [ngModel]="amounts()[m.key].piezas" (ngModelChange)="set(m.key, 'piezas', $event)" />
            </div>
          }
        </div>
        <div class="total" aria-live="polite"><span>Total</span><span>{{ totalKg() }} kg · {{ totalPieces() }} piezas</span></div>

        <label class="lbl">Notas (opcional)
          <textarea pTextarea rows="2" name="notes" [ngModel]="notes()" (ngModelChange)="notes.set($event)" maxlength="1000" placeholder="Ej. Cesta casi llena, barrera derecha floja"></textarea>
        </label>
        @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
      </form>
      <ng-template #footer>
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
        <p-button label="Guardar vaciado" icon="pi pi-check" [loading]="saving()" [disabled]="!canSave()" (onClick)="submit()" />
      </ng-template>
    </p-dialog>
  `,
})
export class SkimmerSurvey {
  private readonly api = inject(OperatorApi);
  private readonly toast = inject(MessageService);
  protected readonly stations = inject(StationsService);

  readonly visible = model(false);
  readonly stationId = input<string | null>(null);
  readonly buoyCode = input<string | null>(null);
  readonly taskId = input<string | null>(null);
  readonly saved = output<Collection>();

  protected readonly materials = MATERIALS;
  protected readonly conditions = CONDITIONS;
  protected readonly station = signal('');
  protected readonly buoy = signal('');
  protected readonly condition = signal<BuoyCondition>('ok');
  protected readonly amounts = signal<Amounts>(blank());
  protected readonly notes = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly amountValues = computed<Record<Material, MaterialAmount>>(() => {
    const a = this.amounts();
    const out = {} as Record<Material, MaterialAmount>;
    for (const m of MATERIALS) out[m.key] = { kg: Math.max(0, Number(a[m.key].kg) || 0), piezas: Math.max(0, Math.trunc(Number(a[m.key].piezas) || 0)) };
    return out;
  });
  protected readonly totalKg = computed(() => Math.round(Object.values(this.amountValues()).reduce((s, m) => s + m.kg, 0) * 100) / 100);
  protected readonly totalPieces = computed(() => Object.values(this.amountValues()).reduce((s, m) => s + m.piezas, 0));
  protected readonly canSave = computed(() => !!this.station() && !!this.buoy().trim() && (this.totalKg() > 0 || this.totalPieces() > 0) && !this.saving());

  constructor() {
    // Every time the dialog opens: start clean, prefilled from the buoy / task that opened it.
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.station.set(this.stationId() ?? this.stations.stations()[0]?.id ?? '');
        this.buoy.set(this.buoyCode() ?? '');
        this.condition.set('ok');
        this.amounts.set(blank());
        this.notes.set('');
        this.error.set(null);
      });
    });
  }

  protected color(waste: keyof typeof WASTE_META): string {
    return WASTE_META[waste].color;
  }

  protected set(m: Material, field: 'kg' | 'piezas', value: number | null): void {
    this.amounts.update((a) => ({ ...a, [m]: { ...a[m], [field]: value } }));
  }

  protected submit(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.error.set(null);
    this.api
      .recordCollection({
        station_id: this.station(),
        buoy_code: this.buoy().trim(),
        buoy_condition: this.condition(),
        notes: this.notes().trim() || null,
        task_id: this.taskId(),
        ...this.amountValues(),
      })
      .subscribe({
        next: (c) => {
          this.saving.set(false);
          this.visible.set(false);
          this.toast.add({ key: 'app', severity: 'success', summary: 'Vaciado registrado', detail: `${c.buoy_code}: ${c.total_kg} kg · ${c.total_pieces} piezas`, life: 5000 });
          this.saved.emit(c);
        },
        error: (e: Error) => {
          this.saving.set(false);
          this.error.set(e.message || 'No se pudo guardar el vaciado.');
        },
      });
  }
}
