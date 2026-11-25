import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { catchError, forkJoin, map, of } from 'rxjs';
import { OpsApi } from '../../core/api/ops-api';
import { CitizenReport } from '../../core/models/ops.models';
import { Pill } from '../../shared/components/pill';
import { timeAgo } from '../../shared/utils/format.util';
import { REPORT_STATUS_META, REPORT_TYPE_META } from '../../shared/utils/ops.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { citizenStyles } from '../citizen/citizen.styles';
import { myFolios } from './my-reports';

/** Reports sent from this device (folios kept in localStorage), each with its current status. */
@Component({
  selector: 'app-my-reports-page',
  imports: [RouterLink, Button, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    citizenStyles,
    `
      .list { list-style: none; margin: 0; padding: 0; display: grid; gap: .6rem; }
      .item { display: flex; align-items: center; gap: .75rem; text-decoration: none; color: inherit; }
      .item > i:first-child { font-size: 1.25rem; width: 1.6rem; text-align: center; }
      .item > div { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .15rem; }
      .item small { color: var(--rm-muted); font-size: .78rem; }
      .item .hint { font-size: .8rem; color: var(--rm-muted); }
    `,
  ],
  template: `
    <div class="page cz">
      <header>
        <h1 class="page-title">Mis reportes</h1>
        <p class="page-sub">Los reportes que enviaste desde este teléfono y en qué van.</p>
      </header>

      @if (folios.length === 0) {
        <div class="rm-card empty">
          <i class="pi pi-send" style="font-size: 2rem" aria-hidden="true"></i>
          <p><strong>Aún no has enviado reportes.</strong></p>
          <p>Cuando envíes uno, aquí verás si ya lo revisaron y si la brigada lo atendió.</p>
          <p-button label="Reportar un problema" icon="pi pi-camera" routerLink="/reportar" />
        </div>
      } @else if (rows(); as list) {
        <ul class="list">
          @for (r of list; track r.folio) {
            <li>
              <a class="rm-card item" [routerLink]="['/reportar/seguimiento', r.folio]">
                @if (r.report; as rep) {
                  <i [class]="typeMeta[rep.type].icon" [style.color]="typeMeta[rep.type].color" aria-hidden="true"></i>
                  <div>
                    <strong>{{ typeMeta[rep.type].label }}</strong>
                    <small>{{ r.folio }} · enviado {{ ago(rep.created_at) }}</small>
                    <span class="hint">{{ statusMeta[rep.status].hint }}</span>
                  </div>
                  <app-pill [label]="statusMeta[rep.status].label" [color]="statusMeta[rep.status].color" [bg]="statusMeta[rep.status].bg" />
                } @else {
                  <i class="pi pi-question-circle muted" aria-hidden="true"></i>
                  <div><strong>{{ r.folio }}</strong><small>No pudimos consultar este folio ahora.</small></div>
                }
                <i class="pi pi-chevron-right muted" aria-hidden="true"></i>
              </a>
            </li>
          }
        </ul>
      } @else {
        <div class="skeleton" style="height: 180px"></div>
      }

      <section class="rm-card">
        <h2>¿Tienes un folio de otro teléfono?</h2>
        <p class="muted" style="margin: .3rem 0 .8rem">Puedes consultarlo desde la pantalla de reportes.</p>
        <p-button label="Consultar un folio" icon="pi pi-search" severity="secondary" [outlined]="true" routerLink="/reportar" [fluid]="true" />
      </section>
    </div>
  `,
})
export class MyReportsPage {
  private readonly api = inject(OpsApi);
  protected readonly folios = myFolios();
  protected readonly typeMeta = REPORT_TYPE_META;
  protected readonly statusMeta = REPORT_STATUS_META;
  protected readonly ago = timeAgo;

  private readonly res = rxResource({
    stream: () =>
      this.folios.length
        ? forkJoin(this.folios.map((folio) => this.api.reportByFolio(folio).pipe(map((report): Row => ({ folio, report })), catchError(() => of<Row>({ folio, report: null })))))
        : of<Row[]>([]),
  });
  protected readonly rows = computed(() => valueOrUndefined(this.res));
}

interface Row {
  folio: string;
  report: CitizenReport | null;
}
