"""Retire untouched registration presets while preserving real records."""

from sqlalchemy import select
from sqlalchemy.orm import Session, load_only

from alembic import op
from app.models import User
from app.services.legacy import retire_starter_budget

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    with Session(bind=op.get_bind()) as db:
        for user in db.scalars(select(User).options(load_only(User.id, User.created_at, User.preferences))):
            retire_starter_budget(db, user)
        db.flush()


def downgrade():
    # Reintroducing invented limits would overwrite the user's subsequent edits.
    pass
