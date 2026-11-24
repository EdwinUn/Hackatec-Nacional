# Nombre del Proyecto

> Hackatec Nacional 2026 — una línea que describa qué hace el proyecto.

## Problema

_Qué problema resolvemos y para quién._

## Solución

_Cómo lo resolvemos y qué lo hace diferente._

## Equipo

| Nombre | Rol |
| ------ | --- |
|        | Frontend |
|        | Backend |
|        | Integración |

## Stack

| Parte | Tecnología |
| ----- | ---------- |
| Frontend | Angular 22 + PrimeNG 22 (tema Aura) |
| Backend | FastAPI + SQLAlchemy 2 async · arquitectura hexagonal (ver [backend/README.md](backend/README.md)) |
| Base de datos | PostgreSQL 17 + migraciones Alembic |
| Tiempo real | Redis pub/sub + WebSocket |
| IA | Fuera de alcance por ahora (`ia/` queda reservada) |

## Estructura

```
.
├── frontend/      # App Angular + PrimeNG
├── backend/       # API FastAPI (dominio, casos de uso, adaptadores) — ver backend/README.md
├── ia/            # Reservada (IA fuera de alcance por ahora)
├── compose.yaml   # PostgreSQL + Redis + API
├── API.md         # Contrato de endpoints entre front y back
└── CLAUDE.md      # Contexto del proyecto para Claude Code
```

## Cómo trabajamos (3 personas sin pisarnos)

### Dueños por zona

| Zona | Dueño | Notas |
| --- | --- | --- |
| `frontend/**` | Front | |
| `backend/app/domain/`, `application/`, `adapters/`, `backend/scripts/`, `backend/migrations/` | Back | |
| `compose.yaml`, `backend/app/config/`, `backend/app/main.py`, `backend/tests/`, `.env.example`, `README.md`, `CLAUDE.md` | Integración | Back sí agrega la línea `include_router` en `main.py` |
| `API.md` | Back escribe, Front revisa | Cada cambio es un PR propio, **antes** del código |

Si necesitas tocar algo que no es tuyo, avisa al dueño o abre un PR que él revise.

### Contrato front ↔ back

El contrato es [API.md](API.md). Ver la sección *"Cómo proponer un endpoint"*. Mientras un endpoint no existe en el backend, el front trabaja con mocks (`useMocks: true` en `frontend/src/environments/environment.development.ts`).

### Git

- `main` siempre debe correr. Nadie hace push directo a `main`.
- Ramas: `front/<tarea>`, `back/<tarea>`, `int/<tarea>`.
- PR pequeños a `main`. Integración los revisa y los mergea.
- Al empezar a trabajar: `git pull --rebase origin main`.

## Cómo correrlo en local

### Requisitos

- Node.js 20+ (el CLI de Angular se usa con `npx ng`, no hace falta instalarlo global)
- [uv](https://docs.astral.sh/uv/) (instala Python 3.12 por su cuenta)
- Docker o Podman (para PostgreSQL y Redis)

### 1. Infraestructura (PostgreSQL + Redis)

```bash
docker compose up -d db redis    # o: podman compose up -d db redis
```

Después de reiniciar la compu: `docker compose up -d db redis`.

### 2. Backend

```bash
cd backend
cp ../.env.example .env
uv sync                          # crea .venv con Python 3.12 y dependencias
make migrate seed simulate       # esquema, 3 estaciones de Puebla y 24 h de datos simulados
make dev                         # http://localhost:8000/docs
make live                        # (otra terminal) datos en vivo + alerta demo a los 2 min
make test                        # pruebas
```

O todo en Docker: `docker compose up -d --build` (la API migra sola), y luego `make seed simulate` desde `backend/`. Detalles en [backend/README.md](backend/README.md).

### 3. Frontend

```bash
cd frontend
npm install
npx ng serve                     # http://localhost:4200
npx ng test --watch=false        # tests
```

### 4. Comprobar que todo funciona

Con la infraestructura arriba, `make dev` corriendo en una terminal y `npx ng serve` en otra:

| Qué revisar | Resultado esperado |
| --- | --- |
| `make test` (en `backend/`) | `77 passed` |
| `npx ng test --watch=false` (en `frontend/`) | `1 passed` |
| http://localhost:8000/health | `{"status": "ok", "postgres": "ok", "redis": "ok", …}` |
| http://localhost:8000/api/v1/dashboard/overview | KPIs con WQI, pH, agua y alertas |

> ⚠️ La pantalla de ejemplo del frontend (lista de `items`) ya no tiene backend: esos endpoints de borrador se retiraron. El contrato nuevo está en [API.md](API.md).

Problemas comunes:

- **Puerto 5432 o 6379 ocupado:** ya tienes otro Postgres o Redis instalado; detenlo.
- **`make test` omite las pruebas de integración:** falta la BD `rio_test` (ver [backend/README.md](backend/README.md#pruebas-y-lint)).

Para apagar: `Ctrl+C` en las terminales del back y del front, y `docker compose stop`.

### Resetear la base de datos

El esquema lo manejan las migraciones de Alembic (`make migrate`). Para empezar de cero con datos demo:

```bash
cd backend && make reset simulate     # vacía las tablas, siembra y genera 24 h de datos
# o borrando también el volumen:
docker compose down -v && docker compose up -d db redis && make migrate seed simulate
```

### Licencia de PrimeNG

PrimeNG 22 pide una *license key* (el equipo usa la **Community License**, gratis: https://primeui.dev/licenses/community). La key **no se sube a git**:

- `npm install` crea solo `frontend/src/environments/license.local.ts` con la key vacía. El proyecto compila igual; solo verás el aviso "Invalid PrimeUI License" en la esquina.
- Para quitar el aviso, pide la key por privado y pégala en ese archivo: `export const PRIMENG_LICENSE = '...';`
- La key actual vence el **2027-11-23**.

## Licencia

_Por definir según las bases del Hackatec._
