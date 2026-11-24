/**
 * View models used by the screens. The wire format (exact `API.md` schemas) lives in
 * `api.models.ts`; `api/mappers.ts` converts one into the other. Timestamps: ISO-8601 UTC.
 */

export type WqiCategory = 'excelente' | 'buena' | 'regular' | 'mala' | 'critica' | 'sin_datos';
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
  river: string;
  latitude: number;
  longitude: number;
  status?: string;
}

export interface WqiScore {
  score: number; // 0..100 (0 when `category` is `sin_datos`)
  category: WqiCategory;
  /** Parameter with the lowest sub-index, e.g. "turbidity". */
  dominant_parameter: string | null;
}

/** GET /dashboard/overview (mapped) */
export interface DashboardOverview {
  from: string;
  to: string;
  wqi: { river: WqiScore; outlet: WqiScore };
  ph: { inlet: number | null; outlet: number | null; improvement_pct: number | null };
  sensors: { online: number; total: number };
  treatment_efficiency_pct: number;
  recovery: { clean_liters: number; waste_kg: number };
  alerts: { open: number; critical: number };
}

export interface Stat {
  avg: number;
  min: number;
  max: number;
}

export interface PhAnalytics {
  bucket: Bucket;
  /** Relative change outlet vs. inlet, in %. */
  avg_improvement_pct: number;
  series: { ts: string; inlet: Stat; outlet: Stat }[];
}

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

export interface WasteAnalytics {
  bucket: Bucket;
  total_kg: number;
  by_type: { type: WasteType; kg: number; pieces: number }[];
}

export interface CentrifugeAnalytics {
  bucket: Bucket;
  cycles_total: number;
  failures: number;
  avg_rpm: number;
  avg_vibration_mm_s: number;
  energy_kwh: number;
  current: { state: CentrifugeState; rpm: number; vibration_mm_s: number; updated_at: string };
}

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
  occurrences: number;
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

export interface AlertRule {
  id: string;
  name: string;
  kind: 'reading_range' | 'sensor_offline' | 'centrifuge_vibration' | 'treatment_efficiency';
  severity: AlertSeverity;
  parameter: string | null;
  location: string | null;
  min_value: number | null;
  max_value: number | null;
  enabled: boolean;
  description: string | null;
}

export type AlertRulePatch = Partial<Pick<AlertRule, 'severity' | 'min_value' | 'max_value' | 'enabled'>>;

export type StationStatus = 'active' | 'maintenance' | 'offline';

export interface PhForecast {
  station_id: string;
  horizon_hours: number;
  history: { ts: string; value: number }[];
  forecast: { ts: string; value: number; lower: number; upper: number }[];
  /** Why the forecast is empty (e.g. too few samples). */
  note: string | null;
}

/** Outcome of a simulated ingest action. */
export interface IngestResult {
  id: string;
  accepted: boolean;
  detail: string;
}

// ── Live events (already mapped from the WebSocket envelope) ─────────────────
export type LiveEvent =
  | { type: 'hello' | 'ping'; data?: unknown }
  | { type: 'reading'; data: { station_id: string; sensor_id: string; position: SensorPosition; parameter: string; value: number; unit: string; timestamp: string } }
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
