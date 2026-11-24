import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, output, signal, viewChild } from '@angular/core';
import type { Map as MlMap, Marker, StyleSpecification } from 'maplibre-gl';
import { GeoPoint } from '../../core/models/ops.models';
import { ATTRIBUTION, BASIN_BOUNDS, BASIN_CENTER, TILES, toLngLat } from '../../features/satellite/basin';

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: { type: 'raster', tiles: [TILES.imagery], tileSize: 256, maxzoom: 19, attribution: ATTRIBUTION },
    labels: { type: 'raster', tiles: [TILES.labels], tileSize: 256, maxzoom: 19 },
  },
  layers: [
    { id: 'satellite', type: 'raster', source: 'satellite' },
    { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } },
  ],
};

export interface MapPoint extends GeoPoint {
  id: string;
  color: string;
  label: string;
}

/**
 * Small satellite map of the basin.
 * - `points`: markers to show (click → `pointClick`).
 * - `pickable`: clicking the map places/moves the `value` pin (→ `picked`).
 */
@Component({
  selector: 'app-mini-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; position: relative; border-radius: 10px; overflow: hidden; border: 1px solid var(--rm-border); background: #0b1d16; }
    .map { width: 100%; height: 100%; min-height: inherit; }
    .hint { position: absolute; right: .5rem; top: .5rem; z-index: 500; background: rgb(17 42 34 / .85); color: #fff; font-size: .75rem; padding: .25rem .55rem; border-radius: 6px; pointer-events: none; }
  `,
  template: `
    <div #map class="map" role="application" [attr.aria-label]="pickable() ? 'Mapa: toca para marcar el punto' : 'Mapa de ubicaciones'"></div>
    @if (pickable() && !value()) { <span class="hint"><i class="pi pi-map-marker"></i> Toca el mapa para marcar el punto</span> }
  `,
})
export class MiniMap {
  readonly points = input<MapPoint[]>([]);
  readonly value = input<GeoPoint | null>(null);
  readonly pickable = input(false);
  readonly selectedId = input<string | null>(null);
  readonly picked = output<GeoPoint>();
  readonly pointClick = output<string>();

  private readonly el = viewChild.required<ElementRef<HTMLElement>>('map');
  private ml!: typeof import('maplibre-gl');
  private map?: MlMap;
  private markers: Marker[] = [];
  private pin?: Marker;
  private readonly ready = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);
    let destroyed = false;
    afterNextRender(() => {
      void import('maplibre-gl').then(async (ml) => {
        // The worker is copied next to the app by angular.json (assets).
        await ml.setWorkerUrl(new URL('maplibre-gl-worker.mjs', document.baseURI).href);
        if (destroyed) return;
        this.ml = ml;
        const [sw, ne] = BASIN_BOUNDS.map(toLngLat);
        const map = new ml.Map({
          container: this.el().nativeElement,
          style: STYLE,
          center: toLngLat(BASIN_CENTER),
          zoom: 11,
          minZoom: 9,
          maxZoom: 18,
          maxBounds: [sw, ne],
          attributionControl: false,
        });
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-left');
        map.on('click', (e) => {
          if (this.pickable()) this.picked.emit({ latitude: e.lngLat.lat, longitude: e.lngLat.lng, accuracy: null });
        });
        const ro = new ResizeObserver(() => map.resize());
        ro.observe(this.el().nativeElement);
        destroyRef.onDestroy(() => ro.disconnect());
        this.map = map;
        map.once('load', () => this.ready.set(true));
      });
    });
    destroyRef.onDestroy(() => {
      destroyed = true;
      this.map?.remove();
    });

    effect(() => {
      const pts = this.points();
      const sel = this.selectedId();
      if (!this.ready()) return;
      for (const m of this.markers) m.remove();
      this.markers = pts.map((p) => {
        const on = p.id === sel;
        const size = on ? 20 : 14;
        const el = document.createElement('button');
        el.type = 'button';
        el.title = p.label;
        el.setAttribute('aria-label', p.label);
        el.style.cssText = `width:${size}px;height:${size}px;padding:0;border-radius:50%;border:2px solid #fff;background:${p.color};cursor:pointer;box-shadow:0 1px 4px rgb(0 0 0 / .5)`;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.pointClick.emit(p.id);
        });
        return new this.ml.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(this.map!);
      });
      const map = this.map!;
      if (sel) {
        const p = pts.find((x) => x.id === sel);
        if (p) map.easeTo({ center: [p.longitude, p.latitude], zoom: Math.max(map.getZoom(), 14) });
      } else if (pts.length && !this.value()) {
        const bounds = new this.ml.LngLatBounds();
        for (const p of pts) bounds.extend([p.longitude, p.latitude]);
        map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 0 });
      }
    });

    effect(() => {
      const v = this.value();
      if (!this.ready()) return;
      if (!v) {
        this.pin?.remove();
        this.pin = undefined;
        return;
      }
      if (this.pin) this.pin.setLngLat([v.longitude, v.latitude]);
      else {
        const el = document.createElement('i');
        el.className = 'pi pi-map-marker';
        el.style.cssText = 'font-size:2rem;color:#e5484d;text-shadow:0 1px 4px #000';
        this.pin = new this.ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([v.longitude, v.latitude]).addTo(this.map!);
      }
      this.map!.easeTo({ center: [v.longitude, v.latitude], zoom: Math.max(this.map!.getZoom(), 15) });
    });
  }
}
