"""Telemetría de la boya con la electrónica completa (firmware/boya-rm01/sketch.ino).

Corriente de la bomba (ACS712), agua procesada y ciclos de la bomba, inclinación y golpes (MPU6050)
y señal del módem 4G (CSQ del A7670SA). El caudal y la cesta ya tenían columna (0006).

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-24 23:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (
    ("signal_csq", sa.SmallInteger()),
    ("pump_current_a", sa.Double()),
    ("water_liters_total", sa.Double()),
    ("pump_cycles", sa.Integer()),
    ("tilt_deg", sa.Double()),
    ("shock", sa.Boolean()),
)


def upgrade() -> None:
    for name, type_ in COLUMNS:
        op.add_column("device_telemetry", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(COLUMNS):
        op.drop_column("device_telemetry", name)
