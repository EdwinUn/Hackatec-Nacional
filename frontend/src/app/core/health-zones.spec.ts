import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RIVERS } from '../features/satellite/basin';
import { distanceToPolylinesM, formatApproxDistance, LatLng } from '../shared/utils/geo.util';
import { HealthZonesGeoJson, SchoolsGeoJson } from './models/health-zones.models';
import { HealthZonesService } from './services/health-zones.service';

const ZONES: HealthZonesGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        tipo: 'zona', id: 'z2', orden: 2, nombre: 'Zona 2', estado: 'Puebla', municipios: [], comunidades: [], nivel: 'critico',
        evidencia: 'documentada', exposiciones: ['riego_cultivos'], efectos_salud: [], descripcion: '', fuentes: [], num_escuelas: 1, trazo: 'aproximado',
      },
      geometry: { type: 'Polygon', coordinates: [] },
    },
    {
      type: 'Feature',
      properties: {
        tipo: 'zona', id: 'z1', orden: 1, nombre: 'Zona 1', estado: 'Tlaxcala', municipios: [], comunidades: [], nivel: 'atencion',
        evidencia: 'parcial', exposiciones: [], efectos_salud: [], descripcion: '', fuentes: [], num_escuelas: 0, trazo: 'aproximado',
      },
      geometry: { type: 'Polygon', coordinates: [] },
    },
    { type: 'Feature', properties: { tipo: 'etiqueta', id: 'z2', nombre: 'Zona 2', nivel: 'critico' }, geometry: { type: 'Point', coordinates: [-98.4, 19.25] } },
  ],
};
const SCHOOLS: SchoolsGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: '42', nombre: 'Primaria X', nivel: 'Primaria', sostenimiento: 'Público', municipio: 'M', localidad: 'L', zona_id: 'z2' },
      geometry: { type: 'Point', coordinates: [-98.41, 19.24] },
    },
  ],
};

describe('distanceToPolylinesM', () => {
  const line: LatLng[] = [[19.0, -98.2], [19.0, -98.1]];

  it('is ~0 on the line and grows perpendicular to it', () => {
    expect(distanceToPolylinesM([19.0, -98.15], [line])).toBeLessThan(1);
    // 0.01° of latitude ≈ 1.1 km
    expect(distanceToPolylinesM([19.01, -98.15], [line])).toBeCloseTo(1105, -1);
  });

  it('measures to the nearest end beyond the segment', () => {
    expect(distanceToPolylinesM([19.0, -98.25], [line])).toBeCloseTo(0.05 * 111_320 * Math.cos((19 * Math.PI) / 180), -1);
  });

  it('a CONAGUA site on the Atoyac is next to the traced river; Cholula is kilometres away', () => {
    const rivers = RIVERS.map((r) => r.path);
    expect(distanceToPolylinesM([19.101083, -98.237444], rivers)).toBeLessThan(100); // «Atoyac, La Autopista»
    expect(distanceToPolylinesM([19.0633, -98.3064], rivers)).toBeGreaterThan(4000); // San Pedro Cholula
  });

  it('returns Infinity without segments, shown as a dash', () => {
    expect(distanceToPolylinesM([19, -98], [])).toBe(Infinity);
    expect(formatApproxDistance(Infinity)).toBe('—');
    expect(formatApproxDistance(347)).toBe('~350 m');
    expect(formatApproxDistance(1430)).toBe('~1.4 km');
  });
});

describe('HealthZonesService', () => {
  it('loads both layers once, sorts zones and indexes schools by zone', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(HealthZonesService);
    const http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    http.expectOne((r) => r.url.endsWith('data/zonas_afectacion_salud.geojson')).flush(ZONES);
    http.expectOne((r) => r.url.endsWith('data/escuelas_zonas_salud.geojson')).flush(SCHOOLS);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(service.zones().map((z) => z.id)).toEqual(['z1', 'z2']);
    expect(service.zone('z2')?.center).toEqual([-98.4, 19.25]);
    expect(service.zone('z1')?.center).toBeUndefined();
    expect(service.schoolsIn('z2').map((s) => s.nombre)).toEqual(['Primaria X']);
    expect(service.school('42')?.coordinates).toEqual([-98.41, 19.24]);
    expect(service.schoolsIn('z1')).toEqual([]);
    http.verify();
  });
});
