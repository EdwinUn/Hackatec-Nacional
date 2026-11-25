import { EvidenceLevel, Exposure } from '../../core/models/health-zones.models';

export const EXPOSURE_META: Record<Exposure, { label: string; icon: string }> = {
  aire_h2s_cov: { label: 'Gases tóxicos (H₂S, COV)', icon: 'pi pi-cloud' },
  pozos_agua_potable: { label: 'Pozos de agua potable', icon: 'pi pi-filter' },
  riego_cultivos: { label: 'Riego de cultivos', icon: 'pi pi-sun' },
  descargas_colorantes: { label: 'Colorantes y espuma industrial', icon: 'pi pi-palette' },
  inundacion_lodos: { label: 'Inundación con lodos', icon: 'pi pi-arrow-down' },
  olores_estancamiento: { label: 'Olores por estancamiento', icon: 'pi pi-exclamation-circle' },
  fauna_nociva_vectores: { label: 'Fauna nociva y vectores', icon: 'pi pi-exclamation-triangle' },
  metales_pesados_lirio: { label: 'Metales pesados y lirio', icon: 'pi pi-flag' },
};

export const EVIDENCE_META: Record<EvidenceLevel, { label: string; hint: string }> = {
  documentada: { label: 'Afectación documentada', hint: 'Los efectos en la salud están respaldados por las fuentes citadas.' },
  parcial: { label: 'Evidencia parcial', hint: 'Parte de los efectos solo los reportan vecinos; no encontramos un estudio publicado de esta zona.' },
};

/** Zone colours on the map: same palette as the criticality ranking (`CRITICALITY_META`). */
export const HEALTH_ZONE_COLORS = { critico: '#dc2626', atencion: '#d97706' } as const;
