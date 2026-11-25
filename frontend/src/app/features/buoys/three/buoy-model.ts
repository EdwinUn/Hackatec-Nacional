import type { Group, Material, Mesh, Object3D, Texture, Vector3 } from 'three';
import type { BuoyDesign } from '../../../core/models/buoy.models';
import type { DeviceTelemetryDto } from '../../../core/models/telemetry.models';
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
  powerGenW: number;
  batteryPct: number;
  pumpOn: boolean;
  brake: boolean;
  [key: string]: unknown;
}

/** Alert beacon (red LED, GPIO2) and send LED (green, GPIO25) as the model shows them. */
export interface BuoyComms {
  senal: boolean;
  alerta: boolean;
  guardadas: number;
  enviadas: number;
  enviando: boolean;
  [key: string]: unknown;
}

/** Typed API of the object returned by `createBoyaRioMonitor` (artifact v8 + beacon, hose and shore tank). */
export interface BuoyModel {
  diseno: BuoyDesign;
  root: Group;
  body: Group;
  anchors: Record<string, Object3D>;
  update(dt: number, input?: BuoySimInput): void;
  telemetria(): BuoyTelemetry;
  /** Shows the ESP32's packet (Wokwi); `null` = the design's initial state. */
  aplicarTelemetria(packet: DeviceTelemetryDto | null): void;
  /** State of the alert beacon and the 4G sends (in the app it follows the packet; see the factory). */
  comunicacion(): BuoyComms;
  setRayosX(on: boolean): void;
  localAMundo(x: number, y: number, z: number): Vector3;
}

/**
 * Builds the procedural Río Monitor buoy model (v8: same electronics as `firmware/boya-rm01`).
 * Scale is in meters with Y up; with the current at 0° the river flows toward -X.
 */
export function createBuoyModel(opts: { diseno: BuoyDesign; bedY: number }): BuoyModel {
  // congelado: the battery, filters and liters only change with the ESP32's packets, so the scene
  // never shows a state that Wokwi did not send.
  return createBoyaRioMonitor({ ...opts, congelado: true }) as unknown as BuoyModel;
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
