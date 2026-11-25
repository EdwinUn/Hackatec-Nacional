"""Módulo de operaciones: login, usuarios, reportes ciudadanos y órdenes de trabajo."""

import base64

import pytest

from app.application.events import EventType

V1 = "/api/v1"
JPEG = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0" + b"0" * 200 + b"\xff\xd9").decode()
ACCOUNTS = [
    {"name": "Luis Hernández", "email": "tecnico@demo.mx", "role": "technician", "password": "demo123"},
    {"name": "Ana Ramírez", "email": "tecnico2@demo.mx", "role": "technician", "password": "demo123"},
    {"name": "Mariana López", "email": "supervisor@demo.mx", "role": "supervisor", "password": "demo123"},
    {"name": "Admin Demo", "email": "admin@demo.mx", "role": "admin", "password": "demo123"},
]


@pytest.fixture
async def staff(client, container):
    """{rol corto: {"token", "user", "h" (headers con Bearer y sin llave)}}."""
    await container.staff.ensure_demo_users(ACCOUNTS)
    out = {}
    for key, email in (
        ("tec", "tecnico@demo.mx"),
        ("tec2", "tecnico2@demo.mx"),
        ("sup", "supervisor@demo.mx"),
        ("admin", "admin@demo.mx"),
    ):
        r = await client.post(f"{V1}/auth/login", json={"email": email, "password": "demo123"})
        assert r.status_code == 200, r.text
        body = r.json()
        out[key] = {
            "token": body["access_token"],
            "user": body["user"],
            "h": {"Authorization": f"Bearer {body['access_token']}", "X-API-Key": ""},
        }
    return out


async def new_report(client, **kw):
    body = {
        "type": "discharge",
        "description": "Tubo con espuma",
        "photo": None,
        "latitude": 19.0190,
        "longitude": -98.2440,
        "accuracy": 12,
    } | kw
    return await client.post(f"{V1}/citizen-reports", json=body, headers={"X-API-Key": ""})


# ── Autenticación ───────────────────────────────
async def test_login_returns_token_and_user(client, staff):
    r = await client.post(f"{V1}/auth/login", json={"email": "  TECNICO@demo.MX ", "password": "demo123"})
    body = r.json()
    assert r.status_code == 200
    assert body["token_type"] == "bearer" and body["expires_in"] == 43200
    assert body["user"] == staff["tec"]["user"]
    assert "password" not in str(body["user"]) and body["user"]["role"] == "technician"


@pytest.mark.parametrize("email", ["tecnico@demo.mx", "nadie@demo.mx"])
async def test_bad_credentials_do_not_reveal_which_failed(client, staff, email):
    r = await client.post(f"{V1}/auth/login", json={"email": email, "password": "otra"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_credentials"


async def test_missing_or_invalid_bearer_is_401(client, staff):
    assert (await client.get(f"{V1}/work-orders")).json()["error"]["code"] == "unauthorized"
    r = await client.get(f"{V1}/work-orders", headers={"Authorization": "Bearer basura"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"


# ── Usuarios ────────────────────────────────────
async def test_managers_list_users_but_only_admin_manages_them(client, staff):
    for who in ("admin", "sup"):  # el supervisor necesita ver a los técnicos para asignar órdenes
        r = await client.get(f"{V1}/users", headers=staff[who]["h"])
        assert [u["name"] for u in r.json()] == sorted(a["name"] for a in ACCOUNTS)
    r = await client.get(f"{V1}/users", headers=staff["tec"]["h"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    new = {"name": "X", "email": "x@demo.mx", "role": "technician", "password": "demo123"}
    assert (await client.post(f"{V1}/users", json=new, headers=staff["sup"]["h"])).status_code == 403


async def test_create_user_and_duplicates(client, staff):
    h = staff["admin"]["h"]
    body = {"name": "Pedro", "email": "Pedro@Demo.mx", "role": "technician", "password": "secreto1"}
    r = await client.post(f"{V1}/users", json=body, headers=h)
    assert r.status_code == 201 and r.json()["email"] == "pedro@demo.mx"
    assert (await client.post(f"{V1}/users", json=body, headers=h)).status_code == 409
    short = body | {"email": "otro@demo.mx", "password": "123"}
    assert (await client.post(f"{V1}/users", json=short, headers=h)).status_code == 422


async def test_admin_cannot_lock_themselves_out(client, staff):
    admin = staff["admin"]
    for change in ({"active": False}, {"role": "supervisor"}):
        r = await client.patch(f"{V1}/users/{admin['user']['id']}", json=change, headers=admin["h"])
        assert r.status_code == 409


async def test_deactivated_user_loses_session_and_login(client, staff):
    tec = staff["tec"]
    r = await client.patch(
        f"{V1}/users/{tec['user']['id']}", json={"active": False}, headers=staff["admin"]["h"]
    )
    assert r.json()["active"] is False
    assert (await client.get(f"{V1}/work-orders", headers=tec["h"])).status_code == 401
    r = await client.post(f"{V1}/auth/login", json={"email": "tecnico@demo.mx", "password": "demo123"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "inactive"


# ── Reportes ciudadanos ─────────────────────────
async def test_public_report_with_photo_links_nearest_station(client, container, station):
    r = await new_report(client, photo=JPEG)
    assert r.status_code == 201, r.text
    report = r.json()
    assert report["folio"] == "RC-0001" and report["status"] == "new"
    assert report["station_id"] == station["id"]  # a menos de 8 km
    assert report["photo"].startswith("http://test/media/") and report["photo"].endswith(".jpg")
    media = await client.get(report["photo"].removeprefix("http://test"))
    assert media.status_code == 200 and media.content.startswith(b"\xff\xd8")

    far = (await new_report(client, latitude=18.5, longitude=-97.0)).json()
    assert far["folio"] == "RC-0002" and far["station_id"] is None

    [event] = [e for e in container.broker.published if e.type is EventType.CITIZEN_REPORT_CREATED][:1]
    assert event.data["folio"] == "RC-0001" and event.data["photo"] is None
    assert str(event.station_id) == station["id"]


async def test_report_validation(client):
    r = await new_report(client, description="  ", photo=None)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    r = await new_report(client, photo="data:image/gif;base64,R0lGOD")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_data"
    assert (await new_report(client, latitude=120)).status_code == 422


async def test_reports_are_rate_limited_per_ip(client):
    for _ in range(5):
        assert (await new_report(client)).status_code == 201
    r = await new_report(client)
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"


async def test_public_list_and_folio_lookup(client):
    await new_report(client)
    await new_report(client, type="trash")
    listed = (await client.get(f"{V1}/citizen-reports", headers={"X-API-Key": ""})).json()
    assert [r["folio"] for r in listed] == ["RC-0002", "RC-0001"]
    assert (await client.get(f"{V1}/citizen-reports/by-folio/rc-0001")).json()["folio"] == "RC-0001"
    r = await client.get(f"{V1}/citizen-reports/by-folio/RC-9999")
    assert r.status_code == 404 and "RC-9999" in r.json()["error"]["message"]


async def test_only_managers_moderate_reports(client, staff):
    report = (await new_report(client)).json()
    body = {"status": "rejected", "public_note": "Duplicado de RC-0003"}
    r = await client.patch(f"{V1}/citizen-reports/{report['id']}", json=body, headers=staff["tec"]["h"])
    assert r.status_code == 403
    r = await client.patch(f"{V1}/citizen-reports/{report['id']}", json=body, headers=staff["sup"]["h"])
    assert r.json()["status"] == "rejected" and r.json()["public_note"] == "Duplicado de RC-0003"


# ── Órdenes de trabajo ──────────────────────────
async def create_order(client, staff, **kw):
    body = {
        "type": "waste_collection",
        "title": "Vaciar contenedor",
        "description": "",
        "priority": "normal",
        "station_id": None,
    } | kw
    r = await client.post(f"{V1}/work-orders", json=body, headers=staff["sup"]["h"])
    assert r.status_code == 201, r.text
    return r.json()


async def test_create_order_defaults(client, container, staff, station):
    tec = staff["tec"]["user"]
    o = await create_order(client, staff, station_id=station["id"], assigned_to=tec["id"])
    assert o["folio"] == "OT-0001" and o["status"] == "assigned"
    assert o["station_name"] == station["name"] and o["assigned_name"] == tec["name"]
    assert o["created_by"] == staff["sup"]["user"]["id"]
    assert o["location"] == {"latitude": station["latitude"], "longitude": station["longitude"]}
    assert [i["key"] for i in o["checklist"]] == ["container", "sorted", "weighed"]
    [event] = [e for e in container.broker.published if e.type is EventType.WORK_ORDER_ASSIGNED]
    assert event.data["assigned_to"] == tec["id"]

    pending = await create_order(client, staff)
    assert pending["status"] == "pending" and pending["location"] is None


async def test_create_order_rejects_unknown_references_and_technicians(client, staff):
    bad = {"type": "maintenance", "title": "x", "station_id": "00000000-0000-0000-0000-000000000000"}
    r = await client.post(f"{V1}/work-orders", json=bad, headers=staff["sup"]["h"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_data"
    r = await client.post(
        f"{V1}/work-orders", json={"type": "maintenance", "title": "x"}, headers=staff["tec"]["h"]
    )
    assert r.status_code == 403


async def test_technician_sees_only_own_orders(client, staff):
    mine = await create_order(client, staff, assigned_to=staff["tec"]["user"]["id"])
    other = await create_order(client, staff, assigned_to=staff["tec2"]["user"]["id"])
    h = staff["tec"]["h"]
    listed = (
        await client.get(f"{V1}/work-orders", params={"assigned_to": other["assigned_to"]}, headers=h)
    ).json()
    assert [o["id"] for o in listed] == [mine["id"]]
    assert (await client.get(f"{V1}/work-orders/{other['id']}", headers=h)).status_code == 404
    assert (
        await client.patch(f"{V1}/work-orders/{other['id']}", json={"notes": "x"}, headers=h)
    ).status_code == 404
    everything = (await client.get(f"{V1}/work-orders", headers=staff["sup"]["h"])).json()
    assert len(everything) == 2
    filtered = (
        await client.get(f"{V1}/work-orders", params={"status": "assigned,done"}, headers=staff["sup"]["h"])
    ).json()
    assert len(filtered) == 2


async def test_citizen_report_flow_cascades_to_the_report(client, staff):
    report = (await new_report(client)).json()
    tec = staff["tec"]
    o = await create_order(
        client,
        staff,
        type="citizen_report",
        title="Revisar descarga",
        citizen_report_id=report["id"],
        assigned_to=tec["user"]["id"],
    )
    assert o["location"] == {"latitude": report["latitude"], "longitude": report["longitude"]}
    seen = (await client.get(f"{V1}/citizen-reports/by-folio/{report['folio']}")).json()
    assert seen["status"] == "verified" and seen["work_order_id"] == o["id"]

    url = f"{V1}/work-orders/{o['id']}"
    r = await client.patch(
        url,
        json={
            "status": "in_progress",
            "check_in": {"latitude": 19.02, "longitude": -98.24, "accuracy": 8, "ts": "2026-11-24T10:00:00Z"},
        },
        headers=tec["h"],
    )
    assert r.json()["status"] == "in_progress" and r.json()["started_at"] is not None
    assert (await client.get(f"{V1}/citizen-reports/by-folio/{report['folio']}")).json()[
        "status"
    ] == "in_progress"

    r = await client.patch(url, json={"status": "done"}, headers=tec["h"])
    assert r.status_code == 422  # falta el resultado

    done = {
        "status": "done",
        "checklist": [{"key": k, "label": "", "done": True} for k in ("arrived", "assessed", "action")],
        "evidence": [{"kind": "after", "photo": JPEG, "ts": "2026-11-24T10:30:00Z"}],
        "result": {"confirmed": True, "action_taken": "Se dio aviso a CONAGUA"},
    }
    r = await client.patch(url, json=done, headers=tec["h"])
    order = r.json()
    assert order["status"] == "done" and order["completed_at"] is not None
    assert order["checklist"][0]["label"] == "Llegué al punto reportado"  # el servidor pone los textos
    assert order["evidence"][0]["photo"].startswith("http://test/media/")
    seen = (await client.get(f"{V1}/citizen-reports/by-folio/{report['folio']}")).json()
    assert seen["status"] == "resolved" and seen["public_note"] == "Se dio aviso a CONAGUA"

    # Reenviar la evidencia ya guardada (URL) no la duplica ni falla (el técnico ya no puede: la cerró).
    r = await client.patch(url, json={"evidence": order["evidence"]}, headers=staff["sup"]["h"])
    assert r.json()["evidence"][0]["photo"] == order["evidence"][0]["photo"]

    assert (await client.patch(url, json={"status": "verified"}, headers=tec["h"])).status_code == 403
    r = await client.patch(url, json={"status": "verified"}, headers=staff["sup"]["h"])
    assert r.json()["status"] == "verified" and r.json()["verified_at"] is not None


async def test_unconfirmed_report_is_rejected_with_default_note(client, staff):
    report = (await new_report(client)).json()
    o = await create_order(
        client,
        staff,
        type="citizen_report",
        title="Revisar",
        citizen_report_id=report["id"],
        assigned_to=staff["tec"]["user"]["id"],
    )
    url, h = f"{V1}/work-orders/{o['id']}", staff["tec"]["h"]
    await client.patch(url, json={"status": "in_progress"}, headers=h)
    await client.patch(url, json={"status": "done", "result": {"confirmed": False}}, headers=h)
    seen = (await client.get(f"{V1}/citizen-reports/by-folio/{report['folio']}")).json()
    assert (
        seen["status"] == "rejected"
        and seen["public_note"] == "La brigada no encontró el problema reportado."
    )


async def test_invalid_transitions_and_technician_limits(client, staff):
    o = await create_order(client, staff, assigned_to=staff["tec"]["user"]["id"])
    url, h = f"{V1}/work-orders/{o['id']}", staff["tec"]["h"]
    r = await client.patch(url, json={"status": "verified"}, headers=staff["sup"]["h"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_transition"
    assert r.json()["error"]["message"] == "No se puede pasar de «asignada» a «verificada»"
    assert (await client.patch(url, json={"priority": "urgent"}, headers=h)).status_code == 403
    r = await client.patch(url, json={"checklist": [{"key": "inventada", "done": True}]}, headers=h)
    assert r.status_code == 422
    assert (
        await client.patch(url, json={"status": "assigned"}, headers=h)
    ).status_code == 200  # mismo estado


async def test_reassigning_and_unassigning(client, container, staff):
    o = await create_order(client, staff)
    url, h = f"{V1}/work-orders/{o['id']}", staff["sup"]["h"]
    container.broker.published.clear()
    r = await client.patch(url, json={"assigned_to": staff["tec2"]["user"]["id"]}, headers=h)
    assert r.json()["status"] == "assigned" and r.json()["assigned_name"] == "Ana Ramírez"
    assert [e.type for e in container.broker.published] == [EventType.WORK_ORDER_ASSIGNED]
    r = await client.patch(url, json={"assigned_to": None}, headers=h)
    assert r.json()["status"] == "pending" and r.json()["assigned_to"] is None


async def test_closing_waste_collection_requires_weight(client, staff):
    o = await create_order(client, staff, assigned_to=staff["tec"]["user"]["id"])
    url, h = f"{V1}/work-orders/{o['id']}", staff["tec"]["h"]
    await client.patch(url, json={"status": "in_progress"}, headers=h)
    bad = await client.patch(
        url, json={"status": "done", "result": {"waste_type": "plastic", "weight_kg": 0}}, headers=h
    )
    assert bad.status_code == 422
    ok = await client.patch(
        url,
        json={"status": "done", "result": {"waste_type": "plastic", "weight_kg": 6.2, "items_count": 41}},
        headers=h,
    )
    assert ok.json()["result"] == {"waste_type": "plastic", "weight_kg": 6.2, "items_count": 41}


# ── Efectos con el Bearer del personal ──────────
async def test_effect_endpoints_accept_staff_bearer_or_api_key(client, staff, station):
    url = f"{V1}/stations/{station['id']}"
    r = await client.patch(url, json={"status": "maintenance"}, headers=staff["tec"]["h"])
    assert r.status_code == 200 and r.json()["status"] == "maintenance"
    r = await client.patch(url, json={"status": "active"})  # X-API-Key del cliente de pruebas
    assert r.status_code == 200
    r = await client.patch(url, json={"status": "active"}, headers={"X-API-Key": ""})
    assert r.status_code == 401
    waste = {
        "station_id": station["id"],
        "weight_kg": 6.2,
        "items_count": 41,
        "waste_type": "plastic",
        "collector_id": "tecnico@demo.mx",
    }
    assert (
        await client.post(f"{V1}/waste-collections", json=waste, headers=staff["tec"]["h"])
    ).status_code == 201
    # La ingesta de lecturas sigue exigiendo la llave.
    assert (
        await client.post(f"{V1}/readings", json={"readings": []}, headers=staff["tec"]["h"])
    ).status_code == 401


# ── Revisión de código: regresiones ─────────────
async def _closed_report_order(client, staff, final: str):
    report = (await new_report(client)).json()
    o = await create_order(
        client,
        staff,
        type="citizen_report",
        title="Revisar",
        citizen_report_id=report["id"],
        assigned_to=staff["tec"]["user"]["id"],
    )
    url, tec = f"{V1}/work-orders/{o['id']}", staff["tec"]["h"]
    await client.patch(url, json={"status": "in_progress"}, headers=tec)
    await client.patch(
        url, json={"status": "done", "result": {"confirmed": True, "action_taken": "Limpio"}}, headers=tec
    )
    if final == "verified":
        await client.patch(url, json={"status": "verified"}, headers=staff["sup"]["h"])
    return report, url


@pytest.mark.parametrize("final", ["done", "verified"])
async def test_finished_orders_cannot_be_edited_by_technicians(client, staff, final):
    report, url = await _closed_report_order(client, staff, final)
    r = await client.patch(
        url, json={"result": {"confirmed": False, "action_taken": "x"}}, headers=staff["tec"]["h"]
    )
    assert r.status_code == 409
    seen = (await client.get(f"{V1}/citizen-reports/by-folio/{report['folio']}")).json()
    assert seen["status"] == "resolved" and seen["public_note"] == "Limpio"


async def test_final_orders_only_accept_status_and_cannot_be_reassigned(client, staff):
    _, url = await _closed_report_order(client, staff, "verified")
    sup = staff["sup"]["h"]
    assert (await client.patch(url, json={"notes": "tarde"}, headers=sup)).status_code == 409
    r = await client.patch(url, json={"assigned_to": staff["tec2"]["user"]["id"]}, headers=sup)
    assert r.status_code == 409


async def test_cascade_does_not_override_manual_moderation(client, staff):
    report = (await new_report(client)).json()
    o = await create_order(
        client,
        staff,
        type="citizen_report",
        title="Revisar",
        citizen_report_id=report["id"],
        assigned_to=staff["tec"]["user"]["id"],
    )
    await client.patch(
        f"{V1}/citizen-reports/{report['id']}",
        json={"status": "rejected", "public_note": "Duplicado"},
        headers=staff["sup"]["h"],
    )
    await client.patch(
        f"{V1}/work-orders/{o['id']}", json={"notes": "voy en camino"}, headers=staff["tec"]["h"]
    )
    seen = (await client.get(f"{V1}/citizen-reports/by-folio/{report['folio']}")).json()
    assert seen["status"] == "rejected" and seen["public_note"] == "Duplicado"


async def test_report_cannot_be_linked_to_two_active_orders(client, staff):
    report = (await new_report(client)).json()
    await create_order(client, staff, type="citizen_report", title="A", citizen_report_id=report["id"])
    body = {"type": "citizen_report", "title": "B", "citizen_report_id": report["id"]}
    r = await client.post(f"{V1}/work-orders", json=body, headers=staff["sup"]["h"])
    assert r.status_code == 409


async def test_login_is_rate_limited(client, staff):
    for _ in range(10):
        await client.post(f"{V1}/auth/login", json={"email": "admin@demo.mx", "password": "mala"})
    r = await client.post(f"{V1}/auth/login", json={"email": "admin@demo.mx", "password": "demo123"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"


async def test_oversized_body_is_rejected_before_parsing(client):
    r = await client.post(
        f"{V1}/citizen-reports",
        content=b"x" * (3 * 1024 * 1024),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 413 and r.json()["error"]["code"] == "payload_too_large"


async def test_non_finite_numbers_are_validation_errors(client, staff):
    r = await client.post(
        f"{V1}/citizen-reports",
        content=b'{"type":"trash","description":"x","latitude":19,"longitude":-98,"accuracy":Infinity}',
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 422


async def test_evidence_must_reference_stored_media(client, staff):
    o = await create_order(client, staff, assigned_to=staff["tec"]["user"]["id"])
    url, h = f"{V1}/work-orders/{o['id']}", staff["tec"]["h"]
    ev = {"kind": "after", "photo": "media/../api/v1/x", "ts": "2026-11-24T10:00:00Z"}
    assert (await client.patch(url, json={"evidence": [ev]}, headers=h)).status_code == 422
    two_after = [{"kind": "after", "photo": JPEG, "ts": "2026-11-24T10:00:00Z"}] * 2
    assert (await client.patch(url, json={"evidence": two_after}, headers=h)).status_code == 422


async def test_successful_logins_do_not_count_toward_the_limit(client, staff):
    for _ in range(15):
        r = await client.post(f"{V1}/auth/login", json={"email": "tecnico@demo.mx", "password": "demo123"})
        assert r.status_code == 200
