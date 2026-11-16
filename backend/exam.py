# PilotReady
# Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
#
# NOTE: licensing stub - to be reviewed/refined later.

"""Phase 2 — ULC exam simulation engine.

Replicates the timed conditions of the Polish Civil Aviation Authority (Urząd
Lotnictwa Cywilnego) PPL(A) theory exam. The exam is split into nine subjects,
each with an official question count and time limit. A candidate must score at
least 75% in EACH subject to pass.

``/start`` draws a fresh randomized, balanced paper (answers shuffled
server-side, with the correct option never revealed to the client) and records
it as an :class:`~backend.models.ExamAttempt`. ``/submit`` grades the *whole*
recorded paper against the canonical answers in the database, so unanswered
questions count as wrong and a client cannot cherry-pick what it submits. The
graded attempt is kept for the exam history, and every answered question also
updates the user's study progress, so exam mistakes land in the review pool.
"""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from backend.database import get_session
from backend.models import ExamAttempt, ProgressStatus, Question, QuestionCategory, UserProgress
from backend.security import get_current_user_id

router = APIRouter(prefix="/api/exam", tags=["exam"])

PASS_THRESHOLD_PERCENT = 75.0


class ExamSubject(BaseModel):
    """Official ULC blueprint entry for a single PPL(A) subject."""

    category: QuestionCategory
    label: str
    question_count: int
    duration_minutes: int


# Official ULC PPL(A) test lengths and time limits, in exam order.
ULC_BLUEPRINT: tuple[ExamSubject, ...] = (
    ExamSubject(category=QuestionCategory.AIR_LAW, label="Prawo lotnicze", question_count=16, duration_minutes=25),
    ExamSubject(
        category=QuestionCategory.AIRCRAFT_GENERAL_KNOWLEDGE,
        label="Ogólna wiedza o samolocie",
        question_count=12,
        duration_minutes=20,
    ),
    ExamSubject(
        category=QuestionCategory.FLIGHT_PERFORMANCE_AND_PLANNING,
        label="Osiągi i planowanie lotu",
        question_count=12,
        duration_minutes=20,
    ),
    ExamSubject(
        category=QuestionCategory.HUMAN_PERFORMANCE,
        label="Człowiek - możliwości",
        question_count=12,
        duration_minutes=25,
    ),
    ExamSubject(category=QuestionCategory.METEOROLOGY, label="Meteorologia", question_count=16, duration_minutes=30),
    ExamSubject(category=QuestionCategory.NAVIGATION, label="Nawigacja", question_count=16, duration_minutes=45),
    ExamSubject(
        category=QuestionCategory.OPERATIONAL_PROCEDURES,
        label="Procedury operacyjne",
        question_count=12,
        duration_minutes=20,
    ),
    ExamSubject(category=QuestionCategory.PRINCIPLES_OF_FLIGHT, label="Zasady lotu", question_count=12, duration_minutes=25),
    ExamSubject(category=QuestionCategory.COMMUNICATIONS, label="Łączność", question_count=12, duration_minutes=20),
)

OPTION_LABELS = ("A", "B", "C", "D")


# --------------------------------------------------------------------------- #
# Response / request schemas
# --------------------------------------------------------------------------- #
class ExamAnswerOption(BaseModel):
    """A single selectable option. The display key is randomized per exam and
    the correctness is deliberately omitted so the client cannot cheat."""

    key: str
    text: str


class ExamQuestion(BaseModel):
    id: uuid.UUID
    external_id: str
    category: str
    question_text: str
    answers: list[ExamAnswerOption]


class ExamSection(BaseModel):
    category: str
    label: str
    question_count: int
    duration_minutes: int
    duration_seconds: int
    questions: list[ExamQuestion]


class ExamStartResponse(BaseModel):
    exam_id: uuid.UUID
    # Wall-clock bounds of the attempt so the client can run a drift-free
    # countdown and resume after a page reload.
    started_at: datetime
    deadline_at: datetime
    total_questions: int
    total_duration_minutes: int
    total_duration_seconds: int
    pass_threshold_percent: float
    sections: list[ExamSection]


class SubmittedAnswer(BaseModel):
    question_id: uuid.UUID
    # The full text of the chosen option. ``None`` / omitted means skipped.
    selected_text: str | None = None


class ExamSubmitRequest(BaseModel):
    exam_id: uuid.UUID | None = None
    answers: list[SubmittedAnswer] = Field(default_factory=list)


class QuestionResult(BaseModel):
    question_id: uuid.UUID
    category: str
    selected_text: str | None
    correct_answer: str
    is_correct: bool
    answered: bool


class SectionResult(BaseModel):
    category: str
    label: str
    question_count: int
    answered: int
    correct: int
    score_percent: float
    passed: bool


class ExamSubmitResponse(BaseModel):
    exam_id: uuid.UUID | None
    passed: bool
    pass_threshold_percent: float
    total_questions: int
    total_correct: int
    overall_score_percent: float
    sections: list[SectionResult]
    results: list[QuestionResult]


class ExamHistoryItem(BaseModel):
    exam_id: uuid.UUID
    started_at: datetime
    finished_at: datetime
    duration_seconds: int
    passed: bool
    total_questions: int
    total_correct: int
    overall_score_percent: float
    sections: list[SectionResult]


class ExamHistoryResponse(BaseModel):
    taken: int
    passed: int
    best_score_percent: float | None
    items: list[ExamHistoryItem]


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _shuffled_options(question: Question) -> list[ExamAnswerOption]:
    """Return the four options in randomized display order.

    The persisted source truth keeps the correct answer at key ``A``; here we
    shuffle so the position carries no signal, and re-label A–D by position.
    """

    texts = [answer["text"] for answer in question.answers]
    random.shuffle(texts)
    return [ExamAnswerOption(key=OPTION_LABELS[index], text=text) for index, text in enumerate(texts)]


def _record_progress(session: Session, user_id: uuid.UUID, results: list[QuestionResult]) -> None:
    """Feed answered exam questions into the user's study progress.

    A wrong exam answer puts the question into the mistakes-review pool and a
    right one marks it mastered, exactly as if it had been answered in study
    mode. Skipped questions are left untouched.
    """

    rows = [
        {
            "user_id": user_id,
            "question_id": result.question_id,
            "status": ProgressStatus.CORRECT if result.is_correct else ProgressStatus.INCORRECT,
            "attempts_count": 1,
            "last_answered_at": func.now(),
        }
        for result in results
        if result.answered
    ]
    if not rows:
        return
    statement = insert(UserProgress).values(rows)
    session.execute(
        statement.on_conflict_do_update(
            index_elements=[UserProgress.user_id, UserProgress.question_id],
            set_={
                "status": statement.excluded.status,
                "attempts_count": UserProgress.attempts_count + 1,
                "last_answered_at": func.now(),
                "updated_at": func.now(),
            },
        )
    )


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@router.post("/start", response_model=ExamStartResponse)
def start_exam(
    current_user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
    session: Annotated[Session, Depends(get_session)],
) -> ExamStartResponse:
    """Assemble a fresh, randomized, balanced ULC exam per the official blueprint."""

    sections: list[ExamSection] = []
    question_ids: list[str] = []
    total_minutes = 0

    for subject in ULC_BLUEPRINT:
        rows = session.scalars(
            select(Question)
            .where(Question.category == subject.category)
            .order_by(func.random())
            .limit(subject.question_count)
        ).all()

        questions = [
            ExamQuestion(
                id=question.id,
                external_id=question.external_id,
                category=question.category.value,
                question_text=question.question_text,
                answers=_shuffled_options(question),
            )
            for question in rows
        ]
        question_ids.extend(str(question.id) for question in rows)

        sections.append(
            ExamSection(
                category=subject.category.value,
                label=subject.label,
                # Reflect how many were actually available, not just the target.
                question_count=len(questions),
                duration_minutes=subject.duration_minutes,
                duration_seconds=subject.duration_minutes * 60,
                questions=questions,
            )
        )
        total_minutes += subject.duration_minutes

    # Abandoned papers (started but never submitted) are useless after a day.
    now = datetime.now(timezone.utc)
    session.execute(
        delete(ExamAttempt).where(
            ExamAttempt.user_id == current_user_id,
            ExamAttempt.finished_at.is_(None),
            ExamAttempt.started_at < now - timedelta(days=1),
        )
    )
    attempt = ExamAttempt(
        user_id=current_user_id,
        started_at=now,
        deadline_at=now + timedelta(minutes=total_minutes),
        question_ids=question_ids,
        total_questions=len(question_ids),
    )
    session.add(attempt)
    session.commit()

    return ExamStartResponse(
        exam_id=attempt.id,
        started_at=attempt.started_at,
        deadline_at=attempt.deadline_at,
        total_questions=len(question_ids),
        total_duration_minutes=total_minutes,
        total_duration_seconds=total_minutes * 60,
        pass_threshold_percent=PASS_THRESHOLD_PERCENT,
        sections=sections,
    )


@router.post("/submit", response_model=ExamSubmitResponse)
def submit_exam(
    payload: ExamSubmitRequest,
    current_user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
    session: Annotated[Session, Depends(get_session)],
) -> ExamSubmitResponse:
    """Grade a submitted exam against the canonical answers in the database.

    A candidate passes only if every subject scores at least 75%.
    """

    submitted_by_id: dict[uuid.UUID, str | None] = {
        answer.question_id: (answer.selected_text.strip() if answer.selected_text else None)
        for answer in payload.answers
    }

    # Resolve the recorded attempt. When it exists, the paper drawn at /start is
    # the source of truth for *which* questions are graded. Without one (an old
    # client mid-deploy) we fall back to grading exactly what was submitted.
    attempt: ExamAttempt | None = None
    if payload.exam_id is not None:
        attempt = session.get(ExamAttempt, payload.exam_id)
        if attempt is not None and attempt.user_id != current_user_id:
            attempt = None
    if attempt is not None and attempt.finished_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Exam already submitted")

    if attempt is not None:
        graded_ids = [uuid.UUID(value) for value in attempt.question_ids]
    else:
        graded_ids = list(submitted_by_id.keys())

    questions = session.scalars(select(Question).where(Question.id.in_(graded_ids))).all() if graded_ids else []
    questions_by_id = {question.id: question for question in questions}

    results: list[QuestionResult] = []
    # category -> [correct_count, answered_count, total_count]
    section_tally: dict[str, list[int]] = {subject.category.value: [0, 0, 0] for subject in ULC_BLUEPRINT}

    for question_id in graded_ids:
        question = questions_by_id.get(question_id)
        if question is None:
            continue  # Question removed since the paper was drawn — ignore it.

        selected_text = submitted_by_id.get(question_id)
        category_value = question.category.value
        correct_answer = question.correct_answer
        answered = selected_text is not None
        is_correct = answered and selected_text == correct_answer

        tally = section_tally.setdefault(category_value, [0, 0, 0])
        tally[2] += 1
        if answered:
            tally[1] += 1
        if is_correct:
            tally[0] += 1

        results.append(
            QuestionResult(
                question_id=question_id,
                category=category_value,
                selected_text=selected_text,
                correct_answer=correct_answer,
                is_correct=is_correct,
                answered=answered,
            )
        )

    sections: list[SectionResult] = []
    total_questions = 0
    total_correct = 0
    all_sections_passed = True

    for subject in ULC_BLUEPRINT:
        correct, _answered, total = section_tally[subject.category.value]
        score_percent = round((correct / total) * 100, 1) if total else 0.0
        passed = total > 0 and score_percent >= PASS_THRESHOLD_PERCENT
        if not passed:
            all_sections_passed = False

        sections.append(
            SectionResult(
                category=subject.category.value,
                label=subject.label,
                question_count=total,
                answered=_answered,
                correct=correct,
                score_percent=score_percent,
                passed=passed,
            )
        )
        total_questions += total
        total_correct += correct

    overall_score_percent = round((total_correct / total_questions) * 100, 1) if total_questions else 0.0
    # Pass requires every subject at/above threshold AND at least one graded question.
    passed = all_sections_passed and total_questions > 0

    if attempt is not None:
        attempt.finished_at = datetime.now(timezone.utc)
        attempt.total_questions = total_questions
        attempt.total_correct = total_correct
        attempt.score_percent = overall_score_percent
        attempt.passed = passed
        attempt.sections = [section.model_dump() for section in sections]
    _record_progress(session, current_user_id, results)
    session.commit()

    return ExamSubmitResponse(
        exam_id=payload.exam_id,
        passed=passed,
        pass_threshold_percent=PASS_THRESHOLD_PERCENT,
        total_questions=total_questions,
        total_correct=total_correct,
        overall_score_percent=overall_score_percent,
        sections=sections,
        results=results,
    )


@router.get("/history", response_model=ExamHistoryResponse)
def exam_history(
    current_user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
    session: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> ExamHistoryResponse:
    """The user's finished exams, newest first, with lifetime totals."""

    finished = (ExamAttempt.user_id == current_user_id) & ExamAttempt.finished_at.is_not(None)
    taken, passed_count, best = session.execute(
        select(
            func.count(),
            func.count().filter(ExamAttempt.passed.is_(True)),
            func.max(ExamAttempt.score_percent),
        ).where(finished)
    ).one()

    attempts = session.scalars(
        select(ExamAttempt).where(finished).order_by(ExamAttempt.finished_at.desc()).limit(limit)
    ).all()

    return ExamHistoryResponse(
        taken=int(taken or 0),
        passed=int(passed_count or 0),
        best_score_percent=float(best) if best is not None else None,
        items=[
            ExamHistoryItem(
                exam_id=attempt.id,
                started_at=attempt.started_at,
                finished_at=attempt.finished_at,
                duration_seconds=max(0, int((attempt.finished_at - attempt.started_at).total_seconds())),
                passed=bool(attempt.passed),
                total_questions=attempt.total_questions,
                total_correct=attempt.total_correct or 0,
                overall_score_percent=attempt.score_percent or 0.0,
                sections=[SectionResult(**section) for section in (attempt.sections or [])],
            )
            for attempt in attempts
        ],
    )
