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
    # Backfill from the audit trail: integrations created from a connector recorded its key.
    import json

    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT target_id, details FROM audit_events WHERE action = 'integration.created' AND target_id IS NOT NULL"
    )).fetchall()
    for target_id, details in rows:
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except ValueError:
                continue
        key = (details or {}).get("connector") if isinstance(details, dict) else None
        if key:
            conn.execute(sa.text("UPDATE integrations SET connector_key = :k WHERE id = :i AND connector_key IS NULL"),
                         {"k": str(key)[:60], "i": target_id})


def downgrade() -> None:
    with op.batch_alter_table("integrations") as batch:
        batch.drop_column("connector_key")
