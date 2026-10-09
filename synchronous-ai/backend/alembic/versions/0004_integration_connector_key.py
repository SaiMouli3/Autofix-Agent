"""integration connector key

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-09
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("integrations") as batch:
        batch.add_column(sa.Column("connector_key", sa.String(length=60), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("integrations") as batch:
        batch.drop_column("connector_key")
