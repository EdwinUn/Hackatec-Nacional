import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { catchError, of } from 'rxjs';
import { RioApi } from '../api/rio-api';
import { FiltersService } from './filters.service';
import { LiveStreamService } from './live-stream.service';

/** Number of open alerts for the sidebar badge: queried on filter/refresh/reconnect, +1 per live `alert`. */
@Injectable({ providedIn: 'root' })
export class AlertCounterService {
  private readonly api = inject(RioApi);
  private readonly filters = inject(FiltersService);
  private readonly live = inject(LiveStreamService);
  readonly open = signal(0);

  constructor() {
    effect(() => {
      const station_id = this.filters.stationId() ?? undefined;
      this.filters.tick();
      untracked(() => this.reload(station_id));
    });
    this.live.reconnected$.subscribe(() => this.reload(this.filters.stationId() ?? undefined));
    this.live.events$.subscribe((e) => {
      if (e.type === 'alert' && e.data.status === 'open') this.open.update((n) => n + 1);
    });
  }

  private reload(station_id?: string): void {
    this.api
      .alerts({ status: 'open', station_id, limit: 1, offset: 0 })
      .pipe(catchError(() => of(null)))
      .subscribe((p) => p && this.open.set(p.total));
  }
}
