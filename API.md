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
| `PATCH /stations/{id}`, `PATCH /sensors/{id}`, `PATCH /alert-rules/{id}`, `POST /waste-collections` | `X-API-Key` **o** `Authorization: Bearer <token>` de un usuario activo del personal |
| Módulo de operaciones (`/users`, `/work-orders`, `PATCH /citizen-reports/{id}`, `/tasks`, `POST /skimmers/recoleccion`, `/auth/me`) | `Authorization: Bearer <token>` (ver «Operaciones»). Token vencido o inválido → 401; rol insuficiente → 403 |
| `POST/GET /citizen-reports`, `GET /citizen-reports/by-folio/{folio}`, `POST /vision/analyze` | Públicos (ciudadanía sin cuenta) |
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
| 401 | `invalid_credentials` | Correo o contraseña incorrectos en el login |
| 403 | `forbidden` | El rol del usuario no permite la acción |
| 403 | `inactive` | La cuenta está desactivada (login) |
| 409 | `invalid_transition` | Cambio de estado de una orden de trabajo no permitido |
| 413 | `payload_too_large` | El cuerpo de la petición supera 2 MB (`MAX_BODY_KB`) |
| 429 | `rate_limited` | Demasiados reportes ciudadanos desde la misma IP, o demasiados intentos de login |
| 500 | `internal_error` | Error inesperado (queda en el log) |
| 503 | `vision_unavailable` | La visión artificial no está disponible (falta `uv sync --extra vision`, el modelo no cargó o está desactivada) |

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
| `category` (visión) | `peces_muertos`, `boya_defectuosa`, `boya_saturada`, `acumulacion_basura`, `normal` |
| `severity` (visión) | `critica`, `alta`, `media`, `baja` (¡en español, distinto de `severity` de alertas!) |
| `buoy.status` (visión) | `no_detectada`, `integra`, `saturada`, `defectuosa` |
| `kind` (tarea) | `report`, `repair`, `skimmer_collection`, `maintenance` |
| `priority` (tarea) | `normal`, `urgent` |
| `status` (tarea) | `pending`, `in_progress`, `done` |
| `view` (bandeja) | `asignadas`, `reparaciones_pendientes`, `urgentes`, `listos` |
| `buoy_condition` | `ok`, `danada`, `saturada`, `faltan_piezas` |
| material (encuesta skimmer) | `plastico`, `organico`, `vidrio`, `otros`, `metal` → `waste_type` `plastic`, `organic`, `glass`, `other`, `metal` |

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

## Dispositivos — telemetría de la boya (ESP32 / Wokwi)

La boya manda **un mensaje plano por envío**. El backend lo reparte así:

- **Calidad del agua → lecturas** de los sensores de la estación (mismas validaciones, alertas, salud y evento `reading` que `POST /readings`):

  | Campo | Sensor (`type` / `location`, en orden de preferencia) |
  | --- | --- |
  | `ph` | `ph` / `inlet`, si no hay → `river` |
  | `tds_ppm` | `tds` / `inlet` → `river` |
  | `temp_c` | `temperature` / `inlet` → `river` |
  | `turb_in_ntu` | `turbidity` / `inlet` |
  | `turb_out_ntu` | `turbidity` / `outlet` |

  Un campo cuya estación no tiene ese sensor no se guarda y se reporta en `unmapped`.
- **Estado del dispositivo → `device_telemetry`**: `n`, `bat_v`, `bat_pct`, `rio_ms`, `gen_w`, `gen_v`, `freno`, `bomba`, `alerta`, `eficiencia_pct` (todos opcionales). Ojo: `eficiencia_pct` es la del firmware (por turbidez); no es la `efficiency_pct` de los lotes (por volumen).
- **Hora**: `ts` opcional (ISO-8601 con zona o epoch en s). Si no viene, no se entiende (ej. `"sin-hora"`), es anterior a 2024 (ESP32 sin NTP) o está más de 5 min en el futuro, se usa la hora de llegada.
- Campos desconocidos se ignoran (el firmware puede agregar campos sin romper nada).

### Por MQTT

Firmware de referencia (Wokwi y boya real): [`firmware/boya-rm01/sketch.ino`](firmware/boya-rm01/sketch.ino).

La API se suscribe a `MQTT_TOPIC` (default `riomonitor/+/telemetria`; el `+` es el `code`) en el broker de `MQTT_URL` (vacío = apagado). Mismo cuerpo que el POST. Un mensaje inválido o de una boya desconocida se registra en el log y se descarta. Con varios workers usa suscripción compartida `$share/rio-api/…` para no ingerir dos veces.

### `POST /api/v1/devices/{code}/telemetry` 🔑

```json
{ "boya": "RM-01", "n": 42, "ph": 6.9, "tds_ppm": 410, "temp_c": 22.0, "turb_in_ntu": 180, "turb_out_ntu": 12,
  "eficiencia_pct": 93.3, "bat_v": 11.8, "bat_pct": 78, "rio_ms": 0.9, "gen_v": 14.2, "freno": false, "bomba": true, "alerta": false }
```

`boya` es opcional, pero si viene debe coincidir con `{code}` (422). Código sin estación → 404.

→ 200

```json
{ "station_id": "80f0…", "code": "RM-01", "ts": "2026-11-24T17:54:53Z",
  "readings": { "received": 5, "accepted": 5, "duplicates": 0, "rejected": [], "alerts_triggered": 0 },
  "unmapped": [] }
```

### `GET /api/v1/devices/{code}/telemetry/latest`

Último estado (404 si la boya todavía no envía nada). **`DeviceTelemetryOut`**:

```json
{ "id": "…", "station_id": "80f0…", "ts": "…", "seq": 42, "battery_v": 11.8, "battery_pct": 78,
  "river_speed_ms": 0.9, "generator_w": null, "generator_v": 14.2, "pump_on": true, "brake_on": false,
  "alarm_on": false, "device_efficiency_pct": 93.3 }
```

### `GET /api/v1/devices/{code}/telemetry?since=&limit=100`

Historial de `DeviceTelemetryOut`, más reciente primero (`limit` 1–1000).

### Para la escena 3D de la boya

1. `GET /api/v1/stations` → la estación con `code` = la boya; `GET /api/v1/sensors?station_id=…` para saber qué sensor es cada sonda.
2. Estado inicial: `GET /dashboard/overview?station_id=…` (calidad del agua) y `GET /devices/{code}/telemetry/latest` (batería, bomba…).
3. En vivo: `WS /ws/live?station_id=…` → `reading` (sondas) y `device_telemetry` (batería, corriente, generador, bomba, alarma).

---

## Catálogo

| Método | Ruta | Notas |
| --- | --- | --- |
| GET | `/api/v1/stations?status=&river=` | Paginado |
| POST | `/api/v1/stations` | 🔑 `{name, river, latitude, longitude, status?, installed_at?, description?, code?}` |
| GET / PATCH | `/api/v1/stations/{id}` | PATCH 🔑 parcial (ej. `{"status": "maintenance"}`). `null` solo en campos opcionales (`description`, `installed_at`, `code`); en los demás responde 422 |
| GET | `/api/v1/sensors?station_id=&type=&location=&status=` | Paginado |
| POST | `/api/v1/sensors` | 🔑 `{station_id, type, location, unit?, valid_min?, valid_max?, calibration_offset?, calibration_factor?, model?}` |
| GET / PATCH | `/api/v1/sensors/{id}` | PATCH 🔑 `{status?, valid_min?, valid_max?, calibration_offset?, calibration_factor?, calibrated_at?, model?}` |

**`StationOut`**

```json
{
  "id": "a6579f11-ce55-4f01-8145-bb03f3df9d31", "name": "Presa de Valsequillo — Oasis / Embarcadero",
  "river": "Presa de Valsequillo", "latitude": 18.918, "longitude": -98.155, "status": "active",
  "installed_at": "2026-11-10", "description": "…", "code": "RM-03", "created_at": "…", "updated_at": "…"
}
```

`code` es el código del dispositivo físico (`RM-01`): único, 1–32 caracteres `A–Z 0–9 - _`, se guarda en mayúsculas. Es lo que usa la boya en `/devices/{code}/…` y en el tópico MQTT. El seed crea dos boyas con dispositivo, `RM-01` (Atoyac, colector Panzacola) y `RM-02` (Atoyac, estación testigo), con solo los 5 sensores del firmware. Las 3 estaciones simuladas no tienen `code`. **Una estación con `code` la alimenta un dispositivo y el simulador no la toca.**

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

### `GET /api/v1/analytics/critical-points?from=&to=`

Ranking de estaciones por **índice de criticidad** (0–100, valor de prototipo). El índice combina tres componentes, cada uno de 0 a 100:

- **calidad** = 100 − WQI;
- **alertas** = alertas de calidad del agua activas (crítica 25, advertencia 8, informativa 2);
- **recurrencia** = repeticiones en el periodo, en escala logarítmica.

Fórmula: `0.5·calidad + 0.3·alertas + 0.2·recurrencia`. Niveles: `critico` ≥ 50, `atencion` ≥ 30, `estable`. Solo cuentan las alertas de calidad del agua (`reading_range`); un sensor caído o una falla de la centrífuga no es contaminación.

```json
[{
  "rank": 1, "station_id": "e68a…", "name": "Río Atoyac — Parque Lineal / Echeverría", "river": "Río Atoyac",
  "latitude": 19.0185, "longitude": -98.2435, "score": 65.0, "level": "critico",
  "components": { "calidad": 36.1, "alertas": 90.0, "recurrencia": 100.0 },
  "wqi": 63.9, "wqi_category": "regular", "dominant_parameter": "turbidity",
  "alerts_active": { "critical": 2, "warning": 5, "info": 0 }, "occurrences": 448,
  "top_issues": [ { "rule": "pH fuera del rango aceptable", "severity": "warning", "parameter": "ph", "occurrences": 204 } ],
  "reasons": [
    "Lo más repetido: pH fuera del rango aceptable (204 veces)",
    "2 alertas críticas activas, 5 advertencias activas",
    "Calidad del agua regular (WQI 63.9), sobre todo por turbidez"
  ]
}]
```

`reasons` viene ordenado por el componente que más aporta al índice.

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

## Operaciones: personal, reportes ciudadanos y órdenes de trabajo

Contrato acordado con Front (propuesta en `frontend/docs/propuesta-api-operaciones.md`, que trae además los modelos TypeScript y el detalle de implementación). Las listas de este módulo devuelven un **arreglo simple** (máximo 500), no el sobre `{items, total, …}`.

### Autenticación

Roles: `technician` (técnico de campo), `supervisor`, `admin`. La ciudadanía **no** tiene cuenta.

`POST /api/v1/auth/login` con `{ "email": "tecnico@demo.mx", "password": "demo123" }` responde 200:

```json
{
  "access_token": "<JWT>", "token_type": "bearer", "expires_in": 43200,
  "user": { "id": "…", "name": "Luis Hernández", "email": "tecnico@demo.mx", "role": "technician", "active": true }
}
```

- **Errores:** 401 `invalid_credentials`, también si el correo no existe; 403 `inactive` si la cuenta está desactivada; 429 `rate_limited` tras 10 intentos en 10 min por IP o por correo. El correo no distingue mayúsculas.
- **Token:** JWT HS256 con claims `sub`, `role` y `exp`, válido 12 h (`JWT_EXPIRES_MIN`). Se envía como `Authorization: Bearer <token>`.
- **Desactivación:** si un usuario se desactiva, su token deja de servir (401).
- **`GET /api/v1/auth/me`:** devuelve el `User` dueño del token.

### Usuarios (gestión solo `admin`)

| Método | Ruta | Cuerpo → respuesta |
| --- | --- | --- |
| GET | `/api/v1/users` | `User[]`, ordenados por nombre. `supervisor` y `admin` (el supervisor necesita ver a los técnicos para asignar órdenes); técnico → 403 |
| POST | `/api/v1/users` | `{ name, email, role, password }` → 201 `User`. 409 si el correo ya existe; contraseña mínima de 6 caracteres |
| PATCH | `/api/v1/users/{id}` | `{ name?, role?, active? }` → `User`. Un admin no puede desactivarse ni quitarse el rol a sí mismo (409) |

`User` = `{ id, name, email, role, active }` (nunca incluye la contraseña ni el hash).

### Reportes ciudadanos

```json
{
  "id": "…", "folio": "RC-0042", "type": "discharge", "description": "Tubo descargando agua gris con espuma",
  "photo": "http://<host>:8000/media/9b2f….jpg", "latitude": 19.051, "longitude": -98.251, "accuracy": 12,
  "status": "new", "station_id": "…", "work_order_id": null, "public_note": null,
  "created_at": "…", "updated_at": "…"
}
```

- **`type`:** `trash | discharge | odor | foam | dead_fish | other`.
- **`status`:** `new | verified | in_progress | resolved | rejected`.
- **`station_id`:** la estación más cercana a 8 km o menos (haversine); `null` si no hay ninguna. La calcula el servidor.
- **`photo`:** se recibe como data URL JPEG/PNG de máximo 300 KB y se guarda como archivo. Se devuelve como **URL absoluta** con el mismo host por el que llegó la petición, así que funciona también desde el celular en la red local.

| Método | Ruta | Acceso | Notas |
| --- | --- | --- | --- |
| POST | `/api/v1/citizen-reports` | Público | `{ type, description, photo, latitude, longitude, accuracy?, ai? }` → 201 con `folio` y `status: "new"`. `ai` (opcional) es el resultado de `POST /vision/analyze` con la imagen anotada reducida (máx. 200 KB en JSON, si no 422); se guarda y se devuelve en `ai` en cada lectura. Sin descripción ni foto → 422 `validation_error`. Foto inválida o > 300 KB → 422 `invalid_data`. 5 reportes por IP cada 10 min → 429 `rate_limited` |
| GET | `/api/v1/citizen-reports` | Público | Más recientes primero, máx. 500 |
| GET | `/api/v1/citizen-reports/by-folio/{folio}` | Público | Sin distinguir mayúsculas; 404 si no existe |
| PATCH | `/api/v1/citizen-reports/{id}` | supervisor / admin | `{ status?, public_note? }` (p. ej. descartar). `work_order_id` es solo lectura |

### Órdenes de trabajo

```json
{
  "id": "…", "folio": "OT-0007", "type": "waste_collection", "title": "Vaciar contenedor", "description": "…",
  "priority": "normal", "status": "assigned", "station_id": "…", "station_name": "…",
  "citizen_report_id": null, "alert_id": null, "location": { "latitude": 19.05, "longitude": -98.25 },
  "assigned_to": "<user id>", "assigned_name": "Luis Hernández", "created_by": "<user id>", "due_at": null,
  "checklist": [{ "key": "container", "label": "Contenedor de basura vaciado", "done": true }],
  "evidence": [{ "kind": "after", "photo": "http://<host>:8000/media/….jpg", "ts": "…" }],
  "notes": "", "result": { "waste_type": "plastic", "weight_kg": 6.2, "items_count": 41 },
  "check_in": { "latitude": 19.05, "longitude": -98.25, "accuracy": 8, "ts": "…" },
  "created_at": "…", "started_at": null, "completed_at": null, "verified_at": null
}
```

**Valores posibles**
- **`type`:** `citizen_report | maintenance | waste_collection | calibration`.
- **`priority`:** `low | normal | high | urgent`.
- **`status`:** `pending | assigned | in_progress | done | verified | cancelled`.

**Campos que llena el servidor**
- **`checklist`:** lo genera el servidor según el tipo. El cliente solo marca `done`; los textos los pone el servidor y una `key` desconocida da 422.
- **`evidence`:** máximo 2 fotos (`before`/`after`). Se envían como data URL; también se puede reenviar la URL que devolvió el servidor.
- **`location`:** si no viene, se toma la del reporte ciudadano o, si no hay, la de la estación.
- **`created_by`:** se toma del token. **`station_name`** y **`assigned_name`** los resuelve el servidor.

| Método | Ruta | Acceso | Notas |
| --- | --- | --- | --- |
| GET | `/api/v1/work-orders?assigned_to=&status=a,b&type=` | personal | Más recientes primero. Un técnico solo recibe las suyas aunque pida otras |
| GET | `/api/v1/work-orders/{id}` | personal | Las órdenes ajenas responden 404 a un técnico |
| POST | `/api/v1/work-orders` | supervisor / admin | `{ type, title, description, priority, station_id, citizen_report_id?, alert_id?, location?, assigned_to?, due_at? }` → 201. Con `assigned_to` nace `assigned`; sin él, `pending`. Referencias inexistentes o técnico inactivo → 422 |
| PATCH | `/api/v1/work-orders/{id}` | personal | Campos según rol: un técnico puede `status`, `checklist`, `evidence`, `notes`, `result` y `check_in` (en las suyas); `assigned_to`, `priority` y `due_at` solo supervisor/admin (403) |

**Reglas**
- **Transiciones** (409 `invalid_transition` con un mensaje para la persona, p. ej. «No se puede pasar de «asignada» a «verificada»»):
  - `pending → assigned | cancelled`
  - `assigned → in_progress | pending | cancelled`
  - `in_progress → done | assigned | cancelled`
  - `done → verified | in_progress`
  - `verified` y `cancelled` son finales. Repetir el estado actual no hace nada.
- **Qué puede hacer un técnico:** solo `assigned → in_progress` e `in_progress → done`. Verificar, cancelar o reabrir lo hace un supervisor (403 si lo intenta un técnico).
- **Asignación:** asignar pasa `pending → assigned`; quitar el técnico (`assigned_to: null`) pasa `assigned → pending`.
- **Órdenes cerradas** (409 `conflict`):
  - una orden `verified` o `cancelled` solo acepta `status`, y desde ahí cualquier transición es inválida;
  - en una orden `done`, el técnico ya no puede editar datos (un supervisor la verifica o la reabre);
  - las órdenes `done`, `verified` o `cancelled` no se reasignan.
- **Un reporte, una orden activa:** crear una orden para un reporte que ya atiende otra orden no cancelada da 409.
- **Evidencia:** una foto `before` y una `after` como máximo. Una URL reenviada debe ser una foto guardada por el servidor; si no, 422.
- **Fechas:** `started_at` se llena la primera vez que pasa a `in_progress`; `completed_at` en `done`; `verified_at` en `verified`.
- **Cierre (`done`):** exige un `result` coherente con el tipo (422):
  - `waste_collection`: `waste_type` válido y `weight_kg > 0`.
  - `calibration`: `sensor_id`, `calibration_offset` y `calibration_factor`.
  - `citizen_report`: `confirmed`.
  - `maintenance`: no necesita resultado.
- **Cascada al reporte ciudadano:**

  | Orden | Reporte |
  | --- | --- |
  | Al crearse | `verified`, con `work_order_id` |
  | `in_progress` | `in_progress` |
  | `done` / `verified` | `resolved`, con `public_note = result.action_taken` |
  | `done` / `verified` con `confirmed: false` | `rejected`, con la nota o «La brigada no encontró el problema reportado.» |
  | `cancelled` | `verified` |

  La cascada se aplica cuando la orden cambia de estado (y al crearla). Guardar notas, checklist o evidencia no la dispara, así no pisa la moderación manual del supervisor.

### Bandeja del operador (tareas)

| Método | Ruta | Notas |
| --- | --- | --- |
| GET | `/tasks?view=&limit=&offset=` | `view` ∈ `asignadas` (mías sin cerrar), `reparaciones_pendientes`, `urgentes`, `listos` (resueltas). Responde la paginación estándar **más** `counts: {asignadas, reparaciones_pendientes, urgentes, listos}` |
| GET | `/tasks/{id}` | Detalle |
| POST | `/tasks` | Solo `supervisor`/`admin`: `{title, kind, description?, priority?, assigned_to?, station_id?, buoy_code?}` → 201 |
| PATCH | `/tasks/{id}` | Atender: `{"status":"in_progress"}` (se autoasigna si no tenía dueño). Resolver: `{"status":"done","closing_note":"…"}` (nota ≥ 3 caracteres, si no 422). También `priority` y `assigned_to` (un técnico solo puede asignarse a sí mismo). Una tarea resuelta no cambia: 409 |

`Task`: `{id, title, description, kind, priority, status, assigned_to, station_id, buoy_code, closing_note, resolved_at, resolved_by, created_at, updated_at}`.

### Bitácora de recolección de boyas skimmer

#### `POST /api/v1/skimmers/recoleccion` → 201 (requiere sesión)

```json
{ "station_id": "6f1c…", "buoy_code": "SK-01", "buoy_condition": "saturada",
  "plastico": { "kg": 2.5, "piezas": 40 }, "organico": { "kg": 1.0, "piezas": 12 },
  "vidrio": { "kg": 0, "piezas": 0 }, "otros": { "kg": 0, "piezas": 0 }, "metal": { "kg": 0.5, "piezas": 3 },
  "notes": "Cesta casi llena", "task_id": "…", "ts": "2026-11-24T18:30:00Z" }
```

Los cinco materiales son opcionales (default 0), pero debe haber al menos un peso o una pieza (422 `invalid_data`).
`task_id` (opcional) cierra sola la tarea de vaciado. Respuesta: la recolección con `materials`, `total_kg`, `total_pieces`, `operator_name`.
Efecto: además de la bitácora se registra una `waste_collection` por material (alimenta `GET /analytics/waste` y la tarjeta
«Clasificación de basura») y se emiten por WebSocket un `waste_collected` por material y un `skimmer_collected`.

`GET /skimmers/recoleccion?station_id=&from=&to=` lista la bitácora (paginada, más reciente primero).

#### `GET /api/v1/skimmers/clasificacion-basura?station_id=&from=&to=` (abierto)

```json
{ "total_kg": 4.0, "total_piezas": 55, "recolecciones": 1, "ultima": "2026-11-24T18:30:00Z",
  "por_material": [ { "material": "plastico", "waste_type": "plastic", "kg": 2.5, "piezas": 40, "pct": 62.5 } ] }
```

Acumulado de todas las recolecciones (o del rango), ordenado por kg.

### Eventos WebSocket nuevos

Llegan con el mismo sobre `{ type, station_id, ts, data }`:

| `type` | Cuándo | `data` |
| --- | --- | --- |
| `work_order_assigned` | Se crea una orden con técnico o se asigna/reasigna | La `WorkOrder`, con `evidence[].photo = null` |
| `citizen_report_created` | Se crea un reporte ciudadano | El `CitizenReport`, con `photo = null` (pedir el listado para verla) |
| `device_telemetry` | La boya envía telemetría (HTTP o MQTT) | `DeviceTelemetryOut` (sin `created_at`) + `code` |
| `skimmer_collected` | Se registra el vaciado de una boya skimmer | `{id, station_id, ts, buoy_code, buoy_condition, materials, total_kg, total_pieces, operator_id, operator_name, notes, task_id}` |

Los eventos llegan a todos los clientes conectados (prototipo); el front filtra por `assigned_to`.

### Cuentas demo

Las crea `make seed`, solo con `ENVIRONMENT` de desarrollo: `tecnico@demo.mx`, `tecnico2@demo.mx` (technician), `supervisor@demo.mx` y `admin@demo.mx`. Contraseña: `demo123`. El seed también crea cinco tareas de ejemplo en la bandeja de `tecnico@demo.mx`.

---

### `POST /api/v1/telemetry/iot` (nodo IoT / Wokwi)

Ingesta flexible del ESP32, pensada para la simulación de Wokwi (`backend/scripts/wokwi_esp32_client.ino`). **Sin `X-API-Key`**; el
header `X-Device-Key` es opcional (si el servidor define `DEVICE_KEY` y el header viene, debe coincidir → si no, 401; fuera de dev es obligatorio).

```json
{ "device_id": "B-01", "ph": 6.9, "turbidity": 180, "temperature": 22.4, "dissolved_oxygen": 5.8,
  "flow_rate": 12.5, "river_speed_ms": 0.9, "basket_fill_pct": 37, "battery_pct": 78, "rssi": -61, "pump_on": true }
```

- `device_id`: obligatorio. `B-01` es el alias de la boya `RM-01` (también acepta el código de la estación). Otro → 404.
- **Formato del firmware:** el mismo endpoint también acepta el mensaje que imprime/publica el ESP32 (`boya`, `ph`, `temp_c`, `turb_in_ntu`,
  `turb_out_ntu`, `eficiencia_pct`, `bat_v`, `bat_pct`, `gas_v`, `freno`, `bomba`, `alerta`) si trae `boya` en vez de `device_id`.
  Los alias `B-02` / `BM-02` / `RM-02` son la misma boya en todas las rutas (`/devices/{code}/…`, MQTT y este endpoint).
- **MQTT (lo que usa el sketch de Wokwi del repo):** con `MQTT_URL=mqtt://broker.hivemq.com:1883` en `backend/.env` el backend se suscribe a
  `riomonitor/+/telemetria`; el `+` es el código de la boya y el payload es el formato del firmware. Sin `MQTT_URL` el puente está apagado.
  El broker de HiveMQ es público: cualquiera que conozca el tópico puede publicar; úsalo solo para demos.
- Todo lo demás es opcional; los campos desconocidos se ignoran y un valor no numérico se descarta sin tumbar el paquete.
  `basket_fill_pct` y `battery_pct` se recortan a 0–100. También acepta `tds`, `battery_v`, `seq`, `ts`, `alarm_on`.
- Los valores de calidad (`ph`, `turbidity`→turbidez de entrada, `temperature`, `dissolved_oxygen`, `tds`) se guardan como lecturas
  del sensor de la estación (si no tiene ese sensor aparece en `unmapped`); el resto es estado del dispositivo.
- Respuesta 200: `{station_id, code, ts, readings, unmapped}`.
- Por `/ws/live` salen los eventos `reading` y un `device_telemetry` con `{code, battery_pct, river_speed_ms, flow_rate_lpm,
  basket_fill_pct, rssi_dbm, pump_on, …, values: {ph, turb_in_ntu, temp_c, do_mgl}}`.
- `GET /devices/{code}/telemetry/latest` devuelve esos mismos campos (más `values`) del último paquete.

## Visión artificial (fotos de reportes ciudadanos)

> ⚠️ Modelo zero-shot y reglas de color **de prototipo**, sin validar con fotos reales de campo. Úsalo como apoyo a la revisión humana, no como diagnóstico. Ver `backend/README.md` § Visión artificial.

### `POST /api/v1/vision/analyze`

Analiza **una foto** y devuelve qué muestra. **Abierto** (sin `X-API-Key`): los ciudadanos no tienen cuenta. Requiere `uv sync --extra vision` en el backend; sin él responde `503 vision_unavailable`.

**Request** — `multipart/form-data` con el campo `file` (JPEG, PNG o WebP, máx. `VISION_MAX_IMAGE_MB` = 2 MB; el cuerpo completo también pasa por `MAX_BODY_KB`):

```bash
curl -X POST http://localhost:8000/api/v1/vision/analyze -F "file=@foto.jpg;type=image/jpeg"
```

**Respuesta 200**

```json
{
  "category": "peces_muertos",
  "severity": "critica",
  "summary": "Peces muertos detectados: alerta ambiental crítica.",
  "reasons": ["El clasificador de escena ve peces muertos en el agua (100 %)."],
  "detections": [
    { "label": "dead fish", "label_es": "Pez muerto", "confidence": 0.62, "bbox": [10, 20, 200, 120] }
  ],
  "buoy": {
    "status": "no_detectada", "ring_found": false, "barrier_count": 0, "barrier_fragments": 0,
    "barrier_balance": 0.0, "cage_saturation": null
  },
  "scene": [
    { "label": "peces_muertos", "label_es": "Peces muertos", "probability": 1.0 },
    { "label": "pez_vivo", "label_es": "Pez vivo", "probability": 0.0 }
  ],
  "annotated_image": "data:image/jpeg;base64,/9j/4AAQ…",
  "image": { "width": 862, "height": 1280 },
  "model": "yolov8s-worldv2",
  "elapsed_ms": 312.4,
  "note": "Resultado de un modelo zero-shot (YOLO-World) y reglas de color de prototipo…"
}
```

- `category` / `severity`: ver Enumeraciones. Prioridad: `peces_muertos` (siempre `critica`) > `boya_defectuosa` (`alta`; `critica` si además la cesta está saturada) > `boya_saturada` (`alta` si la cesta está cubierta ≥ 50 %, si no `media`) > `acumulacion_basura` (`baja`/`media`/`alta` por nº de objetos y % de la imagen) > `normal` (`baja`).
- `detections[].bbox` = `[x1, y1, x2, y2]` en píxeles de la imagen **analizada** (`image`): la foto se reduce a un máximo de 1280 px por lado, así que el cliente debe usar `image.width/height` para escalar las cajas, o mostrar directamente `annotated_image`.
- `annotated_image` es un *data URL* JPEG con las cajas, las regiones de color de la boya, un banner con la categoría/severidad y la escena dominante. Se puede asignar tal cual a `<img [src]>`.
- `buoy`: verificación HSV (OpenCV) de la boya skimmer — anillo amarillo, barreras naranjas en «V» (esperadas: 2) y saturación de la cesta de malla (0–1, `null` si no se ve la cesta).
- `scene`: clasificador de escena CLIP (probabilidades que suman 1, de mayor a menor); `null` si está desactivado (`VISION_SCENE_ENABLED=false`).

**Errores:** `422 invalid_data` si el archivo está vacío, supera el máximo o no es una imagen legible; `422 validation_error` si falta `file`; `503 vision_unavailable` (ver tabla de errores).

La inferencia corre en CPU (~0.3 s por foto tras la primera; la primera tras arrancar tarda más) y se atiende de **una foto a la vez**, así que varias peticiones simultáneas se encolan.

---

## Cómo proponer un endpoint

1. **Back** abre un PR que **solo** modifica este archivo, con la ruta, el request, la respuesta y los errores.
2. **Front** revisa el PR. Si los nombres de campos y la forma de la respuesta le sirven, lo aprueba y se mergea.
3. A partir de ahí trabajan en paralelo:
   - **Front:** agrega la interfaz en `frontend/src/app/core/models/` y un mock en `core/mocks/`, y construye la pantalla con `useMocks: true`.
   - **Back:** implementa el dominio, el caso de uso, el adaptador y el router.
4. Cuando el endpoint ya está en `main`, Front prueba con `useMocks: false`.

Si algo del contrato tiene que cambiar después, se vuelve a pasar por el paso 1.
