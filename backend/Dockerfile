# ── Etapa 1: dependencias con uv ─────────────────────────
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY app ./app
COPY migrations ./migrations
COPY scripts ./scripts
COPY alembic.ini ./

# ── Etapa 2: imagen final ligera (sin uv ni compiladores) ─
FROM python:3.12-slim-bookworm
RUN useradd --create-home --uid 1000 app
WORKDIR /app
COPY --from=builder --chown=app:app /app /app
# Fotos de reportes/evidencias: el volumen hereda este dueño la primera vez.
RUN mkdir -p /app/media && chown app:app /app/media
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
# Migra y arranca. WEB_CONCURRENCY > 1 es seguro: WS vía Redis y tareas de fondo con lock.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-2}"]
