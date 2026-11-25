import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Password } from 'primeng/password';
import { Popover } from 'primeng/popover';
import { AuthService } from '../core/auth/auth.service';
import { REAL_DEMO_OPERATOR, REAL_DEMO_PASSWORD } from '../core/auth/demo-accounts';
import { APP_CONFIG } from '../core/config/app-config';
import { LiveStreamService } from '../core/services/live-stream.service';
import { ROLE_META } from '../shared/utils/ops.util';

/**
 * Mobile top bar: `atl-monitor` wordmark on the left, avatar + live status on the right.
 * The app opens in public mode; tapping the avatar offers the brigade login (or the account menu).
 */
@Component({
  selector: 'app-header',
  imports: [FormsModule, RouterLink, Button, Dialog, InputText, Message, Password, Popover],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: none; }
    @media (max-width: 767px), (pointer: coarse) and (max-width: 1400px) { :host { display: block; position: sticky; top: 0; z-index: 40; } }
    header { display: flex; align-items: center; justify-content: space-between; padding: calc(.55rem + env(safe-area-inset-top)) 1rem .55rem; background: var(--atl-bg); }
    .brand { display: inline-flex; align-items: center; gap: .5rem; text-decoration: none; color: var(--atl-ink); }
    .brand img { width: 34px; height: 34px; border-radius: 10px; }
    .brand strong { font-size: 1.15rem; font-weight: 800; letter-spacing: -.03em; }
    .me { position: relative; width: 38px; height: 38px; border-radius: 50%; border: 0; background: #eef1f5; color: var(--atl-ink); font: 700 .8rem inherit; display: grid; place-items: center; cursor: pointer; }
    .me.in { background: #1b263b; color: #fff; }
    .me i { font-size: 1rem; }
    .dot { position: absolute; right: 1px; bottom: 1px; width: 11px; height: 11px; border-radius: 50%; border: 2px solid var(--atl-bg); background: #9aa5b1; }
    .dot.on { background: #00b4d8; animation: ping 1.8s infinite; }
    @keyframes ping { 70% { box-shadow: 0 0 0 6px rgb(0 180 216 / 0); } 100% { box-shadow: 0 0 0 0 rgb(0 180 216 / 0); } }
    .menu { display: grid; min-width: 230px; gap: .1rem; }
    .menu a, .menu button { display: flex; align-items: center; gap: .6rem; padding: .6rem .5rem; border: 0; background: none; border-radius: 10px; color: var(--atl-ink); font: inherit; font-size: .9rem; text-decoration: none; cursor: pointer; text-align: left; }
    .menu a:hover, .menu button:hover { background: #eef1f5; }
    .who { display: grid; gap: .25rem; padding: .35rem .5rem .6rem; }
    .who strong { font-size: .95rem; }
    .badge { justify-self: start; padding: .15rem .6rem; border-radius: 999px; background: #00b4d8; color: #0d1b2a; font-size: .72rem; font-weight: 800; }
    .who small { color: var(--atl-muted); font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; }
    .login { display: flex; flex-direction: column; gap: .8rem; }
    .login label { display: flex; flex-direction: column; gap: .3rem; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--atl-muted); font-weight: 600; }
    .login small { color: var(--atl-muted); }
    .or { text-align: center; color: var(--atl-muted); font-size: .8rem; }
    :host ::ng-deep .login .p-password, :host ::ng-deep .login .p-password input { width: 100%; }
  `,
  template: `
    <header>
      <a class="brand" routerLink="/resumen" aria-label="Atl-Monitor, inicio">
        <img src="logo-atl-mark.png" alt="" width="34" height="34" />
        <strong>atl-monitor</strong>
      </a>
      <button type="button" class="me" [class.in]="auth.isLoggedIn()" (click)="onAvatar($event, pop)" [attr.aria-label]="(auth.isLoggedIn() ? 'Cuenta de ' + auth.user()?.name : 'Acceso para personal') + '. ' + statusText()">
        @if (initials(); as i) { {{ i }} } @else { <i class="pi pi-user" aria-hidden="true"></i> }
        <span class="dot" [class.on]="live.status() !== 'disconnected'"></span>
      </button>
    </header>

    <p-popover #pop appendTo="body">
      <nav class="menu" (click)="pop.hide()">
        @if (auth.user(); as u) {
          <div class="who">
            <strong>{{ u.name }}</strong>
            <span class="badge">{{ roleMeta[u.role].label }}</span>
            <small>{{ statusText() }}</small>
          </div>
          <a routerLink="/operaciones/bandeja"><i class="pi pi-inbox" aria-hidden="true"></i> Mi bandeja</a>
          <a routerLink="/boyas"><i class="pi pi-th-large" aria-hidden="true"></i> Boyas skimmer</a>
          @if (auth.isManager()) {
            <a routerLink="/operaciones/reportes"><i class="pi pi-megaphone" aria-hidden="true"></i> Reportes ciudadanos</a>
            <a routerLink="/operaciones/ordenes"><i class="pi pi-clipboard" aria-hidden="true"></i> Órdenes de trabajo</a>
          }
          <a routerLink="/analitica"><i class="pi pi-chart-line" aria-hidden="true"></i> Analítica predictiva</a>
          <button type="button" (click)="logout()"><i class="pi pi-sign-out" aria-hidden="true"></i> Cerrar sesión</button>
        }
      </nav>
    </p-popover>

    <p-dialog [visible]="loginOpen()" (visibleChange)="loginOpen.set($event)" [modal]="true" [draggable]="false" [style]="{ width: 'min(400px, 94vw)' }" header="Acceso para personal" appendTo="body">
      <form class="login" (ngSubmit)="submit()">
        <small>La app es pública para ciudadanos. Inicia sesión solo si eres parte de la brigada.</small>
        <label>Correo
          <input pInputText type="email" name="email" autocomplete="username" inputmode="email" [ngModel]="email()" (ngModelChange)="email.set($event)" required />
        </label>
        <label>Contraseña
          <p-password name="password" [ngModel]="password()" (ngModelChange)="password.set($event)" [feedback]="false" [toggleMask]="true" autocomplete="current-password" [required]="true" />
        </label>
        @if (error()) { <p-message severity="error">{{ error() }}</p-message> }
        <p-button type="submit" label="Entrar" icon="pi pi-sign-in" [loading]="loading()" [disabled]="!email() || !password()" [fluid]="true" />
        <span class="or">o</span>
        @if (demoEnabled) {
          <p-button label="Entrar como Operador Demo" icon="pi pi-bolt" severity="secondary" [outlined]="true" [loading]="loading()" [fluid]="true" (onClick)="demo()" />
        }
      </form>
    </p-dialog>
  `,
})
export class AppHeader {
  protected readonly auth = inject(AuthService);
  protected readonly live = inject(LiveStreamService);
  private readonly router = inject(Router);
  protected readonly roleMeta = ROLE_META;
  protected readonly demoEnabled = !inject(APP_CONFIG).useMocks;

  protected readonly loginOpen = signal(false);
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly initials = computed(() =>
    (this.auth.user()?.name ?? '').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join(''),
  );
  protected readonly statusText = computed(() => {
    switch (this.live.status()) {
      case 'connected': return 'En vivo';
      case 'reconnecting': return 'Reconectando…';
      default: return 'Sin conexión';
    }
  });

  protected onAvatar(e: Event, pop: Popover): void {
    if (this.auth.isLoggedIn()) {
      pop.toggle(e);
    } else {
      this.error.set(null);
      this.loginOpen.set(true);
    }
  }

  protected demo(): void {
    this.email.set(REAL_DEMO_OPERATOR);
    this.password.set(REAL_DEMO_PASSWORD);
    this.submit();
  }

  protected submit(): void {
    if (!this.email() || !this.password() || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.auth.login(this.email(), this.password()).subscribe({
      next: () => {
        this.loading.set(false);
        this.loginOpen.set(false);
        this.password.set('');
        void this.router.navigateByUrl(this.auth.homeUrl());
      },
      error: (e: Error) => {
        this.loading.set(false);
        this.error.set(e.message || 'No se pudo iniciar sesión.');
      },
    });
  }

  protected logout(): void {
    this.auth.logout(false);
    void this.router.navigateByUrl('/resumen');
  }
}
