import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { Button } from 'primeng/button';
import { Checkbox } from 'primeng/checkbox';
import { InputNumber } from 'primeng/inputnumber';
import { Message } from 'primeng/message';
import { Select } from 'primeng/select';
import { SelectButton } from 'primeng/selectbutton';
import { Textarea } from 'primeng/textarea';
import { of } from 'rxjs';
import { OpsApi } from '../../core/api/ops-api';
import { RioApi } from '../../core/api/rio-api';
import { typeLabel, locationLabel } from '../../core/api/labels';
import { AuthService } from '../../core/auth/auth.service';
import { ChecklistItem, Evidence, WorkOrder, WorkOrderPatch, WorkResult } from '../../core/models/ops.models';
import { WasteType } from '../../core/models/rio.models';
import { GeoService } from '../../core/services/geo.service';
import { WorkOrdersService } from '../../core/services/work-orders.service';
import { AiAnalysis } from '../../shared/components/ai-analysis';
import { MiniMap } from '../../shared/components/mini-map';
import { PhotoInput } from '../../shared/components/photo-input';
import { Pill } from '../../shared/components/pill';
import { formatCoords, timeAgo } from '../../shared/utils/format.util';
import { PRIORITY_META, REPORT_TYPE_META, WO_STATUS_META, WO_TYPE_META, calibrationOffset, directionsUrl } from '../../shared/utils/ops.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { WASTE_META, WASTE_TYPES } from '../../shared/utils/wqi.util';

@Component({
  selector: 'app-task-page',
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink, Button, Checkbox, InputNumber, Message, Select, SelectButton, Textarea, AiAnalysis, MiniMap, PhotoInput, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ops.scss',
  templateUrl: './task-page.html',
})
export class TaskPage {
  private readonly api = inject(OpsApi);
  private readonly rio = inject(RioApi);
  private readonly geo = inject(GeoService);
  private readonly wo = inject(WorkOrdersService);
  private readonly toast = inject(MessageService);
  protected readonly auth = inject(AuthService);

  readonly id = input.required<string>();

  protected readonly typeMeta = WO_TYPE_META;
  protected readonly statusMeta = WO_STATUS_META;
  protected readonly prio = PRIORITY_META;
  protected readonly reportMeta = REPORT_TYPE_META;
  protected readonly wasteMeta = WASTE_META;
  protected readonly coords = formatCoords;
  protected readonly ago = timeAgo;
  protected readonly dirUrl = directionsUrl;
  protected readonly wasteOptions = WASTE_TYPES.map((v) => ({ value: v, label: WASTE_META[v].label }));
  protected readonly confirmOptions = [
    { label: 'Sí, el problema existía', value: true },
    { label: 'No se encontró', value: false },
  ];

  protected readonly res = rxResource({ params: () => this.id(), stream: ({ params }) => this.api.workOrder(params) });
  protected readonly order = signal<WorkOrder | null>(null);

  /** Citizen report attended by this order (photo + description). */
  private readonly reportRes = rxResource({
    params: () => this.order()?.citizen_report_id ?? undefined,
    stream: ({ params }) => this.api.citizenReports(),
  });
  protected readonly report = computed(() => (valueOrUndefined(this.reportRes) ?? []).find((r) => r.id === this.order()?.citizen_report_id) ?? null);

  /** Sensors of the station (calibration orders). */
  private readonly sensorsRes = rxResource({
    params: () => (this.order()?.type === 'calibration' ? this.order()?.station_id ?? undefined : undefined),
    stream: ({ params }) => (params ? this.rio.sensorsHealth({ station_id: params }) : of([])),
  });
  protected readonly sensorOptions = computed(() =>
    (valueOrUndefined(this.sensorsRes) ?? []).map((s) => ({ value: s.sensor_id, label: `${typeLabel(s.parameter)} · ${locationLabel(s.position)}`, last: s.last_reading?.value ?? null })),
  );

  // ── Editable state ────────────────────────────────────────────────────────
  protected readonly checklist = signal<ChecklistItem[]>([]);
  protected readonly before = signal<string | null>(null);
  protected readonly after = signal<string | null>(null);
  protected notes = '';
  protected confirmed: boolean | null = null;
  protected actionTaken = '';
  protected wasteType: WasteType = 'plastic';
  protected weightKg: number | null = null;
  protected itemsCount: number | null = null;
  protected sensorId: string | null = null;
  protected referenceValue: number | null = 7;
  protected measuredValue: number | null = null;

  protected readonly busy = signal<'start' | 'save' | 'finish' | 'verify' | 'reopen' | 'cancel' | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly isMine = computed(() => this.order()?.assigned_to === this.auth.user()?.id);
  protected readonly canWork = computed(() => this.order()?.status === 'in_progress' && (this.isMine() || this.auth.isManager()));
  protected readonly checklistDone = computed(() => this.checklist().filter((c) => c.done).length);

  constructor() {
    effect(() => {
      const o = valueOrUndefined(this.res);
      if (!o) return;
      untracked(() => this.load(o));
    });
  }

  private load(o: WorkOrder): void {
    this.order.set(o);
    this.checklist.set(o.checklist.map((c) => ({ ...c })));
    this.before.set(o.evidence.find((e) => e.kind === 'before')?.photo ?? null);
    this.after.set(o.evidence.find((e) => e.kind === 'after')?.photo ?? null);
    this.notes = o.notes;
    const r = o.result ?? {};
    this.confirmed = r.confirmed ?? null;
    this.actionTaken = r.action_taken ?? '';
    this.wasteType = r.waste_type ?? 'plastic';
    this.weightKg = r.weight_kg ?? null;
    this.itemsCount = r.items_count ?? null;
    this.sensorId = r.sensor_id ?? null;
    this.referenceValue = r.reference_value ?? 7;
    this.measuredValue = r.measured_value ?? null;
  }

  protected toggle(i: number, done: boolean): void {
    this.checklist.update((l) => l.map((c, j) => (j === i ? { ...c, done } : c)));
  }

  protected offset(): number | null {
    return this.referenceValue !== null && this.measuredValue !== null ? calibrationOffset(this.referenceValue, this.measuredValue) : null;
  }

  protected onSensor(id: string | null): void {
    this.sensorId = id;
    const last = this.sensorOptions().find((s) => s.value === id)?.last;
    if (last !== null && last !== undefined && this.measuredValue === null) this.measuredValue = Math.round(last * 100) / 100;
  }

  private result(): WorkResult {
    const o = this.order()!;
    switch (o.type) {
      case 'citizen_report':
        return { confirmed: this.confirmed ?? undefined, action_taken: this.actionTaken.trim() };
      case 'waste_collection':
        return { waste_type: this.wasteType, weight_kg: this.weightKg ?? undefined, items_count: this.itemsCount ?? undefined };
      case 'calibration': {
        const s = this.sensorOptions().find((x) => x.value === this.sensorId);
        return {
          sensor_id: this.sensorId ?? undefined,
          sensor_name: s?.label,
          reference_value: this.referenceValue ?? undefined,
          measured_value: this.measuredValue ?? undefined,
          calibration_offset: this.offset() ?? undefined,
          calibration_factor: 1,
        };
      }
      default:
        return {};
    }
  }

  private evidence(): Evidence[] {
    const ts = new Date().toISOString();
    const prev = this.order()!.evidence;
    const keep = (kind: Evidence['kind'], photo: string | null) => (photo ? [prev.find((e) => e.kind === kind && e.photo === photo) ?? { kind, photo, ts }] : []);
    return [...keep('before', this.before()), ...keep('after', this.after())];
  }

  private patch(): WorkOrderPatch {
    return { checklist: this.checklist(), evidence: this.evidence(), notes: this.notes.trim(), result: this.result() };
  }

  /** Reasons that block closing the order (prototype rules; shown to the technician). */
  protected missing(): string[] {
    const o = this.order();
    if (!o) return [];
    const m: string[] = [];
    if (o.type === 'maintenance' && this.checklistDone() < this.checklist().length) m.push('Completa la lista de verificación.');
    if (o.type === 'waste_collection' && !(this.weightKg && this.weightKg > 0)) m.push('Registra los kg recolectados.');
    if (o.type === 'calibration' && (!this.sensorId || this.offset() === null)) m.push('Elige el sensor y registra la lectura con la solución patrón.');
    if (o.type === 'citizen_report') {
      if (this.confirmed === null) m.push('Indica si el problema existía.');
      if (!this.actionTaken.trim()) m.push('Describe la acción realizada (la verá el ciudadano).');
    }
    if (!this.after() && o.type !== 'calibration') m.push('Agrega la foto de evidencia "después".');
    return m;
  }

  protected async start(): Promise<void> {
    const o = this.order();
    if (!o) return;
    this.busy.set('start');
    this.error.set(null);
    let at = null;
    try {
      at = await this.geo.current();
    } catch {
      this.toast.add({ key: 'app', severity: 'warn', summary: 'Sin GPS', detail: 'La tarea se inicia sin registrar la ubicación.', life: 4000 });
    }
    this.wo.start(o, at).subscribe({
      next: (r) => this.done(r, 'Tarea iniciada'),
      error: (e: Error) => this.fail(e),
    });
  }

  protected save(): void {
    const o = this.order();
    if (!o) return;
    this.busy.set('save');
    this.api.patchWorkOrder(o.id, this.patch()).subscribe({
      next: (order) => this.done({ order, warning: null }, 'Avance guardado'),
      error: (e: Error) => this.fail(e),
    });
  }

  protected finish(): void {
    const o = this.order();
    if (!o || this.missing().length) return;
    this.busy.set('finish');
    this.wo.finish(o, this.patch()).subscribe({
      next: (r) => this.done(r, 'Tarea terminada. El supervisor la verificará.'),
      error: (e: Error) => this.fail(e),
    });
  }

  protected verify(): void {
    this.simple('verify', { status: 'verified' }, 'Tarea verificada');
  }

  protected reopen(): void {
    this.simple('reopen', { status: 'in_progress' }, 'Tarea reabierta');
  }

  protected cancel(): void {
    const o = this.order();
    if (!o) return;
    this.busy.set('cancel');
    this.wo.cancel(o).subscribe({ next: (r) => this.done(r, 'Orden cancelada'), error: (e: Error) => this.fail(e) });
  }

  private simple(kind: 'verify' | 'reopen', patch: WorkOrderPatch, msg: string): void {
    const o = this.order();
    if (!o) return;
    this.busy.set(kind);
    this.api.patchWorkOrder(o.id, patch).subscribe({
      next: (order) => this.done({ order, warning: null }, msg),
      error: (e: Error) => this.fail(e),
    });
  }

  private done(r: { order: WorkOrder; warning: string | null }, msg: string): void {
    this.busy.set(null);
    this.load(r.order);
    this.toast.add({ key: 'app', severity: 'success', summary: msg, life: 3500 });
    if (r.warning) this.toast.add({ key: 'app', severity: 'warn', summary: 'Atención', detail: r.warning, life: 7000 });
  }

  private fail(e: Error): void {
    this.busy.set(null);
    this.error.set(e.message || 'No se pudo completar la acción.');
  }
}
