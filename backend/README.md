# Backend — Río Monitor

API para monitorear y limpiar el agua de ríos (Hackatec Nacional 2026 · reto CAPCEE Puebla).
Recibe lecturas de sensores (simulados en Three.js o generados aquí). Calcula la calidad del agua, la salud de sensores, alertas tempranas y una proyección de pH, y lo sirve por REST y WebSocket al dashboard.

**Stack:** Python 3.12 · FastAPI · SQLAlchemy 2 async + asyncpg · PostgreSQL 16+ · Alembic · Redis pub/sub · Pydantic v2 · uv · ruff · pytest.

El contrato para el frontend está en [`../API.md`](../API.md) y la documentación interactiva en `http://localhost:8000/docs`.

## Arrancar

Requisitos: [uv](https://docs.astral.sh/uv/) y Docker (o Podman) para PostgreSQL y Redis. uv instala Python 3.12 solo.

### Opción A — todo en Docker

```bash
cp ../.env.example .env      # opcional: la API en Docker ya apunta a db/redis
make up                      # db + redis + api (migra sola) → http://localhost:8000/docs
make seed                    # 3 estaciones de Puebla, 36 sensores y 13 reglas
make simulate                # 24 h de histórico simulado (~15 s)
make live                    # emite en vivo por HTTP; descarga ácida demo a los 2 min
```

`make seed` y `make simulate` corren en tu máquina contra el Postgres del contenedor, así que necesitan `uv`.

### Opción B — API local con recarga

```bash
cp ../.env.example .env
make infra                   # solo PostgreSQL + Redis
uv sync                      # crea .venv con Python 3.12
make migrate seed simulate
make dev                     # uvicorn --reload en :8000
make live                    # en otra terminal
```

¿Sin Redis? Pon `REDIS_URL=` vacío y se usa un broker en memoria. Funciona igual, pero solo con un worker.

### Pruebas y lint

```bash
make test          # 48 unitarias + 29 de integración (Postgres real: endpoints, WebSocket, concurrencia)
make test-unit     # solo dominio, no necesita BD
make lint
```

Las pruebas de integración usan la BD `rio_test`: compose la crea al iniciar el volumen por primera vez. Recrean el esquema con `alembic upgrade head`, así que también validan las migraciones. Para otra BD usa `TEST_DATABASE_URL=postgresql+asyncpg://…`. Si no hay Postgres, se omiten.

Si tu volumen de Postgres es anterior a este cambio, crea la BD de pruebas a mano:

```bash
docker exec hackatec-db createdb -U hackatec rio_test
```

## Comandos (`make help`)

| Objetivo | Qué hace |
| --- | --- |
| `up` / `down` / `logs` | Stack completo en Docker |
| `infra` | Solo PostgreSQL y Redis |
| `dev` | API local con recarga |
| `migrate` | `alembic upgrade head` |
| `seed` / `reset` | Siembra idempotente / vacía y vuelve a sembrar |
| `simulate` | Histórico de `HOURS` horas (default 24): `make simulate HOURS=72`. Correrlo dos veces duplica ciclos, lotes y basura: para regenerar usa `make reset simulate` |
| `live` | Emite en vivo por HTTP contra `localhost:8000` |
| `test` / `test-unit` / `lint` / `format` | Calidad |

`scripts/simulate.py` acepta más opciones: `--hours`, `--live`, `--interval`, `--spike-in` (minutos hasta la descarga ácida; `-1` = ninguna), `--base-url`, `--api-key` y `--seed`.

## Variables de entorno

Plantilla completa en [`../.env.example`](../.env.example). Se leen de `backend/.env` o del entorno.

| Variable | Default | Para qué |
| --- | --- | --- |
| `ENVIRONMENT` | `development` | `dev`/`development`/`local`/`test` dejan el WebSocket abierto; con otro valor exige `?api_key=` |
| `DATABASE_URL` | `postgresql+asyncpg://hackatec:hackatec@localhost:5432/hackatec` | PostgreSQL |
| `REDIS_URL` | `redis://localhost:6379/0` | Pub/sub del tiempo real. Vacío = broker en memoria |
| `CORS_ORIGINS` | `http://localhost:4200` | Orígenes permitidos, separados por coma |
| `INGEST_API_KEY` | `dev-ingest-key` | Header `X-API-Key` de la ingesta. **Cámbiala** |
| `LOG_LEVEL` / `LOG_JSON` | `INFO` / `true` | Logs estructurados (una línea JSON por evento, con `request_id`) |
| `SENSOR_OFFLINE_AFTER_MIN` | `10` | Minutos sin reportar para marcar `offline` |
| `SENSOR_DEGRADED_QUALITY` | `0.6` | Calidad promedio mínima antes de `degraded` |
| `SENSOR_STUCK_WINDOW` | `10` | Lecturas idénticas seguidas que marcan `fault` |
| `HEALTH_SWEEP_INTERVAL_S` | `60` | Cada cuánto se revisan sensores silenciosos |
| `ALERT_RENOTIFY_AFTER_MIN` | `15` | Re-emitir por WS una alerta activa que vuelve a dispararse |
| `WS_PING_INTERVAL_S` | `20` | Ping del servidor por WebSocket |
| `JWT_SECRET` / `JWT_EXPIRES_MIN` | valor de dev / `720` | Sesiones del personal (HS256, ≥ 32 bytes). Fuera de dev la API no arranca con el valor por defecto |
| `MEDIA_DIR` / `MAX_PHOTO_KB` | `media` / `300` | Fotos de reportes y evidencias (servidas en `/media`) |
| `REPORT_RATE_LIMIT` / `REPORT_RATE_WINDOW_MIN` | `5` / `10` | Reportes ciudadanos por IP (compartido entre workers vía Redis) |
| `REPORT_STATION_RADIUS_KM` | `8` | Radio para vincular un reporte con la estación más cercana |
| `LOGIN_RATE_LIMIT` / `LOGIN_RATE_WINDOW_MIN` | `10` / `10` | Intentos de login por IP y por correo |
| `MAX_BODY_KB` | `2048` | Tope del cuerpo de cualquier petición (413 antes de parsear) |
| `MQTT_URL` | vacío | Broker de la telemetría de las boyas (`mqtt://host:1883`, `mqtts://user:pass@host:8883`). Vacío = puente MQTT apagado |
| `MQTT_TOPIC` / `MQTT_SHARED_GROUP` | `riomonitor/+/telemetria` / vacío | Tópico (el `+` es el `code` de la estación) y grupo de suscripción compartida. Vacío = suscripción normal (1 worker); con varios workers pon un grupo propio, nunca uno que otro backend use en el mismo broker |
| `SIMULATION_ENABLED` | `false` | Simulador en vivo dentro de la API (sin script aparte) |
| `SIMULATION_INTERVAL_S` / `SIMULATION_SEED` | `5` / `42` | Ritmo y semilla del simulador |
| `MAX_READINGS_PER_REQUEST` / `MAX_RANGE_DAYS` / `MAX_BUCKETS` | `1000` / `90` / `5000` | Límites de consultas |
| `VISION_ENABLED` | `true` | Activa `POST /api/v1/vision/analyze` (requiere `uv sync --extra vision`) |
| `VISION_MODEL` / `VISION_MODELS_DIR` | `yolov8s-worldv2.pt` / `models` | Pesos de YOLO-World; se descargan solos la primera vez (~25 MB) |
| `VISION_CONF` / `VISION_IMGSZ` | `0.15` / `640` | Umbral del detector y resolución de inferencia |
| `VISION_MAX_IMAGE_MB` | `2` | Tamaño máximo de la foto (la petición completa también pasa por `MAX_BODY_KB`) |
| `VISION_SCENE_ENABLED` | `true` | Clasificador de escena CLIP que complementa al detector |
| `VISION_PRELOAD` | `false` | Cargar los modelos al arrancar (~12 s, ~1.5 GB de RAM) en vez de en la primera foto |
| `WEB_CONCURRENCY` | `2` | Workers de uvicorn en Docker |

## Visión artificial (fotos de reportes ciudadanos)

`POST /api/v1/vision/analyze` (ver [`../API.md`](../API.md)) analiza la foto de un reporte y devuelve categoría
(`peces_muertos`, `boya_defectuosa`, `boya_saturada`, `acumulacion_basura`, `normal`), severidad, detecciones con
confianza y la imagen anotada.

```bash
uv sync --extra vision        # ultralytics + PyTorch (solo CPU en Linux) + OpenCV headless + CLIP (~1.7 GB)
make dev                      # los pesos de YOLO-World se descargan solos la primera vez
```

Sin el extra, la API arranca igual y el endpoint responde `503 vision_unavailable`. La foto se limita a `VISION_MAX_IMAGE_MB` (2 MB) y la petición completa a `MAX_BODY_KB`; si subes uno, sube el otro.

**Cómo funciona** (tres señales que se combinan en reglas puras del dominio, `app/domain/vision.py`):

1. **YOLO-World** (`yolov8s-worldv2.pt`, zero-shot) con los prompts `dead fish`, `floating trash`, `plastic bottle`,
   `plastic waste`, `floating buoy`, `orange floating barrier`, `wire mesh cage` → cajas con confianza.
2. **Verificación HSV (OpenCV)** de la boya skimmer: anillo amarillo, barreras naranjas en «V» (se parte la máscara por
   el eje de la boya; esperadas 2) y fragmentos sueltos → íntegra / defectuosa. La cesta se considera saturada cuando
   los residuos detectados cubren ≥ 25 % de su área (≥ 50 % → severidad alta).
3. **Clasificador de escena CLIP** (ViT-B/32, mismos pesos que usa YOLO-World): probabilidad de «peces muertos», «pez
   vivo», «basura», «boya»… Es una **adición** a lo pedido originalmente, ver abajo por qué.

Estructura: reglas en `app/domain/vision.py` (sin torch/OpenCV, con pruebas en `tests/unit/test_vision.py`), puerto
`VisionEngine` en `ports.py`, caso de uso `application/services/vision.py` y adaptadores en
`adapters/outbound/vision/` (`yolo_world.py`, `buoy_color.py`, `clip_scene.py`, `annotator.py`, `engine.py`). Los
adaptadores importan `ultralytics`/`cv2` de forma diferida. La inferencia corre en un hilo (no bloquea el event loop) y
se atiende de a una foto.

### ⚠️ Qué tan fiable es (valores de prototipo)

Se probó con **muy pocas fotos** (5 reales de Wikimedia Commons + 4 boyas dibujadas a mano), así que son indicios, no
métricas:

| Señal | Resultado observado |
| --- | --- |
| YOLO-World `s` con los 7 prompts | **No detectó** ninguna de las 2 mortandades de peces ni la botella flotando (confianza 0.03–0.07 frente al umbral 0.25), pero sí dio 0.46–0.66 a un casco de barco / a un calamar *vivo* como `dead fish`. Un modelo más grande (`x`) o más resolución (1280 px) **no lo arregló**. |
| CLIP (escena) | Acertó las 2 mortandades (0.98, 1.00), la botella (`basura` 0.69) y descartó el calamar vivo (`pez_vivo` 0.89). Dio 0.84 a la foto de un casco con basura: queda justo bajo el umbral de 0.90. |
| HSV de la boya | Distingue boya íntegra / una barrera / sin barreras / barrera despedazada **en imágenes sintéticas**. No se ha probado con fotos reales de la boya; el color depende mucho de la luz. |
| Cesta saturada | La lógica está probada (pruebas unitarias), pero depende de que YOLO-World localice la cesta y los residuos, y con estos prompts casi no lo hace. |

Por eso CLIP arbitra «vivo vs. muerto» (el detector no puede) y confirma peces muertos o basura cuando no hay cajas.
Los umbrales (`VisionPolicy`: 0.90 peces, 0.60 basura, 0.50 boya, 25 %/50 % cesta, 3/8 objetos…) son de prototipo.

**Para mejorar de verdad:** juntar fotos reales de la boya y del río (con peces muertos, basura y cesta llena/vacía),
medir precisión/recall con ellas y, si hace falta, ajustar `VisionPolicy` o afinar un detector (`ia/` está fuera de
alcance por ahora, decisión del equipo).

## Arquitectura (hexagonal pragmática)

```
app/
├── domain/                 # Reglas puras: sin FastAPI, SQLAlchemy ni Redis
│   ├── entities.py         # Station, Sensor, Reading, CentrifugeCycle, TreatmentBatch, WasteCollection, AlertRule, Alert
│   ├── wqi.py              # Índice de calidad del agua (curvas por tramos + promedio ponderado)
│   ├── treatment.py        # Eficiencia y mejora de pH/turbidez
│   ├── sensor_health.py    # ok | degraded | fault | offline
│   ├── alerting.py         # Evaluación de reglas → alertas candidatas
│   ├── forecast.py         # Regresión lineal con banda de residuos
│   ├── parameters.py       # Unidades y límites físicos por tipo de sensor
│   └── defaults.py         # Reglas por defecto con su criterio documentado
├── application/
│   ├── ports.py            # Protocols: repositorios, UnitOfWork, EventPublisher/Subscriber, AnalyticsReader
│   ├── services/           # Casos de uso: ingestion, operations, catalog, alerts, monitoring, analytics
│   ├── events.py           # Eventos de tiempo real (sobre JSON único)
│   └── read_models.py      # DTOs del dashboard (lado de lectura)
├── adapters/
│   ├── inbound/http/       # Routers, schemas Pydantic, dependencias, errores
│   ├── inbound/websocket/  # /ws/live + gestor de conexiones por worker
│   ├── outbound/persistence/  # ORM, repositorios, UnitOfWork, SQL analítico (date_bin)
│   ├── outbound/messaging/    # RedisBroker / InMemoryBroker
│   └── outbound/simulation/   # Generador determinista, sinks (HTTP / casos de uso) y runner
├── config/                 # settings, logging, container.py (composition root)
└── main.py                 # create_app(): middleware, routers, lifespan
migrations/                 # Alembic (async)
scripts/                    # seed.py, simulate.py
tests/unit, tests/integration
```

**Reglas de dependencia:** `domain` no importa nada externo. `application` depende solo de `domain` y de sus puertos. Los adaptadores implementan los puertos. [`config/container.py`](app/config/container.py) es el único lugar que los conecta. Los routers solo traducen HTTP ↔ casos de uso.

**Flujo de escritura** (ej. `POST /readings`): router → `IngestionService` → `UnitOfWork` (una transacción) → reglas del dominio (calibración, salud, alertas) → commit → `EventPublisher` (Redis) → cada worker reenvía a sus clientes WS.

**Flujo de lectura** (`GET /analytics/*`): router → `AnalyticsService` → `SqlAnalyticsReader`. Las agregaciones se hacen en SQL (`date_bin`, `FILTER`, `LATERAL`) y los DTOs salen directo, sin mappers ORM ↔ dominio. Python solo aplica WQI y proyección sobre los resultados agregados.

**Tareas de fondo** (lifespan, se cancelan limpiamente al apagar, compatible con `--reload`):
- reenvío de eventos Redis → WebSocket (una por worker);
- barrido de salud de sensores cada 60 s (detecta silencios y abre la alerta `Sensor sin señal`);
- simulador en vivo si `SIMULATION_ENABLED=true`;
- puente MQTT de telemetría de las boyas si `MQTT_URL` tiene valor (reconecta solo, con backoff hasta 30 s).

El simulador solo alimenta estaciones **sin** `code`; las que tienen `code` (boyas RM-01 y RM-02 del seed) las alimenta su ESP32 por MQTT. Con varios workers, el barrido y el simulador toman un lock en Redis (`SET NX EX`) para que solo corra uno. El puente MQTT corre en cada worker; con varios workers define `MQTT_SHARED_GROUP` (suscripción compartida `$share/<grupo>/…`) para que el broker entregue cada mensaje a uno solo. Con un solo worker déjalo vacío: en un broker público, otro backend con el mismo grupo se llevaría parte de los mensajes.

## Modelo de datos

Todas las tablas usan `id` UUID y fechas `timestamptz` en UTC. Todas tienen `created_at`/`updated_at`, salvo `readings` (ver decisiones). Esquema en [`migrations/versions/`](migrations/versions/).

| Tabla | Campos clave | Índices / restricciones |
| --- | --- | --- |
| `stations` | name (único), **code** (único, ej. `RM-01`), river, latitude, longitude, status, installed_at, description | `river` |
| `sensors` | station_id, type, location, unit, valid_min/max, status, last_seen_at, calibration_offset/factor, calibrated_at, model | `station_id` |
| `readings` | sensor_id, station_id, ts, value, quality (0–1) | **único (sensor_id, ts DESC)** · (station_id, ts) · **BRIN(ts)** · CHECK quality |
| `centrifuge_cycles` | station_id, started_at, ended_at, status, rpm_avg/max, vibration_mm_s, power_w, water_in_l, water_out_clean_l, sludge_kg, failure_reason | (station_id, started_at) |
| `treatment_batches` | station_id, cycle_id, **ts**, volume_in_l, volume_clean_l, **sludge_kg**, ph_in/out, turbidity_in/out_ntu, efficiency_pct | (station_id, ts) · cycle_id |
| `device_telemetry` | station_id, ts, seq, battery_v/pct, river_speed_ms, generator_w/v, pump_on, brake_on, alarm_on, device_efficiency_pct, flow_rate_lpm, basket_fill_pct, rssi_dbm, signal_csq, gas_v, pump_current_a, water_liters_total, pump_cycles, tilt_deg, shock, values | (station_id, ts DESC) |
| `waste_collections` | station_id, ts, weight_kg, items_count, waste_type, collector_id | (station_id, ts) |
| `alert_rules` | name, kind, severity, parameter, location, station_id (null = todas), min_value, max_value, enabled, description | station_id |
| `tasks` | title, kind, description, priority, status, assigned_to → users, station_id, buoy_code, closing_note, resolved_at, resolved_by → users | (status, priority) · (assigned_to, status) |
| `skimmer_collections` | station_id, ts, buoy_code, buoy_condition, materials (JSONB por material: kg y piezas), total_kg, total_pieces, operator_id → users, operator_name, notes, task_id → tasks | (station_id, ts) |
| `alerts` | rule_id, station_id, sensor_id, subject_key, kind, parameter, severity, status, message, trigger_value, thresholds, first/last_triggered_at, occurrences, last_notified_at, acknowledged_at, resolved_at, note | **único parcial (rule_id, subject_key) WHERE status IN (open, acknowledged)** · (station_id, status) · last_triggered_at |

## Reglas del dominio (valores de prototipo, configurables)

> Nada de esto está validado científicamente para los ríos de Puebla. Son puntos de partida explicables, pensados para ajustarse con datos reales y especialistas.

- **WQI 0–100** ([`wqi.py`](app/domain/wqi.py)): cada parámetro se convierte en un sub-índice 0–100 con una curva lineal por tramos. El índice es el promedio ponderado de esos sub-índices (pH 25 %, turbidez 25 %, OD 25 %, temperatura 10 %, conductividad 10 %, SDT 5 %). Los pesos se re-normalizan si falta algún parámetro. Categorías: ≥ 90 excelente, ≥ 70 buena, ≥ 50 regular, ≥ 25 mala, < 25 crítica. La respuesta incluye cada componente para explicar el puntaje. La forma está inspirada en NSF-WQI y CCME-WQI, sin calibrar.
- **Eficiencia** ([`treatment.py`](app/domain/treatment.py)): `volume_clean_l / volume_in_l · 100`. La mejora de pH es `|pH_in − 7| − |pH_out − 7|`. La remoción de turbidez es `(in − out) / in · 100`.
- **Salud de sensor** ([`sensor_health.py`](app/domain/sensor_health.py)), en orden de precedencia:
  - `offline`: sin reportar en más de N min.
  - `fault`: algún valor físicamente imposible, o N lecturas idénticas seguidas.
  - `degraded`: calidad promedio < 0.6 o valores fuera del rango válido del sensor.
  - `ok`: ninguno de los anteriores.
- **Alertas** ([`alerting.py`](app/domain/alerting.py) + [`defaults.py`](app/domain/defaults.py)): se evalúan al ingerir lecturas, al reportar ciclos y lotes, y en el barrido periódico. Las 13 reglas por defecto y su criterio:

| Regla | Severidad | Umbral | Criterio |
| --- | --- | --- | --- |
| pH fuera del rango aceptable | warning | 6.5–8.5 | Rango usual en guías de agua (NOM-127-SSA1, guías secundarias EPA) |
| pH extremo | critical | 5.5–9.5 | ±1 unidad fuera del rango: posible descarga |
| Turbidez alta en entrada | warning | > 100 NTU | Pico respecto a la línea base esperada |
| Turbidez alta a la salida | warning | > 5 NTU | Orden de magnitud de normas de agua de consumo |
| Oxígeno disuelto bajo / Hipoxia | warning / critical | < 5 / < 2 mg/L | Estrés de vida acuática / definición usual de hipoxia |
| Temperatura anómala | info | 10–30 °C | Rango plausible del altiplano |
| Conductividad alta | warning | > 1500 µS/cm | Sales/descargas; ajustar por río |
| SDT altos | warning | > 1000 mg/L | Orden de magnitud de normas de consumo |
| Sensor sin señal | warning | > 10 min | — |
| Vibración elevada / peligrosa | warning / critical | > 4.5 / > 7.1 mm/s | Inspirado en zonas de severidad ISO 10816 |
| Eficiencia baja | warning | < 70 % | Revisar filtros |

  Se editan en vivo con `PATCH /api/v1/alert-rules/{id}`, sin reiniciar.
- **Índice de criticidad** ([`criticality.py`](app/domain/criticality.py)): ordena los puntos críticos de contaminación.
  - Fórmula: `0.5·(100 − WQI) + 0.3·presión de alertas activas + 0.2·recurrencia en el periodo` (log, satura en 200 repeticiones).
  - Niveles: crítico ≥ 50, atención ≥ 30, estable.
  - Solo cuentan las alertas de calidad del agua.
  - El endpoint `/analytics/critical-points` devuelve además los motivos en español.
- **Proyección** ([`forecast.py`](app/domain/forecast.py)): regresión lineal sobre promedios de 15 min de las últimas N horas, con una banda de ±1.96·σ de los residuos. Es el primer paso hacia el modelo predictivo del reto.

## Simulador

El generador ([`generator.py`](app/adapters/outbound/simulation/generator.py)) es determinista en función de (semilla, sensor, instante), así que el histórico y el modo en vivo producen la misma serie. Escenario demo, relativo a "ahora":

| Estación | Qué muestra |
| --- | --- |
| Río Atoyac — Parque Lineal / Echeverría (19.0185, −98.2435) | Descarga ácida hace ~3 h (pH entrada ≈ 5.1 → **alerta crítica**; salida ≈ 6.7). Tormenta con turbidez alta hace ~14 h |
| Río Alseseca — La Hacienda / Xilotzingo (18.9950, −98.1880) | Pico alcalino (pH ≈ 9.7) hace ~9 h. Turbidez de salida con **sensor degradado**. Un ciclo que **falla por vibración** |
| Presa de Valsequillo — Oasis / Embarcadero (18.9180, −98.1550) | Hipoxia hace ~5 h. Turbidez del río **offline** los últimos 45 min |

La eficiencia de agua recuperada ronda 86–95 %. En `--live`, a los 2 min se programa una descarga ácida en Atoyac de 10 min para ver la alerta llegar en tiempo real. Las líneas base son ilustrativas, no mediciones reales.

### Emulador de la boya ESP32

No hay boya física: el firmware ([`firmware/boya-rm01/`](../firmware/boya-rm01/README.md)) corre en Wokwi. Wokwi en línea solo da WiFi a una simulación a la vez. Para tener las dos boyas en vivo, una corre en Wokwi y la otra con [`scripts/buoy.py`](scripts/buoy.py), que publica por MQTT las mismas claves que el firmware (incluidas `ph_out`, caudal, cesta, corriente de la bomba, inclinación y señal), con sus mismas reglas de bomba, freno y alerta, y el filtrado del modelo 3D (sin bomba no se filtra; la calcita solo sube el pH ácido):

```bash
make boya                                  # RM-01, agua contaminada, cada 15 s
make boya CODE=RM-02 SCENARIO=limpia       # escenarios: contaminada | limpia | bateria-baja
```

Usa el broker de `MQTT_URL`. Los valores son simulados.

## Ejemplos curl

```bash
KEY=dev-ingest-key; API=http://localhost:8000/api/v1
SENSOR=$(curl -s "$API/sensors?type=ph&location=inlet&limit=1" | jq -r '.items[0].id')
STATION=$(curl -s "$API/stations?limit=1" | jq -r '.items[0].id')

# Ingesta
curl -s -X POST $API/readings -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"readings\":[{\"sensor_id\":\"$SENSOR\",\"ts\":\"$(date -u +%FT%TZ)\",\"value\":5.2,\"quality\":0.95}]}"
CYCLE=$(curl -s -X POST $API/centrifuge-cycles -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"station_id\":\"$STATION\",\"rpm_avg\":2800}" | jq -r .id)
curl -s -X PATCH $API/centrifuge-cycles/$CYCLE -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"status":"completed","water_in_l":520,"water_out_clean_l":468,"sludge_kg":3.4}'
curl -s -X POST $API/treatment-batches -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"station_id\":\"$STATION\",\"cycle_id\":\"$CYCLE\",\"volume_in_l\":520,\"volume_clean_l\":468,\"ph_in\":5.6,\"ph_out\":6.9}"
curl -s -X POST $API/waste-collections -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"station_id\":\"$STATION\",\"weight_kg\":1.2,\"items_count\":9,\"waste_type\":\"plastic\"}"

# Telemetría de la boya (lo mismo que publica el ESP32 por MQTT)
curl -s -X POST $API/devices/RM-01/telemetry -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"boya":"RM-01","n":1,"ph":6.7,"ph_out":6.8,"tds_ppm":690,"temp_c":19.4,"turb_in_ntu":82,"turb_out_ntu":22,"bat_pct":80,"bomba":true,"caudal_lpm":2.5,"bomba_a":0.4}'
curl -s $API/devices/RM-01/telemetry/latest | jq
mosquitto_pub -h localhost -t riomonitor/RM-01/telemetria -m '{"ph":7.1,"turb_in_ntu":150,"turb_out_ntu":9}'

# Dashboard
curl -s "$API/dashboard/overview?station_id=$STATION" | jq
curl -s "$API/analytics/ph?station_id=$STATION&bucket=1h&from=$(date -u -d '-12 hours' +%FT%TZ)" | jq
curl -s "$API/analytics/sensors/health" | jq '.[] | {station_name, type, location, status, uptime_pct}'
curl -s "$API/analytics/forecast/ph?station_id=$STATION&horizon=6" | jq '.points'
curl -s "$API/analytics/hotspots" | jq '.[] | {name, wqi: .wqi.score, alerts_critical_open}'
curl -s "$API/alerts?status=open&severity=critical" | jq '.items[].message'

# Tiempo real (cualquier cliente WS, p. ej. websocat)
websocat "ws://localhost:8000/ws/live?station_id=$STATION"
```

## Decisiones y supuestos

- **Reemplaza al borrador anterior** (SQLModel + `create_all`). El esquema ahora vive en migraciones Alembic. Los endpoints de ejemplo `/items` desaparecen, pero `GET /health` sigue en la raíz con `{"status": "ok", …}` para no romper al frontend.
- **Contrato en `API.md`** (raíz) y no en `docs/api-contract.md`, porque es la convención del equipo: una sola fuente.
- **`readings` sin `updated_at`**: las lecturas son inmutables, y en la tabla más grande cada columna cuenta. El índice único `(sensor_id, ts DESC)` hace dos cosas: da idempotencia (`ON CONFLICT DO NOTHING`) y resuelve la "última lectura" de cada sensor. BRIN(ts) cubre los rangos de tiempo a bajo costo.
- **`readings.station_id` desnormalizado** para filtrar por estación sin JOIN.
- **`treatment_batches.ts` y `sludge_kg` agregados**: el lote es la unidad del balance de agua y necesita fecha para las series. Los campos de agua de `centrifuge_cycles` quedan como telemetría de la máquina.
- **`alerts.subject_key` + índice único parcial**: el anti-spam lo garantiza Postgres (`INSERT … ON CONFLICT … DO UPDATE`), sin carreras entre workers. `last_notified_at` permite re-emitir una alerta que sigue activa y vuelve a dispararse tras 15 min, sin duplicar filas.
- **Enums como VARCHAR sin CHECK**: agregar un tipo de sensor o de residuo no requiere migración.
- **Valores imposibles se rechazan; fuera de rango se aceptan**: una lectura de pH 11 en un sensor configurado para 4–10 es dato (y marca el sensor `degraded`). Un pH 17 es basura.
- **Calibración en ingesta**: se guarda el valor ya calibrado; cambiar la calibración no reescribe el histórico.
- **Sin auto-resolución de alertas**: las resuelve un operador. Así se evita que una alerta "parpadee" cuando el valor oscila cerca del umbral.
- **Lecturas y `PATCH /alerts` sin llave**: no hay usuarios finales todavía (fuera de alcance). Las escrituras de ingesta, catálogo y reglas sí la piden.
- **Tiempo real best-effort**: si Redis cae, la ingesta sigue funcionando y solo se pierde el aviso en vivo. Los eventos no se re-entregan, así que el cliente refresca con REST al reconectar. El barrido de salud sigue corriendo sin el lock (es idempotente). El simulador interno se pausa hasta que Redis vuelva.
- **Orden fijo de locks**: cada transacción de ingesta escribe lecturas → alertas → sensores, cada grupo ordenado por su clave. El barrido periódico sigue el mismo orden. Así dos lotes concurrentes sobre los mismos sensores no se bloquean entre sí (hay un test de regresión). `last_seen_at` se actualiza con `GREATEST`, así que nunca retrocede.
- **Llave por defecto solo en dev**: con `ENVIRONMENT` distinto de `dev`/`development`/`local`/`test`, la API no arranca si `INGEST_API_KEY` sigue siendo `dev-ingest-key`.
- **Simulador interno por worker**: con varios workers, si el lock cambia de dueño (p. ej. Redis se reinicia), el nuevo líder empieza sus propios ciclos y el ciclo abierto del anterior puede quedar en `running`. Solo afecta la demo.
- **WQI sobre el último valor de cada parámetro**, excluyendo sensores en `fault`. Si hay sonda de río y de entrada, se promedian.
- **Buckets en UTC.** Puebla está en UTC−6, así que un bucket `1d` va de 18:00 a 18:00 hora local. Un parámetro `tz` sería la siguiente mejora.
- **Lado de lectura con DTOs directos** (`read_models.py`, Pydantic) en vez de pasar por entidades de dominio. Es una concesión pragmática documentada en los puertos.

### Operaciones (personal, reportes ciudadanos, órdenes de trabajo)

- **Reglas puras:** transiciones, permisos del técnico, checklist, validación de cierre, cascada al reporte, estación más cercana y folios, en [`domain/operations.py`](app/domain/operations.py), con pruebas en `tests/unit/test_operations.py`.
- **Casos de uso:** `staff.py`, `citizen_reports.py` y `work_orders.py` en `application/services/`.
- **Adaptadores nuevos:**
  - contraseñas con **argon2id** (`security/passwords.py`) y tokens **JWT HS256** (`security/tokens.py`);
  - fotos en disco (`media/storage.py`, servidas en `/media`);
  - límite por IP con Redis o en memoria (`messaging/rate_limit.py`).
- **Folios:** `RC-0001` / `OT-0001` salen de dos `SEQUENCE` de Postgres, así que no se repiten aunque haya varios workers.
- **Fotos:** se guardan como archivo. Se devuelven como URL absoluta con el host de la petición (funciona en LAN y en el celular). En los eventos WebSocket la foto va `null`.
- **Diferencia con el mock del front:** una orden `done` con `confirmed: false` deja el reporte en `rejected` también después de verificarse (el mock lo regresaba a `resolved`).
- **Endurecimiento tras la revisión de código:**
  - las órdenes cerradas no se editan;
  - la cascada solo responde a cambios de estado;
  - login con límite de intentos, argon2 fuera del event loop y verificación contra un hash ficticio (tiempo constante);
  - tope de 2 MB por petición;
  - sin `NaN`/`Infinity`;
  - el límite de Redis es atómico.
- **Bandeja del operador y boyas skimmer:** `/tasks` es una bandeja ligera (sin checklist ni evidencias, a diferencia de las órdenes de trabajo) con pestañas `asignadas`, `reparaciones_pendientes`, `urgentes` y `listos`. `POST /skimmers/recoleccion` guarda el pesaje por material y además registra una `waste_collection` por material, así que la tarjeta «Clasificación de basura» del dashboard la ve sin consultas nuevas. Reglas en [`domain/field_ops.py`](app/domain/field_ops.py) y caso de uso `field_ops.py`; usan las mismas cuentas y roles de `staff.py`.
- **Efectos sobre estaciones, sensores y basura:** los sigue disparando el front. Esos 4 endpoints aceptan la `X-API-Key` o el Bearer del personal, para que la llave de ingesta no viaje en el teléfono.

## Próximos pasos sugeridos

- Proyección de WQI (hoy solo pH) y modelos estacionales con más historia.
- Particionar `readings` por mes, o usar TimescaleDB, cuando crezca.
- Usuarios y roles para el dashboard. Llaves de ingesta por dispositivo.
- Parámetro de zona horaria en las series.
