# CLAUDE.md

Contexto del proyecto para Claude Code.

## Proyecto

Proyecto para el Hackatec Nacional 2026. _El problema y la solución todavía están por definir; actualizar esta sección en cuanto se decida._

## Stack

- **frontend/**: Angular + PrimeNG
- **backend/**: FastAPI + SQLModel + SQLite
- **ia/**: scripts y prompts (enfoque por definir)

## Convenciones

- El contrato de endpoints entre front y back vive en `API.md`. Si cambias un endpoint, actualiza `API.md` en el mismo cambio.
- Los secretos van en `backend/.env` (plantilla en `.env.example`). Nunca escribir API keys en el código.
- Backend: modelos SQLModel en `backend/app/models/`, endpoints en `backend/app/routers/`, lógica en `backend/app/services/`.
- Frontend: usar componentes de PrimeNG antes de construir componentes propios.
- IA: un prompt por archivo en `ia/prompts/`.
- Código y nombres en inglés; textos de la interfaz y documentación en español.

## Comandos

```bash
# Backend (desde backend/, con el .venv activado)
fastapi dev app/main.py

# Frontend (desde frontend/)
ng serve
```
