import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { toApiIso } from '../shared/utils/format.util';
import { wqiCategory } from '../shared/utils/wqi.util';
import { MockBackend } from './mock/mock-backend';
import { MockRioApi } from './mock/mock-rio-api';
import { parseApiError } from './interceptors/api-error.interceptor';
import { rangeFor } from './services/filters.service';
import { backoffDelay } from './services/live-stream.service';
import { TestBed } from '@angular/core/testing';

describe('core', () => {
  it('formats API timestamps as ISO UTC without milliseconds', () => {
    expect(toApiIso(new Date(Date.UTC(2026, 0, 15, 12, 30, 45, 123)))).toBe('2026-01-15T12:30:45Z');
  });

  it('maps WQI scores to categories', () => {
    expect(wqiCategory(95)).toBe('excelente');
    expect(wqiCategory(80)).toBe('buena');
    expect(wqiCategory(60)).toBe('regular');
    expect(wqiCategory(40)).toBe('mala');
    expect(wqiCategory(10)).toBe('critica');
  });

  it('backs off exponentially up to 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(backoffDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it('computes date presets', () => {
    const now = Date.UTC(2026, 0, 15, 12);
    const r24 = rangeFor('24h', now, null);
    expect(r24.to.getTime() - r24.from.getTime()).toBe(86_400_000);
    const r7 = rangeFor('7d', now, null);
    expect(r7.to.getTime() - r7.from.getTime()).toBe(7 * 86_400_000);
    const y = rangeFor('yesterday', now, null);
    expect(y.to.getTime() - y.from.getTime()).toBe(86_400_000);
    expect(y.to.getHours()).toBe(0);
  });

  it('shows error.message from { error: { code, message } }', () => {
    const e = parseApiError(new HttpErrorResponse({ status: 422, error: { error: { code: 'validation', message: 'pH fuera de rango' } } }));
    expect(e.message).toBe('pH fuera de rango');
    expect(e.code).toBe('validation');
    expect(parseApiError(new HttpErrorResponse({ status: 0 })).message).toContain('conectar');
  });
});

describe('mock API', () => {
  let api: MockRioApi;
  let be: MockBackend;
  const q = { from: '2026-01-14T12:00:00Z', to: '2026-01-15T12:00:00Z' };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [MockRioApi, MockBackend] });
    api = TestBed.inject(MockRioApi);
    be = TestBed.inject(MockBackend);
  });

  it('serves 3 Puebla stations and a consistent overview', async () => {
    expect((await firstValueFrom(api.stations())).length).toBe(3);
    const o = await firstValueFrom(api.overview(q));
    expect(o.sensors.total).toBe(9);
    expect(o.wqi.outlet.score).toBeGreaterThan(o.wqi.river.score);
    expect(o.ph.outlet!).toBeGreaterThan(o.ph.inlet!);
  });

  it('ph analytics has avg/min/max per bucket and water totals add up', async () => {
    const ph = await firstValueFrom(api.ph(q, '5m'));
    expect(ph.series.length).toBeGreaterThan(200);
    const p = ph.series[10];
    expect(p.inlet.min).toBeLessThanOrEqual(p.inlet.avg);
    expect(p.inlet.max).toBeGreaterThanOrEqual(p.inlet.avg);
    const w = await firstValueFrom(api.waterRecovery(q, '1h'));
    expect(w.totals.liters_clean).toBeLessThan(w.totals.liters_in);
    expect(w.totals.efficiency_pct).toBeGreaterThan(70);
  });

  it('an acid reading raises a live critical alert', async () => {
    const events: string[] = [];
    be.events$.subscribe((e) => events.push(e.type));
    const id = be.stations[0].id;
    const r = await firstValueFrom(api.simulateAcidDischarge(id));
    expect(r.accepted).toBe(true);
    expect(events).toContain('reading');
    expect(events).toContain('alert');
    const page = await firstValueFrom(api.alerts({ status: 'open', severity: 'critical', limit: 50, offset: 0 }));
    expect(page.items.some((a) => a.station_id === id && a.value === 5)).toBe(true);
  });

  it('patches alert status and paginates', async () => {
    const open = await firstValueFrom(api.alerts({ status: 'open', limit: 1, offset: 0 }));
    expect(open.items.length).toBe(1);
    const a = await firstValueFrom(api.patchAlert(open.items[0].id, { status: 'acknowledged', note: 'ok' }));
    expect(a.status).toBe('acknowledged');
    expect(a.acknowledged_at).not.toBeNull();
  });

  it('forecast has a widening confidence band', async () => {
    const f = await firstValueFrom(api.forecastPh(be.stations[0].id, 6));
    expect(f.forecast.length).toBe(36);
    const w = (i: number) => f.forecast[i].upper - f.forecast[i].lower;
    expect(w(35)).toBeGreaterThan(w(0));
    expect(f.forecast.every((p) => p.lower <= p.value && p.value <= p.upper)).toBe(true);
  });
});

describe('valueOrUndefined', () => {
  it('never throws for resources in error state', async () => {
    const { valueOrUndefined } = await import('../shared/utils/resource.util');
    const errored = { hasValue: () => false, value: () => { throw new Error('Resource is currently in an error state'); } };
    const ok = { hasValue: () => true, value: () => 42 };
    expect(valueOrUndefined(errored)).toBeUndefined();
    expect(valueOrUndefined(ok)).toBe(42);
  });
});
