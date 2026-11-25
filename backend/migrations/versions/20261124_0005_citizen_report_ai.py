"""Análisis de IA (visión artificial) guardado con cada reporte ciudadano.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-24 20:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("citizen_reports", sa.Column("ai", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("citizen_reports", "ai")
