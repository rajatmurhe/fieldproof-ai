import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi import Request
from fastapi.testclient import TestClient

from backend.database.connection import Base, get_db
from backend.models.organization import Organization
from backend.models.user import User
from backend.models.job import Job
from backend.models.analysis_job import AnalysisJob
from backend.models.checklist import Checklist
from backend.models.audit_log import AuditLog
from backend.models.job_result import JobResult
from backend.models.job_finding import JobFinding
from backend.auth import get_current_user
from backend.main import app

# In-memory SQLite for high-speed isolated unit testing
TEST_DATABASE_URL = "sqlite:///:memory:"

test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestingSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=test_engine,
)


@pytest.fixture(scope="function")
def db_session():
    """Create a fresh database schema for each test."""
    Base.metadata.create_all(bind=test_engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=test_engine)


@pytest.fixture(scope="function")
def seed_tenants(db_session):
    """Seed two isolated tenant organizations with users."""
    org_a = Organization(
        name="Acme Field Services",
        slug="acme-field",
        clerk_org_id="org_acme_123",
    )
    org_b = Organization(
        name="Apex Home Repairs",
        slug="apex-repairs",
        clerk_org_id="org_apex_456",
    )
    db_session.add_all([org_a, org_b])
    db_session.commit()
    db_session.refresh(org_a)
    db_session.refresh(org_b)

    user_a = User(
        organization_id=org_a.id,
        name="Alice Tech",
        email="alice@acme.com",
        clerk_user_id="user_alice_123",
        role="ADMIN",
    )
    user_b = User(
        organization_id=org_b.id,
        name="Bob Reviewer",
        email="bob@apex.com",
        clerk_user_id="user_bob_456",
        role="REVIEWER",
    )
    db_session.add_all([user_a, user_b])
    db_session.commit()
    db_session.refresh(user_a)
    db_session.refresh(user_b)

    return {
        "org_a": org_a,
        "org_b": org_b,
        "user_a": user_a,
        "user_b": user_b,
    }


@pytest.fixture(scope="function")
def client_a(db_session, seed_tenants):
    """Test client authenticated as Alice in Tenant A."""
    user_a = seed_tenants["user_a"]
    user_b = seed_tenants["user_b"]

    def override_get_db():
        yield db_session

    def override_get_current_user(request: Request):
        test_user = request.headers.get("x-test-user")
        if test_user == "user_b":
            return user_b
        return user_a

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    client = TestClient(app, headers={"x-test-user": "user_a"})
    yield client
    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def client_b(db_session, seed_tenants):
    """Test client authenticated as Bob in Tenant B."""
    user_a = seed_tenants["user_a"]
    user_b = seed_tenants["user_b"]

    def override_get_db():
        yield db_session

    def override_get_current_user(request: Request):
        test_user = request.headers.get("x-test-user")
        if test_user == "user_b":
            return user_b
        return user_a

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    client = TestClient(app, headers={"x-test-user": "user_b"})
    yield client
    app.dependency_overrides.clear()
