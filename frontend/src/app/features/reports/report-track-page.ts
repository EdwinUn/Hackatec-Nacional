import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { OpsApi } from '../../core/api/ops-api';
import { ReportStatus } from '../../core/models/ops.models';
import { MiniMap } from '../../shared/components/mini-map';
import { Pill } from '../../shared/components/pill';
import { formatCoords, timeAgo } from '../../shared/utils/format.util';
import { REPORT_STATUS_META, REPORT_TYPE_META } from '../../shared/utils/ops.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';

const FLOW: ReportStatus[] = ['new', 'verified', 'in_progress', 'resolved'];

@Component({
  selector: 'app-report-track-page',
  imports: [DatePipe, RouterLink, Button, MiniMap, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './reports.scss',
  template: `
    <div class="page track">
      <div class="row">
        <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" [rounded]="true" ariaLabel="Volver" routerLink="/reportar" />
        <div>
          <h1 class="page-title">Seguimiento del reporte {{ folio().toUpperCase() }}</h1>
          <p class="page-sub">Consulta en qué va la atención de tu reporte.</p>
        </div>
      </div>

      @if (report(); as r) {
        <section class="rm-card stack">
          <div class="row">
            <i [class]="typeMeta[r.type].icon" [style.color]="typeMeta[r.type].color" aria-hidden="true"></i>
            <strong>{{ typeMeta[r.type].label }}</strong>
            <app-pill [label]="statusMeta[r.status].label" [color]="statusMeta[r.status].color" [bg]="statusMeta[r.status].bg" />
            <span class="muted small" style="margin-left:auto">Enviado {{ ago(r.created_at) }}</span>
          </div>
          <p class="muted" style="margin:0">{{ statusMeta[r.status].hint }}</p>
          @if (r.public_note) { <p class="note"><i class="pi pi-comment"></i> {{ r.public_note }}</p> }

          <ol class="steps" aria-label="Avance">
            @for (s of steps(); track s.status) {
              <li [class.on]="s.reached" [class.reject]="s.status === 'rejected'">
                <span class="dot"><i [class]="s.reached ? 'pi pi-check' : 'pi pi-circle'" aria-hidden="true"></i></span>
                <div><strong>{{ statusMeta[s.status].label }}</strong><p class="muted">{{ statusMeta[s.status].hint }}</p></div>
              </li>
            }
          </ol>
        </section>

        <section class="rm-card stack">
          <h2 class="rm-card-title"><i class="pi pi-info-circle"></i> Lo que reportaste</h2>
          @if (r.photo) { <img class="photo" [src]="r.photo" alt="Foto del reporte" /> }
          @if (r.description) { <p style="margin:0">{{ r.description }}</p> }
          <p class="muted small" style="margin:0"><i class="pi pi-map-marker"></i> {{ coords(r.latitude, r.longitude) }} · {{ r.created_at | date: 'dd/MM/yyyy HH:mm' }}</p>
          <app-mini-map class="map" [value]="{ latitude: r.latitude, longitude: r.longitude }" />
        </section>
      } @else if (res.isLoading()) {
        <div class="skeleton" style="height: 260px"></div>
      } @else {
        <div class="rm-card empty">
          <i class="pi pi-search" aria-hidden="true"></i>
          <p>{{ errorText() }}</p>
          <p-button label="Hacer un reporte" icon="pi pi-plus" routerLink="/reportar" />
        </div>
      }
    </div>
  `,
})
export class ReportTrackPage {
  private readonly api = inject(OpsApi);
  readonly folio = input.required<string>();

  protected readonly typeMeta = REPORT_TYPE_META;
  protected readonly statusMeta = REPORT_STATUS_META;
  protected readonly coords = formatCoords;
  protected readonly ago = timeAgo;

  protected readonly res = rxResource({ params: () => this.folio(), stream: ({ params }) => this.api.reportByFolio(params) });
  protected readonly report = computed(() => valueOrUndefined(this.res) ?? null);
  protected readonly errorText = computed(() => (this.res.error() as Error | undefined)?.message ?? 'No encontramos ese folio.');

  protected readonly steps = computed(() => {
    const r = this.report();
    if (!r) return [];
    if (r.status === 'rejected') return [{ status: 'new' as ReportStatus, reached: true }, { status: 'rejected' as ReportStatus, reached: true }];
    const idx = FLOW.indexOf(r.status);
    return FLOW.map((status, i) => ({ status, reached: i <= idx }));
  });
}
