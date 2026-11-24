import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TableModule } from 'primeng/table';
import { OpsApi } from '../../core/api/ops-api';
import { WorkOrder } from '../../core/models/ops.models';
import { KpiTile } from '../../shared/components/kpi-tile';
import { fmt0, fmt1 } from '../../shared/utils/format.util';
import { OPEN_WO_STATUSES, WO_TYPE_META, WO_TYPES } from '../../shared/utils/ops.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';

const HOUR = 3_600_000;
const closed = (o: WorkOrder) => o.status === 'done' || o.status === 'verified';
/** Hours from creation to completion (attention time). */
const hours = (o: WorkOrder) => (o.completed_at ? (new Date(o.completed_at).getTime() - new Date(o.created_at).getTime()) / HOUR : null);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

@Component({
  selector: 'app-team-page',
  imports: [TableModule, KpiTile],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ops.scss',
  template: `
    <div class="page">
      <div>
        <h1 class="page-title">Desempeño del equipo</h1>
        <p class="page-sub">Indicadores de atención de las brigadas de campo (todas las órdenes registradas).</p>
      </div>

      <div class="kpis">
        <app-kpi-tile label="Órdenes abiertas" [value]="n0(k().open)" icon="pi pi-inbox" [sub]="k().unassigned + ' sin asignar'" />
        <app-kpi-tile label="Terminadas" [value]="n0(k().closed)" icon="pi pi-check-circle" [sub]="k().review + ' por verificar'" />
        <app-kpi-tile label="Tiempo promedio de atención" [value]="k().avgHours === null ? '—' : n1(k().avgHours!)" unit="h" icon="pi pi-clock" sub="De la creación al cierre" />
        <app-kpi-tile label="Basura retirada por brigadas" [value]="n1(k().kg)" unit="kg" icon="pi pi-trash" sub="Registrada en órdenes de recolección" />
        <app-kpi-tile label="Reportes ciudadanos atendidos" [value]="n0(k().reportsDone)" icon="pi pi-megaphone" [sub]="'de ' + k().reportsTotal + ' con orden'" />
      </div>

      <section class="rm-card" style="padding:0; overflow:hidden">
        <h2 class="rm-card-title" style="padding: 1rem 1.1rem 0">Por técnico</h2>
        <p-table [value]="byTech()" styleClass="p-datatable-sm" [tableStyle]="{ 'min-width': '620px' }">
          <ng-template #header><tr><th>Técnico</th><th>Pendientes</th><th>Terminadas</th><th>Atención prom.</th><th>Basura (kg)</th><th style="width: 30%">Avance</th></tr></ng-template>
          <ng-template #body let-t>
            <tr>
              <td><strong>{{ t.name }}</strong></td>
              <td>{{ t.open }}</td>
              <td>{{ t.closed }}</td>
              <td>{{ t.avgHours === null ? '—' : n1(t.avgHours) + ' h' }}</td>
              <td>{{ n1(t.kg) }}</td>
              <td><div class="bar" [attr.aria-label]="t.pct + '% terminado'"><span [style.width.%]="t.pct"></span></div></td>
            </tr>
          </ng-template>
          <ng-template #emptymessage><tr><td colspan="6" class="empty">Sin técnicos con órdenes.</td></tr></ng-template>
        </p-table>
      </section>

      <section class="rm-card">
        <h2 class="rm-card-title">Órdenes por tipo de labor</h2>
        <ul class="suggest">
          @for (t of byType(); track t.type) {
            <li>
              <i [class]="typeMeta[t.type].icon" [style.color]="typeMeta[t.type].color" aria-hidden="true"></i>
              <div><strong>{{ typeMeta[t.type].label }}</strong><span class="muted">{{ t.closed }} terminadas · {{ t.open }} abiertas</span></div>
            </li>
          }
        </ul>
      </section>
    </div>
  `,
})
export class TeamPage {
  private readonly api = inject(OpsApi);
  protected readonly typeMeta = WO_TYPE_META;
  protected readonly n0 = fmt0;
  protected readonly n1 = fmt1;

  private readonly res = rxResource({ stream: () => this.api.workOrders() });
  private readonly orders = computed(() => (valueOrUndefined(this.res) ?? []).filter((o) => o.status !== 'cancelled'));

  protected readonly k = computed(() => {
    const os = this.orders();
    const reports = os.filter((o) => o.type === 'citizen_report');
    return {
      open: os.filter((o) => o.status === 'pending' || OPEN_WO_STATUSES.includes(o.status)).length,
      unassigned: os.filter((o) => o.status === 'pending').length,
      closed: os.filter(closed).length,
      review: os.filter((o) => o.status === 'done').length,
      avgHours: avg(os.map(hours).filter((h): h is number => h !== null)),
      kg: os.filter(closed).reduce((a, o) => a + (o.result?.weight_kg ?? 0), 0),
      reportsDone: reports.filter(closed).length,
      reportsTotal: reports.length,
    };
  });

  protected readonly byTech = computed(() => {
    const m = new Map<string, WorkOrder[]>();
    for (const o of this.orders()) if (o.assigned_to) m.set(o.assigned_to, [...(m.get(o.assigned_to) ?? []), o]);
    return [...m.values()]
      .map((os) => {
        const done = os.filter(closed);
        return {
          name: os[0].assigned_name ?? '—',
          open: os.filter((o) => OPEN_WO_STATUSES.includes(o.status)).length,
          closed: done.length,
          avgHours: avg(done.map(hours).filter((h): h is number => h !== null)),
          kg: done.reduce((a, o) => a + (o.result?.weight_kg ?? 0), 0),
          pct: Math.round((done.length / os.length) * 100),
        };
      })
      .sort((a, b) => b.closed - a.closed);
  });

  protected readonly byType = computed(() =>
    WO_TYPES.map((type) => {
      const os = this.orders().filter((o) => o.type === type);
      return { type, closed: os.filter(closed).length, open: os.length - os.filter(closed).length };
    }),
  );
}
