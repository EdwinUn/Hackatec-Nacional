import {
  AlertDto,
  AlertRuleDto,
  CentrifugeAnalyticsDto,
  CriticalPointDto,
  CycleDto,
  HotspotDto,
  OverviewDto,
  PhForecastDto,
  PhSeriesDto,
  SensorHealthDto,
  StationDto,
  WasteAnalyticsDto,
  WaterRecoveryDto,
  WqiDto,
  WsEnvelopeDto,
} from '../models/api.models';
import {
  Alert,
  AlertRule,
  Bucket,
  CriticalPoint,
  CentrifugeAnalytics,
  CentrifugeState,
  DashboardOverview,
  Hotspot,
  LiveEvent,
  PhAnalytics,
  PhForecast,
  SensorHealth,
  SensorPosition,
  Station,
  WasteAnalytics,
  WasteType,
  WaterRecovery,
  WqiScore,
} from '../models/rio.models';
import { locationLabel, typeLabel } from './labels';

/** Wire (`API.md`) → view-model mappers. Pure functions, unit-tested. */

const NO_WQI: WqiScore = { score: 0, category: 'sin_datos', dominant_parameter: null };

export function mapStation(d: StationDto): Station {
  return { id: d.id, name: d.name, river: d.river, latitude: d.latitude, longitude: d.longitude, status: d.status };
}

export function mapWqi(d: WqiDto | null | undefined): WqiScore {
  if (!d) return NO_WQI;
  const worst = d.components.length ? d.components.reduce((a, b) => (b.sub_index < a.sub_index ? b : a)) : null;
  return { score: d.score, category: d.category, dominant_parameter: worst?.parameter ?? null };
}

export function mapOverview(d: OverviewDto): DashboardOverview {
  const inlet = d.ph_inlet?.value ?? null;
  const outlet = d.ph_outlet?.value ?? null;
  return {
    from: d.from,
    to: d.to,
    wqi: { river: mapWqi(d.wqi), outlet: mapWqi(d.wqi_outlet) },
    ph: { inlet, outlet, improvement_pct: inlet && outlet !== null ? ((outlet - inlet) / inlet) * 100 : null },
    sensors: { online: d.sensors_online, total: d.sensors_total },
    treatment_efficiency_pct: d.efficiency_pct ?? 0,
    recovery: { clean_liters: d.water_clean_l, waste_kg: d.waste_kg },
    alerts: { open: d.alerts_open, critical: d.alerts_critical_open },
  };
}

export function mapPh(d: PhSeriesDto, bucket: Bucket): PhAnalytics {
  const series = d.points
    .filter((p) => p.inlet && p.outlet)
    .map((p) => ({
      ts: p.bucket,
      inlet: { avg: p.inlet!.avg, min: p.inlet!.min, max: p.inlet!.max },
      outlet: { avg: p.outlet!.avg, min: p.outlet!.min, max: p.outlet!.max },
    }));
  const pct = d.inlet_avg && d.outlet_avg !== null ? ((d.outlet_avg - d.inlet_avg) / d.inlet_avg) * 100 : 0;
  return { bucket, avg_improvement_pct: pct, series };
}

export function mapWater(d: WaterRecoveryDto, bucket: Bucket): WaterRecovery {
  return {
    bucket,
    totals: {
      liters_in: d.total.water_in_l,
      liters_clean: d.total.water_clean_l,
      liters_lost: d.total.water_lost_l,
      sludge_kg: d.total.sludge_kg,
      efficiency_pct: d.total.efficiency_pct ?? 0,
    },
    series: d.series.map((p) => ({ ts: p.bucket, liters_in: p.water_in_l, liters_clean: p.water_clean_l })),
  };
}

export function mapWaste(d: WasteAnalyticsDto, bucket: Bucket): WasteAnalytics {
  return { bucket, total_kg: d.total_kg, by_type: d.by_type.map((t) => ({ type: t.waste_type, kg: t.weight_kg, pieces: t.items })) };
}

export function mapCentrifuge(d: CentrifugeAnalyticsDto, bucket: Bucket, now = new Date()): CentrifugeAnalytics {
  const s = d.summary;
  return {
    bucket,
    cycles_total: s.cycles,
    failures: s.failed,
    avg_rpm: s.rpm_avg ?? 0,
    avg_vibration_mm_s: s.vibration_avg_mm_s ?? 0,
    energy_kwh: s.energy_kwh ?? 0,
    // The API has no "live state" field: derive it; `cycle_update` events refine it.
    current: { state: s.running > 0 ? 'running' : 'idle', rpm: s.rpm_avg ?? 0, vibration_mm_s: s.vibration_avg_mm_s ?? 0, updated_at: now.toISOString() },
  };
}

function shortStation(name: string): string {
  return name.split(/\s[—-]\s/)[0];
}

export function mapSensorHealth(d: SensorHealthDto): SensorHealth {
  return {
    sensor_id: d.sensor_id,
    name: `${typeLabel(d.type)} ${locationLabel(d.location)} · ${shortStation(d.station_name)}`,
    station_id: d.station_id,
    position: d.location,
    parameter: d.type,
    status: d.status,
    last_reading: d.last_value !== null && d.last_reading_at ? { value: d.last_value, unit: d.unit, ts: d.last_reading_at } : null,
    signal_quality_pct: (d.avg_quality ?? 0) * 100,
    uptime_pct: d.uptime_pct,
  };
}

export function mapHotspot(d: HotspotDto): Hotspot {
  return { station_id: d.station_id, name: d.name, latitude: d.latitude, longitude: d.longitude, wqi: mapWqi(d.wqi), open_alerts: d.alerts_open, critical_alerts: d.alerts_critical_open };
}

export function mapAlert(d: AlertDto, stationName: (id: string | null) => string): Alert {
  return {
    id: d.id,
    station_id: d.station_id ?? '',
    station_name: stationName(d.station_id),
    severity: d.severity,
    status: d.status,
    message: d.message,
    parameter: d.parameter,
    value: d.trigger_value,
    created_at: d.last_triggered_at,
    occurrences: d.occurrences,
    acknowledged_at: d.acknowledged_at,
    resolved_at: d.resolved_at,
    note: d.note,
  };
}

export function mapRule(d: AlertRuleDto): AlertRule {
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    severity: d.severity,
    parameter: d.parameter,
    location: d.location,
    min_value: d.min_value,
    max_value: d.max_value,
    enabled: d.enabled,
    description: d.description,
  };
}

export function mapForecast(d: PhForecastDto): PhForecast {
  return { station_id: d.station_id, horizon_hours: d.horizon_hours, history: d.history, forecast: d.points, note: d.note };
}

function cycleState(c: Pick<CycleDto, 'status'>): CentrifugeState {
  return c.status === 'running' ? 'running' : c.status === 'failed' ? 'fault' : 'idle';
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * WebSocket envelope `{ type, station_id, ts, data }` → view event. Returns `null` for control
 * frames (`hello`, `ping`, `pong`, `subscribed`, `error`) and anything unrecognised.
 */
export function mapEnvelope(m: WsEnvelopeDto, stationName: (id: string | null) => string): LiveEvent | null {
  const d = m.data ?? {};
  const station_id = (typeof d['station_id'] === 'string' ? (d['station_id'] as string) : m.station_id) ?? '';
  switch (m.type) {
    case 'reading':
      return {
        type: 'reading',
        data: {
          station_id,
          sensor_id: String(d['sensor_id'] ?? ''),
          position: d['location'] as SensorPosition,
          parameter: String(d['type'] ?? ''),
          value: num(d['value']),
          unit: String(d['unit'] ?? ''),
          timestamp: String(d['ts'] ?? m.ts),
        },
      };
    case 'sensor_status':
      return { type: 'sensor_status', data: { station_id, sensor_id: String(d['sensor_id'] ?? ''), status: d['status'] as SensorHealth['status'] } };
    case 'cycle_update':
      return { type: 'cycle_update', data: { station_id, state: cycleState({ status: d['status'] as CycleDto['status'] }), rpm: num(d['rpm_avg'], num(d['rpm_max'])), vibration_mm_s: num(d['vibration_mm_s']) } };
    case 'batch_completed':
      return { type: 'batch_completed', data: { station_id, liters_in: num(d['volume_in_l']), liters_clean: num(d['volume_clean_l']), sludge_kg: num(d['sludge_kg']) } };
    case 'waste_collected':
      return { type: 'waste_collected', data: { station_id, waste_type: d['waste_type'] as WasteType, kg: num(d['weight_kg']), pieces: num(d['items_count']) } };
    case 'alert':
      return { type: 'alert', data: mapAlert(d as unknown as AlertDto, stationName) };
    default:
      return null;
  }
}

export function mapCriticalPoint(p: CriticalPointDto): CriticalPoint {
  return { rank: p.rank, station_id: p.station_id, name: p.name, score: p.score, level: p.level, components: p.components, reasons: p.reasons };
}
