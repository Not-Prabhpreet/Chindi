"""Bind refresh sessions to the password version, including reset races."""

import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if "auth_version" not in {c["name"] for c in sa.inspect(bind).get_columns("refresh_tokens")}:
        op.add_column("refresh_tokens", sa.Column("auth_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    with op.batch_alter_table("refresh_tokens") as batch:
        batch.drop_column("auth_version")
