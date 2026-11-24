import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { Textarea } from 'primeng/textarea';
import { OperatorApi } from '../../core/api/operator-api';
import { AuthService } from '../../core/auth/auth.service';
import { OperatorTask, TaskCounts, TaskKind, TaskView } from '../../core/models/operator.models';
import { StationsService } from '../../core/services/stations.service';
import { timeAgo } from '../../shared/utils/format.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { SkimmerSurvey } from './skimmer-survey';

const TABS: { view: TaskView; label: string; icon: string }[] = [
  { view: 'asignadas', label: 'Asignadas', icon: 'pi pi-user' },
  { view: 'reparaciones_pendientes', label: 'Reparaciones', icon: 'pi pi-wrench' },
  { view: 'urgentes', label: 'Urgentes', icon: 'pi pi-exclamation-circle' },
  { view: 'listos', label: 'Listos', icon: 'pi pi-check-circle' },
];

const KIND: Record<TaskKind, { label: string; icon: string }> = {
  report: { label: 'Reporte ciudadano', icon: 'pi pi-megaphone' },
  repair: { label: 'Reparación', icon: 'pi pi-wrench' },
  skimmer_collection: { label: 'Vaciar boya', icon: 'pi pi-inbox' },
  maintenance: { label: 'Mantenimiento', icon: 'pi pi-cog' },
};

/** Brigade operator inbox: assigned tasks, pending repairs, urgent reports and finished work. */
@Component({
  selector: 'app-bandeja-page',
  imports: [DatePipe, FormsModule, Button, Dialog, Textarea, SkimmerSurvey],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .tabs { display: flex; gap: .4rem; overflow-x: auto; padding-bottom: .15rem; scrollbar-width: none; }
    .tab { flex: none; display: inline-flex; align-items: center; gap: .4rem; padding: .5rem .8rem; border: 1px solid var(--rm-border); border-radius: 999px; background: #fff; color: var(--rm-muted); font: inherit; font-size: .82rem; font-weight: 650; cursor: pointer; }
    .tab b { min-width: 1.3rem; padding: 0 .35rem; border-radius: 999px; background: #eef1f5; color: var(--rm-text); font-size: .72rem; line-height: 1.3rem; text-align: center; }
    .tab.on { background: #1b263b; border-color: #1b263b; color: #fff; }
    .tab.on b { background: #00b4d8; color: #0d1b2a; }
    .list { display: grid; gap: .75rem; }
    .task { display: flex; flex-direction: column; gap: .5rem; border-radius: 20px; }
    .task.urgent { border-color: #f4b4b6; }
    .top { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
    .kind { display: inline-flex; align-items: center; gap: .35rem; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--rm-muted); font-weight: 600; }
    .urg { padding: .1rem .5rem; border-radius: 999px; background: #fbdcdc; color: #b91c1c; font-size: .72rem; font-weight: 700; }
    .st { margin-left: auto; font-size: .75rem; color: var(--rm-muted); }
    h2 { font-size: 1rem; font-weight: 750; overflow-wrap: anywhere; }
    p { margin: 0; overflow-wrap: anywhere; word-break: break-word; }
    .meta { font-size: .8rem; color: var(--rm-muted); }
    .note { padding: .5rem .7rem; border-radius: 12px; background: #eef9fc; font-size: .85rem; }
    .actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .2rem; }
    .empty { text-align: center; color: var(--rm-muted); padding: 2rem 1rem; }
    .who { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
    .badge { padding: .15rem .6rem; border-radius: 999px; background: #1b263b; color: #fff; font-size: .75rem; font-weight: 700; }
    .err { color: #b91c1c; }
    textarea { width: 100%; }
  `,
  template: `
    <div class="page">
      <div>
        <h1 class="page-title">Mi bandeja</h1>
        <p class="page-sub who">
          Hola, {{ firstName() }} <span class="badge">{{ roleLabel() }}</span>
        </p>
      </div>

      <div class="tabs" role="tablist" aria-label="Filtros de la bandeja">
        @for (t of tabs; track t.view) {
          <button type="button" class="tab" role="tab" [class.on]="view() === t.view" [attr.aria-selected]="view() === t.view" (click)="view.set(t.view)">
            <i [class]="t.icon" aria-hidden="true"></i>{{ t.label }}<b>{{ counts()[t.view] }}</b>
          </button>
        }
        <p-button icon="pi pi-refresh" severity="secondary" [text]="true" [rounded]="true" ariaLabel="Actualizar" (onClick)="page.reload()" />
      </div>

      <div class="list" aria-live="polite">
        @for (t of items(); track t.id) {
          <article class="rm-card task" [class.urgent]="t.priority === 'urgent' && t.status !== 'done'">
            <div class="top">
              <span class="kind"><i [class]="kinds[t.kind].icon" aria-hidden="true"></i>{{ kinds[t.kind].label }}</span>
              @if (t.priority === 'urgent' && t.status !== 'done') { <span class="urg">Urgente</span> }
              <span class="st">{{ statusText(t) }}</span>
            </div>
            <h2>{{ t.title }}</h2>
            @if (t.description) { <p>{{ t.description }}</p> }
            <p class="meta">
              @if (t.buoy_code) { <i class="pi pi-circle" aria-hidden="true"></i> {{ t.buoy_code }} · }
              @if (t.station_id) { <i class="pi pi-map-marker" aria-hidden="true"></i> {{ stations.name(t.station_id) }} · }
              {{ ago(t.created_at) }}
            </p>
            @if (t.closing_note) { <p class="note"><i class="pi pi-check-circle" aria-hidden="true"></i> {{ t.closing_note }}@if (t.resolved_at) { <small class="meta"> · {{ t.resolved_at | date: 'dd/MM HH:mm' }}</small> }</p> }
            @if (t.status !== 'done') {
              <div class="actions">
                @if (t.kind === 'skimmer_collection') {
                  <p-button label="Registrar vaciado" icon="pi pi-inbox" size="small" (onClick)="openSurvey(t)" />
                }
                @if (t.status === 'pending') {
                  <p-button label="Atender" icon="pi pi-play" size="small" [outlined]="t.kind === 'skimmer_collection'" [loading]="busy() === t.id" (onClick)="attend(t)" />
                }
                <p-button label="Marcar resuelto" icon="pi pi-check" size="small" severity="secondary" [outlined]="true" (onClick)="openResolve(t)" />
              </div>
            }
          </article>
        } @empty {
          @if (page.error()) {
            <div class="rm-card empty err" role="alert"><i class="pi pi-exclamation-triangle"></i> No se pudo cargar la bandeja. Revisa tu conexión o vuelve a iniciar sesión.</div>
          } @else if (page.isLoading()) {
            <div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div>
          } @else {
            <div class="rm-card empty"><i class="pi pi-inbox" aria-hidden="true"></i> No hay tareas en «{{ currentLabel() }}».</div>
          }
        }
      </div>
    </div>

    <p-dialog [visible]="resolving() !== null" (visibleChange)="!$event && resolving.set(null)" [modal]="true" [style]="{ width: 'min(440px, 94vw)' }" header="Marcar como resuelto" appendTo="body">
      @if (resolving(); as r) {
        <p><strong>{{ r.title }}</strong></p>
        <label for="closing" class="meta">Nota de cierre (obligatoria)</label>
        <textarea pTextarea id="closing" rows="3" [ngModel]="note()" (ngModelChange)="note.set($event)" placeholder="Ej. Barrera reinstalada y probada"></textarea>
      }
      <ng-template #footer>
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="resolving.set(null)" />
        <p-button label="Resolver" icon="pi pi-check" [loading]="saving()" [disabled]="note().trim().length < 3" (onClick)="resolve()" />
      </ng-template>
    </p-dialog>

    <app-skimmer-survey [(visible)]="surveyOpen" [stationId]="surveyTask()?.station_id ?? null" [buoyCode]="surveyTask()?.buoy_code ?? null" [taskId]="surveyTask()?.id ?? null" (saved)="page.reload()" />
  `,
})
export class BandejaPage {
  private readonly api = inject(OperatorApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(MessageService);
  protected readonly stations = inject(StationsService);

  protected readonly tabs = TABS;
  protected readonly kinds = KIND;
  protected readonly ago = timeAgo;
  protected readonly view = signal<TaskView>('asignadas');

  protected readonly page = rxResource({ params: () => this.view(), stream: ({ params }) => this.api.tasks(params) });
  private readonly lastCounts = signal<TaskCounts>({ asignadas: 0, reparaciones_pendientes: 0, urgentes: 0, listos: 0 });
  protected readonly items = computed<OperatorTask[]>(() => valueOrUndefined(this.page)?.items ?? []);
  protected readonly counts = computed(() => this.lastCounts());
  protected readonly currentLabel = computed(() => TABS.find((t) => t.view === this.view())?.label ?? '');
  protected readonly firstName = computed(() => (this.auth.user()?.name ?? '').split(' ')[0]);
  protected readonly roleLabel = computed(() => (this.auth.role() === 'technician' ? 'Operador de brigada' : this.auth.role() === 'supervisor' ? 'Supervisor' : 'Administrador'));

  protected readonly busy = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly resolving = signal<OperatorTask | null>(null);
  protected readonly note = signal('');
  protected surveyOpen = signal(false);
  protected readonly surveyTask = signal<OperatorTask | null>(null);

  constructor() {
    // Keep the tab counters while another tab is loading.
    effect(() => {
      const v = valueOrUndefined(this.page);
      if (v) this.lastCounts.set(v.counts);
    });
  }

  protected statusText(t: OperatorTask): string {
    return t.status === 'done' ? 'Resuelta' : t.status === 'in_progress' ? 'En atención' : 'Pendiente';
  }

  protected attend(t: OperatorTask): void {
    this.busy.set(t.id);
    this.api.patchTask(t.id, { status: 'in_progress' }).subscribe({
      next: () => {
        this.busy.set(null);
        this.page.reload();
      },
      error: () => this.busy.set(null),
    });
  }

  protected openResolve(t: OperatorTask): void {
    this.note.set('');
    this.resolving.set(t);
  }

  protected resolve(): void {
    const t = this.resolving();
    if (!t) return;
    this.saving.set(true);
    this.api.patchTask(t.id, { status: 'done', closing_note: this.note().trim() }).subscribe({
      next: () => {
        this.saving.set(false);
        this.resolving.set(null);
        this.toast.add({ key: 'app', severity: 'success', summary: 'Tarea resuelta', detail: t.title, life: 4000 });
        this.page.reload();
      },
      error: () => this.saving.set(false),
    });
  }

  protected openSurvey(t: OperatorTask): void {
    this.surveyTask.set(t);
    this.surveyOpen.set(true);
  }
}
