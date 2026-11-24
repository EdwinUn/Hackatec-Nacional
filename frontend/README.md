# Frontend

Angular 22 + PrimeNG 22 (tema Aura).

## Estructura

```
src/
├── environments/        # apiUrl, useMocks; license.local.ts (key de PrimeNG, no se sube)
└── app/
    ├── app.config.ts    # HttpClient, router y PrimeNG
    ├── app.routes.ts    # Rutas (lazy loading por página)
    ├── core/
    │   ├── models/      # Interfaces que reflejan ../API.md
    │   ├── mocks/       # Datos falsos por endpoint
    │   └── services/    # ApiService + un servicio por recurso
    └── pages/           # Una carpeta por pantalla
```

## Trabajar con mocks

Mientras un endpoint de `API.md` no exista en el backend:

1. Crea su interfaz en `core/models/` y su mock en `core/mocks/`.
2. En el servicio, devuelve el mock si `environment.useMocks` es `true` (ver `items.service.ts`).
3. Pon `useMocks: true` en `environments/environment.development.ts`.

Cuando el endpoint ya esté en `main`, regresa `useMocks` a `false`.

## Comandos

```bash
npm install
npx ng serve                 # http://localhost:4200
npx ng build
npx ng test --watch=false
```
