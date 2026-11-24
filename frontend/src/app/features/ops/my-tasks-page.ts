import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { SelectButton } from 'primeng/selectbutton';
import { OpsApi } from '../../core/api/ops-api';
import { AuthService } from '../../core/auth/auth.service';
import { GeoPoint, WorkOrder } from '../../core/models/ops.models';
import { GeoService } from '../../core/services/geo.service';
import { Pill } from '../../shared/components/pill';
import { timeAgo } from '../../shared/utils/format.util';
import { OPEN_WO_STATUSES, PRIORITY_META, WO_STATUS_META, WO_TYPE_META, compareOrders, directionsUrl, distanceKm, formatDistance } from '../../shared/utils/ops.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';

type View = 'open' | 'closed';

@Component({
  selector: 'app-my-tasks-page',
  imports: [DatePipe, FormsModule, RouterLink, Button, SelectButton, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ops.scss',
  template: `
    <div class="page">
      <div class="head">
        <div>
          <h1 class="page-title">Mis tareas</h1>
          <p class="page-sub">Hola, {{ firstName() }}. Tienes {{ openCount() }} {{ openCount() === 1 ? 'tarea pendiente' : 'tareas pendientes' }}.</p>
        </div>
        <div class="row">
          <p-button icon="pi pi-map-marker" [label]="here() ? 'Ubicación actualizada' : 'Ordenar por cercanía'" severity="secondary" [outlined]="true" size="small" [loading]="locating()" (onClick)="locate()" />
          <p-button icon="pi pi-refresh" severity="secondary" [text]="true" size="small" ariaLabel="Actualizar" (onClick)="orders.reload()" />
        </div>
      </div>

      <p-selectbutton [options]="views" [ngModel]="view()" (ngModelChange)="view.set($event)" optionLabel="label" optionValue="value" [allowEmpty]="false" size="small" ariaLabel="Mostrar" />

      <div class="task-list" aria-live="polite">
        @for (o of list(); track o.id) {
          <article class="rm-card task" [style.border-left-color]="typeMeta[o.type].color">
            <header class="row">
              <i [class]="typeMeta[o.type].icon" [style.color]="typeMeta[o.type].color" aria-hidden="true"></i>
              <span class="muted small">{{ o.folio }} · {{ typeMeta[o.type].label }}</span>
              <span class="spacer"></span>
              <app-pill [label]="prio[o.priority].label" [color]="prio[o.priority].color" [bg]="prio[o.priority].bg" />
              <app-pill [label]="statusMeta[o.status].label" [color]="statusMeta[o.status].color" [bg]="statusMeta[o.status].bg" />
            </header>
            <h2>{{ o.title }}</h2>
            <p class="meta muted">
              @if (o.station_name) { <span><i class="pi pi-map-marker"></i> {{ o.station_name }}</span> }
              @if (distance(o); as d) { <span><i class="pi pi-directions"></i> {{ d }}</span> }
              @if (o.due_at && o.status !== 'done' && o.status !== 'verified') { <span [class.late]="isLate(o)"><i class="pi pi-clock"></i> {{ isLate(o) ? 'Vencida' : 'Para' }} {{ o.due_at | date: 'dd/MM HH:mm' }}</span> }
              @if (o.completed_at) { <span><i class="pi pi-check"></i> Terminada {{ ago(o.completed_at) }}</span> }
            </p>
            <footer class="row">
              @if (o.location; as loc) {
                <a class="p-button p-button-sm p-button-secondary p-button-outlined link-btn" [href]="dirUrl(loc)" target="_blank" rel="noopener"><i class="pi pi-directions"></i> Cómo llegar</a>
              }
              <p-button [label]="o.status === 'assigned' ? 'Comenzar' : o.status === 'in_progress' ? 'Continuar' : 'Ver detalle'" [icon]="o.status === 'assigned' ? 'pi pi-play' : 'pi pi-arrow-right'" size="small" [routerLink]="['/operaciones/tarea', o.id]" />
            </footer>
          </article>
        } @empty {
          @if (orders.isLoading()) {
            <div class="skeleton" style="height: 140px"></div>
            <div class="skeleton" style="height: 140px"></div>
          } @else {
            <div class="rm-card empty"><i class="pi pi-check-circle" aria-hidden="true"></i> {{ view() === 'open' ? 'No tienes tareas pendientes. ¡Buen trabajo!' : 'Aún no has cerrado tareas.' }}</div>
          }
        }
      </div>
    </div>
  `,
})
export class MyTasksPage {
  private readonly api = inject(OpsApi);
  private readonly auth = inject(AuthService);
  private readonly geo = inject(GeoService);

  protected readonly typeMeta = WO_TYPE_META;
  protected readonly statusMeta = WO_STATUS_META;
  protected readonly prio = PRIORITY_META;
  protected readonly ago = timeAgo;
  protected readonly dirUrl = directionsUrl;
  protected readonly views = [
    { label: 'Pendientes', value: 'open' },
    { label: 'Terminadas', value: 'closed' },
  ];
  protected readonly view = signal<View>('open');

  protected readonly here = signal<GeoPoint | null>(null);
  protected readonly locating = signal(false);

  protected readonly orders = rxResource({
    params: () => this.auth.user()?.id,
    stream: ({ params }) => this.api.workOrders({ assigned_to: params }),
  });

  protected readonly firstName = computed(() => this.auth.user()?.name.split(' ')[0] ?? '');
  private readonly all = computed(() => valueOrUndefined(this.orders) ?? []);
  protected readonly openCount = computed(() => this.all().filter((o) => OPEN_WO_STATUSES.includes(o.status)).length);
  protected readonly list = computed(() => {
    const open = this.view() === 'open';
    const here = this.here();
    const items = this.all().filter((o) => OPEN_WO_STATUSES.includes(o.status) === open);
    if (!open) return items.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
    if (here) return items.sort((a, b) => (a.location ? distanceKm(here, a.location) : 1e9) - (b.location ? distanceKm(here, b.location) : 1e9));
    return items.sort(compareOrders);
  });

  constructor() {
    // Refresh when a new order is assigned to me.
    this.api.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e.type === 'work_order_assigned' && e.data.assigned_to === this.auth.user()?.id) this.orders.reload();
    });
  }

  protected distance(o: WorkOrder): string | null {
    const h = this.here();
    return h && o.location ? formatDistance(distanceKm(h, o.location)) : null;
  }

  protected isLate(o: WorkOrder): boolean {
    return !!o.due_at && new Date(o.due_at).getTime() < Date.now() && OPEN_WO_STATUSES.includes(o.status);
  }

  protected async locate(): Promise<void> {
    this.locating.set(true);
    try {
      this.here.set(await this.geo.current());
    } catch {
      this.here.set(null);
    } finally {
      this.locating.set(false);
    }
  }
}
