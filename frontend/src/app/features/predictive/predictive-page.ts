import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ChartConfiguration, ChartDataset } from 'chart.js';
import { MessageService } from 'primeng/api';
import { Button } from 'primeng/button';
import { Select } from 'primeng/select';
import { SelectButton } from 'primeng/selectbutton';
import { Observable } from 'rxjs';
import { RioApi } from '../../core/api/rio-api';
import { IngestResult, PhForecast, WasteType } from '../../core/models/rio.models';
import { FiltersService } from '../../core/services/filters.service';
import { StationsService } from '../../core/services/stations.service';
import { TimeSeriesChart } from '../../shared/components/time-series-chart';
import { fmt2 } from '../../shared/utils/format.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { WASTE_META, WASTE_TYPES } from '../../shared/utils/wqi.util';

interface LogEntry {
  at: Date;
  label: string;
  ok: boolean;
  detail: string;
}

@Component({
  selector: 'app-predictive-page',
  imports: [FormsModule, Button, Select, SelectButton, TimeSeriesChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './predictive-page.html',
  styleUrl: './predictive-page.scss',
})
export class PredictivePage {
  private readonly api = inject(RioApi);
  private readonly filters = inject(FiltersService);
  private readonly stations = inject(StationsService);
  private readonly toast = inject(MessageService);
  private readonly router = inject(Router);

  /** Bound from the route `analitica/:tab` (`pronostico` | `simulador`). */
  readonly tab = input<string>('pronostico');
  protected readonly isSim = computed(() => this.tab() === 'simulador');
  protected readonly tabOptions = [
    { label: 'Pronóstico de pH', value: 'pronostico' },
    { label: 'Simulador IoT', value: 'simulador' },
  ];
  protected readonly horizonOptions = [
    { label: '3 h', value: 3 },
    { label: '6 h', value: 6 },
    { label: '12 h', value: 12 },
    { label: '24 h', value: 24 },
  ];
  protected readonly horizon = signal(6);

  /** Forecast needs a concrete station: the header one, or the first when "Todas". */
  protected readonly stationId = computed(() => this.filters.stationId() ?? this.stations.stations()[0]?.id ?? null);
  protected readonly stationName = computed(() => (this.stationId() ? this.stations.name(this.stationId()!) : '—'));
  /** Stations finished loading but none is available (e.g. backend down). */
  protected readonly noStation = computed(() => this.stations.loaded() && !this.stationId());
  protected readonly usingFallback = computed(() => this.filters.stationId() === null);

  protected readonly forecast = rxResource({
    params: () => (this.stationId() ? { id: this.stationId()!, h: this.horizon(), tick: this.filters.tick() } : undefined),
    stream: ({ params }) => this.api.forecastPh(params.id, params.h),
  });

  protected readonly summary = computed(() => {
    const f: PhForecast | undefined = valueOrUndefined(this.forecast);
    if (!f?.forecast.length) return null;
    const last = f.forecast[f.forecast.length - 1];
    const min = Math.min(...f.forecast.map((p) => p.lower));
    const max = Math.max(...f.forecast.map((p) => p.upper));
    return { end: last.value, min, max, risk: min < 6 || max > 8.5 };
  });

  protected readonly chart = computed<ChartConfiguration | null>(() => {
    const f = valueOrUndefined(this.forecast);
    if (!f) return null;
    const x = (iso: string) => new Date(iso).getTime();
    const hist = f.history.map((p) => ({ x: x(p.ts), y: p.value }));
    const join = hist.length ? [hist[hist.length - 1]] : [];
    const fc = f.forecast;
    const datasets: ChartDataset<'line'>[] = [
      { label: 'Histórico', data: hist, borderColor: '#1f7a5a', backgroundColor: '#1f7a5a', borderWidth: 2, pointRadius: 0, tension: 0.25 },
      { label: `Proyección ${f.horizon_hours} h`, data: [...join, ...fc.map((p) => ({ x: x(p.ts), y: p.value }))], borderColor: '#2563eb', backgroundColor: '#2563eb', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: 0.25 },
      { label: 'Banda de confianza (lower–upper)', data: [...join, ...fc.map((p) => ({ x: x(p.ts), y: p.upper }))], borderColor: 'transparent', backgroundColor: 'rgba(37,99,235,.16)', pointRadius: 0, fill: '+1', tension: 0.25 },
      { label: '_lower', data: [...join, ...fc.map((p) => ({ x: x(p.ts), y: p.lower }))], borderColor: 'transparent', pointRadius: 0, fill: false, tension: 0.25 },
    ];
    if (hist.length && fc.length) {
      const x0 = hist[0].x;
      const x1 = x(fc[fc.length - 1].ts);
      const limit = (label: string, y: number): ChartDataset<'line'> => ({ label, data: [{ x: x0, y }, { x: x1, y }], borderColor: '#b91c1c', borderDash: [2, 4], borderWidth: 1.3, pointRadius: 0 });
      datasets.push(limit('Límites de pH (6.0 – 8.5)', 6), limit('_alk', 8.5));
    }
    return {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { type: 'time', time: { tooltipFormat: 'dd MMM HH:mm', displayFormats: { minute: 'HH:mm', hour: 'HH:mm' } }, grid: { display: false }, ticks: { maxTicksLimit: 9, maxRotation: 0, autoSkip: true } },
          y: { suggestedMin: 5.5, suggestedMax: 9, title: { display: true, text: 'pH' } },
        },
        plugins: { legend: { position: 'bottom', labels: { filter: (i) => !i.text.startsWith('_'), usePointStyle: true } } },
      },
    };
  });

  // ── IoT simulator ───────────────────────────────────────────────────────────
  protected readonly wasteOptions = WASTE_TYPES.map((t) => ({ label: WASTE_META[t].label, value: t }));
  protected readonly wasteType = signal<WasteType>('plastic');
  protected readonly busy = signal<string | null>(null);
  protected readonly log = signal<LogEntry[]>([]);
  protected readonly fmt = fmt2;

  protected setTab(v: string | null): void {
    if (v) void this.router.navigate(['/analitica', v]);
  }

  protected simulateAcid(): void {
    const id = this.requireStation();
    if (!id) return;
    this.send('acid', 'Descarga ácida · pH 5.0 en la entrada', this.api.postReading({ station_id: id, position: 'inlet', parameter: 'ph', value: 5.0, unit: 'pH', timestamp: nowIso() }));
  }

  protected simulateCycle(failed: boolean): void {
    const id = this.requireStation();
    if (!id) return;
    const t = Date.now();
    this.send(
      failed ? 'cycle-bad' : 'cycle',
      failed ? 'Ciclo de centrífuga con falla (vibración 8.4 mm/s)' : 'Ciclo de centrífuga normal',
      this.api.postCentrifugeCycle({
        station_id: id,
        started_at: new Date(t - 20 * 60_000).toISOString(),
        ended_at: nowIso(),
        avg_rpm: failed ? 3620 : 3190,
        max_vibration_mm_s: failed ? 8.4 : 2.6,
        energy_kwh: 4.2,
        status: failed ? 'failed' : 'completed',
      }),
    );
  }

  protected simulateBatch(): void {
    const id = this.requireStation();
    if (!id) return;
    const t = Date.now();
    this.send('batch', 'Lote de tratamiento · 1 200 L → 1 050 L limpios', this.api.postTreatmentBatch({ station_id: id, liters_in: 1200, liters_clean: 1050, sludge_kg: 14.4, started_at: new Date(t - 45 * 60_000).toISOString(), ended_at: nowIso() }));
  }

  protected simulateWaste(): void {
    const id = this.requireStation();
    if (!id) return;
    const type = this.wasteType();
    this.send('waste', `Recolección de residuos · ${WASTE_META[type].label} 8.5 kg`, this.api.postWasteCollection({ station_id: id, waste_type: type, kg: 8.5, pieces: 40, collected_at: nowIso() }));
  }

  private requireStation(): string | null {
    const id = this.stationId();
    if (!id) this.toast.add({ key: 'app', severity: 'warn', summary: 'Sin estación', detail: 'Aún no se cargan las estaciones.', life: 3000 });
    return id;
  }

  private send(key: string, label: string, req: Observable<IngestResult>): void {
    this.busy.set(key);
    req.subscribe({
      next: (r) => {
        this.push({ label, ok: true, detail: `Aceptado · id ${r.id}` });
        this.toast.add({ key: 'app', severity: 'success', summary: 'Evento enviado', detail: 'Observa el flujo en vivo y las alertas.', life: 3500 });
        this.busy.set(null);
      },
      error: (e: Error) => {
        this.push({ label, ok: false, detail: e.message });
        this.busy.set(null); // the interceptor already showed error.message as a toast
      },
    });
  }

  private push(e: Omit<LogEntry, 'at'>): void {
    this.log.update((l) => [{ ...e, at: new Date() }, ...l].slice(0, 12));
  }
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
