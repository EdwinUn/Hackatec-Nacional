# CLAUDE.md

Contexto del proyecto para Claude Code.

## Proyecto

Proyecto para el Hackatec Nacional 2026. _El problema y la solución todavía están por definir; actualizar esta sección en cuanto se decida._

## Stack

- **frontend/**: Angular 22 (standalone, signals) + PrimeNG 22 con tema Aura
- **backend/**: FastAPI + SQLModel + PostgreSQL 17 (driver `psycopg`)
- **ia/**: fuera de alcance por ahora; no agregar código de IA sin que el equipo lo decida

## Equipo y dueños

Somos 3: Front, Back e Integración. Cada zona tiene un dueño (tabla completa en `README.md`). No modifiques archivos de otra zona como "efecto secundario" de una tarea; si hace falta, menciónalo.

## Convenciones

- El contrato de endpoints entre front y back vive en `API.md`. Si cambias un endpoint, actualiza `API.md` en el mismo cambio.
- Los secretos van en `backend/.env` (plantilla en `.env.example`). Nunca escribir credenciales en el código.
- Backend, patrón por recurso (ejemplo completo: `Item`):
  - modelo SQLModel en `backend/app/models/<recurso>.py`, e importarlo en `models/__init__.py`
  - lógica en `backend/app/services/<recurso>.py`
  - endpoints en `backend/app/routers/<recurso>.py`, registrados en `main.py`
  - modelos separados para tabla / Create / Read
- Esquema de BD: `create_all` al arrancar, sin migraciones. Si cambias una tabla existente hay que resetear la BD (ver `README.md`).
- Frontend:
  - interfaces en `src/app/core/models/` (reflejan `API.md`)
  - mocks en `src/app/core/mocks/`
  - servicios por recurso en `src/app/core/services/`, usando `ApiService` y respetando `environment.useMocks`
  - pantallas en `src/app/pages/`, con lazy loading en `app.routes.ts`
- Frontend: usar componentes de PrimeNG antes de construir componentes propios.
- Código y nombres en inglés; textos de la interfaz y documentación en español.
- El recurso `Item` y la página `home` son ejemplos; se borran cuando existan los recursos reales.

## Comandos

```bash
# Base de datos (desde la raíz)
docker compose up -d db          # o: podman start hackatec-db

# Backend (desde backend/, con el .venv activado)
fastapi dev app/main.py
python -m app.seed
pytest

# Frontend (desde frontend/)
npx ng serve
npx ng build
npx ng test --watch=false
```
