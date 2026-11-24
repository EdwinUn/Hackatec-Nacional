import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { RioApi } from '../api/rio-api';
import { Station } from '../models/rio.models';

/** `GET /stations` (3 Puebla stations) shared by header, map and forecast. */
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
        this._stations.set(list);
        this.loaded.set(true);
      });
  }

  name(id: string): string {
    return this.byId().get(id)?.name ?? id;
  }
}
