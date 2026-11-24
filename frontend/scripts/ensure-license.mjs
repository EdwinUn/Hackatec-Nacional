// Se ejecuta en `npm install` (postinstall).
// Crea src/environments/license.local.ts vacío si no existe, para que el proyecto
// compile aunque no tengas la key. Sin key, PrimeNG solo muestra un aviso.
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'environments', 'license.local.ts');

if (!existsSync(file)) {
  writeFileSync(
    file,
    [
      '// Archivo LOCAL: no se sube a git (ver .gitignore).',
      '// Pega aquí la license key de PrimeNG que te pase el equipo (por privado).',
      "export const PRIMENG_LICENSE = '';",
      '',
    ].join('\n'),
  );
  console.log('Creado src/environments/license.local.ts (sin key de PrimeNG).');
}
