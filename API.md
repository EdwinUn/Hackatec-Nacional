# API — Río Monitor

Contrato entre el backend y el frontend (dashboard Angular + escena Three.js con sensores simulados).
Actualiza este archivo **antes** o **junto con** cualquier cambio en los endpoints.

- **Base URL (local):** `http://localhost:8000` · prefijo de la API: **`/api/v1`**
- **OpenAPI interactivo:** `http://localhost:8000/docs` (con ejemplos en cada endpoint)
- **Formato:** JSON. Fechas **ISO-8601 con zona horaria**, en UTC (`2026-11-23T18:00:00Z`). IDs: UUID.

> ⚠️ Umbrales, WQI y proyección son **valores de prototipo configurables**, no criterios validados.

## Convenciones

### Autenticación

| Qué | Cómo |
| --- | --- |
| Ingesta y escrituras de catálogo/reglas (`POST`/`PATCH`) | Header `X-API-Key: <INGEST_API_KEY>` |
| Lecturas (`GET`) y `PATCH /alerts/{id}` | Abiertas (no hay usuarios finales todavía) |
| WebSocket | Abierto con `ENVIRONMENT=dev`; si no, `?api_key=<INGEST_API_KEY>` |

### Errores (formato único)

```json
{ "error": { "code": "not_found", "message": "Sensor no encontrado", "details": null } }
```

| HTTP | `code` | Cuándo |
| --- | --- | --- |
| 401 | `unauthorized` | Falta o es inválida la `X-API-Key` |
| 404 | `not_found` | El recurso no existe |
| 409 | `conflict` | Ej. nombre de estación repetido, actualizar un ciclo ya cerrado, resolver una alerta ya resuelta |
| 422 | `validation_error` | JSON inválido; `details` es la lista de campos `[{loc, msg, type}]` |
| 422 | `invalid_data` | Regla de negocio (rango de fechas, volúmenes imposibles, referencia a un registro inexistente, etc.) |
| 500 | `internal_error` | Error inesperado (queda en el log) |

### Paginación

Los listados aceptan `limit` (1–500, default 50) y `offset`, y responden:

```json
{ "items": [ ... ], "total": 37, "limit": 50, "offset": 0 }
```

### Rango de tiempo

Los endpoints del dashboard aceptan `from` y `to` (ISO con zona). Default: últimas 24 h. Máximo 90 días.
Usa el sufijo `Z` (`2026-11-23T18:00:00Z`). Si mandas un offset como `-06:00` o `+00:00`, codifícalo en la URL: un `+` sin codificar llega como espacio y la petición responde 422.
`bucket` ∈ `1m | 5m | 1h | 1d` (agregación con `date_bin` en UTC); máximo 5 000 buckets por consulta.

### Enumeraciones

| Campo | Valores |
| --- | --- |
| `type` (sensor) | `ph`, `turbidity`, `temperature`, `dissolved_oxygen`, `conductivity`, `tds` |
| `location` | `inlet` (entrada de la máquina), `outlet` (salida), `river` (sonda en el río) |
| `status` (sensor) | `ok`, `degraded`, `fault`, `offline` |
| `status` (estación) | `active`, `maintenance`, `offline` |
| `status` (ciclo) | `running`, `completed`, `failed` |
| `waste_type` | `plastic`, `organic`, `metal`, `glass`, `other` |
| `severity` | `info`, `warning`, `critical` |
| `status` (alerta) | `open`, `acknowledged`, `resolved` |
| `kind` (regla) | `reading_range`, `sensor_offline`, `centrifuge_vibration`, `treatment_efficiency` |

Unidades por defecto: pH `pH`, turbidez `NTU`, temperatura `°C`, oxígeno disuelto `mg/L`, conductividad `µS/cm`, SDT `mg/L`.

---

## Ingesta (sensores simulados en Three.js / futuros dispositivos IoT)

Todas requieren `X-API-Key`. Para obtener los `sensor_id` y `station_id`: `GET /api/v1/sensors?limit=500` y `GET /api/v1/stations`.

### `POST /api/v1/readings`

Lote de lecturas (hasta 1 000 por petición). **Idempotente** por `(sensor_id, ts)`: reenviar la misma lectura no la duplica.

**Request**

```json
{
  "readings": [
    { "sensor_id": "0b7e9c1a-2d3f-4a5b-9c8d-7e6f5a4b3c2d", "ts": "2026-11-23T18:00:00Z", "value": 6.82, "quality": 0.97 },
    { "sensor_id": "0b7e9c1a-2d3f-4a5b-9c8d-7e6f5a4b3c2d", "ts": "2026-11-23T18:00:05Z", "value": 6.85 }
  ]
}
```

- `value`: valor **crudo**. El backend aplica la calibración del sensor (`value · calibration_factor + calibration_offset`).
- `quality`: calidad de la señal, 0–1 (opcional, default 1). Si el promedio baja de 0.6, el sensor pasa a `degraded`.

**Respuesta 200**

```json
{
  "received": 4,
  "accepted": 1,
  "duplicates": 0,
  "rejected": [
    { "index": 1, "sensor_id": "0b7e…", "ts": "2026-11-23T18:00:05Z", "reason": "impossible_value", "detail": "15.2 fuera del rango físico 0–14 pH" },
    { "index": 2, "sensor_id": "0000…", "ts": "2026-11-23T18:00:00Z", "reason": "unknown_sensor", "detail": "El sensor no existe" },
    { "index": 3, "sensor_id": "0b7e…", "ts": "2026-11-23T19:00:00Z", "reason": "future_timestamp", "detail": "ts está en el futuro" }
  ],
  "alerts_triggered": 0
}
```

Una lectura mala **no** rechaza el lote completo: solo se reporta en `rejected`. Los valores fuera del rango válido del sensor (`valid_min`–`valid_max`) se aceptan, pero ponen al sensor en `degraded`. Solo se rechazan los físicamente imposibles.

### `POST /api/v1/sensors/{sensor_id}/heartbeat`

Señal de vida sin lectura. Body opcional: `{ "ts": "2026-11-23T18:00:00Z" }`. Responde el sensor actualizado (`SensorOut`).

### `POST /api/v1/centrifuge-cycles` → 201

Inicia un ciclo. Todas las mediciones son opcionales.

```json
{ "station_id": "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b", "started_at": "2026-11-23T18:00:00Z", "rpm_avg": 2800 }
```

### `PATCH /api/v1/centrifuge-cycles/{cycle_id}`

Actualiza mediciones mientras corre:

```json
{ "rpm_avg": 2850, "rpm_max": 3010, "vibration_mm_s": 2.8, "power_w": 750 }
```

Lo cierra con `status: completed | failed` (`ended_at` default: ahora):

```json
{ "status": "completed", "ended_at": "2026-11-23T18:20:00Z", "water_in_l": 520, "water_out_clean_l": 468, "sludge_kg": 3.4 }
```

```json
{ "status": "failed", "failure_reason": "Vibración excesiva", "vibration_mm_s": 8.9 }
```

**Respuesta (`CycleOut`)**

```json
{
  "id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "station_id": "6f1c…", "status": "completed",
  "started_at": "2026-11-23T18:00:00Z", "ended_at": "2026-11-23T18:20:00Z", "duration_s": 1200.0,
  "rpm_avg": 2850, "rpm_max": 3010, "vibration_mm_s": 2.8, "power_w": 750,
  "water_in_l": 520, "water_out_clean_l": 468, "sludge_kg": 3.4, "failure_reason": null,
  "created_at": "…", "updated_at": "…"
}
```

**Errores:** 409 si el ciclo ya está cerrado. 422 si `water_out_clean_l > water_in_l`. Una vibración por encima del umbral dispara una alerta.

También existen `GET /api/v1/centrifuge-cycles?station_id=&status=` (paginado) y `GET /api/v1/centrifuge-cycles/{id}`.

### `POST /api/v1/treatment-batches` → 201

Balance de agua de un lote tratado. `efficiency_pct` la calcula el backend.

```json
{
  "station_id": "6f1c…", "cycle_id": "a1b2…", "ts": "2026-11-23T18:20:00Z",
  "volume_in_l": 520, "volume_clean_l": 468, "sludge_kg": 3.4,
  "ph_in": 5.6, "ph_out": 6.9, "turbidity_in_ntu": 85, "turbidity_out_ntu": 3.2
}
```

**Respuesta**: lo mismo más `id`, `created_at`, `efficiency_pct` (90.0), `ph_shift_toward_neutral` (1.3 = cuántas unidades de pH se acercó a 7) y `turbidity_removal_pct` (96.24).

**Errores:** 422 si `volume_clean_l > volume_in_l` o `volume_in_l ≤ 0`.

### `POST /api/v1/waste-collections` → 201

```json
{ "station_id": "6f1c…", "ts": "2026-11-23T18:30:00Z", "weight_kg": 1.25, "items_count": 14, "waste_type": "plastic", "collector_id": "banda-1" }
```

---

## Catálogo

| Método | Ruta | Notas |
| --- | --- | --- |
| GET | `/api/v1/stations?status=&river=` | Paginado |
| POST | `/api/v1/stations` | 🔑 `{name, river, latitude, longitude, status?, installed_at?, description?}` |
| GET / PATCH | `/api/v1/stations/{id}` | PATCH 🔑 parcial (ej. `{"status": "maintenance"}`). `null` solo en campos opcionales (`description`, `installed_at`); en los demás responde 422 |
| GET | `/api/v1/sensors?station_id=&type=&location=&status=` | Paginado |
| POST | `/api/v1/sensors` | 🔑 `{station_id, type, location, unit?, valid_min?, valid_max?, calibration_offset?, calibration_factor?, model?}` |
| GET / PATCH | `/api/v1/sensors/{id}` | PATCH 🔑 `{status?, valid_min?, valid_max?, calibration_offset?, calibration_factor?, calibrated_at?, model?}` |

**`StationOut`**

```json
{
  "id": "a6579f11-ce55-4f01-8145-bb03f3df9d31", "name": "Presa de Valsequillo — Oasis / Embarcadero",
  "river": "Presa de Valsequillo", "latitude": 18.918, "longitude": -98.155, "status": "active",
  "installed_at": "2026-11-10", "description": "…", "created_at": "…", "updated_at": "…"
}
```

**`SensorOut`**

```json
{
  "id": "0b7e…", "station_id": "6f1c…", "type": "ph", "location": "inlet", "unit": "pH",
  "valid_min": 2, "valid_max": 12, "status": "ok", "last_seen_at": "2026-11-23T18:00:05Z",
  "calibration_offset": 0, "calibration_factor": 1, "calibrated_at": null, "model": "Sensor simulado v0",
  "created_at": "…", "updated_at": "…"
}
```

---

## Dashboard

Todos aceptan `station_id` (omitir = todas las estaciones) y `from`/`to`.

### `GET /api/v1/dashboard/overview`

```json
{
  "station_id": "e68a…", "from": "2026-11-23T04:13:51Z", "to": "2026-11-24T04:13:51Z",
  "wqi": { "score": 80.0, "category": "buena", "dominant_parameter": "turbidity", "components": [
    { "parameter": "ph", "value": 7.362, "sub_index": 100.0, "weight": 0.25 },
    { "parameter": "turbidity", "value": 46.977, "sub_index": 48.28, "weight": 0.25 }
  ] },
  "wqi_outlet": { "score": 95.6, "category": "excelente", "components": [ … ] },
  "ph_inlet": { "value": 7.349, "ts": "2026-11-24T04:12:28Z" },
  "ph_outlet": { "value": 7.152, "ts": "2026-11-24T04:12:28Z" },
  "sensors_online": 12, "sensors_total": 12,
  "water_in_l": 23743.7, "water_clean_l": 21239.6, "sludge_kg": 64.48, "efficiency_pct": 89.45,
  "waste_kg": 42.66, "waste_items": 319, "cycles_running": 0,
  "alerts_open": 7, "alerts_critical_open": 3,
  "trend_bucket": "1h",
  "trend": [
    { "bucket": "2026-11-23T05:00:00Z", "wqi": 81.2, "ph_inlet": 7.31, "ph_outlet": 7.12, "water_clean_l": 2210.4 }
  ]
}
```

- `dominant_parameter`: el parámetro con el sub-índice más bajo, es decir, el que más baja la calidad. Es `null` si no hay datos.
- `trend`: serie corta para sparklines de los KPI (WQI, pH de entrada y salida, litros limpios). Usa buckets de `1h` hasta 48 h de rango y de `1d` por encima.
- `wqi`: agua cruda (río + entrada). `wqi_outlet`: agua que regresa al río. Categorías: `excelente | buena | regular | mala | critica`. Si faltan datos, valen `null`.
- `alerts_open` cuenta las alertas no resueltas (`open` + `acknowledged`).

### `GET /api/v1/analytics/ph?bucket=5m`

```json
{
  "station_id": "e68a…", "bucket": "1h",
  "points": [
    { "bucket": "2026-11-23T04:00:00Z",
      "inlet":  { "avg": 7.069, "min": 7.01,  "max": 7.16,  "count": 46 },
      "outlet": { "avg": 7.088, "min": 7.015, "max": 7.159, "count": 46 } }
  ],
  "inlet_avg": 7.21, "outlet_avg": 7.12, "avg_shift_toward_neutral": 0.08
}
```

`inlet` u `outlet` valen `null` en buckets sin datos.

### `GET /api/v1/analytics/sensors/health`

Lista de sensores con `uptime_pct` = % de ventanas de 5 min del rango con al menos una lectura.

```json
[{
  "sensor_id": "dc0a…", "station_id": "e68a…", "station_name": "Río Alseseca — La Hacienda / Xilotzingo",
  "type": "conductivity", "location": "inlet", "unit": "µS/cm", "status": "ok",
  "last_seen_at": "2026-11-24T04:30:26Z", "last_value": 930.038, "last_reading_at": "2026-11-24T04:30:26Z",
  "readings_count": 1451, "avg_quality": 0.965, "uptime_pct": 100.0
}]
```

### `GET /api/v1/analytics/centrifuge?bucket=1h`

```json
{
  "summary": { "cycles": 141, "completed": 140, "failed": 1, "running": 0, "failure_rate_pct": 0.71,
               "rpm_avg": 2828.9, "rpm_max": 3194.4, "vibration_avg_mm_s": 2.716, "vibration_max_mm_s": 8.91,
               "power_avg_w": 796.1, "energy_kwh": 37.27, "avg_duration_s": 1194.9 },
  "series": [ { "bucket": "2026-11-23T00:00:00Z", "cycles": 117, "failed": 0, "rpm_avg": 2831.1,
                "vibration_avg_mm_s": 2.69, "power_avg_w": 795.3 } ]
}
```

### `GET /api/v1/analytics/water-recovery?bucket=1h`

```json
{
  "total": { "batches": 140, "water_in_l": 73980.3, "water_clean_l": 66244.0, "water_lost_l": 7736.3,
             "sludge_kg": 204.34, "efficiency_pct": 89.54 },
  "series": [ { "bucket": "2026-11-23T00:00:00Z", "batches": 117, "water_in_l": 61835.6, "water_clean_l": 55351.8,
                "water_lost_l": 6483.8, "sludge_kg": 171.09, "efficiency_pct": 89.51 } ]
}
```

### `GET /api/v1/analytics/waste?bucket=1h`

```json
{
  "total_kg": 144.06, "total_items": 1073,
  "by_type": [ { "waste_type": "plastic", "weight_kg": 76.18, "items": 575, "collections": 54 } ],
  "series":  [ { "bucket": "2026-11-23T00:00:00Z", "waste_type": "plastic", "weight_kg": 40.1, "items": 301 } ]
}
```

### `GET /api/v1/analytics/forecast/ph?station_id=…&horizon=6&lookback=6&location=inlet`

`station_id` es obligatorio. `horizon`: 1–48 h. `lookback`: 1–168 h (default 6). Es una regresión lineal sobre promedios de 15 min.

```json
{
  "station_id": "e68a…", "location": "inlet", "method": "Regresión lineal (mínimos cuadrados) …",
  "lookback_hours": 6, "horizon_hours": 6, "samples": 24, "slope_per_hour": 0.013, "residual_std": 0.03,
  "history": [ { "ts": "2026-11-23T22:00:00Z", "value": 7.112 } ],
  "points":  [ { "ts": "2026-11-24T04:15:00Z", "value": 7.36, "lower": 7.30, "upper": 7.42 } ],
  "note": null
}
```

Con menos de 3 puntos, `points` llega vacío y `note` explica el motivo.

### `GET /api/v1/analytics/hotspots`

Para el mapa de puntos críticos. No recibe parámetros.

```json
[{
  "station_id": "a657…", "name": "Presa de Valsequillo — Oasis / Embarcadero", "river": "Presa de Valsequillo",
  "latitude": 18.918, "longitude": -98.155, "status": "active",
  "wqi": { "score": 86.4, "category": "buena", "components": [ … ] },
  "alerts_open": 5, "alerts_critical_open": 1, "last_reading_at": "2026-11-24T04:30:26Z"
}]
```

---

## Alertas y umbrales

### `GET /api/v1/alerts?station_id=&status=&severity=&since=`

Paginado, de la más reciente a la más vieja (`last_triggered_at`).

```json
{
  "id": "7b30…", "rule_id": "8237…", "station_id": "e68a…", "sensor_id": null,
  "subject_key": "station:e68a…", "kind": "centrifuge_vibration", "parameter": null,
  "severity": "critical", "status": "open",
  "message": "Vibración peligrosa en centrífuga: 8.48 mm/s (máx 7.1)",
  "trigger_value": 8.48, "threshold_min": null, "threshold_max": 7.1,
  "first_triggered_at": "2026-11-24T02:38:00Z", "last_triggered_at": "2026-11-24T02:38:00Z",
  "occurrences": 1, "acknowledged_at": null, "resolved_at": null, "note": null
}
```

**Anti-spam:** solo puede haber una alerta activa por regla y sujeto (sensor o estación). Cada repetición incrementa `occurrences` y actualiza `trigger_value`. Una alerta resuelta no se reabre: la siguiente violación crea una nueva.

### `PATCH /api/v1/alerts/{id}`

```json
{ "status": "acknowledged", "note": "Revisando descarga aguas arriba" }
```

`status` ∈ `acknowledged | resolved`. **Errores:** 409 si la alerta ya estaba resuelta.

### Reglas (umbrales configurables)

| Método | Ruta | Notas |
| --- | --- | --- |
| GET | `/api/v1/alert-rules` | Incluye `description` con el criterio del valor por defecto |
| POST | `/api/v1/alert-rules` | 🔑 `{name, kind, severity, parameter?, location?, station_id?, min_value?, max_value?, enabled?, description?}` |
| PATCH | `/api/v1/alert-rules/{id}` | 🔑 `{name?, severity?, location?, min_value?, max_value?, enabled?, description?}` |

---

## Tiempo real — `WS /ws/live?station_id=<uuid>&api_key=<key>`

- `station_id` es opcional: sin él llegan los eventos de todas las estaciones.
- Al conectar, el servidor envía `hello`. Después envía `ping` cada `ping_interval_s` (20 s).
- El cliente puede mandar `{"type": "ping"}` y recibe `pong`. Para cambiar de estación sin reconectar: `{"type": "subscribe", "station_id": "<uuid|null>"}` → `subscribed`.
- **Reconexión sugerida:** backoff exponencial (1 s, 2 s, 4 s… máx. 30 s). Al reconectar, vuelve a pedir `GET /dashboard/overview`, porque los eventos perdidos durante la desconexión no se reenvían.

Todos los mensajes tienen el mismo sobre:

```json
{ "type": "<tipo>", "station_id": "<uuid|null>", "ts": "<iso>", "data": { … } }
```

| `type` | Cuándo | `data` |
| --- | --- | --- |
| `hello` | Al conectar | `{station_id, ping_interval_s, events: [...]}` |
| `reading` | Cada lectura aceptada | `{id, sensor_id, station_id, ts, value, quality, type, location, unit}` |
| `sensor_status` | Un sensor cambia de estado | `{sensor_id, type, location, status, previous_status, last_seen_at}` |
| `cycle_update` | Un ciclo se crea, actualiza o cierra | `CycleOut` sin `created_at` |
| `batch_completed` | Se registra un lote tratado | `BatchOut` (incluye `efficiency_pct`, `ph_shift_toward_neutral`, `turbidity_removal_pct`) |
| `waste_collected` | Se registra basura | `{id, station_id, ts, weight_kg, items_count, waste_type, collector_id}` |
| `alert` | Alerta nueva, re-disparada (tras 15 min) o con cambio de estado | `AlertOut` + `created_at`, `updated_at`, `last_notified_at` |
| `ping` / `pong` / `subscribed` / `error` | Control | `{}` / `{station_id}` / `{message}` |

Ejemplos:

```json
{ "type": "reading", "station_id": "e68a…", "ts": "2026-11-24T04:30:01Z",
  "data": { "id": "…", "sensor_id": "0b7e…", "station_id": "e68a…", "ts": "2026-11-24T04:30:00Z",
            "value": 5.248, "quality": 0.97, "type": "ph", "location": "inlet", "unit": "pH" } }
```

```json
{ "type": "sensor_status", "station_id": "e68a…", "ts": "…",
  "data": { "sensor_id": "0b7e…", "type": "turbidity", "location": "outlet", "status": "degraded",
            "previous_status": "ok", "last_seen_at": "2026-11-24T04:30:00Z" } }
```

```json
{ "type": "alert", "station_id": "e68a…", "ts": "…",
  "data": { "id": "47d4…", "severity": "critical", "status": "open", "kind": "reading_range", "parameter": "ph",
            "message": "pH extremo: 5.248 pH (mín 5.5, máx 9.5)", "trigger_value": 5.248, "sensor_id": "0b7e…",
            "occurrences": 3, "first_triggered_at": "…", "last_triggered_at": "…", "…": "…" } }
```

```json
{ "type": "batch_completed", "station_id": "e68a…", "ts": "…",
  "data": { "id": "…", "cycle_id": "a1b2…", "ts": "…", "volume_in_l": 520, "volume_clean_l": 468, "efficiency_pct": 90.0,
            "ph_in": 5.6, "ph_out": 6.9, "ph_shift_toward_neutral": 1.3, "turbidity_removal_pct": 96.24, "…": "…" } }
```

---

## Flujo sugerido para el sensor simulado en Three.js

1. Al iniciar la escena: `GET /api/v1/stations` y `GET /api/v1/sensors?station_id=<id>&limit=500` para mapear cada sensor 3D a su `sensor_id`.
2. Cada 1–5 s: un solo `POST /api/v1/readings` con una lectura por sensor (mismo `ts` está bien porque cada sensor tiene su propio id).
3. Máquina: `POST /centrifuge-cycles` al arrancar el giro → `PATCH` con `rpm_avg`/`vibration_mm_s` mientras gira → `PATCH {"status": "completed", …}` al parar → `POST /treatment-batches` con los litros.
4. Banda de basura: `POST /waste-collections` cada vez que se descarga.
5. El dashboard escucha `WS /ws/live` y refresca KPIs con `GET /dashboard/overview` cada 30–60 s.

## Utilidad

### `GET /health` (también `/api/v1/health`)

```json
{ "status": "ok", "api": "ok", "postgres": "ok", "redis": "ok", "version": "0.1.0" }
```

Responde 503 con `"status": "degraded"` si Postgres o Redis fallan. Con `REDIS_URL` vacío, `redis` vale `"disabled"`.

---

## Cómo proponer un endpoint

1. **Back** abre un PR que **solo** modifica este archivo, con la ruta, el request, la respuesta y los errores.
2. **Front** revisa el PR. Si los nombres de campos y la forma de la respuesta le sirven, lo aprueba y se mergea.
3. A partir de ahí trabajan en paralelo:
   - **Front:** agrega la interfaz en `frontend/src/app/core/models/` y un mock en `core/mocks/`, y construye la pantalla con `useMocks: true`.
   - **Back:** implementa el dominio, el caso de uso, el adaptador y el router.
4. Cuando el endpoint ya está en `main`, Front prueba con `useMocks: false`.

Si algo del contrato tiene que cambiar después, se vuelve a pasar por el paso 1.
