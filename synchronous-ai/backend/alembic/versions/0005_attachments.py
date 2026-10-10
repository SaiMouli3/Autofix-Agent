"""task attachments

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-10
"""
import sqlalchemy as sa
from alembic import op


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "attachments",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("org_id", sa.String(length=32), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("uploaded_by", sa.String(length=32), nullable=False),
        sa.Column("task_id", sa.String(length=32), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("mime", sa.String(length=120), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("text_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_attachments_org_id", "attachments", ["org_id"])
    op.create_index("ix_attachments_task_id", "attachments", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_attachments_task_id", table_name="attachments")
    op.drop_index("ix_attachments_org_id", table_name="attachments")
    op.drop_table("attachments")
