import { Subject } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from './config/app-config';
import { deviceCodeFor, linkQuality } from './models/telemetry.models';
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
    vi.advanceTimersByTime(20_000);
    expect(live()).toBe(false); // no new packet: «SIN SEÑAL»
    vi.useRealTimers();
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
