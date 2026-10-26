"""result snapshots and guardrails

Revision ID: c4e8d2b61a07
Revises: a1c3e5f7b902
Create Date: 2026-10-26 18:00:00.000000

- job_results.checklist_snapshot: the checklist the model was given, frozen
  at analysis time so later edits don't change what a result means.
- job_results.prompt_version: which prompt/schema produced the result.
- job_results.guardrail_events: guardrail rules that fired on the result.

Existing results predate snapshots, so these stay NULL for them.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4e8d2b61a07'
down_revision: Union[str, Sequence[str], None] = 'a1c3e5f7b902'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    existing = _columns("job_results")

    if "checklist_snapshot" not in existing:
        op.add_column("job_results", sa.Column("checklist_snapshot", sa.JSON(), nullable=True))

    if "prompt_version" not in existing:
        op.add_column("job_results", sa.Column("prompt_version", sa.String(50), nullable=True))

    if "guardrail_events" not in existing:
        op.add_column("job_results", sa.Column("guardrail_events", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("job_results") as batch:
        batch.drop_column("guardrail_events")
        batch.drop_column("prompt_version")
        batch.drop_column("checklist_snapshot")
