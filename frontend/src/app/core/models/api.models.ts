/**
 * Wire schemas of the Río Monitor backend — copied from `API.md` (and the live OpenAPI).
 * These are the EXACT shapes sent over HTTP/WebSocket. Views use the friendlier models in
 * `rio.models.ts`; `api/mappers.ts` converts between the two. Dates are ISO-8601 UTC.
 */

export type SensorTypeDto = 'ph' | 'turbidity' | 'temperature' | 'dissolved_oxygen' | 'conductivity' | 'tds';
export type SensorLocationDto = 'inlet' | 'outlet' | 'river';
export type SensorStatusDto = 'ok' | 'degraded' | 'fault' | 'offline';
export type SeverityDto = 'info' | 'warning' | 'critical';
export type AlertStatusDto = 'open' | 'acknowledged' | 'resolved';
export type CycleStatusDto = 'running' | 'completed' | 'failed';
export type WasteTypeDto = 'plastic' | 'organic' | 'metal' | 'glass' | 'other';
export type RuleKindDto = 'reading_range' | 'sensor_offline' | 'centrifuge_vibration' | 'treatment_efficiency';
export type WqiCategoryDto = 'excelente' | 'buena' | 'regular' | 'mala' | 'critica';
export type BucketDto = '1m' | '5m' | '1h' | '1d';

/** `{ "items": [...], "total": 37, "limit": 50, "offset": 0 }` */
export interface PageDto<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** `{ "error": { "code": "not_found", "message": "…", "details": null } }` */
export interface ErrorDto {
  error: { code: string; message: string; details: unknown };
}

export interface StationDto {
  id: string;
  name: string;
  river: string;
  latitude: number;
  longitude: number;
  status: 'active' | 'maintenance' | 'offline';
  installed_at: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface SensorDto {
  id: string;
  station_id: string;
  type: SensorTypeDto;
  location: SensorLocationDto;
  unit: string;
  status: SensorStatusDto;
  last_seen_at: string | null;
}

export interface WqiComponentDto {
  parameter: string;
  value: number;
  sub_index: number;
  weight: number;
}
export interface WqiDto {
  score: number;
  category: WqiCategoryDto;
  components: WqiComponentDto[];
}

export interface OverviewDto {
  station_id: string | null;
  from: string;
  to: string;
  wqi: WqiDto | null;
  wqi_outlet: WqiDto | null;
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
}

export interface PhStatDto {
  avg: number;
  min: number;
  max: number;
  count: number;
}
export interface PhSeriesDto {
  station_id: string | null;
  bucket: BucketDto;
  points: { bucket: string; inlet: PhStatDto | null; outlet: PhStatDto | null }[];
  inlet_avg: number | null;
  outlet_avg: number | null;
  avg_shift_toward_neutral: number | null;
}

export interface SensorHealthDto {
  sensor_id: string;
  station_id: string;
  station_name: string;
  type: SensorTypeDto;
  location: SensorLocationDto;
  unit: string;
  status: SensorStatusDto;
  last_seen_at: string | null;
  last_value: number | null;
  last_reading_at: string | null;
  readings_count: number;
  avg_quality: number | null;
  uptime_pct: number;
}

export interface CentrifugeAnalyticsDto {
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
  series: { bucket: string; cycles: number; failed: number; rpm_avg: number | null; vibration_avg_mm_s: number | null; power_avg_w: number | null }[];
}

export interface WaterRecoveryDto {
  total: { batches: number; water_in_l: number; water_clean_l: number; water_lost_l: number; sludge_kg: number; efficiency_pct: number | null };
  series: { bucket: string; batches: number; water_in_l: number; water_clean_l: number; water_lost_l: number; sludge_kg: number; efficiency_pct: number | null }[];
}

export interface WasteAnalyticsDto {
  total_kg: number;
  total_items: number;
  by_type: { waste_type: WasteTypeDto; weight_kg: number; items: number; collections: number }[];
  series: { bucket: string; waste_type: WasteTypeDto; weight_kg: number; items: number }[];
}

export interface PhForecastDto {
  station_id: string;
  location: SensorLocationDto;
  method: string;
  lookback_hours: number;
  horizon_hours: number;
  samples: number;
  slope_per_hour: number | null;
  residual_std: number | null;
  history: { ts: string; value: number }[];
  points: { ts: string; value: number; lower: number; upper: number }[];
  note: string | null;
}

export interface HotspotDto {
  station_id: string;
  name: string;
  river: string;
  latitude: number;
  longitude: number;
  status: string;
  wqi: WqiDto | null;
  alerts_open: number;
  alerts_critical_open: number;
  last_reading_at: string | null;
}

export interface AlertDto {
  id: string;
  rule_id: string;
  station_id: string | null;
  sensor_id: string | null;
  subject_key: string;
  kind: RuleKindDto;
  parameter: string | null;
  severity: SeverityDto;
  status: AlertStatusDto;
  message: string;
  trigger_value: number | null;
  threshold_min: number | null;
  threshold_max: number | null;
  first_triggered_at: string;
  last_triggered_at: string;
  occurrences: number;
  acknowledged_at: string | null;
  resolved_at: string | null;
  note: string | null;
}

export interface AlertRuleDto {
  id: string;
  name: string;
  kind: RuleKindDto;
  severity: SeverityDto;
  parameter: SensorTypeDto | null;
  location: SensorLocationDto | null;
  station_id: string | null;
  min_value: number | null;
  max_value: number | null;
  enabled: boolean;
  description: string | null;
}

export interface CycleDto {
  id: string;
  station_id: string;
  status: CycleStatusDto;
  started_at: string;
  ended_at: string | null;
  rpm_avg: number | null;
  rpm_max: number | null;
  vibration_mm_s: number | null;
}

export interface ReadingsIngestResultDto {
  received: number;
  accepted: number;
  duplicates: number;
  rejected: { index: number; sensor_id: string; ts: string; reason: string; detail: string }[];
  alerts_triggered: number;
}

/** WebSocket envelope: `{ type, station_id, ts, data }`. */
export interface WsEnvelopeDto {
  type: string;
  station_id: string | null;
  ts: string;
  data: Record<string, unknown>;
}
