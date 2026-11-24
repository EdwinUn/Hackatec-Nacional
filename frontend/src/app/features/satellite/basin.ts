/** `[lat, lng]` pairs; MapLibre expects `[lng, lat]` (see `toLngLat`). */
export type LatLngTuple = [number, number];

export function toLngLat([lat, lng]: LatLngTuple): [number, number] {
  return [lng, lat];
}

/** Focus of the view: Cuenca del Alto Atoyac (Puebla). */
export const BASIN_CENTER: LatLngTuple = [19.0414, -98.2063];
export const BASIN_ZOOM = 11;
/** The map cannot be panned away from the basin (Sierra Nevada ↔ Valsequillo, up to the Zahuapan headwaters). */
export const BASIN_BOUNDS: [LatLngTuple, LatLngTuple] = [
  [18.8, -98.75],
  [19.7, -97.95],
];

export interface River {
  name: string;
  /** Line weight: main stems are drawn wider than tributaries. */
  width: number;
  path: LatLngTuple[];
}

/**
 * Drainage network of the Alto Atoyac basin, flowing into the Valsequillo reservoir.
 * Approximate courses traced from the basin map (CONAGUA, zones 1–4) and pinned to the official
 * CONAGUA monitoring sites on each river (ids in comments). Illustrative, not survey-grade.
 */
export const RIVERS: River[] = [
  {
    // Sierra Nevada (Río Frío) → A01…A13 → enters the reservoir at P01.
    name: 'Río Atoyac',
    width: 4,
    path: [
      [19.36, -98.66], [19.372, -98.6], [19.368, -98.515], [19.345, -98.49], [19.323, -98.461], [19.286, -98.426],
      [19.265, -98.39], [19.253, -98.359], [19.228, -98.345], [19.201, -98.332], [19.18, -98.3], [19.165, -98.265],
      [19.158, -98.242], [19.158, -98.238], [19.156, -98.237], [19.128, -98.236], [19.101, -98.237], [19.094, -98.239],
      [19.06, -98.236], [19.02, -98.232], [18.99, -98.25], [18.968, -98.277], [18.953, -98.263], [18.935, -98.23],
      [18.924, -98.192],
    ],
  },
  {
    // Tlaxco (Z01) → Presa de Atlangatepec (Z02) → Tlaxcala (Z03) → Totolac (Z04) → confluence (Z05 → A07).
    name: 'Río Zahuapan',
    width: 3.5,
    path: [
      [19.644, -98.057], [19.62, -98.11], [19.58, -98.16], [19.556, -98.201], [19.5, -98.21], [19.44, -98.205],
      [19.38, -98.2], [19.334, -98.209], [19.3, -98.25], [19.271, -98.3], [19.22, -98.285], [19.18, -98.26],
      [19.159, -98.239], [19.158, -98.238],
    ],
  },
  {
    // Sierra Nevada → X03 → joins the Atoyac at A02.
    name: 'Río Atotonilco',
    width: 2.5,
    path: [[19.3, -98.62], [19.31, -98.56], [19.32, -98.5], [19.326, -98.458], [19.324, -98.46]],
  },
  {
    // North slope of the Iztaccíhuatl → Huejotzingo → X01 → joins the Atoyac between A04 and A05.
    name: 'Río Xochiac',
    width: 2.5,
    path: [[19.17, -98.62], [19.175, -98.55], [19.19, -98.48], [19.2, -98.42], [19.215, -98.385], [19.232, -98.348]],
  },
  {
    // East of the city of Puebla → S01 → joins the Atoyac at A11.
    name: 'Río San Francisco',
    width: 2.5,
    path: [[19.09, -98.16], [19.06, -98.185], [19.04, -98.2], [19.03, -98.212], [19.022, -98.226], [19.02, -98.232]],
  },
  {
    // Slopes of La Malinche → L01 → L02 → L03 → flows into the reservoir.
    name: 'Río Alseseca',
    width: 3,
    path: [
      [19.13, -98.11], [19.08, -98.14], [19.055, -98.155], [19.039, -98.169], [19.0, -98.178], [18.97, -98.19],
      [18.951, -98.186], [18.94, -98.18],
    ],
  },
];

/** Outline of the Valsequillo reservoir (Presa Manuel Ávila Camacho), covering CONAGUA sites P01–P03. */
export const PRESA_VALSEQUILLO: LatLngTuple[] = [
  [18.938, -98.205], [18.926, -98.19], [18.915, -98.17], [18.903, -98.15], [18.898, -98.125], [18.906, -98.103],
  [18.918, -98.098], [18.922, -98.122], [18.93, -98.148], [18.941, -98.172], [18.946, -98.195],
];

export const TILES = {
  imagery: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  /** Public elevation tiles (no API key), Terrarium encoding. */
  terrain: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
};
export const ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics';
export const TERRAIN_ATTRIBUTION = 'Relieve: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles</a> (Mapzen, AWS Open Data)';
