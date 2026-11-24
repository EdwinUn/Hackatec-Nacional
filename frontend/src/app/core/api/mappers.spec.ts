import {
  AlertDto,
  CentrifugeAnalyticsDto,
  HotspotDto,
  OverviewDto,
  PageDto,
  PhForecastDto,
  PhSeriesDto,
  SensorHealthDto,
  StationDto,
  WasteAnalyticsDto,
  WaterRecoveryDto,
  WsEnvelopeDto,
} from '../models/api.models';
import {
  mapAlert,
  mapCentrifuge,
  mapEnvelope,
  mapForecast,
  mapHotspot,
  mapOverview,
  mapPh,
  mapSensorHealth,
  mapStation,
  mapWaste,
  mapWater,
  mapWqi,
} from './mappers';

/** Fixtures follow the examples of API.md (the real wire format). */
const names = (id: string | null) => (id === 'e68a' ? 'Río Alseseca — La Hacienda' : 'x');

describe('API.md → view-model mappers', () => {
  it('unwraps the paginated /stations response', () => {
    const page: PageDto<StationDto> = {
      items: [{ id: 'a657', name: 'Presa de Valsequillo — Oasis / Embarcadero', river: 'Presa de Valsequillo', latitude: 18.918, longitude: -98.155, status: 'active', installed_at: '2026-11-10', description: null, created_at: '', updated_at: '' }],
      total: 1, limit: 50, offset: 0,
    };
    const stations = page.items.map(mapStation);
    expect(stations[0]).toMatchObject({ id: 'a657', river: 'Presa de Valsequillo', latitude: 18.918 });
  });

  it('maps /dashboard/overview (wqi, wqi_outlet, ph_inlet…) and tolerates nulls', () => {
    const dto: OverviewDto = {
      station_id: null, from: '2026-11-23T04:13:51Z', to: '2026-11-24T04:13:51Z',
      wqi: { score: 80, category: 'buena', components: [{ parameter: 'ph', value: 7.36, sub_index: 100, weight: 0.25 }, { parameter: 'turbidity', value: 46.9, sub_index: 48.28, weight: 0.25 }] },
      wqi_outlet: { score: 95.6, category: 'excelente', components: [] },
      ph_inlet: { value: 7.349, ts: 'x' }, ph_outlet: { value: 7.152, ts: 'x' },
      sensors_online: 12, sensors_total: 12, water_in_l: 23743.7, water_clean_l: 21239.6, sludge_kg: 64.48, efficiency_pct: 89.45,
      waste_kg: 42.66, waste_items: 319, cycles_running: 0, alerts_open: 7, alerts_critical_open: 3,
    };
    const o = mapOverview(dto);
    expect(o.wqi.river).toEqual({ score: 80, category: 'buena', dominant_parameter: 'turbidity' });
    expect(o.wqi.outlet.category).toBe('excelente');
    expect(o.sensors).toEqual({ online: 12, total: 12 });
    expect(o.recovery.clean_liters).toBe(21239.6);
    expect(o.alerts).toEqual({ open: 7, critical: 3 });

    const empty = mapOverview({ ...dto, wqi: null, wqi_outlet: null, ph_inlet: null, ph_outlet: null, efficiency_pct: null });
    expect(empty.wqi.river.category).toBe('sin_datos');
    expect(empty.ph.inlet).toBeNull();
    expect(empty.ph.improvement_pct).toBeNull();
    expect(empty.treatment_efficiency_pct).toBe(0);
  });

  it('maps pH points, dropping buckets without both sides', () => {
    const dto: PhSeriesDto = {
      station_id: null, bucket: '1h',
      points: [
        { bucket: 'b1', inlet: { avg: 7.0, min: 6.9, max: 7.1, count: 4 }, outlet: { avg: 7.2, min: 7.1, max: 7.3, count: 4 } },
        { bucket: 'b2', inlet: null, outlet: { avg: 7.2, min: 7.1, max: 7.3, count: 4 } },
      ],
      inlet_avg: 7.5, outlet_avg: 7.2, avg_shift_toward_neutral: 0.08,
    };
    const ph = mapPh(dto, '1h');
    expect(ph.series.length).toBe(1);
    expect(ph.series[0]).toMatchObject({ ts: 'b1', inlet: { avg: 7.0 }, outlet: { avg: 7.2 } });
    // Closer to neutral: |7.5 − 7| = 0.5 → |7.2 − 7| = 0.2 ⇒ +60 %.
    expect(ph.avg_improvement_pct).toBeCloseTo(60, 5);
  });

  it('maps water recovery, waste, centrifuge and sensor health', () => {
    const water: WaterRecoveryDto = { total: { batches: 140, water_in_l: 73980.3, water_clean_l: 66244, water_lost_l: 7736.3, sludge_kg: 204.34, efficiency_pct: 89.54 }, series: [{ bucket: 'b', batches: 1, water_in_l: 10, water_clean_l: 9, water_lost_l: 1, sludge_kg: 0.1, efficiency_pct: 90 }] };
    expect(mapWater(water, '1h').totals).toMatchObject({ liters_in: 73980.3, liters_clean: 66244, liters_lost: 7736.3, efficiency_pct: 89.54 });

    const waste: WasteAnalyticsDto = { total_kg: 144.06, total_items: 1073, by_type: [{ waste_type: 'plastic', weight_kg: 76.18, items: 575, collections: 54 }], series: [] };
    expect(mapWaste(waste, '1h').by_type[0]).toEqual({ type: 'plastic', kg: 76.18, pieces: 575 });

    const cf: CentrifugeAnalyticsDto = { summary: { cycles: 141, completed: 140, failed: 1, running: 0, failure_rate_pct: 0.71, rpm_avg: 2828.9, rpm_max: 3194, vibration_avg_mm_s: 2.7, vibration_max_mm_s: 8.9, power_avg_w: 796, energy_kwh: 37.27, avg_duration_s: 1194 }, series: [] };
    const c = mapCentrifuge(cf, '1h');
    expect(c).toMatchObject({ cycles_total: 141, failures: 1, avg_rpm: 2828.9, energy_kwh: 37.27 });
    expect(c.current.state).toBe('idle');
    expect(mapCentrifuge({ ...cf, summary: { ...cf.summary, running: 1 } }, '1h').current.state).toBe('running');

    const sh: SensorHealthDto = { sensor_id: 'dc0a', station_id: 'e68a', station_name: 'Río Alseseca — La Hacienda / Xilotzingo', type: 'conductivity', location: 'inlet', unit: 'µS/cm', status: 'ok', last_seen_at: 't', last_value: 930.038, last_reading_at: 't', readings_count: 1451, avg_quality: 0.965, uptime_pct: 100 };
    expect(mapSensorHealth(sh)).toMatchObject({ sensor_id: 'dc0a', position: 'inlet', parameter: 'conductivity', signal_quality_pct: 96.5, name: 'Conductividad entrada · Río Alseseca' });
  });

  it('maps hotspots (wqi may be null) and forecast points', () => {
    const h: HotspotDto = { station_id: 'a657', name: 'Presa', river: 'r', latitude: 18.9, longitude: -98.1, status: 'active', wqi: null, alerts_open: 5, alerts_critical_open: 1, last_reading_at: null };
    expect(mapHotspot(h)).toMatchObject({ open_alerts: 5, critical_alerts: 1, wqi: { category: 'sin_datos' } });
    expect(mapWqi({ score: 86.4, category: 'buena', components: [] }).category).toBe('buena');

    const f: PhForecastDto = { station_id: 'e68a', location: 'inlet', method: 'm', lookback_hours: 6, horizon_hours: 6, samples: 24, slope_per_hour: 0.013, residual_std: 0.03, history: [{ ts: 't', value: 7.1 }], points: [{ ts: 't2', value: 7.36, lower: 7.3, upper: 7.42 }], note: null };
    expect(mapForecast(f)).toMatchObject({ horizon_hours: 6, forecast: [{ value: 7.36, lower: 7.3, upper: 7.42 }], note: null });
    expect(mapForecast({ ...f, points: [], note: 'Pocos datos' }).note).toBe('Pocos datos');
  });

  it('maps alerts (station name resolved from station_id)', () => {
    const a: AlertDto = { id: '7b30', rule_id: 'r', station_id: 'e68a', sensor_id: null, subject_key: 'station:e68a', kind: 'centrifuge_vibration', parameter: null, severity: 'critical', status: 'open', message: 'Vibración peligrosa en centrífuga: 8.48 mm/s (máx 7.1)', trigger_value: 8.48, threshold_min: null, threshold_max: 7.1, first_triggered_at: 't0', last_triggered_at: 't1', occurrences: 3, acknowledged_at: null, resolved_at: null, note: null };
    expect(mapAlert(a, names)).toMatchObject({ id: '7b30', station_name: 'Río Alseseca — La Hacienda', severity: 'critical', value: 8.48, created_at: 't1', occurrences: 3 });
  });

  describe('WebSocket envelope', () => {
    const env = (type: string, data: Record<string, unknown>, station: string | null = 'e68a'): WsEnvelopeDto => ({ type, station_id: station, ts: '2026-11-24T04:30:01Z', data });

    it('ignores control frames', () => {
      for (const t of ['hello', 'ping', 'pong', 'subscribed', 'error']) expect(mapEnvelope(env(t, {}), names)).toBeNull();
    });

    it('reading', () => {
      const e = mapEnvelope(env('reading', { id: '1', sensor_id: '0b7e', station_id: 'e68a', ts: '2026-11-24T04:30:00Z', value: 5.248, quality: 0.97, type: 'ph', location: 'inlet', unit: 'pH' }), names);
      expect(e).toEqual({ type: 'reading', data: { station_id: 'e68a', sensor_id: '0b7e', position: 'inlet', parameter: 'ph', value: 5.248, unit: 'pH', timestamp: '2026-11-24T04:30:00Z' } });
    });

    it('sensor_status, cycle_update, batch_completed, waste_collected', () => {
      expect(mapEnvelope(env('sensor_status', { sensor_id: 's', type: 'turbidity', location: 'outlet', status: 'degraded', previous_status: 'ok', last_seen_at: 't' }), names)).toEqual({ type: 'sensor_status', data: { station_id: 'e68a', sensor_id: 's', status: 'degraded' } });
      expect(mapEnvelope(env('cycle_update', { id: 'c', station_id: 'e68a', status: 'failed', rpm_avg: 3600, vibration_mm_s: 8.9 }), names)).toEqual({ type: 'cycle_update', data: { station_id: 'e68a', state: 'fault', rpm: 3600, vibration_mm_s: 8.9 } });
      expect(mapEnvelope(env('cycle_update', { status: 'running', rpm_max: 3000 }), names)).toMatchObject({ data: { state: 'running', rpm: 3000 } });
      expect(mapEnvelope(env('batch_completed', { volume_in_l: 520, volume_clean_l: 468, sludge_kg: 3.4, efficiency_pct: 90 }), names)).toEqual({ type: 'batch_completed', data: { station_id: 'e68a', liters_in: 520, liters_clean: 468, sludge_kg: 3.4 } });
      expect(mapEnvelope(env('waste_collected', { station_id: 'e68a', weight_kg: 1.25, items_count: 14, waste_type: 'plastic' }), names)).toEqual({ type: 'waste_collected', data: { station_id: 'e68a', waste_type: 'plastic', kg: 1.25, pieces: 14 } });
    });

    it('alert', () => {
      const e = mapEnvelope(env('alert', { id: '47d4', rule_id: 'r', station_id: 'e68a', sensor_id: '0b7e', subject_key: 'k', kind: 'reading_range', parameter: 'ph', severity: 'critical', status: 'open', message: 'pH extremo: 5.248 pH (mín 5.5, máx 9.5)', trigger_value: 5.248, threshold_min: 5.5, threshold_max: 9.5, first_triggered_at: 'a', last_triggered_at: 'b', occurrences: 3, acknowledged_at: null, resolved_at: null, note: null }), names);
      expect(e).toMatchObject({ type: 'alert', data: { id: '47d4', severity: 'critical', station_name: 'Río Alseseca — La Hacienda', value: 5.248 } });
    });
  });
});
