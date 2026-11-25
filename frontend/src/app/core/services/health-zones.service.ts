import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { SILENT_ERRORS } from '../interceptors/api-error.interceptor';
import { HealthZone, HealthZonesGeoJson, School, SchoolsGeoJson } from '../models/health-zones.models';

const ZONES_URL = 'data/zonas_afectacion_salud.geojson';
const SCHOOLS_URL = 'data/escuelas_zonas_salud.geojson';

/**
 * Documented health-impact zones along the river and the schools inside them.
 * Static files in `public/` (no endpoint): loaded once, on first use, and shared by the map and the panels.
 */
@Injectable({ providedIn: 'root' })
export class HealthZonesService {
  private readonly http = inject(HttpClient);

  private readonly res = rxResource({
    stream: () => {
      const get = <T>(path: string) =>
        this.http.get<T>(new URL(path, document.baseURI).href, { context: new HttpContext().set(SILENT_ERRORS, true) });
      return forkJoin({ zones: get<HealthZonesGeoJson>(ZONES_URL), schools: get<SchoolsGeoJson>(SCHOOLS_URL) });
    },
  });

  readonly error = computed(() => this.res.error() != null);
  /** Raw GeoJSON for the map sources (`null` until loaded). */
  readonly zonesGeoJson = computed(() => (this.res.hasValue() ? this.res.value().zones : null));
  readonly schoolsGeoJson = computed(() => (this.res.hasValue() ? this.res.value().schools : null));

  readonly zones = computed<HealthZone[]>(() => {
    const features = this.zonesGeoJson()?.features ?? [];
    const centers = new Map(features.filter((f) => f.properties.tipo === 'etiqueta').map((f) => [f.properties.id, f.geometry.coordinates as [number, number]]));
    return features
      .map((f) => f.properties)
      .filter((p): p is HealthZone & { tipo: 'zona' } => p.tipo === 'zona')
      .map((p) => ({ ...p, center: centers.get(p.id) }))
      .sort((a, b) => a.orden - b.orden);
  });
  readonly schools = computed<School[]>(() =>
    (this.schoolsGeoJson()?.features ?? []).map((f) => ({ ...f.properties, coordinates: f.geometry.coordinates })),
  );

  private readonly zoneIndex = computed(() => new Map(this.zones().map((z) => [z.id, z])));
  private readonly schoolIndex = computed(() => new Map(this.schools().map((s) => [s.id, s])));
  private readonly byZone = computed(() => {
    const m = new Map<string, School[]>();
    for (const s of this.schools()) {
      const list = m.get(s.zona_id);
      if (list) list.push(s);
      else m.set(s.zona_id, [s]);
    }
    return m;
  });

  zone(id: string): HealthZone | undefined {
    return this.zoneIndex().get(id);
  }

  school(id: string): School | undefined {
    return this.schoolIndex().get(id);
  }

  schoolsIn(zoneId: string): School[] {
    return this.byZone().get(zoneId) ?? [];
  }
}
