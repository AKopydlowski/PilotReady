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
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

EXPECTED_COLUMNS = ("L.p.", "NUMER", "PYTANIE", "ODP1", "ODP2", "ODP3", "ODP4")
NORMALIZED_COLUMNS = tuple(re.sub(r"[^A-Z0-9]", "", value.upper()) for value in EXPECTED_COLUMNS)
QUESTION_ID_RE = re.compile(r"PL\s*\d{3}\s*-\s*\d{4}", re.IGNORECASE)
HEADER_WORDS_RE = re.compile(r"\b(L\.?P\.?|NUMER|PYTANIE|ODP[1-4])\b", re.IGNORECASE)

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


@dataclass(frozen=True)
class ExtractedRow:
    """One candidate question row reconstructed from a PDF extraction strategy."""

    cells: Sequence[object]
    page_number: int
    method: str


@dataclass(frozen=True)
class ParseIssue:
    """Audit detail for a row/page that could not be converted to a question."""

    page_number: int
    method: str
    reason: str
    detected_ids: tuple[str, ...] = ()


@dataclass
class ParseStats:
    rows_scanned: int = 0
    text_lines_scanned: int = 0
    pages_scanned: int = 0
    detected_ids: set[str] = field(default_factory=set)
    duplicate_ids: set[str] = field(default_factory=set)
    issues: list[ParseIssue] = field(default_factory=list)
    parsed_by_method: dict[str, int] = field(default_factory=dict)

    @property
    def total_scanned(self) -> int:
        return self.rows_scanned + self.text_lines_scanned

    def record_parsed(self, method: str) -> None:
        self.parsed_by_method[method] = self.parsed_by_method.get(method, 0) + 1


def clean_cell(value: object) -> str:
    """Normalize PDF table cell text while preserving meaningful punctuation."""

    if value is None:
        return ""
    text = str(value).replace("\u00a0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s*\n\s*", " ", text)
    return text.strip()


def normalize_question_id(value: str) -> str:
    """Canonicalize IDs such as 'PL 010 - 0003' to 'PL010-0003'."""

    compact = re.sub(r"\s+", "", value.upper())
    return re.sub(r"^(PL\d{3})-?(\d{4})$", r"\1-\2", compact)


def extract_question_ids(value: str) -> list[str]:
    """Return every question ID present in a cell/text chunk, preserving order."""

    ids: list[str] = []
    for match in QUESTION_ID_RE.finditer(value):
        question_id = normalize_question_id(match.group(0))
        if question_id not in ids:
            ids.append(question_id)
    return ids


def normalized_header(row: Sequence[object]) -> tuple[str, ...]:
    return tuple(re.sub(r"[^A-Z0-9]", "", clean_cell(cell).upper()) for cell in row)


def row_looks_like_header(row: Sequence[object]) -> bool:
    normalized = normalized_header(row)
    return len(normalized) >= 7 and normalized[:7] == NORMALIZED_COLUMNS


def infer_category(external_id: str) -> str:
    """Infer one of the 9 PPL(A) subjects from common numeric prefixes."""

    match = re.search(r"(?:^|[^0-9])(010|020|030|040|050|060|070|080|090)(?:[^0-9]|$)", external_id)
    return CATEGORY_BY_PREFIX.get(match.group(1), "UNKNOWN") if match else "UNKNOWN"


def coerce_row(row: Sequence[object]) -> list[ParsedQuestion]:
    """Convert one extracted PDF table row into one or more domain records.

    Some official exports put multiple NUMER values in one cell. In that case we
    duplicate the reconstructed question body for each detected ID instead of
    silently dropping the extra IDs.
    """

    padded = list(row[:7]) + [""] * (7 - len(row[:7]))
    cells = [clean_cell(cell) for cell in padded[:7]]
    if len(cells) < 7 or not any(cells) or row_looks_like_header(cells):
        return []

    lp, external_id_cell, question_text, odp1, odp2, odp3, odp4 = cells
    external_ids = extract_question_ids(external_id_cell)
    if not external_ids and external_id_cell:
        normalized = normalize_question_id(external_id_cell)
        if QUESTION_ID_RE.fullmatch(normalized):
            external_ids = [normalized]

    required_cells = (question_text, odp1, odp2, odp3, odp4)
    if not external_ids or any(not cell for cell in required_cells):
        return []

    try:
        source_row_number = int(re.sub(r"[^0-9]", "", lp)) if lp else None
    except ValueError:
        source_row_number = None

    parsed: list[ParsedQuestion] = []
    for external_id in external_ids:
        answers = [
            {"key": "A", "text": odp1, "is_correct": True},
            {"key": "B", "text": odp2, "is_correct": False},
            {"key": "C", "text": odp3, "is_correct": False},
            {"key": "D", "text": odp4, "is_correct": False},
        ]
        parsed.append(
            ParsedQuestion(
                source_row_number=source_row_number,
                external_id=external_id,
                category=infer_category(external_id),
                question_text=question_text,
                correct_answer_key="A",
                answers=answers,
            )
        )
    return parsed


def import_pdfplumber():
    try:
        import pdfplumber  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - environment/dependency guard
        raise SystemExit(
            "Missing dependency 'pdfplumber'. Install with: python -m pip install -r requirements.txt"
        ) from exc
    return pdfplumber


def extract_table_rows(pdf_path: Path, stats: ParseStats) -> list[ExtractedRow]:
    """Extract rows using multiple table strategies before falling back to text."""

    pdfplumber = import_pdfplumber()
    row_candidates: list[ExtractedRow] = []
    table_settings_variants = [
        {
            "vertical_strategy": "lines",
            "horizontal_strategy": "lines",
            "snap_tolerance": 3,
            "join_tolerance": 3,
            "intersection_tolerance": 5,
            "text_x_tolerance": 2,
            "text_y_tolerance": 3,
        },
        {
            "vertical_strategy": "text",
            "horizontal_strategy": "text",
            "snap_tolerance": 4,
            "join_tolerance": 4,
            "intersection_tolerance": 6,
            "text_x_tolerance": 2,
            "text_y_tolerance": 3,
        },
    ]

    with pdfplumber.open(str(pdf_path)) as pdf:
        stats.pages_scanned = len(pdf.pages)
        for page_number, page in enumerate(pdf.pages, start=1):
            page_rows = 0
            for strategy_index, table_settings in enumerate(table_settings_variants, start=1):
                tables = page.extract_tables(table_settings=table_settings) or []
                if not tables:
                    continue
                method = f"table-{strategy_index}"
                for table in tables:
                    for row in table:
                        stats.rows_scanned += 1
                        page_rows += 1
                        row_candidates.append(ExtractedRow(row, page_number, method))
                # Prefer the first strategy that finds table rows on this page;
                # the text/regex passes below still audit IDs missed by tables.
                if page_rows:
                    break
            if not page_rows:
                stats.issues.append(ParseIssue(page_number, "table", "no table rows extracted"))
    return row_candidates


def collect_pdf_text(pdf_path: Path, stats: ParseStats) -> list[tuple[int, list[str], str]]:
    """Extract page text once for regex fallback and coverage auditing."""

    pdfplumber = import_pdfplumber()
    pages: list[tuple[int, list[str], str]] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        stats.pages_scanned = max(stats.pages_scanned, len(pdf.pages))
        for page_number, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(x_tolerance=1, y_tolerance=3, layout=True) or ""
            lines = [line.rstrip() for line in text.splitlines()]
            stats.text_lines_scanned += len(lines)
            for question_id in extract_question_ids(text):
                stats.detected_ids.add(question_id)
            pages.append((page_number, lines, text))
            if text and not extract_question_ids(text) and not HEADER_WORDS_RE.search(text):
                stats.issues.append(ParseIssue(page_number, "text", "page text contained no question IDs or table headers"))
    return pages


def split_regex_chunk_to_cells(chunk: str) -> Sequence[object] | None:
    """Best-effort line regex fallback for text chunks between question IDs.

    This handles pages where pdfplumber's table grid fails but text still keeps
    columns separated by repeated spaces. It also handles chunks with explicit
    PYTANIE/ODP labels if a PDF export includes them in the text layer.
    """

    id_match = QUESTION_ID_RE.search(chunk)
    if not id_match:
        return None

    before_id = chunk[: id_match.start()]
    source_row_number_match = re.search(r"(\d+)\s*$", before_id)
    source_row_number = source_row_number_match.group(1) if source_row_number_match else ""
    question_id = normalize_question_id(id_match.group(0))
    after_id = chunk[id_match.end() :]
    after_id = re.sub(r"\b(?:L\.?P\.?|NUMER|PYTANIE|ODP[1-4])\b", " ", after_id, flags=re.IGNORECASE)
    after_id = re.sub(r"\f|\r", "\n", after_id)

    labelled = re.search(
        r"PYTANIE\s*[:\-]?\s*(?P<question>.*?)\bODP1\s*[:\-]?\s*(?P<a>.*?)\bODP2\s*[:\-]?\s*(?P<b>.*?)\bODP3\s*[:\-]?\s*(?P<c>.*?)\bODP4\s*[:\-]?\s*(?P<d>.*)",
        chunk,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if labelled:
        return [
            source_row_number,
            question_id,
            clean_cell(labelled.group("question")),
            clean_cell(labelled.group("a")),
            clean_cell(labelled.group("b")),
            clean_cell(labelled.group("c")),
            clean_cell(labelled.group("d")),
        ]

    # Strip obvious repeated table headers/footers, then split each physical line
    # on wide gaps that usually represent PDF column boundaries.
    segments_by_line: list[list[str]] = []
    for raw_line in after_id.splitlines():
        line = clean_cell(raw_line)
        if not line or HEADER_WORDS_RE.fullmatch(line):
            continue
        parts = [part.strip() for part in re.split(r"\s{2,}", raw_line.strip()) if part.strip()]
        if parts:
            segments_by_line.append(parts)

    columns = [[], [], [], [], []]  # question, ODP1, ODP2, ODP3, ODP4
    for parts in segments_by_line:
        if len(parts) >= 5:
            for index in range(5):
                columns[index].append(parts[index])
            # If a very wide question cell was split, keep the remaining text in ODP4
            # rather than discarding it; audit will still flag empty required fields.
            if len(parts) > 5:
                columns[4].append(" ".join(parts[5:]))
        elif len(parts) == 4:
            for index in range(4):
                columns[index + 1].append(parts[index])
        elif len(parts) == 1:
            # Continuation lines most often belong to the question when column
            # alignment is lost. Keep them instead of dropping page-overflow text.
            columns[0].append(parts[0])
        else:
            # Preserve partial multi-column continuations in left-to-right order.
            for index, part in enumerate(parts[:5]):
                columns[index].append(part)

    cells = [source_row_number, question_id, *[clean_cell(" ".join(values)) for values in columns]]
    return cells if all(cells[2:]) else None


def extract_regex_rows(pages: Sequence[tuple[int, list[str], str]], stats: ParseStats) -> list[ExtractedRow]:
    """Reconstruct question rows from text between regex-detected IDs."""

    joined_parts: list[str] = []
    page_offsets: list[tuple[int, int]] = []
    offset = 0
    for page_number, _lines, text in pages:
        page_offsets.append((offset, page_number))
        page_text = f"\n\n[PAGE {page_number}]\n{text}\n"
        joined_parts.append(page_text)
        offset += len(page_text)
    joined = "".join(joined_parts)
    matches = list(QUESTION_ID_RE.finditer(joined))
    rows: list[ExtractedRow] = []

    def page_for_offset(position: int) -> int:
        page_number = 1
        for page_offset, candidate_page in page_offsets:
            if page_offset <= position:
                page_number = candidate_page
            else:
                break
        return page_number

    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(joined)
        chunk_start = max(0, match.start() - 40)
        chunk = joined[chunk_start:end]
        cells = split_regex_chunk_to_cells(chunk)
        page_number = page_for_offset(match.start())
        if cells is None:
            stats.issues.append(
                ParseIssue(page_number, "regex", "detected question ID but could not reconstruct 7 cells", (normalize_question_id(match.group(0)),))
            )
            continue
        rows.append(ExtractedRow(cells, page_number, "regex"))
    return rows


def infer_column_boundaries(words: Sequence[dict], page_width: float) -> list[float]:
    """Infer table column boundaries from header word x positions, with fallback ratios."""

    header_x: dict[str, float] = {}
    for word in words:
        normalized = re.sub(r"[^A-Z0-9]", "", str(word.get("text", "")).upper())
        if normalized in {"LP", "NUMER", "PYTANIE", "ODP1", "ODP2", "ODP3", "ODP4"}:
            header_x.setdefault(normalized, float(word["x0"]))
    ordered = [header_x.get(name) for name in ("LP", "NUMER", "PYTANIE", "ODP1", "ODP2", "ODP3", "ODP4")]
    if all(value is not None for value in ordered):
        starts = [float(value) for value in ordered if value is not None]
        boundaries = [0.0]
        boundaries.extend((left + right) / 2 for left, right in zip(starts, starts[1:]))
        boundaries.append(page_width + 1)
        return boundaries

    # Conservative fallback for landscape/portrait table exports where headers
    # are missing from the text layer. Boundaries are proportional to page width.
    ratios = [0.00, 0.07, 0.16, 0.46, 0.60, 0.74, 0.88, 1.01]
    return [page_width * ratio for ratio in ratios]


def column_for_word(word: dict, boundaries: Sequence[float]) -> int:
    center = (float(word["x0"]) + float(word["x1"])) / 2
    for index in range(len(boundaries) - 1):
        if boundaries[index] <= center < boundaries[index + 1]:
            return index
    return len(boundaries) - 2


def extract_geometry_rows(pdf_path: Path, stats: ParseStats) -> list[ExtractedRow]:
    """Rebuild rows using word coordinates when table extraction misses rows.

    Row intervals start at regex-detected question IDs in the NUMER column and
    continue until the next ID, even if that interval crosses a page break.
    """

    pdfplumber = import_pdfplumber()
    all_words: list[dict] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        stats.pages_scanned = max(stats.pages_scanned, len(pdf.pages))
        page_offsets: dict[int, float] = {}
        accumulated_height = 0.0
        for page_number, page in enumerate(pdf.pages, start=1):
            page_offsets[page_number] = accumulated_height
            words = page.extract_words(x_tolerance=1, y_tolerance=3, keep_blank_chars=False) or []
            boundaries = infer_column_boundaries(words, float(page.width))
            for word in words:
                text = str(word.get("text", ""))
                if not text.strip():
                    continue
                enriched = dict(word)
                enriched["page_number"] = page_number
                enriched["abs_top"] = accumulated_height + float(word["top"])
                enriched["abs_bottom"] = accumulated_height + float(word["bottom"])
                enriched["column"] = column_for_word(word, boundaries)
                all_words.append(enriched)
            accumulated_height += float(page.height) + 20.0

    all_words.sort(key=lambda item: (item["abs_top"], item["x0"]))
    row_starts: list[tuple[float, int, str]] = []
    for index, word in enumerate(all_words):
        if word["column"] != 1:
            continue
        same_line_words = [word]
        for other in all_words[index + 1 : index + 4]:
            if other["column"] == 1 and abs(float(other["abs_top"]) - float(word["abs_top"])) <= 3:
                same_line_words.append(other)
        candidate = " ".join(str(item["text"]) for item in same_line_words)
        match = QUESTION_ID_RE.search(candidate)
        if match:
            question_id = normalize_question_id(match.group(0))
            stats.detected_ids.add(question_id)
            row_starts.append((float(word["abs_top"]), int(word["page_number"]), question_id))

    # Deduplicate starts caused by scanning both 'PL' and number tokens on one line.
    deduped_starts: list[tuple[float, int, str]] = []
    seen_start_keys: set[tuple[int, str]] = set()
    for abs_top, page_number, question_id in sorted(row_starts):
        key = (round(abs_top), question_id)
        if key in seen_start_keys:
            continue
        seen_start_keys.add(key)
        deduped_starts.append((abs_top, page_number, question_id))

    rows: list[ExtractedRow] = []
    for index, (start_top, page_number, _question_id) in enumerate(deduped_starts):
        end_top = deduped_starts[index + 1][0] if index + 1 < len(deduped_starts) else float("inf")
        row_words = [word for word in all_words if start_top - 1 <= float(word["abs_top"]) < end_top - 1]
        columns: list[list[dict]] = [[] for _ in range(7)]
        for word in row_words:
            column = int(word["column"])
            if 0 <= column <= 6 and not HEADER_WORDS_RE.fullmatch(str(word["text"])):
                columns[column].append(word)
        cells: list[str] = []
        for column_words in columns:
            column_words.sort(key=lambda item: (item["abs_top"], item["x0"]))
            cells.append(clean_cell(" ".join(str(word["text"]) for word in column_words)))
        if any(cells):
            rows.append(ExtractedRow(cells, page_number, "geometry"))
    return rows


def merge_candidates(candidates: Iterable[ExtractedRow], stats: ParseStats) -> list[ParsedQuestion]:
    """Merge strategies, preserving first complete record for each question ID."""

    parsed_by_id: dict[str, ParsedQuestion] = {}
    method_priority = {"table-1": 0, "table-2": 1, "geometry": 2, "regex": 3}
    candidate_list = sorted(candidates, key=lambda row: (method_priority.get(row.method, 99), row.page_number))

    for candidate in candidate_list:
        parsed_questions = coerce_row(candidate.cells)
        if not parsed_questions:
            detected = tuple(extract_question_ids(" ".join(clean_cell(cell) for cell in candidate.cells)))
            if detected:
                stats.issues.append(
                    ParseIssue(candidate.page_number, candidate.method, "row had IDs but missing question/answer cells", detected)
                )
            continue
        for question in parsed_questions:
            if question.external_id in parsed_by_id:
                stats.duplicate_ids.add(question.external_id)
                continue
            parsed_by_id[question.external_id] = question
            stats.detected_ids.add(question.external_id)
            stats.record_parsed(candidate.method)
    return sorted(parsed_by_id.values(), key=lambda question: question.external_id)


def parse_pdf(pdf_path: Path) -> tuple[list[ParsedQuestion], ParseStats]:
    stats = ParseStats()
    table_rows = extract_table_rows(pdf_path, stats)
    text_pages = collect_pdf_text(pdf_path, stats)
    geometry_rows = extract_geometry_rows(pdf_path, stats)
    regex_rows = extract_regex_rows(text_pages, stats)
    questions = merge_candidates([*table_rows, *geometry_rows, *regex_rows], stats)
    return questions, stats


def print_validation_log(stats: ParseStats, parsed_questions: Sequence[ParsedQuestion]) -> None:
    parsed_ids = {question.external_id for question in parsed_questions}
    missing_detected_ids = sorted(stats.detected_ids - parsed_ids)
    issue_pages = sorted({issue.page_number for issue in stats.issues})

    print("Validation log:")
    print(f"  Total pages scanned: {stats.pages_scanned}")
    print(f"  Total lines/rows scanned: {stats.total_scanned} ({stats.text_lines_scanned} text lines, {stats.rows_scanned} table rows)")
    print(f"  Total question IDs detected: {len(stats.detected_ids)}")
    print(f"  Total questions successfully parsed: {len(parsed_questions)}")
    print(f"  Parsed by method: {dict(sorted(stats.parsed_by_method.items()))}")
    print(f"  Duplicate IDs ignored: {sorted(stats.duplicate_ids) if stats.duplicate_ids else 'none'}")
    print(f"  Skipped/detected IDs not parsed: {missing_detected_ids if missing_detected_ids else 'none'}")
    print(f"  Pages with extraction issues: {issue_pages if issue_pages else 'none'}")
    if stats.issues:
        print("  Issue details:")
        for issue in stats.issues[:100]:
            ids = f" ids={list(issue.detected_ids)}" if issue.detected_ids else ""
            print(f"    - page {issue.page_number} [{issue.method}]: {issue.reason}{ids}")
        if len(stats.issues) > 100:
            print(f"    ... {len(stats.issues) - 100} more issues omitted from console output")


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse the PPL(A) PDF table into structured JSON.")
    parser.add_argument("--input", default="ppla.pdf", type=Path, help="Path to source ppla.pdf")
    parser.add_argument("--output", default="data/questions.json", type=Path, help="Path for generated JSON")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON for review")
    parser.add_argument(
        "--allow-audit-gaps",
        action="store_true",
        help="Write output even when regex-detected question IDs could not be reconstructed",
    )
    args = parser.parse_args()

    if not args.input.exists():
        parser.error(f"Input PDF not found: {args.input}")

    questions, stats = parse_pdf(args.input)
    print_validation_log(stats, questions)
    if not questions:
        raise SystemExit("No questions parsed. Check PDF extraction settings or source format.")

    missing_detected_ids = sorted(stats.detected_ids - {question.external_id for question in questions})
    if missing_detected_ids and not args.allow_audit_gaps:
        raise SystemExit(
            "Refusing to write incomplete questions.json because some detected IDs were not parsed. "
            f"Missing IDs: {missing_detected_ids}. Re-run with --allow-audit-gaps only for manual debugging."
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = [asdict(question) for question in questions]
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {len(payload)} questions to {args.output}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
