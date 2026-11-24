import { AlertSeverity, AlertStatus, CentrifugeState, CriticalityLevel, SensorStatus, WasteType, WqiCategory } from '../../core/models/rio.models';

export const WQI_META: Record<WqiCategory, { label: string; color: string; bg: string }> = {
  excelente: { label: 'Excelente', color: '#0f7a4d', bg: '#dcf5e8' },
  buena: { label: 'Buena', color: '#4d7c0f', bg: '#ecf6d4' },
  regular: { label: 'Regular', color: '#a16207', bg: '#fcefc7' },
  mala: { label: 'Mala', color: '#c2410c', bg: '#fde4d3' },
  critica: { label: 'Crítica', color: '#b91c1c', bg: '#fbdcdc' },
};

export function wqiCategory(score: number): WqiCategory {
  if (score >= 90) return 'excelente';
  if (score >= 75) return 'buena';
  if (score >= 55) return 'regular';
  if (score >= 35) return 'mala';
  return 'critica';
}

/**
 * pH improvement = how much closer to neutral (7) the water gets: 7.56 → 7.22 is +61 %
 * (|0.56| → |0.22|), 5.0 → 6.8 is +90 %. Negative means the treatment moved it away from 7.
 */
export function improvementPct(inlet: number | null | undefined, outlet: number | null | undefined): number {
  if (inlet === null || inlet === undefined || outlet === null || outlet === undefined) return 0;
  const before = Math.abs(inlet - 7);
  return before < 1e-6 ? 0 : ((before - Math.abs(outlet - 7)) / before) * 100;
}

export const CRITICALITY_META: Record<CriticalityLevel, { label: string; color: string; bg: string }> = {
  critico: { label: 'Crítico', color: '#dc2626', bg: '#fbdcdc' },
  atencion: { label: 'Atención', color: '#d97706', bg: '#fcefc7' },
  estable: { label: 'Estable', color: '#16a34a', bg: '#dcf5e8' },
};

export const SEVERITY_META: Record<AlertSeverity, { label: string; color: string; bg: string; icon: string }> = {
  info: { label: 'Informativa', color: '#1d4ed8', bg: '#dbeafe', icon: 'pi pi-info-circle' },
  warning: { label: 'Advertencia', color: '#a16207', bg: '#fcefc7', icon: 'pi pi-exclamation-triangle' },
  critical: { label: 'Crítica', color: '#b91c1c', bg: '#fbdcdc', icon: 'pi pi-exclamation-circle' },
};

export const ALERT_STATUS_META: Record<AlertStatus, { label: string }> = {
  open: { label: 'Abierta' },
  acknowledged: { label: 'Reconocida' },
  resolved: { label: 'Resuelta' },
};

export const SENSOR_STATUS_META: Record<SensorStatus, { label: string; color: string; bg: string }> = {
  ok: { label: 'OK', color: '#0f7a4d', bg: '#dcf5e8' },
  degraded: { label: 'Degradado', color: '#a16207', bg: '#fcefc7' },
  fault: { label: 'Falla', color: '#b91c1c', bg: '#fbdcdc' },
  offline: { label: 'Sin conexión', color: '#475569', bg: '#e2e8f0' },
};

export const CENTRIFUGE_META: Record<CentrifugeState, { label: string; color: string; bg: string }> = {
  running: { label: 'En operación', color: '#0f7a4d', bg: '#dcf5e8' },
  idle: { label: 'En espera', color: '#475569', bg: '#e2e8f0' },
  fault: { label: 'Falla', color: '#b91c1c', bg: '#fbdcdc' },
  maintenance: { label: 'Mantenimiento', color: '#a16207', bg: '#fcefc7' },
};

export const WASTE_META: Record<WasteType, { label: string; color: string }> = {
  plastic: { label: 'Plástico', color: '#2563eb' },
  organic: { label: 'Orgánico', color: '#65a30d' },
  metal: { label: 'Metal', color: '#64748b' },
  glass: { label: 'Vidrio', color: '#0891b2' },
  other: { label: 'Otros', color: '#a16207' },
};

export const WASTE_TYPES = Object.keys(WASTE_META) as WasteType[];
