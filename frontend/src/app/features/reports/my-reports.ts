/** Folios the citizen sent from this device (no account needed to follow them). */
const KEY = 'rm.my-reports';

export function myFolios(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberFolio(folio: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([folio, ...myFolios().filter((f) => f !== folio)].slice(0, 10)));
  } catch {
    /* storage unavailable */
  }
}
