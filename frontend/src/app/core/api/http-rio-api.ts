import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
<<<<<<< HEAD
import { Observable, forkJoin, map, shareReplay, switchMap, throwError } from 'rxjs';
=======
import { Observable, combineLatest, map, shareReplay, switchMap, throwError } from 'rxjs';
>>>>>>> origin/feature/prototipo-c-skimmer
import { APP_CONFIG } from '../config/app-config';
import { ApiError } from '../interceptors/api-error.interceptor';
import {
<<<<<<< HEAD
  Alert,
  AlertFilters,
  AlertPatch,
  AlertRule,
  Bucket,
  CentrifugeAnalytics,
  CentrifugeCycleIngest,
  CriticalPoint,
  DashboardOverview,
  Hotspot,
  IngestResult,
  Page,
  PhAnalytics,
  PhForecast,
  Query,
  ReadingIngest,
  SensorHealth,
  Station,
  TreatmentBatchIngest,
  WasteAnalytics,
  WasteCollectionIngest,
  WaterRecovery,
} from '../models/rio.models';
import {
  mapAlert,
  mapAlertRule,
  mapCentrifuge,
  mapCriticalPoint,
=======
  AlertDto,
  AlertRuleDto,
  CentrifugeAnalyticsDto,
  CycleDto,
  HotspotDto,
  OverviewDto,
  PageDto,
  PhForecastDto,
  PhSeriesDto,
  ReadingsIngestResultDto,
  SensorDto,
  SensorHealthDto,
  StationDto,
  WasteAnalyticsDto,
  WaterRecoveryDto,
} from '../models/api.models';
import { AlertFilters, AlertPatch, Bucket, IngestResult, Query, WasteType } from '../models/rio.models';
import {
  mapAlert,
  mapCentrifuge,
>>>>>>> origin/feature/prototipo-c-skimmer
  mapForecast,
  mapHotspot,
  mapOverview,
  mapPh,
<<<<<<< HEAD
=======
  mapRule,
>>>>>>> origin/feature/prototipo-c-skimmer
  mapSensorHealth,
  mapStation,
  mapWaste,
  mapWater,
<<<<<<< HEAD
} from './backend-mappers';
import {
  BeAlert,
  BeAlertRule,
  BeCentrifuge,
  BeCriticalPoint,
  BeCycle,
  BeForecast,
  BeHotspot,
  BeIngestResult,
  BeOverview,
  BePage,
  BePhSeries,
  BeSensor,
  BeSensorHealth,
  BeStation,
  BeWaste,
  BeWaterRecovery,
} from './backend.types';
=======
} from './mappers';
>>>>>>> origin/feature/prototipo-c-skimmer
import { RioApi } from './rio-api';

type Params = Record<string, string | number | undefined | null>;

<<<<<<< HEAD
/**
 * Real backend (`http://localhost:8000/api/v1`, contract in /API.md). Responses are translated
 * to the UI models by `backend-mappers.ts`. GETs and PATCH /alerts/{id} carry no key; ingest
 * POST/PATCH use `X-API-Key`.
 */
=======
const iso = (d = new Date()): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Real backend (`/api/v1`). GETs and `PATCH /alerts/{id}` carry no key; ingest POST/PATCH use `X-API-Key`. */
>>>>>>> origin/feature/prototipo-c-skimmer
@Injectable()
export class HttpRioApi extends RioApi {
  private readonly http = inject(HttpClient);
  private readonly cfg = inject(APP_CONFIG);

<<<<<<< HEAD
  /** Station names for alerts (the backend sends only `station_id`). */
  private readonly stationNames$ = this.get<BePage<BeStation>>('/stations', { limit: 500 }).pipe(
    map((p) => new Map(p.items.map((s) => [s.id, s.name]))),
    shareReplay({ bufferSize: 1, refCount: false }),
  );
  /** `station:type:location` → sensor_id, to send readings the way the backend expects them. */
  private readonly sensorIndex$ = this.get<BePage<BeSensor>>('/sensors', { limit: 500 }).pipe(
    map((p) => new Map(p.items.map((s) => [`${s.station_id}:${s.type}:${s.location}`, s.id]))),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  private url(path: string): string {
    return this.cfg.apiBaseUrl + path;
  }

=======
  /** Station names (for alerts, which only carry `station_id`). Cached for the session. */
  private readonly names$ = this.get<PageDto<StationDto>>('/stations', { limit: 500 }).pipe(
    map((p) => new Map(p.items.map((s) => [s.id, s.name] as const))),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

>>>>>>> origin/feature/prototipo-c-skimmer
  private get<T>(path: string, params: Params = {}): Observable<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return this.http.get<T>(this.url(path), { params: p });
  }

<<<<<<< HEAD
  private get keyHeaders() {
    return { headers: new HttpHeaders({ 'X-API-Key': this.cfg.ingestApiKey }) };
  }

  private withNames<T>(fn: (name: (id: string) => string) => T) {
    return map((names: Map<string, string>) => fn((id) => names.get(id) ?? id));
  }

  // ── Lectura ──────────────────────────────────────────────────────────────────
  stations(): Observable<Station[]> {
    return this.get<BePage<BeStation>>('/stations', { limit: 500 }).pipe(map((p) => p.items.map(mapStation)));
  }

  overview(q: Query): Observable<DashboardOverview> {
    return this.get<BeOverview>('/dashboard/overview', { ...q }).pipe(map(mapOverview));
  }

  ph(q: Query, bucket: Bucket): Observable<PhAnalytics> {
    return this.get<BePhSeries>('/analytics/ph', { ...q, bucket }).pipe(map((r) => mapPh(r, bucket)));
  }

  waterRecovery(q: Query, bucket: Bucket): Observable<WaterRecovery> {
    return this.get<BeWaterRecovery>('/analytics/water-recovery', { ...q, bucket }).pipe(map((r) => mapWater(r, bucket)));
  }

  waste(q: Query, bucket: Bucket): Observable<WasteAnalytics> {
    return this.get<BeWaste>('/analytics/waste', { ...q, bucket }).pipe(map((r) => mapWaste(r, bucket)));
  }

  centrifuge(q: Query, bucket: Bucket): Observable<CentrifugeAnalytics> {
    return forkJoin({
      stats: this.get<BeCentrifuge>('/analytics/centrifuge', { ...q, bucket }),
      latest: this.get<BePage<BeCycle>>('/centrifuge-cycles', { station_id: q.station_id, limit: 1 }),
    }).pipe(map(({ stats, latest }) => mapCentrifuge(stats, latest.items[0], bucket)));
  }

  sensorsHealth(q: Query): Observable<SensorHealth[]> {
    return this.get<BeSensorHealth[]>('/analytics/sensors/health', { ...q }).pipe(map((l) => l.map(mapSensorHealth)));
  }

  hotspots(_q: Query): Observable<Hotspot[]> {
    // The backend always returns the current state of every station (no range).
    return this.get<BeHotspot[]>('/analytics/hotspots').pipe(map((l) => l.map(mapHotspot)));
  }

  criticalPoints(q: Query): Observable<CriticalPoint[]> {
    return this.get<BeCriticalPoint[]>('/analytics/critical-points', { from: q.from, to: q.to }).pipe(
      map((l) => l.map(mapCriticalPoint)),
    );
  }

  alerts(f: AlertFilters): Observable<Page<Alert>> {
    return forkJoin({ page: this.get<BePage<BeAlert>>('/alerts', { ...f }), names: this.stationNames$ }).pipe(
      map(({ page, names }) => ({ ...page, items: page.items.map((a) => mapAlert(a, (id) => names.get(id) ?? id)) })),
    );
  }

  patchAlert(id: string, body: AlertPatch): Observable<Alert> {
    return this.http
      .patch<BeAlert>(this.url(`/alerts/${id}`), body)
      .pipe(switchMap((a) => this.stationNames$.pipe(this.withNames((name) => mapAlert(a, name)))));
  }

  alertRules(): Observable<AlertRule[]> {
    return this.get<BeAlertRule[]>('/alert-rules').pipe(map((l) => l.map(mapAlertRule)));
  }

  forecastPh(stationId: string, horizonHours: number): Observable<PhForecast> {
    return this.get<BeForecast>('/analytics/forecast/ph', { station_id: stationId, horizon: horizonHours }).pipe(map(mapForecast));
  }

  /** Station names for the live stream (alerts from the WebSocket carry only the id). */
  stationNames(): Observable<Map<string, string>> {
    return this.stationNames$;
  }

  // ── Simulación / ingesta (X-API-Key) ────────────────────────────────────────
  postReading(b: ReadingIngest): Observable<IngestResult> {
    return this.sensorIndex$.pipe(
      switchMap((index) => {
        const sensorId = index.get(`${b.station_id}:${b.parameter}:${b.position}`);
        if (!sensorId) return throwError(() => new Error(`La estación no tiene sensor de ${b.parameter} en ${b.position}`));
        const body = { readings: [{ sensor_id: sensorId, ts: b.timestamp ?? new Date().toISOString(), value: b.value }] };
        return this.http.post<BeIngestResult>(this.url('/readings'), body, this.keyHeaders).pipe(
          map((r) => ({ id: sensorId, accepted: r.accepted + r.duplicates > 0 })),
        );
      }),
    );
  }

  /** The backend models a cycle as start (POST) + close (PATCH); a finished cycle needs both. */
  postCentrifugeCycle(b: CentrifugeCycleIngest): Observable<IngestResult> {
    const durationS = Math.max(1, (new Date(b.ended_at).getTime() - new Date(b.started_at).getTime()) / 1000);
    return this.http
      .post<BeCycle>(this.url('/centrifuge-cycles'), { station_id: b.station_id, started_at: b.started_at, rpm_avg: b.avg_rpm }, this.keyHeaders)
      .pipe(
        switchMap((cycle) =>
          this.http.patch<BeCycle>(
            this.url(`/centrifuge-cycles/${cycle.id}`),
            {
              status: b.status,
              ended_at: b.ended_at,
              vibration_mm_s: b.max_vibration_mm_s,
              power_w: Math.round((b.energy_kwh * 3.6e6) / durationS),
              failure_reason: b.status === 'failed' ? 'Simulación: falla de centrífuga' : undefined,
            },
            this.keyHeaders,
          ),
        ),
        map((c) => ({ id: c.id, accepted: true })),
      );
  }

  postTreatmentBatch(b: TreatmentBatchIngest): Observable<IngestResult> {
    const body = {
      station_id: b.station_id,
      ts: b.ended_at,
      volume_in_l: b.liters_in,
      volume_clean_l: b.liters_clean,
      sludge_kg: b.sludge_kg,
    };
    return this.http.post<{ id: string }>(this.url('/treatment-batches'), body, this.keyHeaders).pipe(map((r) => ({ id: r.id, accepted: true })));
  }

  postWasteCollection(b: WasteCollectionIngest): Observable<IngestResult> {
    const body = {
      station_id: b.station_id,
      ts: b.collected_at,
      weight_kg: b.kg,
      items_count: b.pieces,
      waste_type: b.waste_type,
      collector_id: 'simulador-web',
    };
    return this.http.post<{ id: string }>(this.url('/waste-collections'), body, this.keyHeaders).pipe(map((r) => ({ id: r.id, accepted: true })));
=======
  private get keyHeaders(): HttpHeaders {
    return new HttpHeaders({ 'X-API-Key': this.cfg.ingestApiKey });
  }
  private post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(this.cfg.apiBaseUrl + path, body, { headers: this.keyHeaders });
  }
  private patchKey<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(this.cfg.apiBaseUrl + path, body, { headers: this.keyHeaders });
  }

  stations() {
    return this.get<PageDto<StationDto>>('/stations', { limit: 500 }).pipe(map((p) => p.items.map(mapStation)));
  }
  overview(q: Query) {
    return this.get<OverviewDto>('/dashboard/overview', { ...q }).pipe(map(mapOverview));
  }
  ph(q: Query, bucket: Bucket) {
    return this.get<PhSeriesDto>('/analytics/ph', { ...q, bucket }).pipe(map((d) => mapPh(d, bucket)));
  }
  waterRecovery(q: Query, bucket: Bucket) {
    return this.get<WaterRecoveryDto>('/analytics/water-recovery', { ...q, bucket }).pipe(map((d) => mapWater(d, bucket)));
  }
  waste(q: Query, bucket: Bucket) {
    return this.get<WasteAnalyticsDto>('/analytics/waste', { ...q, bucket }).pipe(map((d) => mapWaste(d, bucket)));
  }
  centrifuge(q: Query, bucket: Bucket) {
    return this.get<CentrifugeAnalyticsDto>('/analytics/centrifuge', { ...q, bucket }).pipe(map((d) => mapCentrifuge(d, bucket)));
  }
  sensorsHealth(q: Query) {
    return this.get<SensorHealthDto[]>('/analytics/sensors/health', { ...q }).pipe(map((l) => l.map(mapSensorHealth)));
  }
  hotspots() {
    return this.get<HotspotDto[]>('/analytics/hotspots').pipe(map((l) => l.map(mapHotspot)));
  }
  alerts(f: AlertFilters) {
    return combineLatest([this.get<PageDto<AlertDto>>('/alerts', { ...f }), this.names$]).pipe(
      map(([p, names]) => ({ ...p, items: p.items.map((a) => mapAlert(a, (id) => (id ? (names.get(id) ?? id) : '—'))) })),
    );
  }
  patchAlert(id: string, body: AlertPatch) {
    return this.http.patch<AlertDto>(`${this.cfg.apiBaseUrl}/alerts/${id}`, body).pipe(
      switchMap((a) => this.names$.pipe(map((names) => mapAlert(a, (sid) => (sid ? (names.get(sid) ?? sid) : '—'))))),
    );
  }
  alertRules() {
    return this.get<AlertRuleDto[]>('/alert-rules').pipe(map((l) => l.map(mapRule)));
  }
  forecastPh(stationId: string, horizonHours: number) {
    return this.get<PhForecastDto>('/analytics/forecast/ph', { station_id: stationId, horizon: horizonHours, lookback: 12, location: 'inlet' }).pipe(map(mapForecast));
  }

  // ── Simulation ─────────────────────────────────────────────────────────────
  simulateAcidDischarge(stationId: string): Observable<IngestResult> {
    return this.get<PageDto<SensorDto>>('/sensors', { station_id: stationId, type: 'ph', location: 'inlet', limit: 1 }).pipe(
      switchMap((p) => {
        const sensor = p.items[0];
        if (!sensor) return throwError(() => new ApiError('La estación no tiene un sensor de pH en la entrada.', 404, 'not_found'));
        return this.post<ReadingsIngestResultDto>('/readings', { readings: [{ sensor_id: sensor.id, ts: iso(), value: 5.0, quality: 0.97 }] });
      }),
      map((r) => ({ id: '', accepted: r.accepted > 0, detail: `${r.accepted} lectura(s) aceptada(s) · ${r.alerts_triggered} alerta(s) disparada(s)${r.rejected[0] ? ' · ' + r.rejected[0].detail : ''}` })),
    );
  }

  simulateCentrifugeCycle(stationId: string, failed: boolean): Observable<IngestResult> {
    return this.post<CycleDto>('/centrifuge-cycles', { station_id: stationId, started_at: iso(new Date(Date.now() - 20 * 60_000)), rpm_avg: failed ? 3600 : 2800 }).pipe(
      switchMap((c) =>
        this.patchKey<CycleDto>(
          `/centrifuge-cycles/${c.id}`,
          failed
            ? { status: 'failed', failure_reason: 'Vibración excesiva', vibration_mm_s: 8.9, rpm_max: 3700 }
            : { status: 'completed', rpm_avg: 2850, rpm_max: 3010, vibration_mm_s: 2.8, power_w: 750, water_in_l: 520, water_out_clean_l: 468, sludge_kg: 3.4 },
        ),
      ),
      map((c) => ({ id: c.id, accepted: true, detail: `Ciclo ${c.status === 'failed' ? 'fallido' : 'completado'} · ${c.id.slice(0, 8)}` })),
    );
  }

  simulateTreatmentBatch(stationId: string): Observable<IngestResult> {
    return this.post<{ id: string; efficiency_pct: number }>('/treatment-batches', {
      station_id: stationId, ts: iso(), volume_in_l: 520, volume_clean_l: 468, sludge_kg: 3.4, ph_in: 5.6, ph_out: 6.9, turbidity_in_ntu: 85, turbidity_out_ntu: 3.2,
    }).pipe(map((b) => ({ id: b.id, accepted: true, detail: `Lote registrado · eficiencia ${b.efficiency_pct}%` })));
  }

  simulateWasteCollection(stationId: string, type: WasteType): Observable<IngestResult> {
    return this.post<{ id: string }>('/waste-collections', { station_id: stationId, ts: iso(), weight_kg: 8.5, items_count: 40, waste_type: type, collector_id: 'banda-1' }).pipe(
      map((w) => ({ id: w.id, accepted: true, detail: `Recolección registrada · ${w.id.slice(0, 8)}` })),
    );
>>>>>>> origin/feature/prototipo-c-skimmer
  }
}

