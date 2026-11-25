import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { RioApi } from '../../core/api/rio-api';
import { PublicAlertsService } from '../../core/services/public-alerts.service';
import { WQI_PLAIN } from '../../shared/utils/public-alerts.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { WQI_META } from '../../shared/utils/wqi.util';
import { myFolios } from '../reports/my-reports';
import { citizenStyles } from './citizen.styles';

/** Short calls to action shown at the top of the citizen home (one per visit). */
const MOTTOS = [
  'Las boyas vigilan el agua, pero tus ojos llegan a donde ellas no. Cada reporte cuenta.',
  'El Atoyac no se limpia solo: una foto tuya puede ser el primer paso.',
  'Lo que tú ves, la brigada lo atiende. Reporta y cuida tu río.',
  'Un río limpio empieza con alguien que no se queda callado.',
  'Tu río también es tu casa. Si ves basura o una descarga, avísanos.',
];

/** Citizen home (phones without a session): how the river is today, notices and a big «report» button. */
@Component({
  selector: 'app-citizen-home-page',
  imports: [RouterLink, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [citizenStyles],
  template: `
    <div class="page cz">
      <header>
        <h1 class="page-title">¿Cómo está el río hoy?</h1>
        <p class="page-sub">Cuenca del Alto Atoyac, Puebla</p>
      </header>

      <p class="motto"><i class="pi pi-heart-fill" aria-hidden="true"></i><span>{{ motto }}</span></p>

      @if (notices.count() > 0) {
        <a class="banner" [class.crit]="hasCritical()" routerLink="/avisos">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <span>
            <strong>{{ notices.count() === 1 ? 'Hay 1 aviso activo' : 'Hay ' + notices.count() + ' avisos activos' }}</strong>
            <small>Toca para ver dónde y qué hacer</small>
          </span>
          <i class="pi pi-chevron-right" aria-hidden="true"></i>
        </a>
      }

      <section class="rm-card cta">
        <div>
          <h2>¿Viste algo raro en el río?</h2>
          <p>Basura, una descarga, espuma o mal olor. Toma una foto y una brigada lo revisa. No necesitas cuenta.</p>
        </div>
        <p-button label="Reportar un problema" icon="pi pi-camera" routerLink="/reportar" [fluid]="true" size="large" />
      </section>

      <section class="rm-card">
        <h2 class="rm-card-title"><i class="pi pi-map-marker" aria-hidden="true"></i> Estado del agua por zona</h2>
        @if (spots(); as list) {
          <ul class="zones">
            @for (h of list; track h.station_id) {
              <li>
                <span class="light" [style.background]="wqi[h.wqi.category].color" aria-hidden="true"></span>
                <div>
                  <strong>{{ h.name }}</strong>
                  <p>{{ plain[h.wqi.category] }}</p>
                </div>
                <span class="tag" [style.color]="wqi[h.wqi.category].color" [style.background]="wqi[h.wqi.category].bg">{{ wqi[h.wqi.category].label }}</span>
              </li>
            } @empty {
              <li class="muted">Aún no hay zonas con datos.</li>
            }
          </ul>
          <p class="foot">Índice estimado a partir de las mediciones. Prototipo: parte de los datos son simulados y los umbrales son valores de demostración.</p>
        } @else if (spotsRes.error()) {
          <p class="muted">No pudimos cargar el estado del río. <button type="button" class="link" (click)="spotsRes.reload()">Reintentar</button></p>
        } @else {
          <div class="skeleton" style="height: 160px"></div>
        }
        <a class="more" routerLink="/mapa">Ver en el mapa <i class="pi pi-arrow-right" aria-hidden="true"></i></a>
      </section>

      @if (folios.length) {
        <section class="rm-card">
          <h2 class="rm-card-title"><i class="pi pi-send" aria-hidden="true"></i> Tus reportes</h2>
          <div class="chips">
            @for (f of folios.slice(0, 4); track f) { <a class="chip" [routerLink]="['/reportar/seguimiento', f]">{{ f }}</a> }
          </div>
          <a class="more" routerLink="/reportar/mis-reportes">Ver en qué van <i class="pi pi-arrow-right" aria-hidden="true"></i></a>
        </section>
      }

      <a class="rm-card learn" routerLink="/boyas/conoce">
        <i class="pi pi-compass" aria-hidden="true"></i>
        <span>
          <strong>Conoce la boya</strong>
          <small>Cómo limpia el agua y recoge la basura que flota</small>
        </span>
        <i class="pi pi-chevron-right" aria-hidden="true"></i>
      </a>

      <p class="staff">¿Eres parte de la brigada? <a routerLink="/login">Inicia sesión</a></p>
    </div>
  `,
})
export class CitizenHomePage {
  private readonly api = inject(RioApi);
  protected readonly notices = inject(PublicAlertsService);
  protected readonly wqi = WQI_META;
  protected readonly plain = WQI_PLAIN;
  protected readonly folios = myFolios();
  protected readonly motto = MOTTOS[Math.floor(Math.random() * MOTTOS.length)];

  protected readonly spotsRes = rxResource({ stream: () => this.api.hotspots() });
  protected readonly spots = computed(() => valueOrUndefined(this.spotsRes));
  protected readonly hasCritical = computed(() => this.notices.notices().some((n) => n.level === 'critical'));
}
