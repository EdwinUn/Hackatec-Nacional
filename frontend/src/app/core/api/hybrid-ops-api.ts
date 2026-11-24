import { Injectable, Injector, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MockOpsApi } from '../mock/mock-ops-api';
import { Session } from '../models/ops.models';
import { HttpOpsApi } from './http-ops-api';

/**
 * Operations module while the backend only has real staff login, tasks and skimmers:
 * the session comes from `POST /auth/login`; citizen reports and work orders stay on the local mock.
 */
@Injectable()
export class HybridOpsApi extends MockOpsApi {
  // Resolved lazily: HttpClient → authInterceptor → AuthService → OpsApi would otherwise be a cycle.
  private readonly injector = inject(Injector);

  override login(email: string, password: string): Observable<Session> {
    return this.injector.get(HttpOpsApi).login(email, password);
  }
}
