from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.domain.errors import ForbiddenError, InvalidDataError, InvalidTransitionError
from app.domain.operations import (
    CitizenReport,
    ReportStatus,
    ReportType,
    Role,
    WorkOrder,
    WorkOrderStatus,
    WorkOrderType,
    default_checklist,
    format_folio,
    nearest_station,
    report_update_for,
)

NOW = datetime(2026, 11, 24, 12, 0, tzinfo=UTC)
TECH = uuid4()


def order(**kw) -> WorkOrder:
    base = dict(
        folio="OT-0001",
        type=WorkOrderType.WASTE_COLLECTION,
        title="Vaciar",
        description="",
        created_by=uuid4(),
        checklist=default_checklist(WorkOrderType.WASTE_COLLECTION),
    )
    o = WorkOrder(**{**base, **kw})
    return o


# ── Folios y checklist ──────────────────────────
def test_folio_is_zero_padded_and_grows():
    assert format_folio("RC", 42) == "RC-0042"
    assert format_folio("OT", 12345) == "OT-12345"


def test_default_checklist_matches_the_front():
    keys = [i["key"] for i in default_checklist(WorkOrderType.MAINTENANCE)]
    assert keys == ["grid", "centrifuge", "power", "leaks", "housing", "sensors"]
    assert all(i["done"] is False for i in default_checklist(WorkOrderType.CALIBRATION))


def test_checklist_can_be_marked_but_not_extended():
    o = order()
    items = [dict(i, done=True) for i in o.checklist]
    o.set_checklist(items)
    assert all(i["done"] for i in o.checklist)
    with pytest.raises(InvalidDataError):
        o.set_checklist([*items, {"key": "invented", "label": "x", "done": True}])


# ── Asignación ──────────────────────────────────
def test_assigning_moves_pending_to_assigned_and_back():
    o = order()
    assert o.status is WorkOrderStatus.PENDING
    o.assign(TECH)
    assert o.status is WorkOrderStatus.ASSIGNED
    o.assign(None)
    assert o.status is WorkOrderStatus.PENDING


# ── Transiciones ────────────────────────────────
def test_valid_flow_sets_timestamps():
    o = order(assigned_to=TECH, status=WorkOrderStatus.ASSIGNED)
    o.change_status(WorkOrderStatus.IN_PROGRESS, Role.TECHNICIAN, NOW)
    assert o.started_at == NOW
    o.result = {"waste_type": "plastic", "weight_kg": 6.2, "items_count": 41}
    o.change_status(WorkOrderStatus.DONE, Role.TECHNICIAN, NOW)
    assert o.completed_at == NOW
    o.change_status(WorkOrderStatus.VERIFIED, Role.SUPERVISOR, NOW)
    assert o.verified_at == NOW


def test_started_at_is_kept_when_reopened():
    first = datetime(2026, 11, 24, 9, 0, tzinfo=UTC)
    o = order(status=WorkOrderStatus.ASSIGNED)
    o.change_status(WorkOrderStatus.IN_PROGRESS, Role.SUPERVISOR, first)
    o.change_status(WorkOrderStatus.ASSIGNED, Role.SUPERVISOR, NOW)
    o.change_status(WorkOrderStatus.IN_PROGRESS, Role.SUPERVISOR, NOW)
    assert o.started_at == first


def test_invalid_transition_has_a_human_message():
    o = order()
    with pytest.raises(InvalidTransitionError, match="«pendiente» a «terminada»"):
        o.change_status(WorkOrderStatus.DONE, Role.ADMIN, NOW)


def test_final_states_cannot_change_and_repeating_is_a_noop():
    o = order(status=WorkOrderStatus.CANCELLED)
    o.change_status(WorkOrderStatus.CANCELLED, Role.ADMIN, NOW)
    with pytest.raises(InvalidTransitionError):
        o.change_status(WorkOrderStatus.PENDING, Role.ADMIN, NOW)


@pytest.mark.parametrize(
    ("start", "target"),
    [
        (WorkOrderStatus.DONE, WorkOrderStatus.VERIFIED),
        (WorkOrderStatus.ASSIGNED, WorkOrderStatus.CANCELLED),
        (WorkOrderStatus.DONE, WorkOrderStatus.IN_PROGRESS),
    ],
)
def test_technician_cannot_verify_cancel_or_reopen(start, target):
    o = order(status=start, result={"waste_type": "plastic", "weight_kg": 1})
    with pytest.raises(ForbiddenError):
        o.change_status(target, Role.TECHNICIAN, NOW)


# ── Cierre ──────────────────────────────────────
@pytest.mark.parametrize(
    ("order_type", "result"),
    [
        (WorkOrderType.WASTE_COLLECTION, None),
        (WorkOrderType.WASTE_COLLECTION, {"waste_type": "plastic", "weight_kg": 0}),
        (WorkOrderType.WASTE_COLLECTION, {"waste_type": "rocks", "weight_kg": 2}),
        (WorkOrderType.CALIBRATION, {"sensor_id": "s", "calibration_offset": 0.1}),
        (WorkOrderType.CITIZEN_REPORT, None),
    ],
)
def test_closing_requires_a_coherent_result(order_type, result):
    o = order(type=order_type, status=WorkOrderStatus.IN_PROGRESS, result=result)
    with pytest.raises(InvalidDataError):
        o.change_status(WorkOrderStatus.DONE, Role.SUPERVISOR, NOW)


def test_maintenance_closes_without_result():
    o = order(type=WorkOrderType.MAINTENANCE, status=WorkOrderStatus.IN_PROGRESS)
    o.change_status(WorkOrderStatus.DONE, Role.TECHNICIAN, NOW)
    assert o.status is WorkOrderStatus.DONE


# ── Cascada al reporte ──────────────────────────
@pytest.mark.parametrize(
    ("status", "result", "expected"),
    [
        (WorkOrderStatus.ASSIGNED, None, (ReportStatus.VERIFIED, None)),
        (WorkOrderStatus.IN_PROGRESS, None, (ReportStatus.IN_PROGRESS, None)),
        (
            WorkOrderStatus.DONE,
            {"confirmed": True, "action_taken": "Se limpió"},
            (ReportStatus.RESOLVED, "Se limpió"),
        ),
        (WorkOrderStatus.VERIFIED, {"confirmed": True}, (ReportStatus.RESOLVED, None)),
        (
            WorkOrderStatus.DONE,
            {"confirmed": False},
            (ReportStatus.REJECTED, "La brigada no encontró el problema reportado."),
        ),
        (
            WorkOrderStatus.VERIFIED,
            {"confirmed": False, "action_taken": "Falsa alarma"},
            (ReportStatus.REJECTED, "Falsa alarma"),
        ),
        (WorkOrderStatus.CANCELLED, None, (ReportStatus.VERIFIED, None)),
    ],
)
def test_report_follows_the_order(status, result, expected):
    o = order(type=WorkOrderType.CITIZEN_REPORT, status=status, result=result)
    assert report_update_for(o) == expected


def test_report_needs_description_or_photo():
    with pytest.raises(InvalidDataError):
        CitizenReport(
            folio="RC-1", type=ReportType.TRASH, description="  ", photo=None, latitude=19, longitude=-98
        )


# ── Estación más cercana ────────────────────────
def test_nearest_station_within_8_km():
    near, far = uuid4(), uuid4()
    stations = [(far, 19.30, -98.40), (near, 19.02, -98.24)]
    assert nearest_station(19.03, -98.25, stations, max_km=8) == near
    assert nearest_station(18.5, -97.5, stations, max_km=8) is None


def test_closed_orders_are_protected():
    from app.domain.errors import ConflictError

    verified = order(status=WorkOrderStatus.VERIFIED)
    verified.ensure_editable(Role.ADMIN, {"status"})
    with pytest.raises(ConflictError):
        verified.ensure_editable(Role.ADMIN, {"notes"})
    done = order(status=WorkOrderStatus.DONE)
    done.ensure_editable(Role.SUPERVISOR, {"status", "notes"})
    with pytest.raises(ConflictError):
        done.ensure_editable(Role.TECHNICIAN, {"evidence"})
    with pytest.raises(ConflictError):
        done.ensure_editable(Role.SUPERVISOR, {"assigned_to"})
