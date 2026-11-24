# Propuesta de API: módulo de operaciones (login, reportes ciudadanos, órdenes de trabajo)

Propuesta de **Front** para **Back**, según "Cómo proponer un endpoint" de `API.md`. Si te sirve, copia estas secciones a `API.md` en tu PR. Cualquier cambio de nombres o de forma lo ajusto en el front.

El front ya funciona con estos contratos usando un mock local (`opsMocks: true` en los environments). Cuando los endpoints estén en `main`, basta con poner `opsMocks: false`.

- Modelos en el front: `frontend/src/app/core/models/ops.models.ts`
- Cliente HTTP: `frontend/src/app/core/api/http-ops-api.ts`
- Reglas de referencia (las que hoy aplica el mock): `frontend/src/app/core/mock/mock-ops-api.ts`

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

**Errores:** 401 `invalid_credentials`; 403 `inactive` (cuenta desactivada).

- El front manda `Authorization: Bearer <token>` en todas las peticiones a `/api/v1`. Si un endpoint de operaciones responde 401, cierra la sesión.
- **Pedido extra:** que los `POST`/`PATCH` que hoy piden `X-API-Key` (`/waste-collections`, `/stations/{id}`, `/sensors/{id}`, `/alert-rules/{id}`) acepten también un Bearer de personal. Así el técnico registra su trabajo sin la clave de ingesta. Mientras tanto, el front sigue mandando `X-API-Key`.

## 2. Usuarios (solo `admin`)

| Método | Ruta | Cuerpo |
| --- | --- | --- |
| GET | `/api/v1/users` | — → `User[]` |
| POST | `/api/v1/users` | `{ name, email, role, password }` → `User` (409 si el correo existe) |
| PATCH | `/api/v1/users/{id}` | `{ name?, role?, active? }` → `User` |

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
- `photo`: el front manda un JPEG comprimido (≤1024 px, unos 100 KB) como data URL. Puedes guardarlo como archivo y devolver una URL; el front acepta las dos cosas.
- `station_id`: estación más cercana a 8 km o menos (criterio de prototipo); `null` si no hay ninguna.

| Método | Ruta | Acceso | Notas |
| --- | --- | --- | --- |
| POST | `/api/v1/citizen-reports` | **Público** | `{ type, description, photo, latitude, longitude, accuracy? }` → 201 con `folio`. 422 si no trae ni descripción ni foto. Conviene un límite de tasa por IP. |
| GET | `/api/v1/citizen-reports` | **Público** | Lista (más recientes primero). Se usa en el mapa y en "reportes de la comunidad". |
| GET | `/api/v1/citizen-reports/by-folio/{folio}` | **Público** | Seguimiento por folio (sin distinguir mayúsculas). 404 si no existe. |
| PATCH | `/api/v1/citizen-reports/{id}` | supervisor/admin | `{ status?, public_note? }`. Se usa para descartar: `{ "status": "rejected", "public_note": "Duplicado de RC-0003" }`. |

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
- `result` depende del tipo:
  - `citizen_report`: `{ confirmed, action_taken }`
  - `waste_collection`: `{ waste_type, weight_kg, items_count }`
  - `calibration`: `{ sensor_id, sensor_name, reference_value, measured_value, calibration_offset, calibration_factor }`

| Método | Ruta | Acceso | Notas |
| --- | --- | --- | --- |
| GET | `/api/v1/work-orders?assigned_to=&status=a,b&type=` | personal | El técnico consulta `assigned_to=<su id>`. |
| GET | `/api/v1/work-orders/{id}` | personal | |
| POST | `/api/v1/work-orders` | supervisor/admin | `{ type, title, description, priority, station_id, citizen_report_id?, alert_id?, location?, assigned_to?, due_at? }`. El checklist por tipo se genera en el servidor; la lista de referencia está en `defaultChecklist()` de `shared/utils/ops.util.ts`. |
| PATCH | `/api/v1/work-orders/{id}` | personal | Cualquier subconjunto de `{ status, assigned_to, priority, checklist, evidence, notes, result, check_in, due_at }`. |

### Reglas que debería aplicar el backend

1. **Folios** consecutivos: `RC-0001`, `OT-0001`.
2. **Al asignar o reasignar:** `pending → assigned`; al quitar el técnico, `assigned → pending`. Se rellena `assigned_name`.
3. **Transiciones válidas** (409 `invalid_transition` en cualquier otro caso):
   - `pending → assigned | cancelled`
   - `assigned → in_progress | pending | cancelled`
   - `in_progress → done | assigned | cancelled`
   - `done → verified | in_progress` (el supervisor verifica o reabre)
   - `verified` y `cancelled` son estados finales.
4. **Marcas de tiempo:** `started_at` al pasar a `in_progress`, `completed_at` en `done` y `verified_at` en `verified`.
5. **Cascada al reporte ciudadano** (si la orden tiene `citizen_report_id`):

   | Evento de la orden | Estado del reporte |
   | --- | --- |
   | Al crearla | `verified`, con `work_order_id` |
   | `in_progress` | `in_progress` |
   | `done`/`verified` | `resolved`, con `public_note = result.action_taken` |
   | `done` con `result.confirmed = false` | `rejected` |
   | `cancelled` | `verified` |

6. **Permisos:** el técnico solo puede hacer PATCH sobre sus propias órdenes, y no puede pasarlas a `verified`.

### Efectos sobre endpoints que ya existen (hoy los dispara el front)

- **Mantenimiento:** `PATCH /stations/{id}` con `maintenance` al iniciar y con `active` al terminar o cancelar.
- **Recolección:** `POST /waste-collections` con el peso real y `collector_id` = correo del técnico.
- **Calibración:** `PATCH /sensors/{id}` con `calibration_offset`, `calibration_factor` y `calibrated_at`.

Si prefieres que el backend los ejecute al cerrar la orden, avísame y los quito del front (`core/services/work-orders.service.ts`).

## 5. WebSocket (`/ws/live`)

Dos tipos de mensaje nuevos, con el mismo sobre `{ type, station_id, ts, data }`:

- `work_order_assigned`: `data` es la `WorkOrder` completa. El front muestra una notificación en el teléfono si `data.assigned_to` es el usuario con sesión.
- `citizen_report_created`: `data` es el `CitizenReport`. Refresca la bandeja del supervisor.

## 6. Cuentas demo sugeridas (seed)

| Correo | Rol | Contraseña |
| --- | --- | --- |
| `tecnico@demo.mx` | technician | `demo123` |
| `tecnico2@demo.mx` | technician | `demo123` |
| `supervisor@demo.mx` | supervisor | `demo123` |
| `admin@demo.mx` | admin | `demo123` |
