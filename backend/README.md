# Backend

API en **FastAPI** con **SQLModel** sobre **PostgreSQL**.

## Estructura

```
backend/
├── app/
│   ├── main.py        # Instancia de FastAPI, CORS y registro de routers
│   ├── config.py      # Settings leídos de .env
│   ├── database.py    # Engine, create_all y get_session()
│   ├── seed.py        # Datos de ejemplo: python -m app.seed
│   ├── models/        # Tablas SQLModel (importar cada una en __init__.py)
│   ├── routers/       # Endpoints agrupados por recurso
│   └── services/      # Lógica de negocio
├── tests/             # pytest
├── requirements.txt
└── .env               # No se sube (ver ../.env.example)
```

## Agregar un recurso nuevo

Copia el patrón de `Item`:

1. Escribe el contrato en `../API.md` (PR que revisa el front).
2. Crea `models/<recurso>.py` con los modelos de tabla, Create y Read, e impórtalo en `models/__init__.py`.
3. Crea `services/<recurso>.py` con las consultas.
4. Crea `routers/<recurso>.py` y regístralo en `main.py` con `app.include_router(...)`.

## Correr

Necesita PostgreSQL arriba (ver el README de la raíz).

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env
python -m app.seed
fastapi dev app/main.py
```

Documentación interactiva: http://localhost:8000/docs
