import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, shareReplay, switchMap, throwError } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiError } from '../interceptors/api-error.interceptor';
import {
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
  mapForecast,
  mapHotspot,
  mapOverview,
  mapPh,
  mapRule,
  mapSensorHealth,
  mapStation,
  mapWaste,
  mapWater,
} from './mappers';
import { RioApi } from './rio-api';

type Params = Record<string, string | number | undefined | null>;

const iso = (d = new Date()): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Real backend (`/api/v1`). GETs and `PATCH /alerts/{id}` carry no key; ingest POST/PATCH use `X-API-Key`. */
@Injectable()
export class HttpRioApi extends RioApi {
  private readonly http = inject(HttpClient);
  private readonly cfg = inject(APP_CONFIG);

  /** Station names (for alerts, which only carry `station_id`). Cached for the session. */
  private readonly names$ = this.get<PageDto<StationDto>>('/stations', { limit: 500 }).pipe(
    map((p) => new Map(p.items.map((s) => [s.id, s.name] as const))),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  private get<T>(path: string, params: Params = {}): Observable<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return this.http.get<T>(this.cfg.apiBaseUrl + path, { params: p });
  }

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
  }
}

