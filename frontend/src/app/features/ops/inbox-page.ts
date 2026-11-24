import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { SelectButton } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { Textarea } from 'primeng/textarea';
import { OpsApi } from '../../core/api/ops-api';
import { CitizenReport, NewWorkOrder, Priority, ReportStatus, ReportType, WorkOrder } from '../../core/models/ops.models';
import { StationsService } from '../../core/services/stations.service';
import { MapPoint, MiniMap } from '../../shared/components/mini-map';
import { Pill } from '../../shared/components/pill';
import { formatCoords, timeAgo } from '../../shared/utils/format.util';
import { REPORT_STATUS_META, REPORT_TYPE_META } from '../../shared/utils/ops.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { WorkOrderDialog } from './work-order-dialog';

type Filter = 'pending' | 'active' | 'closed' | 'all';

/** Default priority of the order created from a report (prototype criterion: health risk first). */
const PRIORITY_BY_TYPE: Record<ReportType, Priority> = { dead_fish: 'urgent', discharge: 'high', foam: 'high', odor: 'normal', trash: 'normal', other: 'normal' };

@Component({
  selector: 'app-inbox-page',
  imports: [DatePipe, FormsModule, RouterLink, Button, Dialog, SelectButton, TableModule, Textarea, MiniMap, Pill, WorkOrderDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ops.scss',
  template: `
    <div class="page">
      <div class="head">
        <div>
          <h1 class="page-title">Reportes ciudadanos</h1>
          <p class="page-sub">Valida lo que reporta la comunidad y conviértelo en órdenes de trabajo para las brigadas.</p>
        </div>
        <p-button icon="pi pi-refresh" label="Actualizar" severity="secondary" [outlined]="true" size="small" (onClick)="res.reload()" />
      </div>

      <div class="toolbar">
        <p-selectbutton [options]="filters" [ngModel]="filter()" (ngModelChange)="filter.set($event)" optionLabel="label" optionValue="value" [allowEmpty]="false" size="small" ariaLabel="Filtrar" />
        <span class="count muted">{{ rows().length }} reportes · {{ newCount() }} por revisar</span>
      </div>

      <div class="split">
        <div class="rm-card" style="padding:0; overflow:hidden">
          <p-table [value]="rows()" [rows]="10" [paginator]="rows().length > 10" dataKey="id" [loading]="res.isLoading()" styleClass="p-datatable-sm" [tableStyle]="{ 'min-width': '620px' }">
            <ng-template #header>
              <tr><th></th><th>Reporte</th><th>Estado</th><th>Recibido</th><th></th></tr>
            </ng-template>
            <ng-template #body let-r>
              <tr class="clickable" [class.sel]="r.id === selectedId()" (click)="selectedId.set(r.id)">
                <td>@if (r.photo) { <img class="thumb" [src]="r.photo" alt="" /> } @else { <span class="thumb empty-thumb"><i [class]="typeMeta[r.type].icon"></i></span> }</td>
                <td><div class="cell-title"><strong><i [class]="typeMeta[r.type].icon" [style.color]="typeMeta[r.type].color"></i> {{ typeMeta[r.type].label }}</strong><small class="muted">{{ r.folio }} · {{ stationName(r.station_id) }}</small></div></td>
                <td><app-pill [label]="statusMeta[r.status].label" [color]="statusMeta[r.status].color" [bg]="statusMeta[r.status].bg" /></td>
                <td class="muted small">{{ ago(r.created_at) }}</td>
                <td><i class="pi pi-chevron-right muted"></i></td>
              </tr>
            </ng-template>
            <ng-template #emptymessage><tr><td colspan="5" class="empty">No hay reportes con este filtro.</td></tr></ng-template>
          </p-table>
        </div>

        <aside class="stack">
          <app-mini-map class="map-md" [points]="points()" [selectedId]="selectedId()" (pointClick)="selectedId.set($event)" />
          @if (selected(); as r) {
            <section class="rm-card stack">
              <div class="row">
                <strong>{{ r.folio }}</strong>
                <app-pill [label]="statusMeta[r.status].label" [color]="statusMeta[r.status].color" [bg]="statusMeta[r.status].bg" />
                <span class="spacer muted small">{{ r.created_at | date: 'dd/MM/yyyy HH:mm' }}</span>
              </div>
              <p class="m0"><i [class]="typeMeta[r.type].icon" [style.color]="typeMeta[r.type].color"></i> <strong>{{ typeMeta[r.type].label }}</strong></p>
              @if (r.photo) { <img class="photo" [src]="r.photo" alt="Foto del reporte" /> }
              @if (r.description) { <p class="m0">"{{ r.description }}"</p> }
              <p class="m0 muted small"><i class="pi pi-map-marker"></i> {{ coords(r.latitude, r.longitude) }}@if (r.accuracy) { · ±{{ r.accuracy }} m } · {{ stationName(r.station_id) }}</p>
              @if (r.public_note) { <p class="m0 small calib">{{ r.public_note }}</p> }

              @if (r.status === 'new') {
                <div class="row" style="justify-content:flex-end">
                  <p-button label="Descartar" icon="pi pi-times" severity="secondary" [outlined]="true" size="small" (onClick)="rejectOpen.set(true)" />
                  <p-button label="Validar y crear orden" icon="pi pi-check" size="small" (onClick)="openOrder(r)" />
                </div>
              } @else if (r.status === 'verified' && !r.work_order_id) {
                <p-button label="Crear orden" icon="pi pi-plus" size="small" (onClick)="openOrder(r)" />
              } @else if (r.work_order_id) {
                <a class="p-button p-button-sm p-button-outlined link-btn" [routerLink]="['/operaciones/tarea', r.work_order_id]"><i class="pi pi-external-link"></i> Ver orden de trabajo</a>
              }
            </section>
          } @else {
            <div class="rm-card empty">Selecciona un reporte de la lista o del mapa.</div>
          }
        </aside>
      </div>
    </div>

    <app-work-order-dialog [(visible)]="orderOpen" [prefill]="prefill()" (created)="onCreated($event)" />

    <p-dialog header="Descartar reporte" [(visible)]="rejectOpen" [modal]="true" [style]="{ width: 'min(460px, 96vw)' }" appendTo="body">
      <label class="field">Motivo (lo verá el ciudadano)
        <textarea pTextarea rows="3" [(ngModel)]="rejectNote" [autoResize]="true" placeholder="Ej. Es un reporte duplicado de RC-0003, ya se está atendiendo."></textarea>
      </label>
      <ng-template #footer>
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="rejectOpen.set(false)" />
        <p-button label="Descartar" icon="pi pi-times" severity="danger" [disabled]="!rejectNote.trim()" (onClick)="reject()" />
      </ng-template>
    </p-dialog>
  `,
})
export class InboxPage {
  private readonly api = inject(OpsApi);
  private readonly stations = inject(StationsService);
  private readonly toast = inject(MessageService);

  /** Indexed from `p-table` rows (typed `any`). */
  protected readonly typeMeta: Record<string, (typeof REPORT_TYPE_META)[keyof typeof REPORT_TYPE_META]> = REPORT_TYPE_META;
  /** Indexed from `p-table` rows (typed `any`). */
  protected readonly statusMeta: Record<string, (typeof REPORT_STATUS_META)[keyof typeof REPORT_STATUS_META]> = REPORT_STATUS_META;
  protected readonly coords = formatCoords;
  protected readonly ago = timeAgo;
  protected readonly filters = [
    { label: 'Por revisar', value: 'pending' },
    { label: 'En atención', value: 'active' },
    { label: 'Cerrados', value: 'closed' },
    { label: 'Todos', value: 'all' },
  ];
  private readonly groups: Record<Filter, ReportStatus[] | null> = {
    pending: ['new'],
    active: ['verified', 'in_progress'],
    closed: ['resolved', 'rejected'],
    all: null,
  };

  protected readonly filter = signal<Filter>('pending');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly res = rxResource({ stream: () => this.api.citizenReports() });
  private readonly all = computed(() => valueOrUndefined(this.res) ?? []);
  protected readonly rows = computed(() => {
    const g = this.groups[this.filter()];
    return g ? this.all().filter((r) => g.includes(r.status)) : this.all();
  });
  protected readonly newCount = computed(() => this.all().filter((r) => r.status === 'new').length);
  protected readonly selected = computed(() => this.all().find((r) => r.id === this.selectedId()) ?? null);
  protected readonly points = computed<MapPoint[]>(() =>
    this.rows().map((r) => ({ id: r.id, latitude: r.latitude, longitude: r.longitude, color: REPORT_TYPE_META[r.type].color, label: `${r.folio} · ${REPORT_TYPE_META[r.type].label}` })),
  );

  protected readonly orderOpen = signal(false);
  protected readonly prefill = signal<Partial<NewWorkOrder> | null>(null);
  protected readonly rejectOpen = signal(false);
  protected rejectNote = '';

  constructor() {
    this.api.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e.type === 'citizen_report_created') this.res.reload();
    });
  }

  protected stationName(id: string | null): string {
    return id ? this.stations.name(id) : 'Fuera de estaciones';
  }

  protected openOrder(r: CitizenReport): void {
    const label = REPORT_TYPE_META[r.type].label;
    this.prefill.set({
      type: 'citizen_report',
      title: `${label} (${r.folio})`,
      description: r.description || `Atender reporte ciudadano de ${label.toLowerCase()}.`,
      priority: PRIORITY_BY_TYPE[r.type],
      station_id: r.station_id,
      citizen_report_id: r.id,
      location: { latitude: r.latitude, longitude: r.longitude },
    });
    this.orderOpen.set(true);
  }

  protected onCreated(o: WorkOrder): void {
    this.toast.add({ key: 'app', severity: 'success', summary: `Orden ${o.folio} creada`, detail: o.assigned_name ? `Asignada a ${o.assigned_name}` : 'Sin asignar', life: 4000 });
    this.res.reload();
  }

  protected reject(): void {
    const r = this.selected();
    if (!r) return;
    this.api.patchCitizenReport(r.id, { status: 'rejected', public_note: this.rejectNote.trim() }).subscribe(() => {
      this.rejectOpen.set(false);
      this.rejectNote = '';
      this.toast.add({ key: 'app', severity: 'info', summary: `Reporte ${r.folio} descartado`, life: 3500 });
      this.res.reload();
    });
  }
}
