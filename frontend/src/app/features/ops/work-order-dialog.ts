import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { DatePicker } from 'primeng/datepicker';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Select } from 'primeng/select';
import { Textarea } from 'primeng/textarea';
import { OpsApi } from '../../core/api/ops-api';
import { NewWorkOrder, Priority, WorkOrder, WorkOrderType } from '../../core/models/ops.models';
import { StationsService } from '../../core/services/stations.service';
import { PRIORITIES, PRIORITY_META, WO_TYPES, WO_TYPE_META } from '../../shared/utils/ops.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';

const HOUR = 3_600_000;

/** Create a work order (optionally pre-filled from a citizen report, an alert or a suggestion). */
@Component({
  selector: 'app-work-order-dialog',
  imports: [FormsModule, Button, DatePicker, Dialog, InputText, Message, Select, Textarea],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: flex; flex-direction: column; gap: .85rem; }
    label { display: flex; flex-direction: column; gap: .35rem; font-size: .85rem; font-weight: 600; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
    @media (max-width: 520px) { .two { grid-template-columns: 1fr; } }
    :host ::ng-deep .p-select, :host ::ng-deep .p-datepicker, :host ::ng-deep .p-datepicker input { width: 100%; }
    .opt { display: inline-flex; align-items: center; gap: .5rem; }
  `,
  template: `
    <p-dialog [header]="header()" [(visible)]="visible" [modal]="true" [style]="{ width: 'min(560px, 96vw)' }" [draggable]="false" appendTo="body">
      <form (ngSubmit)="save()">
        <div class="two">
          <label>Tipo de labor
            <p-select name="type" [options]="typeOptions" [(ngModel)]="type" optionLabel="label" optionValue="value" appendTo="body" [disabled]="!!prefill()?.citizen_report_id">
              <ng-template #item let-o><span class="opt"><i [class]="o.icon" [style.color]="o.color"></i>{{ o.label }}</span></ng-template>
            </p-select>
          </label>
          <label>Prioridad
            <p-select name="priority" [options]="priorityOptions" [(ngModel)]="priority" optionLabel="label" optionValue="value" appendTo="body" />
          </label>
        </div>
        <label>Título
          <input pInputText name="title" [(ngModel)]="title" required maxlength="120" />
        </label>
        <label>Instrucciones
          <textarea pTextarea name="description" rows="3" [(ngModel)]="description" [autoResize]="true"></textarea>
        </label>
        <label>Estación
          <p-select name="station" [options]="stations()" [(ngModel)]="stationId" optionLabel="name" optionValue="id" [showClear]="true" placeholder="Sin estación" appendTo="body" [filter]="true" filterBy="name" />
        </label>
        <div class="two">
          <label>Asignar a
            <p-select name="assignee" [options]="technicians()" [(ngModel)]="assignee" optionLabel="name" optionValue="id" [showClear]="true" placeholder="Sin asignar" appendTo="body" />
          </label>
          <label>Fecha límite
            <p-datepicker name="due" [(ngModel)]="due" [showTime]="true" hourFormat="24" dateFormat="dd/mm/yy" [minDate]="today" appendTo="body" />
          </label>
        </div>
        @if (error()) { <p-message severity="error">{{ error() }}</p-message> }
      </form>
      <ng-template #footer>
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
        <p-button label="Crear orden" icon="pi pi-check" [loading]="saving()" [disabled]="!title.trim()" (onClick)="save()" />
      </ng-template>
    </p-dialog>
  `,
})
export class WorkOrderDialog {
  private readonly api = inject(OpsApi);
  private readonly stationsSvc = inject(StationsService);

  readonly visible = model(false);
  readonly prefill = input<Partial<NewWorkOrder> | null>(null);
  readonly created = output<WorkOrder>();

  protected readonly typeOptions = WO_TYPES.map((value) => ({ value, ...WO_TYPE_META[value] }));
  protected readonly priorityOptions = PRIORITIES.map((value) => ({ value, label: PRIORITY_META[value].label }));
  protected readonly stations = computed(() => this.stationsSvc.stations());
  private readonly usersRes = rxResource({ params: () => this.visible() || undefined, stream: () => this.api.users() });
  protected readonly technicians = computed(() => (valueOrUndefined(this.usersRes) ?? []).filter((u) => u.role === 'technician' && u.active));
  protected readonly header = computed(() => (this.prefill()?.citizen_report_id ? 'Crear orden para el reporte' : 'Nueva orden de trabajo'));
  protected readonly today = new Date();

  protected type: WorkOrderType = 'maintenance';
  protected priority: Priority = 'normal';
  protected title = '';
  protected description = '';
  protected stationId: string | null = null;
  protected assignee: string | null = null;
  protected due: Date | null = null;
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Reset the form every time it opens.
    effect(() => {
      if (!this.visible()) return;
      const p = this.prefill() ?? {};
      untracked(() => {
        this.type = p.type ?? 'maintenance';
        this.priority = p.priority ?? 'normal';
        this.title = p.title ?? '';
        this.description = p.description ?? '';
        this.stationId = p.station_id ?? null;
        this.assignee = p.assigned_to ?? null;
        this.due = new Date(p.due_at ?? Date.now() + 24 * HOUR);
        this.error.set(null);
      });
    });
  }

  protected save(): void {
    if (!this.title.trim() || this.saving()) return;
    this.saving.set(true);
    const p = this.prefill() ?? {};
    this.api
      .createWorkOrder({
        type: this.type,
        title: this.title,
        description: this.description,
        priority: this.priority,
        station_id: this.stationId,
        citizen_report_id: p.citizen_report_id ?? null,
        alert_id: p.alert_id ?? null,
        location: p.location ?? null,
        assigned_to: this.assignee,
        due_at: this.due?.toISOString() ?? null,
      })
      .subscribe({
        next: (o) => {
          this.saving.set(false);
          this.visible.set(false);
          this.created.emit(o);
        },
        error: (e: Error) => {
          this.saving.set(false);
          this.error.set(e.message);
        },
      });
  }
}
