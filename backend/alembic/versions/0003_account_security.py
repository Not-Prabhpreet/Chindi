"""Passkeys, single-use recovery secrets, and session revocation."""

import sqlalchemy as sa

from alembic import op
from app.models import AuthChallenge, Passkey, RecoverySecret

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if "auth_version" not in {c["name"] for c in sa.inspect(bind).get_columns("users")}:
        op.add_column("users", sa.Column("auth_version", sa.Integer(), nullable=False, server_default="0"))
    for model in (Passkey, AuthChallenge, RecoverySecret):
        model.__table__.create(bind, checkfirst=True)


def downgrade():
    for model in (RecoverySecret, AuthChallenge, Passkey):
        model.__table__.drop(op.get_bind(), checkfirst=True)
    with op.batch_alter_table("users") as batch:
        batch.drop_column("auth_version")
