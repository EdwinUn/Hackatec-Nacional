/**
 * Operations module: staff users, citizen reports and work orders.
 * These resources are a PROPOSAL for the backend (not in `API.md` yet); until they exist
 * the front uses `MockOpsApi` (see `opsMocks` in the environments).
 */
import { WasteType } from './rio.models';

export type Role = 'technician' | 'supervisor' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}

export interface Session {
  token: string;
  /** Epoch ms. */
  expires_at: number;
  user: User;
}

export interface NewUser {
  name: string;
  email: string;
  role: Role;
  password: string;
}

export interface UserPatch {
  name?: string;
  role?: Role;
  active?: boolean;
}

// ── Citizen reports ─────────────────────────────────────────────────────────
export type ReportType = 'trash' | 'discharge' | 'odor' | 'foam' | 'dead_fish' | 'other';
export type ReportStatus = 'new' | 'verified' | 'in_progress' | 'resolved' | 'rejected';

export interface GeoPoint {
  latitude: number;
  longitude: number;
  /** Meters. */
  accuracy?: number | null;
}

export interface CitizenReport extends GeoPoint {
  id: string;
  /** Public tracking code, e.g. `RC-0042`. */
  folio: string;
  type: ReportType;
  description: string;
  /** Compressed JPEG as data URL (prototype; the backend would store a file URL). */
  photo: string | null;
  status: ReportStatus;
  /** Station closest to the report, when known. */
  station_id: string | null;
  work_order_id: string | null;
  /** Note visible to the citizen (why it was rejected / how it was solved). */
  public_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewCitizenReport extends GeoPoint {
  type: ReportType;
  description: string;
  photo: string | null;
}

export interface ReportPatch {
  status?: ReportStatus;
  public_note?: string | null;
  work_order_id?: string | null;
}

// ── Work orders ─────────────────────────────────────────────────────────────
export type WorkOrderType = 'citizen_report' | 'maintenance' | 'waste_collection' | 'calibration';
export type WorkOrderStatus = 'pending' | 'assigned' | 'in_progress' | 'done' | 'verified' | 'cancelled';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

export interface Evidence {
  kind: 'before' | 'after';
  photo: string;
  ts: string;
}

/** What the technician recorded when closing the order (depends on the type). */
export interface WorkResult {
  /** citizen_report */
  confirmed?: boolean;
  action_taken?: string;
  /** waste_collection */
  waste_type?: WasteType;
  weight_kg?: number;
  items_count?: number;
  /** calibration */
  sensor_id?: string;
  sensor_name?: string;
  reference_value?: number;
  measured_value?: number;
  calibration_offset?: number;
  calibration_factor?: number;
}

export interface WorkOrder {
  id: string;
  /** e.g. `OT-0007` */
  folio: string;
  type: WorkOrderType;
  title: string;
  description: string;
  priority: Priority;
  status: WorkOrderStatus;
  station_id: string | null;
  station_name: string | null;
  citizen_report_id: string | null;
  alert_id: string | null;
  location: GeoPoint | null;
  assigned_to: string | null;
  assigned_name: string | null;
  created_by: string | null;
  due_at: string | null;
  checklist: ChecklistItem[];
  evidence: Evidence[];
  notes: string;
  result: WorkResult | null;
  check_in: (GeoPoint & { ts: string }) | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  verified_at: string | null;
}

export interface NewWorkOrder {
  type: WorkOrderType;
  title: string;
  description: string;
  priority: Priority;
  station_id: string | null;
  citizen_report_id?: string | null;
  alert_id?: string | null;
  location?: GeoPoint | null;
  assigned_to?: string | null;
  due_at?: string | null;
}

export type WorkOrderPatch = Partial<
  Pick<WorkOrder, 'status' | 'assigned_to' | 'priority' | 'checklist' | 'evidence' | 'notes' | 'result' | 'check_in' | 'due_at'>
>;

export interface WorkOrderFilters {
  assigned_to?: string;
  status?: WorkOrderStatus[];
  type?: WorkOrderType;
}

/** Real-time operations events (WS `work_order_assigned` proposed to the backend). */
export type OpsEvent =
  | { type: 'work_order_assigned'; data: WorkOrder }
  | { type: 'citizen_report_created'; data: CitizenReport };
