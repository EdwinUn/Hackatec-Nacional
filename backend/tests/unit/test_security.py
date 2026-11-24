from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.adapters.outbound.security.tokens import JwtCodec, hash_password, verify_password
from app.domain.entities import SkimmerCollection, Task
from app.domain.enums import BuoyCondition, TaskKind, TaskStatus
from app.domain.errors import AuthenticationError, ConflictError, InvalidDataError


def test_password_hash_roundtrip():
    h = hash_password("atoyac2026")
    assert h != "atoyac2026" and verify_password("atoyac2026", h)
    assert not verify_password("otra", h) and not verify_password("x", "basura")


def test_jwt_roundtrip_expiry_and_tamper():
    jwt = JwtCodec("secreto", 60)
    token = jwt.encode({"sub": "u1"}, now=1000)
    assert jwt.decode(token, now=1030)["sub"] == "u1"
    with pytest.raises(AuthenticationError):
        jwt.decode(token, now=1061)  # expirado
    head, payload, sig = token.split(".")
    with pytest.raises(AuthenticationError):
        jwt.decode(f"{head}.{payload}x.{sig}", now=1030)  # alterado
    with pytest.raises(AuthenticationError):
        JwtCodec("otro", 60).decode(token, now=1030)  # otra llave
    with pytest.raises(AuthenticationError):
        jwt.decode("no-es-un-jwt")


def test_task_resolve_needs_a_note_and_only_once():
    t = Task(title="Reparar SK-01", kind=TaskKind.REPAIR)
    now = datetime.now(UTC)
    with pytest.raises(InvalidDataError):
        t.resolve("  ", uuid4(), now)
    t.resolve("Barrera reinstalada", uuid4(), now)
    assert t.status is TaskStatus.DONE and t.closing_note == "Barrera reinstalada"
    with pytest.raises(ConflictError):
        t.resolve("otra vez", uuid4(), now)


def _collection(materials, kg=1.0, pieces=1):
    return SkimmerCollection(
        station_id=uuid4(), ts=datetime.now(UTC), buoy_code="SK-01", buoy_condition=BuoyCondition.OK,
        materials=materials, total_kg=kg, total_pieces=pieces,
    )  # fmt: skip


def test_collection_rejects_unknown_material_negatives_and_empty():
    _collection({"plastico": {"kg": 1, "piezas": 2}})
    with pytest.raises(InvalidDataError):
        _collection({"madera": {"kg": 1, "piezas": 1}})
    with pytest.raises(InvalidDataError):
        _collection({"metal": {"kg": -1, "piezas": 1}})
    with pytest.raises(InvalidDataError):
        _collection({"metal": {"kg": 0, "piezas": 0}}, kg=0, pieces=0)
