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
import { InputNumber } from 'primeng/inputnumber';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { NativeAlertsService } from '../../core/services/native-alerts.service';
import { locationLabel, typeLabel } from '../../core/api/labels';
import { RioApi } from '../../core/api/rio-api';
import { Alert, AlertRule, AlertSeverity, AlertStatus } from '../../core/models/rio.models';
import { FiltersService } from '../../core/services/filters.service';
import { LiveStreamService } from '../../core/services/live-stream.service';
import { Pill } from '../../shared/components/pill';
import { timeAgo } from '../../shared/utils/format.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { ALERT_STATUS_META, SEVERITY_META } from '../../shared/utils/wqi.util';

const PAGE_SIZE = 50;

@Component({
  selector: 'app-alerts-page',
  imports: [DatePipe, FormsModule, RouterLink, Button, Dialog, InputNumber, Paginator, SelectButton, Textarea, ToggleSwitch, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alerts-page.html',
  styleUrl: './alerts-page.scss',
})
export class AlertsPage {
  private readonly api = inject(RioApi);
  private readonly filters = inject(FiltersService);
  private readonly toast = inject(MessageService);
  protected readonly auth = inject(AuthService);
  protected readonly native = inject(NativeAlertsService);

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

  // Threshold editing (admin) → `PATCH /alert-rules/{id}`
  protected readonly ruleOpen = signal(false);
  protected readonly ruleDraft = signal<AlertRule | null>(null);
  protected readonly ruleSeverityOptions = this.severityOptions.filter((o) => o.value !== 'all');

  constructor() {
    inject(LiveStreamService)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((e) => {
        if (e.type === 'alert') this.bump.update((n) => n + 1);
      });
  }

  /** Human-readable criterion of a rule, from its kind and min/max values. */
  protected criterion(r: AlertRule): string {
    switch (r.kind) {
      case 'reading_range': {
        const limits = [r.min_value !== null ? `< ${r.min_value}` : '', r.max_value !== null ? `> ${r.max_value}` : ''].filter(Boolean).join(' o ');
        return `${typeLabel(r.parameter)}${r.location ? ` (${locationLabel(r.location)})` : ''} ${limits}`.trim();
      }
      case 'centrifuge_vibration':
        return `Vibración ≥ ${r.max_value} mm/s`;
      case 'treatment_efficiency':
        return `Eficiencia < ${r.min_value}%`;
      case 'sensor_offline':
        return `Sensor sin lecturas${r.max_value !== null ? ` > ${r.max_value} min` : ''}`;
    }
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

  protected async setNotifications(on: boolean): Promise<void> {
    const result = await this.native.setEnabled(on);
    if (on && !result) this.toast.add({ key: 'app', severity: 'warn', summary: 'Permiso denegado', detail: 'Activa las notificaciones de Río Monitor en los ajustes del teléfono.', life: 6000 });
  }

  protected editRule(r: AlertRule): void {
    this.ruleDraft.set({ ...r });
    this.ruleOpen.set(true);
  }

  protected saveRule(): void {
    const r = this.ruleDraft();
    if (!r) return;
    this.saving.set(true);
    this.api.patchAlertRule(r.id, { severity: r.severity, min_value: r.min_value, max_value: r.max_value, enabled: r.enabled }).subscribe({
      next: () => {
        this.saving.set(false);
        this.ruleOpen.set(false);
        this.toast.add({ key: 'app', severity: 'success', summary: 'Umbral actualizado', life: 3000 });
        this.rules.reload();
      },
      error: () => this.saving.set(false),
    });
  }
}
