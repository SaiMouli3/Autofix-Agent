"""oauth states

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-09
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "oauth_states",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("org_id", sa.String(length=32), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("integration_id", sa.String(length=32), sa.ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(length=32), nullable=False),
        sa.Column("verifier", sa.LargeBinary(), nullable=False),
        sa.Column("redirect_uri", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_oauth_states_org_id", "oauth_states", ["org_id"])
    op.create_index("ix_oauth_states_integration_id", "oauth_states", ["integration_id"])


def downgrade() -> None:
    op.drop_index("ix_oauth_states_integration_id", table_name="oauth_states")
    op.drop_index("ix_oauth_states_org_id", table_name="oauth_states")
    op.drop_table("oauth_states")
