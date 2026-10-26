"""storage keys and retry backoff

Revision ID: a1c3e5f7b902
Revises: f860646fae05
Create Date: 2026-10-25 18:00:00.000000

- jobs.storage_key: server-generated, organization-scoped video location.
  Existing rows are backfilled with their old flat filename so videos that
  are already in uploads/ keep working; new uploads get scoped keys.
- analysis_jobs.next_attempt_at: earliest time a retry may be claimed.
- Restores the unique (organization_id, job_type) index on checklists, which
  the original version of the baseline revision dropped.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1c3e5f7b902'
down_revision: Union[str, Sequence[str], None] = 'f860646fae05'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    if "storage_key" not in _columns("jobs"):
        op.add_column("jobs", sa.Column("storage_key", sa.String(512), nullable=True))
        op.execute(
            "UPDATE jobs SET storage_key = video_filename WHERE storage_key IS NULL"
        )

    if "next_attempt_at" not in _columns("analysis_jobs"):
        op.add_column(
            "analysis_jobs",
            sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        )

    if "ix_checklists_org_job_type" not in _indexes("checklists"):
        op.create_index(
            "ix_checklists_org_job_type",
            "checklists",
            ["organization_id", "job_type"],
            unique=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("analysis_jobs") as batch:
        batch.drop_column("next_attempt_at")
    with op.batch_alter_table("jobs") as batch:
        batch.drop_column("storage_key")
