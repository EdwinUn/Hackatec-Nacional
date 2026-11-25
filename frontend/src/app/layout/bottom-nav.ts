import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { LayoutService } from '../core/services/layout.service';
import { AlertCounterService } from '../core/services/alert-counter.service';
import { PublicAlertsService } from '../core/services/public-alerts.service';

/**
 * Floating pill navigation for phones. Citizens (no session) get Inicio · Mapa · Reportar · Mis reportes ·
 * Avisos; staff get their work tools (inbox, buoys, map, technical alerts, dashboard).
 */
@Component({
  selector: 'app-bottom-nav',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: none; }
    @media (max-width: 767px), (pointer: coarse) and (max-width: 1400px) { :host { display: block; } }
    nav { position: fixed; z-index: 700; left: 50%; transform: translateX(-50%); bottom: calc(16px + env(safe-area-inset-bottom)); display: flex; align-items: center; gap: .25rem; padding: .35rem; border-radius: 999px; background: #1b263b; box-shadow: 0 10px 28px rgb(13 27 42 / .35); max-width: calc(100vw - 24px); transition: transform .3s cubic-bezier(.2, .8, .2, 1), opacity .25s; }
    nav.hidden { transform: translate(-50%, calc(100% + 32px + env(safe-area-inset-bottom))); opacity: 0; pointer-events: none; visibility: hidden; transition: transform .3s cubic-bezier(.2, .8, .2, 1), opacity .25s, visibility 0s .3s; }
    a { position: relative; display: inline-flex; align-items: center; gap: .45rem; height: 46px; min-width: 46px; justify-content: center; padding: 0 .85rem; border-radius: 999px; color: #8fa3bf; text-decoration: none; font-size: .82rem; font-weight: 700; white-space: nowrap; }
    a i { font-size: 1.15rem; }
    a span { display: none; }
    a.active { background: #00b4d8; color: #0d1b2a; padding: 0 1rem; }
    a.active span { display: inline; }
    a:focus-visible { outline: 2px solid #90e0ef; outline-offset: 2px; }
    .badge { position: absolute; top: 3px; right: 3px; min-width: 1.1rem; padding: 0 .3rem; border-radius: 999px; background: #e5484d; color: #fff; font-size: .65rem; line-height: 1.1rem; text-align: center; }
    a.primary:not(.active) { background: rgb(0 180 216 / .18); color: #90e0ef; }
    a.active .badge { top: -2px; right: -2px; border: 2px solid #1b263b; }
  `,
  template: `
    <nav aria-label="Navegación principal" [class.hidden]="layout.navHidden()" [attr.aria-hidden]="layout.navHidden()">
      @if (auth.isLoggedIn()) {
        <a [routerLink]="auth.homeUrl()" routerLinkActive="active" [attr.aria-label]="work().label"><i [class]="work().icon" aria-hidden="true"></i><span>{{ work().label }}</span></a>
        <a routerLink="/boyas" routerLinkActive="active" aria-label="Boyas"><i class="pi pi-compass" aria-hidden="true"></i><span>Boyas</span></a>
        <a routerLink="/mapa" routerLinkActive="active" aria-label="Mapa"><i class="pi pi-map" aria-hidden="true"></i><span>Mapa</span></a>
        <a routerLink="/alertas" routerLinkActive="active" aria-label="Alertas">
          <i class="pi pi-bell" aria-hidden="true"></i><span>Alertas</span>
          @if (alerts.open() > 0) { <b class="badge">{{ alerts.open() > 99 ? '99+' : alerts.open() }}</b> }
        </a>
        <a routerLink="/resumen" routerLinkActive="active" aria-label="Resumen"><i class="pi pi-objects-column" aria-hidden="true"></i><span>Resumen</span></a>
      } @else {
        <a routerLink="/inicio" routerLinkActive="active" aria-label="Inicio"><i class="pi pi-home" aria-hidden="true"></i><span>Inicio</span></a>
        <a routerLink="/mapa" routerLinkActive="active" aria-label="Mapa"><i class="pi pi-map" aria-hidden="true"></i><span>Mapa</span></a>
        <a class="primary" routerLink="/reportar" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" aria-label="Reportar"><i class="pi pi-camera" aria-hidden="true"></i><span>Reportar</span></a>
        <a routerLink="/reportar/mis-reportes" routerLinkActive="active" aria-label="Mis reportes"><i class="pi pi-send" aria-hidden="true"></i><span>Mis reportes</span></a>
        <a routerLink="/avisos" routerLinkActive="active" aria-label="Avisos">
          <i class="pi pi-bell" aria-hidden="true"></i><span>Avisos</span>
          @if (notices.count() > 0) { <b class="badge">{{ notices.count() > 99 ? '99+' : notices.count() }}</b> }
        </a>
      }
    </nav>
  `,
})
export class BottomNav {
  protected readonly auth = inject(AuthService);
  protected readonly alerts = inject(AlertCounterService);
  protected readonly notices = inject(PublicAlertsService);
  protected readonly layout = inject(LayoutService);
  /** First tab of the staff bar: technicians work from their inbox, managers from the citizen reports. */
  protected readonly work = computed(() =>
    this.auth.isManager() ? { label: 'Reportes', icon: 'pi pi-megaphone' } : { label: 'Bandeja', icon: 'pi pi-inbox' },
  );
}
