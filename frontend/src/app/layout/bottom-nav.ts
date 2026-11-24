import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LayoutService } from '../core/services/layout.service';
import { AlertCounterService } from '../core/services/alert-counter.service';

/** Floating pill navigation for phones. */
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
    a.active .badge { top: -2px; right: -2px; border: 2px solid #1b263b; }
  `,
  template: `
    <nav aria-label="Navegación principal" [class.hidden]="layout.navHidden()" [attr.aria-hidden]="layout.navHidden()">
      <a routerLink="/resumen" routerLinkActive="active" aria-label="Inicio"><i class="pi pi-objects-column" aria-hidden="true"></i><span>Inicio</span></a>
      <a routerLink="/mapa" routerLinkActive="active" aria-label="Mapa"><i class="pi pi-map" aria-hidden="true"></i><span>Mapa</span></a>
      <a routerLink="/reportar" routerLinkActive="active" aria-label="Reportes IA"><i class="pi pi-camera" aria-hidden="true"></i><span>Reportes IA</span></a>
      <a routerLink="/alertas" routerLinkActive="active" aria-label="Alertas">
        <i class="pi pi-bell" aria-hidden="true"></i><span>Alertas</span>
        @if (alerts.open() > 0) { <b class="badge">{{ alerts.open() > 99 ? '99+' : alerts.open() }}</b> }
      </a>
    </nav>
  `,
})
export class BottomNav {
  protected readonly alerts = inject(AlertCounterService);
  protected readonly layout = inject(LayoutService);
}
