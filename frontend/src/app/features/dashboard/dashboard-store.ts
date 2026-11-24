import { DestroyRef, Injectable, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RioApi } from '../../core/api/rio-api';
import {
  Bucket,
  CentrifugeAnalytics,
  DashboardOverview,
  LiveEvent,
  SensorHealth,
  WasteAnalytics,
  WasteType,
  WaterRecovery,
} from '../../core/models/rio.models';
import { FiltersService } from '../../core/services/filters.service';
import { LiveStreamService } from '../../core/services/live-stream.service';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { WASTE_TYPES, improvementPct } from '../../shared/utils/wqi.util';

export interface LivePhPoint {
  ts: number;
  inlet: number | null;
  outlet: number | null;
}

const MAX_LIVE = 240;

/** Keeps the last successful value while a refresh is in flight (no skeleton flicker every 45 s). */
function keep<T>(source: () => T | undefined) {
  return linkedSignal<T | undefined, T | undefined>({ source, computation: (n, prev) => n ?? prev?.value });
}

/**
 * Page-scoped store of the dashboard: loads every dataset with the global filters and applies
 * the live WebSocket events on top (reset whenever fresh data arrives from the API).
 */
@Injectable()
export class DashboardStore {
  private readonly api = inject(RioApi);
  private readonly filters = inject(FiltersService);
  private readonly live = inject(LiveStreamService);

  /** `5m` buckets for short windows, `1h` for long ones. */
  readonly bucket = computed<Bucket>(() => {
    const { from, to } = this.filters.range();
    return to.getTime() - from.getTime() <= 48 * 3_600_000 ? '5m' : '1h';
  });

  private readonly overviewTick = signal(0);
  private readonly base = computed(() => ({ q: this.filters.query(), tick: this.filters.tick() }));

  readonly overviewRes = rxResource({
    params: () => ({ ...this.base(), rc: this.overviewTick() }),
    stream: ({ params }) => this.api.overview(params.q),
  });
  readonly prevRes = rxResource({
    params: () => (this.filters.compare() ? { q: this.filters.previousQuery(), tick: this.filters.tick() } : undefined),
    stream: ({ params }) => this.api.overview(params.q),
  });
  readonly phRes = rxResource({ params: () => ({ ...this.base(), b: this.bucket() }), stream: ({ params }) => this.api.ph(params.q, params.b) });
  readonly waterRes = rxResource({ params: () => this.base(), stream: ({ params }) => this.api.waterRecovery(params.q, '1h') });
  readonly wasteRes = rxResource({ params: () => this.base(), stream: ({ params }) => this.api.waste(params.q, '1h') });
  readonly centrifugeRes = rxResource({ params: () => this.base(), stream: ({ params }) => this.api.centrifuge(params.q, '1h') });
  readonly sensorsRes = rxResource({ params: () => this.base(), stream: ({ params }) => this.api.sensorsHealth(params.q) });

  private readonly overviewBase = keep<DashboardOverview>(() => valueOrUndefined(this.overviewRes));
  private readonly waterBase = keep<WaterRecovery>(() => valueOrUndefined(this.waterRes));
  private readonly wasteBase = keep<WasteAnalytics>(() => valueOrUndefined(this.wasteRes));
  private readonly centrifugeBase = keep<CentrifugeAnalytics>(() => valueOrUndefined(this.centrifugeRes));
  private readonly sensorsBase = keep<SensorHealth[]>(() => valueOrUndefined(this.sensorsRes));
  readonly ph = keep(() => valueOrUndefined(this.phRes));
  readonly prev = computed(() => (this.filters.compare() ? valueOrUndefined(this.prevRes) : undefined));

  // ── Live layers (reset whenever the API returns fresh data) ──────────────────
  private readonly liveLatest = linkedSignal<unknown, Record<string, { inlet?: number; outlet?: number }>>({ source: () => valueOrUndefined(this.overviewRes), computation: () => ({}) });
  readonly livePoints = linkedSignal<unknown, LivePhPoint[]>({ source: () => valueOrUndefined(this.phRes), computation: () => [] });
  private readonly sensorLive = linkedSignal<unknown, Record<string, { status?: SensorHealth['status']; signal?: number; value?: number; ts?: string }>>({ source: () => valueOrUndefined(this.sensorsRes), computation: () => ({}) });
  private readonly cycleLive = linkedSignal<unknown, CentrifugeAnalytics['current'] | null>({ source: () => valueOrUndefined(this.centrifugeRes), computation: () => null });
  private readonly batchLive = linkedSignal<unknown, { in: number; clean: number; sludge: number }>({ source: () => valueOrUndefined(this.waterRes), computation: () => ({ in: 0, clean: 0, sludge: 0 }) });
  private readonly wasteLive = linkedSignal<unknown, Record<WasteType, { kg: number; pieces: number }>>({ source: () => valueOrUndefined(this.wasteRes), computation: () => zeroWaste() });
  private readonly alertLive = linkedSignal<unknown, { open: number; critical: number }>({ source: () => valueOrUndefined(this.overviewRes), computation: () => ({ open: 0, critical: 0 }) });

  // ── Derived views ────────────────────────────────────────────────────────────
  readonly overview = computed<DashboardOverview | undefined>(() => {
    const o = this.overviewBase();
    if (!o) return undefined;
    const stations = Object.values(this.liveLatest());
    const avg = (k: 'inlet' | 'outlet') => {
      const v = stations.map((s) => s[k]).filter((x): x is number => x !== undefined);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
    };
    const inlet = avg('inlet') ?? o.ph.inlet;
    const outlet = avg('outlet') ?? o.ph.outlet;
    const a = this.alertLive();
    const w = this.water();
    return {
      ...o,
<<<<<<< HEAD
      ph: { ...o.ph, inlet, outlet, improvement_pct: inlet ? improvementPct(inlet, outlet) : o.ph.improvement_pct },
=======
      ph: { inlet, outlet, improvement_pct: inlet && outlet !== null ? ((outlet - inlet) / inlet) * 100 : o.ph.improvement_pct },
>>>>>>> origin/feature/prototipo-c-skimmer
      alerts: { open: o.alerts.open + a.open, critical: o.alerts.critical + a.critical },
      treatment_efficiency_pct: w?.totals.efficiency_pct ?? o.treatment_efficiency_pct,
      recovery: { ...o.recovery, clean_liters: w?.totals.liters_clean ?? o.recovery.clean_liters, waste_kg: this.waste()?.total_kg ?? o.recovery.waste_kg },
    };
  });

  readonly water = computed<WaterRecovery | undefined>(() => {
    const w = this.waterBase();
    if (!w) return undefined;
    const d = this.batchLive();
    const lin = w.totals.liters_in + d.in;
    const lcl = w.totals.liters_clean + d.clean;
    return {
      ...w,
      totals: {
        liters_in: lin,
        liters_clean: lcl,
        liters_lost: w.totals.liters_lost + Math.max(0, d.in - d.clean - d.sludge * 0.9),
        sludge_kg: w.totals.sludge_kg + d.sludge,
        efficiency_pct: lin ? (lcl / lin) * 100 : 0,
      },
    };
  });

  readonly waste = computed<WasteAnalytics | undefined>(() => {
    const w = this.wasteBase();
    if (!w) return undefined;
    const d = this.wasteLive();
    const by_type = WASTE_TYPES.map((type) => {
      const b = w.by_type.find((x) => x.type === type) ?? { type, kg: 0, pieces: 0 };
      return { type, kg: b.kg + d[type].kg, pieces: b.pieces + d[type].pieces };
    });
    return { ...w, by_type, total_kg: by_type.reduce((a, b) => a + b.kg, 0) };
  });

  readonly centrifuge = computed<CentrifugeAnalytics | undefined>(() => {
    const c = this.centrifugeBase();
    if (!c) return undefined;
    const cur = this.cycleLive();
    return cur ? { ...c, current: cur } : c;
  });

  readonly sensors = computed<SensorHealth[] | undefined>(() => {
    const list = this.sensorsBase();
    if (!list) return undefined;
    const o = this.sensorLive();
    return list.map((s) => {
      const x = o[s.sensor_id];
      if (!x) return s;
      return {
        ...s,
        status: x.status ?? s.status,
        signal_quality_pct: x.signal ?? s.signal_quality_pct,
        last_reading: x.value !== undefined ? { value: x.value, unit: s.last_reading?.unit ?? 'pH', ts: x.ts ?? new Date().toISOString() } : s.last_reading,
      };
    });
  });

  /** Sparkline of the outlet pH (sampled to ≤14 points) and of the clean-water volume. */
  readonly phSpark = computed(() => sample(this.ph()?.series.map((p) => p.outlet.avg) ?? [], 14));
  readonly recoverySpark = computed(() => this.waterBase()?.series.slice(-14).map((p) => p.liters_clean) ?? []);
  readonly loading = computed(() => !this.overviewBase());
  readonly efficiencySpark = computed(() => this.waterBase()?.series.slice(-14).map((p) => (p.liters_in ? (p.liters_clean / p.liters_in) * 100 : 0)) ?? []);

  constructor() {
    // Re-query the overview after every WebSocket reconnection.
    this.live.reconnected$.pipe(takeUntilDestroyed()).subscribe(() => this.overviewTick.update((n) => n + 1));
    this.live.events$.pipe(takeUntilDestroyed()).subscribe((e) => this.apply(e));
    inject(DestroyRef).onDestroy(() => undefined);
  }

  reloadAll(): void {
    for (const r of [this.overviewRes, this.phRes, this.waterRes, this.wasteRes, this.centrifugeRes, this.sensorsRes]) r.reload();
  }

  private apply(e: LiveEvent): void {
    switch (e.type) {
      case 'reading': {
        const d = e.data;
<<<<<<< HEAD
        if (d.parameter !== 'ph' || (d.position !== 'inlet' && d.position !== 'outlet')) {
          // River readings only refresh the sensor list.
          this.touchSensor(d.station_id, d.position, d.parameter, d.value, d.timestamp);
          return;
        }
        this.liveLatest.update((m) => ({ ...m, [d.station_id]: { ...m[d.station_id], [d.position]: d.value } }));
        this.touchSensor(d.station_id, d.position, d.parameter, d.value, d.timestamp);
=======
        // Every reading refreshes its sensor row; only pH inlet/outlet feeds the KPI and the chart.
        this.sensorLive.update((m) => ({ ...m, [d.sensor_id]: { ...m[d.sensor_id], value: d.value, ts: d.timestamp } }));
        if (d.parameter !== 'ph' || (d.position !== 'inlet' && d.position !== 'outlet')) return;
        this.liveLatest.update((m) => ({ ...m, [d.station_id]: { ...m[d.station_id], [d.position]: d.value } }));
>>>>>>> origin/feature/prototipo-c-skimmer
        const stations = Object.values(this.liveLatest());
        const avg = (k: 'inlet' | 'outlet') => {
          const v = stations.map((s) => s[k]).filter((x): x is number => x !== undefined);
          return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
        };
        this.livePoints.update((l) => [...l, { ts: new Date(d.timestamp).getTime(), inlet: avg('inlet'), outlet: avg('outlet') }].slice(-MAX_LIVE));
        return;
      }
      case 'sensor_status':
        this.sensorLive.update((m) => ({ ...m, [e.data.sensor_id]: { ...m[e.data.sensor_id], status: e.data.status, signal: e.data.signal_quality_pct ?? m[e.data.sensor_id]?.signal } }));
        return;
      case 'cycle_update':
        this.cycleLive.set({ state: e.data.state, rpm: e.data.rpm, vibration_mm_s: e.data.vibration_mm_s, updated_at: new Date().toISOString() });
        return;
      case 'batch_completed':
        this.batchLive.update((b) => ({ in: b.in + e.data.liters_in, clean: b.clean + e.data.liters_clean, sludge: b.sludge + e.data.sludge_kg }));
        return;
      case 'waste_collected':
        this.wasteLive.update((w) => ({ ...w, [e.data.waste_type]: { kg: w[e.data.waste_type].kg + e.data.kg, pieces: w[e.data.waste_type].pieces + e.data.pieces } }));
        return;
      case 'alert':
        this.alertLive.update((a) => ({ open: a.open + (e.data.status === 'open' ? 1 : 0), critical: a.critical + (e.data.severity === 'critical' ? 1 : 0) }));
        return;
    }
  }
<<<<<<< HEAD

  private touchSensor(stationId: string, position: string, parameter: string, value: number, ts: string): void {
    // A station has several sensors per position (pH, turbidez…): match the parameter too.
    const sensor = this.sensorsBase()?.find((s) => s.station_id === stationId && s.position === position && s.parameter === parameter);
    if (!sensor) return;
    this.sensorLive.update((m) => ({ ...m, [sensor.sensor_id]: { ...m[sensor.sensor_id], value, ts } }));
  }
=======
>>>>>>> origin/feature/prototipo-c-skimmer
}

function zeroWaste(): Record<WasteType, { kg: number; pieces: number }> {
  return { plastic: { kg: 0, pieces: 0 }, organic: { kg: 0, pieces: 0 }, metal: { kg: 0, pieces: 0 }, glass: { kg: 0, pieces: 0 }, other: { kg: 0, pieces: 0 } };
}

function sample(values: number[], n: number): number[] {
  if (values.length <= n) return values;
  const step = (values.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => values[Math.round(i * step)]);
}
