import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { catchError, of } from 'rxjs';
import { RioApi } from '../api/rio-api';
import { Alert } from '../models/rio.models';
import { isPublicAlert, publicNotices } from '../../shared/utils/public-alerts.util';
import { FiltersService } from './filters.service';
import { LiveStreamService } from './live-stream.service';

/**
 * Open alerts that citizens may see (water quality only, see `isPublicAlert`), as plain-language
 * notices. Loaded on refresh/reconnect and kept current with live `alert` events.
 */
@Injectable({ providedIn: 'root' })
export class PublicAlertsService {
  private readonly api = inject(RioApi);
  private readonly filters = inject(FiltersService);
  private readonly live = inject(LiveStreamService);

  private readonly alerts = signal<Alert[]>([]);
  readonly loaded = signal(false);
  readonly failed = signal(false);
  readonly notices = computed(() => publicNotices(this.alerts()));
  readonly count = computed(() => this.notices().length);

  constructor() {
    effect(() => {
      this.filters.tick();
      untracked(() => this.reload());
    });
    this.live.reconnected$.subscribe(() => this.reload());
    this.live.events$.subscribe((e) => {
      if (e.type !== 'alert') return;
      const a = e.data;
      this.alerts.update((list) => [...(isPublicAlert(a) ? [a] : []), ...list.filter((x) => x.id !== a.id)]);
    });
  }

  reload(): void {
    this.api
      .alerts({ status: 'open', limit: 200, offset: 0 })
      .pipe(catchError(() => of(null)))
      .subscribe((p) => {
        this.loaded.set(true);
        this.failed.set(p === null);
        if (p) this.alerts.set(p.items.filter(isPublicAlert));
      });
  }
}
