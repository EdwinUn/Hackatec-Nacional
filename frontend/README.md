# Río Monitor · Frontend

Monitoreo, alertamiento temprano y analítica del tratamiento de agua en la **Cuenca del Alto Atoyac (Puebla)** —
reto SECIHTI Puebla, HackaTec 2026. Angular 22 (standalone + signals), PrimeNG, Leaflet y Chart.js.

```bash
npm install
cp src/environments/environment.example.ts src/environments/environment.development.ts   # y rellena tus claves
npm start                  # http://localhost:4200   (añade ?mock=1 para datos simulados sin backend)
npm test                   # vitest
npm run build
```

## Vistas
- `/resumen` — 4 KPI con sparklines (WQI río→salida, pH, sensores, recuperación), pH entrada vs. salida con bandas mín/máx, desglose de agua recuperada, basura, centrífuga y salud de sensores.
- `/mapa` — vista satelital (Esri World Imagery + relieve + etiquetas) acotada a la cuenca, cauces del Atoyac/Alseseca, estaciones pulsantes por WQI y panel flotante con telemetría en vivo.
- `/alertas` — filtros por estado/severidad con paginación, Reconocer/Resolver con nota y reglas vigentes.
- `/analitica/pronostico` y `/analitica/simulador` — proyección de pH con banda de confianza y simulador IoT (POST con `X-API-Key`).

Header global: estación, rango de fechas (24 h, ayer, 7/30 días o calendario doble), comparación con el periodo anterior y refresco manual + automático cada 45 s.
El WebSocket (`LiveStreamService`) reconecta con backoff exponencial (1 s … 30 s) y vuelve a consultar el resumen al reconectar.

## Configuración y secretos
`environment.ts` / `environment.prod.ts` (versionados) **no llevan claves**. Tus claves van en `src/environments/environment.development.ts`,
ignorado por Git (`ng serve` lo usa vía `fileReplacements`): `apiBaseUrl`, `wsUrl`, `ingestApiKey` (`X-API-Key`) y `primeLicense`
(PrimeNG 22 pide clave; tier *community* gratuito en <https://primeui.store>). En producción, inyéctalas al desplegar (p. ej. desde secretos del CI).

## Contrato de API
`API.md` solo documenta `/health`; los esquemas de Río Monitor son **supuestos** y están aislados en
`src/app/core/models/rio.models.ts` — ver [API-ASSUMPTIONS.md](API-ASSUMPTIONS.md).

## Estructura
`core/` (config, modelos, `api/` HTTP + `mock/`, servicios, interceptor) · `shared/` (KPI, sparkline, gráfica, utilidades) · `layout/` (shell) · `features/` (dashboard, satellite, alerts, predictive).
