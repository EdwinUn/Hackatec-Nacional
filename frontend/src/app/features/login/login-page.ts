import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Password } from 'primeng/password';
import { AuthService } from '../../core/auth/auth.service';
import { APP_CONFIG } from '../../core/config/app-config';
import { REAL_DEMO_PASSWORD, REAL_DEMO_USERS } from '../../core/auth/demo-accounts';
import { DEMO_PASSWORD, DEMO_USERS } from '../../core/mock/mock-ops-api';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule, RouterLink, Button, InputText, Message, Password],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; place-items: center; min-height: 100dvh; padding: 1rem; background: radial-gradient(1200px 600px at 10% -10%, #1f7a5a33, transparent), var(--rm-forest); }
    .card { width: min(420px, 100%); background: var(--rm-card); border-radius: 16px; padding: 1.75rem 1.5rem; box-shadow: 0 20px 50px rgb(0 0 0 / .35); display: flex; flex-direction: column; gap: 1rem; }
    .brand { display: flex; align-items: center; gap: .7rem; }
    .brand strong { display: block; font-size: 1.15rem; }
    .brand small { color: var(--rm-muted); }
    h1 { font-size: 1.2rem; }
    form { display: flex; flex-direction: column; gap: .9rem; }
    label { display: flex; flex-direction: column; gap: .35rem; font-size: .85rem; font-weight: 600; }
    :host ::ng-deep .p-password, :host ::ng-deep .p-password input { width: 100%; }
    .demo { border-top: 1px dashed var(--rm-border); padding-top: .9rem; display: flex; flex-direction: column; gap: .5rem; }
    .demo p { margin: 0; font-size: .8rem; }
    .demo .row { gap: .4rem; }
    .back { text-align: center; font-size: .85rem; color: var(--rm-muted); }
  `,
  template: `
    <main class="card">
      <div class="brand">
        <svg viewBox="0 0 32 32" width="38" height="38" aria-hidden="true"><path d="M16 3C10 10 6 14.5 6 19a10 10 0 0 0 20 0c0-4.5-4-9-10-16Z" fill="#3ddc97"/><path d="M10 21c2.2-1.6 3.8 1.6 6 0s3.8 1.6 6 0" stroke="#112a22" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
        <div><strong>Atl-Monitor</strong><small>Acceso para personal operativo</small></div>
      </div>
      <h1>Iniciar sesión</h1>

      <form (ngSubmit)="submit()" #f="ngForm">
        <label>Correo
          <input pInputText type="email" name="email" autocomplete="username" inputmode="email" required [(ngModel)]="email" />
        </label>
        <label>Contraseña
          <p-password name="password" [(ngModel)]="password" [feedback]="false" [toggleMask]="true" autocomplete="current-password" [required]="true" inputId="pwd" />
        </label>
        @if (error()) { <p-message severity="error">{{ error() }}</p-message> }
        <p-button type="submit" label="Entrar" icon="pi pi-sign-in" [loading]="loading()" [disabled]="!email || !password" styleClass="w-full" [fluid]="true" />
      </form>

      @if (showDemo) {
        <section class="demo" aria-label="Cuentas de demostración">
          <p class="muted"><i class="pi pi-info-circle"></i> Prototipo: cuentas de demostración (contraseña <code>{{ demoPassword }}</code>).</p>
          <div class="row">
            @for (u of demoUsers; track u.email) {
              <p-button [label]="u.label" size="small" severity="secondary" [outlined]="true" (onClick)="fill(u.email)" />
            }
          </div>
        </section>
      }

      <a class="back" routerLink="/resumen"><i class="pi pi-arrow-left"></i> Volver al monitoreo público</a>
    </main>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** Demo accounts: always with the mock, and in non-production builds (the backend seed creates them in dev). */
  protected readonly showDemo = inject(APP_CONFIG).opsMocks || !environment.production;
  private readonly realAuth = !inject(APP_CONFIG).useMocks;
  protected readonly demoUsers = this.realAuth ? REAL_DEMO_USERS : DEMO_USERS;
  protected readonly demoPassword = this.realAuth ? REAL_DEMO_PASSWORD : DEMO_PASSWORD;

  /** `?next=` set by the guards. */
  readonly next = input<string | undefined>();

  protected email = '';
  protected password = '';
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected fill(email: string): void {
    this.email = email;
    this.password = this.demoPassword;
    this.submit();
  }

  protected submit(): void {
    if (!this.email || !this.password || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.auth.login(this.email, this.password).subscribe({
      next: () => {
        this.loading.set(false);
        const next = this.next();
        void this.router.navigateByUrl(next && next.startsWith('/') && !next.startsWith('//') ? next : this.auth.homeUrl());
      },
      error: (e: Error) => {
        this.loading.set(false);
        this.error.set(e.message || 'No se pudo iniciar sesión.');
      },
    });
  }
}
