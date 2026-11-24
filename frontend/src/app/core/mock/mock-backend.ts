import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { wqiCategory } from '../../shared/utils/wqi.util';
import {
  Alert,
  AlertRule,
  CentrifugeState,
  LiveEvent,
  SensorHealth,
  SensorPosition,
  SensorStatus,
  Station,
  WasteType,
  WqiScore,
} from '../models/rio.models';

export const MOCK_STATIONS: Station[] = [
  { id: '5b1e0d7a-0c31-4c3e-9a51-1a2b3c4d5e01', name: 'Estación Atoyac Poniente', code: 'ATY-01', municipality: 'Puebla', river: 'Río Atoyac', latitude: 19.059, longitude: -98.253 },
  { id: '5b1e0d7a-0c31-4c3e-9a51-1a2b3c4d5e02', name: 'Estación Alseseca Oriente', code: 'ALS-02', municipality: 'Puebla', river: 'Río Alseseca', latitude: 19.033, longitude: -98.165 },
  { id: '5b1e0d7a-0c31-4c3e-9a51-1a2b3c4d5e03', name: 'Estación Valsequillo', code: 'VAL-03', municipality: 'Puebla', river: 'Presa Manuel Ávila Camacho', latitude: 18.956, longitude: -98.156 },
];

const POSITIONS: SensorPosition[] = ['inlet', 'outlet', 'river'];
const BASE_PH: Record<SensorPosition, number> = { inlet: 6.1, outlet: 7.4, river: 6.9 };

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Extras {
  liters_in: number;
  liters_clean: number;
  sludge_kg: number;
  cycles: number;
  failures: number;
  waste: Record<WasteType, { kg: number; pieces: number }>;
}

/**
 * In-memory stand-in for the Río Monitor backend: holds state (alerts, sensors, counters) and
 * emits the same live events the real WebSocket would. Used when `useMocks` / `?mock=1`.
 */
@Injectable({ providedIn: 'root' })
export class MockBackend {
  readonly stations = MOCK_STATIONS;
  readonly events$ = new Subject<LiveEvent>();

  readonly currentPh = new Map<string, Record<SensorPosition, number>>(
    MOCK_STATIONS.map((s) => [s.id, { ...BASE_PH }]),
  );
  readonly sensors: SensorHealth[] = MOCK_STATIONS.flatMap((s, si) =>
    POSITIONS.map((p, pi) => ({
      sensor_id: `${s.id}:${p}`,
      name: `pH ${p === 'inlet' ? 'entrada' : p === 'outlet' ? 'salida' : 'río'} · ${s.code}`,
      station_id: s.id,
      position: p,
      parameter: 'ph',
      status: (si === 1 && p === 'river' ? 'degraded' : si === 2 && p === 'inlet' ? 'fault' : 'ok') as SensorStatus,
      last_reading: { value: BASE_PH[p], unit: 'pH', ts: new Date().toISOString() },
      signal_quality_pct: 96 - si * 7 - pi * 3,
      uptime_pct: 99.4 - si * 2.1 - pi * 0.8,
    })),
  );
  readonly centrifuge = new Map<string, { state: CentrifugeState; rpm: number; vibration_mm_s: number; updated_at: string }>(
    MOCK_STATIONS.map((s) => [s.id, { state: 'running', rpm: 3180, vibration_mm_s: 2.1, updated_at: new Date().toISOString() }]),
  );
  readonly extras: Extras = {
    liters_in: 0, liters_clean: 0, sludge_kg: 0, cycles: 0, failures: 0,
    waste: { plastic: { kg: 0, pieces: 0 }, organic: { kg: 0, pieces: 0 }, metal: { kg: 0, pieces: 0 }, glass: { kg: 0, pieces: 0 }, other: { kg: 0, pieces: 0 } },
  };
  readonly rules: AlertRule[] = [
    { id: 'r1', name: 'pH ácido en la entrada', parameter: 'ph', operator: '<', threshold: 6.0, unit: 'pH', severity: 'warning', enabled: true, description: 'Posible descarga ácida aguas arriba.' },
    { id: 'r2', name: 'pH muy ácido (descarga)', parameter: 'ph', operator: '<', threshold: 5.5, unit: 'pH', severity: 'critical', enabled: true, description: 'Descarga industrial probable.' },
    { id: 'r3', name: 'pH alcalino en la salida', parameter: 'ph', operator: '>', threshold: 8.5, unit: 'pH', severity: 'warning', enabled: true, description: 'Sobredosificación de reactivos.' },
    { id: 'r4', name: 'Vibración de centrífuga', parameter: 'vibration', operator: '>=', threshold: 7.1, unit: 'mm/s', severity: 'critical', enabled: true, description: 'Riesgo mecánico del equipo.' },
    { id: 'r5', name: 'Eficiencia de tratamiento baja', parameter: 'efficiency', operator: '<', threshold: 70, unit: '%', severity: 'warning', enabled: true, description: 'Lote por debajo del objetivo.' },
    { id: 'r6', name: 'Sensor sin señal', parameter: 'signal', operator: '<', threshold: 40, unit: '%', severity: 'info', enabled: false, description: 'Calidad de señal insuficiente.' },
  ];
  readonly alertList: Alert[] = this.seedAlerts();

  private liveTimer?: ReturnType<typeof setInterval>;
  private tick = 0;
  private seq = 1;
  private readonly rng = mulberry32(Date.now() % 100000);

  stationName(id: string): string {
    return MOCK_STATIONS.find((s) => s.id === id)?.name ?? id;
  }

  wqiFor(stationId: string, kind: 'river' | 'outlet', salt = 0): WqiScore {
    const idx = Math.max(0, MOCK_STATIONS.findIndex((s) => s.id === stationId));
    const ph = this.currentPh.get(stationId)?.inlet ?? 6.1;
    const penalty = ph < 6 ? 18 : 0;
    const base = kind === 'outlet' ? 86 - idx * 3 : 56 - idx * 8;
    const score = Math.max(5, Math.min(99, Math.round(base - penalty + salt)));
    return { score, category: wqiCategory(score), dominant_parameter: kind === 'river' ? (idx === 1 ? 'turbidity' : 'ph') : 'do' };
  }

  // ── Mutations used by POST /… (simulation) ────────────────────────────────
  createAlert(partial: Pick<Alert, 'station_id' | 'severity' | 'message'> & Partial<Alert>): Alert {
    const alert: Alert = {
      id: `al-${Date.now().toString(36)}-${this.seq++}`,
      station_name: this.stationName(partial.station_id),
      status: 'open',
      parameter: null,
      value: null,
      created_at: new Date().toISOString(),
      acknowledged_at: null,
      resolved_at: null,
      note: null,
      ...partial,
    };
    this.alertList.unshift(alert);
    this.events$.next({ type: 'alert', data: alert });
    return alert;
  }

  emitReading(stationId: string, position: SensorPosition, value: number): void {
    const cur = this.currentPh.get(stationId);
    if (cur) cur[position] = value;
    const sensor = this.sensors.find((s) => s.station_id === stationId && s.position === position);
    const ts = new Date().toISOString();
    if (sensor) sensor.last_reading = { value, unit: 'pH', ts };
    this.events$.next({ type: 'reading', data: { station_id: stationId, position, parameter: 'ph', value, unit: 'pH', timestamp: ts } });
    if (position === 'inlet' && value < 6) {
      this.createAlert({
        station_id: stationId,
        severity: value < 5.5 ? 'critical' : 'warning',
        message: `pH ${value.toFixed(1)} en la entrada: posible descarga ácida (umbral < ${value < 5.5 ? '5.5' : '6.0'}).`,
        parameter: 'ph',
        value,
      });
    }
  }

  // ── Live simulation ───────────────────────────────────────────────────────
  startLive(): void {
    if (this.liveTimer) return;
    this.liveTimer = setInterval(() => this.step(), 2000);
    setTimeout(() => this.events$.next({ type: 'hello' }), 50);
  }

  stopLive(): void {
    clearInterval(this.liveTimer);
    this.liveTimer = undefined;
  }

  private step(): void {
    this.tick++;
    const r = this.rng;
    const st = MOCK_STATIONS[Math.floor(r() * MOCK_STATIONS.length)];
    // readings (every tick: inlet + outlet of a random station)
    for (const p of ['inlet', 'outlet'] as const) {
      const cur = this.currentPh.get(st.id)![p];
      const target = BASE_PH[p];
      const next = Math.max(4.5, Math.min(9.2, cur + (target - cur) * 0.25 + (r() - 0.5) * (p === 'inlet' ? 0.35 : 0.08)));
      this.emitReading(st.id, p, Math.round(next * 100) / 100);
    }
    if (this.tick % 2 === 0) {
      const s = MOCK_STATIONS[Math.floor(r() * 3)];
      const c = this.centrifuge.get(s.id)!;
      const rpm = Math.round(3100 + r() * 220);
      const vib = Math.round((1.8 + r() * 1.2) * 10) / 10;
      Object.assign(c, { state: 'running', rpm, vibration_mm_s: vib, updated_at: new Date().toISOString() });
      this.events$.next({ type: 'cycle_update', data: { station_id: s.id, state: 'running', rpm, vibration_mm_s: vib } });
    }
    if (this.tick % 4 === 0) {
      const sensor = this.sensors[Math.floor(r() * this.sensors.length)];
      const status: SensorStatus = sensor.status === 'ok' ? (r() < 0.3 ? 'degraded' : 'ok') : sensor.status === 'degraded' ? 'ok' : sensor.status;
      sensor.status = status;
      this.events$.next({ type: 'sensor_status', data: { station_id: sensor.station_id, sensor_id: sensor.sensor_id, status, signal_quality_pct: Math.round(70 + r() * 28) } });
    }
    if (this.tick % 9 === 0) this.addBatch(st.id, Math.round(900 + r() * 800), 0.86 + r() * 0.08);
    if (this.tick % 11 === 0) {
      const types: WasteType[] = ['plastic', 'organic', 'metal', 'glass', 'other'];
      this.addWaste(st.id, types[Math.floor(r() * 5)], Math.round((2 + r() * 9) * 10) / 10, 3 + Math.floor(r() * 25));
    }
    if (this.tick % 23 === 0) {
      this.createAlert({ station_id: st.id, severity: 'warning', message: `Turbidez elevada detectada en ${st.name}.`, parameter: 'turbidity', value: Math.round(70 + r() * 40) });
    }
  }

  addBatch(stationId: string, litersIn: number, ratio: number, sludge?: number): void {
    const clean = Math.round(litersIn * ratio);
    const sl = sludge ?? Math.round(litersIn * 0.012 * 10) / 10;
    this.extras.liters_in += litersIn;
    this.extras.liters_clean += clean;
    this.extras.sludge_kg += sl;
    this.events$.next({ type: 'batch_completed', data: { station_id: stationId, liters_in: litersIn, liters_clean: clean, sludge_kg: sl } });
  }

  addWaste(stationId: string, type: WasteType, kg: number, pieces: number): void {
    this.extras.waste[type].kg += kg;
    this.extras.waste[type].pieces += pieces;
    this.events$.next({ type: 'waste_collected', data: { station_id: stationId, waste_type: type, kg, pieces } });
  }

  private seedAlerts(): Alert[] {
    const mk = (i: number, stationIdx: number, severity: Alert['severity'], status: Alert['status'], message: string, ageMin: number, parameter: string | null, value: number | null): Alert => ({
      id: `al-seed-${i}`,
      station_id: MOCK_STATIONS[stationIdx].id,
      station_name: MOCK_STATIONS[stationIdx].name,
      severity, status, message, parameter, value,
      created_at: new Date(Date.now() - ageMin * 60_000).toISOString(),
      acknowledged_at: status !== 'open' ? new Date(Date.now() - (ageMin - 5) * 60_000).toISOString() : null,
      resolved_at: status === 'resolved' ? new Date(Date.now() - (ageMin - 20) * 60_000).toISOString() : null,
      note: status !== 'open' ? 'Brigada notificada.' : null,
    });
    return [
      mk(1, 0, 'critical', 'open', 'pH 5.1 en la entrada: posible descarga ácida (umbral < 5.5).', 14, 'ph', 5.1),
      mk(2, 1, 'warning', 'open', 'Turbidez elevada detectada en Estación Alseseca Oriente.', 42, 'turbidity', 96),
      mk(3, 2, 'warning', 'acknowledged', 'Sensor de pH de entrada con calidad de señal baja.', 95, 'signal', 38),
      mk(4, 0, 'info', 'open', 'Mantenimiento programado de la centrífuga en 24 h.', 130, null, null),
      mk(5, 1, 'critical', 'resolved', 'Vibración de centrífuga 7.6 mm/s por encima del límite.', 60 * 7, 'vibration', 7.6),
      mk(6, 2, 'warning', 'resolved', 'Eficiencia de tratamiento 66 % por debajo del objetivo.', 60 * 11, 'efficiency', 66),
      mk(7, 0, 'warning', 'acknowledged', 'pH alcalino 8.7 en la salida.', 60 * 16, 'ph', 8.7),
      mk(8, 1, 'info', 'resolved', 'Calibración de sensor completada.', 60 * 30, null, null),
    ];
  }
}
