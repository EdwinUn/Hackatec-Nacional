# Integración con el backend Río Monitor

El contrato real del backend está en [`/API.md`](../API.md) (raíz del repo) y en `http://localhost:8000/docs`.

## Cómo está conectado

- **Pantallas y mock:** usan los modelos de vista de [`src/app/core/models/rio.models.ts`](src/app/core/models/rio.models.ts).
- **Respuestas reales:** están tipadas en [`src/app/core/models/api.models.ts`](src/app/core/models/api.models.ts) y se traducen a esos modelos en [`src/app/core/api/mappers.ts`](src/app/core/api/mappers.ts). Esta capa es una función pura por endpoint, más `mapEnvelope` para el WebSocket.
- [`HttpRioApi`](src/app/core/api/http-rio-api.ts) llama al backend y aplica esas traducciones. [`LiveStreamService`](src/app/core/services/live-stream.service.ts) traduce cada mensaje de `ws://…/ws/live`.
- Las pruebas de los mappers están en [`mappers.spec.ts`](src/app/core/api/mappers.spec.ts).

**Si el backend cambia un campo:** se ajustan `api.models.ts` y `mappers.ts`. Las pantallas no cambian.

## Detalles de la traducción

- **Simulador IoT:**
  - `postReading` busca el `sensor_id` (estación + parámetro + posición) en `GET /sensors` y envía `{"readings":[…]}`.
  - Un ciclo terminado se registra como `POST /centrifuge-cycles` + `PATCH {status}`.
  - Los lotes y la basura cambian nombres de campos (`liters_in` → `volume_in_l`, `kg` → `weight_kg`…).
- **Estado actual de la centrífuga:** sale del último ciclo (`GET /centrifuge-cycles?limit=1`).
  - `running` → En operación
  - `failed` → Falla
  - otro → En espera
- **`station_name` en alertas:** se resuelve con `GET /stations`, porque el backend solo manda `station_id`.
- **Mejora de pH:** cuánto se acerca el agua a pH 7, como `(|entrada−7| − |salida−7|) / |entrada−7|`. Positivo significa que el tratamiento ayuda.
- **Reglas de alerta:** el backend usa rangos (`min_value`/`max_value`). El texto completo llega en `condition` (p. ej. «fuera de 6.5–8.5 pH»).

## Configuración local

```bash
cp src/environments/environment.example.ts src/environments/environment.development.ts
# ingestApiKey: 'dev-ingest-key'  (debe coincidir con INGEST_API_KEY de backend/.env)
```

## Modo simulado

`?mock=1` (o `useMocks: true` en `environment.development.ts`) usa `MockRioApi` y un flujo en vivo simulado. Sirve para demostrar sin backend.
