# Esquemas de API supuestos (pendientes de confirmar contra `API.md`)

`API.md` solo documenta `GET /health`. El contrato de **Backend Río Monitor** que consume este frontend
(`/api/v1/*`, `ws://…/ws/live`) **no está en el repo**, así que los esquemas se **infirieron** de la descripción del reto
y viven aislados en un único archivo: [`src/app/core/models/rio.models.ts`](src/app/core/models/rio.models.ts)
(marcado con «SUPUESTOS»). Cuando exista el contrato real, ajustar solo ese archivo (y `core/api/http-rio-api.ts` si cambian rutas o nombres de parámetros).

## Lo que viene del reto (fijo)
- Base HTTP `http://localhost:8000/api/v1`, WebSocket `ws://localhost:8000/ws/live` (`?station_id=<uuid>`, mensaje `{"type":"subscribe","station_id":…}`).
- `GET` y `PATCH /alerts/{id}` sin API Key; `POST /readings`, `/centrifuge-cycles`, `/treatment-batches`, `/waste-collections` con `X-API-Key`.
- Errores `{ "error": { "code", "message" } }` → toast con `error.message`.
- Endpoints: `/stations`, `/dashboard/overview`, `/analytics/{ph,water-recovery,waste,centrifuge,sensors/health,hotspots}`, `/alerts`, `/alert-rules`, `/analytics/forecast/ph?station_id&horizon`.
- Eventos WS: `reading`, `sensor_status`, `cycle_update`, `batch_completed`, `waste_collected`, `alert` (+ `hello`/`ping` ignorados).
- Categorías WQI `excelente|buena|regular|mala|critica`; estados de sensor `ok|degraded|fault|offline`; estados de alerta `open|acknowledged|resolved`.

## Lo que se supuso (verificar)
- Forma de cada respuesta (`inlet/outlet {avg,min,max}`, `totals`, `by_type`, `current`, `items/total/limit/offset`, etc.) y nombres de campos.
- Severidades de alerta `info|warning|critical`; `horizon` del pronóstico en **horas**; `limit/offset` para paginar; `from`/`to` y `station_id` como query params.
- Cuerpos de los `POST` de ingesta y de los datos de cada evento WS.
- `bucket`: `5m` hasta 48 h de rango y `1h` por encima.

## Modo simulado
`?mock=1` (o `useMocks: true` en `environment.development.ts`) usa `MockRioApi` + un flujo en vivo simulado con los mismos esquemas,
útil para demostrar sin backend. Con `useMocks: false` (por defecto) todo va contra el backend real.
