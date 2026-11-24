import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Role } from '../models/ops.models';
import { AuthService } from './auth.service';

/** Requires a staff session; otherwise goes to `/login?next=<url>`. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.isLoggedIn()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { next: state.url } });
};

/** Requires one of the roles; other staff members are sent to their home screen. */
export function roleGuard(...roles: Role[]): CanActivateFn {
  return (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.isLoggedIn()) return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
    return auth.hasRole(...roles) ? true : router.parseUrl(auth.homeUrl());
  };
}

/** `/login` is skipped when there is already a session. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? inject(Router).parseUrl(auth.homeUrl()) : true;
};
