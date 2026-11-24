/** Demo accounts the backend seed creates in dev (`make seed`, `API.md` «Operaciones»). */
export const REAL_DEMO_PASSWORD = 'demo123';
export const REAL_DEMO_OPERATOR = 'tecnico@demo.mx';
export const REAL_DEMO_USERS: { email: string; label: string }[] = [
  { email: REAL_DEMO_OPERATOR, label: 'Técnico de campo' },
  { email: 'supervisor@demo.mx', label: 'Supervisor' },
  { email: 'admin@demo.mx', label: 'Administrador' },
];
