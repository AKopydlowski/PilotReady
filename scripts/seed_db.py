#!/usr/bin/env python3
"""Seed the PostgreSQL questions table from data/questions.json.

The full `data/questions.json` file is intentionally gitignored. This script
reads that local file, validates the expected parser shape, and upserts rows by
`external_id` so it is safe to run repeatedly after parser improvements.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import create_engine, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.models import Base, Question, QuestionCategory  # noqa: E402

LOGGER = logging.getLogger("seed_db")
DEFAULT_QUESTIONS_PATH = REPO_ROOT / "data" / "questions.json"
DEFAULT_BATCH_SIZE = 500


def get_database_url() -> str:
    """Return the configured SQLAlchemy database URL."""

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is required, for example: "
            "postgresql+psycopg://user:password@localhost:5432/pilotready"
        )
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url


def load_questions(path: Path) -> list[dict[str, Any]]:
    """Load the parser output JSON file."""

    if not path.exists():
        raise FileNotFoundError(
            f"Cannot find {path}. Generate the full extraction first; "
            "only data/questions.sample.json is committed."
        )
    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    if not isinstance(payload, list):
        raise ValueError(f"Expected {path} to contain a JSON list of questions")
    return payload


def coerce_category(value: object) -> str:
    """Map parser category values onto the database enum."""

    if isinstance(value, str) and value in QuestionCategory.__members__:
        if value != QuestionCategory.UNKNOWN.value:
            return value
    return QuestionCategory.UNKNOWN.value


def normalize_answers(question: dict[str, Any]) -> tuple[str, list[str], list[dict[str, Any]]]:
    """Return (correct_answer, distractors, answers) for a parsed question."""

    raw_answers = question.get("answers")
    if not isinstance(raw_answers, list) or len(raw_answers) != 4:
        raise ValueError(f"{question.get('external_id')}: expected exactly 4 answers")

    answers: list[dict[str, Any]] = []
    correct_answer = ""
    distractors: list[str] = []

    for index, raw_answer in enumerate(raw_answers):
        if not isinstance(raw_answer, dict):
            raise ValueError(f"{question.get('external_id')}: answer {index + 1} is not an object")
        key = str(raw_answer.get("key") or chr(ord("A") + index)).upper()
        text = str(raw_answer.get("text") or "").strip()
        is_correct = bool(raw_answer.get("is_correct") or key == "A")
        if not text:
            raise ValueError(f"{question.get('external_id')}: answer {key} is empty")
        normalized = {"key": key, "text": text, "is_correct": is_correct}
        answers.append(normalized)
        if key == "A" or is_correct:
            correct_answer = text
        else:
            distractors.append(text)

    if not correct_answer:
        raise ValueError(f"{question.get('external_id')}: no correct answer found")
    if len(distractors) != 3:
        distractors = [answer["text"] for answer in answers if answer["text"] != correct_answer][:3]
    if len(distractors) != 3:
        raise ValueError(f"{question.get('external_id')}: expected exactly 3 distractors")

    # Preserve the source invariant expected by the database: ODP1/key A is the
    # canonical correct answer. The frontend randomizes presentation order.
    answers[0] = {**answers[0], "key": "A", "is_correct": True}
    for index in range(1, 4):
        answers[index] = {**answers[index], "key": chr(ord("A") + index), "is_correct": False}

    return correct_answer, distractors, answers


def build_rows(questions: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Validate parser objects and build insert-ready rows."""

    rows: list[dict[str, Any]] = []
    seen_external_ids: set[str] = set()

    for question in questions:
        external_id = str(question.get("external_id") or "").strip()
        question_text = str(question.get("question_text") or "").strip()
        if not external_id or not question_text:
            raise ValueError(f"Question is missing external_id or question_text: {question!r}")
        if external_id in seen_external_ids:
            raise ValueError(f"Duplicate external_id in JSON payload: {external_id}")
        seen_external_ids.add(external_id)

        correct_answer, distractors, answers = normalize_answers(question)
        rows.append(
            {
                "external_id": external_id,
                "source_row_number": question.get("source_row_number"),
                "category": coerce_category(question.get("category")),
                "question_text": question_text,
                "correct_answer_key": "A",
                "correct_answer": correct_answer,
                "distractors": distractors,
                "answers": answers,
            }
        )

    return rows


def chunks(rows: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def seed(rows: list[dict[str, Any]], *, batch_size: int) -> int:
    """Upsert question rows and return the number of rows submitted."""

    engine = create_engine(get_database_url(), future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        for batch_number, batch in enumerate(chunks(rows, batch_size), start=1):
            statement = insert(Question).values(batch)
            upsert = statement.on_conflict_do_update(
                index_elements=[Question.external_id],
                set_={
                    "source_row_number": statement.excluded.source_row_number,
                    "category": statement.excluded.category,
                    "question_text": statement.excluded.question_text,
                    "correct_answer_key": statement.excluded.correct_answer_key,
                    "correct_answer": statement.excluded.correct_answer,
                    "distractors": statement.excluded.distractors,
                    "answers": statement.excluded.answers,
                    "updated_at": func.now(),
                },
            )
            session.execute(upsert)
            LOGGER.info("Seeded batch %s (%s questions)", batch_number, len(batch))
        session.commit()

    return len(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed PilotReady questions into PostgreSQL")
    parser.add_argument("--questions-path", type=Path, default=DEFAULT_QUESTIONS_PATH)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args()
    questions = load_questions(args.questions_path)
    rows = build_rows(questions)
    LOGGER.info("Loaded %s questions from %s", len(rows), args.questions_path)
    seeded_count = seed(rows, batch_size=args.batch_size)
    LOGGER.info("Successfully seeded %s questions into the database", seeded_count)


if __name__ == "__main__":
    main()
