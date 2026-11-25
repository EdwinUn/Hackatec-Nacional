import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { RioApi } from '../api/rio-api';
import { Station } from '../models/rio.models';

/**
 * `GET /stations` shared by header, map and forecast. Only the stations fed by a buoy (with `code`,
 * RM-01 and RM-02) are shown: the simulated stations of the earlier treatment-plant concept are being
 * removed (team decision). If none has a code yet, the whole list is kept.
 */
@Injectable({ providedIn: 'root' })
export class StationsService {
  private readonly api = inject(RioApi);
  private readonly _stations = signal<Station[]>([]);
  readonly stations = this._stations.asReadonly();
  readonly loaded = signal(false);
  readonly byId = computed(() => new Map(this._stations().map((s) => [s.id, s])));

  constructor() {
    this.api
      .stations()
      .pipe(catchError(() => of<Station[]>([])))
      .subscribe((list) => {
        const devices = list.filter((s) => !!s.code);
        this._stations.set(devices.length ? devices : list);
        this.loaded.set(true);
      });
  }

  name(id: string): string {
    return this.byId().get(id)?.name ?? id;
  }
}
