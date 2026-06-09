"""Centralized database configuration for PilotReady.

Loads environment variables from the project-root ``.env`` file via
``python-dotenv`` and exposes the shared SQLAlchemy engine, session factory,
and the FastAPI session dependency. Both the API (``backend/main.py``) and the
seeding script (``scripts/seed_db.py``) import from here so there is a single
source of truth for *which* database is targeted.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

# Resolve the repository root (parent of the ``backend`` package) and load the
# local ``.env`` from there, regardless of the current working directory.
REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT / ".env")


def get_database_url() -> str:
    """Return the configured SQLAlchemy database URL.

    Normalizes the common ``postgres://`` / ``postgresql://`` prefixes to the
    explicit ``postgresql+psycopg://`` driver URL used across the project.
    """

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is required. Copy .env.example to .env and point it at "
            "your development database (the one you target in pgAdmin)."
        )
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+psycopg://", 1)
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url


engine: Engine = create_engine(get_database_url(), pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def get_session() -> Iterator[Session]:
    """FastAPI dependency yielding a scoped SQLAlchemy session."""

    with SessionLocal() as session:
        yield session
