import {
  improvementPct,
  mapAlert,
  mapAlertRule,
  mapCriticalPoint,
  mapCentrifuge,
  mapForecast,
  mapHotspot,
  mapLiveEvent,
  mapOverview,
  mapPh,
  mapSensorHealth,
  mapStation,
  mapWaste,
  mapWater,
} from './backend-mappers';
import { BACKEND_FIXTURES } from './backend.fixtures';
import * as Be from './backend.types';

// Fixtures are real backend responses; cast once to the declared contract.
const fx = BACKEND_FIXTURES as unknown as {
  stations: Be.BePage<Be.BeStation>;
  overview: Be.BeOverview;
  ph: Be.BePhSeries;
  water: Be.BeWaterRecovery;
  waste: Be.BeWaste;
  centrifuge: Be.BeCentrifuge;
  cycles: Be.BePage<Be.BeCycle>;
  sensorsHealth: Be.BeSensorHealth[];
  hotspots: Be.BeHotspot[];
  alerts: Be.BePage<Be.BeAlert>;
  rules: Be.BeAlertRule[];
  forecast: Be.BeForecast;
};
const names = (id: string) => (id === fx.alerts.items[0]?.station_id ? 'Estación X' : id);
const finite = (n: number) => Number.isFinite(n);

describe('backend mappers (respuestas reales)', () => {
  it('stations: page → list with code', () => {
    const s = fx.stations.items.map(mapStation);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].code).toMatch(/^[A-ZÁÉÍÓÚ]{3}$/);
    expect(finite(s[0].latitude)).toBe(true);
  });

  it('overview: KPIs, WQI with critical parameter and sparklines', () => {
    const o = mapOverview(fx.overview);
    expect(o.wqi.river.score).toBe(fx.overview.wqi!.score);
    expect(o.wqi.river.dominant_parameter).not.toBe('sin datos');
    expect(o.ph.inlet).toBe(fx.overview.ph_inlet!.value);
    expect(o.sensors.total).toBe(fx.overview.sensors_total);
    expect(o.alerts.critical).toBe(fx.overview.alerts_critical_open);
    expect(o.wqi.trend.length).toBeGreaterThan(0);
    expect(o.recovery.trend.every(finite)).toBe(true);
    expect(finite(o.ph.improvement_pct)).toBe(true);
  });

  it('overview without data does not invent a WQI', () => {
    const o = mapOverview({ ...fx.overview, wqi: null, ph_inlet: null, trend: [] });
    expect(o.wqi.river).toEqual({ score: 0, category: 'critica', dominant_parameter: 'sin datos' });
    expect(o.ph.improvement_pct).toBe(0);
  });

  it('ph: points → series with both sides', () => {
    const p = mapPh(fx.ph, '1h');
    expect(p.series.length).toBeGreaterThan(0);
    expect(p.series[0].inlet.avg).toBe(fx.ph.points[0].inlet!.avg);
    expect(p.series[0].ts).toBe(fx.ph.points[0].bucket);
  });

  it('ph: buckets missing a side are skipped', () => {
    const p = mapPh({ ...fx.ph, points: [{ bucket: '2026-01-01T00:00:00Z', inlet: null, outlet: fx.ph.points[0].outlet }] }, '5m');
    expect(p.series).toEqual([]);
  });

  it('water recovery, waste and forecast', () => {
    const w = mapWater(fx.water, '1h');
    expect(w.totals.liters_in).toBe(fx.water.total.water_in_l);
    expect(w.series[0].liters_clean).toBe(fx.water.series[0].water_clean_l);
    const ws = mapWaste(fx.waste, '1h');
    expect(ws.total_kg).toBe(fx.waste.total_kg);
    expect(ws.by_type[0]).toEqual({ type: fx.waste.by_type[0].waste_type, kg: fx.waste.by_type[0].weight_kg, pieces: fx.waste.by_type[0].items });
    const f = mapForecast(fx.forecast);
    expect(f.forecast.length).toBe(fx.forecast.points.length);
  });

  it('centrifuge: summary + current state from the latest cycle', () => {
    const c = mapCentrifuge(fx.centrifuge, fx.cycles.items[0], '1h');
    expect(c.cycles_total).toBe(fx.centrifuge.summary.cycles);
    expect(['running', 'idle', 'fault']).toContain(c.current.state);
    const running = mapCentrifuge(fx.centrifuge, { ...fx.cycles.items[0], status: 'running', rpm_avg: 2800 }, '1h');
    expect(running.current).toMatchObject({ state: 'running', rpm: 2800 });
    expect(mapCentrifuge(fx.centrifuge, undefined, '1h').current.state).toBe('idle');
  });

  it('sensor health: readable name, last reading and signal %', () => {
    const s = mapSensorHealth(fx.sensorsHealth[0]);
    expect(s.name).toContain('·');
    expect(s.position).toBe(fx.sensorsHealth[0].location);
    expect(s.signal_quality_pct).toBeGreaterThanOrEqual(0);
    expect(s.signal_quality_pct).toBeLessThanOrEqual(100);
    expect(s.last_reading?.value).toBe(fx.sensorsHealth[0].last_value);
  });

  it('hotspots and alerts', () => {
    const h = mapHotspot(fx.hotspots[0]);
    expect(h.open_alerts).toBe(fx.hotspots[0].alerts_open);
    const a = mapAlert(fx.alerts.items[0], names);
    expect(a.station_name).toBe('Estación X');
    expect(a.value).toBe(fx.alerts.items[0].trigger_value);
    expect(a.created_at).toBe(fx.alerts.items[0].first_triggered_at);
  });

  it('alert rules keep the full range as text', () => {
    const range = mapAlertRule(fx.rules.find((r) => r.min_value !== null && r.max_value !== null)!);
    expect(range.condition).toMatch(/^fuera de .+–.+/);
    const vib = mapAlertRule(fx.rules.find((r) => r.kind === 'centrifuge_vibration')!);
    expect(vib.condition).toMatch(/^> .+ mm\/s$/);
  });
});

describe('mapCriticalPoint', () => {
  it('keeps rank, score, level, components and reasons for the UI', () => {
    // Real response shape of GET /analytics/critical-points (demo data).
    const sample: Be.BeCriticalPoint = {
      rank: 1, station_id: 's', name: 'Río Atoyac — Parque Lineal', river: 'Río Atoyac', latitude: 19, longitude: -98,
      score: 65, level: 'critico', components: { calidad: 36.1, alertas: 90, recurrencia: 100 }, wqi: 63.9,
      dominant_parameter: 'turbidity', alerts_active: { critical: 2, warning: 5, info: 0 }, occurrences: 448,
      top_issues: [{ rule: 'pH fuera del rango aceptable', severity: 'warning', parameter: 'ph', occurrences: 204 }],
      reasons: ['2 alertas críticas activas'],
    };
    const p = mapCriticalPoint(sample);
    expect(p).toEqual({
      rank: sample.rank, station_id: sample.station_id, name: sample.name, score: sample.score,
      level: sample.level, components: sample.components, reasons: sample.reasons,
    });
    expect(['critico', 'atencion', 'estable']).toContain(p.level);
  });
});

describe('improvementPct (acercamiento a pH 7)', () => {
  it('positive when the outlet is closer to neutral, negative when farther', () => {
    expect(improvementPct(7.56, 7.22)).toBeCloseTo(60.7, 1);
    expect(improvementPct(5.0, 6.8)).toBeCloseTo(90, 5);
    expect(improvementPct(7.2, 8.0)).toBeLessThan(0);
    expect(improvementPct(7.0, 7.3)).toBe(0);
  });
});

describe('mapLiveEvent', () => {
  const env = (type: string, data: Record<string, unknown>, station_id = 'st-1'): Be.BeEnvelope => ({ type, station_id, ts: '2026-11-24T00:00:00Z', data });

  it('reading → UI field names', () => {
    const e = mapLiveEvent(env('reading', { station_id: 'st-1', sensor_id: 's', ts: 'T', value: 5.2, quality: 1, type: 'ph', location: 'inlet', unit: 'pH' }), names);
    expect(e).toEqual({ type: 'reading', data: { station_id: 'st-1', position: 'inlet', parameter: 'ph', value: 5.2, unit: 'pH', timestamp: 'T' } });
  });

  it('sensor_status takes station_id from the envelope', () => {
    const e = mapLiveEvent(env('sensor_status', { sensor_id: 's', status: 'degraded' }), names);
    expect(e).toEqual({ type: 'sensor_status', data: { station_id: 'st-1', sensor_id: 's', status: 'degraded' } });
  });

  it('cycle, batch, waste and alert', () => {
    expect(mapLiveEvent(env('cycle_update', { station_id: 'st-1', status: 'running', rpm_avg: 2850, vibration_mm_s: 2.1 }), names)).toEqual({
      type: 'cycle_update',
      data: { station_id: 'st-1', state: 'running', rpm: 2850, vibration_mm_s: 2.1 },
    });
    expect(mapLiveEvent(env('cycle_update', { station_id: 'st-1', status: 'failed', rpm_avg: 2850, vibration_mm_s: 8.9 }), names)?.data).toMatchObject({ state: 'fault', rpm: 0 });
    expect(mapLiveEvent(env('batch_completed', { station_id: 'st-1', volume_in_l: 500, volume_clean_l: 450, sludge_kg: 3 }), names)?.data).toEqual({
      station_id: 'st-1', liters_in: 500, liters_clean: 450, sludge_kg: 3,
    });
    expect(mapLiveEvent(env('waste_collected', { station_id: 'st-1', waste_type: 'plastic', weight_kg: 1.2, items_count: 9 }), names)?.data).toEqual({
      station_id: 'st-1', waste_type: 'plastic', kg: 1.2, pieces: 9,
    });
    const alert = mapLiveEvent(env('alert', fx.alerts.items[0] as unknown as Record<string, unknown>), names);
    expect(alert?.type).toBe('alert');
    expect((alert?.data as { station_name: string }).station_name).toBe('Estación X');
  });

  it('control frames are ignored', () => {
    expect(mapLiveEvent(env('pong', {}), names)).toBeNull();
    expect(mapLiveEvent(env('subscribed', {}), names)).toBeNull();
    expect(mapLiveEvent(env('ping', {}), names)).toEqual({ type: 'ping' });
  });
});
