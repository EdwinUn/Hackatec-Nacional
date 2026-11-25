// @ts-nocheck
// =====================================================================
//  Río Monitor buoy · 3D core ported from the design artifact
//  ("Boya Río Monitor: la misma electrónica que Wokwi", v8). Untyped on purpose:
//  procedural geometry copied almost verbatim so it stays easy to resync with
//  the artifact. The typed API lives in `buoy-model.ts`.
//  Changes vs the artifact:
//   - ES module `three` import instead of the global; `colorSpace` instead of
//     the removed `sRGBEncoding` (three r152+).
//   - `aplicarTelemetria(packet)`: the ESP32's packet (Wokwi) drives the model
//     (battery, pump, brake, generator, basket, tilt, liters, and the water's
//     color from the measured turbidity in vs out).
//   - `opts.congelado`: battery, filter saturation and liters don't evolve on
//     their own (the app uses it, so the scene only shows what Wokwi sent);
//     the artifact's accelerated simulation (1 s = 10 min) stays available.
//   - Starts at 80 % battery (pump on), the same initial state as
//     firmware/boya-rm01/diagram.json.
//   - SENSORES_BOYA lists the firmware's JSON keys instead of text sensor_ids
//     (the backend assigns UUIDs; see API.md).
// =====================================================================
import * as THREE from 'three';

export const BOYA_CFG = {
  ringR: 0.46, ringTube: 0.06, ringTopY: 0.0, ringBotY: -0.24,
  colR: 0.2, deck: 0.04, colTop: -0.14, colBottom: -0.4,
  bowl: [[0.2, -0.41], [0.2, -0.44], [0.12, -0.48], [0.05, -0.5]],   // cámara de salida con las sondas de salida
  nozzleBottom: -0.55,
  wheel: { rIn: 0.24, rOut: 0.38, yTop: -0.05, yBot: -0.19, blades: 10, cp: 0.2, tsr: 0.8, gapArea: 0.091 },
  box: { w: 0.2, d: 0.15, h: 0.075 },                                  // caja estanca (frasco/tupper) ≈ 200×150×75 mm
  duct: { a: 92, r: 0.16 },
  cut: [70, 115],
  bedClearance: 0.12, freeboard: 0.0,
  moor: { angles: [35, -35, 180], ringR: 0.34, anchorR: 3.0, maxDepth: 3.0, slack: 1.08, cageR: 0.3, cageBottom: -0.56, dragCd: 1.0, dragArea: 0.62, chainM: 1.5 },
  // ---- Mismos valores que el firmware (sketch.ino) ----
  battery: { wh: 40, vMin: 9.0, vMax: 12.6 },                          // 6 × 18650 recicladas en 3S2P
  genEff: 0.7, cutIn: 0.35, genVPerMs: 15.5, genVMax: 36,
  brake: { genOn: 26, genOff: 22, batOn: 12.5, batOff: 12.3 }, maxChargeW: 25,
  loads: { base: 1.0, pump: 5.0 },                                     // W: ESP32+módem+sensores · bomba 12 V
  cycle: { stopBelow: 0.35, startAbove: 0.75 },
  pumpLpm: 2.5, pumpA: 0.4,
  sonar: { mast: 0.3, distEmpty: 44, distFull: 30 },
  basket: { x0: -0.62, len: 0.8, halfW: 0.36, top: 0.14, bottom: -0.25, lip: -0.04, holeX: -1.17, holeR: 0.07, capKg: 4 },
  vane: { x0: -1.48, len: 0.5, yTop: -0.04, yBot: -0.4 },
  timeScale: 600, satSpeed: 0.006
};

// Cuatro etapas, sin sensor propio: se sabe que se saturan por lo que miden las sondas de salida.
export const ETAPAS_FILTRO = [
  { key: 'sed', nombre: 'Arena y grava del río', contaminante: 'Sólidos suspendidos y sedimento', indicador: 'La turbidez de salida se acerca a la de entrada', color: 0xcbb994, base: 0.7, rate: 1.0, sat0: 0.3, tex: ['#cbb994', '#a8956d', '#e0d3b0', '#8a7b5c', '#d9c9a0'] },
  { key: 'gac', nombre: 'Carbón activado', contaminante: 'Químicos orgánicos, color y olor', indicador: 'Turbidez y color de salida suben (cambio mensual)', color: 0x2a2d30, base: 0.6, rate: 0.9, sat0: 0.45, tex: ['#141516', '#2b2e31', '#3b3f43', '#0c0c0d'] },
  { key: 'zeo', nombre: 'Zeolita', contaminante: 'Parte de metales y amonio', indicador: 'No se mide: se regenera o cambia cada mes', color: 0xd8c7a6, base: 0.5, rate: 0.7, sat0: 0.4, tex: ['#d8c7a6', '#bfb39a', '#e8dcc0', '#a89a7f'] },
  { key: 'cal', nombre: 'Calcita', contaminante: 'Acidez: sube el pH del agua ácida hacia 7', indicador: 'Con agua ácida, el pH de salida deja de subir', color: 0xefece4, base: 0.6, rate: 0.5, sat0: 0.2, tex: ['#f3f1ea', '#e0dbcf', '#cfc8b8', '#ffffff'] }
];

// Los 14 datos de la boya, la clave con la que los manda el firmware (sketch.ino) y la pieza que los mide.
export const SENSORES_BOYA = [
  { key: 'ph_in', firmware: 'ph', nombre: 'pH entrada', unidad: '', dec: 2, modulo: 'PH-4502C · ADS1115 #1 A0', color: 0x2f6fd6 },
  { key: 'ph_out', firmware: 'ph_out', nombre: 'pH salida', unidad: '', dec: 2, modulo: 'PH-4502C · ADS1115 #1 A1', color: 0x2f6fd6 },
  { key: 'tds', firmware: 'tds_ppm', nombre: 'TDS', unidad: 'ppm', dec: 0, modulo: 'TDS Meter V1.0 · ADS1115 #1 A2', color: 0x12a37f },
  { key: 'turb_in', firmware: 'turb_in_ntu', nombre: 'Turbidez entrada', unidad: 'NTU aprox.', dec: 0, modulo: 'Turbidez genérico · ADS1115 #1 A3', color: 0xf0f0f0 },
  { key: 'turb_out', firmware: 'turb_out_ntu', nombre: 'Turbidez salida', unidad: 'NTU aprox.', dec: 0, modulo: 'Turbidez genérico · ADS1115 #2 A0', color: 0xf0f0f0 },
  { key: 'temp', firmware: 'temp_c', nombre: 'Temperatura', unidad: '°C', dec: 1, modulo: 'DS18B20 · GPIO5', color: 0xd9dde0 },
  { key: 'caudal_lpm', firmware: 'caudal_lpm', nombre: 'Caudal', unidad: 'L/min', dec: 2, modulo: 'YF-S401 · GPIO35', color: 0x35d0e0 },
  { key: 'litros', firmware: 'litros_total', nombre: 'Agua procesada', unidad: 'L', dec: 0, modulo: 'Suma del caudal', color: 0x35d0e0 },
  { key: 'cesta_pct', firmware: 'cesta_pct', nombre: 'Cesta llena', unidad: '%', dec: 0, modulo: 'JSN-SR04T · GPIO15/34', color: 0xe8742c },
  { key: 'bat_pct', firmware: 'bat_pct', nombre: 'Batería', unidad: '%', dec: 0, modulo: 'Divisor 100k/33k · ADS1115 #2 A1', color: 0x34d17a },
  { key: 'gen_v', firmware: 'gen_v', nombre: 'Voltaje del generador', unidad: 'V', dec: 1, modulo: 'Divisor 100k/10k · ADS1115 #2 A2', color: 0xf2a516 },
  { key: 'bomba_a', firmware: 'bomba_a', nombre: 'Corriente de la bomba', unidad: 'A', dec: 2, modulo: 'ACS712 5 A · ADS1115 #2 A3', color: 0xc0392b },
  { key: 'bomba_on', firmware: 'bomba', nombre: 'Bomba encendida', unidad: '', dec: 0, modulo: 'MOSFET D4184 · GPIO27', color: 0x2f6fd6 },
  { key: 'inclinacion', firmware: 'inclinacion_deg', nombre: 'Inclinación', unidad: '°', dec: 1, modulo: 'MPU6050 · I2C 0x68', color: 0x5b3a9a }
];

export function createBoyaRioMonitor(opts = {}) {
  const C = BOYA_CFG, W = C.wheel, B = C.basket, MO = C.moor, BX = C.box, VN = C.vane;
  const bedY = opts.bedY ?? -3.2, D = 'anclada';
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), deg = d => d * Math.PI / 180;
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.1, ...o });
  const glass = (c, op) => new THREE.MeshPhysicalMaterial({ color: c, transparent: true, opacity: op, roughness: 0.1, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
  const mesh = (g, m, p, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); p.add(o); return o; };
  const box = (w, h, d, m, p, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), m, p, x, y, z);
  const cyl = (r, h, m, p, x, y, z, seg = 14) => mesh(new THREE.CylinderGeometry(r, r, h, seg), m, p, x, y, z);
  const torusH = (r, t, m, p, y, seg = 64) => { const o = mesh(new THREE.TorusGeometry(r, t, 10, seg), m, p, 0, y, 0); o.rotation.x = Math.PI / 2; return o; };
  const spoke = (ri, ro, a, y, m, p, th = 0.014) => { const s = mesh(new THREE.BoxGeometry(ro - ri, th, th), m, p, Math.cos(a) * (ro + ri) / 2, y, Math.sin(a) * (ro + ri) / 2); s.rotation.y = -a; return s; };
  const polar = (aDeg, r, y) => V3(Math.cos(deg(aDeg)) * r, y, Math.sin(deg(aDeg)) * r);
  const lerpProfile = (prof, y) => { for (let i = 0; i < prof.length - 1; i++) { const [r0, y0] = prof[i], [r1, y1] = prof[i + 1]; if (y <= y0 && y >= y1) return y0 === y1 ? r0 : r0 + (r1 - r0) * (y - y0) / (y1 - y0); } return prof[prof.length - 1][0]; };
  const cable = (pts, r, color, p, seg = 40) => { const c = new THREE.CatmullRomCurve3(pts.map(q => q.isVector3 ? q : V3(...q))); mesh(new THREE.TubeGeometry(c, seg, r, 6, false), M(color, { roughness: 0.6 }), p); return c; };

  const texCache = {};
  function mediaTex(spec, key) {
    if (!spec || typeof document === 'undefined') return null;
    if (texCache[key]) return texCache[key];
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
    let seed = key.length * 97 + key.charCodeAt(0); const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.fillStyle = spec[0]; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1100; i++) { g.fillStyle = spec[Math.floor(rnd() * spec.length)]; g.beginPath(); g.arc(rnd() * 128, rnd() * 128, 0.8 + rnd() * 2.2, 0, Math.PI * 2); g.fill(); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    return (texCache[key] = t);
  }

  const root = new THREE.Group(); root.name = 'BoyaRioMonitorV8';
  const body = new THREE.Group(); body.name = 'cuerpo'; root.add(body);
  const mount = new THREE.Group(); mount.name = 'anillo-giratorio'; root.add(mount);
  const anchors = {};
  const anchor = (name, parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); anchors[name] = o; return o; };

  const floatMat = M(0xdbe5ea, { roughness: 0.35, transparent: true, opacity: 1 }), bandMat = M(0x8fa3ab);
  const steel = M(0x5c6870, { metalness: 0.6, roughness: 0.35 }), inox = M(0xc9ced2, { metalness: 0.85, roughness: 0.25 });
  const rimMat = M(0x3d4a52, { metalness: 0.4 }), dark = M(0x2b3238, { metalness: 0.4, roughness: 0.35 });
  const black = M(0x18191a, { roughness: 0.6 }), red = M(0xc0392b), brass = M(0xc9a24a, { metalness: 0.8, roughness: 0.3 });
  const alu = M(0xd4b24c, { metalness: 0.75, roughness: 0.35 });
  const pcbBlue = M(0x1f5fbf, { roughness: 0.5 }), pcbBlack = M(0x1b1d1f, { roughness: 0.5 }), pcbGreen = M(0x1f7a3a), pcbPurple = M(0x5b3a9a), pcbRed = M(0xb3261e), pcbProto = M(0xc9a35a);
  const gland = (p, x, y, z, dir = -1) => { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.004, 6), black, g, 0, dir * 0.002, 0); cyl(0.006, 0.01, black, g, 0, dir * 0.009, 0, 10); return g; };

  // ---------- Dos anillos de botellas PET con hueco ----------
  [C.ringTopY, C.ringBotY].forEach(y => {
    torusH(C.ringR, C.ringTube, floatMat, body, y, 64);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; const b = mesh(new THREE.TorusGeometry(C.ringTube + 0.003, 0.005, 6, 18), bandMat, body, Math.cos(a) * C.ringR, y, Math.sin(a) * C.ringR); b.rotation.y = -a; }
  });
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; cyl(0.012, C.ringTopY - C.ringBotY, steel, body, Math.cos(a) * C.ringR, (C.ringTopY + C.ringBotY) / 2, Math.sin(a) * C.ringR, 8); }
  for (let i = 0; i < 6; i++) spoke(C.colR, C.ringR - C.ringTube + 0.01, i / 6 * Math.PI * 2 + 0.26, C.deck - 0.01, steel, body, 0.016);
  const gapTop = C.ringTopY - C.ringTube, gapBot = C.ringBotY + C.ringTube, gapH = gapTop - gapBot, nBars = 120;
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.005, gapH, 0.005), M(0x7f9aa3, { metalness: 0.5 }), nBars), dm = new THREE.Object3D();
  for (let i = 0; i < nBars; i++) { const a = i / nBars * Math.PI * 2; dm.position.set(Math.cos(a) * C.ringR, (gapTop + gapBot) / 2, Math.sin(a) * C.ringR); dm.updateMatrix(); bars.setMatrixAt(i, dm.matrix); }
  body.add(bars);
  [gapTop, gapBot].forEach(y => torusH(C.ringR, 0.005, steel, body, y, 96));
  anchor('rejilla', body, Math.cos(0.6) * C.ringR, (gapTop + gapBot) / 2, Math.sin(0.6) * C.ringR + 0.02);

  // ---------- Molino (aspas de PVC partido) apoyado en 3 rodillos ----------
  const wheel = new THREE.Group(); body.add(wheel);
  const bladeMat = M(0xe9eef0, { side: THREE.DoubleSide, roughness: 0.45 }), wh = W.yTop - W.yBot, rMid = (W.rIn + W.rOut) / 2;
  for (let i = 0; i < W.blades; i++) { const a = i / W.blades * Math.PI * 2; const b = mesh(new THREE.CylinderGeometry(0.04, 0.04, wh - 0.01, 12, 1, true, 0, Math.PI), bladeMat, wheel, Math.cos(a) * rMid, (W.yTop + W.yBot) / 2, Math.sin(a) * rMid); b.rotation.y = Math.PI / 2 - a; }
  [W.yTop, W.yBot].forEach(y => { torusH(W.rOut, 0.006, steel, wheel, y); torusH(W.rIn, 0.006, steel, wheel, y); });
  [40, 160, 280].forEach(a => { const p = polar(a, W.rOut + 0.013, W.yBot); const r = cyl(0.012, 0.012, black, body, p.x, p.y, p.z, 12); r.rotation.x = Math.PI / 2; spoke(W.rOut + 0.02, C.ringR - C.ringTube, deg(a), W.yBot, steel, body, 0.01); });
  anchor('molino', body, Math.cos(1.95) * C.ringR, W.yBot + 0.02, Math.sin(1.95) * C.ringR);

  // Generador: motor DC RS-775 reciclado, con piñón sobre el aro interior
  const gen = new THREE.Group(); gen.position.set(0.275, 0.0, 0); body.add(gen);
  cyl(0.021, 0.066, inox, gen, 0, 0.0, 0, 20); cyl(0.021, 0.008, black, gen, 0, 0.037, 0, 20);
  box(0.003, 0.008, 0.006, brass, gen, 0.008, 0.045, 0); box(0.003, 0.008, 0.006, brass, gen, -0.008, 0.045, 0);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; box(0.002, 0.04, 0.004, steel, gen, Math.cos(a) * 0.0215, 0, Math.sin(a) * 0.0215).rotation.y = -a; }
  const pinion = cyl(0.018, 0.015, brass, body, 0.258, W.yTop + 0.004, 0, 16);
  cable([[0.283, 0.048, 0.002], [0.27, 0.075, 0.02], [0.2, 0.085, 0.03], [0.1, C.deck + 0.03, 0.02]], 0.0022, 0xb3261e, body);
  cable([[0.267, 0.048, -0.002], [0.262, 0.075, 0.012], [0.2, 0.082, 0.022], [0.1, C.deck + 0.028, 0.012]], 0.0022, 0x161616, body);
  anchor('generador', body, 0.3, 0.03, 0.03);

  // ---------- Cuerpo central (cubeta/tambo) con corte para ver el interior ----------
  const shellMat = glass(0xcfeef4, 0.14);
  mesh(new THREE.CylinderGeometry(C.colR, C.colR, C.deck - C.colBottom, 48, 1, true), shellMat, body, 0, (C.deck + C.colBottom) / 2, 0);
  torusH(C.colR, 0.008, rimMat, body, C.deck);
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; const w = box(0.006, 0.035, 0.04, M(0x7f9aa3, { metalness: 0.5, wireframe: true }), body, Math.cos(a) * C.colR, -0.025, Math.sin(a) * C.colR); w.rotation.y = -a; }
  anchor('toma', body, Math.cos(0.9) * C.colR, -0.025, Math.sin(0.9) * C.colR);

  // Sondas reales
  function probe(kind, p, x, y, z) {   // y = parte superior de la sonda
    const g = new THREE.Group(); g.position.set(x, y, z); p.add(g);
    if (kind === 'ph') {                // electrodo E-201-C
      cyl(0.006, 0.1, black, g, 0, -0.05, 0, 14); cyl(0.0062, 0.012, M(0xd7dbe0), g, 0, -0.02, 0, 14);
      mesh(new THREE.SphereGeometry(0.0052, 12, 8), glass(0xe9f8ff, 0.75), g, 0, -0.102, 0);
    } else if (kind === 'tds') {        // sonda TDS de dos pines
      cyl(0.0075, 0.09, black, g, 0, -0.045, 0, 14); box(0.002, 0.012, 0.006, inox, g, 0.003, -0.095, 0); box(0.002, 0.012, 0.006, inox, g, -0.003, -0.095, 0);
    } else if (kind === 'temp') {       // DS18B20 en funda de acero
      cyl(0.003, 0.05, inox, g, 0, -0.025, 0, 10); cyl(0.0035, 0.01, black, g, 0, 0.0, 0, 10);
    } else if (kind === 'turb') {       // sensor de turbidez en U, parte de arriba sellada con resina
      box(0.022, 0.03, 0.012, M(0xf0f0f0, { transparent: true, opacity: 0.92 }), g, 0, -0.015, 0);
      box(0.007, 0.022, 0.012, M(0xf0f0f0, { transparent: true, opacity: 0.92 }), g, 0.0075, -0.041, 0); box(0.007, 0.022, 0.012, M(0xf0f0f0, { transparent: true, opacity: 0.92 }), g, -0.0075, -0.041, 0);
      box(0.023, 0.004, 0.013, M(0x6b4f2a, { roughness: 0.3 }), g, 0, 0.0, 0);
    }
    return g;
  }
  mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.006, 32), M(0x9aa6ad, { transparent: true, opacity: 0.85 }), body, 0, 0.01, 0);
  const sondasEntrada = [['ph', 'ph_in', 30], ['tds', 'tds', 120], ['temp', 'temp', 210], ['turb', 'turb_in', 300]];
  const dp = polar(C.duct.a, C.duct.r, 0), probeObj = {};
  sondasEntrada.forEach(([kind, key, a]) => {
    const p = polar(a, 0.1, 0.008); probeObj[key] = probe(kind, body, p.x, p.y, p.z);
    const s = SENSORES_BOYA.find(q => q.key === key); torusH(0.0075, 0.002, M(s.color), body, p.y - 0.012).position.set(p.x, p.y - 0.012, p.z);
    gland(body, p.x, 0.013, p.z, 1);
    const q = polar(C.duct.a, C.duct.r, 0.05);
    cable([[p.x, 0.03, p.z], [p.x * 0.7 + q.x * 0.3, 0.045, p.z * 0.7 + q.z * 0.3], [q.x, 0.055, q.z]], 0.0018, 0x161616, body, 16);
  });
  anchor('sensores', body, -0.12, -0.05, 0.05);

  // Ducto interno de cables (tubo corrugado)
  cyl(0.011, C.deck + 0.02 - (C.colBottom + 0.01), black, body, dp.x, (C.deck + 0.02 + C.colBottom + 0.01) / 2, dp.z, 12);
  const corr = new THREE.InstancedMesh(new THREE.TorusGeometry(0.0115, 0.0016, 4, 12), black, 40);
  for (let i = 0; i < 40; i++) { dm.position.set(dp.x, C.colBottom + 0.02 + i * 0.011, dp.z); dm.rotation.set(Math.PI / 2, 0, 0); dm.updateMatrix(); corr.setMatrixAt(i, dm.matrix); }
  body.add(corr);
  anchor('ducto', body, dp.x + 0.02, -0.08, dp.z + 0.02);

  // ---------- Cuatro capas filtrantes con mallas de costal y mosquitero ----------
  const colH = C.colTop - C.colBottom, stH = colH / ETAPAS_FILTRO.length, stageMeshes = [];
  const thetaStart = deg(90 - C.cut[0]), thetaLen = Math.PI * 2 - deg(C.cut[1] - C.cut[0]);
  ETAPAS_FILTRO.forEach((e, i) => {
    const yc = C.colTop - stH * (i + 0.5), tex = mediaTex(e.tex, e.key);
    const mat = M(tex ? 0xffffff : e.color, { map: tex, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
    mesh(new THREE.CylinderGeometry(C.colR - 0.012, C.colR - 0.012, stH - 0.01, 44, 1, false, thetaStart, thetaLen), mat, body, 0, yc, 0);
    const ys = C.colTop - stH * i;
    const ms = mesh(new THREE.RingGeometry(0.02, C.colR - 0.006, 28, 3), M(0xd9cfb3, { wireframe: true }), body, 0, ys - 0.003, 0); ms.rotation.x = -Math.PI / 2;
    torusH(C.colR - 0.009, 0.0035, black, body, ys - 0.003, 48);
    anchor('etapa' + (i + 1), body, Math.cos(deg(58)) * (C.colR + 0.03), yc, Math.sin(deg(58)) * (C.colR + 0.03));
    stageMeshes.push({ mat });
  });
  torusH(C.colR - 0.009, 0.0035, black, body, C.colBottom + 0.002, 48);
  anchor('filtros', body, -0.24, -0.27, 0.02);

  // ---------- Batería: tubo sellado con 6 celdas 18650 recicladas (3S2P) + BMS 3S ----------
  const bat = new THREE.Group(); bat.position.set(0.26, -0.31, 0); body.add(bat);
  mesh(new THREE.CapsuleGeometry(0.045, 0.13, 6, 18), glass(0xdfe8ec, 0.3), bat);
  const cellCol = [0x2a5db0, 0x7a3fa0, 0x2f8f5a];
  [-0.034, 0.034].forEach((y, row) => [-0.019, 0, 0.019].forEach((x, k) => {
    cyl(0.009, 0.065, M(cellCol[(k + row) % 3], { roughness: 0.4 }), bat, x, y, 0.0, 16); cyl(0.0092, 0.002, inox, bat, x, y + 0.033, 0, 16);
  }));
  box(0.07, 0.003, 0.02, M(0x222222), bat, 0, 0, -0.012);                         // dos portapilas 3×18650
  box(0.04, 0.003, 0.03, pcbGreen, bat, 0, 0.072, 0); box(0.008, 0.004, 0.006, black, bat, 0.01, 0.075, 0.006);   // BMS 3S
  cyl(0.008, 0.012, black, bat, 0, 0.11, 0, 10);
  const batBar = box(0.006, 1, 0.003, new THREE.MeshBasicMaterial({ color: 0x34d17a }), bat, 0.0, 0, 0.047);
  box(0.009, 0.11, 0.002, new THREE.MeshBasicMaterial({ color: 0x111518 }), bat, 0, 0, 0.0465);
  cable([[0.262, -0.19, 0.003], [0.222, -0.12, 0.01], [0.221, -0.02, 0.01], [0.2, 0.03, 0.01], [0.09, C.deck + 0.025, 0.03]], 0.003, 0xb3261e, body);
  cable([[0.258, -0.19, -0.003], [0.222, -0.12, -0.004], [0.221, -0.02, -0.004], [0.2, 0.03, -0.004], [0.09, C.deck + 0.023, 0.02]], 0.003, 0x161616, body);
  anchor('bateria', body, 0.31, -0.31, 0.04);

  // ---------- Resistencia de descarga 10 Ω 50 W (freno), sumergida para que el río la enfríe ----------
  const brakeG = new THREE.Group(); brakeG.position.set(0.3, -0.44, 0.06); body.add(brakeG);
  box(0.05, 0.016, 0.028, alu, brakeG, 0, 0, 0);
  for (let i = 0; i < 4; i++) box(0.05, 0.004, 0.002, alu, brakeG, 0, 0.004, -0.01 + i * 0.0066);
  box(0.006, 0.006, 0.004, inox, brakeG, -0.028, 0, 0); box(0.006, 0.006, 0.004, inox, brakeG, 0.028, 0, 0);
  const brakeGlow = box(0.052, 0.002, 0.03, new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0 }), brakeG, 0, 0.0095, 0);
  cable([[0.27, -0.44, 0.06], [0.24, -0.36, 0.05], [0.222, -0.12, 0.03], [0.2, 0.03, 0.02], [0.09, C.deck + 0.026, 0.035]], 0.0022, 0x3a3a3a, body);
  anchor('freno', body, 0.34, -0.46, 0.08);

  // ---------- Cámara de salida con sondas de salida → bomba 12 V → caudalímetro → río ----------
  mesh(new THREE.LatheGeometry(C.bowl.map(([r, y]) => new THREE.Vector2(r, y)), 40), glass(0xa9d8e2, 0.22), body);
  const bowlMat = body.children[body.children.length - 1].material;
  [['ph', 'ph_out', 60], ['turb', 'turb_out', 240]].forEach(([kind, key, a]) => {
    const p = polar(a, 0.085, -0.45); probeObj[key] = probe(kind, body, p.x, p.y, p.z); probeObj[key].scale.setScalar(0.6);
    const s = SENSORES_BOYA.find(q => q.key === key); torusH(0.0075, 0.002, M(s.color), body, p.y - 0.008).position.set(p.x, p.y - 0.008, p.z);
    cable([[p.x, p.y + 0.004, p.z], [p.x * 1.5, -0.43, p.z * 1.5], [dp.x * 1.3, -0.41, dp.z * 1.3], [dp.x, C.colBottom + 0.01, dp.z]], 0.0016, 0x161616, body, 16);
  });
  gland(body, dp.x * 1.3, C.colBottom - 0.005, dp.z * 1.3, -1);
  anchor('salida', body, 0.06, -0.47, 0.1);
  // mini bomba sumergible 12 V (800 L/h)
  const pumpG = new THREE.Group(); pumpG.position.set(0, -0.525, 0); body.add(pumpG);
  cyl(0.024, 0.05, black, pumpG, 0, 0, 0, 18); cyl(0.026, 0.006, M(0x2f6fd6), pumpG, 0, 0.02, 0, 18);
  const imp = new THREE.Group(); pumpG.add(imp);
  for (let i = 0; i < 4; i++) box(0.03, 0.004, 0.002, M(0x9aa9b0), imp, 0, 0.026, 0).rotation.y = i * Math.PI / 4;
  const pOut = cyl(0.007, 0.06, black, pumpG, -0.05, -0.01, 0, 10); pOut.rotation.z = Math.PI / 2;
  cable([[0.0, -0.5, 0.02], [0.05, -0.45, 0.05], [dp.x * 1.3, -0.41, dp.z * 1.3], [dp.x, C.colBottom + 0.01, dp.z]], 0.002, 0x2a2a2a, body, 16);
  anchor('bomba', body, 0.02, -0.56, 0.06);
  // caudalímetro YF-S401 en la descarga
  const fm = new THREE.Group(); fm.position.set(-0.1, -0.535, 0); body.add(fm);
  const fmb = cyl(0.011, 0.035, M(0x1d1f22, { transparent: true, opacity: 0.9 }), fm, 0, 0, 0, 14); fmb.rotation.z = Math.PI / 2;
  box(0.018, 0.01, 0.012, black, fm, 0, 0.013, 0);
  const fOut = cyl(0.006, 0.05, black, fm, -0.04, 0, 0, 10); fOut.rotation.z = Math.PI / 2;
  cable([[-0.1, -0.52, 0.0], [-0.06, -0.47, 0.06], [dp.x * 1.3, -0.41, dp.z * 1.3], [dp.x, C.colBottom + 0.01, dp.z]], 0.0015, 0xf2c230, body, 16);
  anchor('caudal', body, -0.11, -0.55, 0.04);

  // ---------- Caja estanca con la electrónica (la misma de Wokwi) ----------
  const TOP = 0.3, boxY = 0.05;
  const ebox = new THREE.Group(); ebox.position.set(0, boxY, 0); body.add(ebox);
  mesh(new THREE.BoxGeometry(BX.w, BX.h, BX.d), glass(0xeef6f8, 0.22), ebox, 0, BX.h / 2, 0);
  ebox.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BX.w, BX.h, BX.d)), new THREE.LineBasicMaterial({ color: 0x6b757b })).translateY(BX.h / 2));
  box(BX.w - 0.004, 0.004, BX.d - 0.004, M(0x6b757b), ebox, 0, 0.002, 0);
  const plateY = 0.008, upperY = 0.042;
  const upperG = new THREE.Group(); ebox.add(upperG);                       // planta alta (se oculta para ver la de abajo)
  const board = (w, d, m, x, z, y = plateY, par = ebox) => { const g = new THREE.Group(); g.position.set(x, y, z); par.add(g); box(w, 0.0016, d, m, g, 0, 0.0008, 0); return g; };
  // planta baja: control, comunicación y potencia
  const esp = board(0.052, 0.028, pcbBlack, -0.06, -0.045);                 // ESP32 DevKit V1
  box(0.018, 0.003, 0.025, inox, esp, 0.014, 0.003, 0); box(0.008, 0.003, 0.007, inox, esp, -0.025, 0.0025, 0);
  [-0.0125, 0.0125].forEach(z => box(0.046, 0.008, 0.0025, black, esp, -0.002, -0.004, z));
  const modem = board(0.05, 0.03, pcbBlue, 0.005, -0.045);                   // A7670SA con ranura SIM
  box(0.024, 0.003, 0.024, inox, modem, -0.008, 0.0025, 0); box(0.014, 0.002, 0.012, M(0xc9a24a), modem, 0.016, 0.002, 0);
  cyl(0.003, 0.004, brass, modem, 0.022, 0.003, -0.011, 8);
  const sd = board(0.024, 0.02, pcbBlue, 0.065, -0.05); box(0.012, 0.002, 0.012, inox, sd, 0.004, 0.0025, 0);   // microSD
  const xl = board(0.054, 0.026, pcbBlue, -0.065, 0.0);                      // XL4015 con disipador
  for (let i = 0; i < 6; i++) box(0.0015, 0.01, 0.018, M(0xb8bec4, { metalness: 0.8 }), xl, -0.012 + i * 0.0035, 0.006, 0);
  cyl(0.006, 0.006, black, xl, 0.016, 0.004, 0, 14);
  const buck5 = board(0.043, 0.021, pcbBlue, -0.012, 0.0);                    // LM2596 a 5 V
  cyl(0.006, 0.006, black, buck5, 0.006, 0.004, 0, 14); box(0.004, 0.004, 0.006, M(0x2f6fd6), buck5, 0.016, 0.003, 0.006);
  const buck4 = board(0.043, 0.021, pcbBlue, 0.038, 0.0);                     // LM2596 a 4 V + capacitor 1000 µF
  cyl(0.006, 0.006, black, buck4, 0.006, 0.004, 0, 14); cyl(0.005, 0.016, M(0x223a8a), buck4, -0.014, 0.0095, 0, 14);
  const fetB = board(0.022, 0.016, pcbBlue, 0.078, 0.0); box(0.007, 0.008, 0.002, black, fetB, 0, 0.005, -0.004);   // MOSFET D4184 bomba
  const fetF = board(0.022, 0.016, pcbBlue, 0.078, 0.022); box(0.007, 0.008, 0.002, black, fetF, 0, 0.005, -0.004); // MOSFET D4184 freno
  const acs = board(0.031, 0.013, pcbRed, 0.035, 0.03); box(0.008, 0.006, 0.008, M(0x2f8f3a), acs, 0.009, 0.004, 0);   // ACS712
  const fuse = board(0.03, 0.012, black, -0.02, 0.03); box(0.016, 0.006, 0.006, M(0xe0b020), fuse, 0, 0.004, 0);      // fusible 5 A
  const diodo = cyl(0.0025, 0.008, black, ebox, -0.065, plateY + 0.004, 0.03, 10); diodo.rotation.z = Math.PI / 2;   // diodo Schottky
  const tvs = cyl(0.0022, 0.007, M(0x111111), ebox, -0.075, plateY + 0.004, 0.03, 10); tvs.rotation.z = Math.PI / 2; // TVS
  [[-0.035, 0.058], [0.035, 0.058]].forEach(([x, z]) => { box(0.045, 0.01, 0.009, M(0x2f8f3a), ebox, x, plateY + 0.005, z); for (let i = 0; i < 6; i++) cyl(0.0018, 0.002, inox, ebox, x - 0.019 + i * 0.0076, plateY + 0.011, z, 8); });
  // planta alta (acrílico sobre separadores): tarjetas de las sondas, ADS1115, MPU6050 y transistores
  box(0.19, 0.003, 0.14, glass(0xffffff, 0.35), upperG, 0, upperY, 0);
  [[-0.088, -0.063], [0.088, -0.063], [-0.088, 0.063], [0.088, 0.063]].forEach(([x, z]) => cyl(0.003, upperY - plateY, brass, ebox, x, (upperY + plateY) / 2, z, 8));
  const up = (w, d, m, x, z) => board(w, d, m, x, z, upperY + 0.0015, upperG);
  const phBoard = (x, z) => { const g = up(0.042, 0.032, pcbBlue, x, z); const b = cyl(0.0055, 0.012, inox, g, -0.012, 0.0062, 0.016, 14); b.rotation.x = Math.PI / 2; [0.004, 0.012].forEach(px => cyl(0.003, 0.004, M(0x2f6fd6), g, px, 0.003, -0.006, 10)); return g; };
  const ph1B = phBoard(-0.06, -0.04), ph2B = phBoard(0.0, -0.04);              // 2× PH-4502C
  const tdsB = up(0.042, 0.032, pcbBlack, 0.06, -0.04); box(0.008, 0.004, 0.006, M(0xf2f2f2), tdsB, 0.01, 0.003, 0.01);   // TDS
  const tb1 = up(0.028, 0.038, pcbBlue, -0.065, 0.01), tb2 = up(0.028, 0.038, pcbBlue, -0.03, 0.01);                     // 2× turbidez
  const sondas = [ph1B, ph2B, tdsB, tb1, tb2];
  const ads1 = up(0.028, 0.017, pcbPurple, 0.012, 0.0), ads2 = up(0.028, 0.017, pcbPurple, 0.05, 0.0);                // 2× ADS1115
  [ads1, ads2].forEach(a => box(0.004, 0.0015, 0.004, black, a, 0, 0.0025, 0));
  const mpu = up(0.021, 0.016, pcbBlue, 0.012, 0.035); box(0.004, 0.001, 0.004, black, mpu, 0, 0.002, 0);             // MPU6050
  const proto = up(0.03, 0.02, pcbProto, 0.055, 0.035);                                                                 // transistores + divisores
  for (let i = 0; i < 3; i++) box(0.004, 0.005, 0.0015, black, proto, -0.01 + i * 0.01, 0.003, 0);
  const jc = [0xd23b2e, 0x161616, 0xf2c230, 0x2f9e44, 0x2f6fd6, 0xf2f2f2];
  [...sondas, mpu, proto].forEach((g, k) => { const a = g.position; cable([[a.x + 0.01, upperY + 0.004, a.z], [(a.x + ads1.position.x) / 2, upperY + 0.016, (a.z + ads1.position.z) / 2], [k % 2 ? ads2.position.x : ads1.position.x, upperY + 0.004, 0]], 0.0008, jc[k % jc.length], upperG, 10); });
  [[0.005, -0.045], [0.065, -0.05], [-0.065, 0.0], [-0.012, 0.0], [0.038, 0.0], [0.078, 0.0], [0.078, 0.022], [0.035, 0.03]].forEach(([x, z], k) => cable([[-0.06, plateY + 0.006, -0.045], [(x - 0.06) / 2, plateY + 0.014, (z - 0.045) / 2], [x, plateY + 0.003, z]], 0.0008, jc[(k + 2) % jc.length], ebox, 10));
  cable([[0.012, upperY + 0.004, 0.0], [-0.03, (upperY + plateY) / 2 + 0.01, -0.02], [-0.055, plateY + 0.006, -0.045]], 0.0009, 0xf2c230, upperG, 10);
  const glandPos = [[-0.07, -0.05], [-0.035, -0.05], [0.0, -0.05], [0.035, -0.05], [0.07, -0.05], [-0.07, 0.05], [0.0, 0.05], [0.07, 0.05]];
  glandPos.forEach(([x, z]) => gland(ebox, x, 0, z, -1));
  sondas.forEach((g, k) => { const a = g.position, [gx, gz] = glandPos[k % glandPos.length]; cable([[a.x - 0.012, upperY + 0.0062, a.z + 0.022], [a.x - 0.012, upperY + 0.0062, a.z + 0.04], [(a.x + gx) / 2, 0.02, (a.z + gz) / 2], [gx, 0.003, gz]], 0.0012, 0x161616, upperG, 14); });
  // antena LTE 4G del módem
  const antG = new THREE.Group(); ebox.add(antG);
  cyl(0.004, 0.008, brass, antG, 0.07, BX.h + 0.004, -0.05, 10);
  const antTop = TOP - boxY - 0.005; cyl(0.0055, antTop - BX.h - 0.008, black, antG, 0.07, (BX.h + 0.008 + antTop) / 2, -0.05, 10);
  cable([[0.07, BX.h - 0.002, -0.05], [0.045, 0.05, -0.052], [0.027, plateY + 0.004, -0.056]], 0.0008, 0x9a8a5a, ebox, 8);
  anchor('antena', ebox, 0.075, antTop - 0.03, -0.05);
  anchor('control', ebox, 0, BX.h * 0.6, 0);
  anchor('electronica', ebox, BX.w / 2, BX.h * 0.7, BX.d / 2);

  const dTop = polar(C.duct.a, C.duct.r, C.deck + 0.02);
  cable([[0.0, boxY - 0.012, 0.05], [0.0, (boxY + C.deck) / 2, 0.11], [dTop.x, C.deck + 0.03, dTop.z], [dTop.x, C.deck + 0.012, dTop.z]], 0.008, 0x1a1a1a, body, 20);
  gland(body, dTop.x, C.deck + 0.008, dTop.z, 1);
  cable([[0.09, C.deck + 0.025, 0.025], [0.08, (boxY + C.deck) / 2, -0.02], [0.07, boxY - 0.012, -0.05]], 0.0035, 0x1a1a1a, body, 12);

  // Domo protector: garrafón/cono sobre una jaula de varilla
  const capH = 0.18, domeMat = M(0xf2c230, { roughness: 0.45, transparent: true, opacity: 1 }), domeG = new THREE.Group(); body.add(domeG);
  mesh(new THREE.CylinderGeometry(0.06, 0.21, capH, 32, 1, true), domeMat, domeG, 0, C.deck + capH / 2, 0);
  cyl(0.06, 0.004, M(0xf2c230), domeG, 0, C.deck + capH, 0, 24);
  torusH(0.21, 0.01, M(0xd9a81e), domeG, C.deck + 0.004);
  torusH(0.21 - 0.15 * 0.07 / capH + 0.002, 0.009, M(0xf7f7f7, { emissive: 0x444444 }), domeG, C.deck + 0.07);
  anchor('domo', body, 0.12, C.deck + capH * 0.8, 0.05);
  body.userData.dome = domeMat;

  // ---------- Barreras guía con faldón de 10 cm ----------
  const boomMat = M(0xe8742c, { roughness: 0.5 });
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0xf0a070, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const BOOM = [[0.9, 0.9], [0.45, 0.72], [0, 0.72], [-0.45, 0.6], [B.x0, B.halfW + 0.02]];
  [1, -1].forEach(s => {
    const curve = new THREE.CatmullRomCurve3(BOOM.map(([x, z]) => V3(x, 0.01, s * z)));
    mesh(new THREE.TubeGeometry(curve, 40, 0.035, 10, false), boomMat, body);
    const pts = curve.getPoints(32), pos = [], idx = [];
    pts.forEach((p, i) => { pos.push(p.x, -0.02, p.z, p.x, -0.1, p.z); if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    body.add(new THREE.Mesh(g, skirtMat));
  });
  anchor('barreras', body, -0.25, 0.04, 0.66);

  // ---------- Cesta (huacal) con compuertas de no retorno, tapa de malla y ultrasónico en mástil ----------
  const basket = new THREE.Group(); body.add(basket);
  const netMat = new THREE.MeshBasicMaterial({ color: 0xe3eef0, wireframe: true, transparent: true, opacity: 0.55 });
  const fillMat = new THREE.MeshStandardMaterial({ color: 0xcfe6ea, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
  const bh = B.top - B.bottom, bx = B.x0 - B.len / 2, by = (B.top + B.bottom) / 2;
  const panel = (w, h, sw, sh, x, y, z, rx, ry) => [netMat, fillMat].forEach(m => { const o = mesh(new THREE.PlaneGeometry(w, h, sw, sh), m, basket, x, y, z); o.rotation.set(rx, ry, 0); });
  panel(B.len, bh, 16, 8, bx, by, B.halfW, 0, 0); panel(B.len, bh, 16, 8, bx, by, -B.halfW, 0, 0);
  panel(B.halfW * 2, bh, 14, 8, B.x0 - B.len, by, 0, 0, Math.PI / 2);
  panel(B.len, B.halfW * 2, 16, 14, bx, B.bottom, 0, -Math.PI / 2, 0);
  panel(B.len, B.halfW * 2, 16, 14, bx, B.top, 0, -Math.PI / 2, 0);
  const frameEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(B.len, bh, B.halfW * 2)), new THREE.LineBasicMaterial({ color: 0x5c6870 }));
  frameEdges.position.set(bx, by, 0); basket.add(frameEdges);
  const lip = mesh(new THREE.PlaneGeometry(B.halfW * 2, B.lip - B.bottom), M(0x3d4a52, { side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), basket, B.x0, (B.lip + B.bottom) / 2, 0); lip.rotation.y = Math.PI / 2;
  box(0.012, 0.012, B.halfW * 2, steel, basket, B.x0, B.top - 0.01, 0);
  const flaps = [];
  for (let i = 0; i < 6; i++) {
    const z = -B.halfW + (i + 0.5) * (B.halfW * 2 / 6), fg = new THREE.Group(); fg.position.set(B.x0, B.top - 0.012, z); basket.add(fg);
    box(0.004, B.top - 0.012 - B.lip, B.halfW * 2 / 6 - 0.008, M(0xa9b7bd, { transparent: true, opacity: 0.7, side: THREE.DoubleSide }), fg, 0, -(B.top - 0.012 - B.lip) / 2, 0);
    flaps.push(fg);
  }
  [B.halfW, -B.halfW].forEach(z => { const f = cyl(0.035, B.len, boomMat, basket, bx, 0.03, z, 12); f.rotation.z = Math.PI / 2; });
  [0.2, -0.2].forEach(z => box(-0.5 - B.x0 + 0.06, 0.014, 0.014, steel, basket, (B.x0 - 0.5) / 2 + 0.02, 0.04, z));
  torusH(B.holeR, 0.008, M(0x35d0e0, { emissive: 0x0f5f6a, emissiveIntensity: 0.6 }), basket, B.bottom).position.x = B.holeX;
  mesh(new THREE.CylinderGeometry(B.holeR, B.holeR + 0.025, 0.08, 16, 1, true), M(0x35d0e0, { side: THREE.DoubleSide, transparent: true, opacity: 0.5 }), basket, B.holeX, B.bottom - 0.04, 0);
  // JSN-SR04T 30 cm sobre la tapa (su zona ciega es de ~20 cm)
  const usX = B.x0 - B.len * 0.55, usY = B.top + C.sonar.mast;
  cyl(0.006, C.sonar.mast, steel, basket, usX, B.top + C.sonar.mast / 2, 0, 8);
  box(0.03, 0.006, 0.006, steel, basket, usX, usY, 0);
  const sonarG = new THREE.Group(); basket.add(sonarG);
  cyl(0.012, 0.016, black, sonarG, usX, usY - 0.011, 0, 16); cyl(0.0095, 0.002, inox, sonarG, usX, usY - 0.02, 0, 16); box(0.04, 0.003, 0.02, pcbGreen, sonarG, usX + 0.03, usY + 0.006, 0);
  cable([[usX, usY + 0.004, 0], [usX + 0.1, usY - 0.05, 0.02], [B.x0 + 0.05, 0.12, 0.2], [-0.3, 0.07, 0.12], [-0.08, boxY - 0.012, 0.05]], 0.0022, 0x161616, body);
  anchor('nivel', basket, usX, usY, 0.02);
  const trashColors = [0xe8742c, 0x2f6fd6, 0x5fae5a, 0xd8c9a3, 0xc0392b, 0xf2f2f2], trashIn = [];
  for (let i = 0; i < 36; i++) {
    const g = i % 3 ? new THREE.BoxGeometry(0.06, 0.02, 0.045) : new THREE.CylinderGeometry(0.016, 0.016, 0.09, 8);
    const o = mesh(g, M(trashColors[i % trashColors.length]), basket, B.x0 - 0.06 - Math.random() * (B.len - 0.12), -0.01 + (i / 36) * 0.1 + Math.random() * 0.02, (Math.random() - 0.5) * (B.halfW * 2 - 0.08));
    o.rotation.set(Math.random() * 3, Math.random() * 3, 0); o.visible = false; trashIn.push(o);
  }
  anchor('cesta', body, B.x0 - B.len, B.top + 0.05, 0.2);
  anchor('compuerta', body, B.x0, 0.06, -B.halfW + 0.05);
  anchor('escape', body, B.holeX, B.bottom - 0.15, 0.04);

  // ---------- Veleta (lámina de garrafón o latas aplanadas) ----------
  const vs = new THREE.Shape(); vs.moveTo(0, VN.yTop); vs.lineTo(-VN.len, VN.yTop + 0.02); vs.lineTo(-VN.len, VN.yBot); vs.lineTo(0, VN.yBot + 0.06); vs.closePath();
  mesh(new THREE.ExtrudeGeometry(vs, { depth: 0.008, bevelEnabled: false }), M(0xdfe3e6, { roughness: 0.4, metalness: 0.3 }), body, VN.x0, 0, -0.004);
  const vEdge = new THREE.Shape(); vEdge.moveTo(-VN.len + 0.06, VN.yTop + 0.015); vEdge.lineTo(-VN.len, VN.yTop + 0.02); vEdge.lineTo(-VN.len, VN.yBot); vEdge.lineTo(-VN.len + 0.06, VN.yBot + 0.005); vEdge.closePath();
  mesh(new THREE.ExtrudeGeometry(vEdge, { depth: 0.0084, bevelEnabled: false }), M(0xe8742c), body, VN.x0, 0, -0.0042);
  const armL = -0.5 - (VN.x0 + 0.05);
  [0.15, -0.15].forEach(z => { const arm = cyl(0.011, armL, steel, body, -0.5 - armL / 2, -0.3, z, 10); arm.rotation.z = Math.PI / 2; });
  cyl(0.011, 0.32, steel, body, VN.x0 + 0.05, -0.3, 0, 10).rotation.x = Math.PI / 2;
  box(0.02, 0.06, 0.02, steel, body, VN.x0 + 0.02, -0.27, 0);
  anchor('veleta', body, VN.x0 - VN.len * 0.6, VN.yBot + 0.04, 0.02);

  // ---------- Anillo giratorio: las líneas de anclaje se sujetan aquí y no giran ----------
  torusH(MO.ringR, 0.012, M(0x48525a, { metalness: 0.6, roughness: 0.35 }), mount, 0, 72);
  [60, 180, 300].forEach(a => { const p = polar(a, MO.ringR - 0.022, 0); cyl(0.01, 0.022, black, mount, p.x, 0, p.z, 12); });
  anchor('giro', mount, Math.cos(deg(250)) * MO.ringR, 0.01, Math.sin(deg(250)) * MO.ringR);

  // ---------- Jaula de varilla + 3 líneas: cuerda de polipropileno, 1.5 m de cadena y ancla helicoidal con cubeta de concreto ----------
  [30, 150, 270].forEach(dg => {
    const a = deg(dg), x = Math.cos(a) * MO.cageR, z = Math.sin(a) * MO.cageR, h = C.ringBotY - MO.cageBottom;
    cyl(0.008, h, steel, body, x, MO.cageBottom + h / 2, z, 8);
    spoke(MO.cageR, C.ringR - C.ringTube + 0.01, a, C.ringBotY, steel, body, 0.01);
  });
  torusH(MO.cageR, 0.009, steel, body, MO.cageBottom);
  anchor('jaula', body, -MO.cageR, MO.cageBottom + 0.04, 0.08);
  const chainMat = M(0x4a5157, { metalness: 0.7, roughness: 0.4 }), ropeMat = M(0xf2c230, { roughness: 0.8 }), NL = 80, moor = [];
  MO.angles.forEach((dg, li) => {
    const a = deg(dg), ca = Math.cos(a), sa = Math.sin(a);
    const pad = new THREE.Object3D(); pad.position.set(ca * (MO.ringR + 0.012), 0, sa * (MO.ringR + 0.012)); mount.add(pad);
    mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 12), steel, mount, ca * (MO.ringR + 0.012), 0, sa * (MO.ringR + 0.012)).rotation.y = -a;
    const ag = new THREE.Group(); ag.position.set(ca * MO.anchorR, bedY, sa * MO.anchorR); root.add(ag);
    const eye = mesh(new THREE.TorusGeometry(0.025, 0.007, 8, 14), steel, ag, 0, 0.03, 0); eye.rotation.y = -a;
    cyl(0.012, 0.7, steel, ag, 0, -0.33, 0, 8);
    mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 20), steel, ag, 0, -0.62, 0).rotation.x = Math.PI / 2 + 0.25;
    const bucket = mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.3, 18), M(0x8a8f8c, { roughness: 1 }), ag, -ca * 0.25 - sa * 0.15, 0.15, -sa * 0.25 + ca * 0.15);   // cubeta con concreto
    torusH(0.15, 0.006, M(0x5c6870), bucket, 0.15);
    const links = new THREE.InstancedMesh(new THREE.TorusGeometry(0.014, 0.0045, 6, 10), chainMat, NL); links.frustumCulled = false; root.add(links);
    const rope = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6), ropeMat, NL); rope.frustumCulled = false; root.add(rope);
    const m = { a, pad, links, rope, NL, len: 0 };
    if (li === 0) { anchors.ancla = eye; anchors.lastre = bucket; m.lm = new THREE.Object3D(); m.lc = new THREE.Object3D(); root.add(m.lm); root.add(m.lc); anchors.linea = m.lm; anchors.cadena = m.lc; }
    const p0 = V3(ca * MO.ringR, bedY + MO.maxDepth + MO.cageBottom, sa * MO.ringR), p2 = V3(ca * MO.anchorR, bedY, sa * MO.anchorR);
    m.len = p0.distanceTo(p2) * MO.slack; moor.push(m);
  });
  const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = V3(1, 1, 1), _s0 = V3(0, 0, 0), _sr = V3(1, 1, 1), _up = V3(0, 0, 1), _upY = V3(0, 1, 0), _t = V3(0, 0, 0), _p = V3(0, 0, 0), _p2 = V3(0, 0, 0), _mid = V3(0, 0, 0), _rq = new THREE.Quaternion();
  function updateMoor() {
    mount.updateMatrix();
    moor.forEach(m => {
      const P0 = m.pad.position.clone().applyMatrix4(mount.matrix), P2 = V3(Math.cos(m.a) * MO.anchorR, bedY + 0.03, Math.sin(m.a) * MO.anchorR);
      const d = P0.distanceTo(P2), sag = 0.5 * Math.sqrt(Math.max(0, m.len * m.len - d * d));
      const mid = P0.clone().add(P2).multiplyScalar(0.5); mid.y -= sag;
      const ctrl = mid.clone().multiplyScalar(2).sub(P0.clone().add(P2).multiplyScalar(0.5));
      const curve = new THREE.QuadraticBezierCurve3(P0, ctrl, P2);
      const chainFrom = Math.max(0, 1 - MO.chainM / m.len);
      for (let i = 0; i < m.NL; i++) {
        const u = i / (m.NL - 1), u2 = Math.min(1, u + 1 / (m.NL - 1));
        curve.getPoint(u, _p); curve.getPoint(u2, _p2);
        _p.y = Math.max(_p.y, bedY + 0.015); _p2.y = Math.max(_p2.y, bedY + 0.015);
        _t.copy(_p2).sub(_p); const segLen = _t.length(); if (segLen < 1e-6) _t.set(1, 0, 0); _t.normalize();
        if (u >= chainFrom) {
          _q.setFromUnitVectors(_up, _t); if (i % 2) { _rq.setFromAxisAngle(_t, Math.PI / 2); _q.premultiply(_rq); }
          _m.compose(_p, _q, _s); m.links.setMatrixAt(i, _m); _m.compose(_p, _q, _s0); m.rope.setMatrixAt(i, _m);
        } else {
          _q.setFromUnitVectors(_upY, _t); _mid.copy(_p).add(_p2).multiplyScalar(0.5); _sr.set(1, segLen, 1);
          _m.compose(_mid, _q, _sr); m.rope.setMatrixAt(i, _m); _m.compose(_p, _q, _s0); m.links.setMatrixAt(i, _m);
        }
      }
      m.links.instanceMatrix.needsUpdate = true; m.rope.instanceMatrix.needsUpdate = true;
      if (m.lm) { curve.getPoint(Math.max(0.05, chainFrom * 0.5), _p); m.lm.position.copy(_p); curve.getPoint(Math.min(0.97, chainFrom + (1 - chainFrom) * 0.5), _p); _p.y = Math.max(_p.y, bedY + 0.03); m.lc.position.copy(_p); }
    });
  }


  // ---------- Componentes electrónicos, uno por uno (los mismos de Wokwi y del BOM) ----------
  const componentes = [
    ['Control y comunicación', 'esp32', 'Microcontrolador', 'ESP32 DevKit V1 (WiFi y Bluetooth)', 'I2C SDA 21, SCL 22 · lee todos los sensores', 'ESP32 DevKit V1', esp],
    ['Control y comunicación', 'ads1', 'Convertidor analógico #1', 'ADS1115 (0x48)', 'A0 pH entrada · A1 pH salida · A2 TDS · A3 turbidez entrada', 'Chip propio ads1115', ads1],
    ['Control y comunicación', 'ads2', 'Convertidor analógico #2', 'ADS1115 (0x49)', 'A0 turbidez salida · A1 batería · A2 generador · A3 corriente bomba', 'Chip propio ads1115', ads2],
    ['Control y comunicación', 'modem', 'Módem 4G con ranura SIM', 'SIMCom A7670SA + chip SIM', 'UART2: RX 16, TX 17 · PWRKEY 4 · alimentado a 4 V', 'Chip propio a7670sa', modem],
    ['Control y comunicación', 'antena', 'Antena LTE', 'Antena de látigo SMA', 'Conectada al módem A7670SA', 'Parte del chip a7670sa', antG],
    ['Control y comunicación', 'sd', 'Respaldo de datos', 'Módulo microSD', 'SPI: CS 13, SCK 18, MISO 19, MOSI 23', 'microSD', sd],
    ['Control y comunicación', 'mpu', 'Inclinación y golpes', 'MPU6050', 'I2C 0x68', 'MPU6050', mpu],
    ['Control y comunicación', 'proto', 'Encendido por turnos', '3 transistores + divisores 10k/20k', 'GPIO32 pH entrada · GPIO33 pH salida · GPIO26 TDS', 'LEDs pH ent., pH sal. y TDS', proto],
    ['Sensores', 'ph_in', 'Electrodo de pH (entrada)', 'E-201-C (BNC)', 'Va a la tarjeta PH-4502C #1', 'Potenciómetro pH entrada', probeObj.ph_in],
    ['Sensores', 'ph1b', 'Tarjeta de pH (entrada)', 'PH-4502C', 'ADS1115 #1 A0, con divisor 10k/20k', 'Potenciómetro pH entrada', ph1B],
    ['Sensores', 'ph_out', 'Electrodo de pH (salida)', 'E-201-C (BNC)', 'Va a la tarjeta PH-4502C #2', 'Potenciómetro pH salida', probeObj.ph_out],
    ['Sensores', 'ph2b', 'Tarjeta de pH (salida)', 'PH-4502C', 'ADS1115 #1 A1, con divisor 10k/20k', 'Potenciómetro pH salida', ph2B],
    ['Sensores', 'tds', 'Sonda TDS', 'Sonda de dos pines', 'Va a la tarjeta TDS', 'Potenciómetro TDS', probeObj.tds],
    ['Sensores', 'tdsb', 'Tarjeta TDS', 'TDS Meter V1.0', 'ADS1115 #1 A2', 'Potenciómetro TDS', tdsB],
    ['Sensores', 'turb_in', 'Sensor de turbidez (entrada)', 'Turbidez genérico', 'Va a su tarjeta adaptadora', 'Potenciómetro turbidez entrada', probeObj.turb_in],
    ['Sensores', 'tb1', 'Tarjeta de turbidez (entrada)', 'Adaptador del sensor de turbidez', 'ADS1115 #1 A3, con divisor 10k/20k', 'Potenciómetro turbidez entrada', tb1],
    ['Sensores', 'turb_out', 'Sensor de turbidez (salida)', 'Turbidez genérico', 'Va a su tarjeta adaptadora', 'Potenciómetro turbidez salida', probeObj.turb_out],
    ['Sensores', 'tb2', 'Tarjeta de turbidez (salida)', 'Adaptador del sensor de turbidez', 'ADS1115 #2 A0, con divisor 10k/20k', 'Potenciómetro turbidez salida', tb2],
    ['Sensores', 'temp', 'Temperatura', 'DS18B20 sumergible + 4.7 kΩ', 'GPIO5 (OneWire)', 'DS18B20', probeObj.temp],
    ['Sensores', 'caudal', 'Caudalímetro', 'YF-S401 (0.3–6 L/min)', 'GPIO35 (pulsos)', 'Reloj 245 Hz + compuerta AND', fm],
    ['Sensores', 'acs', 'Corriente de la bomba', 'ACS712 5 A', 'ADS1115 #2 A3', 'Potenciómetro corriente bomba', acs],
    ['Sensores', 'sonar', 'Nivel de la cesta', 'JSN-SR04T (30 cm sobre la tapa)', 'TRIG GPIO15 · ECHO GPIO34 (divisor 10k/20k)', 'HC-SR04', sonarG],
    ['Energía', 'gen', 'Generador', 'Motor DC RS-775 reciclado', 'Lo mueve el molino · divisor 100k/10k a ADS1115 #2 A2', 'Deslizador generador', gen],
    ['Energía', 'diodo', 'Diodo Schottky', 'SR1060 (10 A)', 'Evita que la batería regrese corriente al motor', '—', diodo],
    ['Energía', 'tvs', 'Supresor de picos', 'Diodo TVS 1.5KE33A', 'Corta picos de voltaje del generador', '—', tvs],
    ['Energía', 'xl', 'Cargador', 'XL4015 CC/CV 5 A', 'Tope de 12.6 V; aguanta hasta 36 V de entrada', '—', xl],
    ['Energía', 'bat', 'Batería', '6 celdas 18650 recicladas (3S2P) + BMS 3S', '≈40 Wh · divisor 100k/33k a ADS1115 #2 A1', 'Deslizador batería', bat],
    ['Energía', 'buck5', 'Reductor a 5 V', 'LM2596', 'Alimenta el ESP32 y los sensores', '—', buck5],
    ['Energía', 'buck4', 'Reductor a 4 V', 'LM2596 + capacitor 1000 µF', 'Alimenta el módem (picos de 2 A)', '—', buck4],
    ['Energía', 'fuse', 'Fusible', 'Fusible automotriz 5 A', 'Salida de la batería', '—', fuse],
    ['Energía', 'freno', 'Freno del molino', 'Resistencia 10 Ω 50 W (aluminio)', 'En paralelo al generador, sumergida', 'LED naranja (GPIO14)', brakeG],
    ['Actuadores', 'bomba', 'Bomba', 'Mini bomba sumergible 12 V (800 L/h)', 'Por MOSFET en GPIO27', 'LED azul', pumpG],
    ['Actuadores', 'fetb', 'MOSFET de la bomba', 'D4184', 'GPIO27', 'LED azul', fetB],
    ['Actuadores', 'fetf', 'MOSFET del freno', 'D4184', 'GPIO14', 'LED naranja', fetF]
  ].map(([grupo, key, nombre, modelo, conexion, wokwi, obj]) => ({ grupo, key, nombre, modelo, conexion, wokwi, obj }));

  const selBox = new THREE.Box3(), selHelper = new THREE.Box3Helper(selBox, 0x35d0e0);
  selHelper.visible = false; root.add(selHelper);
  const selFill = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x35d0e0, transparent: true, opacity: 0.18, depthWrite: false }));
  selFill.visible = false; selFill.renderOrder = 5; root.add(selFill);
  const dentro = (o, g) => { let p = o; while (p) { if (p === g) return true; p = p.parent; } return false; };
  const enCaja = o => dentro(o, ebox);
  let sel = null, selMats = [];
  function seleccionarComponente(key) {
    selMats.forEach(([m, orig]) => { m.material = orig; }); selMats = [];
    sel = componentes.find(c => c.key === key) || null;
    selHelper.visible = selFill.visible = !!sel;
    domeG.visible = !(sel && enCaja(sel.obj));          // el domo tapa la caja: se oculta mientras se revisa
    upperG.visible = !(sel && enCaja(sel.obj) && !dentro(sel.obj, upperG));   // la planta alta tapa la de abajo
    if (!sel) return null;
    sel.obj.traverse(o => { if (o.isMesh && o.material && 'emissive' in o.material) { const c = o.material.clone(); c.emissive = new THREE.Color(0x35d0e0); selMats.push([o, o.material]); o.material = c; } });
    return sel;
  }
  function vistaComponente(key) {
    const c = componentes.find(q => q.key === key); if (!c) return null;
    body.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(c.obj), center = b.getCenter(V3(0, 0, 0)), size = b.getSize(V3(0, 0, 0)).length();
    const local = body.worldToLocal(center.clone());
    const box_ = enCaja(c.obj), dir = box_ ? V3(0.3, 1, 0.45) : local.y > 0.03 ? V3(0.45, 0.85, 0.6) : local.y < -0.3 ? V3(0.75, 0.05, 0.9) : V3(0.8, 0.35, 0.75);
    const dist = Math.min(0.8, Math.max(box_ ? 0.09 : 0.14, size * (box_ ? 2.2 : 3)));
    const cam = body.localToWorld(local.clone().add(dir.normalize().multiplyScalar(dist)));
    return { target: center, cam };
  }

  // ---------- Peces ----------
  const fishMat = M(0x7d8c6a, { roughness: 0.6 }), fishBelly = M(0xc9cdb0);
  const makeFish = (s, parent) => {
    const g = new THREE.Group(), b = mesh(new THREE.SphereGeometry(0.04, 12, 8), fishMat, g); b.scale.set(2.2, 0.85, 0.55);
    mesh(new THREE.SphereGeometry(0.035, 10, 6), fishBelly, g, 0.01, -0.012, 0).scale.set(1.8, 0.5, 0.45);
    const tail = new THREE.Group(); tail.position.x = -0.08; g.add(tail);
    const t = mesh(new THREE.ConeGeometry(0.03, 0.055, 4), fishMat, tail, -0.025, 0, 0); t.rotation.z = Math.PI / 2; t.scale.set(1, 1, 0.25);
    g.scale.setScalar(s); parent.add(g); return { g, tail };
  };
  const fishes = Array.from({ length: 8 }, (_, i) => ({ ...makeFish(0.8 + Math.random() * 0.6, root), x: -4 + i, z0: (Math.random() - 0.5) * 3, d: Math.random(), sp: 0.15 + Math.random() * 0.12, ph: Math.random() * 6 }));
  const escapeFish = makeFish(0.7, body);

  // ---------- Partículas: toma → filtros → cámara de salida → bomba → caudalímetro → río ----------
  const PN = 360, pGeo = new THREE.BufferGeometry(), pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3);
  const parts = Array.from({ length: PN }, () => ({ u: Math.random(), th: Math.random() * Math.PI * 2, j: Math.random() }));
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.012, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  points.frustumCulled = false; body.add(points);
  const dirty = new THREE.Color(0x9a7440), clean = new THREE.Color(0x6fe3f5), tmpC = new THREE.Color();
  const U = { fun: 0.12, col: 0.62, bowl: 0.78, noz: 0.86 };
  function particlePos(p, out) {
    const { u, th, j } = p; let r, y, a = th;
    if (u < U.fun) { const k = u / U.fun; y = -0.025 - k * 0.115; r = k < 0.15 ? C.colR + 0.03 * (1 - k / 0.15) : C.colR * (1 - 0.7 * k) * (0.3 + 0.65 * j); a += k * 0.4; }
    else if (u < U.col) { const k = (u - U.fun) / (U.col - U.fun); y = C.colTop - k * (C.colTop - C.colBottom); r = (C.colR - 0.03) * (0.15 + 0.8 * j); a += 0.4 + k * 0.6; }
    else if (u < U.bowl) { const k = (u - U.col) / (U.bowl - U.col); y = -0.41 - k * 0.09; r = lerpProfile(C.bowl, y) * (0.3 + 0.55 * j) * (1 - 0.6 * k); a += 1.0 + k * 1.5; }
    else if (u < U.noz) { const k = (u - U.bowl) / (U.noz - U.bowl); out.set(-k * 0.14, -0.525 - 0.01 * k, (j - 0.5) * 0.008); return; }
    else { const k = (u - U.noz) / (1 - U.noz); out.set(-0.14 - k * 0.8, C.nozzleBottom - k * 0.06 - j * 0.04 * k, Math.sin(a) * (0.01 + k * 0.15) * j); return; }
    out.set(Math.cos(a) * r, y, Math.sin(a) * r);
  }

  // ---------- Pulsos de energía y datos sobre los cables ----------
  const flows = [];
  function flow(pts, color, kind, n = 3) {
    const curve = new THREE.CatmullRomCurve3(pts.map(q => q.isVector3 ? q : V3(...q)));
    const dots = Array.from({ length: n }, () => mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color }), body));
    flows.push({ curve, dots, kind, ph: Math.random() });
  }
  flow([[0.283, 0.05, 0], [0.2, 0.085, 0.03], [0.1, C.deck + 0.03, 0.02], [0.07, boxY - 0.01, -0.05], [-0.065, boxY + 0.012, 0.0]], 0xf2a516, 'gen');
  flow([[-0.065, boxY + 0.012, 0.0], [0.07, boxY - 0.01, -0.05], [0.09, C.deck + 0.025, 0.03], [0.2, 0.03, 0.01], [0.221, -0.06, 0.01], [0.262, -0.19, 0.003]], 0xf2a516, 'charge');
  flow([[0.09, C.deck + 0.026, 0.035], [0.2, 0.03, 0.02], [0.222, -0.12, 0.03], [0.24, -0.36, 0.05], [0.27, -0.44, 0.06]], 0xff5a2a, 'brake');
  flow([[0.0, boxY - 0.012, 0.05], [dTop.x, C.deck + 0.03, dTop.z], [dp.x, -0.1, dp.z], [dp.x, -0.38, dp.z], [0.05, -0.45, 0.05], [0.0, -0.5, 0.02]], 0x35d0e0, 'pump');
  flow([[dp.x, -0.3, dp.z], [dp.x, -0.1, dp.z], [dTop.x, C.deck + 0.03, dTop.z], [0.0, (boxY + C.deck) / 2, 0.11], [0.0, boxY + 0.01, 0.03]], 0xffffff, 'data');

  // ---------- Simulación (mismas reglas que sketch.ino) ----------
  const sim = { t: 0, omega: 0, batWh: C.battery.wh * 0.8, pGen: 0, pCharge: 0, load: 0, genV: 0, brake: false, pump: true, cycles: 1, liters: 0,
    trash: 0, kg: 0, bodyY: 0, water: 0, sat: ETAPAS_FILTRO.map(e => e.sat0), mode: 'filtrando', resting: false, tension: 0, flow: 0, hi: -1,
    yaw: opts.flowAngle || 0, flowAngle: 0, drift: 0, tilt: 0, flapK: 0, v: 0 };
  let bodyInit = false;

  // Paquete en vivo del ESP32 (DeviceTelemetryDto del backend). Cuando llega, manda sobre la
  // simulación local: el modelo enseña lo mismo que sale de Wokwi. `null` = simular solo.
  let ext = null;
  const has = x => typeof x === 'number' && Number.isFinite(x);
  function aplicarTelemetria(t) { ext = t ?? null; }
  const congelado = !!opts.congelado;
  // Filtrado medido por el ESP32 (turbidez entrada vs salida); null si no vino (p. ej., sin flujo).
  function eficienciaMedida() {
    const tin = ext?.values?.turb_in_ntu, tout = ext?.values?.turb_out_ntu;
    return has(tin) && has(tout) && tin > 0 ? Math.min(1, Math.max(0, 1 - tout / tin)) : null;
  }
  const batV = () => C.battery.vMin + (C.battery.vMax - C.battery.vMin) * sim.batWh / C.battery.wh;

  function update(dt, s = {}) {
    dt = Math.min(dt, 0.05); sim.t += dt;
    const v = Math.max(0, has(ext?.generator_v) ? ext.generator_v / (ext.brake_on ? 0.75 : 1) / C.genVPerMs : (s.current ?? 0.8)), water = s.waterLevel ?? 0, ts = s.timeScale ?? C.timeScale, fa = s.flowAngle ?? 0;
    sim.water = water; sim.flowAngle = fa; sim.v = v;

    // Freno (resistencia de descarga): mismos umbrales que controlarFreno()
    // El voltaje medido baja cuando la resistencia carga al generador.
    const vb = batV(), open = v < C.cutIn ? 0 : Math.min(C.genVMax, C.genVPerMs * v);
    const meas = sim.brake ? 0.75 * open : open;
    if (!sim.brake && (meas > C.brake.genOn || (vb >= C.brake.batOn && meas > vb))) sim.brake = true;
    if (sim.brake && meas < C.brake.genOff && vb < C.brake.batOff) sim.brake = false;
    sim.genV = sim.brake ? 0.75 * open : open;
    if (typeof ext?.brake_on === 'boolean') sim.brake = ext.brake_on;
    if (has(ext?.generator_v)) sim.genV = ext.generator_v;

    const target = v < C.cutIn ? 0 : W.tsr * v / rMid * (sim.brake ? 0.6 : 1);
    sim.omega += (target - sim.omega) * Math.min(1, dt * 1.0);
    sim.pGen = target > 0 ? 0.5 * 1000 * W.gapArea * v ** 3 * W.cp * C.genEff * Math.min(1, sim.omega / target) : 0;
    // El XL4015 sigue cargando hasta que la batería se llena; lo que sobra se va a la resistencia.
    sim.pCharge = sim.batWh >= C.battery.wh * 0.995 ? 0 : Math.min(sim.pGen, C.maxChargeW);

    // Bomba por ciclos: mismos umbrales que controlarBomba()
    if (has(ext?.battery_pct)) sim.batWh = C.battery.wh * Math.min(100, Math.max(0, ext.battery_pct)) / 100;
    const pct = sim.batWh / C.battery.wh, was = sim.pump;
    if (sim.pump && pct < C.cycle.stopBelow) sim.pump = false;
    if (!sim.pump && pct > C.cycle.startAbove) sim.pump = true;
    if (sim.pump && !was) sim.cycles++;
    if (typeof ext?.pump_on === 'boolean') sim.pump = ext.pump_on;
    if (has(ext?.pump_cycles)) sim.cycles = ext.pump_cycles;
    sim.mode = pct < 0.05 ? 'sin energía' : sim.pump ? 'filtrando' : 'cargando';
    const on = sim.pump && sim.mode !== 'sin energía';

    let dYaw = fa - sim.yaw; dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    sim.yaw += dYaw * Math.min(1, dt * 0.9 * Math.min(1.5, v));

    const floatY = water + C.freeboard + Math.sin(sim.t * 1.3) * 0.008;
    const restY = bedY + 0.01 - MO.cageBottom;
    sim.resting = floatY < restY; const targetY = Math.max(floatY, restY);
    sim.drift += ((sim.resting ? 0 : 0.12 * v * v) - sim.drift) * Math.min(1, dt * 1.5);
    sim.tilt += ((sim.resting ? 0 : 0.05 * v * v) - sim.tilt) * Math.min(1, dt * 1.5);
    if (has(ext?.tilt_deg)) sim.tilt = deg(ext.tilt_deg);
    sim.tension = 0.5 * 1000 * MO.dragCd * MO.dragArea * v * v / (2 * Math.cos(deg(MO.angles[0])));
    if (!bodyInit) { sim.bodyY = targetY; bodyInit = true; }
    sim.bodyY += (targetY - sim.bodyY) * Math.min(1, dt * 3);
    body.position.set(-sim.drift * Math.cos(fa), sim.bodyY, sim.drift * Math.sin(fa));
    body.rotation.set(0, sim.yaw, sim.tilt + Math.sin(sim.t * 1.1) * 0.004);
    mount.position.set(body.position.x, sim.bodyY + MO.cageBottom, body.position.z);
    updateMoor();
    const submerged = sim.bodyY <= water + 0.04;
    sim.flow += (((on && submerged) ? 1 : 0) - sim.flow) * Math.min(1, dt * 2);

    sim.load = C.loads.base + (on ? C.loads.pump : 0);
    if (!congelado) {
      sim.batWh = Math.min(C.battery.wh, Math.max(0, sim.batWh + (sim.pCharge - sim.load) * dt * ts / 3600));
      sim.liters += C.pumpLpm * sim.flow * dt * ts / 60;
    }
    if (has(ext?.water_liters_total)) sim.liters = ext.water_liters_total;
    if (has(ext?.basket_fill_pct)) sim.kg = B.capKg * Math.min(100, Math.max(0, ext.basket_fill_pct)) / 100;
    if (!congelado) ETAPAS_FILTRO.forEach((e, i) => { sim.sat[i] = Math.min(1, sim.sat[i] + dt * sim.flow * e.rate * C.satSpeed); });

    wheel.rotation.y -= sim.omega * dt;
    pinion.rotation.y += sim.omega * (W.rIn / 0.018) * dt;
    imp.rotation.y += sim.flow * 30 * dt;
    brakeGlow.material.opacity = sim.brake ? 0.55 + 0.25 * Math.sin(sim.t * 8) : 0;

    sim.flapK = Math.max(0, sim.flapK - dt * 1.5);
    flaps.forEach((f, i) => { f.rotation.z = -(0.12 + 0.15 * v + 0.6 * sim.flapK * (0.6 + 0.4 * Math.sin(sim.t * 4 + i))); });
    trashIn.forEach((o, i) => { o.visible = i < Math.min(trashIn.length, Math.round(36 * Math.min(1, sim.kg / B.capKg))); });

    const showFish = s.showFish !== false, ca = Math.cos(fa), sa = Math.sin(fa);
    fishes.forEach(f => {
      f.g.visible = showFish;
      f.x += f.sp * dt; if (f.x > 4.5) { f.x = -4.5; f.z0 = (Math.random() - 0.5) * 3; f.d = Math.random(); }
      let z = f.z0 + Math.sin(sim.t * 0.6 + f.ph) * 0.12;
      const R = 0.95; if (Math.abs(f.x) < R) { const m = Math.sqrt(R * R - f.x * f.x); if (Math.abs(z) < m) z = (z >= 0 ? 1 : -1) * m; }
      if (f.x < -0.5 && f.x > -2.2 && Math.abs(z) < 0.5) z = (z >= 0 ? 1 : -1) * 0.5;
      const yMin = bedY + 0.12, yMax = water - 0.45, y = yMax < yMin ? (yMin + water) / 2 : yMax - f.d * (yMax - yMin) * 0.85;
      f.g.position.set(f.x * ca + z * sa, y + Math.sin(sim.t + f.ph) * 0.015, -f.x * sa + z * ca);
      f.g.rotation.y = fa - Math.cos(sim.t * 0.6 + f.ph) * 0.15;
      f.tail.rotation.y = Math.sin(sim.t * 9 + f.ph) * 0.5;
    });
    {
      escapeFish.g.visible = showFish;
      const p = (sim.t / 10) % 1, hx = B.holeX; let x, y, z, sc = 0.7, yaw = 0, roll = 0;
      if (p < 0.35) { const k = p / 0.35; x = B.x0 - 0.15 - 0.15 * Math.sin(k * 6); y = -0.08; z = 0.12 * Math.sin(k * 9); yaw = Math.cos(k * 6) > 0 ? Math.PI : 0; sc *= Math.min(1, k * 6); }
      else if (p < 0.55) { const k = (p - 0.35) / 0.2; x = hx + (B.x0 - 0.15 - hx) * (1 - k) * 0.3; y = -0.08 - k * 0.24; z = 0; roll = -1.2; }
      else { const k = (p - 0.55) / 0.45; x = hx + k * 0.3; y = -0.32 - k * 0.12; z = k * 1.0; yaw = -0.9; sc *= Math.min(1, (1 - k) * 5); }
      escapeFish.g.position.set(x, y, z); escapeFish.g.rotation.set(0, yaw, roll); escapeFish.g.scale.setScalar(Math.max(0.001, sc));
      escapeFish.tail.rotation.y = Math.sin(sim.t * 10) * 0.5;
    }

    if (sel) { selBox.setFromObject(sel.obj); selBox.expandByScalar(0.004); selBox.getCenter(selFill.position); selBox.getSize(selFill.scale); const k = 0.4 + 0.4 * Math.sin(sim.t * 5); selMats.forEach(([o]) => { o.material.emissiveIntensity = k; }); }
    stageMeshes.forEach((st, i) => { const hl = sim.hi === i ? 0.35 + 0.35 * Math.sin(sim.t * 6) : 0; st.mat.emissive.setHex(0x35d0e0); st.mat.emissiveIntensity = hl; });

    const p2 = sim.batWh / C.battery.wh;
    batBar.scale.y = Math.max(0.005, p2 * 0.1); batBar.position.y = -0.05 + p2 * 0.05;
    batBar.material.color.setHex(p2 > 0.5 ? 0x34d17a : p2 > 0.2 ? 0xf2a516 : 0xe0533d);

    points.visible = s.showFlow !== false;
    if (points.visible) {
      const tmp = V3(0, 0, 0), e = eficienciaMedida() ?? turbEff();
      parts.forEach((p, i) => {
        p.u = (p.u + dt * 0.1 * sim.flow) % 1;
        particlePos(p, tmp); pPos[i * 3] = tmp.x; pPos[i * 3 + 1] = tmp.y; pPos[i * 3 + 2] = tmp.z;
        const k = p.u < U.fun ? 0 : p.u < U.col ? (p.u - U.fun) / (U.col - U.fun) * e : e;
        tmpC.copy(dirty).lerp(clean, k); pCol[i * 3] = tmpC.r; pCol[i * 3 + 1] = tmpC.g; pCol[i * 3 + 2] = tmpC.b;
      });
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    }

    const showE = s.showEnergy !== false;
    flows.forEach(L => {
      const speed = L.kind === 'gen' ? Math.min(0.9, sim.pGen / 8) : L.kind === 'charge' ? (sim.pCharge > sim.load ? 0.4 : 0) : L.kind === 'brake' ? (sim.brake && sim.pGen > sim.pCharge ? 0.6 : 0) : L.kind === 'pump' ? (on ? 0.5 : 0) : (sim.batWh > 0.3 ? 0.25 : 0);
      L.ph = (L.ph + dt * speed) % 1;
      L.dots.forEach((d, k) => { d.visible = showE && speed > 0.01; d.position.copy(L.curve.getPointAt((L.ph + k / L.dots.length) % 1)); });
    });
  }

  function effs() { return ETAPAS_FILTRO.map((e, i) => e.base * (1 - Math.pow(sim.sat[i], 3))); }
  function turbEff() { const E = effs(); return 1 - (1 - E[0]) * (1 - 0.3 * E[1]); }

  // Mismos 14 datos y unidades que el JSON del firmware.
  function lecturasSimuladas() {
    const t = sim.t, n = (a, f = 1) => a * Math.sin(t * f) + a * 0.5 * Math.sin(t * f * 2.7 + 1);
    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
    const E = effs(), flowing = sim.flow > 0.05;
    const ph_in = clamp(6.7 + n(0.3, 0.2), 0, 14);
    const turb_in = clamp(82 + n(8, 0.4), 0, 1000);
    const calc = flowing && ph_in < 7 ? (7 - ph_in) * 0.6 * E[3] : 0;
    const r = {
      // Sin flujo las sondas de salida están en agua estancada: no hay dato (igual que el firmware).
      ph_in, ph_out: flowing ? clamp(ph_in + calc + n(0.03, 0.9), 0, 14) : null,
      tds: clamp(690 + n(20, 0.15), 0, 1000), temp: 19.4 + n(0.3, 0.05),
      turb_in, turb_out: flowing ? turb_in * (1 - turbEff()) : null,
      caudal_lpm: C.pumpLpm * sim.flow, litros: sim.liters,
      cesta_pct: Math.min(100, 100 * sim.kg / B.capKg),
      bat_pct: 100 * sim.batWh / C.battery.wh, gen_v: sim.genV,
      bomba_a: sim.flow > 0.05 ? C.pumpA * sim.flow : 0, bomba_on: sim.pump ? 1 : 0,
      inclinacion: Math.abs(sim.tilt) * 180 / Math.PI
    };
    // Con paquete en vivo, la calidad del agua es la que midió el ESP32.
    const q = ext?.values ?? {};
    [['ph_in', q.ph], ['ph_out', q.ph_out], ['tds', q.tds_ppm], ['temp', q.temp_c], ['turb_in', q.turb_in_ntu], ['turb_out', q.turb_out_ntu],
     ['caudal_lpm', ext?.flow_rate_lpm], ['bomba_a', ext?.pump_current_a]].forEach(([k, x]) => { if (has(x)) r[k] = x; });
    const stages = ETAPAS_FILTRO.map((e, i) => { const sat = sim.sat[i]; return { key: e.key, sat, eff: E[i], estado: sat > 0.85 ? 'Cambiar' : sat > 0.65 ? 'Próximo cambio' : 'OK' }; });
    return { ...r, stages };
  }

  function telemetria() {
    const wheelRpm = sim.omega * 60 / (2 * Math.PI);
    let err = sim.flowAngle - sim.yaw; err = Math.atan2(Math.sin(err), Math.cos(err));
    const fill = Math.min(1, sim.kg / B.capKg);
    return {
      diseno: D, wheelRpm, generatorRpm: wheelRpm * W.rIn / 0.018, powerGenW: sim.pGen, chargeW: sim.pCharge, loadW: sim.load,
      genV: sim.genV, brake: sim.brake, pumpOn: sim.pump, pumpA: sim.flow > 0.05 ? C.pumpA * sim.flow : 0, pumpCycles: sim.cycles,
      batteryPct: 100 * sim.batWh / C.battery.wh, batteryV: batV(), batteryWh: sim.batWh, netW: sim.pCharge - sim.load,
      mode: sim.resting ? 'apoyada en el fondo' : 'anclada', powerMode: sim.mode,
      tensionKN: sim.tension / 1000, driftM: sim.drift, tiltDeg: Math.abs(sim.tilt) * 180 / Math.PI, intakeSubmerged: sim.bodyY <= sim.water + 0.04,
      headingDeg: sim.yaw * 180 / Math.PI, headingErrorDeg: err * 180 / Math.PI,
      flowLpm: C.pumpLpm * sim.flow, litersTotal: sim.liters,
      intakeVelocity: (C.pumpLpm * sim.flow / 60000) / (16 * 0.035 * 0.04),
      basketFillPct: 100 * fill, sonarCm: C.sonar.distEmpty - fill * (C.sonar.distEmpty - C.sonar.distFull),
      trashPieces: sim.trash, trashKgEstimado: sim.kg, bodyY: sim.bodyY, saturation: [...sim.sat]
    };
  }

  function setRayosX(on) {
    [shellMat, bowlMat].forEach(m => { m.opacity = on ? 0.14 : 0.45; m.needsUpdate = true; });
    floatMat.opacity = on ? 0.4 : 1; floatMat.depthWrite = !on; floatMat.needsUpdate = true;
    const dm2 = body.userData.dome; if (dm2) { dm2.opacity = on ? 0.35 : 1; dm2.depthWrite = !on; dm2.needsUpdate = true; }
  }
  function registrarBasura(kg = 0.05) { sim.trash++; sim.kg += kg; sim.flapK = 1; }
  function vaciarCesta() { sim.kg = 0; sim.trash = 0; }
  function cambiarCartuchos() { sim.sat = ETAPAS_FILTRO.map(() => 0.02); }
  function resaltarEtapa(i) { sim.hi = i == null ? -1 : i; }
  function bocaCesta() { return { x: B.x0, y: sim.bodyY - 0.01, halfW: B.halfW, offsetX: -sim.drift, boom: BOOM, full: sim.kg >= B.capKg }; }
  function localAMundo(x, y, z) { body.updateMatrixWorld(true); return body.localToWorld(V3(x, y, z)); }

  const etiquetas = [
    ['electronica', 'Caja: ESP32, 2 ADS1115, módem 4G, tarjetas de sondas', 0, 0, 0],
    ['antena', 'Antena LTE del módem A7670SA', 1],
    ['domo', 'Domo: garrafón o cono', 1],
    ['toma', 'Toma lateral con malla fina', 1],
    ['molino', 'Molino de PVC entre los anillos de PET', 0, 1, 1], ['generador', 'Motor RS-775 reciclado como generador', 1, 1],
    ['rejilla', 'Hueco con rejilla anti-peces'], ['sensores', 'Entrada: pH, TDS, turbidez y temperatura', 1, 0, 1],
    ['filtros', '4 capas: arena, carbón, zeolita, calcita', 0, 0, 1], ['ducto', 'Ducto interno de cables', 1],
    ['bateria', '6 celdas 18650 recicladas (3S2P) + BMS', 0, 1], ['freno', 'Resistencia de descarga (freno)', 0, 1],
    ['salida', 'Salida: pH y turbidez', 1], ['bomba', 'Bomba 12 V', 0, 0, 1], ['caudal', 'Caudalímetro YF-S401', 0, 0, 1],
    ['barreras', 'Barreras con faldón de 10 cm', 1, 0, 1],
    ['cesta', 'Cesta (huacal) con tapa de malla', 0, 0, 1], ['compuerta', 'Compuertas de no retorno', 0, 0, 1], ['nivel', 'Ultrasónico JSN-SR04T (30 cm sobre la tapa)', 1],
    ['escape', 'Salida para peces', 0, 0, 1], ['veleta', 'Veleta: la mantiene contra la corriente', 0, 0, 1],
    ['giro', 'Anillo giratorio (las líneas no giran)', 0],
    ['jaula', 'Jaula de varilla', 0, 0, 1], ['linea', 'Cuerda de polipropileno', 0], ['cadena', '1.5 m de cadena', 0], ['ancla', 'Ancla helicoidal', 1], ['lastre', 'Cubeta con concreto', 1]
  ];

  return { diseno: D, etiquetas, componentes, seleccionarComponente, vistaComponente, root, body, anchors, update, telemetria, lecturasSimuladas, aplicarTelemetria, registrarBasura, vaciarCesta, cambiarCartuchos, resaltarEtapa, bocaCesta, bocaRed: bocaCesta, setRayosX, localAMundo, config: C };
}
