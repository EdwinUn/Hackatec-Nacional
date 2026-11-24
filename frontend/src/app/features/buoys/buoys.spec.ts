import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MOCK_BUOYS } from '../../core/mock/buoys.mock';
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
}

describe('BuoysService', () => {
  it('lists the mock buoys and looks them up by id', () => {
    const service = TestBed.inject(BuoysService);
    expect(service.buoys().length).toBe(MOCK_BUOYS.length);
    expect(service.byId('boya-1')?.name).toBe('Boya 1');
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
    const el = render('boya-1');
    expect(el.querySelector('h1')?.textContent).toContain('Boya 1');
    expect(el.querySelector('app-buoy-viewer')).not.toBeNull();
  });

  it('shows an empty state when the buoy does not exist', () => {
    const el = render('no-existe');
    expect(el.textContent).toContain('No existe una boya con ese identificador');
    expect(el.querySelector('app-buoy-viewer')).toBeNull();
  });
});
