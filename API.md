# API

Contrato entre frontend y backend. Actualizar este archivo **antes** o **junto con** cualquier cambio en los endpoints.

- **Base URL (local):** `http://localhost:8000`
- **Documentación generada:** `http://localhost:8000/docs`
- **Formato:** JSON
- **Errores:** `{ "detail": "mensaje" }` (formato por defecto de FastAPI)

## Endpoints

### `GET /health`

Verifica que el backend esté arriba.

**Respuesta 200**

```json
{ "status": "ok" }
```

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
