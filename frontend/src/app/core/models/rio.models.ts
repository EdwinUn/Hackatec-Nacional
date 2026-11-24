/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MODELOS DE VISTA DEL FRONTEND
 * ═══════════════════════════════════════════════════════════════════════════════
 * Lo que consumen las pantallas y el mock. El contrato real del backend (/API.md) vive
 * en `core/api/backend.types.ts` y se traduce a estos modelos en `core/api/backend-mappers.ts`;
 * si el backend cambia, ajustar allí, no en las pantallas.
 * Timestamps: ISO-8601 UTC.
 */

export type WqiCategory = 'excelente' | 'buena' | 'regular' | 'mala' | 'critica';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';
export type SensorStatus = 'ok' | 'degraded' | 'fault' | 'offline';
export type SensorPosition = 'inlet' | 'outlet' | 'river';
export type WasteType = 'plastic' | 'organic' | 'metal' | 'glass' | 'other';
export type CentrifugeState = 'running' | 'idle' | 'fault' | 'maintenance';
export type Bucket = '5m' | '1h';

/** Error body: `{ "error": { "code": "...", "message": "..." } }` */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface Station {
  id: string; // uuid
  name: string;
  code: string;
  municipality: string;
  river: string;
  latitude: number;
  longitude: number;
}

export interface WqiScore {
  score: number; // 0..100
  category: WqiCategory;
  dominant_parameter: string; // e.g. "ph", "do", "turbidity"
}

/** GET /dashboard/overview */
export interface DashboardOverview {
  from: string;
  to: string;
  wqi: { river: WqiScore; outlet: WqiScore; trend: number[] };
  ph: { inlet: number; outlet: number; improvement_pct: number; trend: number[] };
  sensors: { online: number; total: number };
  treatment_efficiency_pct: number;
  recovery: { clean_liters: number; waste_kg: number; trend: number[] };
  alerts: { open: number; critical: number };
}

export interface Stat {
  avg: number;
  min: number;
  max: number;
}

/** GET /analytics/ph?bucket=5m */
export interface PhAnalytics {
  bucket: Bucket;
  avg_improvement_pct: number;
  series: { ts: string; inlet: Stat; outlet: Stat }[];
}

/** GET /analytics/water-recovery?bucket=1h */
export interface WaterRecovery {
  bucket: Bucket;
  totals: {
    liters_in: number;
    liters_clean: number;
    liters_lost: number;
    sludge_kg: number;
    efficiency_pct: number;
  };
  series: { ts: string; liters_in: number; liters_clean: number }[];
}

/** GET /analytics/waste?bucket=1h */
export interface WasteAnalytics {
  bucket: Bucket;
  total_kg: number;
  by_type: { type: WasteType; kg: number; pieces: number }[];
}

/** GET /analytics/centrifuge?bucket=1h */
export interface CentrifugeAnalytics {
  bucket: Bucket;
  cycles_total: number;
  failures: number;
  avg_rpm: number;
  avg_vibration_mm_s: number;
  energy_kwh: number;
  current: { state: CentrifugeState; rpm: number; vibration_mm_s: number; updated_at: string };
}

/** GET /analytics/sensors/health */
export interface SensorHealth {
  sensor_id: string;
  name: string;
  station_id: string;
  position: SensorPosition;
  parameter: string;
  status: SensorStatus;
  last_reading: { value: number; unit: string; ts: string } | null;
  signal_quality_pct: number;
  uptime_pct: number;
}

/** GET /analytics/hotspots */
export interface Hotspot {
  station_id: string;
  name: string;
  latitude: number;
  longitude: number;
  wqi: WqiScore;
  open_alerts: number;
  critical_alerts: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** GET /alerts · PATCH /alerts/{id} */
export interface Alert {
  id: string;
  station_id: string;
  station_name: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  parameter: string | null;
  value: number | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  note: string | null;
}

export interface AlertPatch {
  status: Exclude<AlertStatus, 'open'>;
  note: string;
}

export interface AlertFilters {
  status?: AlertStatus;
  severity?: AlertSeverity;
  station_id?: string;
  limit: number;
  offset: number;
}

/** GET /alert-rules */
export interface AlertRule {
  id: string;
  name: string;
  parameter: string;
  operator: '<' | '<=' | '>' | '>=';
  threshold: number;
  unit: string;
  severity: AlertSeverity;
  enabled: boolean;
  description: string | null;
  /** Full condition text when the rule is a range (e.g. «fuera de 6.5–8.5 pH»). */
  condition?: string;
}

/** GET /analytics/forecast/ph?station_id=…&horizon=6 */
export interface PhForecast {
  station_id: string;
  horizon_hours: number;
  history: { ts: string; value: number }[];
  forecast: { ts: string; value: number; lower: number; upper: number }[];
}

// ── Ingest / simulation (POST, header `X-API-Key`) ────────────────────────────
export interface ReadingIngest {
  station_id: string;
  position: SensorPosition;
  parameter: string;
  value: number;
  unit: string;
  timestamp?: string;
}
export interface CentrifugeCycleIngest {
  station_id: string;
  started_at: string;
  ended_at: string;
  avg_rpm: number;
  max_vibration_mm_s: number;
  energy_kwh: number;
  status: 'completed' | 'failed';
}
export interface TreatmentBatchIngest {
  station_id: string;
  liters_in: number;
  liters_clean: number;
  sludge_kg: number;
  started_at: string;
  ended_at: string;
}
export interface WasteCollectionIngest {
  station_id: string;
  waste_type: WasteType;
  kg: number;
  pieces: number;
  collected_at: string;
}
export interface IngestResult {
  id: string;
  accepted: boolean;
}

// ── WebSocket (ws://…/ws/live[?station_id=<uuid>]) ────────────────────────────
export type LiveEvent =
  | { type: 'hello' | 'ping'; data?: unknown }
  | { type: 'reading'; data: { station_id: string; position: SensorPosition; parameter: string; value: number; unit: string; timestamp: string } }
  | { type: 'sensor_status'; data: { station_id: string; sensor_id: string; status: SensorStatus; signal_quality_pct?: number } }
  | { type: 'cycle_update'; data: { station_id: string; state: CentrifugeState; rpm: number; vibration_mm_s: number } }
  | { type: 'batch_completed'; data: { station_id: string; liters_in: number; liters_clean: number; sludge_kg: number } }
  | { type: 'waste_collected'; data: { station_id: string; waste_type: WasteType; kg: number; pieces: number } }
  | { type: 'alert'; data: Alert };

export type LiveEventType = LiveEvent['type'];
export type LiveStatus = 'connected' | 'reconnecting' | 'disconnected';

/** Common query: optional station + ISO UTC range. */
export interface Query {
  station_id?: string;
  from?: string;
  to?: string;
}
