import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { Button } from 'primeng/button';
import { Message } from 'primeng/message';
import { SelectButton } from 'primeng/selectbutton';
import { Textarea } from 'primeng/textarea';
import { InputText } from 'primeng/inputtext';
import { OpsApi } from '../../core/api/ops-api';
import { CitizenReport, GeoPoint, ReportType } from '../../core/models/ops.models';
import { GeoService } from '../../core/services/geo.service';
import { MapPoint, MiniMap } from '../../shared/components/mini-map';
import { PhotoInput } from '../../shared/components/photo-input';
import { Pill } from '../../shared/components/pill';
import { formatCoords, timeAgo } from '../../shared/utils/format.util';
import { REPORT_STATUS_META, REPORT_TYPE_META, REPORT_TYPES } from '../../shared/utils/ops.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { rememberFolio, myFolios } from './my-reports';

@Component({
  selector: 'app-report-page',
  imports: [FormsModule, RouterLink, Button, InputText, Message, SelectButton, Textarea, MiniMap, PhotoInput, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './reports.scss',
  template: `
    <div class="page">
      <div>
        <h1 class="page-title">Reportar contaminación</h1>
        <p class="page-sub">¿Viste basura, una descarga o algo raro en el río o la barranca? Repórtalo: una brigada lo revisará. No necesitas cuenta.</p>
      </div>

      <div class="layout">
        @if (sent(); as r) {
          <section class="rm-card done" aria-live="polite">
            <i class="pi pi-check-circle big" aria-hidden="true"></i>
            <h2>¡Gracias por tu reporte!</h2>
            <p class="muted">Guarda tu folio para consultar el avance:</p>
            <p class="folio">{{ r.folio }}</p>
            <div class="row center">
              <p-button label="Ver seguimiento" icon="pi pi-search" [routerLink]="['/reportar/seguimiento', r.folio]" />
              <p-button label="Hacer otro reporte" icon="pi pi-plus" severity="secondary" [outlined]="true" (onClick)="reset()" />
            </div>
          </section>
        } @else {
          <form class="rm-card stack form" (ngSubmit)="submit()">
            <fieldset>
              <legend>1. ¿Qué encontraste?</legend>
              <p-selectbutton [options]="typeOptions" [(ngModel)]="type" name="type" optionValue="value" [allowEmpty]="false" class="types" ariaLabel="Tipo de problema">
                <ng-template #item let-o>
                  <span class="type-opt"><i [class]="o.icon" [style.color]="o.color" aria-hidden="true"></i>{{ o.label }}</span>
                </ng-template>
              </p-selectbutton>
            </fieldset>

            <fieldset>
              <legend>2. ¿Dónde está?</legend>
              <div class="row">
                <p-button label="Usar mi ubicación" icon="pi pi-map-marker" [loading]="locating()" severity="secondary" (onClick)="locate()" />
                @if (point(); as p) {
                  <span class="muted small">{{ coords(p.latitude, p.longitude) }}@if (p.accuracy) { · ±{{ p.accuracy }} m }</span>
                }
              </div>
              @if (geoError()) { <p-message severity="warn">{{ geoError() }}</p-message> }
              <app-mini-map class="map" [pickable]="true" [value]="point()" [points]="mapPoints()" (picked)="point.set($event)" />
            </fieldset>

            <fieldset>
              <legend>3. Foto (recomendada)</legend>
              <app-photo-input [(value)]="photo" label="Tomar foto del problema" />
            </fieldset>

            <fieldset>
              <legend>4. Describe lo que viste</legend>
              <textarea pTextarea name="description" rows="3" [(ngModel)]="description" maxlength="500" placeholder="Ej. Tubo descargando agua con espuma bajo el puente de la calle 5 de Mayo" [autoResize]="true"></textarea>
              <small class="muted">{{ description.length }}/500</small>
            </fieldset>

            @if (error()) { <p-message severity="error">{{ error() }}</p-message> }
            <p-button type="submit" label="Enviar reporte" icon="pi pi-send" [loading]="sending()" [disabled]="!canSend()" [fluid]="true" />
            <p class="muted small"><i class="pi pi-lock"></i> No pedimos tus datos personales. La ubicación y la foto solo se usan para atender el reporte.</p>
          </form>
        }

        <aside class="stack">
          <section class="rm-card">
            <h2 class="rm-card-title"><i class="pi pi-search"></i> Consultar un folio</h2>
            <form class="row" (ngSubmit)="track()">
              <input pInputText class="folio-input" name="folio" [(ngModel)]="folioQuery" placeholder="RC-0001" aria-label="Folio del reporte" />
              <p-button type="submit" icon="pi pi-arrow-right" ariaLabel="Consultar" [disabled]="!folioQuery.trim()" />
            </form>
            @if (mine().length) {
              <p class="muted small">Tus reportes en este dispositivo:</p>
              <div class="row">
                @for (f of mine(); track f) { <a class="chip" [routerLink]="['/reportar/seguimiento', f]">{{ f }}</a> }
              </div>
            }
          </section>

          <section class="rm-card">
            <h2 class="rm-card-title"><i class="pi pi-users"></i> Reportes recientes de la comunidad</h2>
            <ul class="recent">
              @for (r of recent(); track r.id) {
                <li>
                  <i [class]="typeMeta[r.type].icon" [style.color]="typeMeta[r.type].color" aria-hidden="true"></i>
                  <div>
                    <strong>{{ typeMeta[r.type].label }}</strong>
                    <small class="muted">{{ r.folio }} · {{ ago(r.created_at) }}</small>
                  </div>
                  <app-pill [label]="statusMeta[r.status].label" [color]="statusMeta[r.status].color" [bg]="statusMeta[r.status].bg" />
                </li>
              } @empty {
                <li class="muted">Aún no hay reportes.</li>
              }
            </ul>
          </section>
        </aside>
      </div>
    </div>
  `,
})
export class ReportPage {
  private readonly api = inject(OpsApi);
  private readonly geo = inject(GeoService);
  private readonly toast = inject(MessageService);
  private readonly router = inject(Router);

  protected readonly typeMeta = REPORT_TYPE_META;
  protected readonly statusMeta = REPORT_STATUS_META;
  protected readonly typeOptions = REPORT_TYPES.map((value) => ({ value, ...REPORT_TYPE_META[value] }));
  protected readonly coords = formatCoords;
  protected readonly ago = timeAgo;

  protected type: ReportType = 'trash';
  protected description = '';
  protected readonly photo = signal<string | null>(null);
  protected readonly point = signal<GeoPoint | null>(null);
  protected folioQuery = '';

  protected readonly locating = signal(false);
  protected readonly geoError = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sent = signal<CitizenReport | null>(null);
  protected readonly mine = signal(myFolios());

  private readonly reports = rxResource({ stream: () => this.api.citizenReports() });
  protected readonly recent = computed(() => (valueOrUndefined(this.reports) ?? []).slice(0, 6));
  protected readonly mapPoints = computed<MapPoint[]>(() =>
    (valueOrUndefined(this.reports) ?? []).map((r) => ({ id: r.id, latitude: r.latitude, longitude: r.longitude, color: REPORT_TYPE_META[r.type].color, label: `${r.folio} · ${REPORT_TYPE_META[r.type].label}` })),
  );

  protected canSend(): boolean {
    return !!this.point() && (!!this.photo() || this.description.trim().length >= 5) && !this.sending();
  }

  protected async locate(): Promise<void> {
    this.locating.set(true);
    this.geoError.set(null);
    try {
      this.point.set(await this.geo.current());
    } catch (e) {
      this.geoError.set((e as Error).message + ' También puedes marcar el punto en el mapa.');
    } finally {
      this.locating.set(false);
    }
  }

  protected submit(): void {
    const p = this.point();
    if (!p || !this.canSend()) return;
    this.sending.set(true);
    this.error.set(null);
    this.api.createCitizenReport({ type: this.type, description: this.description, photo: this.photo(), ...p }).subscribe({
      next: (r) => {
        this.sending.set(false);
        rememberFolio(r.folio);
        this.mine.set(myFolios());
        this.sent.set(r);
        this.reports.reload();
        this.toast.add({ key: 'app', severity: 'success', summary: 'Reporte enviado', detail: `Folio ${r.folio}`, life: 5000 });
      },
      error: (e: Error) => {
        this.sending.set(false);
        this.error.set(e.message || 'No se pudo enviar el reporte. Intenta de nuevo.');
      },
    });
  }

  protected reset(): void {
    this.sent.set(null);
    this.description = '';
    this.photo.set(null);
    this.point.set(null);
    this.type = 'trash';
  }

  protected track(): void {
    const f = this.folioQuery.trim().toUpperCase();
    if (f) void this.router.navigate(['/reportar/seguimiento', f]);
  }
}
