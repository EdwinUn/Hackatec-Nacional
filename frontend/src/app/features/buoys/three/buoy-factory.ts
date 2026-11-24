// @ts-nocheck
// =====================================================================
//  Río Monitor buoy · 3D core ported from the design artifact
//  ("Boya Río Monitor: dos diseños", v7). Untyped on purpose: ~700 lines of
//  procedural geometry copied almost verbatim so it stays easy to resync
//  with the artifact. The typed API lives in `buoy-model.ts`.
//  Changes vs the artifact: ES module `three` import instead of the global,
//  and `colorSpace` instead of the removed `sRGBEncoding` (three r152+).
// =====================================================================
import * as THREE from 'three';

export const BOYA_CFG = {
  ringR: 0.46, ringTube: 0.06, ringTopY: 0.0, ringBotY: -0.24,
  colR: 0.2, deck: 0.04, colTop: -0.14, colBottom: -0.4,
  bowl: [[0.2, -0.41], [0.2, -0.44], [0.12, -0.48], [0.05, -0.5]],
  nozzleBottom: -0.55,
  wheel: { rIn: 0.24, rOut: 0.38, yTop: -0.05, yBot: -0.19, blades: 10, cp: 0.2, tsr: 0.8, gapArea: 0.091 },
  box: { w: 0.2, d: 0.15, h: 0.075 },                                  // caja estanca de KnowFlow: 200×150×75 mm
  duct: { a: 92, r: 0.16 },                                            // ducto interno de cables (grados, radio)
  cut: [70, 115],                                                      // corte para ver el interior de los discos
  legAngles: [0, 120, 240], legTopR: 0.56, legTipR: 0.9, legSleeve: 0.6, augerLen: 0.2, legBaseAnchor: 0.35,
  bedClearance: 0.12, freeboard: 0.0, digRate: 0.12,
  moor: { angles: [35, -35, 180], ringR: 0.34, anchorR: 3.0, maxDepth: 3.0, slack: 1.08, cageR: 0.3, cageBottom: -0.56, dragCd: 1.0, dragArea: 0.62 },
  battery: { wh: 77, v: 12.8 },                                        // LiFePO4 4S (4 celdas 32700 de 6 Ah)
  genEff: 0.7, maxGenW: 25,
  loads: { base: 2.2, uv: 3, centri: 6, augers: 15 },
  cycle: { stopBelow: 0.35, startAbove: 0.75 },
  pumpLpm: 3,
  basket: { x0: -0.62, len: 0.8, halfW: 0.36, top: 0.14, bottom: -0.25, lip: -0.04, holeX: -1.17, holeR: 0.07, capKg: 4 },
  vane: { x0: -1.48, len: 0.5, yTop: -0.04, yBot: -0.4 },
  timeScale: 600, satSpeed: 0.006
};

export const ETAPAS_FILTRO = [
  { key: 'sed', nombre: 'Malla + sedimentos 50→5 µm', contaminante: 'Sólidos suspendidos y arena', sensor: 'Turbidez · DFRobot SEN0189', ind: 'turb', unidad: 'NTU', dec: 1, color: 0xeae3cf, base: 0.72, rate: 1.0, sat0: 0.32, tex: 'fibra' },
  { key: 'gac', nombre: 'Carbón activado granular', contaminante: 'Químicos orgánicos, colorantes textiles, plaguicidas', sensor: 'Absorbancia UV 254 nm (opcional)', ind: 'uv254', unidad: '1/m', dec: 1, color: 0x2a2d30, base: 0.7, rate: 0.8, sat0: 0.48, tex: ['#141516', '#2b2e31', '#3b3f43', '#0c0c0d'] },
  { key: 'res', nombre: 'Zeolita + resina quelante', contaminante: 'Metales pesados: Pb, Cd, Cr, Ni', sensor: 'Electrodo selectivo Pb²⁺ (opcional)', ind: 'pb', unidad: 'µg/L', dec: 1, color: 0xc98a2b, base: 0.85, rate: 1.3, sat0: 0.62, tex: ['#c98a2b', '#e0a443', '#a86d1c', '#d8c7a6', '#bfb39a'] },
  { key: 'kdf', nombre: 'KDF-55 (cobre-zinc)', contaminante: 'Metales disueltos residuales, cloro, oxidantes', sensor: 'Conductividad · DFR0300 (KnowFlow)', ind: 'ec', unidad: 'µS/cm', dec: 0, color: 0xb87333, base: 0.6, rate: 0.6, sat0: 0.38, tex: ['#b87333', '#d4a25a', '#8f8a7a', '#c7b07a'] },
  { key: 'cal', nombre: 'Calcita / dolomita', contaminante: 'pH fuera de rango por descargas industriales', sensor: 'pH · SEN0161-V2 (KnowFlow)', ind: 'ph', unidad: '', dec: 2, color: 0xefece4, base: 0.8, rate: 0.5, sat0: 0.22, tex: ['#f3f1ea', '#e0dbcf', '#cfc8b8', '#ffffff'] },
  { key: 'uv', nombre: 'UV-C LED 275 nm', contaminante: 'Coliformes fecales y E. coli', sensor: 'Fotodiodo UV-C (GUVC-S10GD)', ind: 'uvi', unidad: 'mW/cm²', dec: 2, color: 0x8f6bff, base: 0.99, rate: 0.4, sat0: 0.15, tex: null }
];

export const SENSORES_KNOWFLOW = [
  { key: 'ph', type: 'ph', nombre: 'pH', unidad: '', dec: 2, modulo: 'Gravity pH V2 (SEN0161-V2) · ADS1115 A1', color: 0x2f6fd6 },
  { key: 'orp', type: 'orp', nombre: 'ORP', unidad: 'mV', dec: 0, modulo: 'Gravity ORP (SEN0165) · ADS1115 A2', color: 0x7b61d9 },
  { key: 'ec', type: 'conductivity', nombre: 'Conductividad', unidad: 'µS/cm', dec: 0, modulo: 'Gravity EC K=1 (DFR0300) · ADS1115 A0', color: 0x12a37f },
  { key: 'tds', type: 'tds', nombre: 'TDS', unidad: 'ppm', dec: 0, modulo: 'Calculado de EC', color: 0x12a37f },
  { key: 'do', type: 'dissolved_oxygen', nombre: 'Oxígeno disuelto', unidad: 'mg/L', dec: 2, modulo: 'Gravity DO (SEN0237) · GPIO33', color: 0xe0533d },
  { key: 'temp', type: 'temperature', nombre: 'Temperatura', unidad: '°C', dec: 1, modulo: 'DS18B20 sumergible · GPIO5 (OneWire)', color: 0xd9dde0 },
  { key: 'turb', type: 'turbidity', nombre: 'Turbidez', unidad: 'NTU', dec: 1, modulo: 'SEN0189 · ADS1115 A3', color: 0xf0f0f0 },
  { key: 'uv254', type: 'uv254', nombre: 'Orgánicos (UV 254)', unidad: '1/m', dec: 1, modulo: 'Sensor UV254 (opcional) · ADS1115 #2', color: 0x444444 },
  { key: 'pb', type: 'lead', nombre: 'Plomo (Pb²⁺)', unidad: 'µg/L', dec: 1, modulo: 'ISE Pb²⁺ (opcional) · ADS1115 #2', color: 0x999999 }
];

export function createBoyaRioMonitor(opts = {}) {
  const C = BOYA_CFG, W = C.wheel, B = C.basket, MO = C.moor, BX = C.box, VN = C.vane;
  const bedY = opts.bedY ?? -3.2, D = opts.diseno === 'anclada' ? 'anclada' : 'patas';
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

  // Texturas de medios filtrantes (granulado o fibra). Si no hay DOM, color liso.
  const texCache = {};
  function mediaTex(spec, key) {
    if (!spec || typeof document === 'undefined') return null;
    if (texCache[key]) return texCache[key];
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
    let seed = key.length * 97; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    if (spec === 'fibra') { g.fillStyle = '#efe9d8'; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 260; i++) { g.strokeStyle = rnd() > 0.5 ? '#ffffff' : '#d9d0b8'; g.lineWidth = 0.6 + rnd(); g.beginPath(); const y = rnd() * 128; g.moveTo(0, y); g.bezierCurveTo(40, y + (rnd() - 0.5) * 8, 90, y + (rnd() - 0.5) * 8, 128, y + (rnd() - 0.5) * 4); g.stroke(); } }
    else { g.fillStyle = spec[0]; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 1100; i++) { g.fillStyle = spec[Math.floor(rnd() * spec.length)]; g.beginPath(); g.arc(rnd() * 128, rnd() * 128, 0.8 + rnd() * 2.2, 0, Math.PI * 2); g.fill(); } }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    return (texCache[key] = t);
  }

  const root = new THREE.Group(); root.name = 'BoyaRioMonitorV7';
  const body = new THREE.Group(); body.name = 'cuerpo'; root.add(body);
  const mount = new THREE.Group(); mount.name = 'anillo-giratorio'; root.add(mount);   // no gira con la veleta
  const anchors = {};
  const anchor = (name, parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); anchors[name] = o; return o; };

  const floatMat = M(0xdbe5ea, { roughness: 0.35, transparent: true, opacity: 1 }), bandMat = M(0x8fa3ab);
  const steel = M(0x5c6870, { metalness: 0.6, roughness: 0.35 }), inox = M(0xc9ced2, { metalness: 0.85, roughness: 0.25 });
  const rimMat = M(0x3d4a52, { metalness: 0.4 }), dark = M(0x2b3238, { metalness: 0.4, roughness: 0.35 });
  const black = M(0x18191a, { roughness: 0.6 }), red = M(0xc0392b), brass = M(0xc9a24a, { metalness: 0.8, roughness: 0.3 });
  const pcbBlue = M(0x1f5fbf, { roughness: 0.5 }), pcbBlack = M(0x1b1d1f, { roughness: 0.5 }), pcbGreen = M(0x1f7a3a), pcbPurple = M(0x5b3a9a);
  const gland = (p, x, y, z, dir = -1) => { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.004, 6), black, g, 0, dir * 0.002, 0); cyl(0.006, 0.01, black, g, 0, dir * 0.009, 0, 10); return g; };

  // ---------- Dos tubos de PET con hueco ----------
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

  // ---------- Molino Savonius (aro apoyado en 3 rodillos, sin rayos: deja libre el paso de cables) ----------
  const wheel = new THREE.Group(); body.add(wheel);
  const bladeMat = M(0xf2b544, { side: THREE.DoubleSide, roughness: 0.45 }), wh = W.yTop - W.yBot, rMid = (W.rIn + W.rOut) / 2;
  for (let i = 0; i < W.blades; i++) { const a = i / W.blades * Math.PI * 2; const b = mesh(new THREE.CylinderGeometry(0.04, 0.04, wh - 0.01, 12, 1, true, 0, Math.PI), bladeMat, wheel, Math.cos(a) * rMid, (W.yTop + W.yBot) / 2, Math.sin(a) * rMid); b.rotation.y = Math.PI / 2 - a; }
  [W.yTop, W.yBot].forEach(y => { torusH(W.rOut, 0.006, steel, wheel, y); torusH(W.rIn, 0.006, steel, wheel, y); });
  [40, 160, 280].forEach(a => { const p = polar(a, W.rOut + 0.013, W.yBot); const r = cyl(0.012, 0.012, black, body, p.x, p.y, p.z, 12); r.rotation.x = Math.PI / 2; spoke(W.rOut + 0.02, C.ringR - C.ringTube, deg(a), W.yBot, steel, body, 0.01); });
  anchor('molino', body, Math.cos(1.95) * C.ringR, W.yBot + 0.02, Math.sin(1.95) * C.ringR);

  // Generador: motor DC 775 (12 V) usado como generador, con piñón de latón sobre el aro interior
  const gen = new THREE.Group(); gen.position.set(0.275, 0.0, 0); body.add(gen);
  cyl(0.021, 0.066, inox, gen, 0, 0.0, 0, 20); cyl(0.021, 0.008, black, gen, 0, 0.037, 0, 20);
  box(0.003, 0.008, 0.006, brass, gen, 0.008, 0.045, 0); box(0.003, 0.008, 0.006, brass, gen, -0.008, 0.045, 0);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; box(0.002, 0.04, 0.004, steel, gen, Math.cos(a) * 0.0215, 0, Math.sin(a) * 0.0215).rotation.y = -a; }
  const pinion = cyl(0.018, 0.015, brass, body, 0.258, W.yTop + 0.004, 0, 16);
  cable([[0.283, 0.048, 0.002], [0.27, 0.075, 0.02], [0.2, 0.085, 0.03], [0.1, C.deck + 0.03, 0.02]], 0.0022, 0xb3261e, body);
  cable([[0.267, 0.048, -0.002], [0.262, 0.075, 0.012], [0.2, 0.082, 0.022], [0.1, C.deck + 0.028, 0.012]], 0.0022, 0x161616, body);
  anchor('generador', body, 0.3, 0.03, 0.03);

  // ---------- Tubo central (corte para ver el interior) ----------
  const shellMat = glass(0xcfeef4, 0.14);
  mesh(new THREE.CylinderGeometry(C.colR, C.colR, C.deck - C.colBottom, 48, 1, true), shellMat, body, 0, (C.deck + C.colBottom) / 2, 0);
  torusH(C.colR, 0.008, rimMat, body, C.deck);
  // toma lateral con rejilla fina (16 ventanas con malla)
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; const w = box(0.006, 0.035, 0.04, M(0x7f9aa3, { metalness: 0.5, wireframe: true }), body, Math.cos(a) * C.colR, -0.025, Math.sin(a) * C.colR); w.rotation.y = -a; }
  anchor('toma', body, Math.cos(0.9) * C.colR, -0.025, Math.sin(0.9) * C.colR);

  // Placa porta-sondas y SONDAS DE ENTRADA (formas reales)
  const holder = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.006, 32), M(0x9aa6ad, { transparent: true, opacity: 0.85 }), body, 0, 0.01, 0);
  void holder;
  const probeSlots = [['ph', 20], ['orp', 80], ['ec', 140], ['do', 200], ['temp', 250], ['turb', 310]];
  function probe(kind, p, x, y, z) {   // y = parte superior de la sonda
    const g = new THREE.Group(); g.position.set(x, y, z); p.add(g);
    if (kind === 'ph' || kind === 'orp' || kind === 'pb' || kind === 'phS') {
      cyl(0.006, 0.1, black, g, 0, -0.05, 0, 14);
      cyl(0.0062, 0.012, M(kind === 'orp' ? 0x3a5fc8 : kind === 'pb' ? 0x7a7a7a : 0xd7dbe0), g, 0, -0.02, 0, 14);
      if (kind === 'orp') cyl(0.0042, 0.006, inox, g, 0, -0.103, 0, 12); else mesh(new THREE.SphereGeometry(0.0052, 12, 8), glass(0xe9f8ff, 0.75), g, 0, -0.102, 0);
    } else if (kind === 'ec' || kind === 'ecS') {
      cyl(0.0075, 0.09, black, g, 0, -0.045, 0, 14); box(0.002, 0.012, 0.006, inox, g, 0.003, -0.095, 0); box(0.002, 0.012, 0.006, inox, g, -0.003, -0.095, 0);
    } else if (kind === 'do') {
      cyl(0.009, 0.075, M(0x9aa1a7, { metalness: 0.5 }), g, 0, -0.0375, 0, 16); cyl(0.0095, 0.016, black, g, 0, -0.082, 0, 16); torusH(0.0095, 0.0015, red, g, -0.074, 16);
    } else if (kind === 'temp') {
      cyl(0.003, 0.05, inox, g, 0, -0.025, 0, 10); cyl(0.0035, 0.01, black, g, 0, 0.0, 0, 10);
    } else if (kind === 'turb' || kind === 'turbS') {
      box(0.022, 0.03, 0.012, M(0xf0f0f0, { transparent: true, opacity: 0.92 }), g, 0, -0.015, 0);
      box(0.007, 0.022, 0.012, M(0xf0f0f0, { transparent: true, opacity: 0.92 }), g, 0.0075, -0.041, 0); box(0.007, 0.022, 0.012, M(0xf0f0f0, { transparent: true, opacity: 0.92 }), g, -0.0075, -0.041, 0);
    } else if (kind === 'uv254') {
      cyl(0.008, 0.035, black, g, 0, -0.0175, 0, 14); cyl(0.005, 0.004, glass(0x9fd8ff, 0.8), g, 0, -0.036, 0, 12);
    } else if (kind === 'photo') {
      box(0.016, 0.003, 0.012, pcbGreen, g, 0, -0.004, 0); box(0.004, 0.002, 0.004, M(0xdddddd), g, 0, -0.0065, 0);
    }
    return g;
  }
  probeSlots.forEach(([k, a]) => {
    const p = polar(a, 0.1, 0.008); probe(k, body, p.x, p.y, p.z);
    const s = SENSORES_KNOWFLOW.find(q => q.key === k); torusH(0.0075, 0.002, M(s.color), body, p.y - 0.012).position.set(p.x, p.y - 0.012, p.z);
    gland(body, p.x, 0.013, p.z, 1);
    const q = polar(C.duct.a, C.duct.r, 0.05);
    cable([[p.x, 0.03, p.z], [p.x * 0.7 + q.x * 0.3, 0.045, p.z * 0.7 + q.z * 0.3], [q.x, 0.055, q.z]], 0.0018, 0x161616, body, 16);
  });
  anchor('sensores', body, -0.12, -0.05, 0.05);

  // Ducto interno de cables (tubo corrugado)
  const dp = polar(C.duct.a, C.duct.r, 0);
  cyl(0.011, C.deck + 0.02 - (C.colBottom + 0.01), black, body, dp.x, (C.deck + 0.02 + C.colBottom + 0.01) / 2, dp.z, 12);
  const corr = new THREE.InstancedMesh(new THREE.TorusGeometry(0.0115, 0.0016, 4, 12), black, 40);
  for (let i = 0; i < 40; i++) { dm.position.set(dp.x, C.colBottom + 0.02 + i * 0.011, dp.z); dm.rotation.set(Math.PI / 2, 0, 0); dm.updateMatrix(); corr.setMatrixAt(i, dm.matrix); }
  body.add(corr);
  anchor('ducto', body, dp.x + 0.02, -0.08, dp.z + 0.02);

  // Discos filtrantes con textura, mallas inox y o-rings; sensor por etapa en el corte
  const colH = C.colTop - C.colBottom, stH = colH / ETAPAS_FILTRO.length, stageMeshes = [];
  const thetaStart = deg(90 - C.cut[0]), thetaLen = Math.PI * 2 - deg(C.cut[1] - C.cut[0]);
  ETAPAS_FILTRO.forEach((e, i) => {
    const yc = C.colTop - stH * (i + 0.5), tex = mediaTex(e.tex, e.key);
    let mat;
    if (e.key === 'uv') {
      mat = new THREE.MeshStandardMaterial({ color: 0xd9ccff, emissive: 0x6a3cff, emissiveIntensity: 0.9, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
      mesh(new THREE.CylinderGeometry(C.colR - 0.012, C.colR - 0.012, stH - 0.008, 40, 1, true), M(0xd0d4d8, { metalness: 0.9, roughness: 0.2, side: THREE.BackSide }), body, 0, yc, 0);
      for (let k = 0; k < 14; k++) { const a = k / 14 * 360; if (a > C.cut[0] - 8 && a < C.cut[1] + 8) continue; const p = polar(a, C.colR - 0.016, yc); const l = box(0.006, 0.006, 0.004, new THREE.MeshBasicMaterial({ color: 0xb59bff }), body, p.x, p.y, p.z); l.rotation.y = -deg(a); }
      mesh(new THREE.CylinderGeometry(0.03, 0.03, stH - 0.01, 20), glass(0xf2f7ff, 0.5), body, 0, yc, 0);
    } else mat = M(tex ? 0xffffff : e.color, { map: tex, roughness: e.key === 'kdf' ? 0.45 : 0.95, metalness: e.key === 'kdf' ? 0.5 : 0.0, side: THREE.DoubleSide });
    mesh(new THREE.CylinderGeometry(C.colR - 0.012, C.colR - 0.012, stH - 0.01, 44, 1, false, thetaStart, thetaLen), mat, body, 0, yc, 0);
    const ys = C.colTop - stH * i;
    const ms = mesh(new THREE.RingGeometry(0.02, C.colR - 0.006, 28, 3), M(0xc9ced2, { metalness: 0.8, wireframe: true }), body, 0, ys - 0.003, 0); ms.rotation.x = -Math.PI / 2;
    torusH(C.colR - 0.009, 0.0035, black, body, ys - 0.003, 48);
    // sonda de la etapa dentro del corte (forma real) + cable al ducto
    const kinds = ['turbS', 'uv254', 'pb', 'ecS', 'phS', 'photo'], sp = polar(82, 0.13, yc + stH / 2 - 0.004);
    probe(kinds[i], body, sp.x, sp.y, sp.z).scale.setScalar(0.42);
    cable([[sp.x, sp.y + 0.002, sp.z], [(sp.x + dp.x) / 2, sp.y + 0.004, (sp.z + dp.z) / 2], [dp.x, sp.y + 0.003, dp.z]], 0.0015, 0x161616, body, 8);
    const ledP = polar(58, C.colR + 0.004, yc);
    const ledS = mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0x34d17a }), body, ledP.x, ledP.y, ledP.z);
    anchor('etapa' + (i + 1), body, Math.cos(deg(58)) * (C.colR + 0.03), yc, Math.sin(deg(58)) * (C.colR + 0.03));
    stageMeshes.push({ mat, led: ledS });
  });
  torusH(C.colR - 0.009, 0.0035, black, body, C.colBottom + 0.002, 48);
  anchor('filtros', body, -0.24, -0.27, 0.02);

  // ---------- Batería: tubo sellado con 4 celdas LiFePO4 32700 + BMS 4S ----------
  const bat = new THREE.Group(); bat.position.set(0.26, -0.31, 0); body.add(bat);
  const batShell = mesh(new THREE.CapsuleGeometry(0.045, 0.13, 6, 18), glass(0xdfe8ec, 0.3), bat);
  void batShell;
  [[-0.0165, -0.034], [0.0165, -0.034], [-0.0165, 0.034], [0.0165, 0.034]].forEach(([x, y]) => { cyl(0.016, 0.064, M(0x2a5db0, { roughness: 0.4 }), bat, x, y, 0, 18); cyl(0.0165, 0.003, inox, bat, x, y + 0.033, 0, 18); });
  box(0.04, 0.003, 0.03, pcbGreen, bat, 0, 0.072, 0); box(0.008, 0.004, 0.006, black, bat, 0.01, 0.075, 0.006);
  cyl(0.008, 0.012, black, bat, 0, 0.11, 0, 10);
  const batBar = box(0.006, 1, 0.003, new THREE.MeshBasicMaterial({ color: 0x34d17a }), bat, 0.0, 0, 0.047);
  box(0.009, 0.11, 0.002, new THREE.MeshBasicMaterial({ color: 0x111518 }), bat, 0, 0, 0.0465);
  cable([[0.262, -0.19, 0.003], [0.222, -0.12, 0.01], [0.221, -0.02, 0.01], [0.2, 0.03, 0.01], [0.09, C.deck + 0.025, 0.03]], 0.003, 0xb3261e, body);
  cable([[0.258, -0.19, -0.003], [0.222, -0.12, -0.004], [0.221, -0.02, -0.004], [0.2, 0.03, -0.004], [0.09, C.deck + 0.023, 0.02]], 0.003, 0x161616, body);
  anchor('bateria', body, 0.31, -0.31, 0.04);

  // ---------- Centrífuga de salida (motor BLDC de bomba 12 V) ----------
  cyl(0.022, 0.025, black, body, 0, C.colBottom - 0.008, 0, 16);
  const bowlMat = glass(0xa9d8e2, 0.22);
  mesh(new THREE.LatheGeometry(C.bowl.map(([r, y]) => new THREE.Vector2(r, y)), 40), bowlMat, body);
  const centri = new THREE.Group(); body.add(centri);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; box(0.12, 0.05, 0.004, M(0x9aa9b0, { metalness: 0.5 }), centri, Math.cos(a) * 0.09, -0.445, Math.sin(a) * 0.09).rotation.y = -a; }
  const purge = cyl(0.012, 0.08, rimMat, body, -0.24, -0.43, 0, 8); purge.rotation.z = Math.PI / 2;
  box(0.03, 0.03, 0.03, red, body, -0.285, -0.43, 0);
  anchor('centrifuga', body, -0.2, -0.46, 0.08);
  mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.05, 14), rimMat, body, 0, -0.525, 0);
  [['ph', 45], ['do', 135], ['turb', 225], ['ec', 315]].forEach(([k, a]) => {
    const p = polar(a, 0.085, -0.47); probe(k, body, p.x, p.y, p.z).scale.setScalar(0.6);
    cable([[p.x, p.y + 0.004, p.z], [p.x * 1.5, -0.43, p.z * 1.5], [dp.x * 1.3, -0.41, dp.z * 1.3], [dp.x, C.colBottom + 0.01, dp.z]], 0.0016, 0x161616, body, 16);
  });
  gland(body, dp.x * 1.3, C.colBottom - 0.005, dp.z * 1.3, -1);
  anchor('salida', body, 0.06, -0.54, 0.05);

  // ---------- Caja estanca con la electrónica ----------
  let led; const TOP = 0.3, boxY = D === 'patas' ? 0.08 : 0.05;
  const ebox = new THREE.Group(); ebox.position.set(0, boxY, 0); body.add(ebox);
  const boxGlass = glass(0xeef6f8, 0.22);
  mesh(new THREE.BoxGeometry(BX.w, BX.h, BX.d), boxGlass, ebox, 0, BX.h / 2, 0);
  ebox.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BX.w, BX.h, BX.d)), new THREE.LineBasicMaterial({ color: 0x6b757b })).translateY(BX.h / 2));
  box(BX.w - 0.004, 0.004, BX.d - 0.004, M(0x6b757b), ebox, 0, 0.002, 0);
  const plateY = 0.008, upperY = 0.042;
  // planta baja: potencia, control y comunicación
  const esp = new THREE.Group(); esp.position.set(-0.055, plateY, -0.045); ebox.add(esp);
  box(0.055, 0.0016, 0.028, pcbBlack, esp, 0, 0.0008, 0); box(0.018, 0.003, 0.025, inox, esp, 0.016, 0.003, 0); box(0.006, 0.0015, 0.016, M(0x1a1a1a), esp, 0.026, 0.0035, 0);
  box(0.008, 0.003, 0.007, inox, esp, -0.027, 0.0025, 0); [-0.0125, 0.0125].forEach(z => box(0.048, 0.008, 0.0025, black, esp, -0.002, -0.004, z));
  const lora = new THREE.Group(); lora.position.set(0.004, plateY, -0.05); ebox.add(lora);
  box(0.016, 0.0012, 0.016, pcbGreen, lora, 0, 0.0006, 0); box(0.012, 0.0025, 0.012, inox, lora, 0, 0.002, 0);
  const rtc = new THREE.Group(); rtc.position.set(0.035, plateY, -0.045); ebox.add(rtc);
  box(0.038, 0.0016, 0.022, pcbBlue, rtc, 0, 0.0008, 0); cyl(0.008, 0.003, inox, rtc, -0.008, 0.003, 0, 16); box(0.008, 0.002, 0.008, black, rtc, 0.01, 0.002, 0);
  const sd = new THREE.Group(); sd.position.set(0.075, plateY, -0.045); ebox.add(sd);
  box(0.024, 0.0016, 0.02, pcbBlue, sd, 0, 0.0008, 0); box(0.012, 0.002, 0.012, inox, sd, 0.004, 0.0025, 0);
  const buck = new THREE.Group(); buck.position.set(-0.065, plateY, 0.002); ebox.add(buck);
  box(0.043, 0.0016, 0.021, pcbBlue, buck, 0, 0.0008, 0); cyl(0.006, 0.006, black, buck, 0.006, 0.004, 0, 14); cyl(0.004, 0.008, M(0x222222), buck, -0.012, 0.005, 0.004, 12); box(0.004, 0.004, 0.006, M(0x2f6fd6), buck, 0.016, 0.003, 0.006);
  const chg = new THREE.Group(); chg.position.set(-0.015, plateY, 0.002); ebox.add(chg);
  box(0.04, 0.0016, 0.025, pcbBlue, chg, 0, 0.0008, 0); for (let i = 0; i < 6; i++) box(0.0015, 0.01, 0.016, M(0xb8bec4, { metalness: 0.8 }), chg, -0.008 + i * 0.0035, 0.006, 0);
  const fets = new THREE.Group(); fets.position.set(0.04, plateY, 0.002); ebox.add(fets);
  box(0.05, 0.0016, 0.024, pcbBlue, fets, 0, 0.0008, 0); for (let i = 0; i < 4; i++) { box(0.007, 0.008, 0.002, black, fets, -0.018 + i * 0.012, 0.005, -0.004); box(0.006, 0.0015, 0.006, inox, fets, -0.018 + i * 0.012, 0.009, -0.004); }
  [[-0.035, 0.052], [0.035, 0.052]].forEach(([x, z]) => { const tb = box(0.045, 0.01, 0.009, M(0x2f8f3a), ebox, x, plateY + 0.005, z); void tb; for (let i = 0; i < 6; i++) cyl(0.0018, 0.002, inox, ebox, x - 0.019 + i * 0.0076, plateY + 0.011, z, 8); });
  // planta alta (acrílico sobre separadores de latón): tarjetas Gravity con BNC + 2× ADS1115
  box(0.19, 0.003, 0.14, glass(0xffffff, 0.35), ebox, 0, upperY, 0);
  [[-0.088, -0.063], [0.088, -0.063], [-0.088, 0.063], [0.088, 0.063]].forEach(([x, z]) => cyl(0.003, upperY - plateY, brass, ebox, x, (upperY + plateY) / 2, z, 8));
  const gnames = []; let gi = 0;
  [-0.045, -0.008, 0.029].forEach(z => [-0.069, -0.023, 0.023, 0.069].forEach(x => {
    const g = new THREE.Group(); g.position.set(x, upperY + 0.0015, z); ebox.add(g); gi++;
    box(0.042, 0.0016, 0.032, pcbBlue, g, 0, 0.0008, 0); box(0.006, 0.003, 0.008, M(0xf2f2f2), g, 0.015, 0.0025, -0.01);
    const bnc = cyl(0.0055, 0.012, inox, g, -0.012, 0.0062, 0.016, 14); bnc.rotation.x = Math.PI / 2; cyl(0.0035, 0.004, M(0xe0e0e0), g, -0.012, 0.0062, 0.023, 10).rotation.x = Math.PI / 2;
    box(0.008, 0.002, 0.006, black, g, 0.006, 0.0025, 0.004); gnames.push(g);
  }));
  [[-0.06, 0.06], [0, 0.06], [0.06, 0.06]].forEach(([x, z]) => { box(0.028, 0.0016, 0.017, pcbPurple, ebox, x, upperY + 0.0023, z); box(0.004, 0.0015, 0.004, black, ebox, x, upperY + 0.004, z); });
  // cableado interior (jumpers) y cables BNC hacia los prensaestopas
  const jc = [0xd23b2e, 0x161616, 0xf2c230, 0x2f9e44, 0x2f6fd6, 0xf2f2f2];
  gnames.forEach((g, k) => { const a = g.position; cable([[a.x + 0.015, upperY + 0.004, a.z - 0.01], [a.x * 0.6, upperY + 0.016, (a.z + 0.06) / 2], [k % 2 ? 0.03 : -0.03, upperY + 0.005, 0.06]], 0.0008, jc[k % jc.length], ebox, 10); });
  [[0.0, -0.045], [0.004, -0.05], [-0.015, 0.002], [0.04, 0.002], [-0.065, 0.002], [0.035, -0.045]].forEach(([x, z], k) => cable([[-0.035, plateY + 0.006, -0.045], [(x - 0.035) / 2, plateY + 0.014, (z - 0.045) / 2], [x, plateY + 0.003, z]], 0.0008, jc[(k + 2) % jc.length], ebox, 10));
  cable([[-0.03, upperY + 0.004, 0.06], [-0.04, (upperY + plateY) / 2 + 0.01, 0.03], [-0.05, plateY + 0.006, -0.045]], 0.0009, 0xf2c230, ebox, 10);
  cable([[0.03, upperY + 0.004, 0.06], [0.0, (upperY + plateY) / 2 + 0.012, 0.02], [-0.045, plateY + 0.006, -0.04]], 0.0009, 0x2f9e44, ebox, 10);
  const glandPos = [[-0.07, -0.05], [-0.035, -0.05], [0.0, -0.05], [0.035, -0.05], [0.07, -0.05], [-0.07, 0.05], [0.0, 0.05], [0.07, 0.05]];
  glandPos.forEach(([x, z]) => gland(ebox, x, 0, z, -1));
  gnames.slice(0, 8).forEach((g, k) => { const a = g.position, [gx, gz] = glandPos[k % glandPos.length]; cable([[a.x - 0.012, upperY + 0.0062, a.z + 0.022], [a.x - 0.012, upperY + 0.0062, a.z + 0.04], [(a.x + gx) / 2, 0.02, (a.z + gz) / 2], [gx, 0.003, gz]], 0.0012, 0x161616, ebox, 14); });
  // antena LoRa (SMA + látigo) y LED de estado
  cyl(0.004, 0.008, brass, ebox, 0.07, BX.h + 0.004, -0.05, 10);
  const antTop = TOP - boxY - 0.005; cyl(0.0045, antTop - BX.h - 0.008, black, ebox, 0.07, (BX.h + 0.008 + antTop) / 2, -0.05, 10);
  cable([[0.07, BX.h - 0.002, -0.05], [0.04, 0.05, -0.055], [0.004, plateY + 0.004, -0.05]], 0.0008, 0x9a8a5a, ebox, 8);
  anchor('antena', ebox, 0.075, antTop - 0.03, -0.05);
  anchor('control', ebox, 0, BX.h * 0.6, 0);
  anchor('electronica', ebox, BX.w / 2, BX.h * 0.7, BX.d / 2);

  // Conducto corrugado de la caja al ducto interno + cables de potencia hacia la caja
  const dTop = polar(C.duct.a, C.duct.r, C.deck + 0.02);
  cable([[0.0, boxY - 0.012, 0.05], [0.0, (boxY + C.deck) / 2, 0.11], [dTop.x, C.deck + 0.03, dTop.z], [dTop.x, C.deck + 0.012, dTop.z]], 0.008, 0x1a1a1a, body, 20);
  gland(body, dTop.x, C.deck + 0.008, dTop.z, 1);
  cable([[0.09, C.deck + 0.025, 0.025], [0.08, (boxY + C.deck) / 2, -0.02], [0.07, boxY - 0.012, -0.05]], 0.0035, 0x1a1a1a, body, 12);

  // Parte superior por diseño
  if (D === 'patas') {
    mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.008, 40), M(0x9aa6ad), body, 0, C.deck + 0.004, 0);
    [[-0.08, -0.06], [0.08, -0.06], [-0.08, 0.06], [0.08, 0.06]].forEach(([x, z]) => cyl(0.006, boxY - C.deck - 0.008, steel, body, x, (boxY + C.deck + 0.008) / 2, z, 8));
    led = mesh(new THREE.SphereGeometry(0.008, 10, 8), new THREE.MeshBasicMaterial({ color: 0x34d17a }), ebox, -0.08, BX.h + 0.006, 0.06);
  } else {
    const capH = 0.18;
    const domeMat = M(0xf2c230, { roughness: 0.45, transparent: true, opacity: 1 });
    mesh(new THREE.CylinderGeometry(0.06, 0.21, capH, 32, 1, true), domeMat, body, 0, C.deck + capH / 2, 0);
    cyl(0.06, 0.004, M(0xf2c230), body, 0, C.deck + capH, 0, 24);
    torusH(0.21, 0.01, M(0xd9a81e), body, C.deck + 0.004);
    torusH(0.21 - 0.15 * 0.07 / capH + 0.002, 0.009, M(0xf7f7f7, { emissive: 0x444444 }), body, C.deck + 0.07);
    cyl(0.03, 0.03, dark, body, 0, C.deck + capH + 0.017, 0, 12);
    led = mesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshBasicMaterial({ color: 0xf2a516 }), body, 0, TOP - 0.025, 0);
    anchor('faro', body, 0.02, TOP - 0.02, 0);
    body.userData.dome = domeMat;
  }

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

  // ---------- Cesta grande con compuertas de no retorno, tapa de malla y sensor de llenado ----------
  const basket = new THREE.Group(); body.add(basket);
  const netMat = new THREE.MeshBasicMaterial({ color: 0xe3eef0, wireframe: true, transparent: true, opacity: 0.55 });
  const fillMat = new THREE.MeshStandardMaterial({ color: 0xcfe6ea, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
  const bh = B.top - B.bottom, bx = B.x0 - B.len / 2, by = (B.top + B.bottom) / 2;
  const panel = (w, h, sw, sh, x, y, z, rx, ry) => [netMat, fillMat].forEach(m => { const o = mesh(new THREE.PlaneGeometry(w, h, sw, sh), m, basket, x, y, z); o.rotation.set(rx, ry, 0); });
  panel(B.len, bh, 16, 8, bx, by, B.halfW, 0, 0); panel(B.len, bh, 16, 8, bx, by, -B.halfW, 0, 0);
  panel(B.halfW * 2, bh, 14, 8, B.x0 - B.len, by, 0, 0, Math.PI / 2);
  panel(B.len, B.halfW * 2, 16, 14, bx, B.bottom, 0, -Math.PI / 2, 0);
  panel(B.len, B.halfW * 2, 16, 14, bx, B.top, 0, -Math.PI / 2, 0);                          // tapa de malla: la basura no brinca fuera
  const frameEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(B.len, bh, B.halfW * 2)), new THREE.LineBasicMaterial({ color: 0x5c6870 }));
  frameEdges.position.set(bx, by, 0); basket.add(frameEdges);
  const lip = mesh(new THREE.PlaneGeometry(B.halfW * 2, B.lip - B.bottom), M(0x3d4a52, { side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), basket, B.x0, (B.lip + B.bottom) / 2, 0); lip.rotation.y = Math.PI / 2;
  // compuertas de no retorno: 6 aletas colgadas de una barra; se abren hacia adentro y se cierran solas
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
  // sensor ultrasónico impermeable JSN-SR04T en la tapa, mirando hacia abajo
  const usX = B.x0 - B.len * 0.55;
  cyl(0.012, 0.016, black, basket, usX, B.top + 0.006, 0, 16); cyl(0.0095, 0.002, inox, basket, usX, B.top - 0.003, 0, 16);
  cable([[usX, B.top + 0.016, 0], [usX + 0.15, B.top + 0.03, 0.02], [B.x0 + 0.05, 0.07, 0.2], [-0.3, 0.07, 0.12], [-0.08, boxY - 0.012, 0.05]], 0.0022, 0x161616, body);
  anchor('nivel', basket, usX, B.top + 0.03, 0.02);
  const trashColors = [0xe8742c, 0x2f6fd6, 0x5fae5a, 0xd8c9a3, 0xc0392b, 0xf2f2f2], trashIn = [];
  for (let i = 0; i < 36; i++) {
    const g = i % 3 ? new THREE.BoxGeometry(0.06, 0.02, 0.045) : new THREE.CylinderGeometry(0.016, 0.016, 0.09, 8);
    const o = mesh(g, M(trashColors[i % trashColors.length]), basket, B.x0 - 0.06 - Math.random() * (B.len - 0.12), -0.01 + (i / 36) * 0.1 + Math.random() * 0.02, (Math.random() - 0.5) * (B.halfW * 2 - 0.08));
    o.rotation.set(Math.random() * 3, Math.random() * 3, 0); o.visible = false; trashIn.push(o);
  }
  anchor('cesta', body, B.x0 - B.len, B.top + 0.05, 0.2);
  anchor('compuerta', body, B.x0, 0.06, -B.halfW + 0.05);
  anchor('escape', body, B.holeX, B.bottom - 0.15, 0.04);

  // ---------- Veleta hidrodinámica (aleta trasera sumergida) ----------
  const vs = new THREE.Shape(); vs.moveTo(0, VN.yTop); vs.lineTo(-VN.len, VN.yTop + 0.02); vs.lineTo(-VN.len, VN.yBot); vs.lineTo(0, VN.yBot + 0.06); vs.closePath();
  const vane = mesh(new THREE.ExtrudeGeometry(vs, { depth: 0.008, bevelEnabled: false }), M(0xf4f4f4, { roughness: 0.5 }), body, VN.x0, 0, -0.004);
  void vane;
  const vEdge = new THREE.Shape(); vEdge.moveTo(-VN.len + 0.06, VN.yTop + 0.015); vEdge.lineTo(-VN.len, VN.yTop + 0.02); vEdge.lineTo(-VN.len, VN.yBot); vEdge.lineTo(-VN.len + 0.06, VN.yBot + 0.005); vEdge.closePath();
  mesh(new THREE.ExtrudeGeometry(vEdge, { depth: 0.0084, bevelEnabled: false }), M(0xe8742c), body, VN.x0, 0, -0.0042);
  const armL = -0.5 - (VN.x0 + 0.05);
  [0.15, -0.15].forEach(z => { const arm = cyl(0.011, armL, steel, body, -0.5 - armL / 2, -0.3, z, 10); arm.rotation.z = Math.PI / 2; });
  cyl(0.011, 0.32, steel, body, VN.x0 + 0.05, -0.3, 0, 10).rotation.x = Math.PI / 2;
  box(0.02, 0.06, 0.02, steel, body, VN.x0 + 0.02, -0.27, 0);
  anchor('veleta', body, VN.x0 - VN.len * 0.6, VN.yBot + 0.04, 0.02);

  // ---------- Anillo giratorio (no gira con la veleta): A sostiene patas, B sostiene cadenas ----------
  const mountR = D === 'patas' ? C.legTopR : MO.ringR;
  torusH(mountR, 0.012, M(0x48525a, { metalness: 0.6, roughness: 0.35 }), mount, 0, 72);
  [60, 180, 300].forEach(a => { const p = polar(a, mountR - 0.022, 0); cyl(0.01, 0.022, black, mount, p.x, 0, p.z, 12); });
  anchor('giro', mount, Math.cos(deg(250)) * mountR, 0.01, Math.sin(deg(250)) * mountR);

  // ---------- A: 3 patas telescópicas con barrena y motor tipo limpiaparabrisas ----------
  const legs = (D === 'patas' ? C.legAngles : []).map(dg => {
    const a = deg(dg), g = new THREE.Group(); root.add(g);
    const mot = new THREE.Group(); mot.position.y = 0.035; g.add(mot);
    box(0.06, 0.04, 0.05, M(0x3a3f44, { metalness: 0.4 }), mot, 0, 0, 0); const mc = cyl(0.022, 0.065, black, mot, 0.0, 0.0, 0.045, 14); mc.rotation.x = Math.PI / 2;
    cyl(0.028, C.legSleeve, steel, g, 0, -C.legSleeve / 2, 0, 12);
    const inner = cyl(0.019, 1, M(0x9aa6ad, { metalness: 0.7, roughness: 0.25 }), g, 0, 0, 0, 10);
    const auger = new THREE.Group(); g.add(auger);
    const cone = mesh(new THREE.ConeGeometry(0.032, C.augerLen, 14), M(0x6e7880, { metalness: 0.7 }), auger, 0, -C.augerLen / 2, 0); cone.rotation.x = Math.PI;
    const hel = []; for (let i = 0; i <= 50; i++) { const u = i / 50, an = u * Math.PI * 6, r = 0.06 * (1 - u) + 0.012; hel.push(V3(Math.cos(an) * r, -u * C.augerLen, Math.sin(an) * r)); }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hel), 70, 0.006, 6, false), M(0x8b969d, { metalness: 0.7 }), auger);
    const p0 = polar(dg, C.legTopR, 0.03), p1 = polar(dg + 40, C.legTopR, 0.02), p2 = polar(dg + 80, C.legTopR, 0.02);
    cable([p0, p1, p2], 0.0025, 0x161616, mount, 16);
    return { a, g, inner, auger };
  });
  if (legs.length) anchors.patas = legs[0].auger;
  const pitProf = []; for (let i = 0; i <= 12; i++) { const u = i / 12; pitProf.push(new THREE.Vector2(0.85 * Math.cos(u * Math.PI / 2), -Math.sin(u * Math.PI / 2))); }
  const pit = mesh(new THREE.LatheGeometry(pitProf.reverse(), 32), new THREE.MeshStandardMaterial({ color: 0x2a1e13, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }), root, 0, bedY + 0.005, 0);
  pit.renderOrder = 1; pit.visible = false;
  const berm = torusH(0.9, 0.04, M(0x5a4630, { roughness: 1 }), root, bedY, 40); berm.visible = false;

  // ---------- B: jaula con lastre + 3 cadenas (al anillo giratorio) a anclas helicoidales ----------
  const moor = [];
  if (D === 'anclada') {
    [30, 150, 270].forEach(dg => {
      const a = deg(dg), x = Math.cos(a) * MO.cageR, z = Math.sin(a) * MO.cageR, h = C.ringBotY - MO.cageBottom;
      cyl(0.012, h, steel, body, x, MO.cageBottom + h / 2, z, 8);
      spoke(MO.cageR, C.ringR - C.ringTube + 0.01, a, C.ringBotY, steel, body, 0.014);
      box(0.1, 0.05, 0.06, M(0x55585a, { roughness: 0.95 }), body, x, MO.cageBottom + 0.03, z).rotation.y = -a;
    });
    torusH(MO.cageR, 0.014, steel, body, MO.cageBottom);
    anchor('jaula', body, -MO.cageR, MO.cageBottom + 0.04, 0.08);
    const chainMat = M(0x4a5157, { metalness: 0.7, roughness: 0.4 }), NL = 70;
    MO.angles.forEach((dg, li) => {
      const a = deg(dg), ca = Math.cos(a), sa = Math.sin(a);
      const pad = new THREE.Object3D(); pad.position.set(ca * (MO.ringR + 0.012), 0, sa * (MO.ringR + 0.012)); mount.add(pad);
      mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 12), steel, mount, ca * (MO.ringR + 0.012), 0, sa * (MO.ringR + 0.012)).rotation.y = -a;
      const ag = new THREE.Group(); ag.position.set(ca * MO.anchorR, bedY, sa * MO.anchorR); root.add(ag);
      const eye = mesh(new THREE.TorusGeometry(0.025, 0.007, 8, 14), steel, ag, 0, 0.03, 0); eye.rotation.y = -a;
      cyl(0.012, 0.7, steel, ag, 0, -0.33, 0, 8);
      mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 20), steel, ag, 0, -0.62, 0).rotation.x = Math.PI / 2 + 0.25;
      const sinker = box(0.12, 0.09, 0.12, M(0x8a8f8c, { roughness: 1 }), root, 0, 0, 0);
      const links = new THREE.InstancedMesh(new THREE.TorusGeometry(0.014, 0.0045, 6, 10), chainMat, NL); links.frustumCulled = false; root.add(links);
      const m = { a, pad, links, sinker, NL, len: 0 };
      if (li === 0) { anchors.ancla = eye; anchors.lastre = sinker; m.lm = new THREE.Object3D(); root.add(m.lm); anchors.linea = m.lm; }
      const p0 = V3(ca * MO.ringR, bedY + MO.maxDepth + MO.cageBottom, sa * MO.ringR), p2 = V3(ca * MO.anchorR, bedY, sa * MO.anchorR);
      m.len = p0.distanceTo(p2) * MO.slack; moor.push(m);
    });
  }
  const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = V3(1, 1, 1), _up = V3(0, 0, 1), _t = V3(0, 0, 0), _p = V3(0, 0, 0), _p2 = V3(0, 0, 0), _rq = new THREE.Quaternion();
  function updateMoor() {
    mount.updateMatrix();
    moor.forEach(m => {
      const P0 = m.pad.position.clone().applyMatrix4(mount.matrix), P2 = V3(Math.cos(m.a) * MO.anchorR, bedY + 0.03, Math.sin(m.a) * MO.anchorR);
      const d = P0.distanceTo(P2), sag = 0.5 * Math.sqrt(Math.max(0, m.len * m.len - d * d));
      const mid = P0.clone().add(P2).multiplyScalar(0.5); mid.y -= sag;
      const ctrl = mid.clone().multiplyScalar(2).sub(P0.clone().add(P2).multiplyScalar(0.5));
      const curve = new THREE.QuadraticBezierCurve3(P0, ctrl, P2);
      for (let i = 0; i < m.NL; i++) {
        curve.getPoint(i / (m.NL - 1), _p); curve.getPoint(Math.min(1, i / (m.NL - 1) + 0.01), _p2);
        _p.y = Math.max(_p.y, bedY + 0.015); _p2.y = Math.max(_p2.y, bedY + 0.015);
        _t.copy(_p2).sub(_p); if (_t.lengthSq() < 1e-10) _t.set(1, 0, 0); _t.normalize();
        _q.setFromUnitVectors(_up, _t); if (i % 2) { _rq.setFromAxisAngle(_t, Math.PI / 2); _q.premultiply(_rq); }
        _m.compose(_p, _q, _s); m.links.setMatrixAt(i, _m);
      }
      m.links.instanceMatrix.needsUpdate = true;
      curve.getPoint(0.55, _p); _p.y = Math.max(_p.y, bedY + 0.045); m.sinker.position.copy(_p);
      if (m.lm) { curve.getPoint(0.3, _p); _p.y = Math.max(_p.y, bedY + 0.02); m.lm.position.copy(_p); }
    });
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

  // ---------- Partículas ----------
  const PN = 360, pGeo = new THREE.BufferGeometry(), pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3);
  const parts = Array.from({ length: PN }, () => ({ u: Math.random(), th: Math.random() * Math.PI * 2, j: Math.random() }));
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.012, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  points.frustumCulled = false; body.add(points);
  const dirty = new THREE.Color(0x9a7440), clean = new THREE.Color(0x6fe3f5), tmpC = new THREE.Color();
  const U = { fun: 0.12, col: 0.6, bowl: 0.78, noz: 0.86 };
  function particlePos(p, out) {
    const { u, th, j } = p; let r, y, a = th;
    if (u < U.fun) { const k = u / U.fun; y = -0.025 - k * 0.115; r = k < 0.15 ? C.colR + 0.03 * (1 - k / 0.15) : C.colR * (1 - 0.7 * k) * (0.3 + 0.65 * j); a += k * 0.4; }
    else if (u < U.col) { const k = (u - U.fun) / (U.col - U.fun); y = C.colTop - k * (C.colTop - C.colBottom); r = (C.colR - 0.03) * (0.15 + 0.8 * j); a += 0.4 + k * 2; }
    else if (u < U.bowl) { const k = (u - U.col) / (U.bowl - U.col); y = -0.41 - k * 0.09; r = lerpProfile(C.bowl, y) * (0.3 + 0.55 * j); a += 2.4 + k * 16; }
    else if (u < U.noz) { const k = (u - U.bowl) / (U.noz - U.bowl); y = -0.5 - k * 0.05; r = 0.025 * j; a += 18; }
    else { const k = (u - U.noz) / (1 - U.noz); out.set(Math.cos(a) * 0.04 * j - k * 0.9, C.nozzleBottom - k * 0.08 - j * 0.05 * k, Math.sin(a) * (0.04 + k * 0.2) * j); return; }
    out.set(Math.cos(a) * r, y, Math.sin(a) * r);
  }

  // ---------- Pulsos de energía y datos sobre los cables reales ----------
  const flows = [];
  function flow(pts, color, kind, n = 3) {
    const curve = new THREE.CatmullRomCurve3(pts.map(q => q.isVector3 ? q : V3(...q)));
    const dots = Array.from({ length: n }, () => mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color }), body));
    flows.push({ curve, dots, kind, ph: Math.random() });
  }
  flow([[0.283, 0.05, 0], [0.2, 0.085, 0.03], [0.1, C.deck + 0.03, 0.02], [0.07, boxY - 0.01, -0.05], [-0.015, boxY + 0.012, 0.002]], 0xf2a516, 'gen');
  flow([[-0.015, boxY + 0.012, 0.002], [0.07, boxY - 0.01, -0.05], [0.09, C.deck + 0.025, 0.03], [0.2, 0.03, 0.01], [0.221, -0.06, 0.01], [0.262, -0.19, 0.003]], 0xf2a516, 'charge');
  flow([[0.0, boxY - 0.012, 0.05], [dTop.x, C.deck + 0.03, dTop.z], [dp.x, -0.1, dp.z], [dp.x, -0.38, dp.z], [0.02, C.colBottom - 0.008, 0.01]], 0x35d0e0, 'centri');
  flow([[dp.x, -0.3, dp.z], [dp.x, -0.1, dp.z], [dTop.x, C.deck + 0.03, dTop.z], [0.0, (boxY + C.deck) / 2, 0.11], [0.0, boxY + 0.01, 0.03]], 0xffffff, 'data');

  // ---------- Simulación ----------
  const sim = { t: 0, omega: 0, batWh: C.battery.wh * 0.62, pit: 0, digging: false, pGen: 0, load: 0, trash: 0, kg: 0, bodyY: 0, water: 0,
    sat: ETAPAS_FILTRO.map(e => e.sat0), treating: true, mode: 'tratando', resting: false, tension: 0, centriRpm: 0, flow: 0, hi: -1,
    yaw: opts.flowAngle || 0, flowAngle: 0, drift: 0, tilt: 0, flapK: 0 };
  let bodyInit = false;

  function update(dt, s = {}) {
    dt = Math.min(dt, 0.05); sim.t += dt;
    const v = Math.max(0, s.current ?? 0.8), water = s.waterLevel ?? 0, ts = s.timeScale ?? C.timeScale, fa = s.flowAngle ?? 0;
    sim.water = water; sim.flowAngle = fa;
    const target = W.tsr * v / rMid;
    sim.omega += (target - sim.omega) * Math.min(1, dt * 1.0);
    sim.pGen = target > 0 ? Math.min(C.maxGenW, 0.5 * 1000 * W.gapArea * v ** 3 * W.cp * C.genEff) * Math.min(1, sim.omega / target) : 0;

    const pct = sim.batWh / C.battery.wh;
    if (sim.treating && pct < C.cycle.stopBelow) sim.treating = false;
    if (!sim.treating && pct > C.cycle.startAbove) sim.treating = true;
    sim.mode = pct < 0.08 ? 'sin energía' : sim.treating ? 'tratando' : 'cargando';
    const on = sim.mode === 'tratando';
    sim.centriRpm += ((on ? 2400 : 0) - sim.centriRpm) * Math.min(1, dt * 1.5);

    // Veleta: la corriente gira la boya hasta alinearla (la toma y las barreras quedan aguas arriba)
    let dYaw = fa - sim.yaw; dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    sim.yaw += dYaw * Math.min(1, dt * 0.9 * Math.min(1.5, v));

    const floatY = water + C.freeboard + Math.sin(sim.t * 1.3) * 0.008;
    let targetY;
    if (D === 'patas') {
      const need = (bedY + C.bedClearance) - (floatY + C.nozzleBottom);
      sim.digging = need > sim.pit + 0.003 && sim.batWh > 1;
      if (sim.digging) sim.pit = Math.min(need, sim.pit + C.digRate * dt);
      targetY = Math.max(floatY, bedY + C.bedClearance - C.nozzleBottom - sim.pit);
      sim.drift = 0; sim.tilt = 0;
    } else {
      const restY = bedY + 0.01 - MO.cageBottom;
      sim.resting = floatY < restY; targetY = Math.max(floatY, restY);
      sim.drift += ((sim.resting ? 0 : 0.12 * v * v) - sim.drift) * Math.min(1, dt * 1.5);
      sim.tilt += ((sim.resting ? 0 : 0.05 * v * v) - sim.tilt) * Math.min(1, dt * 1.5);
      sim.tension = 0.5 * 1000 * MO.dragCd * MO.dragArea * v * v / (2 * Math.cos(deg(MO.angles[0])));
    }
    if (!bodyInit) { sim.bodyY = targetY; bodyInit = true; }
    sim.bodyY += (targetY - sim.bodyY) * Math.min(1, dt * 3);
    body.position.set(-sim.drift * Math.cos(fa), sim.bodyY, sim.drift * Math.sin(fa));
    body.rotation.set(0, sim.yaw, sim.tilt + Math.sin(sim.t * 1.1) * 0.004);
    mount.position.set(body.position.x, sim.bodyY + (D === 'patas' ? C.ringTopY : MO.cageBottom), body.position.z);
    if (moor.length) updateMoor();
    const submerged = sim.bodyY <= water + 0.04;
    sim.flow = submerged ? sim.centriRpm / 2400 : 0;

    sim.load = C.loads.base + (on ? C.loads.uv + C.loads.centri : 0) + (sim.digging ? C.loads.augers : 0);
    sim.batWh = Math.min(C.battery.wh, Math.max(0, sim.batWh + (sim.pGen - sim.load) * dt * ts / 3600));
    ETAPAS_FILTRO.forEach((e, i) => { sim.sat[i] = Math.min(1, sim.sat[i] + dt * sim.flow * e.rate * C.satSpeed); });

    wheel.rotation.y -= sim.omega * dt;
    pinion.rotation.y += sim.omega * (W.rIn / 0.018) * dt;
    centri.rotation.y += sim.centriRpm / 2400 * 14 * dt;

    const anchorDepth = C.legBaseAnchor + sim.pit;
    legs.forEach(L => {
      const top = V3(Math.cos(L.a) * C.legTopR, sim.bodyY + C.ringTopY, Math.sin(L.a) * C.legTopR);
      const tip = V3(Math.cos(L.a) * C.legTipR, bedY - anchorDepth, Math.sin(L.a) * C.legTipR);
      const d = tip.clone().sub(top), len = d.length();
      L.g.position.copy(top); L.g.quaternion.setFromUnitVectors(V3(0, -1, 0), d.normalize());
      const innerLen = Math.max(0.03, len - C.augerLen - C.legSleeve + 0.05);
      L.inner.scale.y = innerLen; L.inner.position.y = -(C.legSleeve - 0.05) - innerLen / 2;
      L.auger.position.y = -(len - C.augerLen);
      if (sim.digging) L.auger.rotation.y += 9 * dt;
    });
    pit.visible = berm.visible = sim.pit > 0.01;
    pit.scale.set(1, Math.max(0.005, sim.pit), 1);
    berm.scale.set(1, 1, Math.min(1.6, 0.5 + sim.pit * 2));

    // Compuertas: se abren cuando entra basura y se cierran solas
    sim.flapK = Math.max(0, sim.flapK - dt * 1.5);
    flaps.forEach((f, i) => { f.rotation.z = -(0.12 + 0.15 * v + 0.6 * sim.flapK * (0.6 + 0.4 * Math.sin(sim.t * 4 + i))); });
    trashIn.forEach((o, i) => { o.visible = i < Math.min(trashIn.length, Math.round(36 * Math.min(1, sim.kg / B.capKg))); });

    // Peces (marco del río, girado según la dirección de la corriente)
    const showFish = s.showFish !== false, ca = Math.cos(fa), sa = Math.sin(fa);
    fishes.forEach(f => {
      f.g.visible = showFish;
      f.x += f.sp * dt; if (f.x > 4.5) { f.x = -4.5; f.z0 = (Math.random() - 0.5) * 3; f.d = Math.random(); }
      let z = f.z0 + Math.sin(sim.t * 0.6 + f.ph) * 0.12;
      const R = 0.95; if (Math.abs(f.x) < R) { const m = Math.sqrt(R * R - f.x * f.x); if (Math.abs(z) < m) z = (z >= 0 ? 1 : -1) * m; }
      if (f.x < -0.5 && f.x > -2.2 && Math.abs(z) < 0.5) z = (z >= 0 ? 1 : -1) * 0.5;   // esquiva la veleta
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

    stageMeshes.forEach((st, i) => {
      const sat = sim.sat[i];
      st.led.material.color.setHex(sat > 0.85 ? 0xe0533d : sat > 0.65 ? 0xf2a516 : 0x34d17a);
      const hl = sim.hi === i ? 0.35 + 0.35 * Math.sin(sim.t * 6) : 0;
      if (ETAPAS_FILTRO[i].key === 'uv') st.mat.emissiveIntensity = (on ? 0.9 * (1 - 0.5 * sat) : 0.05) + hl;
      else { st.mat.emissive.setHex(0x35d0e0); st.mat.emissiveIntensity = hl; }
    });

    const p2 = sim.batWh / C.battery.wh;
    batBar.scale.y = Math.max(0.005, p2 * 0.1); batBar.position.y = -0.05 + p2 * 0.05;
    batBar.material.color.setHex(p2 > 0.5 ? 0x34d17a : p2 > 0.2 ? 0xf2a516 : 0xe0533d);
    if (D === 'patas') { led.material.color.setHex(p2 < 0.2 ? 0xe0533d : sim.digging ? 0xf2a516 : 0x34d17a); led.visible = sim.digging ? Math.sin(sim.t * 14) > 0 : Math.sin(sim.t * 3) > -0.6; }
    else { led.material.color.setHex(p2 < 0.1 ? 0xe0533d : 0xf2a516); led.visible = (sim.t % 4) < 0.5; }

    points.visible = s.showFlow !== false;
    if (points.visible) {
      const tmp = V3(0, 0, 0), avgEff = effs().reduce((a, b) => a + b, 0) / ETAPAS_FILTRO.length;
      parts.forEach((p, i) => {
        p.u = (p.u + dt * 0.1 * sim.flow) % 1;
        particlePos(p, tmp); pPos[i * 3] = tmp.x; pPos[i * 3 + 1] = tmp.y; pPos[i * 3 + 2] = tmp.z;
        const k = p.u < U.fun ? 0 : p.u < U.col ? (p.u - U.fun) / (U.col - U.fun) * (0.3 + 0.6 * avgEff) : Math.min(1, 0.45 + 0.6 * avgEff);
        tmpC.copy(dirty).lerp(clean, k); pCol[i * 3] = tmpC.r; pCol[i * 3 + 1] = tmpC.g; pCol[i * 3 + 2] = tmpC.b;
      });
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    }

    const showE = s.showEnergy !== false;
    flows.forEach(L => {
      const speed = L.kind === 'gen' ? Math.min(0.9, sim.pGen / 8) : L.kind === 'charge' ? (sim.pGen > sim.load ? 0.4 : 0) : L.kind === 'centri' ? (on ? 0.5 : 0) : (sim.batWh > 0.3 ? 0.25 : 0);
      L.ph = (L.ph + dt * speed) % 1;
      L.dots.forEach((d, k) => { d.visible = showE && speed > 0.01; d.position.copy(L.curve.getPointAt((L.ph + k / L.dots.length) % 1)); });
    });
  }

  function effs() { return ETAPAS_FILTRO.map((e, i) => e.base * (1 - Math.pow(sim.sat[i], 3))); }

  function lecturasSimuladas() {
    const t = sim.t, n = (a, f = 1) => a * Math.sin(t * f) + a * 0.5 * Math.sin(t * f * 2.7 + 1);
    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
    const w = { ph: clamp(6.85 + n(0.25, 0.2), 0, 14), orp: -115 + n(12, 0.2), ec: 1380 + n(40, 0.15), do: Math.max(0, 2.1 + n(0.25, 0.25)), temp: 19.4 + n(0.3, 0.05),
      turb: Math.max(0, 82 + n(8, 0.4)), uv254: 38 + n(3, 0.3), pb: Math.max(0, 48 + n(5, 0.18)), uvi: 0 };
    w.tds = w.ec * 0.5;
    const inlet = { ...w }, E = effs(), uvOn = sim.mode === 'tratando', stages = [], flowing = sim.flow > 0.02;
    ETAPAS_FILTRO.forEach((e, i) => {
      const f = flowing ? E[i] : 0;
      if (e.key === 'sed') w.turb *= 1 - f;
      if (e.key === 'gac') { w.uv254 *= 1 - f; w.turb *= 1 - 0.1 * f; }
      if (e.key === 'res') { w.pb *= 1 - f; w.ec *= 1 - 0.05 * f; }
      if (e.key === 'kdf') { w.pb *= 1 - 0.6 * f; w.ec *= 1 - 0.04 * f; }
      if (e.key === 'cal') w.ph += (7.4 - w.ph) * f;
      if (e.key === 'uv') w.uvi = uvOn ? 4.2 * (1 - 0.5 * sim.sat[i]) : 0;
      w.tds = w.ec * 0.5;
      const sat = sim.sat[i];
      stages.push({ key: e.key, ind: e.ind, value: w[e.ind], sat, eff: f, estado: sat > 0.85 ? 'Reemplazar' : sat > 0.65 ? 'Próximo cambio' : 'OK' });
    });
    const aer = sim.centriRpm / 2400, cEff = Math.min(0.8, aer * 0.8) * (flowing ? 1 : 0);
    const outlet = { ...w, turb: w.turb * (1 - cEff), do: w.do + 3.4 * aer, orp: w.orp + 150 * aer };
    return { inlet, stages, outlet, basketFillPct: Math.min(100, 100 * sim.kg / B.capKg) };
  }

  function telemetria() {
    const wheelRpm = sim.omega * 60 / (2 * Math.PI);
    let err = sim.flowAngle - sim.yaw; err = Math.atan2(Math.sin(err), Math.cos(err));
    return {
      diseno: D, wheelRpm, generatorRpm: wheelRpm * W.rIn / 0.018, centrifugeRpm: sim.centriRpm, powerGenW: sim.pGen, loadW: sim.load,
      batteryPct: 100 * sim.batWh / C.battery.wh, batteryWh: sim.batWh, netW: sim.pGen - sim.load,
      mode: D === 'anclada' ? (sim.resting ? 'apoyada en el fondo' : 'anclada') : sim.digging ? 'excavando' : sim.pit > 0.01 ? 'anclada en fosa' : 'flotando', powerMode: sim.mode,
      tensionKN: sim.tension / 1000, driftM: sim.drift, pitDepth: sim.pit, intakeSubmerged: sim.bodyY <= sim.water + 0.04,
      headingDeg: sim.yaw * 180 / Math.PI, headingErrorDeg: err * 180 / Math.PI,
      wheelClearance: sim.bodyY + W.yBot - bedY, flowLpm: C.pumpLpm * sim.flow,
      intakeVelocity: (C.pumpLpm * sim.flow / 60000) / (16 * 0.035 * 0.04),
      basketFillPct: Math.min(100, 100 * sim.kg / B.capKg),
      trashPieces: sim.trash, trashKg: sim.kg, bodyY: sim.bodyY, saturation: [...sim.sat]
    };
  }

  function setRayosX(on) {
    [shellMat, bowlMat].forEach(m => { m.opacity = on ? 0.14 : 0.45; m.needsUpdate = true; });
    floatMat.opacity = on ? 0.4 : 1; floatMat.depthWrite = !on; floatMat.needsUpdate = true;
    const dm2 = body.userData.dome; if (dm2) { dm2.opacity = on ? 0.35 : 1; dm2.depthWrite = !on; dm2.needsUpdate = true; }
  }
  function registrarBasura(kg = 0.05) { sim.trash++; sim.kg += kg; sim.flapK = 1; }
  function vaciarCesta() { sim.kg = 0; sim.trash = 0; }
  function rellenarFosa() { sim.pit = 0; }
  function cambiarCartuchos() { sim.sat = ETAPAS_FILTRO.map(() => 0.02); }
  function resaltarEtapa(i) { sim.hi = i == null ? -1 : i; }
  function bocaCesta() { return { x: B.x0, y: sim.bodyY - 0.01, halfW: B.halfW, offsetX: -sim.drift, boom: BOOM, full: sim.kg >= B.capKg }; }
  function localAMundo(x, y, z) { body.updateMatrixWorld(true); return body.localToWorld(V3(x, y, z)); }

  const etiquetas = [
    ['electronica', 'Caja 200×150×75 mm: ESP32 + LoRa + tarjetas Gravity', 0, 0, 0],
    ['antena', 'Antena LoRa 915 MHz', 1],
    ...(D === 'anclada' ? [['faro', 'Faro LED', 1, 1]] : []),
    ['toma', 'Toma lateral con malla fina', 1],
    ['molino', 'Molino entre los tubos de PET', 0, 1, 1], ['generador', 'Motor DC 775 como generador', 1, 1],
    ['rejilla', 'Hueco con rejilla anti-peces'], ['sensores', 'Sondas pH, ORP, EC, OD, temp., turbidez', 1, 0, 1],
    ['filtros', '6 discos filtrantes (corte)', 0, 0, 1], ['ducto', 'Ducto interno de cables', 1],
    ['bateria', 'Batería LiFePO4 4S + BMS', 0, 1], ['centrifuga', 'Centrífuga de salida (BLDC)', 0, 0, 1],
    ['salida', 'Salida + sondas', 1], ['barreras', 'Barreras con faldón de 10 cm', 1, 0, 1],
    ['cesta', 'Cesta 80×72 cm con tapa de malla', 0, 0, 1], ['compuerta', 'Compuertas de no retorno', 0, 0, 1], ['nivel', 'Sensor de llenado JSN-SR04T', 1],
    ['escape', 'Salida para peces', 0, 0, 1], ['veleta', 'Veleta: la mantiene contra la corriente', 0, 0, 1],
    ['giro', D === 'patas' ? 'Anillo giratorio (patas fijas)' : 'Anillo giratorio (cadenas fijas)', 0],
    ...(D === 'patas' ? [['patas', 'Pata con barrena y motor 12 V', 1]] : [['jaula', 'Jaula con lastre', 0, 0, 1], ['linea', 'Cadena con lastre de concreto', 0], ['ancla', 'Ancla helicoidal', 1]])
  ];

  return { diseno: D, etiquetas, root, body, anchors, update, telemetria, lecturasSimuladas, registrarBasura, vaciarCesta, rellenarFosa, cambiarCartuchos, resaltarEtapa, bocaCesta, bocaRed: bocaCesta, setRayosX, localAMundo, config: C };
}
