import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MOCK_BUOYS } from '../../core/mock/buoys.mock';
import { buoyState } from '../../core/models/buoy.models';
import { BuoysService } from '../../core/services/buoys.service';
import { BuoyDetailPage } from './buoy-detail-page';
import { BuoyViewer } from './buoy-viewer';

/** jsdom has no WebGL: the 3D viewer is replaced with a stub. */
@Component({ selector: 'app-buoy-viewer', template: '' })
class BuoyViewerStub {
  readonly design = input();
  readonly view = input();
  readonly xray = input();
  readonly ariaLabel = input();
  readonly telemetry = input();
  readonly source = input();
}

describe('BuoysService', () => {
  it('lists the mock buoys and looks them up by id', () => {
    const service = TestBed.inject(BuoysService);
    expect(service.buoys().length).toBe(MOCK_BUOYS.length);
    expect(service.byId('rm-01')?.name).toBe('Boya RM-01');
    expect(service.byId('no-existe')).toBeUndefined();
  });
});

describe('BuoyDetailPage', () => {
  function render(id: string) {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    TestBed.overrideComponent(BuoyDetailPage, { remove: { imports: [BuoyViewer] }, add: { imports: [BuoyViewerStub] } });
    const fixture = TestBed.createComponent(BuoyDetailPage);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the buoy and its 3D viewer', () => {
    const el = render('rm-01');
    expect(el.querySelector('h1')?.textContent).toContain('Boya RM-01');
    expect(el.querySelector('app-buoy-viewer')).not.toBeNull();
  });

  it('says the buoy is simulated and has no data before the ESP32 sends anything', () => {
    const el = render('rm-02');
    expect(el.textContent).toContain('Simulada en Wokwi');
    expect(el.textContent).toContain('Sin datos');
    expect(el.textContent).not.toContain('En operación');
  });

  it('shows an empty state when the buoy does not exist', () => {
    const el = render('no-existe');
    expect(el.textContent).toContain('No existe una boya con ese identificador');
    expect(el.querySelector('app-buoy-viewer')).toBeNull();
  });
});

describe('buoyState', () => {
  it('comes from the telemetry, not from a deployment status', () => {
    expect(buoyState(null, false)).toBe('nodata');
    expect(buoyState({ basket_fill_pct: 10 }, false)).toBe('stale');
    expect(buoyState({ basket_fill_pct: 10 }, true)).toBe('live');
    expect(buoyState({ basket_fill_pct: 80 }, true)).toBe('saturated');
    expect(buoyState({ basket_fill_pct: null }, true)).toBe('live');
  });

  it('only lists the buoys that exist in the backend and in Wokwi', () => {
    expect(MOCK_BUOYS.map((b) => b.code)).toEqual(['RM-01', 'RM-02']);
  });
});
