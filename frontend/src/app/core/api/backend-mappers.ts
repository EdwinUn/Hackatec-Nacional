/**
 * Anti-corruption layer: translates the real backend contract (`backend.types.ts`, /API.md)
 * into the UI models of `rio.models.ts`. Pure functions → easy to unit-test; screens and the
 * mock backend keep working against the UI models unchanged.
 */
import {
  Alert,
  AlertRule,
  CentrifugeAnalytics,
  CentrifugeState,
  DashboardOverview,
  Hotspot,
  LiveEvent,
  PhAnalytics,
  PhForecast,
  SensorHealth,
  Station,
  WasteAnalytics,
  WaterRecovery,
  WqiScore,
} from '../models/rio.models';
import {
  BeAlert,
  BeAlertRule,
  BeCentrifuge,
  BeCycle,
  BeCycleStatus,
  BeEnvelope,
  BeForecast,
  BeHotspot,
  BeOverview,
  BePhSeries,
  BeSensorHealth,
  BeStation,
  BeWaste,
  BeWaterRecovery,
  BeWqi,
} from './backend.types';
import { improvementPct } from '../../shared/utils/wqi.util';

export { improvementPct };

export const PARAMETER_LABEL: Record<string, string> = {
  ph: 'pH',
  turbidity: 'turbidez',
  temperature: 'temperatura',
  dissolved_oxygen: 'oxígeno disuelto',
  conductivity: 'conductividad',
  tds: 'sólidos disueltos',
  signal: 'minutos sin señal',
  vibration: 'vibración',
  efficiency: 'eficiencia',
};
const POSITION_LABEL: Record<string, string> = { inlet: 'entrada', outlet: 'salida', river: 'río' };
const RULE_KIND_PARAMETER: Record<string, string> = {
  sensor_offline: 'signal',
  centrifuge_vibration: 'vibration',
  treatment_efficiency: 'efficiency',
};
const UNIT: Record<string, string> = {
  ph: 'pH',
  turbidity: 'NTU',
  temperature: '°C',
  dissolved_oxygen: 'mg/L',
  conductivity: 'µS/cm',
  tds: 'mg/L',
  signal: 'min',
  vibration: 'mm/s',
  efficiency: '%',
};

/** Without readings there is no index; shown as 0 / «sin datos» rather than inventing one. */
export function mapWqi(w: BeWqi | null): WqiScore {
  if (!w) return { score: 0, category: 'critica', dominant_parameter: 'sin datos' };
  const dom = w.dominant_parameter;
  return { score: w.score, category: w.category, dominant_parameter: dom ? (PARAMETER_LABEL[dom] ?? dom) : '—' };
}

export function stationCode(s: Pick<BeStation, 'river'>): string {
  return s.river.replace(/^(Río|Rio|Presa de|Presa)\s+/i, '').slice(0, 3).toUpperCase();
}

export function mapStation(s: BeStation): Station {
  return {
    id: s.id,
    name: s.name,
    code: stationCode(s),
    municipality: '',
    river: s.river,
    latitude: s.latitude,
    longitude: s.longitude,
  };
}

const nums = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);

export function mapOverview(o: BeOverview): DashboardOverview {
  const inlet = o.ph_inlet?.value ?? 0;
  const outlet = o.ph_outlet?.value ?? 0;
  return {
    from: o.from,
    to: o.to,
    wqi: { river: mapWqi(o.wqi), outlet: mapWqi(o.wqi_outlet), trend: nums(o.trend.map((p) => p.wqi)) },
    ph: {
      inlet,
      outlet,
      improvement_pct: improvementPct(o.ph_inlet?.value, o.ph_outlet?.value),
      trend: nums(o.trend.map((p) => p.ph_inlet)),
    },
    sensors: { online: o.sensors_online, total: o.sensors_total },
    treatment_efficiency_pct: o.efficiency_pct ?? 0,
    recovery: { clean_liters: o.water_clean_l, waste_kg: o.waste_kg, trend: o.trend.map((p) => p.water_clean_l) },
    alerts: { open: o.alerts_open, critical: o.alerts_critical_open },
  };
}

export function mapPh(p: BePhSeries, bucket: PhAnalytics['bucket']): PhAnalytics {
  return {
    bucket,
    avg_improvement_pct: improvementPct(p.inlet_avg, p.outlet_avg),
    // The chart needs both sides per bucket; buckets with only one side are skipped.
    series: p.points
      .filter((x) => x.inlet && x.outlet)
      .map((x) => ({
        ts: x.bucket,
        inlet: { avg: x.inlet!.avg, min: x.inlet!.min, max: x.inlet!.max },
        outlet: { avg: x.outlet!.avg, min: x.outlet!.min, max: x.outlet!.max },
      })),
  };
}

export function mapWater(w: BeWaterRecovery, bucket: WaterRecovery['bucket']): WaterRecovery {
  return {
    bucket,
    totals: {
      liters_in: w.total.water_in_l,
      liters_clean: w.total.water_clean_l,
      liters_lost: w.total.water_lost_l,
      sludge_kg: w.total.sludge_kg,
      efficiency_pct: w.total.efficiency_pct ?? 0,
    },
    series: w.series.map((p) => ({ ts: p.bucket, liters_in: p.water_in_l, liters_clean: p.water_clean_l })),
  };
}

export function mapWaste(w: BeWaste, bucket: WasteAnalytics['bucket']): WasteAnalytics {
  return {
    bucket,
    total_kg: w.total_kg,
    by_type: w.by_type.map((t) => ({ type: t.waste_type, kg: t.weight_kg, pieces: t.items })),
  };
}

export function cycleState(status: BeCycleStatus): CentrifugeState {
  return status === 'running' ? 'running' : status === 'failed' ? 'fault' : 'idle';
}

/** `current` = the latest cycle: running → live values; failed → «Falla»; otherwise idle. */
export function mapCentrifuge(c: BeCentrifuge, latest: BeCycle | undefined, bucket: CentrifugeAnalytics['bucket']): CentrifugeAnalytics {
  const s = c.summary;
  const running = latest?.status === 'running';
  return {
    bucket,
    cycles_total: s.cycles,
    failures: s.failed,
    avg_rpm: s.rpm_avg ?? 0,
    avg_vibration_mm_s: s.vibration_avg_mm_s ?? 0,
    energy_kwh: s.energy_kwh ?? 0,
    current: {
      state: latest ? cycleState(latest.status) : 'idle',
      rpm: running ? (latest?.rpm_avg ?? 0) : 0,
      vibration_mm_s: latest && (running || latest.status === 'failed') ? (latest.vibration_mm_s ?? 0) : 0,
      updated_at: latest?.updated_at ?? new Date().toISOString(),
    },
  };
}

export function sensorName(type: string, location: string): string {
  const label = PARAMETER_LABEL[type] ?? type;
  const name = label === 'pH' ? label : label.charAt(0).toUpperCase() + label.slice(1);
  return `${name} · ${POSITION_LABEL[location] ?? location}`;
}

export function mapSensorHealth(s: BeSensorHealth): SensorHealth {
  return {
    sensor_id: s.sensor_id,
    name: sensorName(s.type, s.location),
    station_id: s.station_id,
    position: s.location,
    parameter: s.type,
    status: s.status,
    last_reading:
      s.last_value !== null && s.last_reading_at ? { value: s.last_value, unit: s.unit, ts: s.last_reading_at } : null,
    signal_quality_pct: Math.round((s.avg_quality ?? 0) * 100),
    uptime_pct: s.uptime_pct,
  };
}

export function mapHotspot(h: BeHotspot): Hotspot {
  return {
    station_id: h.station_id,
    name: h.name,
    latitude: h.latitude,
    longitude: h.longitude,
    wqi: mapWqi(h.wqi),
    open_alerts: h.alerts_open,
    critical_alerts: h.alerts_critical_open,
  };
}

export function mapAlert(a: BeAlert, stationName: (id: string) => string): Alert {
  return {
    id: a.id,
    station_id: a.station_id,
    station_name: stationName(a.station_id),
    severity: a.severity,
    status: a.status,
    message: a.message,
    parameter: a.parameter,
    value: a.trigger_value,
    created_at: a.first_triggered_at,
    acknowledged_at: a.acknowledged_at,
    resolved_at: a.resolved_at,
    note: a.note,
  };
}

/** Backend rules are ranges (`min_value`/`max_value`): `condition` keeps the full text. */
export function mapAlertRule(r: BeAlertRule): AlertRule {
  const parameter = r.parameter ?? RULE_KIND_PARAMETER[r.kind] ?? r.kind;
  const unit = UNIT[parameter] ?? '';
  const { min_value: min, max_value: max } = r;
  const where = r.location ? ` (${POSITION_LABEL[r.location]})` : '';
  let condition: string;
  if (min !== null && max !== null) condition = `fuera de ${min}–${max} ${unit}`;
  else if (min !== null) condition = `< ${min} ${unit}`;
  else condition = `> ${max} ${unit}`;
  return {
    id: r.id,
    name: r.name,
    parameter: (PARAMETER_LABEL[parameter] ?? parameter) + where,
    operator: min !== null ? '<' : '>',
    threshold: (min ?? max) as number,
    unit,
    severity: r.severity,
    enabled: r.enabled,
    description: r.description,
    condition: condition.trim(),
  };
}

export function mapForecast(f: BeForecast): PhForecast {
  return { station_id: f.station_id, horizon_hours: f.horizon_hours, history: f.history, forecast: f.points };
}

/** Translates a backend WebSocket frame into a UI `LiveEvent` (null = ignore). */
export function mapLiveEvent(env: BeEnvelope, stationName: (id: string) => string): LiveEvent | null {
  const d = env.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const station_id = (d['station_id'] as string | undefined) ?? env.station_id ?? '';
  switch (env.type) {
    case 'reading':
      return {
        type: 'reading',
        data: { station_id, position: d['location'], parameter: d['type'], value: d['value'], unit: d['unit'], timestamp: d['ts'] },
      };
    case 'sensor_status':
      return { type: 'sensor_status', data: { station_id, sensor_id: d['sensor_id'], status: d['status'] } };
    case 'cycle_update': {
      const running = d['status'] === 'running';
      return {
        type: 'cycle_update',
        data: {
          station_id,
          state: cycleState(d['status']),
          rpm: running ? (d['rpm_avg'] ?? 0) : 0,
          vibration_mm_s: d['vibration_mm_s'] ?? 0,
        },
      };
    }
    case 'batch_completed':
      return {
        type: 'batch_completed',
        data: { station_id, liters_in: d['volume_in_l'], liters_clean: d['volume_clean_l'], sludge_kg: d['sludge_kg'] ?? 0 },
      };
    case 'waste_collected':
      return {
        type: 'waste_collected',
        data: { station_id, waste_type: d['waste_type'], kg: d['weight_kg'], pieces: d['items_count'] ?? 0 },
      };
    case 'alert':
      return { type: 'alert', data: mapAlert(d as BeAlert, stationName) };
    case 'hello':
    case 'ping':
      return { type: env.type };
    default:
      return null; // pong / subscribed / error
  }
}
