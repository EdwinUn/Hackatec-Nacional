# API

Contrato entre frontend y backend. Actualizar este archivo **antes** o **junto con** cualquier cambio en los endpoints.

- **Base URL (local):** `http://localhost:8000`
- **Documentación generada:** `http://localhost:8000/docs`
- **Formato:** JSON
- **Errores:** `{ "detail": "mensaje" }` (formato por defecto de FastAPI). Los errores de validación (422) traen `detail` como lista.

## Cómo proponer un endpoint

1. **Back** abre un PR que **solo** modifica este archivo, con la ruta, el request, la respuesta y los errores (usa la plantilla de abajo).
2. **Front** revisa el PR. Si los nombres de campos y la forma de la respuesta le sirven, lo aprueba y se mergea.
3. A partir de ahí trabajan en paralelo:
   - **Front:** agrega la interfaz en `frontend/src/app/core/models/` y un mock en `core/mocks/`, y construye la pantalla con `useMocks: true`.
   - **Back:** implementa el modelo, el servicio y el router reales.
4. Cuando el endpoint ya está en `main`, Front prueba con `useMocks: false`.

Si algo del contrato tiene que cambiar después, se vuelve a pasar por el paso 1.

## Endpoints

### `GET /health`

Verifica que el backend esté arriba.

**Respuesta 200**

```json
{ "status": "ok" }
```

---

### `GET /items` _(ejemplo: borrar cuando existan los recursos reales)_

Lista todos los items, ordenados por `id`.

**Respuesta 200**

```json
[
  { "id": 1, "name": "Primer elemento", "created_at": "2026-11-24T00:08:41.438494Z" }
]
```

---

### `POST /items` _(ejemplo)_

Crea un item.

**Request**

```json
{ "name": "Nuevo item" }
```

**Respuesta 201**

```json
{ "id": 4, "name": "Nuevo item", "created_at": "2026-11-24T00:08:45.512504Z" }
```

**Errores:** 422 si `name` falta, está vacío o tiene más de 200 caracteres.

---

<!-- Plantilla para nuevos endpoints:

### `MÉTODO /ruta`

Descripción breve.

**Request**

```json
{}
```

**Respuesta 200**

```json
{}
```

**Errores:** 404 si ..., 422 si ...
-->
