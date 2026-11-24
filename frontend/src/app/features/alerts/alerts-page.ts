import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { Paginator, PaginatorState } from 'primeng/paginator';
import { SelectButton } from 'primeng/selectbutton';
import { Textarea } from 'primeng/textarea';
import { RioApi } from '../../core/api/rio-api';
import { Alert, AlertSeverity, AlertStatus } from '../../core/models/rio.models';
import { FiltersService } from '../../core/services/filters.service';
import { LiveStreamService } from '../../core/services/live-stream.service';
import { Pill } from '../../shared/components/pill';
import { timeAgo } from '../../shared/utils/format.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { ALERT_STATUS_META, SEVERITY_META } from '../../shared/utils/wqi.util';

const PAGE_SIZE = 50;

@Component({
  selector: 'app-alerts-page',
  imports: [DatePipe, FormsModule, Button, Dialog, Paginator, SelectButton, Textarea, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alerts-page.html',
  styleUrl: './alerts-page.scss',
})
export class AlertsPage {
  private readonly api = inject(RioApi);
  private readonly filters = inject(FiltersService);
  private readonly toast = inject(MessageService);

  protected readonly sev = SEVERITY_META;
  protected readonly statusMeta = ALERT_STATUS_META;
  protected readonly ago = timeAgo;
  protected readonly pageSize = PAGE_SIZE;

  protected readonly statusOptions = [
    { label: 'Todas', value: 'all' },
    { label: 'Abiertas', value: 'open' },
    { label: 'Reconocidas', value: 'acknowledged' },
    { label: 'Resueltas', value: 'resolved' },
  ];
  protected readonly severityOptions = [
    { label: 'Todas', value: 'all' },
    { label: 'Crítica', value: 'critical' },
    { label: 'Advertencia', value: 'warning' },
    { label: 'Informativa', value: 'info' },
  ];

  protected readonly status = signal<'all' | AlertStatus>('open');
  protected readonly severity = signal<'all' | AlertSeverity>('all');
  protected readonly offset = signal(0);
  private readonly bump = signal(0);

  protected readonly page = rxResource({
    params: () => ({
      status: this.status() === 'all' ? undefined : (this.status() as AlertStatus),
      severity: this.severity() === 'all' ? undefined : (this.severity() as AlertSeverity),
      station_id: this.filters.stationId() ?? undefined,
      offset: this.offset(),
      tick: this.filters.tick(),
      bump: this.bump(),
    }),
    stream: ({ params }) =>
      this.api.alerts({ status: params.status, severity: params.severity, station_id: params.station_id, limit: PAGE_SIZE, offset: params.offset }),
  });
  protected readonly rules = rxResource({ stream: () => this.api.alertRules() });

  protected readonly ruleList = computed(() => valueOrUndefined(this.rules) ?? []);
  protected readonly items = computed<Alert[]>(() => valueOrUndefined(this.page)?.items ?? []);
  protected readonly total = computed(() => valueOrUndefined(this.page)?.total ?? 0);

  // Note dialog (acknowledge / resolve)
  protected readonly dialogOpen = signal(false);
  protected readonly target = signal<{ alert: Alert; status: 'acknowledged' | 'resolved' } | null>(null);
  protected readonly note = signal('');
  protected readonly saving = signal(false);

  constructor() {
    inject(LiveStreamService)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((e) => {
        if (e.type === 'alert') this.bump.update((n) => n + 1);
      });
  }

  protected setStatus(v: 'all' | AlertStatus | null): void {
    this.status.set(v ?? 'all');
    this.offset.set(0);
  }
  protected setSeverity(v: 'all' | AlertSeverity | null): void {
    this.severity.set(v ?? 'all');
    this.offset.set(0);
  }
  protected onPage(e: PaginatorState): void {
    this.offset.set(e.first ?? 0);
  }

  protected openDialog(alert: Alert, status: 'acknowledged' | 'resolved'): void {
    this.target.set({ alert, status });
    this.note.set('');
    this.dialogOpen.set(true);
  }

  protected confirm(): void {
    const t = this.target();
    if (!t) return;
    this.saving.set(true);
    this.api.patchAlert(t.alert.id, { status: t.status, note: this.note().trim() }).subscribe({
      next: () => {
        this.toast.add({ key: 'app', severity: 'success', summary: t.status === 'resolved' ? 'Alerta resuelta' : 'Alerta reconocida', life: 3000 });
        this.dialogOpen.set(false);
        this.saving.set(false);
        this.bump.update((n) => n + 1);
      },
      error: () => this.saving.set(false), // the interceptor already toasted error.message
    });
  }
}
