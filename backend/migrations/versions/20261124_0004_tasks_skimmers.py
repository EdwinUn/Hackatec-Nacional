"""Bandeja del operador (tareas) y bitácora de vaciado de boyas skimmer.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-24 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("priority", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("assigned_to", sa.Uuid(), nullable=True),
        sa.Column("station_id", sa.Uuid(), nullable=True),
        sa.Column("buoy_code", sa.String(length=60), nullable=True),
        sa.Column("closing_note", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Uuid(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["assigned_to"], ["users.id"], name=op.f("fk_tasks_assigned_to_users"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by"], ["users.id"], name=op.f("fk_tasks_resolved_by_users"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["station_id"], ["stations.id"], name=op.f("fk_tasks_station_id_stations"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tasks")),
    )
    op.create_index("ix_tasks_status_priority", "tasks", ["status", "priority"], unique=False)
    op.create_index("ix_tasks_assigned_to_status", "tasks", ["assigned_to", "status"], unique=False)

    op.create_table(
        "skimmer_collections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("station_id", sa.Uuid(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("buoy_code", sa.String(length=60), nullable=False),
        sa.Column("buoy_condition", sa.String(length=32), nullable=False),
        sa.Column("materials", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("total_kg", sa.Double(), nullable=False),
        sa.Column("total_pieces", sa.Integer(), nullable=False),
        sa.Column("operator_id", sa.Uuid(), nullable=True),
        sa.Column("operator_name", sa.String(length=120), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["operator_id"],
            ["users.id"],
            name=op.f("fk_skimmer_collections_operator_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["station_id"],
            ["stations.id"],
            name=op.f("fk_skimmer_collections_station_id_stations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["tasks.id"], name=op.f("fk_skimmer_collections_task_id_tasks"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_skimmer_collections")),
    )
    op.create_index(
        "ix_skimmer_collections_station_id_ts", "skimmer_collections", ["station_id", "ts"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_skimmer_collections_station_id_ts", table_name="skimmer_collections")
    op.drop_table("skimmer_collections")
    op.drop_index("ix_tasks_assigned_to_status", table_name="tasks")
    op.drop_index("ix_tasks_status_priority", table_name="tasks")
    op.drop_table("tasks")
