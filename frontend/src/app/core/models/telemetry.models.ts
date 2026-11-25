/** Packet of the buoy's ESP32 (`device_telemetry` over `/ws/live`, `GET /devices/{code}/telemetry/latest`). See `API.md`. */
export interface DeviceTelemetryDto {
  code?: string;
  station_id: string;
  ts: string;
  seq: number | null;
  battery_pct: number | null;
  battery_v: number | null;
  gas_v?: number | null;
  device_efficiency_pct?: number | null;
  river_speed_ms: number | null;
  generator_v?: number | null;
  flow_rate_lpm: number | null;
  basket_fill_pct: number | null;
  /** From the 4G modem's CSQ (`−113 + 2·CSQ`); null when the modem doesn't know. */
  rssi_dbm: number | null;
  signal_csq?: number | null;
  pump_on: boolean | null;
  brake_on?: boolean | null;
  alarm_on: boolean | null;
  pump_current_a?: number | null;
  /** Water processed since the ESP32 started (sum of the flow meter). */
  water_liters_total?: number | null;
  pump_cycles?: number | null;
  tilt_deg?: number | null;
  shock?: boolean | null;
  /** Water quality of that packet, with the firmware names: `ph` (inlet), `ph_out`, `tds_ppm`, `temp_c`, `turb_in_ntu`, `turb_out_ntu`. */
  values: Record<string, number> | null;
}

/** Last packet of a buoy plus when it reached this app. */
export interface TelemetryPacket extends DeviceTelemetryDto {
  receivedAt: number;
  /** Time between the last two packets that arrived by `/ws/live` (their real rhythm), if known. */
  intervalMs?: number;
}

/**
 * Minimum time a packet counts as «live»: three publish periods of the firmware (15 s each,
 * `PERIODO_ENVIO_MS` in firmware/boya-rm01/sketch.ino).
 */
export const TELEMETRY_LIVE_MS = 45_000;
/** Upper bound, so a buoy that stopped sending ends up as «Sin señal». */
export const TELEMETRY_LIVE_MAX_MS = 300_000;
/** Packets closer than this are a burst of queued ones (sent after a reconnection), not the rhythm. */
export const TELEMETRY_BURST_MS = 2_000;

/**
 * How long a packet counts as «live»: 2.5× the real rhythm at which packets arrive, between 45 s and
 * 5 min. Wokwi often runs much slower than real time (packets every 1–2 min instead of 15 s), and a
 * fixed window would flicker between «En vivo» and «Sin señal».
 */
export function liveWindowMs(p: Pick<TelemetryPacket, 'intervalMs'>): number {
  return Math.min(TELEMETRY_LIVE_MAX_MS, Math.max(TELEMETRY_LIVE_MS, 2.5 * (p.intervalMs ?? 0)));
}

/** Normalizes a buoy code; the old aliases `B-02` / `BM-02` are the same buoy as `RM-02`. */
export function deviceCodeFor(buoyCode: string): string {
  const c = buoyCode.trim().toUpperCase();
  const m = /^(?:B|BM|RM)-0*(\d+)$/.exec(c);
  return m ? `RM-${m[1].padStart(2, '0')}` : c;
}

export function linkQuality(rssi: number | null): { label: string; color: string } {
  if (rssi === null) return { label: 'Sin dato', color: '#64748b' };
  if (rssi >= -60) return { label: 'Excelente', color: '#0f7a4d' };
  if (rssi >= -75) return { label: 'Buena', color: '#0891b2' };
  if (rssi >= -85) return { label: 'Débil', color: '#a16207' };
  return { label: 'Muy débil', color: '#b91c1c' };
}
