"""Operaciones: personal (login y roles), reportes ciudadanos y órdenes de trabajo.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-24 10:49:16.934061
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Folios consecutivos RC-0001 / OT-0001.
    op.execute("CREATE SEQUENCE citizen_report_folio_seq")
    op.execute("CREATE SEQUENCE work_order_folio_seq")
    op.create_table(
        "users",
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "role",
            sa.Enum("technician", "supervisor", "admin", name="role", native_enum=False, length=32),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_table(
        "citizen_reports",
        sa.Column("folio", sa.String(length=16), nullable=False),
        sa.Column(
            "type",
            sa.Enum(
                "trash",
                "discharge",
                "odor",
                "foam",
                "dead_fish",
                "other",
                name="reporttype",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("photo", sa.String(length=255), nullable=True),
        sa.Column("latitude", sa.Double(), nullable=False),
        sa.Column("longitude", sa.Double(), nullable=False),
        sa.Column("accuracy", sa.Double(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "new",
                "verified",
                "in_progress",
                "resolved",
                "rejected",
                name="reportstatus",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("station_id", sa.Uuid(), nullable=True),
        sa.Column("work_order_id", sa.Uuid(), nullable=True),
        sa.Column("public_note", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["station_id"],
            ["stations.id"],
            name=op.f("fk_citizen_reports_station_id_stations"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_citizen_reports")),
        sa.UniqueConstraint("folio", name=op.f("uq_citizen_reports_folio")),
    )
    op.create_index(
        "ix_citizen_reports_created_at",
        "citizen_reports",
        [sa.literal_column("created_at DESC")],
        unique=False,
    )
    op.create_table(
        "work_orders",
        sa.Column("folio", sa.String(length=16), nullable=False),
        sa.Column(
            "type",
            sa.Enum(
                "citizen_report",
                "maintenance",
                "waste_collection",
                "calibration",
                name="workordertype",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "priority",
            sa.Enum("low", "normal", "high", "urgent", name="priority", native_enum=False, length=32),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "assigned",
                "in_progress",
                "done",
                "verified",
                "cancelled",
                name="workorderstatus",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("station_id", sa.Uuid(), nullable=True),
        sa.Column("citizen_report_id", sa.Uuid(), nullable=True),
        sa.Column("alert_id", sa.Uuid(), nullable=True),
        sa.Column("location", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("assigned_to", sa.Uuid(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "checklist",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "evidence",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), server_default="", nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("check_in", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["alert_id"], ["alerts.id"], name=op.f("fk_work_orders_alert_id_alerts"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["assigned_to"], ["users.id"], name=op.f("fk_work_orders_assigned_to_users"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["citizen_report_id"],
            ["citizen_reports.id"],
            name=op.f("fk_work_orders_citizen_report_id_citizen_reports"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_work_orders_created_by_users"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["station_id"],
            ["stations.id"],
            name=op.f("fk_work_orders_station_id_stations"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_work_orders")),
        sa.UniqueConstraint("folio", name=op.f("uq_work_orders_folio")),
    )
    op.create_index(
        "ix_work_orders_assigned_to_status", "work_orders", ["assigned_to", "status"], unique=False
    )
    # Referencia circular reporte ↔ orden: la FK se agrega cuando ya existen ambas tablas.
    op.create_foreign_key(
        op.f("fk_citizen_reports_work_order_id_work_orders"),
        "citizen_reports",
        "work_orders",
        ["work_order_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_citizen_reports_work_order_id_work_orders"), "citizen_reports", type_="foreignkey"
    )
    op.drop_index("ix_work_orders_assigned_to_status", table_name="work_orders")
    op.drop_table("work_orders")
    op.drop_index("ix_citizen_reports_created_at", table_name="citizen_reports")
    op.drop_table("citizen_reports")
    op.drop_table("users")
    op.execute("DROP SEQUENCE work_order_folio_seq")
    op.execute("DROP SEQUENCE citizen_report_folio_seq")
