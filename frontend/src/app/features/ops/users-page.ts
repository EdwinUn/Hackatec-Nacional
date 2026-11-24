import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Password } from 'primeng/password';
import { Select } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { OpsApi } from '../../core/api/ops-api';
import { AuthService } from '../../core/auth/auth.service';
import { Role, User } from '../../core/models/ops.models';
import { ROLE_META } from '../../shared/utils/ops.util';
import { valueOrUndefined } from '../../shared/utils/resource.util';

@Component({
  selector: 'app-users-page',
  imports: [FormsModule, Button, Dialog, InputText, Message, Password, Select, TableModule, ToggleSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ops.scss',
  styles: `
    form { display: flex; flex-direction: column; gap: .85rem; }
    :host ::ng-deep .p-password, :host ::ng-deep .p-password input, :host ::ng-deep form .p-select { width: 100%; }
  `,
  template: `
    <div class="page">
      <div class="head">
        <div>
          <h1 class="page-title">Usuarios</h1>
          <p class="page-sub">Personal con acceso al módulo de operaciones. Los ciudadanos no necesitan cuenta.</p>
        </div>
        <p-button label="Nuevo usuario" icon="pi pi-user-plus" (onClick)="openNew()" />
      </div>

      <section class="rm-card" style="padding:0; overflow:hidden">
        <p-table [value]="users()" [loading]="res.isLoading()" styleClass="p-datatable-sm" [tableStyle]="{ 'min-width': '620px' }">
          <ng-template #header><tr><th>Nombre</th><th>Correo</th><th style="width: 220px">Rol</th><th>Activo</th></tr></ng-template>
          <ng-template #body let-u>
            <tr>
              <td><strong>{{ u.name }}</strong></td>
              <td class="muted">{{ u.email }}</td>
              <td>
                <p-select [options]="roleOptions" [ngModel]="u.role" (ngModelChange)="patch(u, { role: $event })" optionLabel="label" optionValue="value" size="small" appendTo="body" [disabled]="u.id === me()" [style]="{ width: '100%' }" />
              </td>
              <td><p-toggleswitch [ngModel]="u.active" (ngModelChange)="patch(u, { active: $event })" [disabled]="u.id === me()" [ariaLabel]="'Activo: ' + u.name" /></td>
            </tr>
          </ng-template>
        </p-table>
      </section>
    </div>

    <p-dialog header="Nuevo usuario" [(visible)]="open" [modal]="true" [style]="{ width: 'min(460px, 96vw)' }" appendTo="body">
      <form (ngSubmit)="create()">
        <label class="field">Nombre <input pInputText name="name" [(ngModel)]="name" required /></label>
        <label class="field">Correo <input pInputText type="email" name="email" [(ngModel)]="email" required /></label>
        <label class="field">Rol
          <p-select name="role" [options]="roleOptions" [(ngModel)]="role" optionLabel="label" optionValue="value" appendTo="body" />
        </label>
        <label class="field">Contraseña inicial
          <p-password name="password" [(ngModel)]="password" [toggleMask]="true" [feedback]="false" />
        </label>
        @if (error()) { <p-message severity="error">{{ error() }}</p-message> }
      </form>
      <ng-template #footer>
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="open.set(false)" />
        <p-button label="Crear" icon="pi pi-check" [disabled]="!valid()" (onClick)="create()" />
      </ng-template>
    </p-dialog>
  `,
})
export class UsersPage {
  private readonly api = inject(OpsApi);
  private readonly toast = inject(MessageService);
  private readonly auth = inject(AuthService);

  protected readonly roleOptions = (Object.keys(ROLE_META) as Role[]).map((value) => ({ value, label: ROLE_META[value].label }));
  protected readonly res = rxResource({ stream: () => this.api.users() });
  protected readonly users = computed(() => valueOrUndefined(this.res) ?? []);
  protected readonly me = computed(() => this.auth.user()?.id);

  protected readonly open = signal(false);
  protected readonly error = signal<string | null>(null);
  protected name = '';
  protected email = '';
  protected role: Role = 'technician';
  protected password = '';

  protected valid(): boolean {
    return this.name.trim().length > 2 && /\S+@\S+\.\S+/.test(this.email) && this.password.length >= 6;
  }

  protected openNew(): void {
    this.name = this.email = this.password = '';
    this.role = 'technician';
    this.error.set(null);
    this.open.set(true);
  }

  protected create(): void {
    if (!this.valid()) return;
    this.api.createUser({ name: this.name, email: this.email, role: this.role, password: this.password }).subscribe({
      next: (u) => {
        this.open.set(false);
        this.toast.add({ key: 'app', severity: 'success', summary: `Usuario ${u.name} creado`, life: 3000 });
        this.res.reload();
      },
      error: (e: Error) => this.error.set(e.message),
    });
  }

  protected patch(u: User, body: Partial<Pick<User, 'role' | 'active'>>): void {
    this.api.patchUser(u.id, body).subscribe(() => {
      this.toast.add({ key: 'app', severity: 'success', summary: `${u.name} actualizado`, life: 2500 });
      this.res.reload();
    });
  }
}
