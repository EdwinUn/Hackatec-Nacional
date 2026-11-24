import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from './config/app-config';
import { OperatorApi } from './api/operator-api';

describe('OperatorApi', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: APP_CONFIG, useValue: { apiBaseUrl: 'http://api/v1' } }],
    });
    return { api: TestBed.inject(OperatorApi), http: TestBed.inject(HttpTestingController) };
  }

  it('asks the backend for the selected inbox tab', () => {
    const { api, http } = setup();
    api.tasks('reparaciones_pendientes').subscribe();
    const req = http.expectOne((r) => r.url === 'http://api/v1/tasks');
    expect(req.request.params.get('view')).toBe('reparaciones_pendientes');
    req.flush({ items: [], total: 0, counts: { asignadas: 0, reparaciones_pendientes: 0, urgentes: 0, listos: 0 } });
  });

  it('resolves a task with its closing note', () => {
    const { api, http } = setup();
    api.patchTask('t1', { status: 'done', closing_note: 'Listo' }).subscribe();
    const req = http.expectOne('http://api/v1/tasks/t1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'done', closing_note: 'Listo' });
    req.flush({});
  });

  it('posts the five materials of a skimmer emptying', () => {
    const { api, http } = setup();
    const m = { kg: 1, piezas: 2 };
    api.recordCollection({ station_id: 's1', buoy_code: 'SK-01', buoy_condition: 'ok', plastico: m, organico: m, vidrio: m, otros: m, metal: m }).subscribe();
    const req = http.expectOne('http://api/v1/skimmers/recoleccion');
    expect(Object.keys(req.request.body)).toEqual(expect.arrayContaining(['plastico', 'organico', 'vidrio', 'otros', 'metal', 'buoy_condition']));
    req.flush({});
  });
});
