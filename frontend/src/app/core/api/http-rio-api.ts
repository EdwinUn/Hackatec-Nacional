import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, shareReplay, switchMap, throwError } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import {
  Alert,
  AlertFilters,
  AlertPatch,
  AlertRule,
  Bucket,
  CentrifugeAnalytics,
  CentrifugeCycleIngest,
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
  mapForecast,
  mapHotspot,
  mapOverview,
  mapPh,
  mapSensorHealth,
  mapStation,
  mapWaste,
  mapWater,
} from './backend-mappers';
import {
  BeAlert,
  BeAlertRule,
  BeCentrifuge,
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
import { RioApi } from './rio-api';

type Params = Record<string, string | number | undefined | null>;

/**
 * Real backend (`http://localhost:8000/api/v1`, contract in /API.md). Responses are translated
 * to the UI models by `backend-mappers.ts`. GETs and PATCH /alerts/{id} carry no key; ingest
 * POST/PATCH use `X-API-Key`.
 */
@Injectable()
export class HttpRioApi extends RioApi {
  private readonly http = inject(HttpClient);
  private readonly cfg = inject(APP_CONFIG);

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

  private get<T>(path: string, params: Params = {}): Observable<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return this.http.get<T>(this.url(path), { params: p });
  }

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
  }
}
