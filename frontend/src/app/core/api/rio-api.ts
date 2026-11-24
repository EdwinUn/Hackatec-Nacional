import { Observable } from 'rxjs';
import {
  Alert,
  AlertFilters,
  AlertPatch,
  AlertRule,
  AlertRulePatch,
  Bucket,
  CentrifugeAnalytics,
  CriticalPoint,
  DashboardOverview,
  Hotspot,
  IngestResult,
  Page,
  PhAnalytics,
  PhForecast,
  Query,
  SensorHealth,
  Station,
  StationStatus,
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
  abstract criticalPoints(q: Query): Observable<CriticalPoint[]>;
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

  // ── Field operations on existing endpoints (`X-API-Key` / staff token) ─────
  /** `POST /waste-collections` with the real weight recorded by a technician. */
  abstract recordWasteCollection(stationId: string, type: WasteType, kg: number, pieces: number, collectorId: string): Observable<IngestResult>;
  /** `PATCH /stations/{id}` → `{ status }` */
  abstract setStationStatus(stationId: string, status: StationStatus): Observable<void>;
  /** `PATCH /sensors/{id}` → `{ calibration_offset, calibration_factor, calibrated_at }` */
  abstract calibrateSensor(sensorId: string, offset: number, factor: number): Observable<void>;
  /** `PATCH /alert-rules/{id}` */
  abstract patchAlertRule(id: string, body: AlertRulePatch): Observable<AlertRule>;
}
