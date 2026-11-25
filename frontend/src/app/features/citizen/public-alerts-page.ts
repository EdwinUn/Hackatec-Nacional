import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { PublicAlertsService } from '../../core/services/public-alerts.service';
import { timeAgo } from '../../shared/utils/format.util';
import { citizenStyles } from './citizen.styles';

/** Citizen notices: open water-quality alerts in plain language, with what to do. Technical alerts are staff-only. */
@Component({
  selector: 'app-public-alerts-page',
  imports: [RouterLink, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [citizenStyles],
  template: `
    <div class="page cz">
      <header>
        <h1 class="page-title">Avisos</h1>
        <p class="page-sub">Zonas donde el agua no está en buenas condiciones y qué hacer.</p>
      </header>

      @for (n of svc.notices(); track n.id) {
        <article class="rm-card notice" [class.crit]="n.level === 'critical'">
          <div class="top">
            <span class="lvl">{{ n.level === 'critical' ? 'Importante' : 'Precaución' }}</span>
            <span><i class="pi pi-map-marker" aria-hidden="true"></i> {{ n.place }}</span>
            <span>· {{ ago(n.at) }}</span>
            @if (n.count > 1) { <span>· {{ n.count }} mediciones fuera de rango</span> }
          </div>
          <h2><i [class]="n.icon" aria-hidden="true"></i> {{ n.title }}</h2>
          <p class="muted">{{ n.text }}</p>
          <p class="advice"><i class="pi pi-shield" aria-hidden="true"></i> {{ n.advice }}</p>
        </article>
      } @empty {
        @if (!svc.loaded()) {
          <div class="skeleton" style="height: 140px"></div>
        } @else if (svc.failed()) {
          <div class="rm-card empty">
            <i class="pi pi-wifi" aria-hidden="true"></i>
            <p>No pudimos consultar los avisos.</p>
            <p-button label="Reintentar" icon="pi pi-refresh" size="small" [outlined]="true" (onClick)="svc.reload()" />
          </div>
        } @else {
          <div class="rm-card empty">
            <i class="pi pi-check-circle" style="font-size: 2rem; color: #0f7a4d" aria-hidden="true"></i>
            <p><strong>No hay avisos activos.</strong></p>
            <p>No se han detectado problemas en la calidad del agua.</p>
          </div>
        }
      }

      <section class="rm-card">
        <h2>¿Viste algo que no aparece aquí?</h2>
        <p class="muted" style="margin: .3rem 0 .8rem">Tu reporte ayuda a que la brigada llegue más rápido.</p>
        <p-button label="Reportar un problema" icon="pi pi-camera" routerLink="/reportar" [fluid]="true" />
      </section>

      <p class="foot">Los avisos salen de las mediciones de pH, turbidez, sólidos disueltos y temperatura. Prototipo: parte de los datos son simulados y los umbrales son valores de demostración.</p>
    </div>
  `,
})
export class PublicAlertsPage {
  protected readonly svc = inject(PublicAlertsService);
  protected readonly ago = timeAgo;
}
