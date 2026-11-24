import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, signal, viewChild } from '@angular/core';
import { Message } from 'primeng/message';
import type { BuoyDesign } from '../../core/models/buoy.models';
import type { BuoyModel } from './three/buoy-model';

export type BuoyView = 'iso' | 'front' | 'side' | 'under' | 'elec' | 'filtros';

/** Riverbed and water surface of the reference scene (meters; same depth as the artifact: 1.8 m). */
const BED_Y = -1.8;
const WATER_Y = 0;
/** River current used to animate the turbine and centrifuge (prototype value, m/s). */
const CURRENT = 0.9;
const BG = 0x10303a;

/** Camera presets from the artifact: [position, target], relative to the buoy's height. */
const VIEWS: Record<Exclude<BuoyView, 'elec' | 'filtros'>, [[number, number, number], [number, number, number]]> = {
  iso: [[1.55, 0.35, 1.9], [-0.15, -0.25, 0]],
  front: [[-0.25, -0.05, 3.1], [-0.25, -0.25, 0]],
  side: [[3.1, 0.1, 0.35], [0, -0.25, 0]],
  under: [[1.3, -0.6, 1.7], [0, -0.35, 0]],
};

/**
 * Interactive 3D viewer for the Río Monitor buoy (model ported from the design artifact).
 * `three` loads lazily on first render; the WebGL context is freed when the component is destroyed.
 */
@Component({
  selector: 'app-buoy-viewer',
  imports: [Message],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; position: relative; overflow: hidden; border-radius: 12px; background: #10303a; min-height: 320px; }
    .stage { position: absolute; inset: 0; }
    .overlay { position: absolute; inset: 0; display: grid; place-items: center; color: #eaf7fa; font-size: .9rem; gap: .5rem; pointer-events: none; }
    .hint { position: absolute; left: .6rem; bottom: .6rem; background: rgb(9 28 34 / .72); color: #eaf7fa; border: 1px solid rgb(255 255 255 / .2); border-radius: 8px; font-size: .75rem; padding: .3rem .6rem; pointer-events: none; }
    .error { position: absolute; inset: 1rem; display: grid; place-items: center; }
    @media (max-width: 600px) { .hint { display: none; } }
  `,
  template: `
    <div #stage class="stage" role="img" [attr.aria-label]="ariaLabel()"></div>
    @switch (state()) {
      @case ('loading') {
        <div class="overlay"><span><i class="pi pi-spin pi-spinner" aria-hidden="true"></i> Cargando modelo 3D…</span></div>
      }
      @case ('ready') {
        <span class="hint">Arrastra para girar · rueda o pellizco para acercar</span>
      }
      @case ('error') {
        <div class="error">
          <p-message severity="warn">Tu navegador no pudo iniciar WebGL, así que no es posible mostrar el modelo 3D.</p-message>
        </div>
      }
    }
  `,
})
export class BuoyViewer {
  readonly design = input<BuoyDesign>('anclada');
  readonly view = input<BuoyView>('iso');
  readonly xray = input(false);
  readonly ariaLabel = input('Modelo 3D interactivo de la boya Río Monitor');

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  private model?: BuoyModel;
  /** Moves the camera to a preset (set up once three has loaded). */
  private goTo?: (v: BuoyView) => void;

  constructor() {
    const destroyRef = inject(DestroyRef);
    let destroyed = false;
    let cleanup: (() => void) | undefined;

    afterNextRender(() => {
      void Promise.all([import('three'), import('three/examples/jsm/controls/OrbitControls.js'), import('./three/buoy-model')])
        .then(([THREE, { OrbitControls }, { createBuoyModel, disposeObject }]) => {
          if (destroyed) return;
          const host = this.stage().nativeElement;

          let renderer: import('three').WebGLRenderer;
          try {
            renderer = new THREE.WebGLRenderer({ antialias: true });
          } catch {
            this.state.set('error');
            return;
          }
          renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
          // The canvas is created at runtime, so the component's scoped styles don't reach it:
          // size it inline to fill the stage regardless of the drawing buffer size (DPR ≠ 1).
          Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none', outline: 'none' });
          host.appendChild(renderer.domElement);

          const scene = new THREE.Scene();
          scene.background = new THREE.Color(BG);
          scene.fog = new THREE.Fog(BG, 6, 16);

          // The artifact used r147 lights (legacy, ×π implicitly): scale up to get the same look.
          scene.add(new THREE.HemisphereLight(0xd8f3ff, 0x2a2016, 0.95 * Math.PI));
          const sun = new THREE.DirectionalLight(0xffffff, 0.9 * Math.PI);
          sun.position.set(4, 9, 6);
          scene.add(sun, new THREE.AmbientLight(0xffffff, 0.2 * Math.PI));

          // Minimal reference: water surface and riverbed for the three mooring chains.
          const bed = new THREE.Mesh(new THREE.CircleGeometry(16, 96), new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 1 }));
          bed.rotation.x = -Math.PI / 2;
          bed.position.y = BED_Y;
          const water = new THREE.Mesh(
            new THREE.CircleGeometry(16, 96),
            new THREE.MeshStandardMaterial({ color: 0x3f9fb3, transparent: true, opacity: 0.28, roughness: 0.15, side: THREE.DoubleSide, depthWrite: false }),
          );
          water.rotation.x = -Math.PI / 2;
          water.position.y = WATER_Y;
          water.renderOrder = 4;
          scene.add(bed, water);

          const model = createBuoyModel({ diseno: this.design(), bedY: BED_Y });
          scene.add(model.root);
          model.setRayosX(this.xray());
          this.model = model;

          const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 60);
          const controls = new OrbitControls(camera, renderer.domElement);
          controls.enableDamping = true;
          controls.minDistance = 0.5;
          controls.maxDistance = 8;
          {
            const [p, t] = VIEWS.iso;
            camera.position.set(p[0], p[1] + WATER_Y, p[2]);
            controls.target.set(t[0], t[1] + WATER_Y, t[2]);
          }

          let camAnim: { p: import('three').Vector3; t: import('three').Vector3 } | null = null;
          controls.addEventListener('start', () => (camAnim = null));
          this.goTo = (v) => {
            if (v === 'elec') {
              const t = new THREE.Vector3();
              model.anchors['control']?.getWorldPosition(t);
              camAnim = { p: model.localAMundo(0.24, 0.36, 0.3), t };
            } else if (v === 'filtros') {
              camAnim = { p: model.localAMundo(0.1, -0.4, 0.6), t: model.localAMundo(0, -0.27, 0.02) };
            } else {
              const [p, t] = VIEWS[v];
              const by = model.telemetria().bodyY - 0.05;
              camAnim = { p: new THREE.Vector3(p[0], p[1] + by, p[2]), t: new THREE.Vector3(t[0], t[1] + by, t[2]) };
            }
          };

          const resize = () => {
            const w = host.clientWidth || 1;
            const h = host.clientHeight || 1;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.fov = camera.aspect < 0.85 ? 60 : 42;
            camera.updateProjectionMatrix();
          };
          const ro = new ResizeObserver(resize);
          ro.observe(host);
          resize();

          // With reduced motion the model stays still and only redraws when the camera moves.
          const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          let last = performance.now();
          let t = 0;
          let lastBy: number | null = null;
          let frames = 0;
          let raf = 0;
          const frame = (now: number) => {
            raf = requestAnimationFrame(frame);
            const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
            last = now;
            t += dt;
            const animate = !reducedMotion || frames < 90; // let it settle on the water first
            if (animate) {
              model.update(dt, {
                current: CURRENT,
                waterLevel: WATER_Y,
                flowAngle: ((6 * Math.sin(t * 0.12)) * Math.PI) / 180,
                showFlow: true,
                showEnergy: true,
                showFish: false,
              });
              // The camera follows the buoy's bobbing (same as the artifact).
              const by = model.telemetria().bodyY;
              if (lastBy != null) {
                const dy = by - lastBy;
                camera.position.y += dy;
                controls.target.y += dy;
                if (camAnim) {
                  camAnim.p.y += dy;
                  camAnim.t.y += dy;
                }
              }
              lastBy = by;
            }
            if (camAnim) {
              const k = Math.min(1, dt * 2.5);
              camera.position.lerp(camAnim.p, k);
              controls.target.lerp(camAnim.t, k);
              if (camera.position.distanceTo(camAnim.p) < 0.02) camAnim = null;
            }
            const moved = controls.update();
            if (animate || moved || camAnim) renderer.render(scene, camera);
            frames++;
          };
          raf = requestAnimationFrame(frame);
          this.state.set('ready');
          this.goTo(this.view());

          cleanup = () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            controls.dispose();
            disposeObject(scene);
            renderer.dispose();
            renderer.forceContextLoss();
            renderer.domElement.remove();
            this.model = undefined;
            this.goTo = undefined;
          };
        })
        .catch(() => {
          if (!destroyed) this.state.set('error');
        });
    });

    destroyRef.onDestroy(() => {
      destroyed = true;
      cleanup?.();
    });

    effect(() => {
      const v = this.view();
      if (this.state() === 'ready') this.goTo?.(v);
    });
    effect(() => {
      const on = this.xray();
      if (this.state() === 'ready') this.model?.setRayosX(on);
    });
  }
}
