// Servicio de EJEMPLO: copia este patrón para cada recurso de API.md.
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ITEMS_MOCK } from '../mocks/items.mock';
import { Item, ItemCreate } from '../models/item';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class ItemsService {
  private readonly api = inject(ApiService);

  list(): Observable<Item[]> {
    if (environment.useMocks) return of(ITEMS_MOCK);
    return this.api.get<Item[]>('/items');
  }

  create(data: ItemCreate): Observable<Item> {
    if (environment.useMocks) {
      return of({ id: Date.now(), name: data.name, created_at: new Date().toISOString() });
    }
    return this.api.post<Item>('/items', data);
  }
}
