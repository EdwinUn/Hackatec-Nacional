"""Sesión del personal, bandeja de tareas y bitácora de boyas skimmer."""

import pytest

pytestmark = pytest.mark.integration

PASSWORD = "atoyac2026"


@pytest.fixture
async def operator(container, client, station):
    await container.staff.ensure_demo_data()
    r = await client.post(
        "/api/v1/auth/login", json={"email": "operador@atlmonitor.mx", "password": PASSWORD}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return {
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
        "user": body["user"],
        "body": body,
    }


async def test_login_ok_and_bad_credentials(client, operator):
    body = operator["body"]
    assert body["token_type"] == "bearer" and body["expires_in"] > 0
    assert body["user"]["email"] == "operador@atlmonitor.mx" and body["user"]["role"] == "technician"
    assert "password" not in str(body)
    for creds in (
        {"email": "operador@atlmonitor.mx", "password": "mal"},
        {"email": "nadie@atlmonitor.mx", "password": PASSWORD},
    ):
        r = await client.post("/api/v1/auth/login", json=creds)
        assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"
    me = await client.get("/api/v1/auth/me", headers=operator["headers"])
    assert me.json()["id"] == operator["user"]["id"]


async def test_protected_routes_need_a_token(client, operator):
    assert (await client.get("/api/v1/tasks")).status_code == 401
    assert (await client.get("/api/v1/tasks", headers={"Authorization": "Bearer basura"})).status_code == 401
    assert (await client.post("/api/v1/skimmers/recoleccion", json={})).status_code == 401


async def test_task_views_counts_and_resolution(client, operator):
    h = operator["headers"]

    def ids(page):
        return {t["title"] for t in page["items"]}

    everything = (await client.get("/api/v1/tasks", headers=h)).json()
    assert everything["total"] == 5
    assert everything["counts"] == {"asignadas": 3, "reparaciones_pendientes": 2, "urgentes": 3, "listos": 0}

    mine = (await client.get("/api/v1/tasks?view=asignadas", headers=h)).json()
    assert mine["total"] == 3 and all(t["assigned_to"] == operator["user"]["id"] for t in mine["items"])
    repairs = (await client.get("/api/v1/tasks?view=reparaciones_pendientes", headers=h)).json()
    assert {t["kind"] for t in repairs["items"]} == {"repair"}
    urgent = (await client.get("/api/v1/tasks?view=urgentes", headers=h)).json()
    assert {t["priority"] for t in urgent["items"]} == {"urgent"}

    task = repairs["items"][0]
    started = await client.patch(f"/api/v1/tasks/{task['id']}", json={"status": "in_progress"}, headers=h)
    assert started.json()["status"] == "in_progress" and started.json()["assigned_to"]

    no_note = await client.patch(f"/api/v1/tasks/{task['id']}", json={"status": "done"}, headers=h)
    assert no_note.status_code == 422
    done = await client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"status": "done", "closing_note": "Barrera reinstalada"},
        headers=h,
    )
    assert done.status_code == 200 and done.json()["closing_note"] == "Barrera reinstalada"
    assert done.json()["resolved_at"] and done.json()["resolved_by"] == operator["user"]["id"]
    again = await client.patch(
        f"/api/v1/tasks/{task['id']}", json={"status": "done", "closing_note": "otra"}, headers=h
    )
    assert again.status_code == 409

    ready = (await client.get("/api/v1/tasks?view=listos", headers=h)).json()
    assert ids(ready) == {task["title"]} and ready["counts"]["listos"] == 1
    assert ready["counts"]["reparaciones_pendientes"] == 1


async def test_technician_cannot_create_tasks_but_supervisor_can(client, operator, station):
    body = {
        "title": "Revisar boya SK-09",
        "kind": "maintenance",
        "priority": "urgent",
        "station_id": station["id"],
    }
    assert (await client.post("/api/v1/tasks", json=body, headers=operator["headers"])).status_code == 403
    sup = await client.post(
        "/api/v1/auth/login", json={"email": "supervisor@atlmonitor.mx", "password": PASSWORD}
    )
    h = {"Authorization": f"Bearer {sup.json()['access_token']}"}
    r = await client.post("/api/v1/tasks", json=body, headers=h)
    assert r.status_code == 201 and r.json()["status"] == "pending"


async def test_skimmer_collection_updates_waste_totals_and_streams(client, container, operator, station):
    h = operator["headers"]
    tasks = (await client.get("/api/v1/tasks", headers=h)).json()["items"]
    emptying = next(t for t in tasks if t["kind"] == "skimmer_collection")
    body = {
        "station_id": station["id"],
        "buoy_code": "SK-01",
        "buoy_condition": "saturada",
        "plastico": {"kg": 2.5, "piezas": 40},
        "organico": {"kg": 1.0, "piezas": 12},
        "metal": {"kg": 0.5, "piezas": 3},
        "task_id": emptying["id"],
    }
    r = await client.post("/api/v1/skimmers/recoleccion", json=body, headers=h)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["total_kg"] == 4.0 and out["total_pieces"] == 55 and out["operator_name"]
    assert out["materials"]["vidrio"] == {"kg": 0, "piezas": 0}

    summary = (await client.get("/api/v1/skimmers/clasificacion-basura")).json()
    by = {m["material"]: m for m in summary["por_material"]}
    assert summary["total_kg"] == 4.0 and summary["total_piezas"] == 55 and summary["recolecciones"] == 1
    assert by["plastico"] == {
        "material": "plastico",
        "waste_type": "plastic",
        "kg": 2.5,
        "piezas": 40,
        "pct": 62.5,
    }
    assert by["vidrio"]["kg"] == 0 and summary["por_material"][0]["material"] == "plastico"

    # lo que ve la tarjeta del dashboard (/analytics/waste) y la tarea de vaciado quedó cerrada
    waste = (await client.get("/api/v1/analytics/waste?bucket=1h")).json()
    kinds = {t["waste_type"]: t["weight_kg"] for t in waste["by_type"]}
    assert kinds["plastic"] == 2.5 and kinds["organic"] == 1.0 and kinds["metal"] == 0.5
    assert (await client.get(f"/api/v1/tasks/{emptying['id']}", headers=h)).json()["status"] == "done"

    # WebSocket: un `waste_collected` por material con peso + el evento de la bitácora
    types = [e.type.value for e in container.broker.published]
    assert types.count("waste_collected") == 3 and types.count("skimmer_collected") == 1


async def test_collection_validation(client, operator, station):
    h = operator["headers"]
    base = {"station_id": station["id"], "buoy_code": "SK-01", "buoy_condition": "ok"}
    empty = await client.post("/api/v1/skimmers/recoleccion", json=base, headers=h)
    assert empty.status_code == 422 and empty.json()["error"]["code"] == "invalid_data"
    neg = await client.post("/api/v1/skimmers/recoleccion", json={**base, "metal": {"kg": -1}}, headers=h)
    assert neg.status_code == 422
    nostation = await client.post(
        "/api/v1/skimmers/recoleccion",
        json={**base, "station_id": "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b", "metal": {"kg": 1}},
        headers=h,
    )
    assert nostation.status_code == 404
