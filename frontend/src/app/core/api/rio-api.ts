import { Observable } from 'rxjs';
import {
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

/** Data-access contract of the "Río Monitor" backend. Implemented by HTTP and by the mock backend. */
export abstract class RioApi {
  abstract stations(): Observable<Station[]>;
  abstract overview(q: Query): Observable<DashboardOverview>;
  abstract ph(q: Query, bucket: Bucket): Observable<PhAnalytics>;
  abstract waterRecovery(q: Query, bucket: Bucket): Observable<WaterRecovery>;
  abstract waste(q: Query, bucket: Bucket): Observable<WasteAnalytics>;
  abstract centrifuge(q: Query, bucket: Bucket): Observable<CentrifugeAnalytics>;
  abstract sensorsHealth(q: Query): Observable<SensorHealth[]>;
  abstract hotspots(q: Query): Observable<Hotspot[]>;
  abstract criticalPoints(q: Query): Observable<CriticalPoint[]>;
  abstract alerts(f: AlertFilters): Observable<Page<Alert>>;
  abstract patchAlert(id: string, body: AlertPatch): Observable<Alert>;
  abstract alertRules(): Observable<AlertRule[]>;
  abstract forecastPh(stationId: string, horizonHours: number): Observable<PhForecast>;
  // Simulation / ingest (X-API-Key)
  abstract postReading(body: ReadingIngest): Observable<IngestResult>;
  abstract postCentrifugeCycle(body: CentrifugeCycleIngest): Observable<IngestResult>;
  abstract postTreatmentBatch(body: TreatmentBatchIngest): Observable<IngestResult>;
  abstract postWasteCollection(body: WasteCollectionIngest): Observable<IngestResult>;
}
