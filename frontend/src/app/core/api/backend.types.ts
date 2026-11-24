/**
 * Shapes returned by the real "Río Monitor" backend (see /API.md at the repo root).
 * They are translated into the UI models of `rio.models.ts` by `backend-mappers.ts`,
 * so screens never depend on these directly.
 */
import { AlertSeverity, AlertStatus, SensorPosition, SensorStatus, WasteType, WqiCategory } from '../models/rio.models';

export type BeSensorType = 'ph' | 'turbidity' | 'temperature' | 'dissolved_oxygen' | 'conductivity' | 'tds';
export type BeCycleStatus = 'running' | 'completed' | 'failed';

export interface BePage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface BeStation {
  id: string;
  name: string;
  river: string;
  latitude: number;
  longitude: number;
  status: 'active' | 'maintenance' | 'offline';
  installed_at: string | null;
  description: string | null;
}

export interface BeSensor {
  id: string;
  station_id: string;
  type: BeSensorType;
  location: SensorPosition;
  unit: string;
  status: SensorStatus;
}

export interface BeWqi {
  score: number;
  category: WqiCategory;
  dominant_parameter: BeSensorType | null;
  components: { parameter: BeSensorType; value: number; sub_index: number; weight: number }[];
}

export interface BeOverview {
  station_id: string | null;
  from: string;
  to: string;
  wqi: BeWqi | null;
  wqi_outlet: BeWqi | null;
  ph_inlet: { value: number; ts: string } | null;
  ph_outlet: { value: number; ts: string } | null;
  sensors_online: number;
  sensors_total: number;
  water_in_l: number;
  water_clean_l: number;
  sludge_kg: number;
  efficiency_pct: number | null;
  waste_kg: number;
  waste_items: number;
  cycles_running: number;
  alerts_open: number;
  alerts_critical_open: number;
  trend_bucket: string;
  trend: { bucket: string; wqi: number | null; ph_inlet: number | null; ph_outlet: number | null; water_clean_l: number }[];
}

export interface BeAgg {
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface BePhSeries {
  station_id: string | null;
  bucket: string;
  points: { bucket: string; inlet: BeAgg | null; outlet: BeAgg | null }[];
  inlet_avg: number | null;
  outlet_avg: number | null;
  avg_shift_toward_neutral: number | null;
}

export interface BeWaterTotals {
  batches: number;
  water_in_l: number;
  water_clean_l: number;
  water_lost_l: number;
  sludge_kg: number;
  efficiency_pct: number | null;
}

export interface BeWaterRecovery {
  total: BeWaterTotals;
  series: (BeWaterTotals & { bucket: string })[];
}

export interface BeWaste {
  total_kg: number;
  total_items: number;
  by_type: { waste_type: WasteType; weight_kg: number; items: number; collections: number }[];
  series: { bucket: string; waste_type: WasteType; weight_kg: number; items: number }[];
}

export interface BeCentrifuge {
  summary: {
    cycles: number;
    completed: number;
    failed: number;
    running: number;
    failure_rate_pct: number | null;
    rpm_avg: number | null;
    rpm_max: number | null;
    vibration_avg_mm_s: number | null;
    vibration_max_mm_s: number | null;
    power_avg_w: number | null;
    energy_kwh: number | null;
    avg_duration_s: number | null;
  };
  series: unknown[];
}

export interface BeCycle {
  id: string;
  station_id: string;
  started_at: string;
  ended_at: string | null;
  status: BeCycleStatus;
  rpm_avg: number | null;
  rpm_max: number | null;
  vibration_mm_s: number | null;
  power_w: number | null;
  updated_at: string;
}

export interface BeSensorHealth {
  sensor_id: string;
  station_id: string;
  station_name: string;
  type: BeSensorType;
  location: SensorPosition;
  unit: string;
  status: SensorStatus;
  last_seen_at: string | null;
  last_value: number | null;
  last_reading_at: string | null;
  readings_count: number;
  avg_quality: number | null;
  uptime_pct: number;
}

export interface BeHotspot {
  station_id: string;
  name: string;
  river: string;
  latitude: number;
  longitude: number;
  status: string;
  wqi: BeWqi | null;
  alerts_open: number;
  alerts_critical_open: number;
  last_reading_at: string | null;
}

export interface BeAlert {
  id: string;
  rule_id: string;
  station_id: string;
  sensor_id: string | null;
  kind: string;
  parameter: BeSensorType | null;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  trigger_value: number;
  threshold_min: number | null;
  threshold_max: number | null;
  first_triggered_at: string;
  last_triggered_at: string;
  occurrences: number;
  acknowledged_at: string | null;
  resolved_at: string | null;
  note: string | null;
}

export interface BeAlertRule {
  id: string;
  name: string;
  kind: 'reading_range' | 'sensor_offline' | 'centrifuge_vibration' | 'treatment_efficiency';
  severity: AlertSeverity;
  parameter: BeSensorType | null;
  location: SensorPosition | null;
  min_value: number | null;
  max_value: number | null;
  enabled: boolean;
  description: string | null;
}

export interface BeForecast {
  station_id: string;
  horizon_hours: number;
  history: { ts: string; value: number }[];
  points: { ts: string; value: number; lower: number; upper: number }[];
}

export interface BeIngestResult {
  received: number;
  accepted: number;
  duplicates: number;
  rejected: { index: number; reason: string; detail: string }[];
  alerts_triggered: number;
}

/** WebSocket envelope: `{ type, station_id, ts, data }`. */
export interface BeEnvelope {
  type: string;
  station_id: string | null;
  ts: string;
  data: Record<string, unknown>;
}
