import { Injectable, signal } from '@angular/core';

/** Shared layout state: a view hides the floating bottom navbar while one of its drawers is open. */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly navHidden = signal(false);
}
