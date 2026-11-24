import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { MessageService } from 'primeng/api';
import { catchError, throwError } from 'rxjs';
import { ApiErrorBody } from '../models/rio.models';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = 'error',
  ) {
    super(message);
  }
}

/** Extracts a user-facing message from `{ error: { code, message } }` (or FastAPI's `{ detail }`). */
export function parseApiError(err: HttpErrorResponse): ApiError {
  const body = err.error as Partial<ApiErrorBody> & { detail?: unknown } | null;
  if (body?.error?.message) return new ApiError(body.error.message, err.status, body.error.code);
  if (typeof body?.detail === 'string') return new ApiError(body.detail, err.status);
  if (err.status === 0) return new ApiError('No se pudo conectar con el servidor.', 0, 'network');
  return new ApiError(`Error ${err.status}`, err.status);
}

let lastMsg = '';
let lastAt = 0;

/** Turns backend errors into a clean toast showing `error.message` (de-duplicated). */
export const apiErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(MessageService);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse)) return throwError(() => err);
      const apiErr = parseApiError(err);
      const now = Date.now();
      if (apiErr.message !== lastMsg || now - lastAt > 5000) {
        toast.add({ severity: 'error', summary: apiErr.status === 0 ? 'Sin conexión' : 'Error', detail: apiErr.message, life: 5000, key: 'app' });
        lastMsg = apiErr.message;
        lastAt = now;
      }
      return throwError(() => apiErr);
    }),
  );
};
