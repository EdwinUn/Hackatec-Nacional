import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { Button } from 'primeng/button';
import { Select } from 'primeng/select';
import { SelectButton } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { OpsApi } from '../../core/api/ops-api';
import { RioApi } from '../../core/api/rio-api';
import { typeLabel, locationLabel } from '../../core/api/labels';
import { NewWorkOrder, WorkOrder, WorkOrderStatus } from '../../core/models/ops.models';
import { StationsService } from '../../core/services/stations.service';
import { Pill } from '../../shared/components/pill';
import { timeAgo } from '../../shared/utils/format.util';
import { PRIORITY_META, WO_STATUS_META, WO_TYPE_META, compareOrders } from '../../shared/utils/ops.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { SENSOR_STATUS_META, SEVERITY_META } from '../../shared/utils/wqi.util';
import { WorkOrderDialog } from './work-order-dialog';

type Filter = 'open' | 'review' | 'closed' | 'all';

interface Suggestion {
  key: string;
  icon: string;
  color: string;
  title: string;
  detail: string;
  prefill: Partial<NewWorkOrder>;
}

@Component({
  selector: 'app-orders-page',
  imports: [DatePipe, FormsModule, RouterLink, Button, Select, SelectButton, TableModule, Pill, WorkOrderDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ops.scss',
  template: `
    <div class="page">
      <div class="head">
        <div>
          <h1 class="page-title">Órdenes de trabajo</h1>
          <p class="page-sub">Asigna labores a las brigadas de campo y verifica el trabajo terminado.</p>
        </div>
        <div class="row">
          <p-button icon="pi pi-refresh" severity="secondary" [text]="true" ariaLabel="Actualizar" (onClick)="res.reload()" />
          <p-button label="Nueva orden" icon="pi pi-plus" (onClick)="open(null)" />
        </div>
      </div>

      <div class="split orders">
        <section class="stack">
          <div class="toolbar">
            <p-selectbutton [options]="filters" [ngModel]="filter()" (ngModelChange)="filter.set($event)" optionLabel="label" optionValue="value" [allowEmpty]="false" size="small" ariaLabel="Filtrar" />
            <span class="count muted">{{ rows().length }} órdenes</span>
          </div>
          <div class="rm-card" style="padding:0; overflow:hidden">
            <p-table [value]="rows()" dataKey="id" [rows]="12" [paginator]="rows().length > 12" [loading]="res.isLoading()" styleClass="p-datatable-sm" [tableStyle]="{ 'min-width': '760px' }">
              <ng-template #header>
                <tr><th>Orden</th><th>Prioridad</th><th>Estado</th><th style="width: 200px">Asignada a</th><th>Límite</th><th></th></tr>
              </ng-template>
              <ng-template #body let-o>
                <tr>
                  <td><div class="cell-title"><strong><i [class]="typeMeta[o.type].icon" [style.color]="typeMeta[o.type].color"></i> {{ o.title }}</strong><small class="muted">{{ o.folio }} · {{ o.station_name ?? 'Sin estación' }}</small></div></td>
                  <td><app-pill [label]="prio[o.priority].label" [color]="prio[o.priority].color" [bg]="prio[o.priority].bg" /></td>
                  <td><app-pill [label]="statusMeta[o.status].label" [color]="statusMeta[o.status].color" [bg]="statusMeta[o.status].bg" /></td>
                  <td>
                    @if (o.status === 'pending' || o.status === 'assigned') {
                      <p-select [options]="technicians()" [ngModel]="o.assigned_to" (ngModelChange)="assign(o, $event)" optionLabel="name" optionValue="id" placeholder="Asignar…" [showClear]="true" size="small" appendTo="body" [style]="{ width: '100%' }" />
                    } @else { <span class="small">{{ o.assigned_name ?? '—' }}</span> }
                  </td>
                  <td class="small" [class.late]="isLate(o)">{{ o.due_at ? (o.due_at | date: 'dd/MM HH:mm') : '—' }}</td>
                  <td><p-button [label]="o.status === 'done' ? 'Revisar' : 'Abrir'" size="small" [text]="o.status !== 'done'" [routerLink]="['/operaciones/tarea', o.id]" /></td>
                </tr>
              </ng-template>
              <ng-template #emptymessage><tr><td colspan="6" class="empty">No hay órdenes con este filtro.</td></tr></ng-template>
            </p-table>
          </div>
        </section>

        <aside class="rm-card stack">
          <h2 class="rm-card-title"><i class="pi pi-sparkles"></i> Sugerencias del sistema</h2>
          <p class="m0 muted small">Generadas a partir de alertas críticas abiertas y del estado de los sensores, sin orden asociada.</p>
          <ul class="suggest">
            @for (s of suggestions(); track s.key) {
              <li>
                <i [class]="s.icon" [style.color]="s.color" aria-hidden="true"></i>
                <div><strong>{{ s.title }}</strong><span class="muted">{{ s.detail }}</span></div>
                <p-button icon="pi pi-plus" size="small" [rounded]="true" [outlined]="true" ariaLabel="Crear orden" (onClick)="open(s.prefill)" />
              </li>
            } @empty {
              <li class="muted"><i class="pi pi-check-circle" style="color: var(--rm-green)"></i> Sin pendientes detectados.</li>
            }
          </ul>
        </aside>
      </div>
    </div>

    <app-work-order-dialog [(visible)]="dialogOpen" [prefill]="prefill()" (created)="onCreated($event)" />
  `,
})
export class OrdersPage {
  private readonly api = inject(OpsApi);
  private readonly rio = inject(RioApi);
  private readonly stations = inject(StationsService);
  private readonly toast = inject(MessageService);
  private readonly router = inject(Router);

  /** `?alerta=<id>` opens the dialog pre-filled from an alert (link from the Alertas screen). */
  readonly alerta = input<string | undefined>();

  /** Indexed from `p-table` rows (typed `any`). */
  protected readonly typeMeta: Record<string, (typeof WO_TYPE_META)[keyof typeof WO_TYPE_META]> = WO_TYPE_META;
  /** Indexed from `p-table` rows (typed `any`). */
  protected readonly statusMeta: Record<string, (typeof WO_STATUS_META)[keyof typeof WO_STATUS_META]> = WO_STATUS_META;
  /** Indexed from `p-table` rows (typed `any`). */
  protected readonly prio: Record<string, (typeof PRIORITY_META)[keyof typeof PRIORITY_META]> = PRIORITY_META;
  protected readonly ago = timeAgo;
  protected readonly filters = [
    { label: 'Abiertas', value: 'open' },
    { label: 'Por verificar', value: 'review' },
    { label: 'Cerradas', value: 'closed' },
    { label: 'Todas', value: 'all' },
  ];
  private readonly groups: Record<Filter, WorkOrderStatus[] | null> = {
    open: ['pending', 'assigned', 'in_progress'],
    review: ['done'],
    closed: ['verified', 'cancelled'],
    all: null,
  };

  protected readonly filter = signal<Filter>('open');
  protected readonly res = rxResource({ stream: () => this.api.workOrders() });
  private readonly all = computed(() => valueOrUndefined(this.res) ?? []);
  protected readonly rows = computed(() => {
    const g = this.groups[this.filter()];
    return (g ? this.all().filter((o) => g.includes(o.status)) : [...this.all()]).sort(compareOrders);
  });

  private readonly usersRes = rxResource({ stream: () => this.api.users() });
  protected readonly technicians = computed(() => (valueOrUndefined(this.usersRes) ?? []).filter((u) => u.role === 'technician' && u.active));

  private readonly alertsRes = rxResource({ stream: () => this.rio.alerts({ status: 'open', severity: 'critical', limit: 20, offset: 0 }) });
  private readonly sensorsRes = rxResource({ stream: () => this.rio.sensorsHealth({}) });

  protected readonly suggestions = computed<Suggestion[]>(() => {
    const active = this.all().filter((o) => !['verified', 'cancelled'].includes(o.status));
    const out: Suggestion[] = [];
    for (const a of valueOrUndefined(this.alertsRes)?.items ?? []) {
      if (active.some((o) => o.alert_id === a.id)) continue;
      out.push({
        key: 'a-' + a.id,
        icon: SEVERITY_META.critical.icon,
        color: SEVERITY_META.critical.color,
        title: `Alerta crítica · ${a.station_name}`,
        detail: a.message,
        prefill: { type: 'maintenance', priority: 'urgent', title: `Revisar alerta: ${a.message}`.slice(0, 120), description: `Alerta crítica abierta ${timeAgo(a.created_at)}. Revisar la boya y el entorno.`, station_id: a.station_id, alert_id: a.id },
      });
    }
    for (const s of valueOrUndefined(this.sensorsRes) ?? []) {
      if (s.status === 'ok') continue;
      if (active.some((o) => o.type === 'calibration' && o.station_id === s.station_id)) continue;
      const name = `${typeLabel(s.parameter)} (${locationLabel(s.position)})`;
      const station = this.stations.name(s.station_id);
      out.push({
        key: 's-' + s.sensor_id,
        icon: 'pi pi-sliders-h',
        color: SENSOR_STATUS_META[s.status].color,
        title: `Sensor ${name}: ${SENSOR_STATUS_META[s.status].label.toLowerCase()}`,
        detail: station,
        prefill: {
          type: 'calibration',
          priority: s.status === 'fault' || s.status === 'offline' ? 'high' : 'normal',
          title: `Revisar y calibrar sensor de ${name}`,
          description: `El sensor reporta estado "${SENSOR_STATUS_META[s.status].label}" (calidad de señal ${s.signal_quality_pct}%).`,
          station_id: s.station_id,
        },
      });
    }
    return out.slice(0, 8);
  });

  protected readonly dialogOpen = signal(false);
  protected readonly prefill = signal<Partial<NewWorkOrder> | null>(null);

  constructor() {
    effect(() => {
      const id = this.alerta();
      const alerts = valueOrUndefined(this.alertsRes);
      if (!id || !alerts) return;
      untracked(() => {
        const s = this.suggestions().find((x) => x.key === 'a-' + id);
        this.open(s?.prefill ?? { type: 'maintenance', priority: 'high', alert_id: id, title: 'Atender alerta' });
        void this.router.navigate([], { queryParams: { alerta: null }, queryParamsHandling: 'merge', replaceUrl: true });
      });
    });
  }

  protected open(p: Partial<NewWorkOrder> | null): void {
    this.prefill.set(p);
    this.dialogOpen.set(true);
  }

  protected isLate(o: WorkOrder): boolean {
    return !!o.due_at && new Date(o.due_at).getTime() < Date.now() && ['pending', 'assigned', 'in_progress'].includes(o.status);
  }

  protected assign(o: WorkOrder, userId: string | null): void {
    this.api.patchWorkOrder(o.id, { assigned_to: userId }).subscribe((u) => {
      this.toast.add({ key: 'app', severity: 'success', summary: `${u.folio} ${u.assigned_name ? 'asignada a ' + u.assigned_name : 'sin asignar'}`, life: 3000 });
      this.res.reload();
    });
  }

  protected onCreated(o: WorkOrder): void {
    this.toast.add({ key: 'app', severity: 'success', summary: `Orden ${o.folio} creada`, detail: o.assigned_name ? `Asignada a ${o.assigned_name}` : 'Sin asignar', life: 4000 });
    this.res.reload();
  }
}
