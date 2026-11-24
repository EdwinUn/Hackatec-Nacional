import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, output, signal, viewChild } from '@angular/core';
import type * as Leaflet from 'leaflet';
import { GeoPoint } from '../../core/models/ops.models';
import { ATTRIBUTION, BASIN_BOUNDS, BASIN_CENTER, TILES } from '../../features/satellite/basin';

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
  private L!: typeof Leaflet;
  private map?: Leaflet.Map;
  private layer?: Leaflet.LayerGroup;
  private pin?: Leaflet.Marker;
  private readonly ready = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);
    let destroyed = false;
    afterNextRender(() => {
      void import('leaflet').then((mod) => {
        if (destroyed) return;
        const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
        this.L = L;
        const map = L.map(this.el().nativeElement, { center: BASIN_CENTER, zoom: 11, minZoom: 9, maxZoom: 18, maxBounds: BASIN_BOUNDS, zoomControl: true, attributionControl: false });
        L.tileLayer(TILES.imagery, { maxZoom: 18, attribution: ATTRIBUTION }).addTo(map);
        L.tileLayer(TILES.labels, { maxZoom: 18, opacity: 0.85 }).addTo(map);
        this.layer = L.layerGroup().addTo(map);
        map.on('click', (e: Leaflet.LeafletMouseEvent) => {
          if (this.pickable()) this.picked.emit({ latitude: e.latlng.lat, longitude: e.latlng.lng, accuracy: null });
        });
        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(this.el().nativeElement);
        destroyRef.onDestroy(() => ro.disconnect());
        this.map = map;
        this.ready.set(true);
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
      const L = this.L;
      this.layer!.clearLayers();
      for (const p of pts) {
        const on = p.id === sel;
        L.circleMarker([p.latitude, p.longitude], { radius: on ? 10 : 7, color: '#fff', weight: 2, fillColor: p.color, fillOpacity: 1 })
          .bindTooltip(p.label)
          .on('click', () => this.pointClick.emit(p.id))
          .addTo(this.layer!);
      }
      if (sel) {
        const p = pts.find((x) => x.id === sel);
        if (p) this.map!.setView([p.latitude, p.longitude], Math.max(this.map!.getZoom(), 14));
      } else if (pts.length && !this.value()) {
        this.map!.fitBounds(L.latLngBounds(pts.map((p) => [p.latitude, p.longitude] as Leaflet.LatLngTuple)).pad(0.25), { maxZoom: 15 });
      }
    });

    effect(() => {
      const v = this.value();
      if (!this.ready()) return;
      const L = this.L;
      if (!v) {
        this.pin?.remove();
        this.pin = undefined;
        return;
      }
      const icon = L.divIcon({ className: '', html: '<i class="pi pi-map-marker" style="font-size:2rem;color:#e5484d;text-shadow:0 1px 4px #000"></i>', iconSize: [32, 32], iconAnchor: [16, 30] });
      if (this.pin) this.pin.setLatLng([v.latitude, v.longitude]);
      else this.pin = L.marker([v.latitude, v.longitude], { icon }).addTo(this.map!);
      this.map!.setView([v.latitude, v.longitude], Math.max(this.map!.getZoom(), 15));
    });
  }
}
