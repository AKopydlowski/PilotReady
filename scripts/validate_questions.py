# PilotReady
# Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
#
# NOTE: licensing stub - to be reviewed/refined later.

#!/usr/bin/env python3
"""Integrity checks for the extracted question bank (data/questions.json).

Guards against silent parser/data regressions. Run it after re-parsing the PDF
and before seeding the database:

    python scripts/validate_questions.py

Exits 0 when every check passes, 1 otherwise. Designed to be dependency-free so
it can run in CI as-is. It also exposes ``test_*`` functions so it can be picked
up by pytest if that is available.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:  # Run as a script (scripts/ on sys.path) or imported as a package module.
    from question_text import normalize_text
except ImportError:  # pragma: no cover - import style depends on the caller
    from scripts.question_text import normalize_text

REPO_ROOT = Path(__file__).resolve().parents[1]
QUESTIONS_PATH = REPO_ROOT / "data" / "questions.json"

EXPECTED_TOTAL = 2053

# Official ULC PPL(A) blueprint: each exam subject must hold at least this many
# questions for /api/exam/start to assemble a full, balanced exam.
EXAM_MINIMUMS = {
    "AIR_LAW": 16,
    "AIRCRAFT_GENERAL_KNOWLEDGE": 12,
    "FLIGHT_PERFORMANCE_AND_PLANNING": 12,
    "HUMAN_PERFORMANCE": 12,
    "METEOROLOGY": 16,
    "NAVIGATION": 16,
    "OPERATIONAL_PROCEDURES": 12,
    "PRINCIPLES_OF_FLIGHT": 12,
    "COMMUNICATIONS": 12,
}


def load_questions() -> list[dict]:
    if not QUESTIONS_PATH.exists():
        raise SystemExit(
            f"{QUESTIONS_PATH} not found. Generate it first:\n"
            "  python scripts/parse_ppla_pdf.py --input ppla.pdf --output data/questions.json --pretty"
        )
    with QUESTIONS_PATH.open(encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, list):
        raise SystemExit("questions.json must contain a JSON list")
    return data


# Leftovers of the source export that the parser must have cleaned up.
_DIRTY_TEXT_CHECKS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"&#?\w+;"), "unescaped HTML entity"),
    (re.compile(r"<(?!/?su[bp]>)/?\s*su[bp][^>]{0,20}>"), "malformed sub/sup tag"),
    (re.compile(r'""'), "CSV-doubled quote"),
    (re.compile(r"\s{2,}|^\s|\s$"), "stray whitespace"),
)


def text_problems(text: str) -> list[str]:
    """Return clean-up defects still present in a question/answer string."""

    found = [label for pattern, label in _DIRTY_TEXT_CHECKS if pattern.search(text)]
    if text.count("<sub>") != text.count("</sub>") or text.count("<sup>") != text.count("</sup>"):
        found.append("unbalanced sub/sup tag")
    if not found and normalize_text(text) != text:
        found.append("text that is not normalized (re-run the parser)")
    return found


def find_warnings(questions: list[dict]) -> list[str]:
    """Non-fatal oddities that exist in the official source itself.

    These do not fail validation, but they are worth a human look because they
    affect how a question reads in the app.
    """

    warnings: list[str] = []
    for question in questions:
        qid = question.get("external_id") or "<no-id>"
        answers = question.get("answers") or []
        texts = [str(answer.get("text") or "").strip() for answer in answers]
        if len({text.casefold() for text in texts}) < len(texts):
            warnings.append(f"{qid}: two answers have identical text")
        for text in [str(question.get("question_text") or ""), *texts]:
            if re.search(r"[^\s?]\?[^\s?:)\"”]", text):
                warnings.append(f"{qid}: '?' inside a word (character lost in the source?): {text[:60]!r}")
                break
    return warnings


def find_problems(questions: list[dict]) -> list[str]:
    """Return a list of human-readable integrity violations (empty == healthy)."""

    problems: list[str] = []

    # 1) Expected total.
    if len(questions) != EXPECTED_TOTAL:
        problems.append(f"expected {EXPECTED_TOTAL} questions, found {len(questions)}")

    seen_ids: set[str] = set()
    categories: dict[str, int] = {}

    for question in questions:
        qid = question.get("external_id") or "<no-id>"

        # 2) Unique external_id.
        if qid in seen_ids:
            problems.append(f"{qid}: duplicate external_id")
        seen_ids.add(qid)

        # 3) Non-empty, clean question text.
        question_text = str(question.get("question_text") or "")
        if not question_text.strip():
            problems.append(f"{qid}: empty question_text")
        for defect in text_problems(question_text):
            problems.append(f"{qid}: question_text has {defect}")

        # 4) No UNKNOWN — every question must be categorized.
        category = question.get("category") or "UNKNOWN"
        categories[category] = categories.get(category, 0) + 1
        if category == "UNKNOWN":
            problems.append(f"{qid}: category is UNKNOWN")

        answers = question.get("answers")
        if not isinstance(answers, list) or len(answers) != 4:
            problems.append(f"{qid}: expected exactly 4 answers, got {len(answers) if isinstance(answers, list) else 'none'}")
            continue

        # 5) Every answer has non-empty, clean text.
        texts = [str(answer.get("text") or "").strip() for answer in answers]
        for index, text in enumerate(texts):
            if not text:
                problems.append(f"{qid}: answer {chr(ord('A') + index)} is empty")
            for defect in text_problems(str(answers[index].get("text") or "")):
                problems.append(f"{qid}: answer {chr(ord('A') + index)} has {defect}")

        # 6) Source invariant: key A is the correct answer and matches correct_answer.
        first = answers[0]
        if str(first.get("key")).upper() != "A":
            problems.append(f"{qid}: first answer key is {first.get('key')!r}, expected 'A'")
        if not first.get("is_correct", False):
            problems.append(f"{qid}: answer A is not flagged is_correct")
        if any(answers[i].get("is_correct") for i in range(1, len(answers))):
            problems.append(f"{qid}: a distractor (B-D) is flagged is_correct")
        if question.get("correct_answer_key", "A") != "A":
            problems.append(f"{qid}: correct_answer_key is not 'A'")
        correct_answer = str(question.get("correct_answer") or "").strip()
        if correct_answer and texts and correct_answer != texts[0]:
            problems.append(f"{qid}: correct_answer does not match answer A")

    # 7) Each exam subject has enough questions for a full ULC exam.
    for subject, minimum in EXAM_MINIMUMS.items():
        available = categories.get(subject, 0)
        if available < minimum:
            problems.append(f"subject {subject}: only {available} questions, exam needs {minimum}")

    return problems


# --------------------------------------------------------------------------- #
# pytest entry points (optional)
# --------------------------------------------------------------------------- #
def test_question_bank_is_airtight() -> None:
    problems = find_problems(load_questions())
    assert not problems, "Question bank integrity violations:\n" + "\n".join(problems[:50])


def main() -> int:
    questions = load_questions()
    problems = find_problems(questions)

    categories: dict[str, int] = {}
    for question in questions:
        category = question.get("category") or "UNKNOWN"
        categories[category] = categories.get(category, 0) + 1

    print(f"Checked {len(questions)} questions from {QUESTIONS_PATH.relative_to(REPO_ROOT)}")
    print("By category:")
    for category, count in sorted(categories.items(), key=lambda item: (-item[1], item[0])):
        print(f"  {category:<34} {count}")

    if problems:
        print(f"\nFAILED — {len(problems)} integrity violation(s):")
        for problem in problems[:50]:
            print(f"  - {problem}")
        if len(problems) > 50:
            print(f"  ... and {len(problems) - 50} more")
        return 1

    warnings = find_warnings(questions)
    if warnings:
        print(f"\n{len(warnings)} source oddity(ies) worth a manual look (not failures):")
        for warning in warnings[:30]:
            print(f"  ~ {warning}")
        if len(warnings) > 30:
            print(f"  ... and {len(warnings) - 30} more")

    print("\nPASSED — question bank is airtight (4 non-empty clean answers each, key A correct, 0 UNKNOWN).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
