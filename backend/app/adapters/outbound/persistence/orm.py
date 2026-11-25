"""Modelos ORM (SQLAlchemy 2). Espejo de las entidades del dominio; los mappers son genéricos."""

from datetime import date, datetime
from enum import StrEnum
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.domain.enums import (
    AlertStatus,
    BuoyCondition,
    CycleStatus,
    RuleKind,
    SensorLocation,
    SensorStatus,
    SensorType,
    Severity,
    StationStatus,
    TaskKind,
    TaskPriority,
    TaskStatus,
    WasteType,
)
from app.domain.operations import Priority, ReportStatus, ReportType, Role, WorkOrderStatus, WorkOrderType

NAMING = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = sa.MetaData(naming_convention=NAMING)


def enum_col(enum: type[StrEnum]) -> sa.Enum:
    # VARCHAR sin CHECK: agregar un valor al enum no requiere migración (diseñado para extender).
    return sa.Enum(
        enum,
        native_enum=False,
        create_constraint=False,
        length=32,
        values_callable=lambda e: [m.value for m in e],
    )


TZ = sa.DateTime(timezone=True)


class TimestampMixin:
    id: Mapped[UUID] = mapped_column(sa.Uuid, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(TZ, server_default=sa.func.now())
    updated_at: Mapped[datetime] = mapped_column(TZ, server_default=sa.func.now())


class StationRow(TimestampMixin, Base):
    __tablename__ = "stations"
    name: Mapped[str] = mapped_column(sa.String(120), unique=True)
    river: Mapped[str] = mapped_column(sa.String(120), index=True)
    latitude: Mapped[float]
    longitude: Mapped[float]
    status: Mapped[StationStatus] = mapped_column(enum_col(StationStatus))
    installed_at: Mapped[date | None]
    description: Mapped[str | None] = mapped_column(sa.Text)
    code: Mapped[str | None] = mapped_column(sa.String(32), unique=True)


class SensorRow(TimestampMixin, Base):
    __tablename__ = "sensors"
    station_id: Mapped[UUID] = mapped_column(sa.ForeignKey("stations.id", ondelete="CASCADE"), index=True)
    type: Mapped[SensorType] = mapped_column(enum_col(SensorType))
    location: Mapped[SensorLocation] = mapped_column(enum_col(SensorLocation))
    unit: Mapped[str] = mapped_column(sa.String(16))
    valid_min: Mapped[float]
    valid_max: Mapped[float]
    status: Mapped[SensorStatus] = mapped_column(enum_col(SensorStatus))
    last_seen_at: Mapped[datetime | None] = mapped_column(TZ)
    calibration_offset: Mapped[float] = mapped_column(server_default="0")
    calibration_factor: Mapped[float] = mapped_column(server_default="1")
    calibrated_at: Mapped[datetime | None] = mapped_column(TZ)
    model: Mapped[str | None] = mapped_column(sa.String(120))


class ReadingRow(Base):
    __tablename__ = "readings"
    id: Mapped[UUID] = mapped_column(sa.Uuid, primary_key=True)
    sensor_id: Mapped[UUID] = mapped_column(sa.ForeignKey("sensors.id", ondelete="CASCADE"))
    station_id: Mapped[UUID] = mapped_column(sa.ForeignKey("stations.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(TZ)
    value: Mapped[float]
    quality: Mapped[float] = mapped_column(server_default="1")
    created_at: Mapped[datetime] = mapped_column(TZ, server_default=sa.func.now())

    __table_args__ = (
        # Idempotencia + "última lectura de un sensor" en un solo índice.
        sa.Index("uq_readings_sensor_id_ts", "sensor_id", sa.text("ts DESC"), unique=True),
        sa.Index("ix_readings_station_id_ts", "station_id", "ts"),
        sa.Index("ix_readings_ts_brin", "ts", postgresql_using="brin"),
        sa.CheckConstraint("quality >= 0 AND quality <= 1", name="quality_range"),
    )


class DeviceTelemetryRow(Base):
    __tablename__ = "device_telemetry"
    id: Mapped[UUID] = mapped_column(sa.Uuid, primary_key=True)
    station_id: Mapped[UUID] = mapped_column(sa.ForeignKey("stations.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(TZ)
    seq: Mapped[int | None] = mapped_column(sa.BigInteger)
    battery_v: Mapped[float | None]
    battery_pct: Mapped[float | None]
    river_speed_ms: Mapped[float | None]
    generator_w: Mapped[float | None]
    generator_v: Mapped[float | None]
    pump_on: Mapped[bool | None]
    brake_on: Mapped[bool | None]
    alarm_on: Mapped[bool | None]
    device_efficiency_pct: Mapped[float | None]
    flow_rate_lpm: Mapped[float | None]
    basket_fill_pct: Mapped[float | None]
    rssi_dbm: Mapped[float | None]
    gas_v: Mapped[float | None]
    values: Mapped[dict | None] = mapped_column(sa.JSON)
    created_at: Mapped[datetime] = mapped_column(TZ, server_default=sa.func.now())

    __table_args__ = (sa.Index("ix_device_telemetry_station_id_ts", "station_id", sa.text("ts DESC")),)


class CycleRow(TimestampMixin, Base):
    __tablename__ = "centrifuge_cycles"
    station_id: Mapped[UUID] = mapped_column(sa.ForeignKey("stations.id", ondelete="CASCADE"))
    started_at: Mapped[datetime] = mapped_column(TZ)
    ended_at: Mapped[datetime | None] = mapped_column(TZ)
    status: Mapped[CycleStatus] = mapped_column(enum_col(CycleStatus))
    rpm_avg: Mapped[float | None]
    rpm_max: Mapped[float | None]
    vibration_mm_s: Mapped[float | None]
    power_w: Mapped[float | None]
    water_in_l: Mapped[float | None]
    water_out_clean_l: Mapped[float | None]
    sludge_kg: Mapped[float | None]
    failure_reason: Mapped[str | None] = mapped_column(sa.Text)

    __table_args__ = (sa.Index("ix_centrifuge_cycles_station_id_started_at", "station_id", "started_at"),)


class BatchRow(TimestampMixin, Base):
    __tablename__ = "treatment_batches"
    station_id: Mapped[UUID] = mapped_column(sa.ForeignKey("stations.id", ondelete="CASCADE"))
    cycle_id: Mapped[UUID | None] = mapped_column(
        sa.ForeignKey("centrifuge_cycles.id", ondelete="SET NULL"), index=True
    )
    ts: Mapped[datetime] = mapped_column(TZ)
    volume_in_l: Mapped[float]
    volume_clean_l: Mapped[float]
    sludge_kg: Mapped[float | None]
    ph_in: Mapped[float | None]
    ph_out: Mapped[float | None]
    turbidity_in_ntu: Mapped[float | None]
    turbidity_out_ntu: Mapped[float | None]
    efficiency_pct: Mapped[float]

    __table_args__ = (sa.Index("ix_treatment_batches_station_id_ts", "station_id", "ts"),)


class WasteRow(TimestampMixin, Base):
    __tablename__ = "waste_collections"
    station_id: Mapped[UUID] = mapped_column(sa.ForeignKey("stations.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(TZ)
    weight_kg: Mapped[float]
    items_count: Mapped[int | None]
    waste_type: Mapped[WasteType] = mapped_column(enum_col(WasteType))
    collector_id: Mapped[str | None] = mapped_column(sa.String(120))

    __table_args__ = (sa.Index("ix_waste_collections_station_id_ts", "station_id", "ts"),)


class AlertRuleRow(TimestampMixin, Base):
    __tablename__ = "alert_rules"
    name: Mapped[str] = mapped_column(sa.String(200))
    kind: Mapped[RuleKind] = mapped_column(enum_col(RuleKind))
    severity: Mapped[Severity] = mapped_column(enum_col(Severity))
    parameter: Mapped[SensorType | None] = mapped_column(enum_col(SensorType))
    location: Mapped[SensorLocation | None] = mapped_column(enum_col(SensorLocation))
    station_id: Mapped[UUID | None] = mapped_column(
        sa.ForeignKey("stations.id", ondelete="CASCADE"), index=True
    )
    min_value: Mapped[float | None]
    max_value: Mapped[float | None]
    enabled: Mapped[bool] = mapped_column(server_default=sa.true())
    description: Mapped[str | None] = mapped_column(sa.Text)


ACTIVE_ALERT = "status IN ('open', 'acknowledged')"


class AlertRow(TimestampMixin, Base):
    __tablename__ = "alerts"
    rule_id: Mapped[UUID] = mapped_column(sa.ForeignKey("alert_rules.id", ondelete="CASCADE"))
    station_id: Mapped[UUID] = mapped_column(sa.ForeignKey("stations.id", ondelete="CASCADE"))
    sensor_id: Mapped[UUID | None] = mapped_column(sa.ForeignKey("sensors.id", ondelete="SET NULL"))
    subject_key: Mapped[str] = mapped_column(sa.String(80))
    kind: Mapped[RuleKind] = mapped_column(enum_col(RuleKind))
    parameter: Mapped[SensorType | None] = mapped_column(enum_col(SensorType))
    severity: Mapped[Severity] = mapped_column(enum_col(Severity))
    status: Mapped[AlertStatus] = mapped_column(enum_col(AlertStatus))
    message: Mapped[str] = mapped_column(sa.Text)
    trigger_value: Mapped[float]
    threshold_min: Mapped[float | None]
    threshold_max: Mapped[float | None]
    first_triggered_at: Mapped[datetime] = mapped_column(TZ)
    last_triggered_at: Mapped[datetime] = mapped_column(TZ)
    occurrences: Mapped[int] = mapped_column(server_default="1")
    last_notified_at: Mapped[datetime | None] = mapped_column(TZ)
    acknowledged_at: Mapped[datetime | None] = mapped_column(TZ)
    resolved_at: Mapped[datetime | None] = mapped_column(TZ)
    note: Mapped[str | None] = mapped_column(sa.Text)

    __table_args__ = (
        # Anti-spam a nivel BD: una sola alerta activa por (regla, sujeto), segura con N workers.
        sa.Index(
            "uq_alerts_active_rule_subject",
            "rule_id",
            "subject_key",
            unique=True,
            postgresql_where=sa.text(ACTIVE_ALERT),
        ),
        sa.Index("ix_alerts_station_id_status", "station_id", "status"),
        sa.Index("ix_alerts_last_triggered_at", "last_triggered_at"),
    )


# ── Operaciones: personal, reportes ciudadanos y órdenes de trabajo ──────────
REPORT_FOLIO_SEQ = sa.Sequence("citizen_report_folio_seq", metadata=Base.metadata)
ORDER_FOLIO_SEQ = sa.Sequence("work_order_folio_seq", metadata=Base.metadata)


class UserRow(TimestampMixin, Base):
    __tablename__ = "users"
    name: Mapped[str] = mapped_column(sa.String(120))
    email: Mapped[str] = mapped_column(sa.String(254), unique=True)  # siempre en minúsculas
    password_hash: Mapped[str] = mapped_column(sa.String(255))
    role: Mapped[Role] = mapped_column(enum_col(Role))
    active: Mapped[bool] = mapped_column(server_default=sa.true())


class CitizenReportRow(TimestampMixin, Base):
    __tablename__ = "citizen_reports"
    folio: Mapped[str] = mapped_column(sa.String(16), unique=True)
    type: Mapped[ReportType] = mapped_column(enum_col(ReportType))
    description: Mapped[str] = mapped_column(sa.Text)
    photo: Mapped[str | None] = mapped_column(sa.String(255))  # referencia relativa: media/<id>.jpg
    latitude: Mapped[float]
    longitude: Mapped[float]
    accuracy: Mapped[float | None]
    status: Mapped[ReportStatus] = mapped_column(enum_col(ReportStatus))
    station_id: Mapped[UUID | None] = mapped_column(sa.ForeignKey("stations.id", ondelete="SET NULL"))
    # Referencia circular con work_orders: la FK se crea después de ambas tablas.
    work_order_id: Mapped[UUID | None] = mapped_column(
        sa.ForeignKey("work_orders.id", ondelete="SET NULL", use_alter=True)
    )
    public_note: Mapped[str | None] = mapped_column(sa.Text)
    ai: Mapped[dict | None] = mapped_column(sa.JSON)

    __table_args__ = (sa.Index("ix_citizen_reports_created_at", sa.text("created_at DESC")),)


class WorkOrderRow(TimestampMixin, Base):
    __tablename__ = "work_orders"
    folio: Mapped[str] = mapped_column(sa.String(16), unique=True)
    type: Mapped[WorkOrderType] = mapped_column(enum_col(WorkOrderType))
    title: Mapped[str] = mapped_column(sa.String(200))
    description: Mapped[str] = mapped_column(sa.Text)
    priority: Mapped[Priority] = mapped_column(enum_col(Priority))
    status: Mapped[WorkOrderStatus] = mapped_column(enum_col(WorkOrderStatus))
    station_id: Mapped[UUID | None] = mapped_column(sa.ForeignKey("stations.id", ondelete="SET NULL"))
    citizen_report_id: Mapped[UUID | None] = mapped_column(
        sa.ForeignKey("citizen_reports.id", ondelete="SET NULL")
    )
    alert_id: Mapped[UUID | None] = mapped_column(sa.ForeignKey("alerts.id", ondelete="SET NULL"))
    location: Mapped[dict | None] = mapped_column(JSONB)
    assigned_to: Mapped[UUID | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped[UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="RESTRICT"))
    due_at: Mapped[datetime | None] = mapped_column(TZ)
    checklist: Mapped[list] = mapped_column(JSONB, server_default=sa.text("'[]'::jsonb"))
    evidence: Mapped[list] = mapped_column(JSONB, server_default=sa.text("'[]'::jsonb"))
    notes: Mapped[str] = mapped_column(sa.Text, server_default="")
    result: Mapped[dict | None] = mapped_column(JSONB)
    check_in: Mapped[dict | None] = mapped_column(JSONB)
    started_at: Mapped[datetime | None] = mapped_column(TZ)
    completed_at: Mapped[datetime | None] = mapped_column(TZ)
    verified_at: Mapped[datetime | None] = mapped_column(TZ)

    __table_args__ = (sa.Index("ix_work_orders_assigned_to_status", "assigned_to", "status"),)


# ── Bandeja del operador y bitácora de boyas skimmer ─────────────────────────
class TaskRow(TimestampMixin, Base):
    __tablename__ = "tasks"
    title: Mapped[str] = mapped_column(sa.String(200))
    kind: Mapped[TaskKind] = mapped_column(enum_col(TaskKind))
    description: Mapped[str] = mapped_column(sa.Text, server_default="")
    priority: Mapped[TaskPriority] = mapped_column(enum_col(TaskPriority))
    status: Mapped[TaskStatus] = mapped_column(enum_col(TaskStatus))
    assigned_to: Mapped[UUID | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    station_id: Mapped[UUID | None] = mapped_column(sa.ForeignKey("stations.id", ondelete="SET NULL"))
    buoy_code: Mapped[str | None] = mapped_column(sa.String(60))
    closing_note: Mapped[str | None] = mapped_column(sa.Text)
    resolved_at: Mapped[datetime | None] = mapped_column(TZ)
    resolved_by: Mapped[UUID | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        sa.Index("ix_tasks_status_priority", "status", "priority"),
        sa.Index("ix_tasks_assigned_to_status", "assigned_to", "status"),
    )


class SkimmerCollectionRow(TimestampMixin, Base):
    __tablename__ = "skimmer_collections"
    station_id: Mapped[UUID] = mapped_column(sa.ForeignKey("stations.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(TZ)
    buoy_code: Mapped[str] = mapped_column(sa.String(60))
    buoy_condition: Mapped[BuoyCondition] = mapped_column(enum_col(BuoyCondition))
    materials: Mapped[dict] = mapped_column(JSONB)
    total_kg: Mapped[float]
    total_pieces: Mapped[int]
    operator_id: Mapped[UUID | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    operator_name: Mapped[str | None] = mapped_column(sa.String(120))
    notes: Mapped[str | None] = mapped_column(sa.Text)
    task_id: Mapped[UUID | None] = mapped_column(sa.ForeignKey("tasks.id", ondelete="SET NULL"))

    __table_args__ = (sa.Index("ix_skimmer_collections_station_id_ts", "station_id", "ts"),)
