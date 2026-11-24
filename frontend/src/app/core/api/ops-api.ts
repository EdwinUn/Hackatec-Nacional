import { Observable } from 'rxjs';
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

/**
 * Operations contract (staff login, citizen reports, work orders).
 * PROPOSED endpoints, not in `API.md` yet; implemented by `HttpOpsApi` (real backend)
 * and `MockOpsApi` (local, persisted in the browser). Selected with `opsMocks`.
 */
export abstract class OpsApi {
  /** `POST /auth/login` */
  abstract login(email: string, password: string): Observable<Session>;

  /** `GET/POST/PATCH /users` (admin) */
  abstract users(): Observable<User[]>;
  abstract createUser(body: NewUser): Observable<User>;
  abstract patchUser(id: string, body: UserPatch): Observable<User>;

  /** `POST /citizen-reports` is public; listing and PATCH need staff. */
  abstract citizenReports(): Observable<CitizenReport[]>;
  abstract createCitizenReport(body: NewCitizenReport): Observable<CitizenReport>;
  /** `GET /citizen-reports/by-folio/{folio}` (public). */
  abstract reportByFolio(folio: string): Observable<CitizenReport>;
  abstract patchCitizenReport(id: string, body: ReportPatch): Observable<CitizenReport>;

  /** `GET/POST/PATCH /work-orders` */
  abstract workOrders(f?: WorkOrderFilters): Observable<WorkOrder[]>;
  abstract workOrder(id: string): Observable<WorkOrder>;
  abstract createWorkOrder(body: NewWorkOrder): Observable<WorkOrder>;
  abstract patchWorkOrder(id: string, body: WorkOrderPatch): Observable<WorkOrder>;

  /** Real-time events (WS `work_order_assigned` / `citizen_report_created`). */
  abstract readonly events$: Observable<OpsEvent>;
}
