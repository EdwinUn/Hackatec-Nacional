import { Observable } from 'rxjs';
import {
  Alert,
  AlertFilters,
  AlertPatch,
  AlertRule,
  Bucket,
  CentrifugeAnalytics,
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

/** Data-access contract of the "Río Monitor" backend. Implemented by HTTP and by the mock backend. */
export abstract class RioApi {
  abstract stations(): Observable<Station[]>;
  abstract overview(q: Query): Observable<DashboardOverview>;
  abstract ph(q: Query, bucket: Bucket): Observable<PhAnalytics>;
  abstract waterRecovery(q: Query, bucket: Bucket): Observable<WaterRecovery>;
  abstract waste(q: Query, bucket: Bucket): Observable<WasteAnalytics>;
  abstract centrifuge(q: Query, bucket: Bucket): Observable<CentrifugeAnalytics>;
  abstract sensorsHealth(q: Query): Observable<SensorHealth[]>;
  abstract hotspots(): Observable<Hotspot[]>;
  abstract alerts(f: AlertFilters): Observable<Page<Alert>>;
  abstract patchAlert(id: string, body: AlertPatch): Observable<Alert>;
  abstract alertRules(): Observable<AlertRule[]>;
  abstract forecastPh(stationId: string, horizonHours: number): Observable<PhForecast>;

  // ── IoT simulation (ingest endpoints, `X-API-Key`) ─────────────────────────
  /** pH 5.0 on the inlet sensor of the station → triggers a critical alert. */
  abstract simulateAcidDischarge(stationId: string): Observable<IngestResult>;
  /** Starts and closes a centrifuge cycle (`failed` = excessive vibration). */
  abstract simulateCentrifugeCycle(stationId: string, failed: boolean): Observable<IngestResult>;
  abstract simulateTreatmentBatch(stationId: string): Observable<IngestResult>;
  abstract simulateWasteCollection(stationId: string, type: WasteType): Observable<IngestResult>;
}
