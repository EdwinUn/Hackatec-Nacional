import { DeviceTelemetryDto, deviceCodeFor } from '../models/telemetry.models';
import { mulberry32 } from './mock-backend';

/**
 * In-memory packets of the buoys' ESP32 for `useMocks` / `?mock=1`, with the same keys and
 * plausible values as `firmware/boya-rm01/sketch.ino` (docs/fidelidad.md § 3): pH barely changes
 * through the filter, turbidity drops 60–90 %, no outlet data without flow, TDS saturates at 1000.
 * RM-01 is downstream of the Panzacola discharge (dirtier); RM-02 is the upstream reference.
 */

/** Period of the mock packets (Wokwi usually delivers the «every 15 s» packets every 1–2 min). */
export const MOCK_TELEMETRY_STEP_MS = 120_000;

interface Profile {
  ph: number;
  turbIn: number;
  removal: number;
  tds: number;
  temp: number;
  basketPerHour: number;
  csq: number;
}

const PROFILES: Record<string, Profile> = {
  'RM-01': { ph: 6.72, turbIn: 82, removal: 0.73, tds: 690, temp: 19.6, basketPerHour: 2.2, csq: 22 },
  'RM-02': { ph: 7.18, turbIn: 26, removal: 0.78, tds: 330, temp: 17.8, basketPerHour: 0.7, csq: 17 },
};

const HOUR = 3_600_000;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Packet the buoy `code` would have sent at `at` (ms). Deterministic for a given time slot. */
export function mockTelemetry(code: string, at: number): DeviceTelemetryDto {
  const key = deviceCodeFor(code);
  const p = PROFILES[key] ?? PROFILES['RM-01'];
  const slot = Math.floor(at / MOCK_TELEMETRY_STEP_MS);
  const rnd = mulberry32(slot * 31 + key.charCodeAt(key.length - 1));
  const noise = (amp: number) => (rnd() - 0.5) * 2 * amp;
  const hours = at / HOUR;
  const wave = Math.sin(hours / 3.1) * 0.5 + Math.sin(hours / 0.9) * 0.25;

  // Pump: off 30 min every 6 h, following the firmware's 35 % / 75 % hysteresis: while it runs the
  // battery drains from ~76 % to ~36 %; once below 35 % it stops and recharges until it passes 75 %.
  const phase = hours % 6;
  const pumpOn = phase > 0.5;
  const batPctRaw = pumpOn ? 76 - ((phase - 0.5) / 5.5) * 40 : 34 + (phase / 0.5) * 41;
  const turbIn = Math.max(1, p.turbIn * (1 + wave * 0.25) + noise(p.turbIn * 0.05));
  const removal = Math.min(0.9, Math.max(0.6, p.removal + noise(0.03)));
  const turbOut = turbIn * (1 - removal);
  const ph = p.ph + wave * 0.08 + noise(0.03);
  const phOut = ph < 7 ? ph + 0.08 + noise(0.02) : ph + noise(0.02);
  const tds = Math.min(1000, p.tds * (1 + wave * 0.06) + noise(10));
  const temp = p.temp + Math.sin(((hours % 24) - 9) / 24 * 2 * Math.PI) * 1.6 + noise(0.1);
  // Same conversion as the firmware: 9.0 V = 0 %, 12.6 V = 100 % (3S2P Li-ion).
  const batV = 9 + ((batPctRaw + noise(0.5)) / 100) * (12.6 - 9);
  const batPct = Math.round(((batV - 9) / (12.6 - 9)) * 100);
  const sinceEmpty = (at % (24 * HOUR)) / HOUR; // the crew empties the basket once a day
  const basket = Math.min(100, Math.round(sinceEmpty * p.basketPerHour + noise(1.5)));
  const csq = Math.max(5, Math.min(31, Math.round(p.csq + noise(2))));
  const tilt = Math.abs(2.2 + wave * 1.2 + noise(0.4));
  const minutesToday = (at % (24 * HOUR)) / 60_000;
  const liters = pumpOn ? minutesToday * 2.5 * (5.5 / 6) : Math.floor(minutesToday / 360) * 360 * 2.5 * (5.5 / 6);

  const values: Record<string, number> = { ph: r2(ph), tds_ppm: Math.round(tds), temp_c: r1(temp), turb_in_ntu: r1(turbIn) };
  if (pumpOn) {
    values['ph_out'] = r2(phOut);
    values['turb_out_ntu'] = r1(turbOut);
  }
  const alarm = ph < 6.5 || ph > 8.5 || turbIn > 100 || (pumpOn && (turbOut > 5 || phOut < 6.5 || phOut > 8.5)) || temp < 10 || temp > 30 || tilt > 30;

  return {
    code: key,
    station_id: '',
    ts: new Date(slot * MOCK_TELEMETRY_STEP_MS).toISOString(),
    seq: slot % 100_000,
    battery_v: r2(batV),
    battery_pct: batPct,
    generator_v: r1(13.8 + wave * 0.6 + noise(0.2)),
    river_speed_ms: null,
    brake_on: false,
    pump_on: pumpOn,
    alarm_on: alarm,
    device_efficiency_pct: pumpOn ? r1(removal * 100) : null,
    flow_rate_lpm: pumpOn ? r2(2.5 + noise(0.08)) : 0,
    water_liters_total: r1(liters),
    basket_fill_pct: Math.max(0, basket),
    pump_current_a: pumpOn ? r2(0.4 + noise(0.03)) : 0,
    pump_cycles: Math.floor(minutesToday / 360) + 1,
    tilt_deg: r1(tilt),
    shock: false,
    signal_csq: csq,
    rssi_dbm: -113 + 2 * csq,
    values,
  };
}

/** Packets between `since` and `until`, most recent first and at most `limit` (like the API). */
export function mockTelemetryHistory(code: string, since: number, until: number, limit: number): DeviceTelemetryDto[] {
  const out: DeviceTelemetryDto[] = [];
  const last = Math.floor(until / MOCK_TELEMETRY_STEP_MS) * MOCK_TELEMETRY_STEP_MS;
  for (let t = last; t >= since && out.length < limit; t -= MOCK_TELEMETRY_STEP_MS) out.push(mockTelemetry(code, t));
  return out;
}
