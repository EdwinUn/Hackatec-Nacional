"""Telemetría de dispositivos: código de estación (RM-01) y estado de la boya por envío.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-24 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("stations", sa.Column("code", sa.String(length=32), nullable=True))
    op.create_unique_constraint(op.f("uq_stations_code"), "stations", ["code"])
    op.create_table(
        "device_telemetry",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("station_id", sa.Uuid(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=True),
        sa.Column("battery_v", sa.Double(), nullable=True),
        sa.Column("battery_pct", sa.Double(), nullable=True),
        sa.Column("river_speed_ms", sa.Double(), nullable=True),
        sa.Column("generator_w", sa.Double(), nullable=True),
        sa.Column("generator_v", sa.Double(), nullable=True),
        sa.Column("pump_on", sa.Boolean(), nullable=True),
        sa.Column("brake_on", sa.Boolean(), nullable=True),
        sa.Column("alarm_on", sa.Boolean(), nullable=True),
        sa.Column("device_efficiency_pct", sa.Double(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["station_id"],
            ["stations.id"],
            name=op.f("fk_device_telemetry_station_id_stations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_device_telemetry")),
    )
    op.create_index(
        "ix_device_telemetry_station_id_ts",
        "device_telemetry",
        ["station_id", sa.literal_column("ts DESC")],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_device_telemetry_station_id_ts", table_name="device_telemetry")
    op.drop_table("device_telemetry")
    op.drop_constraint(op.f("uq_stations_code"), "stations", type_="unique")
    op.drop_column("stations", "code")
