import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type * as Leaflet from 'leaflet';
import { RioApi } from '../../core/api/rio-api';
import { OpsApi } from '../../core/api/ops-api';
import { REPORT_STATUS_META, REPORT_TYPE_META } from '../../shared/utils/ops.util';
import { Hotspot, SensorHealth, SensorPosition } from '../../core/models/rio.models';
import { FiltersService } from '../../core/services/filters.service';
import { LiveStreamService } from '../../core/services/live-stream.service';
import { Pill } from '../../shared/components/pill';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { formatCoords, timeAgo } from '../../shared/utils/format.util';
import { typeLabel } from '../../core/api/labels';
import { SENSOR_STATUS_META, WQI_META, wqiText } from '../../shared/utils/wqi.util';
import { ATTRIBUTION, BASIN_BOUNDS, BASIN_CENTER, BASIN_ZOOM, PRESA_VALSEQUILLO, RIO_ALSESECA, RIO_ATOYAC, TILES } from './basin';

const POSITION_LABEL: Record<SensorPosition, string> = { inlet: 'Entrada', outlet: 'Salida', river: 'Río' };
const CATEGORIES = Object.keys(WQI_META).filter((k) => k !== 'sin_datos') as (keyof typeof WQI_META)[];

@Component({
  selector: 'app-satellite-page',
  imports: [DecimalPipe, RouterLink, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './satellite-page.html',
  styleUrl: './satellite-page.scss',
})
export class SatellitePage {
  private readonly api = inject(RioApi);
  private readonly filters = inject(FiltersService);
  private readonly live = inject(LiveStreamService);
  private readonly ops = inject(OpsApi);

  protected readonly wqi = WQI_META;
  protected readonly categories = CATEGORIES;
  protected readonly sensorMeta = SENSOR_STATUS_META;
  protected readonly positionLabel = POSITION_LABEL;
  protected readonly coords = formatCoords;
  protected readonly paramLabel = typeLabel;
  protected readonly wqiText = wqiText;
  protected readonly ago = timeAgo;
  protected readonly positions: SensorPosition[] = ['inlet', 'outlet', 'river'];

  private readonly mapEl = viewChild.required<ElementRef<HTMLElement>>('map');
  private L!: typeof Leaflet;
  private map?: Leaflet.Map;
  private markers?: Leaflet.LayerGroup;
  private reportLayer?: Leaflet.LayerGroup;
  private readonly ready = signal(false);

  /** All stations are always on the map, regardless of the header station filter (range still applies). */
  protected readonly hotspots = rxResource({
    params: () => ({ from: this.filters.query().from, to: this.filters.query().to, tick: this.filters.tick() }),
    stream: () => this.api.hotspots(),
  });
  protected readonly list = computed<Hotspot[]>(() => valueOrUndefined(this.hotspots) ?? []);

  /** Citizen reports still being attended (layer toggled from the HUD). */
  protected readonly showReports = signal(true);
  private readonly reportsRes = rxResource({ params: () => this.filters.tick(), stream: () => this.ops.citizenReports() });
  protected readonly activeReports = computed(() => (valueOrUndefined(this.reportsRes) ?? []).filter((r) => r.status !== 'resolved' && r.status !== 'rejected'));

  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed(() => this.list().find((h) => h.station_id === this.selectedId()) ?? null);

  protected readonly sensorsRes = rxResource({
    params: () => (this.selectedId() ? { id: this.selectedId()! } : undefined),
    stream: ({ params }) => this.api.sensorsHealth({ station_id: params.id }),
  });
  /** Live pH per position of the selected station (overrides the last stored reading). */
  private readonly liveValues = signal<Partial<Record<SensorPosition, { value: number; ts: string }>>>({});
  protected readonly telemetry = computed(() =>
    this.positions.map((pos) => {
      const sensor = (valueOrUndefined(this.sensorsRes) ?? []).find((s: SensorHealth) => s.position === pos && s.parameter === 'ph');
      const live = this.liveValues()[pos];
      const last = live ?? (sensor?.last_reading ? { value: sensor.last_reading.value, ts: sensor.last_reading.ts } : null);
      return { pos, sensor, last, live: !!live };
    }),
  );

  protected readonly counts = computed(() => {
    const c = Object.fromEntries(CATEGORIES.map((k) => [k, 0])) as Record<(typeof CATEGORIES)[number], number>;
    for (const h of this.list()) if (h.wqi.category in c) c[h.wqi.category]++;
    return c;
  });
  protected readonly totals = computed(() => ({
    open: this.list().reduce((a, h) => a + h.open_alerts, 0),
    critical: this.list().reduce((a, h) => a + h.critical_alerts, 0),
  }));

  constructor() {
    const destroyRef = inject(DestroyRef);
    let destroyed = false;

    afterNextRender(() => {
      void import('leaflet').then((mod) => {
        if (destroyed) return;
        const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
        this.L = L;
        const map = L.map(this.mapEl().nativeElement, {
          center: BASIN_CENTER,
          zoom: BASIN_ZOOM,
          minZoom: 10,
          maxZoom: 17,
          maxBounds: BASIN_BOUNDS,
          maxBoundsViscosity: 1,
          zoomControl: false,
          attributionControl: true,
        });
        L.control.zoom({ position: 'bottomleft' }).addTo(map);
        L.tileLayer(TILES.imagery, { maxZoom: 17, attribution: ATTRIBUTION, bounds: BASIN_BOUNDS }).addTo(map);
        L.tileLayer(TILES.hillshade, { maxZoom: 17, opacity: 0.32, bounds: BASIN_BOUNDS }).addTo(map);
        L.tileLayer(TILES.labels, { maxZoom: 17, opacity: 0.85, bounds: BASIN_BOUNDS }).addTo(map);

        // Hydrography: Río Atoyac (glow + line), Río Alseseca and the Valsequillo reservoir.
        const river = (pts: Leaflet.LatLngTuple[], name: string, weight: number) => {
          L.polyline(pts, { color: '#7dd3fc', weight: weight + 6, opacity: 0.25, lineCap: 'round' }).addTo(map);
          L.polyline(pts, { color: '#38bdf8', weight, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).bindTooltip(name, { sticky: true }).addTo(map);
        };
        river(RIO_ATOYAC, 'Río Atoyac', 4);
        river(RIO_ALSESECA, 'Río Alseseca', 3);
        L.polygon(PRESA_VALSEQUILLO, { color: '#7dd3fc', weight: 2, fillColor: '#0ea5e9', fillOpacity: 0.28 }).bindTooltip('Presa de Valsequillo (Manuel Ávila Camacho)', { sticky: true }).addTo(map);

        this.reportLayer = L.layerGroup().addTo(map);
        this.markers = L.layerGroup().addTo(map);
        this.map = map;
        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(this.mapEl().nativeElement);
        destroyRef.onDestroy(() => ro.disconnect());
        this.ready.set(true);
      });
    });
    destroyRef.onDestroy(() => {
      destroyed = true;
      this.map?.remove();
    });

    // Pulsing station markers coloured by WQI category.
    effect(() => {
      if (!this.ready()) return;
      const list = this.list();
      const sel = this.selectedId();
      const { L } = this;
      this.markers?.clearLayers();
      for (const h of list) {
        const color = WQI_META[h.wqi.category].color;
        const icon = L.divIcon({
          className: 'station-pin',
          html: `<span class="pulse" style="background:${color}"></span><span class="core" style="background:${color};${h.station_id === sel ? 'outline:3px solid #fff;outline-offset:2px' : ''}"></span>`,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        });
        L.marker([h.latitude, h.longitude], { icon, title: `${h.name} · WQI ${h.wqi.score}`, alt: h.name, keyboard: true, zIndexOffset: h.station_id === sel ? 1000 : 0 })
          .on('click', () => this.select(h))
          .addTo(this.markers!);
      }
    });

    // Citizen reports: small icon pins coloured by type, with a popup.
    effect(() => {
      if (!this.ready()) return;
      const { L } = this;
      const reports = this.showReports() ? this.activeReports() : [];
      this.reportLayer?.clearLayers();
      for (const r of reports) {
        const t = REPORT_TYPE_META[r.type];
        const st = REPORT_STATUS_META[r.status];
        const icon = L.divIcon({
          className: 'report-pin',
          html: `<span style="background:${t.color}"><i class="${t.icon}"></i></span>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
        const photo = r.photo && /^(data:image\/|https?:\/\/)/.test(r.photo) ? `<img src="${esc(r.photo)}" alt="" style="width:180px;height:110px;object-fit:cover;border-radius:6px;display:block;margin-top:.4rem">` : '';
        L.marker([r.latitude, r.longitude], { icon, title: `${r.folio} · ${t.label}`, alt: t.label, keyboard: true })
          .bindPopup(`<strong>${t.label}</strong><br><small>${esc(r.folio)} · ${st.label} · ${timeAgo(r.created_at)}</small>${r.description ? `<p style="margin:.35rem 0 0;max-width:200px">${esc(r.description)}</p>` : ''}${photo}`)
          .addTo(this.reportLayer!);
      }
    });

    // Initial selection: header station if any, otherwise the worst station.
    effect(() => {
      const list = this.list();
      if (!list.length || this.selectedId()) return;
      const fromFilter = this.filters.stationId();
      const pick = list.find((h) => h.station_id === fromFilter) ?? [...list].sort((a, b) => a.wqi.score - b.wqi.score)[0];
      this.selectedId.set(pick.station_id);
    });

    // Live pH of the selected station.
    this.live.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e.type !== 'reading' || e.data.station_id !== this.selectedId() || e.data.parameter !== 'ph') return;
      this.liveValues.update((m) => ({ ...m, [e.data.position]: { value: e.data.value, ts: e.data.timestamp } }));
    });
  }

  protected select(h: Hotspot): void {
    this.liveValues.set({});
    this.selectedId.set(h.station_id);
    this.map?.flyTo([h.latitude, h.longitude], Math.max(this.map.getZoom(), 13), { duration: 0.8 });
  }

  protected resetView(): void {
    this.map?.flyTo(BASIN_CENTER, BASIN_ZOOM, { duration: 0.8 });
  }
}
