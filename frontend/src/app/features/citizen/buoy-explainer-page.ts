import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { deviceCodeFor } from '../../core/models/telemetry.models';
import { TelemetryService } from '../../core/services/telemetry.service';
import { timeAgo } from '../../shared/utils/format.util';
import { BuoyViewer } from '../buoys/buoy-viewer';
import { citizenStyles } from './citizen.styles';

const CODES = ['RM-01', 'RM-02'];

/**
 * «Conoce la boya» for citizens: what the buoy does, its 3D model (design's initial state) and at most
 * one figure in words. No battery, pump, sensor health or other operation data (that is staff-only).
 */
@Component({
  selector: 'app-buoy-explainer-page',
  imports: [RouterLink, Button, BuoyViewer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    citizenStyles,
    `
      .viewer { height: 340px; border-radius: 18px; }
      .fact { display: flex; align-items: center; gap: .8rem; background: #e6f8fc; border-color: #bfeaf4; }
      .fact strong { font-size: 1.6rem; color: #005f7a; font-variant-numeric: tabular-nums; }
      .fact small { display: block; font-size: .74rem; color: var(--rm-muted); margin-top: .2rem; }
    `,
  ],
  template: `
    <div class="page cz">
      <header class="row" style="display: flex; align-items: center; gap: .4rem">
        <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" [rounded]="true" ariaLabel="Volver al inicio" routerLink="/inicio" />
        <div>
          <h1 class="page-title">Conoce la boya</h1>
          <p class="page-sub">Una boya anclada que vigila y limpia el agua del río.</p>
        </div>
      </header>

      <app-buoy-viewer class="viewer" source="Modelo del diseño" ariaLabel="Modelo 3D de la boya anclada en el río. Arrastra para girarla." />

      <section class="rm-card">
        <h2 style="margin-bottom: .8rem">¿Qué hace?</h2>
        <ol class="steps">
          <li><div><strong>Revisa el agua</strong><p>Mide qué tan ácida, turbia y caliente está el agua, y cuántas sustancias trae disueltas.</p></div></li>
          <li><div><strong>La limpia</strong><p>Una bomba pasa el agua por 4 capas de filtro.</p></div></li>
          <li><div><strong>La guarda</strong><p>El agua filtrada va por una manguera a un tinaco en la orilla.</p></div></li>
          <li><div><strong>Recoge basura</strong><p>Una cesta atrapa la basura que flota; la brigada la vacía.</p></div></li>
          <li><div><strong>Avisa</strong><p>Manda sus datos por internet celular; si el agua empeora, aparece un aviso en esta app.</p></div></li>
        </ol>
      </section>

      @if (fact(); as f) {
        <section class="rm-card fact" aria-live="polite">
          <i class="pi pi-filter" style="font-size: 1.6rem; color: #0077b6" aria-hidden="true"></i>
          <div>
            <p>En su último envío, la boya {{ f.code }} dejó el agua</p>
            <strong>{{ f.pct }} % más clara</strong>
            <small>Calculado con la turbidez medida a la entrada y a la salida del filtro · {{ f.ago }}</small>
          </div>
        </section>
      }

      <section class="rm-card">
        <h2>¿Viste basura o una descarga?</h2>
        <p class="muted" style="margin: .3rem 0 .8rem">La boya no lo ve todo. Tu reporte también cuenta.</p>
        <p-button label="Reportar un problema" icon="pi pi-camera" routerLink="/reportar" [fluid]="true" />
      </section>
    </div>
  `,
})
export class BuoyExplainerPage {
  private readonly telemetry = inject(TelemetryService);

  constructor() {
    CODES.forEach((c) => this.telemetry.ensureLoaded(c));
  }

  /** Filter efficiency (derived by the firmware from inlet vs. outlet turbidity, only while water flows). */
  protected readonly fact = computed(() => {
    const p = CODES.map((c) => ({ code: c, p: this.telemetry.packets()[deviceCodeFor(c)] ?? null }))
      .filter((x) => x.p?.device_efficiency_pct != null && x.p.device_efficiency_pct > 0)
      .sort((a, b) => b.p!.ts.localeCompare(a.p!.ts))[0];
    if (!p?.p) return null;
    return { code: p.code, pct: Math.round(p.p.device_efficiency_pct!), ago: timeAgo(p.p.ts) };
  });
}
