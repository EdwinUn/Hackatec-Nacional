import type { Group, Material, Mesh, Object3D, Texture, Vector3 } from 'three';
import type { BuoyDesign } from '../../../core/models/buoy.models';
import { createBoyaRioMonitor } from './buoy-factory';

/** Per-frame inputs to the model's simulation (current, water level, what to draw). */
export interface BuoySimInput {
  /** River current in m/s (the artifact defaults to 0.9). */
  current?: number;
  /** World Y of the water surface in meters. */
  waterLevel?: number;
  /** Current direction in radians; the vane points the buoy into it. */
  flowAngle?: number;
  showFlow?: boolean;
  showEnergy?: boolean;
  showFish?: boolean;
}

/** Subset of the simulated telemetry the viewer uses. */
export interface BuoyTelemetry {
  bodyY: number;
  wheelRpm: number;
  centrifugeRpm: number;
  powerGenW: number;
  batteryPct: number;
  [key: string]: unknown;
}

/** Typed API of the object returned by `createBoyaRioMonitor` (artifact v7). */
export interface BuoyModel {
  diseno: BuoyDesign;
  root: Group;
  body: Group;
  anchors: Record<string, Object3D>;
  update(dt: number, input?: BuoySimInput): void;
  telemetria(): BuoyTelemetry;
  setRayosX(on: boolean): void;
  localAMundo(x: number, y: number, z: number): Vector3;
}

/**
 * Builds the procedural Río Monitor buoy model.
 * Scale is in meters with Y up; with the current at 0° the river flows toward -X.
 */
export function createBuoyModel(opts: { diseno: BuoyDesign; bedY: number }): BuoyModel {
  return createBoyaRioMonitor(opts) as unknown as BuoyModel;
}

/** Frees every geometry, material and texture under `root` (for when the viewer is destroyed). */
export function disposeObject(root: Object3D): void {
  const materials = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    mesh.geometry?.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) m.forEach((x) => materials.add(x));
    else if (m) materials.add(m);
  });
  for (const m of materials) {
    for (const value of Object.values(m)) if ((value as Texture | null)?.isTexture) (value as Texture).dispose();
    m.dispose();
  }
}
