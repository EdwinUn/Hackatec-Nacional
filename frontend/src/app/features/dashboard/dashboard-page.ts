import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ChartConfiguration, ChartDataset } from 'chart.js';
import { Button } from 'primeng/button';
import { ProgressBar } from 'primeng/progressbar';
import { KpiTile } from '../../shared/components/kpi-tile';
import { Pill } from '../../shared/components/pill';
import { TimeSeriesChart } from '../../shared/components/time-series-chart';
import { fmt0, fmt1, fmt2, formatLiters, pctDelta, timeAgo } from '../../shared/utils/format.util';
import { typeLabel } from '../../core/api/labels';
import { CENTRIFUGE_META, SENSOR_STATUS_META, WASTE_META, WQI_META, wqiText } from '../../shared/utils/wqi.util';
import { DashboardStore } from './dashboard-store';

const ORANGE = '#d9730d';
const GREEN = '#1f7a5a';

@Component({
  selector: 'app-dashboard-page',
  imports: [DecimalPipe, Button, ProgressBar, KpiTile, Pill, TimeSeriesChart],
  providers: [DashboardStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  protected readonly s = inject(DashboardStore);
  protected readonly wqi = WQI_META;
  protected readonly sensorMeta = SENSOR_STATUS_META;
  protected readonly cfMeta = CENTRIFUGE_META;
  protected readonly wasteMeta = WASTE_META;
  protected readonly f = { n0: fmt0, n1: fmt1, n2: fmt2, liters: formatLiters, ago: timeAgo };

  /** Comparison deltas vs. the previous period (only when "Comparar periodo" is on). */
  protected readonly deltas = computed(() => {
    const o = this.s.overview();
    const p = this.s.prev();
    if (!o || !p) return null;
    return {
      wqi: o.wqi.outlet.score - p.wqi.outlet.score,
      ph: (o.ph.improvement_pct ?? 0) - (p.ph.improvement_pct ?? 0),
      eff: o.treatment_efficiency_pct - p.treatment_efficiency_pct,
      liters: pctDelta(o.recovery.clean_liters, p.recovery.clean_liters),
    };
  });

  protected readonly wasteRows = computed(() => {
    const w = this.s.waste();
    if (!w) return [];
    const max = Math.max(1, ...w.by_type.map((t) => t.kg));
    return w.by_type
      .map((t) => ({ ...t, pct: (t.kg / max) * 100, share: w.total_kg ? (t.kg / w.total_kg) * 100 : 0 }))
      .sort((a, b) => b.kg - a.kg);
  });

  protected readonly phChart = computed<ChartConfiguration | null>(() => {
    const ph = this.s.ph();
    if (!ph) return null;
    const x = (iso: string | number) => (typeof iso === 'number' ? iso : new Date(iso).getTime());
    const live = this.s.livePoints();
    const band = (label: string, color: string, key: 'inlet' | 'outlet', edge: 'max' | 'min', fill: boolean): ChartDataset<'line'> => ({
      label,
      data: ph.series.map((p) => ({ x: x(p.ts), y: p[key][edge] })),
      borderColor: 'transparent',
      backgroundColor: color,
      pointRadius: 0,
      fill: fill ? '+1' : false,
      tension: 0.25,
    });
    const line = (label: string, color: string, key: 'inlet' | 'outlet'): ChartDataset<'line'> => ({
      label,
      data: [
        ...ph.series.map((p) => ({ x: x(p.ts), y: p[key].avg })),
        ...live.filter((l) => l[key] !== null).map((l) => ({ x: l.ts, y: l[key] as number })),
      ],
      borderColor: key === 'inlet' ? ORANGE : GREEN,
      backgroundColor: key === 'inlet' ? ORANGE : GREEN,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
    });
    return {
      type: 'line',
      data: {
        datasets: [
          band('Entrada · rango mín–máx', 'rgba(217,115,13,.14)', 'inlet', 'max', true),
          band('_inlet-min', 'transparent', 'inlet', 'min', false),
          band('Salida · rango mín–máx', 'rgba(31,122,90,.16)', 'outlet', 'max', true),
          band('_outlet-min', 'transparent', 'outlet', 'min', false),
          line('Entrada (promedio)', ORANGE, 'inlet'),
          line('Salida (promedio)', GREEN, 'outlet'),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { type: 'time', time: { tooltipFormat: 'dd MMM HH:mm', displayFormats: { minute: 'HH:mm', hour: 'dd/MM HH:mm', day: 'dd MMM' } }, grid: { display: false }, ticks: { maxTicksLimit: 9, maxRotation: 0, autoSkip: true } },
          y: { suggestedMin: 5, suggestedMax: 9, title: { display: true, text: 'pH' } },
        },
        plugins: { legend: { position: 'bottom', labels: { filter: (i) => !i.text.startsWith('_'), usePointStyle: true } } },
      },
    };
  });

  protected readonly wqiText = wqiText;
  protected readonly paramLabel = typeLabel;
  protected phText(v: number | null): string {
    return v === null ? '—' : fmt2(v);
  }
  protected improvementText(pct: number | null): string {
    return pct === null ? 'Sin lecturas de pH en el periodo' : `${pct >= 0 ? '+' : ''}${fmt1(pct)}% de mejora por el tratamiento`;
  }

  protected signalColor(v: number): string {
    return v >= 80 ? '#1f7a5a' : v >= 55 ? '#d9a30d' : '#c2410c';
  }
}
