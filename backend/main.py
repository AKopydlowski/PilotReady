"""FastAPI REST API for PilotReady Phase 1."""

from __future__ import annotations

import os
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import case, create_engine, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from backend.models import ProgressStatus, Question, QuestionCategory, User, UserProgress

CATEGORY_LABELS: dict[QuestionCategory, str] = {
    QuestionCategory.AIR_LAW: "Air Law",
    QuestionCategory.AIRCRAFT_GENERAL_KNOWLEDGE: "Aircraft General Knowledge",
    QuestionCategory.FLIGHT_PERFORMANCE_AND_PLANNING: "Flight Performance and Planning",
    QuestionCategory.HUMAN_PERFORMANCE: "Human Performance",
    QuestionCategory.METEOROLOGY: "Meteorology",
    QuestionCategory.NAVIGATION: "Navigation",
    QuestionCategory.OPERATIONAL_PROCEDURES: "Operational Procedures",
    QuestionCategory.PRINCIPLES_OF_FLIGHT: "Principles of Flight",
    QuestionCategory.COMMUNICATIONS: "Communications",
}
SUBJECT_ORDER = tuple(CATEGORY_LABELS.keys())


def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required to start the PilotReady API")
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+psycopg://", 1)
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url


engine = create_engine(get_database_url(), pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)

app = FastAPI(title="PilotReady API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CategoryProgressResponse(BaseModel):
    id: str
    label: str
    total: int
    correct: int
    incorrect: int
    unattempted: int


class QuestionAnswerResponse(BaseModel):
    key: str
    text: str


class QuestionResponse(BaseModel):
    id: uuid.UUID
    external_id: str
    category: str
    question_text: str
    correct_answer: str
    answers: list[QuestionAnswerResponse]
    progress_status: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ProgressRequest(BaseModel):
    user_id: uuid.UUID
    question_id: uuid.UUID
    status: ProgressStatus = Field(description="CORRECT or INCORRECT")
    client_event_id: str | None = None

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, value: Any) -> Any:
        if isinstance(value, ProgressStatus):
            return value
        if isinstance(value, str):
            normalized = value.strip().upper()
            if normalized in {"CORRECT", "INCORRECT"}:
                return normalized
        raise ValueError("status must be Correct/Incorrect")


class ProgressResponse(BaseModel):
    user_id: uuid.UUID
    question_id: uuid.UUID
    status: ProgressStatus
    attempts_count: int
    last_answered_at: datetime


def get_session() -> Session:
    with SessionLocal() as session:
        yield session


def get_logged_in_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
    user_id: Annotated[uuid.UUID | None, Query()] = None,
) -> uuid.UUID:
    """Resolve the current user until full auth middleware is wired in."""

    if user_id is not None:
        return user_id
    if x_user_id:
        try:
            return uuid.UUID(x_user_id)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid X-User-Id header") from exc
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing logged-in user id")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/categories", response_model=list[CategoryProgressResponse])
def get_categories(
    current_user_id: Annotated[uuid.UUID, Depends(get_logged_in_user_id)],
    session: Annotated[Session, Depends(get_session)],
) -> list[CategoryProgressResponse]:
    totals = dict(
        session.execute(
            select(Question.category, func.count(Question.id))
            .where(Question.category.in_(SUBJECT_ORDER))
            .group_by(Question.category)
        ).all()
    )

    progress_rows = session.execute(
        select(
            Question.category,
            func.coalesce(func.sum(case((UserProgress.status == ProgressStatus.CORRECT, 1), else_=0)), 0).label("correct"),
            func.coalesce(func.sum(case((UserProgress.status == ProgressStatus.INCORRECT, 1), else_=0)), 0).label("incorrect"),
        )
        .join(UserProgress, UserProgress.question_id == Question.id)
        .where(UserProgress.user_id == current_user_id, Question.category.in_(SUBJECT_ORDER))
        .group_by(Question.category)
    ).all()
    progress_by_category = {row.category: row for row in progress_rows}

    responses: list[CategoryProgressResponse] = []
    for category in SUBJECT_ORDER:
        total = int(totals.get(category, 0) or 0)
        row = progress_by_category.get(category)
        correct = int(row.correct if row else 0)
        incorrect = int(row.incorrect if row else 0)
        responses.append(
            CategoryProgressResponse(
                id=category.value,
                label=CATEGORY_LABELS[category],
                total=total,
                correct=correct,
                incorrect=incorrect,
                unattempted=max(total - correct - incorrect, 0),
            )
        )
    return responses


@app.get("/api/questions/{category_id}", response_model=list[QuestionResponse])
def get_questions(
    category_id: QuestionCategory,
    current_user_id: Annotated[uuid.UUID, Depends(get_logged_in_user_id)],
    session: Annotated[Session, Depends(get_session)],
) -> list[QuestionResponse]:
    if category_id not in SUBJECT_ORDER:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown question category")

    rows = session.execute(
        select(Question, UserProgress.status)
        .outerjoin(
            UserProgress,
            (UserProgress.question_id == Question.id) & (UserProgress.user_id == current_user_id),
        )
        .where(Question.category == category_id)
        .order_by(Question.source_row_number.asc().nullslast(), Question.external_id.asc())
    ).all()

    return [
        QuestionResponse(
            id=question.id,
            external_id=question.external_id,
            category=question.category.value,
            question_text=question.question_text,
            correct_answer=question.correct_answer,
            answers=[QuestionAnswerResponse(key=answer["key"], text=answer["text"]) for answer in question.answers],
            progress_status=progress_status.value if progress_status else None,
        )
        for question, progress_status in rows
    ]


@app.post("/api/progress", response_model=ProgressResponse)
def upsert_progress(payload: ProgressRequest, session: Annotated[Session, Depends(get_session)]) -> ProgressResponse:
    if payload.status == ProgressStatus.UNREAD:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Progress status must be Correct or Incorrect")

    user_exists = session.scalar(select(func.count()).select_from(User).where(User.id == payload.user_id))
    if not user_exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    question_exists = session.scalar(select(func.count()).select_from(Question).where(Question.id == payload.question_id))
    if not question_exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")

    statement = insert(UserProgress).values(
        user_id=payload.user_id,
        question_id=payload.question_id,
        status=payload.status,
        attempts_count=1,
        last_answered_at=func.now(),
        cached_client_event_id=payload.client_event_id,
    )
    upsert = statement.on_conflict_do_update(
        index_elements=[UserProgress.user_id, UserProgress.question_id],
        set_={
            "status": statement.excluded.status,
            "attempts_count": UserProgress.attempts_count + 1,
            "last_answered_at": func.now(),
            "cached_client_event_id": statement.excluded.cached_client_event_id,
            "updated_at": func.now(),
        },
    ).returning(
        UserProgress.user_id,
        UserProgress.question_id,
        UserProgress.status,
        UserProgress.attempts_count,
        UserProgress.last_answered_at,
    )

    row = session.execute(upsert).one()
    session.commit()
    return ProgressResponse(
        user_id=row.user_id,
        question_id=row.question_id,
        status=row.status,
        attempts_count=row.attempts_count,
        last_answered_at=row.last_answered_at,
    )
