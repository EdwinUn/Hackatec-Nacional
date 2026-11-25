import { Subject } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from './config/app-config';
import { deviceCodeFor, linkQuality, liveWindowMs } from './models/telemetry.models';
import { LiveStreamService } from './services/live-stream.service';
import { TelemetryService } from './services/telemetry.service';

describe('telemetry helpers', () => {
  it('maps the 3D model code to the station code', () => {
    expect(deviceCodeFor('B-01')).toBe('RM-01');
    expect(deviceCodeFor(' rm-02 ')).toBe('RM-02');
    expect(deviceCodeFor('BM-02')).toBe('RM-02');
    expect(deviceCodeFor('B-2')).toBe('RM-02');
  });

  it('grades the link by RSSI', () => {
    expect(linkQuality(-55).label).toBe('Excelente');
    expect(linkQuality(-70).label).toBe('Buena');
    expect(linkQuality(-80).label).toBe('Débil');
    expect(linkQuality(-95).label).toBe('Muy débil');
    expect(linkQuality(null).label).toBe('Sin dato');
  });
});

describe('TelemetryService', () => {
  function setup() {
    const raw$ = new Subject<{ type: string; data: unknown }>();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: APP_CONFIG, useValue: { apiBaseUrl: 'http://api/v1' } }, { provide: LiveStreamService, useValue: { raw$ } }],
    });
    return { svc: TestBed.inject(TelemetryService), raw$, http: TestBed.inject(HttpTestingController) };
  }

  it('turns a device_telemetry frame into a live packet that expires', () => {
    vi.useFakeTimers();
    const { svc, raw$ } = setup();
    const live = svc.isLive('RM-01');
    expect(live()).toBe(false);
    raw$.next({ type: 'device_telemetry', data: { code: 'RM-01', station_id: 's', ts: new Date().toISOString(), seq: 3, battery_pct: 78, basket_fill_pct: 37, rssi_dbm: -61, values: { ph: 6.9 } } });
    expect(svc.packet('RM-01')()?.basket_fill_pct).toBe(37);
    expect(live()).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(live()).toBe(true); // a late packet (Wokwi slower than real time) is still live
    vi.advanceTimersByTime(20_000);
    expect(live()).toBe(false); // three publish periods without packets: «Sin señal»
    vi.useRealTimers();
  });

  it('follows the real rhythm of the packets: a slow Wokwi does not flicker, a silent buoy goes «Sin señal»', () => {
    vi.useFakeTimers();
    const { svc, raw$ } = setup();
    const live = svc.isLive('RM-01');
    const send = (seq: number) => raw$.next({ type: 'device_telemetry', data: { code: 'RM-01', station_id: 's', ts: new Date().toISOString(), seq, values: {} } });
    send(1);
    vi.advanceTimersByTime(80_000); // Wokwi at ~20 % speed: next packet 80 s later
    send(2);
    expect(svc.packet('RM-01')()?.intervalMs).toBe(80_000);
    vi.advanceTimersByTime(150_000); // < 2.5 × 80 s
    expect(live()).toBe(true);
    vi.advanceTimersByTime(60_000); // > 2.5 × 80 s without packets
    expect(live()).toBe(false);
    send(3); // queued packets arrive together after a reconnection: they keep the rhythm
    send(4);
    expect(svc.packet('RM-01')()?.intervalMs).toBe(210_000);
    vi.useRealTimers();
  });

  it('caps the live window at 5 min', () => {
    expect(liveWindowMs({ intervalMs: 10_000 })).toBe(45_000);
    expect(liveWindowMs({ intervalMs: 80_000 })).toBe(200_000);
    expect(liveWindowMs({ intervalMs: 600_000 })).toBe(300_000);
    expect(liveWindowMs({})).toBe(45_000);
  });

  it('ignores other frames and seeds from the latest stored packet (shown, not live)', () => {
    const { svc, raw$, http } = setup();
    raw$.next({ type: 'reading', data: { code: 'RM-01' } });
    expect(svc.packet('RM-01')()).toBeNull();
    svc.ensureLoaded('rm-01');
    http.expectOne('http://api/v1/devices/RM-01/telemetry/latest').flush({ station_id: 's', ts: '2026-11-24T10:00:00Z', seq: 1, battery_pct: 50, values: { ph: 7 } });
    expect(svc.packet('RM-01')()?.battery_pct).toBe(50);
    expect(svc.isLive('RM-01')()).toBe(false);
  });
});

describe('mock telemetry (fidelity rules, docs/fidelidad.md § 3)', () => {
  const day = Array.from({ length: 24 * 30 }, (_, i) => Date.UTC(2026, 10, 24) + i * 120_000);

  it('never reports outlet data or efficiency without flow, and TDS stays within the sensor range', async () => {
    const { mockTelemetry } = await import('./mock/telemetry.mock');
    let off = 0;
    for (const t of day) {
      for (const code of ['RM-01', 'RM-02']) {
        const p = mockTelemetry(code, t);
        expect(p.values!['tds_ppm']).toBeLessThanOrEqual(1000);
        // Firmware hysteresis: the pump stops below 35 % and restarts above 75 %.
        if (p.pump_on) expect(p.battery_pct!).toBeGreaterThanOrEqual(34);
        else expect(p.battery_pct!).toBeLessThanOrEqual(76);
        if (!p.pump_on) {
          off++;
          expect(p.values!['ph_out']).toBeUndefined();
          expect(p.values!['turb_out_ntu']).toBeUndefined();
          expect(p.device_efficiency_pct).toBeNull();
          expect(p.flow_rate_lpm).toBe(0);
        } else {
          const drop = 1 - p.values!['turb_out_ntu'] / p.values!['turb_in_ntu'];
          expect(drop).toBeGreaterThanOrEqual(0.59);
          expect(drop).toBeLessThanOrEqual(0.91);
          expect(Math.abs(p.values!['ph_out'] - p.values!['ph'])).toBeLessThan(0.3);
        }
      }
    }
    expect(off).toBeGreaterThan(0);
  });

  it('history is most recent first, inside the window and capped at the limit', async () => {
    const { mockTelemetryHistory } = await import('./mock/telemetry.mock');
    const until = Date.UTC(2026, 10, 25, 12);
    const h = mockTelemetryHistory('RM-01', until - 3_600_000, until, 10);
    expect(h.length).toBe(10);
    expect(Date.parse(h[0].ts)).toBeGreaterThan(Date.parse(h[9].ts));
    expect(Date.parse(h[9].ts)).toBeGreaterThanOrEqual(until - 3_600_000);
  });
});
