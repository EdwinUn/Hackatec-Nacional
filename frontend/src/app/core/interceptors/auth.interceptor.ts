import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { APP_CONFIG } from '../config/app-config';

/** Paths of the operations module that need the staff session. */
const STAFF_PATHS = ['/users', '/citizen-reports', '/work-orders', '/auth/me', '/tasks', '/skimmers/recoleccion'];

/**
 * Adds `Authorization: Bearer <token>` to requests to our API while a staff member is logged in,
 * and closes the session when an operations endpoint answers 401 (expired / invalid token).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const base = inject(APP_CONFIG).apiBaseUrl;
  const token = auth.token();
  const ours = req.url.startsWith(base);
  const authed = token && ours && !req.headers.has('Authorization') ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authed).pipe(
    catchError((err: unknown) => {
      const path = ours ? req.url.slice(base.length) : '';
      if (err instanceof HttpErrorResponse && err.status === 401 && token && STAFF_PATHS.some((p) => path.startsWith(p))) auth.logout();
      return throwError(() => err);
    }),
  );
};
