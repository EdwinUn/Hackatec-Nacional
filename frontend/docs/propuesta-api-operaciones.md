# Propuesta de API: módulo de operaciones (login, reportes ciudadanos, órdenes de trabajo)

Propuesta de **Front** para **Back**, según "Cómo proponer un endpoint" de `API.md`. Cualquier cambio de nombres o de forma lo ajusto en el front.

El front ya funciona con estos contratos usando un mock local (`opsMocks: true` por defecto). Cuando los endpoints estén en `main`, basta con poner `opsMocks: false` en los environments.

**Referencias en el repo**

| Qué | Dónde |
| --- | --- |
| Modelos TypeScript (forma exacta de cada objeto) | `frontend/src/app/core/models/ops.models.ts` |
| Cliente HTTP (rutas, query params, cuerpos) | `frontend/src/app/core/api/http-ops-api.ts` |
| Reglas que hoy aplica el mock (transiciones, cascada, estación más cercana) | `frontend/src/app/core/mock/mock-ops-api.ts` |
| Checklists por tipo y efectos sobre la estación | `frontend/src/app/shared/utils/ops.util.ts` |
| Efectos secundarios sobre endpoints existentes | `frontend/src/app/core/services/work-orders.service.ts` |

## Cómo empezar (checklist para Back)

1. Abrir un PR **solo** con `API.md` que incorpore las secciones 1 a 5 de este documento (regla del repo: el contrato va antes del código). Front lo revisa.
2. Migración Alembic con las tablas de la sección 8 (`uv run alembic revision --autogenerate -m "operaciones"` desde `backend/`; revisar el archivo y luego `make migrate`).
3. Dominio en `app/domain/` (transiciones y cascada son reglas puras, con pruebas en `tests/unit/`), casos de uso en `app/application/services/`, puertos en `app/application/ports.py`, adaptadores en `app/adapters/`, y todo conectado en `app/config/container.py` (Integración) más el `include_router` en `app/main.py`.
4. Seed con las cuentas de la sección 9 (solo si `ENVIRONMENT` es de desarrollo).
5. Avisar a Front para poner `opsMocks: false`.

## Decisiones ya tomadas (si algo no te sirve, dímelo y lo ajusto)

| Tema | Decisión |
| --- | --- |
| Formato de las listas | `GET /users`, `/citizen-reports` y `/work-orders` devuelven un **arreglo simple**, no el sobre `{items, total, …}` de `API.md`. Es una excepción deliberada: el volumen del prototipo es chico. Tope de 500 filas, orden indicado en cada endpoint. |
| Quién ejecuta los efectos sobre estaciones, basura y sensores | **El front**, por ahora (sección 4.4). Back solo tiene que aceptar también el Bearer del personal en esos 4 endpoints. |
| `GET /citizen-reports` | **Público** (lo usan el mapa y "reportes de la comunidad", incluso sin sesión). |
| Errores | Mismo formato único de `API.md` (`{ "error": { code, message, details } }`). Los códigos nuevos están en la sección 6. |

---

## 1. Autenticación

Roles: `technician` (técnico de campo), `supervisor`, `admin`. Los ciudadanos **no** tienen cuenta.

### `POST /api/v1/auth/login`

```json
{ "email": "tecnico@demo.mx", "password": "demo123" }
```

**200**
```json
{
  "access_token": "<JWT>", "token_type": "bearer", "expires_in": 43200,
  "user": { "id": "…", "name": "Luis Hernández", "email": "tecnico@demo.mx", "role": "technician", "active": true }
}
```

**Errores:** 401 `invalid_credentials`; 403 `inactive` (cuenta desactivada). Mismo 401 si el correo no existe (no revelar cuál falló). El correo se compara sin distinguir mayúsculas.

- **JWT:** firmado con HS256; claims mínimos `sub` (id del usuario), `role`, `exp`. `expires_in` en segundos (12 h = 43200). Clave en `JWT_SECRET` (`backend/.env`), con la misma lógica que `INGEST_API_KEY`: valor por defecto solo en `ENVIRONMENT` de desarrollo y error al arrancar si no se cambia fuera de él. La plantilla `.env.example` es de Integración: pídeles agregar `JWT_SECRET` y `JWT_EXPIRES_MIN=720`.
- **Contraseñas:** guardar solo el hash (argon2 o bcrypt); nunca devolverlas ni registrarlas en logs.
- **Cómo lo manda el front:** `Authorization: Bearer <token>` en todas las peticiones a `/api/v1` mientras hay sesión. Si un endpoint de operaciones (`/users`, `/citizen-reports`, `/work-orders`) responde **401**, cierra la sesión y manda a `/login`. Por eso un token vencido o inválido debe dar **401** y un rol insuficiente **403** (el 403 no cierra la sesión).
- Cada petición con Bearer debe validar que el usuario siga `active`; si se desactiva, su token deja de servir (401).
- `GET /auth/me` **no** hace falta (el login ya devuelve el usuario).

## 2. Usuarios (solo `admin`)

| Método | Ruta | Cuerpo / respuesta |
| --- | --- | --- |
| GET | `/api/v1/users` | `User[]`, ordenados por nombre |
| POST | `/api/v1/users` | `{ name, email, role, password }` → 201 `User` (409 `conflict` si el correo existe). Contraseña mínima de 6 caracteres (criterio de prototipo). |
| PATCH | `/api/v1/users/{id}` | `{ name?, role?, active? }` → `User`. Un admin no puede desactivarse ni quitarse el rol a sí mismo (409 `conflict`). |

`User` = `{ id, name, email, role, active }` (nunca incluye la contraseña ni el hash).

## 3. Reportes ciudadanos

```json
{
  "id": "…", "folio": "RC-0042", "type": "discharge",
  "description": "Tubo descargando agua gris con espuma", "photo": "data:image/jpeg;base64,…",
  "latitude": 19.051, "longitude": -98.251, "accuracy": 12,
  "status": "new", "station_id": "…", "work_order_id": null, "public_note": null,
  "created_at": "…", "updated_at": "…"
}
```

- `type` ∈ `trash | discharge | odor | foam | dead_fish | other`
- `status` ∈ `new | verified | in_progress | resolved | rejected`
- `accuracy`: metros, opcional (`null` si el GPS no lo da).
- `photo`: el front manda un JPEG comprimido (lado mayor ≤ 1024 px, calidad 0.7, normalmente 60–120 KB) como data URL. Puedes guardarlo como archivo y devolver una URL (el front acepta `data:image/…` y `http(s)://`; ver sección 7).
- `station_id`: estación más cercana a 8 km o menos (distancia haversine; criterio de prototipo); `null` si no hay ninguna. Lo calcula el servidor, el cliente no lo manda.
- `work_order_id`: lo llena el servidor al crear una orden con `citizen_report_id` (sección 4). **Solo lectura**: el `PATCH` lo ignora (el modelo TypeScript `ReportPatch` lo trae por herencia, pero el front nunca lo envía).

| Método | Ruta | Acceso | Notas |
| --- | --- | --- | --- |
| POST | `/api/v1/citizen-reports` | **Público** | `{ type, description, photo, latitude, longitude, accuracy? }` → 201 con `folio` y `status: "new"`. 422 `validation_error` si no trae ni descripción ni foto; 422 si latitud/longitud están fuera de rango. Límite de tasa por IP: 5 reportes cada 10 min → 429 `rate_limited` (valor de prototipo). |
| GET | `/api/v1/citizen-reports` | **Público** | `CitizenReport[]`, más recientes primero (`created_at` desc), máx. 500. Se usa en el mapa y en "reportes de la comunidad". |
| GET | `/api/v1/citizen-reports/by-folio/{folio}` | **Público** | Seguimiento por folio (sin distinguir mayúsculas). 404 `not_found` si no existe. |
| PATCH | `/api/v1/citizen-reports/{id}` | supervisor / admin | `{ status?, public_note? }`. Se usa para descartar: `{ "status": "rejected", "public_note": "Duplicado de RC-0003" }`. El resto de cambios de estado los hace la cascada (sección 4.3). |

Nota de privacidad: como el listado es público, `photo`, `description` y la ubicación de los reportes quedan visibles para cualquiera. Es aceptable para el prototipo; si no, habría que recortar la ubicación en el listado público.

## 4. Órdenes de trabajo

```json
{
  "id": "…", "folio": "OT-0007", "type": "waste_collection", "title": "Vaciar contenedor", "description": "…",
  "priority": "normal", "status": "assigned",
  "station_id": "…", "station_name": "…", "citizen_report_id": null, "alert_id": null,
  "location": { "latitude": 19.05, "longitude": -98.25 },
  "assigned_to": "<user id>", "assigned_name": "Luis Hernández", "created_by": "<user id>", "due_at": "…",
  "checklist": [{ "key": "container", "label": "Contenedor vaciado", "done": true }],
  "evidence": [{ "kind": "after", "photo": "data:image/jpeg;base64,…", "ts": "…" }],
  "notes": "", "result": { "waste_type": "plastic", "weight_kg": 6.2, "items_count": 41 },
  "check_in": { "latitude": 19.05, "longitude": -98.25, "accuracy": 8, "ts": "…" },
  "created_at": "…", "started_at": null, "completed_at": null, "verified_at": null
}
```

- `type` ∈ `citizen_report | maintenance | waste_collection | calibration`
- `priority` ∈ `low | normal | high | urgent`
- `status` ∈ `pending | assigned | in_progress | done | verified | cancelled`
- `evidence[].kind` ∈ `before | after`; `evidence[].ts` en ISO.
- `station_name` y `assigned_name` los resuelve el servidor (no se mandan al crear). `created_by` se toma del token, no del cuerpo.
- `location`: si no viene, el servidor usa la del reporte ciudadano (si hay) o, si no, la de la estación; `null` si no hay ninguna.
- `result` depende del tipo (todos los campos opcionales; el front siempre manda los de su tipo al cerrar):
  - `citizen_report`: `{ confirmed, action_taken }`
  - `waste_collection`: `{ waste_type, weight_kg, items_count }` (`waste_type` ∈ `plastic | organic | metal | glass | other`)
  - `calibration`: `{ sensor_id, sensor_name, reference_value, measured_value, calibration_offset, calibration_factor }`
  - `maintenance`: sin resultado (`null`).

### 4.1 Endpoints

| Método | Ruta | Acceso | Notas |
| --- | --- | --- | --- |
| GET | `/api/v1/work-orders?assigned_to=&status=a,b&type=` | personal | `WorkOrder[]`, máx. 500. `status` admite varios valores separados por coma. Orden: `created_at` desc (el front reordena por prioridad). Un técnico solo recibe sus órdenes aunque pida otras: el servidor fuerza `assigned_to = su id`. |
| GET | `/api/v1/work-orders/{id}` | personal | Un técnico solo puede ver las suyas (404 `not_found` en las ajenas, para no revelar que existen). |
| POST | `/api/v1/work-orders` | supervisor / admin | `{ type, title, description, priority, station_id, citizen_report_id?, alert_id?, location?, assigned_to?, due_at? }` → 201. Con `assigned_to` nace `assigned`; sin él, `pending`. 422 `invalid_data` si `station_id`, `citizen_report_id`, `alert_id` o `assigned_to` no existen, o si `assigned_to` no es un usuario activo. |
| PATCH | `/api/v1/work-orders/{id}` | personal | Cualquier subconjunto de los campos permitidos a su rol (4.2). |

El **checklist** lo genera el servidor al crear la orden, según el tipo, con `done: false`:

| `type` | `key` → `label` |
| --- | --- |
| `maintenance` | `grid` Rejilla de entrada limpia (sin basura atorada) · `centrifuge` Centrífuga gira sin vibración ni ruido anormal · `power` Batería y panel solar limpios, voltaje correcto · `leaks` Sin fugas en mangueras ni conexiones · `housing` Carcasa y anclaje de la boya en buen estado · `sensors` Sensores sumergidos y sin lodo |
| `waste_collection` | `container` Contenedor de basura vaciado · `sorted` Residuos separados por tipo · `weighed` Residuos pesados |
| `calibration` | `clean` Sensor enjuagado con agua destilada · `buffer` Medición con solución patrón · `reinstalled` Sensor reinstalado y transmitiendo |
| `citizen_report` | `arrived` Llegué al punto reportado · `assessed` Evalué el problema · `action` Realicé la acción correctiva o di aviso a la autoridad |

(Es la misma lista de `defaultChecklist()` en `shared/utils/ops.util.ts`; si cambia allí, avisa para sincronizar.) El cliente puede reemplazar el arreglo completo en el `PATCH` (marcar `done`), pero no puede inventar `key`s nuevas: 422 `invalid_data`.

### 4.2 Permisos por rol

| Acción | technician | supervisor | admin |
| --- | --- | --- | --- |
| Listar / ver órdenes | solo las suyas | todas | todas |
| Crear orden | no (403) | sí | sí |
| `PATCH`: `status`, `checklist`, `evidence`, `notes`, `result`, `check_in` | solo en las suyas | sí | sí |
| `PATCH`: `assigned_to`, `priority`, `due_at` | no (403) | sí | sí |
| Pasar a `verified`, `cancelled` o reabrir (`done → in_progress`) | no (403) | sí | sí |
| Un técnico transiciona solo | `assigned → in_progress`, `in_progress → done` | cualquiera válida | cualquiera válida |

Un técnico que hace `PATCH` sobre una orden ajena recibe 404 `not_found`.

### 4.3 Reglas que debe aplicar el backend

1. **Folios** consecutivos: `RC-0001`, `OT-0001` (una secuencia por tipo, p. ej. `SEQUENCE` de Postgres; 4 dígitos con ceros a la izquierda, crece si pasa de 9999).
2. **Al asignar o reasignar:** `pending → assigned`; al quitar el técnico (`assigned_to: null`), `assigned → pending`. Se rellena `assigned_name`.
3. **Transiciones válidas** (409 `invalid_transition` en cualquier otro caso; repetir el estado actual es válido y no hace nada):
   - `pending → assigned | cancelled`
   - `assigned → in_progress | pending | cancelled`
   - `in_progress → done | assigned | cancelled`
   - `done → verified | in_progress` (el supervisor verifica o reabre)
   - `verified` y `cancelled` son estados finales.
4. **Marcas de tiempo:** `started_at` al pasar a `in_progress` (solo la primera vez), `completed_at` en `done` y `verified_at` en `verified`.
5. **Cierre (`done`):** exige `result` coherente con el tipo (422 `invalid_data` si falta, salvo en `maintenance`). Para `waste_collection`: `weight_kg > 0` y `waste_type` válido. Para `calibration`: `sensor_id`, `calibration_offset` y `calibration_factor`.
6. **Cascada al reporte ciudadano** (si la orden tiene `citizen_report_id`):

   | Evento de la orden | Estado del reporte |
   | --- | --- |
   | Al crearla | `verified`, con `work_order_id` |
   | `in_progress` | `in_progress` |
   | `done`/`verified` | `resolved`, con `public_note = result.action_taken` (si viene) |
   | `done` con `result.confirmed = false` | `rejected`, con `public_note = result.action_taken` o, si no hay, "La brigada no encontró el problema reportado." |
   | `cancelled` | `verified` |

   Cada cambio actualiza `updated_at` del reporte.

### 4.4 Efectos sobre endpoints que ya existen (hoy los dispara el front)

Al ejecutar una orden, el front llama él mismo a estos endpoints de monitoreo (ver `core/services/work-orders.service.ts`):

| Orden | Llamada | Cuándo |
| --- | --- | --- |
| `maintenance` | `PATCH /stations/{id}` `{ status: "maintenance" }` | al pasar a `in_progress` |
| `maintenance` | `PATCH /stations/{id}` `{ status: "active" }` | al pasar a `done` o `cancelled` |
| `waste_collection` | `POST /waste-collections` con el peso real y `collector_id` = correo del técnico | al cerrar |
| `calibration` | `PATCH /sensors/{id}` `{ calibration_offset, calibration_factor, calibrated_at }` | al cerrar |

**Lo que necesito de Back:** que estos cuatro endpoints (`PATCH /stations/{id}`, `POST /waste-collections`, `PATCH /sensors/{id}` y, por consistencia, `PATCH /alert-rules/{id}`) acepten **una de dos credenciales**: la `X-API-Key` de siempre **o** un `Bearer` de un usuario activo del personal. Así el técnico registra su trabajo sin que la clave de ingesta viaje en la app del teléfono. Mientras no esté, el front sigue mandando `X-API-Key`; cuando lo esté, quito la clave de esos flujos.

Si prefieres que el backend los ejecute al cerrar la orden (más seguro y atómico), avísame y los quito del front. En ese caso, la orden debe ejecutarlos con las mismas reglas de la tabla y, si fallan, no bloquear el cierre (el técnico está en campo).

## 5. WebSocket (`/ws/live`)

Dos tipos de mensaje nuevos, con el mismo sobre `{ type, station_id, ts, data }` de `API.md`:

| `type` | Cuándo | `data` | `station_id` del sobre |
| --- | --- | --- | --- |
| `work_order_assigned` | Se crea una orden con técnico o se asigna/reasigna una existente | la `WorkOrder` completa | el de la orden (o `null`) |
| `citizen_report_created` | Se crea un reporte ciudadano | el `CitizenReport` completo | el de la estación vinculada (o `null`) |

- El front muestra una notificación en el teléfono si `data.assigned_to` es el usuario con sesión, y refresca la bandeja del supervisor con `citizen_report_created`.
- **Limitación conocida del prototipo:** el WS actual no distingue usuarios (abierto en `dev`, o con `?api_key=`), así que estos eventos se envían a **todos** los clientes conectados, igual que los demás. El front filtra por `assigned_to`. Para producción habría que aceptar `?token=<jwt>` en el WS y mandar `work_order_assigned` solo al técnico asignado y a los supervisores; la foto de evidencia no hace falta en el evento.
- Los eventos publican por el mismo canal Redis que el resto (`Redis pub/sub`), sin cambios en la forma de reconexión.

## 6. Códigos de error nuevos (agregar a la tabla de `API.md`)

| HTTP | `code` | Cuándo |
| --- | --- | --- |
| 401 | `invalid_credentials` | Correo o contraseña incorrectos en el login |
| 401 | `unauthorized` | Falta el Bearer, está vencido o es inválido (mismo código que la `X-API-Key` inválida) |
| 403 | `inactive` | La cuenta está desactivada (login) |
| 403 | `forbidden` | El rol no puede hacer esa acción (sección 4.2) |
| 409 | `invalid_transition` | Cambio de estado de la orden no permitido |
| 429 | `rate_limited` | Demasiados reportes ciudadanos desde la misma IP |

El front muestra `error.message` tal cual en un aviso, así que redáctalo en español y para una persona ("No se puede pasar de «pendiente» a «terminada»").

## 7. Fotos

- **Reporte:** una foto, ≤ 1024 px, JPEG. **Evidencia de orden:** máximo 2 (`before` y `after`), mismas características. Tamaño máximo recomendado por foto: 300 KB (el front manda ~100 KB). Más grande → 422 `invalid_data`.
- **Prototipo (sin infraestructura nueva):** guardar el data URL tal cual en la base (columna `text` o dentro del JSONB). Funciona, pero hace pesados los listados.
- **Mejor opción si hay tiempo:** decodificar y guardar en disco (o volumen Docker), y devolver `photo` como URL absoluta (`https://…/media/<id>.jpg`) servida con `StaticFiles`. El front acepta URLs y data URLs indistintamente, así que se puede cambiar sin tocar el front. El `PATCH` de la orden sigue recibiendo la foto como data URL.
- Validar que el contenido sea `data:image/jpeg;base64,…` (o `png`) antes de guardarlo.

## 8. Tablas sugeridas

Solo una guía; ajusta como convenga a tu modelo hexagonal.

| Tabla | Columnas principales |
| --- | --- |
| `users` | `id uuid pk`, `name`, `email` (único, en minúsculas), `password_hash`, `role` (enum), `active bool`, `created_at` |
| `citizen_reports` | `id uuid pk`, `folio` (único), `type`, `description`, `photo text null`, `latitude`, `longitude`, `accuracy null`, `status`, `station_id fk null`, `work_order_id fk null`, `public_note null`, `created_at`, `updated_at` |
| `work_orders` | `id uuid pk`, `folio` (único), `type`, `title`, `description`, `priority`, `status`, `station_id fk null`, `citizen_report_id fk null`, `alert_id fk null`, `location jsonb null`, `assigned_to fk null`, `created_by fk`, `due_at null`, `checklist jsonb`, `evidence jsonb`, `notes text`, `result jsonb null`, `check_in jsonb null`, `created_at`, `started_at`, `completed_at`, `verified_at` |

Índices útiles: `work_orders(assigned_to, status)`, `citizen_reports(created_at desc)`, `citizen_reports(folio)`.

`station_name` y `assigned_name` se obtienen con un join, no se guardan.

## 9. Cuentas demo sugeridas (seed)

Solo con `ENVIRONMENT` de desarrollo (el seed no debe crear estas cuentas en producción).

| Correo | Rol | Contraseña |
| --- | --- | --- |
| `tecnico@demo.mx` | technician | `demo123` |
| `tecnico2@demo.mx` | technician | `demo123` |
| `supervisor@demo.mx` | supervisor | `demo123` |
| `admin@demo.mx` | admin | `demo123` |

El front muestra estas cuentas en la pantalla de login solo cuando usa el mock; con el backend real no las muestra.

## 10. Para Integración

- **CORS:** además de `http://localhost:4200`, la app Android (Capacitor) sirve desde `http://localhost`. Agregarlo a `CORS_ORIGINS` en `backend/.env` (el valor por defecto de `backend/app/config/settings.py` solo permite el 4200).
- **`.env.example`:** agregar `JWT_SECRET` y `JWT_EXPIRES_MIN`.
- **`API.md`:** Back incorpora las secciones 1 a 6 en su PR; el resto de este documento es guía de implementación.
