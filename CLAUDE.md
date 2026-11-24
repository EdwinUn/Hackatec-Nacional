# CLAUDE.md

Contexto del proyecto para Claude Code.

## Proyecto

Proyecto para el Hackatec Nacional 2026, reto SECIHTI Puebla: monitorear y ayudar a reducir la contaminación de ríos, barrancas y cuerpos de agua de Puebla. La propuesta es una máquina/boya que toma agua del río, mide su calidad con sensores, la centrifuga/filtra, recolecta basura y devuelve agua más limpia. El dashboard compara pH de entrada contra salida, salud de sensores, centrifugado, agua recuperada, basura y alertas tempranas. Los sensores se simulan en el frontend (Three.js) y en `backend/scripts/simulate.py`.

## Stack

- **frontend/**: Angular 22 (standalone, signals) + PrimeNG 22 con tema Aura
- **backend/**: Python 3.12 + FastAPI, arquitectura hexagonal; SQLAlchemy 2 async + asyncpg, PostgreSQL 17, Alembic, Redis pub/sub + WebSocket; uv, ruff, pytest. Detalle en `backend/README.md`
- **ia/**: fuera de alcance por ahora; no agregar código de IA sin que el equipo lo decida

## Equipo y dueños

Somos 3: Front, Back e Integración. Cada zona tiene un dueño (tabla completa en `README.md`). No modifiques archivos de otra zona como "efecto secundario" de una tarea; si hace falta, menciónalo.

## Convenciones

- El contrato de endpoints entre front y back vive en `API.md`. Si cambias un endpoint, actualiza `API.md` en el mismo cambio.
- Los secretos van en `backend/.env` (plantilla en `.env.example`). Nunca escribir credenciales en el código.
- Backend (hexagonal; ver "Arquitectura" en `backend/README.md`):
  - reglas puras en `app/domain/` (sin FastAPI/SQLAlchemy/Redis), con pruebas en `tests/unit/`
  - casos de uso en `app/application/services/`, dependiendo solo de los puertos de `app/application/ports.py`
  - adaptadores en `app/adapters/` (routers y schemas HTTP, WebSocket, repositorios y SQL analítico, Redis, simulador)
  - todo se conecta en `app/config/container.py`; los routers se registran en `app/main.py`
  - consultas del dashboard: agregar en SQL (`adapters/outbound/persistence/analytics.py`) y devolver DTOs de `application/read_models.py`
  - umbrales y fórmulas son "valores de prototipo": documentar su criterio y no presentarlos como datos reales
- Esquema de BD: migraciones Alembic (`uv run alembic revision --autogenerate -m "..."` desde `backend/`, revisar el archivo generado y luego `make migrate`).
- Frontend:
  - interfaces en `src/app/core/models/` (reflejan `API.md`)
  - mocks en `src/app/core/mocks/`
  - servicios por recurso en `src/app/core/services/`, usando `ApiService` y respetando `environment.useMocks`
  - pantallas en `src/app/pages/`, con lazy loading en `app.routes.ts`
- Frontend: usar componentes de PrimeNG antes de construir componentes propios.
- Código y nombres en inglés; textos de la interfaz y documentación en español.
- La página `home` del frontend y su recurso `Item` son ejemplos; el backend ya no expone `/items`.

## Comandos

```bash
# Infraestructura (desde la raíz)
docker compose up -d db redis

# Backend (desde backend/; `make help` lista todo)
uv sync
make migrate seed simulate   # esquema + datos demo
make dev                     # API con recarga en :8000
make live                    # datos en vivo vía HTTP
make test                    # unitarias + integración (BD rio_test)
make lint

# Frontend (desde frontend/)
npx ng serve
npx ng build
npx ng test --watch=false
```
