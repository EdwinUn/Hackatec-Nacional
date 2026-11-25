import { Injectable, signal } from '@angular/core';

/** Same breakpoint as the mobile layout (header, bottom nav and shell styles). */
export const MOBILE_QUERY = '(max-width: 767px), (pointer: coarse) and (max-width: 1400px)';

export function isMobileViewport(): boolean {
  return typeof matchMedia === 'function' && matchMedia(MOBILE_QUERY).matches;
}

/** Shared layout state: a view hides the floating bottom navbar while one of its drawers is open. */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly navHidden = signal(false);
}
