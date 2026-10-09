"""integration category

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-09
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("integrations") as batch:
        batch.add_column(sa.Column("category", sa.String(length=40), nullable=False, server_default="business_api"))


def downgrade() -> None:
    with op.batch_alter_table("integrations") as batch:
        batch.drop_column("category")
