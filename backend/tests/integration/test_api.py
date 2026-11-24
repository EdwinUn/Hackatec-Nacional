from datetime import UTC, datetime, timedelta

import pytest

from app.application.events import EventType

V1 = "/api/v1"


def now() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


async def post_readings(client, readings):
    r = await client.post(f"{V1}/readings", json={"readings": readings})
    assert r.status_code == 200, r.text
    return r.json()


# ── Utilidad / errores ─────────────────────────
async def test_health_reports_dependencies(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() | {"version": "x"} == {
        "status": "ok",
        "api": "ok",
        "postgres": "ok",
        "redis": "disabled",
        "version": "x",
    }


async def test_ingest_requires_api_key(client):
    r = await client.post(f"{V1}/readings", json={"readings": []}, headers={"X-API-Key": "nope"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


async def test_validation_errors_use_single_format(client):
    r = await client.post(f"{V1}/stations", json={"name": "x"})
    body = r.json()
    assert r.status_code == 422
    assert body["error"]["code"] == "validation_error"
    assert isinstance(body["error"]["details"], list)


async def test_not_found_uses_single_format(client):
    r = await client.get(f"{V1}/sensors/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404
    assert r.json()["error"] == {"code": "not_found", "message": "Sensor no encontrado", "details": None}


# ── Catálogo ───────────────────────────────────
async def test_sensor_defaults_and_filters(client, station, sensors):
    ph = sensors[("ph", "inlet")]
    assert ph["unit"] == "pH" and ph["valid_min"] == 0 and ph["valid_max"] == 14
    assert ph["status"] == "offline"  # aún no reporta
    r = await client.get(f"{V1}/sensors", params={"station_id": station["id"], "type": "ph"})
    assert r.json()["total"] == 2

    r = await client.patch(f"{V1}/stations/{station['id']}", json={"status": "maintenance"})
    assert r.json()["status"] == "maintenance"
    r = await client.get(f"{V1}/stations", params={"status": "maintenance"})
    assert r.json()["total"] == 1


# ── Ingesta de lecturas ────────────────────────
async def test_readings_accept_reject_and_are_idempotent(client, container, sensors):
    ph = sensors[("ph", "inlet")]["id"]
    t = now() - timedelta(minutes=1)
    batch = [
        {"sensor_id": ph, "ts": iso(t), "value": 7.1, "quality": 0.95},
        {"sensor_id": ph, "ts": iso(t + timedelta(seconds=5)), "value": 15.2},  # imposible
        {"sensor_id": "00000000-0000-0000-0000-000000000000", "ts": iso(t), "value": 7.0},
        {"sensor_id": ph, "ts": iso(now() + timedelta(hours=1)), "value": 7.0},  # futuro
    ]
    result = await post_readings(client, batch)
    assert (result["received"], result["accepted"], result["duplicates"]) == (4, 1, 0)
    assert sorted(r["reason"] for r in result["rejected"]) == [
        "future_timestamp",
        "impossible_value",
        "unknown_sensor",
    ]

    again = await post_readings(client, batch[:1])
    assert (again["accepted"], again["duplicates"]) == (0, 1)

    sensor = (await client.get(f"{V1}/sensors/{ph}")).json()
    assert sensor["status"] == "ok"
    assert sensor["last_seen_at"] is not None
    types = [e.type for e in container.broker.published]
    assert types.count(EventType.READING) == 1
    assert EventType.SENSOR_STATUS in types


async def test_calibration_is_applied(client, sensors):
    ph = sensors[("ph", "inlet")]["id"]
    await client.patch(f"{V1}/sensors/{ph}", json={"calibration_offset": 0.5})
    await post_readings(client, [{"sensor_id": ph, "ts": iso(now()), "value": 7.0}])
    health = (await client.get(f"{V1}/analytics/sensors/health")).json()
    assert next(h for h in health if h["sensor_id"] == ph)["last_value"] == pytest.approx(7.5)


async def test_out_of_range_reading_opens_one_alert_without_spam(client, container, sensors):
    ph = sensors[("ph", "inlet")]["id"]
    t = now() - timedelta(minutes=2)
    first = await post_readings(client, [{"sensor_id": ph, "ts": iso(t), "value": 5.0}])
    # 5.0 viola "pH fuera del rango aceptable" (warning) y "pH extremo" (critical)
    assert first["alerts_triggered"] == 2
    second = await post_readings(
        client, [{"sensor_id": ph, "ts": iso(t + timedelta(seconds=10)), "value": 4.9}]
    )
    assert second["alerts_triggered"] == 0  # anti-spam

    alerts = (await client.get(f"{V1}/alerts", params={"severity": "critical"})).json()
    assert alerts["total"] == 1
    alert = alerts["items"][0]
    assert alert["occurrences"] == 2 and alert["trigger_value"] == 4.9
    assert alert["status"] == "open" and alert["sensor_id"] == ph
    assert [e.type for e in container.broker.published].count(EventType.ALERT) == 2

    # Reconocer y resolver; una alerta resuelta no se reabre: la próxima violación crea otra.
    r = await client.patch(f"{V1}/alerts/{alert['id']}", json={"status": "acknowledged", "note": "ok"})
    assert r.json()["status"] == "acknowledged" and r.json()["acknowledged_at"]
    r = await client.patch(f"{V1}/alerts/{alert['id']}", json={"status": "resolved"})
    assert r.json()["status"] == "resolved"
    r = await client.patch(f"{V1}/alerts/{alert['id']}", json={"status": "resolved"})
    assert r.status_code == 409

    third = await post_readings(
        client, [{"sensor_id": ph, "ts": iso(t + timedelta(seconds=20)), "value": 4.8}]
    )
    assert third["alerts_triggered"] == 1


async def test_active_alert_is_renotified_after_interval(client, container, sensors):
    ph = sensors[("ph", "inlet")]["id"]
    t = now() - timedelta(hours=1)
    await post_readings(client, [{"sensor_id": ph, "ts": iso(t), "value": 5.0}])
    # 30 min después (> 15 min de re-notificación): misma alerta, pero se vuelve a emitir.
    again = await post_readings(
        client, [{"sensor_id": ph, "ts": iso(t + timedelta(minutes=30)), "value": 5.1}]
    )
    assert again["alerts_triggered"] == 2
    assert (await client.get(f"{V1}/alerts")).json()["total"] == 2


async def test_alert_rules_are_configurable(client, sensors):
    rules = (await client.get(f"{V1}/alert-rules")).json()
    ph_rule = next(r for r in rules if r["name"] == "pH fuera del rango aceptable")
    assert (ph_rule["min_value"], ph_rule["max_value"]) == (6.5, 8.5)
    await client.patch(f"{V1}/alert-rules/{ph_rule['id']}", json={"min_value": 7.5})
    ph = sensors[("ph", "inlet")]["id"]
    result = await post_readings(client, [{"sensor_id": ph, "ts": iso(now()), "value": 7.2}])
    assert result["alerts_triggered"] == 1


# ── Operación de la máquina ────────────────────
async def test_cycle_lifecycle_and_vibration_alert(client, station):
    r = await client.post(f"{V1}/centrifuge-cycles", json={"station_id": station["id"], "rpm_avg": 2800})
    assert r.status_code == 201
    cycle = r.json()
    assert cycle["status"] == "running"

    r = await client.patch(f"{V1}/centrifuge-cycles/{cycle['id']}", json={"vibration_mm_s": 8.2})
    assert r.json()["vibration_mm_s"] == 8.2
    alerts = (await client.get(f"{V1}/alerts", params={"station_id": station["id"]})).json()
    assert {a["severity"] for a in alerts["items"]} == {"warning", "critical"}

    r = await client.patch(
        f"{V1}/centrifuge-cycles/{cycle['id']}",
        json={"status": "failed", "failure_reason": "desbalance"},
    )
    assert r.json()["status"] == "failed" and r.json()["duration_s"] is not None
    r = await client.patch(f"{V1}/centrifuge-cycles/{cycle['id']}", json={"rpm_avg": 1})
    assert r.status_code == 409


async def test_batch_efficiency_and_water_recovery(client, station):
    for vin, vclean in ((500, 450), (500, 400)):
        r = await client.post(
            f"{V1}/treatment-batches",
            json={
                "station_id": station["id"],
                "volume_in_l": vin,
                "volume_clean_l": vclean,
                "sludge_kg": 2,
                "ph_in": 5.5,
                "ph_out": 6.9,
                "turbidity_in_ntu": 80,
                "turbidity_out_ntu": 4,
            },
        )
        assert r.status_code == 201, r.text
    assert r.json()["efficiency_pct"] == 80.0
    assert r.json()["ph_shift_toward_neutral"] == pytest.approx(1.4)
    assert r.json()["turbidity_removal_pct"] == 95.0

    bad = await client.post(
        f"{V1}/treatment-batches",
        json={"station_id": station["id"], "volume_in_l": 100, "volume_clean_l": 120},
    )
    assert bad.status_code == 422

    water = (await client.get(f"{V1}/analytics/water-recovery", params={"bucket": "1h"})).json()
    assert water["total"] == {
        "batches": 2,
        "water_in_l": 1000,
        "water_clean_l": 850,
        "water_lost_l": 150,
        "sludge_kg": 4,
        "efficiency_pct": 85.0,
    }
    assert sum(p["batches"] for p in water["series"]) == 2


async def test_waste_by_type(client, station):
    for kind, kg in (("plastic", 1.5), ("plastic", 0.5), ("metal", 2.0)):
        r = await client.post(
            f"{V1}/waste-collections",
            json={"station_id": station["id"], "weight_kg": kg, "items_count": 3, "waste_type": kind},
        )
        assert r.status_code == 201
    waste = (await client.get(f"{V1}/analytics/waste")).json()
    assert waste["total_kg"] == 4.0 and waste["total_items"] == 9
    assert {w["waste_type"]: w["weight_kg"] for w in waste["by_type"]} == {"plastic": 2.0, "metal": 2.0}


# ── Dashboard ──────────────────────────────────
async def test_ph_series_overview_hotspots_and_forecast(client, station, sensors):
    ph_in, ph_out = sensors[("ph", "inlet")]["id"], sensors[("ph", "outlet")]["id"]
    turb = sensors[("turbidity", "inlet")]["id"]
    start = now() - timedelta(hours=2)
    # Valores con variación: una serie constante haría que el dominio marque el sensor como fault.
    readings = []
    for i in range(0, 120, 5):  # cada 5 min durante 2 h
        ts = iso(start + timedelta(minutes=i))
        readings += [
            {"sensor_id": ph_in, "ts": ts, "value": 6.0 + i / 200},
            {"sensor_id": ph_out, "ts": ts, "value": 7.0 + (i % 10) / 1000},
            {"sensor_id": turb, "ts": ts, "value": 20 + i % 3},
        ]
    await post_readings(client, readings)

    series = (
        await client.get(f"{V1}/analytics/ph", params={"station_id": station["id"], "bucket": "1h"})
    ).json()
    assert len(series["points"]) in (2, 3)
    point = series["points"][0]
    assert point["inlet"]["count"] > 0 and point["outlet"]["avg"] == pytest.approx(7.0, abs=0.01)
    assert series["avg_shift_toward_neutral"] > 0

    overview = (await client.get(f"{V1}/dashboard/overview", params={"station_id": station["id"]})).json()
    assert overview["ph_outlet"]["value"] == pytest.approx(7.0, abs=0.01)
    assert overview["sensors_online"] == overview["sensors_total"] == 3
    assert overview["wqi"]["category"] in ("excelente", "buena", "regular")
    assert {c["parameter"] for c in overview["wqi"]["components"]} == {"ph", "turbidity"}
    assert "from" in overview and "to" in overview

    hotspots = (await client.get(f"{V1}/analytics/hotspots")).json()
    assert hotspots[0]["latitude"] == 19.0185 and hotspots[0]["wqi"] is not None

    forecast = (
        await client.get(
            f"{V1}/analytics/forecast/ph", params={"station_id": station["id"], "horizon": 2, "lookback": 3}
        )
    ).json()
    assert forecast["slope_per_hour"] > 0  # el pH de entrada va subiendo
    assert len(forecast["points"]) == 8  # 2 h en pasos de 15 min

    health = (await client.get(f"{V1}/analytics/sensors/health", params={"station_id": station["id"]})).json()
    assert len(health) == 3 and all(h["uptime_pct"] > 0 for h in health)


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-11-24T00:00:00Z", "to": "2026-11-23T00:00:00Z"},
        {"from": "2026-11-23T00:00:00"},  # sin zona horaria
        {"from": "2025-01-01T00:00:00Z", "to": "2026-01-01T00:00:00Z"},  # > 90 días
        {"bucket": "1m", "from": "2026-08-01T00:00:00Z", "to": "2026-10-01T00:00:00Z"},  # demasiados buckets
        {"bucket": "2h"},
    ],
)
async def test_time_range_validation(client, params):
    r = await client.get(f"{V1}/analytics/ph", params=params)
    assert r.status_code == 422
    assert r.json()["error"]["code"] in ("invalid_data", "validation_error")


# ── Datos inválidos que llegan a la BD: nunca 500 ──
async def test_duplicate_station_name_is_conflict(client, station):
    r = await client.post(
        f"{V1}/stations",
        json={"name": station["name"], "river": "Otro", "latitude": 19, "longitude": -98},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "conflict"


@pytest.mark.parametrize("body", [{"name": None}, {"latitude": None}, {"status": None}])
async def test_station_patch_rejects_null_for_required_fields(client, station, body):
    r = await client.patch(f"{V1}/stations/{station['id']}", json=body)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


async def test_station_patch_allows_null_for_optional_fields(client, station):
    r = await client.patch(f"{V1}/stations/{station['id']}", json={"description": None})
    assert r.status_code == 200


async def test_sensor_patch_rejects_null_status(client, sensors):
    sensor = sensors[("ph", "inlet")]
    r = await client.patch(f"{V1}/sensors/{sensor['id']}", json={"status": None})
    assert r.status_code == 422


async def test_rule_for_unknown_station_is_not_found(client):
    r = await client.post(
        f"{V1}/alert-rules",
        json={
            "name": "x",
            "kind": "reading_range",
            "severity": "info",
            "parameter": "ph",
            "min_value": 6,
            "station_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert r.status_code == 404


async def test_overview_has_trend_and_dominant_parameter(client, station, sensors):
    ph_in, ph_out = sensors[("ph", "inlet")]["id"], sensors[("ph", "outlet")]["id"]
    turb = sensors[("turbidity", "inlet")]["id"]
    start = now() - timedelta(hours=3)
    readings = []
    for i in range(0, 180, 10):
        ts = iso(start + timedelta(minutes=i))
        readings += [
            {"sensor_id": ph_in, "ts": ts, "value": 6.0 + i / 1000},
            {"sensor_id": ph_out, "ts": ts, "value": 7.0 + (i % 20) / 1000},
            {"sensor_id": turb, "ts": ts, "value": 150 + i % 7},  # turbidez alta → parámetro dominante
        ]
    await post_readings(client, readings)
    await client.post(
        f"{V1}/treatment-batches",
        json={"station_id": station["id"], "volume_in_l": 500, "volume_clean_l": 450},
    )

    o = (await client.get(f"{V1}/dashboard/overview", params={"station_id": station["id"]})).json()
    assert o["wqi"]["dominant_parameter"] == "turbidity"
    assert o["trend_bucket"] == "1h"
    points = [p for p in o["trend"] if p["wqi"] is not None]
    assert 3 <= len(points) <= 4
    assert all(p["ph_inlet"] is not None and p["ph_outlet"] is not None for p in points)
    assert sum(p["water_clean_l"] for p in o["trend"]) == 450


async def test_cors_allows_any_localhost_port_in_dev(client):
    for origin in ("http://localhost:4200", "http://localhost:40397"):
        r = await client.get("/health", headers={"Origin": origin})
        assert r.headers.get("access-control-allow-origin") == origin
    r = await client.get("/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in r.headers


async def test_critical_points_ranks_the_worst_station_first(client, station, sensors):
    clean = (
        await client.post(
            f"{V1}/stations",
            json={
                "name": "Estación limpia",
                "river": "Río Alseseca",
                "latitude": 18.995,
                "longitude": -98.188,
            },
        )
    ).json()
    clean_ph = (
        await client.post(
            f"{V1}/sensors", json={"station_id": clean["id"], "type": "ph", "location": "inlet"}
        )
    ).json()["id"]
    ph = sensors[("ph", "inlet")]["id"]
    turb = sensors[("turbidity", "inlet")]["id"]
    t = now() - timedelta(minutes=30)
    readings = []
    for i in range(10):
        ts = iso(t + timedelta(minutes=i))
        readings += [
            {"sensor_id": ph, "ts": ts, "value": 4.8 + i / 100},  # pH extremo → alerta crítica
            {"sensor_id": turb, "ts": ts, "value": 250 + i},
            {"sensor_id": clean_ph, "ts": ts, "value": 7.1 + i / 100},
        ]
    await post_readings(client, readings)

    r = await client.get(f"{V1}/analytics/critical-points")
    assert r.status_code == 200
    ranking = r.json()
    assert [p["rank"] for p in ranking] == [1, 2]
    worst, best = ranking
    assert worst["station_id"] == station["id"]
    assert worst["level"] == "critico" and worst["score"] > best["score"]
    assert worst["alerts_active"]["critical"] >= 1 and worst["occurrences"] >= 10
    assert worst["top_issues"][0]["occurrences"] >= 10
    assert any("alerta crítica" in reason for reason in worst["reasons"])
    assert best["level"] == "estable"
