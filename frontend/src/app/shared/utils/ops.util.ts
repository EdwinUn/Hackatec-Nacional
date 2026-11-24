import {
  ChecklistItem,
  GeoPoint,
  Priority,
  ReportStatus,
  ReportType,
  Role,
  WorkOrder,
  WorkOrderStatus,
  WorkOrderType,
} from '../../core/models/ops.models';

type Meta = { label: string; color: string; bg: string };

export const ROLE_META: Record<Role, { label: string; icon: string }> = {
  technician: { label: 'Operador de brigada', icon: 'pi pi-wrench' },
  supervisor: { label: 'Supervisor', icon: 'pi pi-briefcase' },
  admin: { label: 'Administrador', icon: 'pi pi-shield' },
};

export const REPORT_TYPE_META: Record<ReportType, { label: string; icon: string; color: string }> = {
  trash: { label: 'Basura', icon: 'pi pi-trash', color: '#2563eb' },
  discharge: { label: 'Descarga de agua residual', icon: 'pi pi-filter', color: '#7c3aed' },
  odor: { label: 'Mal olor', icon: 'pi pi-cloud', color: '#a16207' },
  foam: { label: 'Espuma', icon: 'pi pi-circle', color: '#0891b2' },
  dead_fish: { label: 'Peces muertos', icon: 'pi pi-exclamation-triangle', color: '#b91c1c' },
  other: { label: 'Otro', icon: 'pi pi-question-circle', color: '#475569' },
};
export const REPORT_TYPES = Object.keys(REPORT_TYPE_META) as ReportType[];

export const REPORT_STATUS_META: Record<ReportStatus, Meta & { hint: string }> = {
  new: { label: 'Recibido', color: '#1d4ed8', bg: '#dbeafe', hint: 'Un supervisor revisará tu reporte.' },
  verified: { label: 'Validado', color: '#a16207', bg: '#fcefc7', hint: 'El reporte se confirmó y se programará la atención.' },
  in_progress: { label: 'En atención', color: '#c2410c', bg: '#fde4d3', hint: 'Una brigada está atendiendo el punto.' },
  resolved: { label: 'Resuelto', color: '#0f7a4d', bg: '#dcf5e8', hint: 'La brigada atendió el problema.' },
  rejected: { label: 'Descartado', color: '#475569', bg: '#e2e8f0', hint: 'No se pudo confirmar el problema.' },
};

export const WO_TYPE_META: Record<WorkOrderType, { label: string; icon: string; color: string }> = {
  citizen_report: { label: 'Atender reporte ciudadano', icon: 'pi pi-megaphone', color: '#7c3aed' },
  maintenance: { label: 'Mantenimiento de boya', icon: 'pi pi-wrench', color: '#a16207' },
  waste_collection: { label: 'Recolección de basura', icon: 'pi pi-trash', color: '#2563eb' },
  calibration: { label: 'Calibración de sensores', icon: 'pi pi-sliders-h', color: '#0891b2' },
};
export const WO_TYPES = Object.keys(WO_TYPE_META) as WorkOrderType[];

export const WO_STATUS_META: Record<WorkOrderStatus, Meta> = {
  pending: { label: 'Sin asignar', color: '#475569', bg: '#e2e8f0' },
  assigned: { label: 'Asignada', color: '#1d4ed8', bg: '#dbeafe' },
  in_progress: { label: 'En curso', color: '#c2410c', bg: '#fde4d3' },
  done: { label: 'Terminada', color: '#a16207', bg: '#fcefc7' },
  verified: { label: 'Verificada', color: '#0f7a4d', bg: '#dcf5e8' },
  cancelled: { label: 'Cancelada', color: '#64748b', bg: '#f1f5f9' },
};

export const PRIORITY_META: Record<Priority, Meta & { rank: number }> = {
  urgent: { label: 'Urgente', color: '#b91c1c', bg: '#fbdcdc', rank: 0 },
  high: { label: 'Alta', color: '#c2410c', bg: '#fde4d3', rank: 1 },
  normal: { label: 'Normal', color: '#1d4ed8', bg: '#dbeafe', rank: 2 },
  low: { label: 'Baja', color: '#475569', bg: '#e2e8f0', rank: 3 },
};
export const PRIORITIES = Object.keys(PRIORITY_META) as Priority[];

/** Statuses a technician still has to work on. */
export const OPEN_WO_STATUSES: WorkOrderStatus[] = ['assigned', 'in_progress'];

/**
 * Checklist per order type. Prototype criteria based on the device design
 * (grid, centrifuge, sensors, power); the team can adjust them.
 */
export function defaultChecklist(type: WorkOrderType): ChecklistItem[] {
  const items: Record<WorkOrderType, [string, string][]> = {
    maintenance: [
      ['grid', 'Rejilla de entrada limpia (sin basura atorada)'],
      ['centrifuge', 'Centrífuga gira sin vibración ni ruido anormal'],
      ['power', 'Batería y panel solar limpios, voltaje correcto'],
      ['leaks', 'Sin fugas en mangueras ni conexiones'],
      ['housing', 'Carcasa y anclaje de la boya en buen estado'],
      ['sensors', 'Sensores sumergidos y sin lodo'],
    ],
    waste_collection: [
      ['container', 'Contenedor de basura vaciado'],
      ['sorted', 'Residuos separados por tipo'],
      ['weighed', 'Residuos pesados'],
    ],
    calibration: [
      ['clean', 'Sensor enjuagado con agua destilada'],
      ['buffer', 'Medición con solución patrón'],
      ['reinstalled', 'Sensor reinstalado y transmitiendo'],
    ],
    citizen_report: [
      ['arrived', 'Llegué al punto reportado'],
      ['assessed', 'Evalué el problema'],
      ['action', 'Realicé la acción correctiva o di aviso a la autoridad'],
    ],
  };
  return items[type].map(([key, label]) => ({ key, label, done: false }));
}

/** Station status (`PATCH /stations/{id}`) implied by a maintenance order transition. */
export function stationStatusFor(order: WorkOrder, next: WorkOrderStatus): 'maintenance' | 'active' | null {
  if (order.type !== 'maintenance' || !order.station_id) return null;
  if (next === 'in_progress') return 'maintenance';
  if (next === 'done' || next === 'cancelled') return 'active';
  return null;
}

/** Calibration from a single reference point: offset = reference − measured (prototype criterion). */
export function calibrationOffset(reference: number, measured: number): number {
  return Math.round((reference - measured) * 1000) / 1000;
}

/** Great-circle distance in km. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/** Google Maps directions link (opens the Maps app on Android). */
export function directionsUrl(p: GeoPoint): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`;
}

/** Sort: open first, then priority, then due date. */
export function compareOrders(a: WorkOrder, b: WorkOrder): number {
  const open = (o: WorkOrder) => (OPEN_WO_STATUSES.includes(o.status) ? 0 : 1);
  return (
    open(a) - open(b) ||
    PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank ||
    (a.due_at ?? '9').localeCompare(b.due_at ?? '9') ||
    b.created_at.localeCompare(a.created_at)
  );
}
