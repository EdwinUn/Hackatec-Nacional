import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { OpsApi } from '../api/ops-api';
import { Role, Session, User } from '../models/ops.models';

const STORAGE_KEY = 'rm.session';

/** Home screen of each role after logging in. */
export const ROLE_HOME: Record<Role, string> = {
  technician: '/operaciones/mis-tareas',
  supervisor: '/operaciones/reportes',
  admin: '/operaciones/reportes',
};

/**
 * Staff session (technicians, supervisors, admins). Citizens never log in.
 * The session is kept in `localStorage`; the backend token is a JWT (proposed `POST /auth/login`).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(OpsApi);
  private readonly router = inject(Router);

  private readonly session = signal<Session | null>(this.restore());

  readonly user = computed<User | null>(() => this.session()?.user ?? null);
  readonly token = computed(() => this.session()?.token ?? null);
  readonly role = computed<Role | null>(() => this.user()?.role ?? null);
  readonly isLoggedIn = computed(() => this.session() !== null);
  readonly isManager = computed(() => this.hasRole('supervisor', 'admin'));

  login(email: string, password: string): Observable<Session> {
    return this.api.login(email, password).pipe(
      tap((s) => {
        this.session.set(s);
        this.persist(s);
      }),
    );
  }

  logout(redirect = true): void {
    this.session.set(null);
    this.persist(null);
    if (redirect) void this.router.navigateByUrl('/login');
  }

  hasRole(...roles: Role[]): boolean {
    const r = this.role();
    return r !== null && roles.includes(r);
  }

  homeUrl(): string {
    const r = this.role();
    return r ? ROLE_HOME[r] : '/resumen';
  }

  private restore(): Session | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const s = raw ? (JSON.parse(raw) as Session) : null;
      return s && s.expires_at > Date.now() ? s : null;
    } catch {
      return null;
    }
  }

  private persist(s: Session | null): void {
    try {
      if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable: session lives in memory */
    }
  }
}
