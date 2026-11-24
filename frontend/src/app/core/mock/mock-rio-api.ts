import { Injectable, inject } from '@angular/core';
import { Observable, delay, of, throwError } from 'rxjs';
import { improvementPct, wqiCategory } from '../../shared/utils/wqi.util';
import { RioApi } from '../api/rio-api';
import { ApiError } from '../interceptors/api-error.interceptor';
import {
  Alert,
  AlertFilters,
  AlertPatch,
  AlertRule,
  Bucket,
  CentrifugeAnalytics,
<<<<<<< HEAD
  CentrifugeCycleIngest,
  CriticalPoint,
=======
>>>>>>> origin/feature/prototipo-c-skimmer
  DashboardOverview,
  Hotspot,
  IngestResult,
  Page,
  PhAnalytics,
  PhForecast,
  Query,
  SensorHealth,
  Station,
  WasteAnalytics,
  WasteType,
  WaterRecovery,
} from '../models/rio.models';
import { MockBackend, mulberry32 } from './mock-backend';

const MIN = 60_000;
const HOUR = 3_600_000;
const BUCKET_MS: Record<Bucket, number> = { '5m': 5 * MIN, '1h': HOUR };
const lat = <T>(v: T): Observable<T> => of(v).pipe(delay(180));

/** Mock implementation of the API (see MockBackend). Deterministic per time range. */
@Injectable()
export class MockRioApi extends RioApi {
  private readonly be = inject(MockBackend);

  /** Resolves the stations, window length and a seed from a query. */
  private scope(q: Query) {
    const to = q.to ? new Date(q.to).getTime() : Date.now();
    const from = q.from ? new Date(q.from).getTime() : to - 24 * HOUR;
    const stations = q.station_id ? this.be.stations.filter((s) => s.id === q.station_id) : this.be.stations;
    return { from, to, hours: Math.max(0.25, (to - from) / HOUR), stations, seed: Math.floor(from / HOUR) };
  }

  stations(): Observable<Station[]> {
    return lat([...this.be.stations]);
  }

  overview(q: Query): Observable<DashboardOverview> {
    const { from, to, hours, stations, seed } = this.scope(q);
    const rng = mulberry32(seed);
    const wr = this.buildRecovery(q, '1h');
    const wasteKg = this.buildWaste(q, '1h').total_kg;
    const alerts = this.be.alertList.filter((a) => (!q.station_id || a.station_id === q.station_id) && a.status === 'open');
    const avg = (f: (id: string) => number) => stations.reduce((a, s) => a + f(s.id), 0) / stations.length;
    const riverScore = Math.round(avg((id) => this.be.wqiFor(id, 'river').score) + (rng() - 0.5) * 6);
    const outletScore = Math.round(avg((id) => this.be.wqiFor(id, 'outlet').score) + (rng() - 0.5) * 4);
    const dominant = stations.length === 1 ? this.be.wqiFor(stations[0].id, 'river').dominant_parameter : 'ph';
    const inlet = Math.round(avg((id) => this.be.currentPh.get(id)!.inlet) * 100) / 100;
    const outlet = Math.round(avg((id) => this.be.currentPh.get(id)!.outlet) * 100) / 100;
    const sensors = this.be.sensors.filter((s) => !q.station_id || s.station_id === q.station_id);
    return lat({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      wqi: {
        river: { score: riverScore, category: wqiCategory(riverScore), dominant_parameter: dominant },
        outlet: { score: outletScore, category: wqiCategory(outletScore), dominant_parameter: 'dissolved_oxygen' },
      },
<<<<<<< HEAD
      ph: { inlet, outlet, improvement_pct: Math.round(improvementPct(inlet, outlet) * 10) / 10, trend: trend(outlet, 0.25) },
=======
      ph: { inlet, outlet, improvement_pct: Math.round(((outlet - inlet) / inlet) * 1000) / 10 },
>>>>>>> origin/feature/prototipo-c-skimmer
      sensors: { online: sensors.filter((s) => s.status === 'ok' || s.status === 'degraded').length, total: sensors.length },
      treatment_efficiency_pct: wr.totals.efficiency_pct,
      recovery: { clean_liters: wr.totals.liters_clean, waste_kg: wasteKg },
      alerts: { open: alerts.length, critical: alerts.filter((a) => a.severity === 'critical').length },
    });
  }

  ph(q: Query, bucket: Bucket): Observable<PhAnalytics> {
    const { from, to, stations } = this.scope(q);
    const step = BUCKET_MS[bucket];
    const start = Math.floor(from / step) * step;
    const n = Math.min(900, Math.max(2, Math.floor((to - start) / step)));
    const rng = mulberry32(Math.floor(from / HOUR) + 7);
    const nS = stations.length;
    const series: PhAnalytics['series'] = [];
    let imp = 0;
    for (let i = 0; i < n; i++) {
      const t = start + i * step;
      const day = Math.sin(((new Date(t).getUTCHours() - 6) / 24) * Math.PI * 2);
      const spike = Math.sin(t / (HOUR * 17)) > 0.93 ? -1.1 : 0; // occasional acid discharge
      const inAvg = 6.15 + 0.35 * day + spike + (rng() - 0.5) * 0.12 / Math.sqrt(nS);
      const outAvg = 7.42 + 0.1 * day + (rng() - 0.5) * 0.06;
      const w = bucket === '5m' ? 0.12 : 0.3;
      series.push({
        ts: new Date(t).toISOString(),
        inlet: { avg: r2(inAvg), min: r2(inAvg - w - rng() * 0.08), max: r2(inAvg + w + rng() * 0.08) },
        outlet: { avg: r2(outAvg), min: r2(outAvg - w / 3), max: r2(outAvg + w / 3) },
      });
      imp += improvementPct(inAvg, outAvg);
    }
    return lat({ bucket, avg_improvement_pct: r2(imp / n), series });
  }

  private buildRecovery(q: Query, bucket: Bucket): WaterRecovery {
    const { from, to, stations, seed } = this.scope(q);
    const rng = mulberry32(seed + 3);
    const step = BUCKET_MS[bucket];
    const start = Math.floor(from / step) * step;
    const n = Math.min(900, Math.max(1, Math.floor((to - start) / step)));
    const perBucket = (step / HOUR) * 1500 * stations.length;
    const series: WaterRecovery['series'] = [];
    let lin = 0;
    let lcl = 0;
    for (let i = 0; i < n; i++) {
      const li = perBucket * (0.8 + rng() * 0.4);
      const lc = li * (0.84 + rng() * 0.08);
      lin += li;
      lcl += lc;
      series.push({ ts: new Date(start + i * step).toISOString(), liters_in: Math.round(li), liters_clean: Math.round(lc) });
    }
    const e = this.be.extras;
    lin += e.liters_in;
    lcl += e.liters_clean;
    const sludge = lin * 0.012 + e.sludge_kg;
    return {
      bucket,
      totals: {
        liters_in: Math.round(lin),
        liters_clean: Math.round(lcl),
        liters_lost: Math.round(lin - lcl - sludge * 0.9),
        sludge_kg: r1(sludge),
        efficiency_pct: r1((lcl / lin) * 100),
      },
      series,
    };
  }

  waterRecovery(q: Query, bucket: Bucket): Observable<WaterRecovery> {
    return lat(this.buildRecovery(q, bucket));
  }

  private buildWaste(q: Query, bucket: Bucket): WasteAnalytics {
    const { hours, stations, seed } = this.scope(q);
    const rng = mulberry32(seed + 5);
    const k = hours * stations.length;
    const weights = { plastic: 1.6, organic: 3.1, metal: 0.5, glass: 0.7, other: 1.1 };
    const by_type = (Object.keys(weights) as (keyof typeof weights)[]).map((type) => {
      const kg = k * weights[type] * (0.9 + rng() * 0.2) + this.be.extras.waste[type].kg;
      const pieces = Math.round(kg * ({ plastic: 38, organic: 6, metal: 9, glass: 5, other: 12 }[type]) + this.be.extras.waste[type].pieces);
      return { type, kg: r1(kg), pieces };
    });
    return { bucket, total_kg: r1(by_type.reduce((a, b) => a + b.kg, 0)), by_type };
  }

  waste(q: Query, bucket: Bucket): Observable<WasteAnalytics> {
    return lat(this.buildWaste(q, bucket));
  }

  centrifuge(q: Query, bucket: Bucket): Observable<CentrifugeAnalytics> {
    const { hours, stations } = this.scope(q);
    const cycles = Math.round(hours * 1.4 * stations.length) + this.be.extras.cycles;
    const cur = this.be.centrifuge.get(q.station_id ?? stations[0].id)!;
    return lat({
      bucket,
      cycles_total: cycles,
      failures: Math.round(cycles * 0.03) + this.be.extras.failures,
      avg_rpm: 3185,
      avg_vibration_mm_s: 2.4,
      energy_kwh: r1(hours * 11.8 * stations.length),
      current: { ...cur },
    });
  }

  sensorsHealth(q: Query): Observable<SensorHealth[]> {
    return lat(this.be.sensors.filter((s) => !q.station_id || s.station_id === q.station_id).map((s) => ({ ...s })));
  }

  hotspots(): Observable<Hotspot[]> {
    return lat(
      this.be.stations
        .map((s) => {
          const open = this.be.alertList.filter((a) => a.station_id === s.id && a.status === 'open');
          return {
            station_id: s.id,
            name: s.name,
            latitude: s.latitude,
            longitude: s.longitude,
            wqi: this.be.wqiFor(s.id, 'river'),
            open_alerts: open.length,
            critical_alerts: open.filter((a) => a.severity === 'critical').length,
          };
        }),
    );
  }

  /** Same three components as the backend index (simplified: recurrence = open alerts). */
  criticalPoints(_q: Query): Observable<CriticalPoint[]> {
    const points = this.be.stations.map((s) => {
      const open = this.be.alertList.filter((a) => a.station_id === s.id && a.status === 'open');
      const critical = open.filter((a) => a.severity === 'critical').length;
      const wqi = this.be.wqiFor(s.id, 'river');
      const components = {
        calidad: Math.round((100 - wqi.score) * 10) / 10,
        alertas: Math.min(100, critical * 25 + (open.length - critical) * 8),
        recurrencia: Math.min(100, open.length * 10),
      };
      const score = Math.round((0.5 * components.calidad + 0.3 * components.alertas + 0.2 * components.recurrencia) * 10) / 10;
      const level: CriticalPoint['level'] = score >= 50 ? 'critico' : score >= 30 ? 'atencion' : 'estable';
      const reasons = [
        ...(critical ? [`${critical} ${critical === 1 ? 'alerta crítica activa' : 'alertas críticas activas'}`] : []),
        `Calidad del agua ${wqi.category} (WQI ${wqi.score}), sobre todo por ${wqi.dominant_parameter}`,
      ];
      return { rank: 0, station_id: s.id, name: s.name, score, level, components, reasons };
    });
    points.sort((a, b) => b.score - a.score).forEach((p, i) => (p.rank = i + 1));
    return lat(points);
  }

  alerts(f: AlertFilters): Observable<Page<Alert>> {
    const all = this.be.alertList
      .filter((a) => (!f.status || a.status === f.status) && (!f.severity || a.severity === f.severity) && (!f.station_id || a.station_id === f.station_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return lat({ items: all.slice(f.offset, f.offset + f.limit).map((a) => ({ ...a })), total: all.length, limit: f.limit, offset: f.offset });
  }

  patchAlert(id: string, body: AlertPatch): Observable<Alert> {
    const a = this.be.alertList.find((x) => x.id === id);
    if (!a) return throwError(() => new ApiError('Alerta no encontrada', 404, 'not_found'));
    a.status = body.status;
    a.note = body.note;
    const now = new Date().toISOString();
    if (body.status === 'acknowledged') a.acknowledged_at = now;
    if (body.status === 'resolved') {
      a.resolved_at = now;
      a.acknowledged_at ??= now;
    }
    return lat({ ...a });
  }

  alertRules(): Observable<AlertRule[]> {
    return lat(this.be.rules.map((r) => ({ ...r })));
  }

  forecastPh(stationId: string, horizonHours: number): Observable<PhForecast> {
    const step = 10 * MIN;
    const now = Math.floor(Date.now() / step) * step;
    const cur = this.be.currentPh.get(stationId)?.outlet ?? 7.4;
    const rng = mulberry32(stationId.length * 31 + Math.floor(now / HOUR));
    const level = (t: number) => 7.38 + 0.12 * Math.sin(((new Date(t).getUTCHours() + new Date(t).getUTCMinutes() / 60 - 6) / 24) * Math.PI * 2);
    const history = Array.from({ length: 72 }, (_, i) => {
      const t = now - (71 - i) * step;
      return { ts: new Date(t).toISOString(), value: r2(level(t) + (rng() - 0.5) * 0.08) };
    });
    const anchor = history[history.length - 1].value;
    const nF = Math.round((horizonHours * HOUR) / step);
    const forecast = Array.from({ length: nF }, (_, i) => {
      const t = now + (i + 1) * step;
      const blend = Math.exp(-(i + 1) / 8);
      const v = level(t) * (1 - blend) + (anchor + (level(t) - level(now))) * blend + (cur - anchor) * blend * 0.3;
      const sigma = 0.04 + 0.018 * Math.sqrt(i + 1);
      return { ts: new Date(t).toISOString(), value: r2(v), lower: r2(v - 1.96 * sigma), upper: r2(v + 1.96 * sigma) };
    });
    return lat({ station_id: stationId, horizon_hours: horizonHours, history, forecast, note: null });
  }

  // ── Simulation (same outcome the real backend produces) ───────────────────
  private ok(detail: string): Observable<IngestResult> {
    return lat({ id: `ing-${Date.now().toString(36)}`, accepted: true, detail });
  }

  simulateAcidDischarge(stationId: string): Observable<IngestResult> {
    this.be.emitReading(stationId, 'inlet', 5.0);
    return this.ok('1 lectura(s) aceptada(s) · 1 alerta(s) disparada(s)');
  }

  simulateCentrifugeCycle(stationId: string, failed: boolean): Observable<IngestResult> {
    this.be.extras.cycles++;
    if (failed) this.be.extras.failures++;
    const state = failed ? 'fault' : 'running';
    const rpm = failed ? 3600 : 2850;
    const vib = failed ? 8.9 : 2.8;
    Object.assign(this.be.centrifuge.get(stationId)!, { state, rpm, vibration_mm_s: vib, updated_at: new Date().toISOString() });
    this.be.events$.next({ type: 'cycle_update', data: { station_id: stationId, state, rpm, vibration_mm_s: vib } });
    if (failed) this.be.createAlert({ station_id: stationId, severity: 'critical', message: `Vibración peligrosa en centrífuga: ${vib} mm/s (máx 7.1)`, parameter: null, value: vib });
    return this.ok(`Ciclo ${failed ? 'fallido' : 'completado'}`);
  }

  simulateTreatmentBatch(stationId: string): Observable<IngestResult> {
    this.be.addBatch(stationId, 520, 468 / 520, 3.4);
    return this.ok('Lote registrado · eficiencia 90%');
  }

  simulateWasteCollection(stationId: string, type: WasteType): Observable<IngestResult> {
    this.be.addWaste(stationId, type, 8.5, 40);
    return this.ok('Recolección registrada');
  }
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
