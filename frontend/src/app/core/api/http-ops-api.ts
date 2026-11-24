import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, filter, map } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import {
  CitizenReport,
  NewCitizenReport,
  NewUser,
  NewWorkOrder,
  OpsEvent,
  ReportPatch,
  Session,
  User,
  UserPatch,
  WorkOrder,
  WorkOrderFilters,
  WorkOrderPatch,
} from '../models/ops.models';
import { LiveStreamService } from '../services/live-stream.service';
import { OpsApi } from './ops-api';

interface LoginDto {
  access_token: string;
  token_type: 'bearer';
  /** Seconds. */
  expires_in: number;
  user: User;
}

/**
 * Real backend for the operations module (PROPOSED endpoints; see the proposal for Back).
 * The `Authorization: Bearer` header is added by `authInterceptor`.
 */
@Injectable()
export class HttpOpsApi extends OpsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl;
  private readonly live = inject(LiveStreamService);

  readonly events$: Observable<OpsEvent> = this.live.raw$.pipe(
    filter((e): e is OpsEvent => e.type === 'work_order_assigned' || e.type === 'citizen_report_created'),
  );

  login(email: string, password: string): Observable<Session> {
    return this.http.post<LoginDto>(`${this.base}/auth/login`, { email, password }).pipe(
      map((d) => ({ token: d.access_token, expires_at: Date.now() + d.expires_in * 1000, user: d.user })),
    );
  }

  users() {
    return this.http.get<User[]>(`${this.base}/users`);
  }
  createUser(body: NewUser) {
    return this.http.post<User>(`${this.base}/users`, body);
  }
  patchUser(id: string, body: UserPatch) {
    return this.http.patch<User>(`${this.base}/users/${id}`, body);
  }

  citizenReports() {
    return this.http.get<CitizenReport[]>(`${this.base}/citizen-reports`);
  }
  createCitizenReport(body: NewCitizenReport) {
    return this.http.post<CitizenReport>(`${this.base}/citizen-reports`, body);
  }
  reportByFolio(folio: string) {
    return this.http.get<CitizenReport>(`${this.base}/citizen-reports/by-folio/${encodeURIComponent(folio.trim().toUpperCase())}`);
  }
  patchCitizenReport(id: string, body: ReportPatch) {
    return this.http.patch<CitizenReport>(`${this.base}/citizen-reports/${id}`, body);
  }

  workOrders(f: WorkOrderFilters = {}) {
    let p = new HttpParams();
    if (f.assigned_to) p = p.set('assigned_to', f.assigned_to);
    if (f.type) p = p.set('type', f.type);
    if (f.status?.length) p = p.set('status', f.status.join(','));
    return this.http.get<WorkOrder[]>(`${this.base}/work-orders`, { params: p });
  }
  workOrder(id: string) {
    return this.http.get<WorkOrder>(`${this.base}/work-orders/${id}`);
  }
  createWorkOrder(body: NewWorkOrder) {
    return this.http.post<WorkOrder>(`${this.base}/work-orders`, body);
  }
  patchWorkOrder(id: string, body: WorkOrderPatch) {
    return this.http.patch<WorkOrder>(`${this.base}/work-orders/${id}`, body);
  }
}
