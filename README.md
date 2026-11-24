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
| Backend | FastAPI + SQLModel |
| Base de datos | PostgreSQL 17 (contenedor local) |
| IA | Fuera de alcance por ahora (`ia/` queda reservada) |

## Estructura

```
.
├── frontend/      # App Angular + PrimeNG
├── backend/       # API FastAPI + SQLModel
├── ia/            # Reservada (IA fuera de alcance por ahora)
├── compose.yaml   # PostgreSQL local
├── API.md         # Contrato de endpoints entre front y back
└── CLAUDE.md      # Contexto del proyecto para Claude Code
```

## Cómo trabajamos (3 personas sin pisarnos)

### Dueños por zona

| Zona | Dueño | Notas |
| --- | --- | --- |
| `frontend/**` | Front | |
| `backend/app/models/`, `routers/`, `services/`, `seed.py` | Back | |
| `compose.yaml`, `backend/app/config.py`, `database.py`, `main.py`, `backend/tests/`, `.env.example`, `README.md`, `CLAUDE.md` | Integración | Back sí agrega la línea `include_router` en `main.py` |
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
- Python 3.11+
- Docker o Podman (para PostgreSQL)

### 1. Base de datos

```bash
docker compose up -d db          # o: podman compose up -d db
```

Sin compose (solo Podman o Docker):

```bash
podman run -d --name hackatec-db \
  -e POSTGRES_USER=hackatec -e POSTGRES_PASSWORD=hackatec -e POSTGRES_DB=hackatec \
  -p 5432:5432 -v hackatec_pgdata:/var/lib/postgresql/data \
  docker.io/library/postgres:17
```

Después de reiniciar la compu: `podman start hackatec-db` (o `docker compose up -d db`).

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # fish: source .venv/bin/activate.fish · Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example .env
python -m app.seed               # datos de ejemplo (solo si la BD está vacía)
fastapi dev app/main.py          # http://localhost:8000/docs
pytest                           # tests de humo
```

### 3. Frontend

```bash
cd frontend
npm install
npx ng serve                     # http://localhost:4200
npx ng test --watch=false        # tests
```

### 4. Comprobar que todo funciona

Con la BD arriba, `fastapi dev` corriendo en una terminal y `npx ng serve` en otra:

| Qué revisar | Resultado esperado |
| --- | --- |
| `pytest` (en `backend/`) | `1 passed` |
| `npx ng test --watch=false` (en `frontend/`) | `1 passed` |
| http://localhost:8000/docs → `GET /health` → *Try it out* | `{"status": "ok"}` |
| http://localhost:4200 | Se ve la lista de items del seed |

Prueba de punta a punta: crea un item y recarga `localhost:4200`; debe aparecer.

```bash
curl -X POST localhost:8000/items -H 'Content-Type: application/json' -d '{"name": "prueba"}'
```

Problemas comunes:

- **Puerto 5432 ocupado:** ya tienes otro Postgres instalado; detenlo.
- **El front no muestra items:** revisa que el backend esté corriendo y que `useMocks` sea `false` en `environment.development.ts`.

Para apagar: `Ctrl+C` en las terminales del back y del front, y `docker compose stop db` (o `podman stop hackatec-db`).

### Resetear la base de datos

Las tablas se crean solas al arrancar el backend (`SQLModel.metadata.create_all`), pero **no se modifican** si cambias un modelo existente. Cuando el Back cambia una tabla, cada quien resetea su BD:

```bash
docker compose down -v && docker compose up -d db
# o con podman sin compose:
podman rm -f hackatec-db && podman volume rm hackatec_pgdata   # y vuelve a correr el `podman run` de arriba

cd backend && python -m app.seed
```

### Licencia de PrimeNG

PrimeNG 22 pide una *license key* (el equipo usa la **Community License**, gratis: https://primeui.dev/licenses/community). La key **no se sube a git**:

- `npm install` crea solo `frontend/src/environments/license.local.ts` con la key vacía. El proyecto compila igual; solo verás el aviso "Invalid PrimeUI License" en la esquina.
- Para quitar el aviso, pide la key por privado y pégala en ese archivo: `export const PRIMENG_LICENSE = '...';`
- La key actual vence el **2027-11-23**.

## Licencia

_Por definir según las bases del Hackatec._
