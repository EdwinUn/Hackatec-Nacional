import { PRIMENG_LICENSE } from './license.local';

// Producción (ng build). Cambia apiUrl por la URL pública del backend al desplegar.
export const environment = {
  apiUrl: 'http://localhost:8000',
  useMocks: false,
  primengLicense: PRIMENG_LICENSE,
};
