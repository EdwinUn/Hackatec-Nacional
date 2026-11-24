import type { LatLngBoundsLiteral, LatLngTuple } from 'leaflet';

/** Focus of the view: Cuenca del Alto Atoyac (Puebla). */
export const BASIN_CENTER: LatLngTuple = [19.0414, -98.2063];
export const BASIN_ZOOM = 11;
/** The map cannot be panned away from the basin (Texmelucan ↔ Valsequillo corridor). */
export const BASIN_BOUNDS: LatLngBoundsLiteral = [
  [18.8, -98.56],
  [19.4, -97.95],
];

/** Approximate course of Río Atoyac (north-west → south-east). Illustrative, not survey-grade. */
export const RIO_ATOYAC: LatLngTuple[] = [
  [19.29, -98.455], [19.256, -98.418], [19.21, -98.405], [19.17, -98.387], [19.13, -98.34], [19.105, -98.295],
  [19.076, -98.268], [19.059, -98.253], [19.03, -98.235], [19.0, -98.215], [18.978, -98.19], [18.96, -98.17],
];

/** Approximate course of Río Alseseca. */
export const RIO_ALSESECA: LatLngTuple[] = [
  [19.098, -98.125], [19.075, -98.138], [19.05, -98.152], [19.033, -98.165], [19.005, -98.17], [18.98, -98.168],
];

/** Rough outline of the Valsequillo reservoir (Presa Manuel Ávila Camacho). */
export const PRESA_VALSEQUILLO: LatLngTuple[] = [
  [18.985, -98.17], [18.965, -98.135], [18.935, -98.13], [18.915, -98.15], [18.93, -98.18], [18.96, -98.19],
];

export const TILES = {
  imagery: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  hillshade: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
  labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
};
export const ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics · Relieve © Esri';
