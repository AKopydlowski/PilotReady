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

The engine is intentionally **stateless**: ``/start`` pulls a fresh randomized,
balanced set of questions (answers shuffled server-side, with the correct option
never revealed to the client), and ``/submit`` re-reads the canonical answers
from the database to grade what the client returns. No exam-session table is
required.
"""

from __future__ import annotations

import random
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.database import get_session
from backend.models import Question, QuestionCategory
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
    total_questions = 0
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
        total_questions += len(questions)
        total_minutes += subject.duration_minutes

    return ExamStartResponse(
        exam_id=uuid.uuid4(),
        total_questions=total_questions,
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

    questions = (
        session.scalars(select(Question).where(Question.id.in_(submitted_by_id.keys()))).all()
        if submitted_by_id
        else []
    )
    questions_by_id = {question.id: question for question in questions}

    results: list[QuestionResult] = []
    # category -> [correct_count, answered_count, total_count]
    section_tally: dict[str, list[int]] = {subject.category.value: [0, 0, 0] for subject in ULC_BLUEPRINT}

    for question_id, selected_text in submitted_by_id.items():
        question = questions_by_id.get(question_id)
        if question is None:
            continue  # Unknown id (e.g. stale client) — ignore rather than fail the whole exam.

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
