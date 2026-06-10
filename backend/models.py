# PilotReady
# Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
#
# NOTE: licensing stub - to be reviewed/refined later.

"""SQLAlchemy models for the PPL(A) learning/exam REST API.

These models mirror `database/schema.sql` and the JSON emitted by
`scripts/parse_ppla_pdf.py`. They intentionally store the source's correct
answer as key A because PPL(A) PDF ODP1 is the correct answer; API serializers
must shuffle answers per request before sending them to the SPA/mobile clients.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class QuestionCategory(str, enum.Enum):
    AIR_LAW = "AIR_LAW"
    AIRCRAFT_GENERAL_KNOWLEDGE = "AIRCRAFT_GENERAL_KNOWLEDGE"
    FLIGHT_PERFORMANCE_AND_PLANNING = "FLIGHT_PERFORMANCE_AND_PLANNING"
    HUMAN_PERFORMANCE = "HUMAN_PERFORMANCE"
    METEOROLOGY = "METEOROLOGY"
    NAVIGATION = "NAVIGATION"
    OPERATIONAL_PROCEDURES = "OPERATIONAL_PROCEDURES"
    PRINCIPLES_OF_FLIGHT = "PRINCIPLES_OF_FLIGHT"
    COMMUNICATIONS = "COMMUNICATIONS"
    GENERAL_SAFETY = "GENERAL_SAFETY"
    UNKNOWN = "UNKNOWN"


class ProgressStatus(str, enum.Enum):
    UNREAD = "UNREAD"
    CORRECT = "CORRECT"
    INCORRECT = "INCORRECT"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)

    progress: Mapped[list[UserProgress]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Question(TimestampMixin, Base):
    __tablename__ = "questions"
    __table_args__ = (
        CheckConstraint("correct_answer_key = 'A'", name="questions_correct_answer_key_is_source_a"),
        CheckConstraint("jsonb_typeof(distractors) = 'array' AND jsonb_array_length(distractors) = 3"),
        CheckConstraint("jsonb_typeof(answers) = 'array' AND jsonb_array_length(answers) = 4"),
        Index("questions_category_idx", "category"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_id: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    source_row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    category: Mapped[QuestionCategory] = mapped_column(
        Enum(QuestionCategory, name="question_category"), nullable=False, default=QuestionCategory.UNKNOWN
    )
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    correct_answer_key: Mapped[str] = mapped_column(String(1), nullable=False, default="A")
    correct_answer: Mapped[str] = mapped_column(Text, nullable=False)
    distractors: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    answers: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)

    progress: Mapped[list[UserProgress]] = relationship(back_populates="question", cascade="all, delete-orphan")


class UserProgress(TimestampMixin, Base):
    __tablename__ = "user_progress"
    __table_args__ = (
        CheckConstraint("attempts_count >= 0", name="user_progress_attempts_count_non_negative"),
        Index("user_progress_user_status_idx", "user_id", "status"),
        Index("user_progress_last_answered_idx", "last_answered_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    question_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[ProgressStatus] = mapped_column(
        Enum(ProgressStatus, name="progress_status"), nullable=False, default=ProgressStatus.UNREAD
    )
    attempts_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cached_client_event_id: Mapped[str | None] = mapped_column(String, nullable=True)

    user: Mapped[User] = relationship(back_populates="progress")
    question: Mapped[Question] = relationship(back_populates="progress")


class SupportReport(TimestampMixin, Base):
    """A bug report or piece of feedback submitted by a logged-in user from the
    in-app support tab."""

    __tablename__ = "support_reports"
    __table_args__ = (
        CheckConstraint("kind in ('BUG', 'SUGGESTION', 'OTHER')", name="support_reports_kind_valid"),
        CheckConstraint("char_length(message) between 1 and 4000", name="support_reports_message_length"),
        Index("support_reports_user_created_idx", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="BUG")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    # Optional technical context (e.g. browser user-agent) to help reproduce.
    context: Mapped[str | None] = mapped_column(String(400), nullable=True)
