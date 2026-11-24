import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { ExpressionSpecification, IControl, Map as MlMap, Marker, StyleSpecification } from 'maplibre-gl';
import { RioApi } from '../../core/api/rio-api';
import { OpsApi } from '../../core/api/ops-api';
import { REPORT_STATUS_META, REPORT_TYPE_META } from '../../shared/utils/ops.util';
import { CriticalPoint, Hotspot, SensorHealth, SensorPosition } from '../../core/models/rio.models';
import { CitizenReport } from '../../core/models/ops.models';
import { FiltersService } from '../../core/services/filters.service';
import { LiveStreamService } from '../../core/services/live-stream.service';
import { LayoutService } from '../../core/services/layout.service';
import { AuthService } from '../../core/auth/auth.service';
import { SkimmerSurvey } from '../operator/skimmer-survey';
import { Pill } from '../../shared/components/pill';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { VISION_CATEGORY_META, VISION_SEVERITY_META } from '../../shared/utils/vision.util';
import { formatCoords, timeAgo } from '../../shared/utils/format.util';
import { typeLabel } from '../../core/api/labels';
import { CRITICALITY_META, SENSOR_STATUS_META, WQI_META, wqiText } from '../../shared/utils/wqi.util';
import {
  ATTRIBUTION,
  BASIN_BOUNDS,
  BASIN_CENTER,
  BASIN_ZOOM,
  PRESA_VALSEQUILLO,
  RIVERS,
  TERRAIN_ATTRIBUTION,
  TILES,
  toLngLat,
} from './basin';

const POSITION_LABEL: Record<SensorPosition, string> = { inlet: 'Entrada', outlet: 'Salida', river: 'Río' };
const CATEGORIES = Object.keys(WQI_META).filter((k) => k !== 'sin_datos') as (keyof typeof WQI_META)[];

const PITCH_3D = 50;
const TERRAIN = { source: 'terrain', exaggeration: 1.5 };
const PRESA_NAME = 'Presa de Valsequillo (Manuel Ávila Camacho)';

/** Reference points of the basin (CONAGUA 2025). Informative only: not monitoring stations of this app. */
const KEY_POINTS_URL = 'data/puntos_clave_cuenca_atoyac.geojson';
const KEY_POINT_LAYERS = ['puntos-clave-critico', 'puntos-clave', 'puntos-clave-nombres'];
const ZONE_COLORS = { '1': '#3b82f6', '2': '#f59e0b', '3': '#ef4444', '4': '#a855f7', Zahuapan: '#22c55e' } as const;
const KEY_POINT_ZONES: { zona: keyof typeof ZONE_COLORS; label: string }[] = [
  { zona: '1', label: 'Zona 1 · Alto Atoyac (Sierra Nevada → Texmelucan / Nativitas)' },
  { zona: '2', label: 'Zona 2 · Confluencia Atoyac–Zahuapan' },
  { zona: '3', label: 'Zona 3 · Zona metropolitana de Puebla (San Francisco, Alseseca)' },
  { zona: '4', label: 'Zona 4 · Presa Manuel Ávila Camacho (Valsequillo)' },
  { zona: 'Zahuapan', label: 'Zahuapan · Río Zahuapan (Tlaxcala)' },
];
const ZONE_COLOR: ExpressionSpecification = [
  'match', ['get', 'zona'],
  '1', ZONE_COLORS['1'], '2', ZONE_COLORS['2'], '3', ZONE_COLORS['3'], '4', ZONE_COLORS['4'],
  'Zahuapan', ZONE_COLORS.Zahuapan,
  '#94a3b8',
];
const [SW, NE] = BASIN_BOUNDS.map(toLngLat);
/** Raster tiles are only requested inside the basin, as before. */
const TILE_BOUNDS: [number, number, number, number] = [SW[0], SW[1], NE[0], NE[1]];

/** Satellite → hillshade → Valsequillo → rivers → place labels; terrain from the DEM. */
function basinStyle(): StyleSpecification {
  const dem = { type: 'raster-dem' as const, tiles: [TILES.terrain], tileSize: 256, maxzoom: 14, encoding: 'terrarium' as const };
  return {
    version: 8,
    // Public MapLibre glyphs (no API key) for the key-point labels.
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      satellite: { type: 'raster', tiles: [TILES.imagery], tileSize: 256, maxzoom: 19, bounds: TILE_BOUNDS, attribution: ATTRIBUTION },
      labels: { type: 'raster', tiles: [TILES.labels], tileSize: 256, maxzoom: 19, bounds: TILE_BOUNDS },
      terrain: { ...dem, attribution: TERRAIN_ATTRIBUTION },
      hillshade: dem,
      presa: {
        type: 'geojson',
        data: { type: 'Feature', properties: { name: PRESA_NAME }, geometry: { type: 'Polygon', coordinates: [[...PRESA_VALSEQUILLO, PRESA_VALSEQUILLO[0]].map(toLngLat)] } },
      },
      'puntos-clave': { type: 'geojson', data: new URL(KEY_POINTS_URL, document.baseURI).href },
      rivers: {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: RIVERS.map((r) => ({
            type: 'Feature' as const,
            properties: { name: r.name, width: r.width },
            geometry: { type: 'LineString' as const, coordinates: r.path.map(toLngLat) },
          })),
        },
      },
    },
    layers: [
      { id: 'satellite', type: 'raster', source: 'satellite' },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'hillshade',
        paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': 'rgba(0,0,0,0.45)', 'hillshade-highlight-color': 'rgba(255,255,255,0.12)', 'hillshade-accent-color': 'rgba(0,0,0,0.15)' },
      },
      { id: 'presa-fill', type: 'fill', source: 'presa', paint: { 'fill-color': '#0ea5e9', 'fill-opacity': 0.28 } },
      { id: 'presa-line', type: 'line', source: 'presa', paint: { 'line-color': '#7dd3fc', 'line-width': 2 } },
      {
        id: 'rivers-glow',
        type: 'line',
        source: 'rivers',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#7dd3fc', 'line-width': ['+', ['get', 'width'], 6], 'line-opacity': 0.25 },
      },
      {
        id: 'rivers',
        type: 'line',
        source: 'rivers',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#38bdf8', 'line-width': ['get', 'width'], 'line-opacity': 0.95 },
      },
      { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } },
      {
        id: 'rivers-names',
        type: 'symbol',
        source: 'rivers',
        minzoom: 10,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold'],
          'text-size': 12,
          'symbol-spacing': 320,
          'text-letter-spacing': 0.05,
        },
        paint: { 'text-color': '#e0f2fe', 'text-halo-color': 'rgba(3, 37, 65, 0.9)', 'text-halo-width': 1.6 },
      },
      {
        id: 'puntos-clave-critico',
        type: 'circle',
        source: 'puntos-clave',
        filter: ['==', ['get', 'tramo_critico_documentado'], true],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 9, 15, 13],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': ZONE_COLOR,
          'circle-stroke-width': 2,
        },
      },
      {
        id: 'puntos-clave',
        type: 'circle',
        source: 'puntos-clave',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4.5, 15, 7],
          'circle-color': ZONE_COLOR,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: 'puntos-clave-nombres',
        type: 'symbol',
        source: 'puntos-clave',
        minzoom: 11,
        layout: {
          'text-field': ['get', 'nombre'],
          'text-font': ['Open Sans Semibold'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 0.9],
          'text-max-width': 12,
          'text-optional': true,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(4, 20, 14, 0.9)', 'text-halo-width': 1.6 },
      },
    ],
    terrain: TERRAIN,
  };
}

/** «Puntos clave de la cuenca» on/off switch with the zone legend. */
class KeyPointsControl implements IControl {
  private el?: HTMLElement;
  constructor(private readonly setVisible: (visible: boolean) => void) {}

  onAdd(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    el.style.cssText = 'padding: 6px 8px; font-size: 11px; line-height: 1.4; max-width: 230px; color: #0f172a';
    const label = document.createElement('label');
    label.style.cssText = 'display: flex; align-items: center; gap: 6px; font-weight: 700; cursor: pointer';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', () => this.setVisible(input.checked));
    label.append(input, 'Puntos clave de la cuenca');
    const legend = document.createElement('ul');
    legend.style.cssText = 'list-style: none; margin: 4px 0 0; padding: 0';
    for (const z of KEY_POINT_ZONES) {
      const li = document.createElement('li');
      li.style.cssText = 'display: flex; gap: 6px; align-items: flex-start';
      const dot = document.createElement('span');
      dot.style.cssText = `flex: none; width: 9px; height: 9px; margin-top: 3px; border-radius: 50%; border: 1.5px solid #fff; box-shadow: 0 0 0 1px #94a3b8; background: ${ZONE_COLORS[z.zona]}`;
      li.append(dot, z.label);
      legend.appendChild(li);
    }
    const crit = document.createElement('li');
    crit.style.cssText = 'display: flex; gap: 6px; align-items: center; margin-top: 2px';
    const ring = document.createElement('span');
    ring.style.cssText = 'flex: none; width: 11px; height: 11px; border-radius: 50%; border: 2px solid #64748b';
    crit.append(ring, 'Anillo: tramo crítico documentado');
    legend.appendChild(crit);
    el.append(label, legend);
    this.el = el;
    return el;
  }

  onRemove(): void {
    this.el?.remove();
  }
}

/** Small «2D / 3D» button next to the zoom/compass control. */
class TerrainToggle implements IControl {
  private el?: HTMLElement;
  constructor(private readonly toggle: () => boolean) {}

  onAdd(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'font: 700 12px/29px inherit; width: 29px';
    const label = (is3d: boolean) => {
      btn.textContent = is3d ? '2D' : '3D';
      btn.title = is3d ? 'Vista 2D (sin relieve)' : 'Vista 3D (relieve)';
      btn.setAttribute('aria-label', btn.title);
    };
    label(true);
    btn.addEventListener('click', () => label(this.toggle()));
    el.appendChild(btn);
    this.el = el;
    return el;
  }

  onRemove(): void {
    this.el?.remove();
  }
}

@Component({
  selector: 'app-satellite-page',
  imports: [DecimalPipe, RouterLink, Pill, SkimmerSurvey],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './satellite-page.html',
  styleUrl: './satellite-page.scss',
})
export class SatellitePage {
  private readonly api = inject(RioApi);
  private readonly filters = inject(FiltersService);
  private readonly live = inject(LiveStreamService);
  private readonly ops = inject(OpsApi);
  protected readonly auth = inject(AuthService);
  private readonly layout = inject(LayoutService);
  /** Skimmer emptying survey (brigade only), opened from the selected station's card. */
  protected readonly surveyOpen = signal(false);

  protected readonly wqi = WQI_META;
  protected readonly levelMeta = CRITICALITY_META;
  protected readonly categories = CATEGORIES;
  protected readonly sensorMeta = SENSOR_STATUS_META;
  protected readonly positionLabel = POSITION_LABEL;
  protected readonly coords = formatCoords;
  protected readonly paramLabel = typeLabel;
  protected readonly wqiText = wqiText;
  protected readonly ago = timeAgo;
  protected readonly positions: SensorPosition[] = ['inlet', 'outlet', 'river'];

  private readonly mapEl = viewChild.required<ElementRef<HTMLElement>>('map');
  private ml!: typeof import('maplibre-gl');
  private map?: MlMap;
  private readonly markers = new Map<string, { marker: Marker; el: HTMLButtonElement }>();
  private reportMarkers: Marker[] = [];
  private is3d = true;
  private readonly ready = signal(false);

  /** All stations are always on the map, regardless of the header station filter (range still applies). */
  protected readonly hotspots = rxResource({
    params: () => ({ from: this.filters.query().from, to: this.filters.query().to, tick: this.filters.tick() }),
    stream: () => this.api.hotspots(),
  });
  protected readonly list = computed<Hotspot[]>(() => valueOrUndefined(this.hotspots) ?? []);

  /** Citizen reports still being attended (layer toggled from the HUD). */
  protected readonly showReports = signal(true);
  // Phone layer menu (floating capsule): each layer can be hidden to see the bare map.
  protected readonly menuOpen = signal(false);
  /** Citizen-reports sheet: collapsed = only the floating button; expanded = most of the screen. */
  protected readonly reportsOpen = signal(false);
  /** Station detail card (phone): collapsed to a pill until tapped. Never open together with the reports sheet. */
  protected readonly stationOpen = signal(false);
  /** Side drawer for a tapped citizen report or key point (the station keeps its own card). */
  protected readonly detail = signal<{ kind: 'report'; r: CitizenReport } | { kind: 'point'; p: Record<string, unknown>; lng: number; lat: number } | null>(null);
  protected readonly zoneLabels = Object.fromEntries(KEY_POINT_ZONES.map((z) => [z.zona, z.label])) as Record<string, string>;
  protected readonly typeMeta = REPORT_TYPE_META;
  protected readonly statusMeta = REPORT_STATUS_META;
  protected readonly visionCat = VISION_CATEGORY_META;
  protected readonly visionSev = VISION_SEVERITY_META;
  protected readonly showStations = signal(true);
  protected readonly showKeyPoints = signal(true);
  protected readonly showBuoys = signal(true);
  protected readonly mode3d = signal(true);
  private static isBuoy = (r: { ai?: { category?: string } | null }) => r.ai?.category === 'boya_defectuosa' || r.ai?.category === 'boya_saturada';
  protected readonly buoyReports = computed(() => this.activeReports().filter(SatellitePage.isBuoy));
  protected readonly otherReports = computed(() => this.activeReports().filter((r) => !SatellitePage.isBuoy(r)));
  private readonly reportsRes = rxResource({ params: () => this.filters.tick(), stream: () => this.ops.citizenReports() });
  protected readonly activeReports = computed(() => (valueOrUndefined(this.reportsRes) ?? []).filter((r) => r.status !== 'resolved' && r.status !== 'rejected'));
  /** Stations ranked by criticality index (computed by the backend from water quality + alerts). */
  protected readonly criticalRes = rxResource({
    params: () => ({ from: this.filters.query().from, to: this.filters.query().to, tick: this.filters.tick() }),
    stream: ({ params }) => this.api.criticalPoints({ from: params.from, to: params.to }),
  });
  protected readonly ranking = computed<CriticalPoint[]>(() => valueOrUndefined(this.criticalRes) ?? []);

  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed(() => this.list().find((h) => h.station_id === this.selectedId()) ?? null);
  protected readonly selectedCritical = computed(() => this.ranking().find((p) => p.station_id === this.selectedId()) ?? null);

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
      void import('maplibre-gl').then(async (ml) => {
        // The worker is copied next to the app by angular.json (assets).
        await ml.setWorkerUrl(new URL('maplibre-gl-worker.mjs', document.baseURI).href);
        if (destroyed) return;
        this.ml = ml;
        const map = new ml.Map({
          container: this.mapEl().nativeElement,
          style: basinStyle(),
          center: toLngLat(BASIN_CENTER),
          zoom: BASIN_ZOOM,
          minZoom: 10,
          maxZoom: 17,
          maxBounds: [SW, NE],
          pitch: PITCH_3D,
          maxPitch: 75,
          attributionControl: { compact: false, customAttribution: '<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a>' },
        });
        map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'bottom-left');
        map.addControl(new TerrainToggle(() => this.toggleTerrain()), 'bottom-left');
        map.addControl(
          new KeyPointsControl((visible) => {
            for (const id of KEY_POINT_LAYERS) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
          }),
          'bottom-right',
        );

        // Hover names for the hydrography (same as the previous sticky tooltips).
        const tip = new ml.Popup({ closeButton: false, closeOnClick: false, className: 'map-tip' });
        for (const layer of ['rivers', 'presa-fill']) {
          map.on('mousemove', layer, (e) => {
            if (map.queryRenderedFeatures(e.point, { layers: ['puntos-clave'] }).length) return; // the key point wins
            map.getCanvas().style.cursor = 'pointer';
            tip.setLngLat(e.lngLat).setText(String(e.features?.[0]?.properties?.['name'] ?? '')).addTo(map);
          });
          map.on('mouseleave', layer, () => {
            map.getCanvas().style.cursor = '';
            tip.remove();
          });
        }
        // Key points: no popups; a tap/click opens the side drawer with the point's detail.
        for (const layer of ['puntos-clave-critico', 'puntos-clave']) {
          map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
          map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
          map.on('click', layer, (e) => {
            const f = e.features?.[0];
            if (!f) return;
            const [lng, lat] = (f.geometry as unknown as { coordinates: number[] }).coordinates;
            this.openPoint(f.properties ?? {}, lng, lat);
          });
        }

        this.map = map;
        const ro = new ResizeObserver(() => map.resize());
        ro.observe(this.mapEl().nativeElement);
        destroyRef.onDestroy(() => ro.disconnect());
        this.ready.set(true);
      });
    });
    // The floating navbar slides away while a drawer/sheet is open and comes back when it closes.
    effect(() => this.layout.navHidden.set(this.stationOpen() || this.detail() !== null || this.reportsOpen()));
    destroyRef.onDestroy(() => {
      this.layout.navHidden.set(false);
      destroyed = true;
      this.map?.remove();
    });

    // Pulsing station markers coloured by WQI category; created once, then updated in place.
    effect(() => {
      if (!this.ready()) return;
      const list = this.list();
      const sel = this.selectedId();
      const seen = new Set<string>();
      for (const h of list) {
        seen.add(h.station_id);
        let pin = this.markers.get(h.station_id);
        if (!pin) {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = 'station-pin';
          el.innerHTML = '<span class="pulse"></span><span class="core"></span>';
          pin = { el, marker: new this.ml.Marker({ element: el }).setLngLat([h.longitude, h.latitude]).addTo(this.map!) };
          this.markers.set(h.station_id, pin);
        }
        const color = WQI_META[h.wqi.category].color;
        const [pulse, core] = Array.from(pin.el.children) as HTMLElement[];
        pulse.style.background = color;
        core.style.background = color;
        core.style.outline = h.station_id === sel ? '3px solid #fff' : '';
        core.style.outlineOffset = '2px';
        pin.el.style.zIndex = h.station_id === sel ? '1' : '';
        pin.el.title = `${h.name} · WQI ${h.wqi.score}`;
        pin.el.setAttribute('aria-label', h.name);
        pin.el.onclick = () => this.select(h);
        pin.marker.setLngLat([h.longitude, h.latitude]);
      }
      for (const [id, pin] of this.markers) {
        if (!seen.has(id)) {
          pin.marker.remove();
          this.markers.delete(id);
        }
      }
    });

    // Citizen reports: small icon pins coloured by type, with a popup (built as DOM, never parsed as HTML).
    effect(() => {
      if (!this.ready()) return;
      const reports = [...(this.showReports() ? this.otherReports() : []), ...(this.showBuoys() ? this.buoyReports() : [])];
      for (const m of this.reportMarkers) m.remove();
      this.reportMarkers = reports.map((r) => {
        const t = REPORT_TYPE_META[r.type];
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'report-pin';
        el.title = `${r.folio} · ${t.label}`;
        el.setAttribute('aria-label', `Reporte ${r.folio}: ${t.label}`);
        const dot = document.createElement('span');
        dot.style.background = t.color;
        const icon = document.createElement('i');
        icon.className = t.icon;
        dot.appendChild(icon);
        el.appendChild(dot);
        el.onclick = () => this.openReport(r);
        return new this.ml.Marker({ element: el }).setLngLat([r.longitude, r.latitude]).addTo(this.map!);
      });
    });

    // Layer menu: stations pins and key-point layers follow their toggles.
    effect(() => {
      if (!this.ready()) return;
      const on = this.showStations();
      for (const pin of this.markers.values()) pin.el.style.display = on ? '' : 'none';
    });
    effect(() => {
      if (!this.ready()) return;
      const v = this.showKeyPoints() ? 'visible' : 'none';
      for (const id of KEY_POINT_LAYERS) this.map?.setLayoutProperty(id, 'visibility', v);
    });

    // Initial selection: header station if any, otherwise the worst station.
    effect(() => {
      const list = this.list();
      if (!list.length || this.selectedId()) return;
      const fromFilter = this.filters.stationId();
      const pick = list.find((h) => h.station_id === fromFilter) ?? [...list].sort((a, b) => a.wqi.score - b.wqi.score)[0];
      this.selectedId.set(pick.station_id);
    });

    // Live pH of the selected station; a new alert can change the criticality ranking.
    this.live.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e.type === 'alert') this.criticalRes.reload();
      if (e.type !== 'reading' || e.data.station_id !== this.selectedId() || e.data.parameter !== 'ph') return;
      this.liveValues.update((m) => ({ ...m, [e.data.position]: { value: e.data.value, ts: e.data.timestamp } }));
    });
  }

  protected select(h: Hotspot): void {
    this.detail.set(null);
    this.stationOpen.set(true);
    this.liveValues.set({});
    this.selectedId.set(h.station_id);
    this.map?.flyTo({ center: [h.longitude, h.latitude], zoom: Math.max(this.map.getZoom(), 13), duration: 800 });
  }

  protected selectById(stationId: string): void {
    const h = this.list().find((x) => x.station_id === stationId);
    if (h) this.select(h);
  }

  /** «Río Atoyac — Parque Lineal / Echeverría» → «Río Atoyac». */
  protected shortName(name: string): string {
    return name.split(' — ')[0];
  }

  protected openReport(r: CitizenReport): void {
    this.closePanels();
    this.detail.set({ kind: 'report', r });
  }

  protected openPoint(p: Record<string, unknown>, lng: number, lat: number): void {
    this.closePanels();
    this.detail.set({ kind: 'point', p, lng, lat });
  }

  private closePanels(): void {
    this.stationOpen.set(false);
    this.reportsOpen.set(false);
    this.menuOpen.set(false);
  }

  protected toggleReports(): void {
    this.reportsOpen.update((v) => !v);
    if (this.reportsOpen()) {
      this.menuOpen.set(false);
      this.stationOpen.set(false);
      this.detail.set(null);
    }
  }

  /** Centre the map on a report and fold the sheet so it can be seen. */
  protected focusReport(r: CitizenReport): void {
    this.reportsOpen.set(false);
    this.map?.flyTo({ center: [r.longitude, r.latitude], zoom: Math.max(this.map.getZoom(), 15), duration: 800 });
  }

  protected toggleStation(): void {
    this.stationOpen.update((v) => !v);
    if (this.stationOpen()) {
      this.reportsOpen.set(false);
      this.menuOpen.set(false);
      this.detail.set(null);
    }
  }

  /** Phone: fold the card back into its pill; desktop: deselect the station. */
  protected closeStation(): void {
    if (window.matchMedia('(max-width: 767px), (pointer: coarse) and (max-width: 1400px)').matches) this.stationOpen.set(false);
    else this.selectedId.set(null);
  }

  protected deselect(): void {
    this.selectedId.set(null);
    this.stationOpen.set(false);
  }

  protected pickStation(id: string): void {
    this.selectById(id);
    this.menuOpen.set(false);
    this.stationOpen.set(false);
  }

  protected switchMode(): void {
    this.mode3d.set(this.toggleTerrain());
  }

  protected resetView(): void {
    this.map?.flyTo({ center: toLngLat(BASIN_CENTER), zoom: BASIN_ZOOM, bearing: 0, pitch: this.is3d ? PITCH_3D : 0, duration: 800 });
  }

  /** 3D ↔ 2D: terrain on/off and pitch 50° ↔ 0°. Returns the new mode (true = 3D). */
  private toggleTerrain(): boolean {
    const map = this.map;
    if (!map) return this.is3d;
    this.is3d = !this.is3d;
    map.setTerrain(this.is3d ? TERRAIN : null);
    map.easeTo({ pitch: this.is3d ? PITCH_3D : 0, duration: 600 });
    return this.is3d;
  }
}
