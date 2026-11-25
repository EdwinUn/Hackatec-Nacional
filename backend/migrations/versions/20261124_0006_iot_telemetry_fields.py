"""Telemetría IoT: caudal, llenado de la cesta, señal y calidad del agua de cada envío.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-24 21:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = ("flow_rate_lpm", "basket_fill_pct", "rssi_dbm")


def upgrade() -> None:
    for name in COLUMNS:
        op.add_column("device_telemetry", sa.Column(name, sa.Double(), nullable=True))
    op.add_column("device_telemetry", sa.Column("values", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("device_telemetry", "values")
    for name in COLUMNS:
        op.drop_column("device_telemetry", name)
