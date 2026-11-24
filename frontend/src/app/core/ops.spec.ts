import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { calibrationOffset, compareOrders, distanceKm, stationStatusFor } from '../shared/utils/ops.util';
import { OpsApi } from './api/ops-api';
import { RioApi } from './api/rio-api';
import { AuthService } from './auth/auth.service';
import { DEMO_PASSWORD, MockOpsApi } from './mock/mock-ops-api';
import { OpsEvent, WorkOrder } from './models/ops.models';
import { Station } from './models/rio.models';

const STATIONS: Station[] = [
  { id: 's1', name: 'Atoyac — Puente', river: 'Atoyac', latitude: 19.05, longitude: -98.25 },
  { id: 's2', name: 'Alseseca', river: 'Alseseca', latitude: 19.03, longitude: -98.16 },
];

function setup(): { api: MockOpsApi; auth: AuthService } {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      MockOpsApi,
      { provide: OpsApi, useExisting: MockOpsApi },
      { provide: RioApi, useValue: { stations: () => of(STATIONS) } },
    ],
  });
  return { api: TestBed.inject(MockOpsApi), auth: TestBed.inject(AuthService) };
}

describe('operations rules', () => {
  it('computes a one-point calibration offset', () => {
    expect(calibrationOffset(7, 6.82)).toBe(0.18);
    expect(calibrationOffset(4, 4.1234)).toBe(-0.123);
  });

  it('puts the station in maintenance while a maintenance order is in progress', () => {
    const o = { type: 'maintenance', station_id: 's1' } as WorkOrder;
    expect(stationStatusFor(o, 'in_progress')).toBe('maintenance');
    expect(stationStatusFor(o, 'done')).toBe('active');
    expect(stationStatusFor({ ...o, type: 'waste_collection' }, 'in_progress')).toBeNull();
  });

  it('sorts open orders by priority before closed ones', () => {
    const mk = (id: string, status: WorkOrder['status'], priority: WorkOrder['priority']) => ({ id, status, priority, due_at: null, created_at: '2026-01-01' }) as WorkOrder;
    const sorted = [mk('a', 'done', 'urgent'), mk('b', 'assigned', 'low'), mk('c', 'in_progress', 'urgent')].sort(compareOrders);
    expect(sorted.map((o) => o.id)).toEqual(['c', 'b', 'a']);
  });

  it('measures distances in km', () => {
    expect(distanceKm({ latitude: 19, longitude: -98.2 }, { latitude: 19.01, longitude: -98.2 })).toBeCloseTo(1.11, 1);
  });
});

describe('MockOpsApi + AuthService', () => {
  it('logs in with a demo account and rejects a wrong password', async () => {
    const { auth } = setup();
    await expect(firstValueFrom(auth.login('tecnico@demo.mx', 'nope'))).rejects.toThrow(/incorrectos/);
    await firstValueFrom(auth.login('TECNICO@demo.mx', DEMO_PASSWORD));
    expect(auth.role()).toBe('technician');
    expect(auth.homeUrl()).toBe('/operaciones/mis-tareas');
    auth.logout(false);
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('runs the full cycle: report → order → done, and the citizen sees it resolved', async () => {
    const { api } = setup();
    const events: OpsEvent[] = [];
    api.events$.subscribe((e) => events.push(e));

    const report = await firstValueFrom(api.createCitizenReport({ type: 'trash', description: 'Basura en la orilla', photo: null, latitude: 19.051, longitude: -98.251 }));
    expect(report.folio).toMatch(/^RC-\d{4}$/);
    expect(report.station_id).toBe('s1');

    const order = await firstValueFrom(
      api.createWorkOrder({ type: 'citizen_report', title: 'Atender', description: '', priority: 'high', station_id: 's1', citizen_report_id: report.id, assigned_to: 'u-tec-1' }),
    );
    expect(order.status).toBe('assigned');
    expect(events.some((e) => e.type === 'work_order_assigned' && e.data.id === order.id)).toBe(true);
    expect((await firstValueFrom(api.reportByFolio(report.folio))).status).toBe('verified');

    await firstValueFrom(api.patchWorkOrder(order.id, { status: 'in_progress' }));
    expect((await firstValueFrom(api.reportByFolio(report.folio))).status).toBe('in_progress');

    await firstValueFrom(api.patchWorkOrder(order.id, { status: 'done', result: { confirmed: true, action_taken: 'Se retiraron 12 kg' } }));
    const after = await firstValueFrom(api.reportByFolio(report.folio.toLowerCase()));
    expect(after.status).toBe('resolved');
    expect(after.public_note).toBe('Se retiraron 12 kg');
  });

  it('refuses invalid transitions', async () => {
    const { api } = setup();
    const o = await firstValueFrom(api.createWorkOrder({ type: 'maintenance', title: 'X', description: '', priority: 'normal', station_id: 's1' }));
    expect(o.status).toBe('pending');
    await expect(firstValueFrom(api.patchWorkOrder(o.id, { status: 'done' }))).rejects.toThrow(/No se puede/);
  });
});
