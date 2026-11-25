import { Alert, WqiCategory } from '../../core/models/rio.models';

/**
 * Water-quality parameters the buoy actually measures (docs/fidelidad.md). Alerts on anything else
 * (battery, sensors, basket, pump, or the earlier concept's dissolved oxygen / conductivity) are
 * staff-only and never shown to citizens.
 */
export const PUBLIC_PARAMETERS = ['ph', 'turbidity', 'tds', 'temperature'] as const;
type PublicParameter = (typeof PUBLIC_PARAMETERS)[number];

export interface PublicNotice {
  id: string;
  station_id: string;
  level: 'warning' | 'critical';
  title: string;
  text: string;
  advice: string;
  place: string;
  at: string;
  icon: string;
  /** Open alerts folded into this notice (same place and parameter). */
  count: number;
}

const COPY: Record<PublicParameter, { title: string; text: string; icon: string }> = {
  ph: { title: 'Agua con acidez fuera de lo normal', text: 'El agua está más ácida o más alcalina de lo habitual; puede deberse a una descarga.', icon: 'pi pi-exclamation-triangle' },
  turbidity: { title: 'Agua más turbia de lo normal', text: 'Hay más tierra, lodo o residuos suspendidos en el agua de lo habitual.', icon: 'pi pi-eye-slash' },
  tds: { title: 'Muchas sustancias disueltas en el agua', text: 'El agua trae más sales o sustancias disueltas de lo habitual.', icon: 'pi pi-filter' },
  temperature: { title: 'Temperatura del agua inusual', text: 'El agua está más caliente o más fría de lo habitual.', icon: 'pi pi-sun' },
};

const ADVICE: Record<PublicNotice['level'], string> = {
  critical: 'Evita tocar el agua, no la uses para riego ni para animales y mantén lejos a niños y mascotas.',
  warning: 'Evita el contacto directo con el agua mientras la brigada revisa.',
};

function isPublicParameter(p: string | null): p is PublicParameter {
  return p !== null && (PUBLIC_PARAMETERS as readonly string[]).includes(p);
}

/** Open warning/critical alert on a water-quality parameter the buoy measures. */
export function isPublicAlert(a: Alert): boolean {
  return a.status === 'open' && a.severity !== 'info' && isPublicParameter(a.parameter);
}

/** Plain-language notice for citizens; `null` when the alert is not public. */
export function toPublicNotice(a: Alert): PublicNotice | null {
  if (!isPublicAlert(a) || !isPublicParameter(a.parameter)) return null;
  const level = a.severity === 'critical' ? 'critical' : 'warning';
  const c = COPY[a.parameter];
  return { id: a.id, station_id: a.station_id, level, title: c.title, text: c.text, advice: ADVICE[level], place: a.station_name, at: a.created_at, icon: c.icon, count: 1 };
}

const rank = (n: PublicNotice) => (n.level === 'critical' ? 1 : 0);

/**
 * Public notices, one per place and parameter (the most severe, then most recent alert wins), sorted
 * most severe first and then most recent. A citizen needs «where and what», not every repeated alert.
 */
export function publicNotices(alerts: Alert[]): PublicNotice[] {
  const byKey = new Map<string, PublicNotice>();
  for (const a of alerts) {
    const n = toPublicNotice(a);
    if (!n) continue;
    const key = `${a.station_id}|${a.parameter}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, n);
    else {
      const best = rank(n) > rank(prev) || (rank(n) === rank(prev) && n.at > prev.at) ? n : prev;
      byKey.set(key, { ...best, count: prev.count + 1 });
    }
  }
  return [...byKey.values()].sort((x, y) => rank(y) - rank(x) || y.at.localeCompare(x.at));
}

/** One sentence per WQI category for the citizen home (the index is derived, not measured). */
export const WQI_PLAIN: Record<WqiCategory, string> = {
  excelente: 'El agua se ve en muy buen estado.',
  buena: 'El agua se ve en buen estado.',
  regular: 'Hay señales de contaminación. Evita el contacto prolongado.',
  mala: 'El agua está contaminada. Evita el contacto directo.',
  critica: 'Contaminación grave. No toques el agua.',
  sin_datos: 'Aún no hay datos suficientes de este punto.',
};
