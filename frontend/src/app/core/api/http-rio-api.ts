import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
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
import { RioApi } from './rio-api';

type Params = Record<string, string | number | undefined | null>;

/** Real backend: `http://localhost:8000/api/v1`. GETs and PATCH /alerts/{id} carry no key; POST ingest uses X-API-Key. */
@Injectable()
export class HttpRioApi extends RioApi {
  private readonly http = inject(HttpClient);
  private readonly cfg = inject(APP_CONFIG);

  private get<T>(path: string, params: Params = {}): Observable<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return this.http.get<T>(this.cfg.apiBaseUrl + path, { params: p });
  }

  private ingest<T>(path: string, body: unknown): Observable<T> {
    const headers = new HttpHeaders({ 'X-API-Key': this.cfg.ingestApiKey });
    return this.http.post<T>(this.cfg.apiBaseUrl + path, body, { headers });
  }

  stations() { return this.get<Station[]>('/stations'); }
  overview(q: Query) { return this.get<DashboardOverview>('/dashboard/overview', { ...q }); }
  ph(q: Query, bucket: Bucket) { return this.get<PhAnalytics>('/analytics/ph', { ...q, bucket }); }
  waterRecovery(q: Query, bucket: Bucket) { return this.get<WaterRecovery>('/analytics/water-recovery', { ...q, bucket }); }
  waste(q: Query, bucket: Bucket) { return this.get<WasteAnalytics>('/analytics/waste', { ...q, bucket }); }
  centrifuge(q: Query, bucket: Bucket) { return this.get<CentrifugeAnalytics>('/analytics/centrifuge', { ...q, bucket }); }
  sensorsHealth(q: Query) { return this.get<SensorHealth[]>('/analytics/sensors/health', { ...q }); }
  hotspots(q: Query) { return this.get<Hotspot[]>('/analytics/hotspots', { ...q }); }
  alerts(f: AlertFilters) { return this.get<Page<Alert>>('/alerts', { ...f }); }
  patchAlert(id: string, body: AlertPatch) { return this.http.patch<Alert>(`${this.cfg.apiBaseUrl}/alerts/${id}`, body); }
  alertRules() { return this.get<AlertRule[]>('/alert-rules'); }
  forecastPh(stationId: string, horizonHours: number) {
    return this.get<PhForecast>('/analytics/forecast/ph', { station_id: stationId, horizon: horizonHours });
  }
  postReading(b: ReadingIngest) { return this.ingest<IngestResult>('/readings', b); }
  postCentrifugeCycle(b: CentrifugeCycleIngest) { return this.ingest<IngestResult>('/centrifuge-cycles', b); }
  postTreatmentBatch(b: TreatmentBatchIngest) { return this.ingest<IngestResult>('/treatment-batches', b); }
  postWasteCollection(b: WasteCollectionIngest) { return this.ingest<IngestResult>('/waste-collections', b); }
}
