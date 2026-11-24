import { Injectable, computed, signal } from '@angular/core';
import { MOCK_BUOYS } from '../mock/buoys.mock';
import { Buoy } from '../models/buoy.models';

/**
 * Río Monitor buoys.
 * No endpoint yet: always reads the frontend mocks. When `/buoys` exists, fetch through
 * `RioApi` (respecting `useMocks`), like `StationsService`.
 */
@Injectable({ providedIn: 'root' })
export class BuoysService {
  private readonly _buoys = signal<Buoy[]>(MOCK_BUOYS);
  readonly buoys = this._buoys.asReadonly();
  private readonly index = computed(() => new Map(this._buoys().map((b) => [b.id, b])));

  byId(id: string): Buoy | undefined {
    return this.index().get(id);
  }
}
