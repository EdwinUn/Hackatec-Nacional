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
|        | IA |

## Stack

| Parte | Tecnología |
| ----- | ---------- |
| Frontend | Angular + PrimeNG |
| Backend | FastAPI + SQLModel + SQLite |
| IA | Scripts y prompts (por definir) |

## Estructura

```
.
├── frontend/   # App Angular + PrimeNG
├── backend/    # API FastAPI + SQLModel
├── ia/         # Scripts y prompts de IA
├── API.md      # Contrato de endpoints entre front y back
└── CLAUDE.md   # Contexto del proyecto para Claude Code
```

## Cómo correrlo en local

### Requisitos

- Node.js 20+ y Angular CLI (`npm i -g @angular/cli`)
- Python 3.11+

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example .env
fastapi dev app/main.py          # http://localhost:8000/docs
```

### Frontend

```bash
cd frontend
npm install
ng serve                         # http://localhost:4200
```

## Licencia

_Por definir según las bases del Hackatec._
