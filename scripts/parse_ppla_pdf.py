#!/usr/bin/env python3
"""One-time importer for the PPL(A) PDF question bank.

The source PDF stores questions in a table with these columns:
L.p., NUMER, PYTANIE, ODP1, ODP2, ODP3, ODP4.

Important domain rule: ODP1 is the canonical correct answer in the source.
The application/API should shuffle answers only at delivery time while preserving
`correct_answer_key == "A"` in the persisted source record.

Usage:
    python scripts/parse_ppla_pdf.py --input ppla.pdf --output data/questions.json

Install dependencies first:
    python -m pip install -r requirements.txt
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Sequence

EXPECTED_COLUMNS = ("L.p.", "NUMER", "PYTANIE", "ODP1", "ODP2", "ODP3", "ODP4")
NORMALIZED_COLUMNS = tuple(re.sub(r"[^A-Z0-9]", "", value.upper()) for value in EXPECTED_COLUMNS)

CATEGORY_BY_PREFIX = {
    # Keep this explicit and easy to amend if the PDF/vendor prefixes differ.
    # Unknown prefixes are exported as "UNKNOWN" so ingestion can be audited.
    "010": "AIR_LAW",
    "020": "AIRCRAFT_GENERAL_KNOWLEDGE",
    "030": "FLIGHT_PERFORMANCE_AND_PLANNING",
    "040": "HUMAN_PERFORMANCE",
    "050": "METEOROLOGY",
    "060": "NAVIGATION",
    "070": "OPERATIONAL_PROCEDURES",
    "080": "PRINCIPLES_OF_FLIGHT",
    "090": "COMMUNICATIONS",
}


@dataclass(frozen=True)
class ParsedQuestion:
    """JSON shape consumed by the API/database seed step."""

    source_row_number: int | None
    external_id: str
    category: str
    question_text: str
    correct_answer_key: str
    answers: list[dict[str, str | bool]]


def clean_cell(value: object) -> str:
    """Normalize PDF table cell text while preserving meaningful punctuation."""

    if value is None:
        return ""
    text = str(value).replace("\u00a0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s*\n\s*", " ", text)
    return text.strip()


def normalized_header(row: Sequence[object]) -> tuple[str, ...]:
    return tuple(re.sub(r"[^A-Z0-9]", "", clean_cell(cell).upper()) for cell in row)


def row_looks_like_header(row: Sequence[object]) -> bool:
    normalized = normalized_header(row)
    return len(normalized) >= 7 and normalized[:7] == NORMALIZED_COLUMNS


def infer_category(external_id: str) -> str:
    """Infer one of the 9 PPL(A) subjects from common numeric prefixes.

    Examples often look like PL010-0003. If no known prefix is present, keep the
    record importable and mark it UNKNOWN for manual mapping/audit.
    """

    match = re.search(r"(?:^|[^0-9])(010|020|030|040|050|060|070|080|090)(?:[^0-9]|$)", external_id)
    return CATEGORY_BY_PREFIX.get(match.group(1), "UNKNOWN") if match else "UNKNOWN"


def coerce_row(row: Sequence[object]) -> ParsedQuestion | None:
    """Convert one extracted PDF table row to a domain record.

    Malformed/empty rows return None rather than crashing the entire import; the
    caller counts skipped rows for auditability.
    """

    cells = [clean_cell(cell) for cell in row[:7]]
    if len(cells) < 7 or not any(cells) or row_looks_like_header(cells):
        return None

    lp, external_id, question_text, odp1, odp2, odp3, odp4 = cells
    if not external_id or not question_text or not odp1:
        return None

    try:
        source_row_number = int(re.sub(r"[^0-9]", "", lp)) if lp else None
    except ValueError:
        source_row_number = None

    answers = [
        {"key": "A", "text": odp1, "is_correct": True},
        {"key": "B", "text": odp2, "is_correct": False},
        {"key": "C", "text": odp3, "is_correct": False},
        {"key": "D", "text": odp4, "is_correct": False},
    ]

    return ParsedQuestion(
        source_row_number=source_row_number,
        external_id=external_id,
        category=infer_category(external_id),
        question_text=question_text,
        correct_answer_key="A",
        answers=answers,
    )


def extract_rows(pdf_path: Path) -> Iterable[Sequence[object]]:
    """Yield raw table rows from the PDF without loading it into app runtime."""

    try:
        import pdfplumber  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - environment/dependency guard
        raise SystemExit(
            "Missing dependency 'pdfplumber'. Install with: python -m pip install -r requirements.txt"
        ) from exc

    table_settings = {
        "vertical_strategy": "lines",
        "horizontal_strategy": "lines",
        "snap_tolerance": 3,
        "join_tolerance": 3,
        "intersection_tolerance": 5,
        "text_x_tolerance": 2,
        "text_y_tolerance": 3,
    }

    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables(table_settings=table_settings) or []
            if not tables:
                # Fallback for PDFs where ruling lines are not represented as paths.
                fallback_settings = {**table_settings, "vertical_strategy": "text", "horizontal_strategy": "text"}
                tables = page.extract_tables(table_settings=fallback_settings) or []
            for table in tables:
                for row in table:
                    yield row


def deduplicate(questions: Iterable[ParsedQuestion]) -> list[ParsedQuestion]:
    """Preserve first occurrence and avoid duplicate question IDs across pages."""

    seen: set[str] = set()
    unique: list[ParsedQuestion] = []
    for question in questions:
        if question.external_id in seen:
            continue
        seen.add(question.external_id)
        unique.append(question)
    return unique


def parse_pdf(pdf_path: Path) -> tuple[list[ParsedQuestion], int]:
    skipped = 0
    parsed: list[ParsedQuestion] = []
    for row in extract_rows(pdf_path):
        question = coerce_row(row)
        if question is None:
            skipped += 1
            continue
        parsed.append(question)
    return deduplicate(parsed), skipped


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse the PPL(A) PDF table into structured JSON.")
    parser.add_argument("--input", default="ppla.pdf", type=Path, help="Path to source ppla.pdf")
    parser.add_argument("--output", default="data/questions.json", type=Path, help="Path for generated JSON")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON for review")
    args = parser.parse_args()

    if not args.input.exists():
        parser.error(f"Input PDF not found: {args.input}")

    questions, skipped = parse_pdf(args.input)
    if not questions:
        raise SystemExit("No questions parsed. Check PDF table extraction settings or source format.")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = [asdict(question) for question in questions]
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {len(payload)} questions to {args.output} (skipped {skipped} non-data/header rows).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
