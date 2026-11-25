# Río Monitor · Frontend

Monitoreo, alertamiento temprano y analítica del tratamiento de agua en la **Cuenca del Alto Atoyac (Puebla)** —
reto CAPCEE Puebla, HackaTec 2026. Angular 22 (standalone + signals), PrimeNG, Leaflet y Chart.js.

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

## Módulo de operaciones (login, reportes ciudadanos, órdenes de trabajo)
Rutas `/login`, `/operaciones/*` y el reporte/seguimiento público de ciudadanos (`/reportar`, `/reportar/seguimiento/:folio`). **Todavía no tiene backend:** funciona con
`MockOpsApi` (datos guardados en el navegador) mientras `opsMocks` sea `true` (valor por defecto). Los endpoints propuestos,
las reglas de negocio y lo que Back debe implementar están en [`docs/propuesta-api-operaciones.md`](docs/propuesta-api-operaciones.md).
Cuando existan en `main`, se pone `opsMocks: false` en los environments.

## Contrato de API
Los esquemas exactos de `API.md` viven en `src/app/core/models/api.models.ts`; `src/app/core/api/mappers.ts`
los convierte a los modelos de las vistas (`rio.models.ts`) y `http-rio-api.ts` hace las peticiones
(`/api/v1`; la ingesta del simulador usa `X-API-Key`). Si cambia `API.md`, ajusta esos tres archivos; las
pruebas de `mappers.spec.ts` usan fixtures con el formato real.

## App Android (Capacitor)
```bash
npm run build:android      # ng build (development) + cap sync
cd android && ANDROID_HOME=~/Android/Sdk JAVA_HOME=<ruta a un JDK 21> ./gradlew assembleDebug
```
Gradle 8.14 necesita **JDK 17–21**; con Java 25 falla (`Unsupported class file major version 69`). La ruta depende de
cada equipo: `/usr/lib/jvm/java-21-openjdk` (paquete del sistema), `~/.jdks/jdk-21…` (descargado por un IDE) o el JBR de
Android Studio (`<android-studio>/jbr`). Si VS Code marca en rojo `android/`, es la extensión de Java importando con el
Java del sistema: en `.vscode/settings.json` (ignorado por git) pon `"java.import.gradle.java.home": "<ruta a un JDK 21>"`
y ejecuta "Java: Clean Java Language Server Workspace".
Usa la configuración `development` (IP del backend y claves de `environment.development.ts`); la de producción
apunta a `localhost`, que en el teléfono es el propio teléfono. El WebView sirve la app desde `http://localhost`
(`androidScheme: 'http'`, `cleartext: true`), origen que el CORS del backend debe permitir.

## Estructura
`core/` (config, modelos, `api/` HTTP + `mock/`, servicios, interceptor) · `shared/` (KPI, sparkline, gráfica, utilidades) · `layout/` (shell) · `features/` (dashboard, satellite, alerts, predictive).
