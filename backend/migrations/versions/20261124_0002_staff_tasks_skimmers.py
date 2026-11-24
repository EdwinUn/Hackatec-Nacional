"""Personal operativo, tareas y bitácora de recolección de boyas skimmer.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-24 12:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, length=32)


def _base_cols() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "staff_users",
        sa.Column("email", sa.String(200), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("role", _enum("userrole", "technician", "supervisor", "admin"), nullable=False),
        sa.Column("password_hash", sa.String(300), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        *_base_cols(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_staff_users")),
        sa.UniqueConstraint("email", name=op.f("uq_staff_users_email")),
    )
    op.create_table(
        "tasks",
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column(
            "kind", _enum("taskkind", "report", "repair", "skimmer_collection", "maintenance"), nullable=False
        ),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("priority", _enum("taskpriority", "normal", "urgent"), nullable=False),
        sa.Column("status", _enum("taskstatus", "pending", "in_progress", "done"), nullable=False),
        sa.Column("assigned_to", sa.Uuid(), nullable=True),
        sa.Column("station_id", sa.Uuid(), nullable=True),
        sa.Column("buoy_code", sa.String(60), nullable=True),
        sa.Column("closing_note", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Uuid(), nullable=True),
        *_base_cols(),
        sa.ForeignKeyConstraint(
            ["assigned_to"],
            ["staff_users.id"],
            name=op.f("fk_tasks_assigned_to_staff_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["station_id"], ["stations.id"], name=op.f("fk_tasks_station_id_stations"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by"],
            ["staff_users.id"],
            name=op.f("fk_tasks_resolved_by_staff_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tasks")),
    )
    op.create_index("ix_tasks_status_priority", "tasks", ["status", "priority"])
    op.create_index("ix_tasks_assigned_to_status", "tasks", ["assigned_to", "status"])
    op.create_table(
        "skimmer_collections",
        sa.Column("station_id", sa.Uuid(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("buoy_code", sa.String(60), nullable=False),
        sa.Column(
            "buoy_condition",
            _enum("buoycondition", "ok", "danada", "saturada", "faltan_piezas"),
            nullable=False,
        ),
        sa.Column("materials", sa.JSON(), nullable=False),
        sa.Column("total_kg", sa.Double(), nullable=False),
        sa.Column("total_pieces", sa.Integer(), nullable=False),
        sa.Column("operator_id", sa.Uuid(), nullable=True),
        sa.Column("operator_name", sa.String(120), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        *_base_cols(),
        sa.ForeignKeyConstraint(
            ["station_id"],
            ["stations.id"],
            name=op.f("fk_skimmer_collections_station_id_stations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["operator_id"],
            ["staff_users.id"],
            name=op.f("fk_skimmer_collections_operator_id_staff_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["tasks.id"], name=op.f("fk_skimmer_collections_task_id_tasks"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_skimmer_collections")),
    )
    op.create_index("ix_skimmer_collections_station_id_ts", "skimmer_collections", ["station_id", "ts"])


def downgrade() -> None:
    op.drop_table("skimmer_collections")
    op.drop_table("tasks")
    op.drop_table("staff_users")
