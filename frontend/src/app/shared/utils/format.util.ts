const nf0 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

export const fmt0 = (v: number): string => nf0.format(v);
export const fmt1 = (v: number): string => nf1.format(v);
export const fmt2 = (v: number): string => nf2.format(v);

/** Compact liters: 12 450 -> "12.5 mil L", 2 300 000 -> "2.3 M L". */
export function formatLiters(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${fmt1(v / 1_000_000)} M L`;
  if (Math.abs(v) >= 10_000) return `${fmt1(v / 1000)} mil L`;
  return `${fmt0(v)} L`;
}

/** API timestamps: ISO UTC without milliseconds (`YYYY-MM-DDTHH:mm:ssZ`). */
export function toApiIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return 'hace un momento';
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
}

export function formatCoords(lat: number, lng: number): string {
  return `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(5)}° ${lng >= 0 ? 'E' : 'O'}`;
}

export function pctDelta(now: number, before: number): number | null {
  return before ? ((now - before) / Math.abs(before)) * 100 : null;
}
