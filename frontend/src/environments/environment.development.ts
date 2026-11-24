import { PRIMENG_LICENSE } from './license.local';

// Desarrollo (ng serve).
export const environment = {
  apiUrl: 'http://localhost:8000',
  // true = los servicios devuelven datos de src/app/core/mocks en vez de llamar al backend.
  // Útil mientras un endpoint de API.md todavía no existe en el backend.
  useMocks: false,
  // La key vive en license.local.ts (no se sube a git). Sin key, PrimeNG muestra un aviso.
  primengLicense: PRIMENG_LICENSE,
};
