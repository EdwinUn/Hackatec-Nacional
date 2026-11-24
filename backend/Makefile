# Uso: make <objetivo>   (desde backend/)
COMPOSE := docker compose -f ../compose.yaml
HOURS ?= 24

.PHONY: help up infra down logs dev migrate seed reset simulate live boya test test-unit lint format

help:  ## Lista los objetivos
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

up:  ## Levanta todo (db + redis + api en Docker, la API migra al arrancar)
	$(COMPOSE) up -d --build

infra:  ## Solo PostgreSQL y Redis (para correr la API local con `make dev`)
	$(COMPOSE) up -d db redis

down:  ## Apaga los contenedores (conserva datos; `docker compose down -v` los borra)
	$(COMPOSE) down

logs:  ## Logs de la API en Docker
	$(COMPOSE) logs -f api

dev:  ## API local con recarga automática
	uv run uvicorn app.main:app --reload --port 8000

migrate:  ## alembic upgrade head
	uv run alembic upgrade head

seed:  ## Estaciones de Puebla, sensores y reglas por defecto (idempotente)
	uv run python -m scripts.seed

reset:  ## Vacía las tablas y vuelve a sembrar
	uv run python -m scripts.seed --reset

simulate:  ## Histórico simulado de HOURS horas (default 24)
	uv run python -m scripts.simulate --hours $(HOURS)

live:  ## Emite en vivo vía HTTP contra localhost:8000 (con descarga ácida demo a los 2 min)
	uv run python -m scripts.simulate --live

CODE ?= RM-01
SCENARIO ?= contaminada
boya:  ## Emula el ESP32 de una boya por MQTT (CODE=RM-01 SCENARIO=contaminada|limpia|bateria-baja)
	uv run python -m scripts.buoy --code $(CODE) --scenario $(SCENARIO)

test:  ## Todas las pruebas (integración necesita la BD rio_test; ver README)
	uv run pytest

test-unit:  ## Solo pruebas del dominio
	uv run pytest tests/unit

lint:  ## ruff check + formato
	uv run ruff check . && uv run ruff format --check .

format:  ## Aplica ruff (fix + format)
	uv run ruff check --fix . && uv run ruff format .
