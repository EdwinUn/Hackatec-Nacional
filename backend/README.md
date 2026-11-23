# Backend

API en **FastAPI** con **SQLModel** sobre **SQLite**.

## Estructura sugerida

```
backend/
├── app/
│   ├── main.py        # Instancia de FastAPI, CORS y routers
│   ├── database.py    # Engine de SQLModel y sesión
│   ├── models/        # Tablas SQLModel
│   ├── routers/       # Endpoints agrupados por recurso
│   └── services/      # Lógica de negocio / llamadas a IA
├── requirements.txt
└── .env               # No se sube (ver ../.env.example)
```

## Correr

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env
fastapi dev app/main.py
```

Documentación interactiva: http://localhost:8000/docs
