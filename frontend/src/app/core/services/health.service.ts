import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Health } from '../models/health';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly api = inject(ApiService);

  check(): Observable<Health> {
    if (environment.useMocks) return of({ status: 'ok (mock)' });
    return this.api.get<Health>('/health');
  }
}
