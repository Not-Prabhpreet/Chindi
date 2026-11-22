from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db import Base, get_db, make_engine
from app.main import create_app


@pytest.fixture(autouse=True)
def isolated_auth_settings(monkeypatch):
    # A developer's local sign-up/mail configuration must not change test policy.
    monkeypatch.setattr(get_settings(), "allow_signups", False)
    monkeypatch.setattr(get_settings(), "smtp_host", "")
    monkeypatch.setattr(get_settings(), "smtp_from", "")


@pytest.fixture
def headers(client):
    result = client.post(
        "/api/v1/auth/register",
        json={"email": "you@example.com", "password": "correct-horse-battery"},
    )
    assert result.status_code == 201, result.text
    auth = {"Authorization": "Bearer " + result.json()["access_token"]}
    # These test users explicitly create their budgets; registration creates no categories.
    created = {}
    for index, (name, amount) in enumerate(
        [
            ("Groceries", "400"),
            ("Food out", "140"),
            ("Shopping", "150"),
            ("Fun", "100"),
            ("Transport", "100"),
        ]
    ):
        response = client.post(
            "/api/v1/categories",
            headers=auth,
            json={"name": name, "limit_amount": amount, "position": index},
        )
        assert response.status_code == 201, response.text
        created[name] = response.json()["id"]
    for body in [
        {"name": "Coffee", "parent_id": created["Food out"], "limit_amount": "40", "position": 5},
        {"name": "Takeout", "parent_id": created["Food out"], "max_count": 3, "position": 6},
        {"name": "Bills", "kind": "fixed", "position": 7},
    ]:
        response = client.post("/api/v1/categories", headers=auth, json=body)
        assert response.status_code == 201, response.text
    return auth


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A fresh in-memory SQLite database per test, with all tables created."""
    engine = make_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with TestSession() as session:
        yield session
    engine.dispose()


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as test_client:
        yield test_client
