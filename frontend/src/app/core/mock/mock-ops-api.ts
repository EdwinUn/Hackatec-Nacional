import { Injectable, inject } from '@angular/core';
import { Observable, Subject, defer, delay, map, of, shareReplay, switchMap, throwError } from 'rxjs';
import { distanceKm, defaultChecklist } from '../../shared/utils/ops.util';
import { OpsApi } from '../api/ops-api';
import { RioApi } from '../api/rio-api';
import { ApiError } from '../interceptors/api-error.interceptor';
import {
  CitizenReport,
  NewCitizenReport,
  NewUser,
  NewWorkOrder,
  OpsEvent,
  ReportPatch,
  ReportStatus,
  Session,
  User,
  UserPatch,
  WorkOrder,
  WorkOrderFilters,
  WorkOrderPatch,
  WorkOrderStatus,
} from '../models/ops.models';
import { Station } from '../models/rio.models';

const STORAGE_KEY = 'rm.ops.v1';
const HOUR = 3_600_000;
const SESSION_MS = 12 * HOUR;
/** Password of every demo account. */
export const DEMO_PASSWORD = 'demo123';

interface StoredUser extends User {
  password: string;
}

interface OpsState {
  users: StoredUser[];
  reports: CitizenReport[];
  orders: WorkOrder[];
  seq: { report: number; order: number };
}

export const DEMO_USERS: { email: string; label: string }[] = [
  { email: 'tecnico@demo.mx', label: 'Técnico de campo' },
  { email: 'supervisor@demo.mx', label: 'Supervisor' },
  { email: 'admin@demo.mx', label: 'Administrador' },
];

const lat = <T>(v: T): Observable<T> => of(v).pipe(delay(220));
const clone = <T>(v: T): T => structuredClone(v);
const nowIso = () => new Date().toISOString();
const ago = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

const folio = (prefix: string, n: number) => `${prefix}-${String(n).padStart(4, '0')}`;

/**
 * In-browser implementation of the proposed operations endpoints. Behaves like the backend
 * would (folios, state cascades between orders and citizen reports, assignment events) and
 * persists in `localStorage` so the demo survives reloads. Stations come from the active `RioApi`.
 */
@Injectable()
export class MockOpsApi extends OpsApi {
  private readonly rio = inject(RioApi);
  private readonly events = new Subject<OpsEvent>();
  readonly events$ = this.events.asObservable();

  private stations: Station[] = [];
  private state!: OpsState;

  /** Loads the persisted state (or seeds it with the current stations) once. */
  private readonly ready$ = defer(() => this.rio.stations()).pipe(
    map((stations) => {
      this.stations = stations;
      this.state = this.load() ?? this.seed(stations);
      this.save();
      return true;
    }),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  private run<T>(fn: () => T | ApiError): Observable<T> {
    return this.ready$.pipe(
      switchMap(() => {
        const r = fn();
        if (r instanceof ApiError) return throwError(() => r);
        this.save();
        return lat(clone(r));
      }),
    );
  }

  // ── Auth / users ──────────────────────────────────────────────────────────
  login(email: string, password: string): Observable<Session> {
    return this.run(() => {
      const u = this.state.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
      if (!u || u.password !== password) return new ApiError('Correo o contraseña incorrectos.', 401, 'invalid_credentials');
      if (!u.active) return new ApiError('La cuenta está desactivada. Contacta al administrador.', 403, 'inactive');
      return { token: `mock.${u.id}.${Date.now().toString(36)}`, expires_at: Date.now() + SESSION_MS, user: this.publicUser(u) };
    });
  }

  users(): Observable<User[]> {
    return this.run(() => this.state.users.map((u) => this.publicUser(u)));
  }

  createUser(body: NewUser): Observable<User> {
    return this.run(() => {
      const email = body.email.trim().toLowerCase();
      if (this.state.users.some((u) => u.email === email)) return new ApiError('Ya existe un usuario con ese correo.', 409, 'conflict');
      const u: StoredUser = { id: newId(), name: body.name.trim(), email, role: body.role, active: true, password: body.password };
      this.state.users.push(u);
      return this.publicUser(u);
    });
  }

  patchUser(id: string, body: UserPatch): Observable<User> {
    return this.run(() => {
      const u = this.state.users.find((x) => x.id === id);
      if (!u) return new ApiError('Usuario no encontrado.', 404, 'not_found');
      Object.assign(u, body);
      return this.publicUser(u);
    });
  }

  // ── Citizen reports ───────────────────────────────────────────────────────
  citizenReports(): Observable<CitizenReport[]> {
    return this.run(() => [...this.state.reports].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }

  createCitizenReport(body: NewCitizenReport): Observable<CitizenReport> {
    return this.run(() => {
      if (!body.description.trim() && !body.photo) return new ApiError('Agrega una descripción o una foto.', 422, 'validation_error');
      const n = ++this.state.seq.report;
      const ts = nowIso();
      const r: CitizenReport = {
        id: newId(),
        folio: folio('RC', n),
        type: body.type,
        description: body.description.trim(),
        photo: body.photo,
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy ?? null,
        status: 'new',
        station_id: this.nearestStation(body)?.id ?? null,
        work_order_id: null,
        public_note: null,
        created_at: ts,
        updated_at: ts,
      };
      this.state.reports.push(r);
      this.events.next({ type: 'citizen_report_created', data: clone(r) });
      return r;
    });
  }

  reportByFolio(f: string): Observable<CitizenReport> {
    return this.run(() => {
      const r = this.state.reports.find((x) => x.folio.toLowerCase() === f.trim().toLowerCase());
      return r ?? new ApiError(`No encontramos el folio ${f.toUpperCase()}.`, 404, 'not_found');
    });
  }

  patchCitizenReport(id: string, body: ReportPatch): Observable<CitizenReport> {
    return this.run(() => {
      const r = this.state.reports.find((x) => x.id === id);
      if (!r) return new ApiError('Reporte no encontrado.', 404, 'not_found');
      Object.assign(r, body, { updated_at: nowIso() });
      return r;
    });
  }

  // ── Work orders ───────────────────────────────────────────────────────────
  workOrders(f: WorkOrderFilters = {}): Observable<WorkOrder[]> {
    return this.run(() =>
      this.state.orders.filter(
        (o) => (!f.assigned_to || o.assigned_to === f.assigned_to) && (!f.status?.length || f.status.includes(o.status)) && (!f.type || o.type === f.type),
      ),
    );
  }

  workOrder(id: string): Observable<WorkOrder> {
    return this.run(() => this.state.orders.find((o) => o.id === id) ?? new ApiError('Orden no encontrada.', 404, 'not_found'));
  }

  createWorkOrder(body: NewWorkOrder): Observable<WorkOrder> {
    return this.run(() => {
      const station = this.stations.find((s) => s.id === body.station_id) ?? null;
      const report = body.citizen_report_id ? this.state.reports.find((r) => r.id === body.citizen_report_id) : undefined;
      const assignee = body.assigned_to ? this.state.users.find((u) => u.id === body.assigned_to) : undefined;
      const o: WorkOrder = {
        id: newId(),
        folio: folio('OT', ++this.state.seq.order),
        type: body.type,
        title: body.title.trim(),
        description: body.description.trim(),
        priority: body.priority,
        status: assignee ? 'assigned' : 'pending',
        station_id: station?.id ?? null,
        station_name: station?.name ?? null,
        citizen_report_id: report?.id ?? null,
        alert_id: body.alert_id ?? null,
        location: body.location ?? (report ? { latitude: report.latitude, longitude: report.longitude } : station ? { latitude: station.latitude, longitude: station.longitude } : null),
        assigned_to: assignee?.id ?? null,
        assigned_name: assignee?.name ?? null,
        created_by: null,
        due_at: body.due_at ?? null,
        checklist: defaultChecklist(body.type),
        evidence: [],
        notes: '',
        result: null,
        check_in: null,
        created_at: nowIso(),
        started_at: null,
        completed_at: null,
        verified_at: null,
      };
      this.state.orders.push(o);
      if (report) Object.assign(report, { work_order_id: o.id, status: 'verified' as ReportStatus, updated_at: nowIso() });
      if (assignee) this.events.next({ type: 'work_order_assigned', data: clone(o) });
      return o;
    });
  }

  patchWorkOrder(id: string, body: WorkOrderPatch): Observable<WorkOrder> {
    return this.run(() => {
      const o = this.state.orders.find((x) => x.id === id);
      if (!o) return new ApiError('Orden no encontrada.', 404, 'not_found');
      if (body.status && !this.canTransition(o.status, body.status)) {
        return new ApiError(`No se puede pasar de "${o.status}" a "${body.status}".`, 409, 'invalid_transition');
      }
      const reassigned = body.assigned_to !== undefined && body.assigned_to !== o.assigned_to;
      Object.assign(o, body);
      const ts = nowIso();
      if (reassigned) {
        const u = this.state.users.find((x) => x.id === o.assigned_to);
        o.assigned_name = u?.name ?? null;
        if (o.status === 'pending' && u) o.status = 'assigned';
        if (!u && o.status === 'assigned') o.status = 'pending';
      }
      if (body.status === 'in_progress') o.started_at ??= ts;
      if (body.status === 'done') o.completed_at = ts;
      if (body.status === 'verified') o.verified_at = ts;
      this.cascadeToReport(o);
      if (reassigned && o.assigned_to) this.events.next({ type: 'work_order_assigned', data: clone(o) });
      return o;
    });
  }

  // ── Rules the backend would enforce ───────────────────────────────────────
  private canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
    if (from === to) return true;
    const allowed: Record<WorkOrderStatus, WorkOrderStatus[]> = {
      pending: ['assigned', 'cancelled'],
      assigned: ['in_progress', 'pending', 'cancelled'],
      in_progress: ['done', 'assigned', 'cancelled'],
      done: ['verified', 'in_progress'],
      verified: [],
      cancelled: [],
    };
    return allowed[from].includes(to);
  }

  /** The citizen sees the progress of the order that attends their report. */
  private cascadeToReport(o: WorkOrder): void {
    if (!o.citizen_report_id) return;
    const r = this.state.reports.find((x) => x.id === o.citizen_report_id);
    if (!r) return;
    const next: Partial<Record<WorkOrderStatus, ReportStatus>> = { in_progress: 'in_progress', done: 'resolved', verified: 'resolved', cancelled: 'verified' };
    const st = next[o.status];
    if (!st) return;
    if (o.status === 'done' && o.result?.confirmed === false) {
      r.status = 'rejected';
      r.public_note = o.result.action_taken || 'La brigada no encontró el problema reportado.';
    } else {
      r.status = st;
      if (st === 'resolved' && o.result?.action_taken) r.public_note = o.result.action_taken;
    }
    r.updated_at = nowIso();
  }

  private nearestStation(p: { latitude: number; longitude: number }): Station | null {
    let best: Station | null = null;
    let bestKm = 8; // only link stations within 8 km (prototype criterion)
    for (const s of this.stations) {
      const km = distanceKm(p, s);
      if (km < bestKm) [best, bestKm] = [s, km];
    }
    return best;
  }

  private publicUser({ password: _, ...u }: StoredUser): User {
    return u;
  }

  // ── Persistence ───────────────────────────────────────────────────────────
  private load(): OpsState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const s = raw ? (JSON.parse(raw) as OpsState) : null;
      // Reseed if the stored data points to stations that no longer exist (mock ↔ real backend).
      if (s && this.stations.length && s.orders.some((o) => o.station_id && !this.stations.some((st) => st.id === o.station_id))) return null;
      return s;
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Quota exceeded (photos): drop the oldest photos and retry once.
      try {
        for (const r of [...this.state.reports].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 5)) r.photo = null;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch {
        /* storage unavailable: keep in memory */
      }
    }
  }

  /** Clears the demo data (used from the admin screen). */
  reset(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.state = this.seed(this.stations);
    this.save();
  }

  private seed(stations: Station[]): OpsState {
    const users: StoredUser[] = [
      { id: 'u-tec-1', name: 'Luis Hernández', email: 'tecnico@demo.mx', role: 'technician', active: true, password: DEMO_PASSWORD },
      { id: 'u-tec-2', name: 'María Pérez', email: 'tecnico2@demo.mx', role: 'technician', active: true, password: DEMO_PASSWORD },
      { id: 'u-sup-1', name: 'Andrea Ramírez', email: 'supervisor@demo.mx', role: 'supervisor', active: true, password: DEMO_PASSWORD },
      { id: 'u-adm-1', name: 'Coordinación SECIHTI', email: 'admin@demo.mx', role: 'admin', active: true, password: DEMO_PASSWORD },
    ];
    const st = (i: number) => stations[i % Math.max(1, stations.length)];
    const near = (i: number, dLat: number, dLng: number) => ({ latitude: (st(i)?.latitude ?? 19.04) + dLat, longitude: (st(i)?.longitude ?? -98.2) + dLng });

    const report = (n: number, i: number, type: CitizenReport['type'], description: string, status: ReportStatus, hAgo: number, d: [number, number]): CitizenReport => ({
      id: `rc-${n}`,
      folio: folio('RC', n),
      type,
      description,
      photo: null,
      ...near(i, d[0], d[1]),
      accuracy: 12,
      status,
      station_id: st(i)?.id ?? null,
      work_order_id: null,
      public_note: status === 'resolved' ? 'Se retiraron 14 kg de residuos de la orilla.' : null,
      created_at: ago(hAgo),
      updated_at: ago(Math.max(0, hAgo - 2)),
    });
    const reports = [
      report(1, 0, 'trash', 'Mucha basura plástica acumulada en la orilla, junto al puente.', 'new', 3, [0.0021, -0.0015]),
      report(2, 1, 'discharge', 'Tubo descargando agua gris con espuma directamente al río.', 'new', 6, [-0.0018, 0.0024]),
      report(3, 2, 'odor', 'Olor muy fuerte a drenaje desde la mañana.', 'verified', 20, [0.0012, 0.0009]),
      report(4, 0, 'dead_fish', 'Se ven varios peces muertos flotando cerca de la presa.', 'in_progress', 26, [-0.0025, -0.0011]),
      report(5, 1, 'trash', 'Llantas y bolsas tiradas en la barranca.', 'resolved', 70, [0.0031, 0.0006]),
    ];

    const base = (n: number, type: WorkOrder['type'], i: number, title: string, status: WorkOrderStatus, assignee: StoredUser | null, priority: WorkOrder['priority'], hAgo: number): WorkOrder => ({
      id: `ot-${n}`,
      folio: folio('OT', n),
      type,
      title,
      description: '',
      priority,
      status,
      station_id: st(i)?.id ?? null,
      station_name: st(i)?.name ?? null,
      citizen_report_id: null,
      alert_id: null,
      location: st(i) ? { latitude: st(i).latitude, longitude: st(i).longitude } : null,
      assigned_to: assignee?.id ?? null,
      assigned_name: assignee?.name ?? null,
      created_by: 'u-sup-1',
      due_at: new Date(Date.now() + (status === 'assigned' ? 6 : 24) * HOUR).toISOString(),
      checklist: defaultChecklist(type),
      evidence: [],
      notes: '',
      result: null,
      check_in: null,
      created_at: ago(hAgo),
      started_at: ['in_progress', 'done', 'verified'].includes(status) ? ago(hAgo - 1) : null,
      completed_at: ['done', 'verified'].includes(status) ? ago(hAgo - 2) : null,
      verified_at: status === 'verified' ? ago(hAgo - 3) : null,
    });
    const [t1, t2] = users;
    const done = (o: WorkOrder): WorkOrder => ({ ...o, checklist: o.checklist.map((c) => ({ ...c, done: true })) });

    const orders: WorkOrder[] = [
      { ...base(1, 'maintenance', 0, 'Limpieza de rejilla y revisión de centrífuga', 'assigned', t1, 'high', 2), description: 'La eficiencia del tratamiento bajó en las últimas horas. Revisar rejilla de entrada y vibración de la centrífuga.' },
      { ...base(2, 'waste_collection', 1, 'Vaciar contenedor de basura de la boya', 'assigned', t1, 'normal', 5), description: 'El contenedor está cerca de su capacidad.' },
      { ...base(3, 'calibration', 2, 'Calibrar sensor de pH de entrada', 'pending', null, 'normal', 8), description: 'Calibración mensual (vencida). El sensor reporta lecturas inestables.' },
      {
        ...base(4, 'citizen_report', 0, 'Peces muertos cerca de la presa (RC-0004)', 'in_progress', t2, 'urgent', 25),
        description: reports[3].description,
        citizen_report_id: reports[3].id,
        location: { latitude: reports[3].latitude, longitude: reports[3].longitude },
      },
      { ...done(base(5, 'waste_collection', 0, 'Recolección semanal', 'verified', t1, 'normal', 48)), result: { waste_type: 'plastic', weight_kg: 6.2, items_count: 41 } },
      { ...done(base(6, 'maintenance', 1, 'Revisión de panel solar', 'done', t2, 'normal', 30)), notes: 'Panel con polvo, se limpió. Voltaje 13.1 V.' },
      {
        ...done(base(7, 'citizen_report', 1, 'Basura en barranca (RC-0005)', 'verified', t2, 'high', 69)),
        citizen_report_id: reports[4].id,
        result: { confirmed: true, action_taken: 'Se retiraron 14 kg de residuos de la orilla.' },
      },
    ];
    reports[3].work_order_id = 'ot-4';
    reports[4].work_order_id = 'ot-7';

    return { users, reports, orders, seq: { report: reports.length, order: orders.length } };
  }
}
