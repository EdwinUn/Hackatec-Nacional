import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ChartConfiguration, ChartDataset } from 'chart.js';
import { Button } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressBar } from 'primeng/progressbar';
import { SelectButton } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { BUOY_STATE_META, buoyState } from '../../core/models/buoy.models';
import { DeviceTelemetryDto, TelemetryPacket, linkQuality } from '../../core/models/telemetry.models';
import { FiltersService, PRESET_LABEL, RangePreset } from '../../core/services/filters.service';
import { KpiTile } from '../../shared/components/kpi-tile';
import { OriginLegend, OriginTag } from '../../shared/components/origin-tag';
import { Pill } from '../../shared/components/pill';
import { TimeSeriesChart } from '../../shared/components/time-series-chart';
import { fmt0, fmt1, fmt2 } from '../../shared/utils/format.util';
import { SENSOR_STATUS_META, WASTE_META, WQI_META, wqiText } from '../../shared/utils/wqi.util';
import { BuoyView, DashboardStore, HISTORY_LIMIT } from './dashboard-store';

const ORANGE = '#c2410c';
const GREEN = '#1f7a5a';
const GRAY = '#64748b';

/** Prototype thresholds of the default alert rules (`backend/app/domain/defaults.py`, docs/fidelidad.md § 3). */
const TURB_OUT_MAX = 5;
const TURB_IN_MAX = 100;
const PH_MIN = 6.5;
const PH_MAX = 8.5;
/** The TDS Meter V1.0 saturates at 1000 ppm. */
const TDS_SATURATION = 1000;

type Metric = 'turb' | 'ph';

@Component({
  selector: 'app-dashboard-page',
  imports: [FormsModule, RouterLink, Button, Message, ProgressBar, SelectButton, TableModule, KpiTile, OriginLegend, OriginTag, Pill, TimeSeriesChart],
  providers: [DashboardStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  protected readonly s = inject(DashboardStore);
  protected readonly filters = inject(FiltersService);

  protected readonly presets: Exclude<RangePreset, 'custom'>[] = ['24h', '7d', '30d'];
  protected readonly presetLabel = PRESET_LABEL;
  protected readonly wqi = WQI_META;
  protected readonly sensorMeta = SENSOR_STATUS_META;
  protected readonly wasteMeta = WASTE_META;
  protected readonly wqiText = wqiText;
  protected readonly limits = { TURB_OUT_MAX, TURB_IN_MAX, PH_MIN, PH_MAX, TDS_SATURATION, HISTORY_LIMIT };

  protected readonly buoyOptions = computed(() => this.s.codes().map((c) => ({ label: c, value: c })));
  protected readonly metric = signal<Metric>('turb');
  protected readonly metricOptions = [
    { label: 'Turbidez', value: 'turb' },
    { label: 'pH', value: 'ph' },
  ];
  protected readonly showTable = signal(false);

  // ── Phone selector: steps through the buoys ──────────────────────────────────
  protected stepBuoy(dir: -1 | 1): void {
    const codes = this.s.codes();
    if (!codes.length) return;
    const i = Math.max(0, codes.indexOf(this.s.selectedCode() ?? ''));
    this.s.select(codes[(i + dir + codes.length) % codes.length]);
  }

  // ── «¿Hay algo urgente?» ─────────────────────────────────────────────────────
  protected readonly urgent = computed<{ severity: 'error' | 'warn' | 'success' | 'secondary'; title: string; detail: string } | null>(() => {
    const a = this.s.alerts();
    const alarms = this.s.buoys().filter((b) => b.live && b.packet?.alarm_on).map((b) => b.code);
    const alarmText = alarms.length ? `Baliza de alerta encendida en ${alarms.join(' y ')}.` : '';
    if (!a) {
      if (this.s.alertsRes.error()) return { severity: 'secondary', title: 'No se pudieron cargar las alertas.', detail: alarmText };
      return alarms.length ? { severity: 'warn', title: alarmText, detail: '' } : null;
    }
    if (a.criticalTotal > 0) {
      const first = a.critical[0];
      const where = first ? (this.s.codeByStation().get(first.station_id) ?? first.station_name) : '';
      return {
        severity: 'error',
        title: a.criticalTotal === 1 ? '1 alerta crítica' : `${a.criticalTotal} alertas críticas`,
        detail: [first ? `${where}: ${first.message}` : '', alarmText].filter(Boolean).join(' '),
      };
    }
    if (a.open > 0) return { severity: 'warn', title: a.open === 1 ? '1 alerta abierta' : `${a.open} alertas abiertas`, detail: alarmText };
    if (alarms.length) return { severity: 'warn', title: alarmText, detail: '' };
    return { severity: 'success', title: `Sin alertas abiertas en ${this.s.codes().join(' y ')}.`, detail: '' };
  });

  // ── Four headline indicators (same on phone and desktop) ─────────────────────
  protected readonly water = computed(() => {
    const p = this.s.selected()?.packet ?? null;
    const v = p?.values ?? {};
    return {
      packet: p,
      turbIn: num(v['turb_in_ntu']),
      turbOut: num(v['turb_out_ntu']),
      phIn: num(v['ph']),
      phOut: num(v['ph_out']),
      tds: num(v['tds_ppm']),
      temp: num(v['temp_c']),
      efficiency: num(p?.device_efficiency_pct),
      pumpOff: p?.pump_on === false,
    };
  });
  protected readonly liveCount = computed(() => this.s.buoys().filter((b) => b.live).length);
  protected readonly notLive = computed(() => this.s.buoys().filter((b) => !b.live).map((b) => b.code));
  protected readonly fullest = computed(() => {
    const withBasket = this.s.buoys().filter((b) => num(b.packet?.basket_fill_pct) !== null);
    if (!withBasket.length) return null;
    const top = withBasket.reduce((a, b) => (b.packet!.basket_fill_pct! > a.packet!.basket_fill_pct! ? b : a));
    return { code: top.code, pct: top.packet!.basket_fill_pct!, live: top.live };
  });

  // ── In / out chart ───────────────────────────────────────────────────────────
  private readonly keys = computed(() => (this.metric() === 'turb' ? (['turb_in_ntu', 'turb_out_ntu'] as const) : (['ph', 'ph_out'] as const)));

  protected readonly chart = computed<ChartConfiguration | null>(() => {
    const list = this.s.series();
    if (!list?.length) return null;
    const [kIn, kOut] = this.keys();
    const turb = this.metric() === 'turb';
    const xs = list.map((p) => Date.parse(p.ts));
    const line = (label: string, color: string, k: string): ChartDataset<'line'> => ({
      label,
      data: list.map((p, i) => ({ x: xs[i], y: num(p.values?.[k]) ?? Number.NaN })),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: list.length < 40 ? 2 : 0,
      tension: 0.25,
      spanGaps: false,
    });
    const limit = (label: string, y: number): ChartDataset<'line'> => ({
      label,
      data: [
        { x: xs[0], y },
        { x: xs[xs.length - 1], y },
      ],
      borderColor: GRAY,
      backgroundColor: GRAY,
      borderWidth: 1,
      borderDash: [6, 4],
      pointRadius: 0,
    });
    const datasets = [line('Entrada (río)', ORANGE, kIn), line('Salida (después del filtro)', GREEN, kOut)];
    if (turb) datasets.push(limit(`Umbral de salida ${TURB_OUT_MAX} NTU (prototipo)`, TURB_OUT_MAX));
    else datasets.push(limit(`Rango ${PH_MIN}–${PH_MAX} (prototipo)`, PH_MIN), limit('_max', PH_MAX));
    return {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { type: 'time', time: { tooltipFormat: 'dd MMM HH:mm', displayFormats: { minute: 'HH:mm', hour: 'dd/MM HH:mm', day: 'dd MMM' } }, grid: { display: false }, ticks: { maxTicksLimit: 9, maxRotation: 0, autoSkip: true } },
          y: turb ? { min: 0, title: { display: true, text: 'Turbidez (NTU)' } } : { suggestedMin: 5.5, suggestedMax: 9, title: { display: true, text: 'pH' } },
        },
        plugins: { legend: { position: 'bottom', labels: { filter: (i) => !i.text.startsWith('_'), usePointStyle: true } } },
      },
    };
  });

  protected readonly chartLabel = computed(() => {
    const code = this.s.selectedCode() ?? '';
    return this.metric() === 'turb' ? `Turbidez de entrada y de salida de ${code} en el tiempo` : `pH de entrada y de salida de ${code} en el tiempo`;
  });

  /** Rows of the accessible table alternative of the chart (most recent first). */
  protected readonly tableRows = computed(() => {
    const [kIn, kOut] = this.keys();
    return [...(this.s.series() ?? [])].reverse().map((p) => ({ ts: p.ts, inlet: num(p.values?.[kIn]), outlet: num(p.values?.[kOut]) }));
  });

  protected readonly historyStart = computed(() => this.s.series()?.[0]?.ts ?? null);

  // ── Waste ────────────────────────────────────────────────────────────────────
  protected readonly wasteRows = computed(() => {
    const w = this.s.waste();
    if (!w) return [];
    const max = Math.max(1, ...w.by_type.map((t) => t.kg));
    return [...w.by_type].sort((a, b) => b.kg - a.kg).map((t) => ({ ...t, pct: (t.kg / max) * 100 }));
  });

  // ── Formatting helpers ───────────────────────────────────────────────────────
  protected n(v: number | null | undefined, digits: 0 | 1 | 2 = 1): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return digits === 0 ? fmt0(v) : digits === 1 ? fmt1(v) : fmt2(v);
  }

  protected state(b: BuoyView): { label: string; color: string; bg: string } {
    return BUOY_STATE_META[buoyState(b.packet, b.live)];
  }

  protected ago(code: string): string {
    const sec = this.s.ages()[code];
    if (sec === null || sec === undefined) return 'sin paquetes';
    if (sec < 45) return 'hace un momento';
    if (sec < 3600) return `hace ${Math.round(sec / 60)} min`;
    if (sec < 86_400) return `hace ${Math.round(sec / 3600)} h`;
    return `hace ${Math.round(sec / 86_400)} d`;
  }

  protected link(p: TelemetryPacket | null): string {
    const rssi = num(p?.rssi_dbm);
    return rssi === null ? 'sin dato' : `${fmt0(rssi)} dBm · ${linkQuality(rssi).label}`;
  }

  /** «25 nov, 14:05» in Spanish (no Angular locale data is registered). */
  protected when(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  protected inRange(ph: number | null): boolean | null {
    return ph === null ? null : ph >= PH_MIN && ph <= PH_MAX;
  }

  /** Swatch color for a turbidity: clear blue at 0 NTU to muddy brown from 120 NTU (decorative). */
  protected turbColor(ntu: number | null): string {
    if (ntu === null) return '#e2e8f0';
    const t = Math.max(0, Math.min(1, ntu / 120));
    const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
    return `rgb(${mix(190, 122)} ${mix(233, 90)} ${mix(245, 50)})`;
  }

  protected basketSeverity(pct: number): string {
    return pct >= 80 ? '#e5484d' : pct >= 50 ? '#f59e0b' : '#00b4d8';
  }

  protected value(p: DeviceTelemetryDto, k: string): number | null {
    return num(p.values?.[k]);
  }
}

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
