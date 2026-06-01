#!/usr/bin/env python3
"""One-time importer for the PPL(A) PDF question bank.

The source PDF *looks* like a simple table with these columns:
L.p., NUMER, PYTANIE, ODP1, ODP2, ODP3, ODP4.

In practice, official PDF exports can have a broken text/table structure:
multiple visual rows may be merged into a single extracted table row, question
IDs can be jammed together in one NUMER cell, and answer text can be shifted by
multi-line wrapping.  This importer therefore treats a question ID as the hard
record boundary and combines several extraction passes instead of trusting
``page.extract_table()`` alone.

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
import bisect
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

EXPECTED_COLUMNS = ("L.p.", "NUMER", "PYTANIE", "ODP1", "ODP2", "ODP3", "ODP4")
NORMALIZED_COLUMNS = tuple(re.sub(r"[^A-Z0-9]", "", value.upper()) for value in EXPECTED_COLUMNS)
# Match both full IDs (PL 100-0126 / PL100-0126) and short aviation anchors
# (PL100) so a malformed text layer still creates an audit anchor.  Full IDs are
# preferred and are what the question bank normally contains.
QUESTION_ID_RE = re.compile(r"\bPL\s*\d{3}(?:\s*-\s*\d{4})?\b", re.IGNORECASE)
FULL_QUESTION_ID_RE = re.compile(r"^PL\d{3}-\d{4}$", re.IGNORECASE)
HEADER_WORDS_RE = re.compile(r"\b(L\.?P\.?|NUMER|PYTANIE|ODP[1-4])\b", re.IGNORECASE)
PAGE_MARKER_RE = re.compile(r"\[PAGE\s+\d+\]")

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
    "100": "GENERAL_SAFETY",
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
class PdfTextLine:
    """One positioned text line from pdfminer."""

    page_number: int
    abs_top: float
    x0: float
    text: str

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
    sequential_gaps: list[int] = field(default_factory=list)
    issues: list[ParseIssue] = field(default_factory=list)
    parsed_by_method: dict[str, int] = field(default_factory=dict)

    @property
    def total_scanned(self) -> int:
        return self.rows_scanned + self.text_lines_scanned

    def record_parsed(self, method: str) -> None:
        self.parsed_by_method[method] = self.parsed_by_method.get(method, 0) + 1


def clean_cell(value: object) -> str:
    """Normalize PDF cell text while preserving meaningful punctuation."""

    if value is None:
        return ""
    text = str(value).replace("\u00a0", " ")
    text = re.sub(r"\r|\f", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    # Triple-newline runs are extractor noise.  Keep a single logical separator
    # until row unjamming has had a chance to inspect the raw line structure.
    text = re.sub(r"\n{2,}", "\n", text)
    text = re.sub(r"\s*\n\s*", " ", text)
    return text.strip()


def clean_multiline(value: object) -> str:
    """Normalize spaces but keep line breaks for row-splitting heuristics."""

    if value is None:
        return ""
    text = str(value).replace("\u00a0", " ")
    text = re.sub(r"\r|\f", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_question_id(value: str) -> str:
    """Canonicalize IDs such as 'PL 010 - 0003' to 'PL010-0003'."""

    compact = re.sub(r"\s+", "", value.upper())
    return re.sub(r"^(PL\d{3})-?(\d{4})$", r"\1-\2", compact)


def extract_question_ids(value: str, *, full_only: bool = False) -> list[str]:
    """Return every question ID/anchor present in a chunk, preserving order."""

    ids: list[str] = []
    for match in QUESTION_ID_RE.finditer(value):
        question_id = normalize_question_id(match.group(0))
        if full_only and not FULL_QUESTION_ID_RE.fullmatch(question_id):
            continue
        if question_id not in ids:
            ids.append(question_id)
    return ids


def normalized_header(row: Sequence[object]) -> tuple[str, ...]:
    return tuple(re.sub(r"[^A-Z0-9]", "", clean_cell(cell).upper()) for cell in row)


def row_looks_like_header(row: Sequence[object]) -> bool:
    normalized = normalized_header(row)
    return len(normalized) >= 7 and normalized[:7] == NORMALIZED_COLUMNS


def infer_category(external_id: str) -> str:
    """Infer one of the PPL(A) subjects from common numeric prefixes."""

    match = re.search(r"(?:^|[^0-9])(010|020|030|040|050|060|070|080|090|100)(?:[^0-9]|$)", external_id)
    return CATEGORY_BY_PREFIX.get(match.group(1), "UNKNOWN") if match else "UNKNOWN"


def source_row_number_from_text(value: str) -> int | None:
    digits = re.sub(r"[^0-9]", "", value)
    return int(digits) if digits else None


def build_question(source_row_number: int | None, external_id: str, cells: Sequence[str]) -> ParsedQuestion | None:
    question_text, odp1, odp2, odp3, odp4 = (clean_cell(cell) for cell in cells[:5])
    # Some source rows genuinely omit one or more distractor cells, but ODP1 is
    # the canonical correct answer and must stay attached to the anchored ID.
    # Keep the record auditable instead of dropping the question ID entirely.
    if not external_id or not question_text or not odp1:
        return None
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


def split_lines_evenly(text: str, count: int) -> list[str]:
    """Split a stacked multiline cell into roughly equal line chunks."""

    lines = [line.strip() for line in clean_multiline(text).splitlines() if line.strip()]
    if count <= 1:
        return [clean_cell(text)]
    if not lines:
        return [""] * count
    chunks: list[str] = []
    for index in range(count):
        start = round(index * len(lines) / count)
        end = round((index + 1) * len(lines) / count)
        chunks.append(clean_cell("\n".join(lines[start:end])))
    return chunks


def split_stacked_cell(text: str, count: int) -> list[str]:
    """Split a cell from a jammed table row into one value per question."""

    if count <= 1:
        return [clean_cell(text)]
    raw = clean_multiline(text)
    if not raw:
        return [""] * count

    # If a PDF extractor preserved blank lines between visual rows, trust those
    # first because they keep ODP1/ODP2/ODP3/ODP4 attached to their own question.
    paragraph_parts = [clean_cell(part) for part in re.split(r"\n\s*\n", raw) if clean_cell(part)]
    if len(paragraph_parts) == count:
        return paragraph_parts

    # If the cell itself contains question IDs, split on the ID anchors.
    matches = list(QUESTION_ID_RE.finditer(raw))
    if len(matches) == count:
        parts: list[str] = []
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(raw)
            parts.append(clean_cell(raw[match.start() : end]))
        return parts

    return split_lines_evenly(raw, count)


def unjam_table_row(row: Sequence[object]) -> list[list[str]]:
    """Split one physically jammed extractor row into independent 7-cell rows.

    Standard table extraction is still useful for coordinates/columns, but it may
    merge several visual rows into one extracted row.  The NUMER column is the
    source of truth: every question ID found there becomes a separate candidate,
    and all other columns are split into matching stacked chunks so ODP1 remains
    attached to its own ID rather than duplicated across all split records.
    """

    padded = list(row[:7]) + [""] * (7 - len(row[:7]))
    raw_cells = [clean_multiline(cell) for cell in padded[:7]]
    if len(raw_cells) < 7 or not any(raw_cells) or row_looks_like_header(raw_cells):
        return []

    ids = extract_question_ids(raw_cells[1], full_only=True) or extract_question_ids("\n".join(raw_cells), full_only=True)
    if len(ids) <= 1:
        return [[clean_cell(cell) for cell in raw_cells]]

    split_columns = [split_stacked_cell(cell, len(ids)) for cell in raw_cells]
    rows: list[list[str]] = []
    for index, question_id in enumerate(ids):
        split_row = [column[index] if index < len(column) else "" for column in split_columns]
        split_row[1] = question_id
        rows.append(split_row)
    return rows


def coerce_single_row(row: Sequence[object]) -> ParsedQuestion | None:
    padded = list(row[:7]) + [""] * (7 - len(row[:7]))
    cells = [clean_cell(cell) for cell in padded[:7]]
    if len(cells) < 7 or not any(cells) or row_looks_like_header(cells):
        return None

    lp, external_id_cell, question_text, odp1, odp2, odp3, odp4 = cells
    external_ids = extract_question_ids(external_id_cell, full_only=True)
    if not external_ids and external_id_cell:
        normalized = normalize_question_id(external_id_cell)
        if FULL_QUESTION_ID_RE.fullmatch(normalized):
            external_ids = [normalized]
    if len(external_ids) != 1:
        return None
    return build_question(source_row_number_from_text(lp), external_ids[0], (question_text, odp1, odp2, odp3, odp4))


def coerce_row(row: Sequence[object]) -> list[ParsedQuestion]:
    """Convert one extracted PDF row into zero or more domain records."""

    parsed: list[ParsedQuestion] = []
    for split_row in unjam_table_row(row):
        question = coerce_single_row(split_row)
        if question is not None:
            parsed.append(question)
    return parsed



def import_pdfminer():
    try:
        from pdfminer.high_level import extract_pages  # type: ignore[import-not-found]
        from pdfminer.layout import LTTextContainer, LTTextLineHorizontal  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise SystemExit(
            "Missing dependency 'pdfminer.six' (installed with pdfplumber). Install with: python -m pip install -r requirements.txt"
        ) from exc
    return extract_pages, LTTextContainer, LTTextLineHorizontal


def infer_pdfminer_boundaries(lines: Sequence[PdfTextLine], page_width: float) -> list[float]:
    """Infer column boundaries from pdfminer header text positions."""

    header_x: dict[str, float] = {}
    for line in lines:
        normalized = re.sub(r"[^A-Z0-9]", "", line.text.upper())
        if "LP" in normalized and "NUMER" in normalized:
            header_x.setdefault("LP", line.x0)
            header_x.setdefault("NUMER", line.x0 + 42.0)
        elif normalized in {"PYTANIE", "ODP1", "ODP2", "ODP3", "ODP4"}:
            header_x.setdefault(normalized, line.x0)
    ordered = [header_x.get(name) for name in ("LP", "NUMER", "PYTANIE", "ODP1", "ODP2", "ODP3", "ODP4")]
    if all(value is not None for value in ordered):
        starts = [float(value) for value in ordered if value is not None]
        boundaries = [0.0]
        boundaries.extend((left + right) / 2 for left, right in zip(starts, starts[1:]))
        boundaries.append(page_width + 1)
        return boundaries
    # Header rows are often missing on continuation pages.  In that case the
    # table still has very stable x-start clusters; derive the starts from the
    # repeated line positions instead of falling back to broad page ratios.
    x_counts: dict[int, int] = {}
    for line in lines:
        bucket = round(line.x0)
        x_counts[bucket] = x_counts.get(bucket, 0) + 1
    frequent_x = sorted(x for x, count in x_counts.items() if count >= 2)
    content_starts = [x for x in frequent_x if x >= 180][:5]
    source_candidates = [x for x in frequent_x if x < 180]
    if source_candidates and len(content_starts) == 5:
        source_x = source_candidates[0]
        starts = [float(source_x), float(source_x + 45), *[float(x) for x in content_starts]]
        boundaries = [0.0]
        boundaries.extend((left + right) / 2 for left, right in zip(starts, starts[1:]))
        boundaries.append(page_width + 1)
        return boundaries

    # Last-resort constants match the landscape PPL(A) table used by the source
    # bank.  They are intentionally narrower than proportional ratios so ODP4 at
    # x≈668 does not get swallowed by ODP3/blank space on headerless pages.
    fallback_starts = [76.0, 122.0, 218.0, 318.0, 450.0, 559.0, 667.0]
    boundaries = [0.0]
    boundaries.extend((left + right) / 2 for left, right in zip(fallback_starts, fallback_starts[1:]))
    boundaries.append(max(page_width, fallback_starts[-1]) + 200.0)
    return boundaries


def extract_pdfminer_pages(pdf_path: Path, stats: ParseStats) -> tuple[list[tuple[int, list[str], str]], list[PdfTextLine], float]:
    """Read the PDF text layer quickly with coordinates using pdfminer."""

    extract_pages, LTTextContainer, LTTextLineHorizontal = import_pdfminer()
    pages: list[tuple[int, list[str], str]] = []
    positioned_lines: list[PdfTextLine] = []
    accumulated_height = 0.0
    max_width = 0.0

    for page_number, page_layout in enumerate(extract_pages(str(pdf_path)), start=1):
        stats.pages_scanned = page_number
        page_lines: list[PdfTextLine] = []
        page_width = float(getattr(page_layout, "width", 0.0) or 0.0)
        page_height = float(getattr(page_layout, "height", 0.0) or 0.0)
        max_width = max(max_width, page_width)
        for element in page_layout:
            if not isinstance(element, LTTextContainer):
                continue
            for text_line in element:
                if not isinstance(text_line, LTTextLineHorizontal):
                    continue
                text = text_line.get_text().strip()
                if not text:
                    continue
                # abs_top increases from document top to bottom, independent of
                # PDF's bottom-origin coordinate system.
                abs_top = accumulated_height + (page_height - float(text_line.y1))
                page_lines.append(PdfTextLine(page_number, abs_top, float(text_line.x0), text))
        page_lines.sort(key=lambda line: (line.abs_top, line.x0))
        text_lines = [line.text for line in page_lines]
        stats.text_lines_scanned += len(text_lines)
        page_text = "\n".join(text_lines)
        for question_id in extract_question_ids(page_text, full_only=True):
            stats.detected_ids.add(question_id)
        pages.append((page_number, text_lines, page_text))
        positioned_lines.extend(page_lines)
        accumulated_height += page_height + 20.0

    return pages, positioned_lines, max_width


def split_source_and_id(text: str) -> tuple[str, str] | None:
    match = QUESTION_ID_RE.search(text)
    if not match:
        return None
    question_id = normalize_question_id(match.group(0))
    if not FULL_QUESTION_ID_RE.fullmatch(question_id):
        return None
    before = text[: match.start()]
    source_match = re.search(r"(\d+)\s*$", before)
    return (source_match.group(1) if source_match else "", question_id)


def extract_pdfminer_geometry_rows(lines: Sequence[PdfTextLine], page_width: float, stats: ParseStats) -> list[ExtractedRow]:
    """Create one row per regex ID anchor using positioned pdfminer lines."""

    if not lines:
        return []
    lines_by_page: dict[int, list[PdfTextLine]] = {}
    for line in lines:
        lines_by_page.setdefault(line.page_number, []).append(line)

    boundaries_by_page = {
        page_number: infer_pdfminer_boundaries(page_lines, page_width)
        for page_number, page_lines in lines_by_page.items()
    }

    starts: list[tuple[float, int, str, str]] = []
    for line in lines:
        parsed = split_source_and_id(line.text)
        if parsed is None:
            continue
        source_row, question_id = parsed
        stats.detected_ids.add(question_id)
        starts.append((line.abs_top, line.page_number, source_row, question_id))

    starts.sort(key=lambda item: item[0])
    sorted_lines = sorted(lines, key=lambda item: (item.abs_top, item.x0))
    line_tops = [line.abs_top for line in sorted_lines]

    rows: list[ExtractedRow] = []
    for index, (start_top, page_number, source_row, question_id) in enumerate(starts):
        end_top = starts[index + 1][0] if index + 1 < len(starts) else float("inf")
        start_index = max(0, bisect.bisect_left(line_tops, start_top - 0.5))
        end_index = bisect.bisect_left(line_tops, end_top - 0.5) if end_top != float("inf") else len(sorted_lines)
        row_lines = sorted_lines[start_index:end_index]
        columns: list[list[str]] = [[] for _ in range(7)]
        columns[0].append(source_row)
        columns[1].append(question_id)
        for line in row_lines:
            if HEADER_WORDS_RE.fullmatch(line.text) or PAGE_MARKER_RE.fullmatch(line.text):
                continue
            if split_source_and_id(line.text) is not None:
                continue
            boundaries = boundaries_by_page.get(line.page_number) or infer_pdfminer_boundaries([], page_width)
            column = column_for_x(line.x0, boundaries)
            if 2 <= column <= 6:
                if column == 2 and not columns[3]:
                    # Occasionally pdfminer merges the PYTANIE and ODP1 text
                    # into one LTTextLine while preserving a wide internal gap.
                    # Split only the first such line so ODP1 remains attached to
                    # this anchored question instead of leaving the answer empty.
                    split_parts = [part.strip() for part in re.split(r"\s{2,}", line.text, maxsplit=1) if part.strip()]
                    if len(split_parts) == 2:
                        columns[2].append(split_parts[0])
                        columns[3].append(split_parts[1])
                        continue
                columns[column].append(line.text)
        cells = [clean_cell("\n".join(values)) for values in columns]
        if cells[1] and cells[2] and cells[3]:
            rows.append(ExtractedRow(cells, page_number, "pdfminer-geometry"))
        else:
            stats.issues.append(ParseIssue(page_number, "pdfminer-geometry", "anchor found but question text or ODP1 was empty", (question_id,)))
    return rows


def column_for_x(x0: float, boundaries: Sequence[float]) -> int:
    for index in range(len(boundaries) - 1):
        if boundaries[index] <= x0 < boundaries[index + 1]:
            return index
    return len(boundaries) - 2


def import_pdfplumber():
    try:
        import pdfplumber  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - environment/dependency guard
        raise SystemExit(
            "Missing dependency 'pdfplumber'. Install with: python -m pip install -r requirements.txt"
        ) from exc
    return pdfplumber


def extract_table_rows(pdf_path: Path, stats: ParseStats) -> list[ExtractedRow]:
    """Extract rows using table strategies, then aggressively unjam them."""

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
                        for split_row in unjam_table_row(row):
                            split_method = f"{method}-unjam" if len(split_row) == 7 and len(extract_question_ids(str(row), full_only=True)) > 1 else method
                            row_candidates.append(ExtractedRow(split_row, page_number, split_method))
                # Prefer the first strategy that finds table rows on this page;
                # geometry/text passes below still audit IDs missed by tables.
                if page_rows:
                    break
            if not page_rows:
                stats.issues.append(ParseIssue(page_number, "table", "no table rows extracted"))
    return row_candidates


def collect_pdf_text(pdf_path: Path, stats: ParseStats) -> list[tuple[int, list[str], str]]:
    """Extract page text once for line-by-line regex fallback and audit."""

    pdfplumber = import_pdfplumber()
    pages: list[tuple[int, list[str], str]] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        stats.pages_scanned = max(stats.pages_scanned, len(pdf.pages))
        for page_number, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(x_tolerance=1, y_tolerance=3, layout=True) or ""
            lines = [line.rstrip() for line in text.splitlines()]
            stats.text_lines_scanned += len(lines)
            for question_id in extract_question_ids(text, full_only=True):
                stats.detected_ids.add(question_id)
            pages.append((page_number, lines, text))
            if text and not extract_question_ids(text) and not HEADER_WORDS_RE.search(text):
                stats.issues.append(ParseIssue(page_number, "text", "page text contained no question IDs or table headers"))
    return pages


def strip_text_noise(text: str) -> str:
    text = PAGE_MARKER_RE.sub(" ", text)
    text = re.sub(r"\b(?:L\.?P\.?|NUMER|PYTANIE|ODP[1-4])\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_regex_chunk_to_cells(chunk: str) -> Sequence[object] | None:
    """Best-effort regex fallback for the text between two question ID anchors."""

    id_match = QUESTION_ID_RE.search(chunk)
    if not id_match:
        return None

    before_id = chunk[: id_match.start()]
    source_row_number_match = re.search(r"(\d+)\s*$", before_id)
    source_row_number = source_row_number_match.group(1) if source_row_number_match else ""
    question_id = normalize_question_id(id_match.group(0))
    if not FULL_QUESTION_ID_RE.fullmatch(question_id):
        return None
    after_id = strip_text_noise(chunk[id_match.end() :])

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
            if len(parts) > 5:
                columns[4].append(" ".join(parts[5:]))
        elif len(parts) == 4:
            for index in range(4):
                columns[index + 1].append(parts[index])
        elif len(parts) == 1:
            columns[0].append(parts[0])
        else:
            for index, part in enumerate(parts[:5]):
                columns[index].append(part)

    cells = [source_row_number, question_id, *[clean_cell(" ".join(values)) for values in columns]]
    return cells if all(cells[2:]) else None


def extract_regex_rows(pages: Sequence[tuple[int, list[str], str]], stats: ParseStats) -> list[ExtractedRow]:
    """Reconstruct question rows from text between regex-detected IDs.

    This pass is deliberately anchor-driven: every full ``PL ###-####`` match in
    page-layout text starts a new candidate entity, even when table extraction has
    already returned a conflicting/jammed row.
    """

    joined_parts: list[str] = []
    page_offsets: list[tuple[int, int]] = []
    offset = 0
    for page_number, _lines, text in pages:
        page_offsets.append((offset, page_number))
        page_text = f"\n\n[PAGE {page_number}]\n{text}\n"
        joined_parts.append(page_text)
        offset += len(page_text)
    joined = "".join(joined_parts)
    matches = [match for match in QUESTION_ID_RE.finditer(joined) if FULL_QUESTION_ID_RE.fullmatch(normalize_question_id(match.group(0)))]
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
        question_id = normalize_question_id(match.group(0))
        stats.detected_ids.add(question_id)
        if cells is None:
            # The regex pass is an anchor audit/fallback.  A geometry candidate
            # usually owns the full row; final coverage is enforced by comparing
            # detected IDs with parsed IDs instead of logging duplicate noise here.
            continue
        rows.append(ExtractedRow(cells, page_number, "regex"))
    return rows


def infer_column_boundaries(words: Sequence[dict], page_width: float) -> list[float]:
    """Infer table column boundaries from header x positions, with fallback ratios."""

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

    ratios = [0.00, 0.07, 0.16, 0.46, 0.60, 0.74, 0.88, 1.01]
    return [page_width * ratio for ratio in ratios]


def column_for_word(word: dict, boundaries: Sequence[float]) -> int:
    center = (float(word["x0"]) + float(word["x1"])) / 2
    for index in range(len(boundaries) - 1):
        if boundaries[index] <= center < boundaries[index + 1]:
            return index
    return len(boundaries) - 2


def extract_geometry_rows(pdf_path: Path, stats: ParseStats) -> list[ExtractedRow]:
    """Rebuild rows using word coordinates and question-ID row anchors."""

    pdfplumber = import_pdfplumber()
    all_words: list[dict] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        stats.pages_scanned = max(stats.pages_scanned, len(pdf.pages))
        accumulated_height = 0.0
        for page_number, page in enumerate(pdf.pages, start=1):
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
        for other in all_words[index + 1 : index + 5]:
            if other["column"] == 1 and abs(float(other["abs_top"]) - float(word["abs_top"])) <= 3:
                same_line_words.append(other)
        candidate = " ".join(str(item["text"]) for item in same_line_words)
        for question_id in extract_question_ids(candidate, full_only=True):
            stats.detected_ids.add(question_id)
            row_starts.append((float(word["abs_top"]), int(word["page_number"]), question_id))

    deduped_starts: list[tuple[float, int, str]] = []
    seen_start_keys: set[tuple[int, str]] = set()
    for abs_top, page_number, question_id in sorted(row_starts):
        key = (round(abs_top), question_id)
        if key in seen_start_keys:
            continue
        seen_start_keys.add(key)
        deduped_starts.append((abs_top, page_number, question_id))

    abs_tops = [float(word["abs_top"]) for word in all_words]
    rows: list[ExtractedRow] = []
    for index, (start_top, page_number, _question_id) in enumerate(deduped_starts):
        end_top = deduped_starts[index + 1][0] if index + 1 < len(deduped_starts) else float("inf")
        start_index = max(0, bisect.bisect_left(abs_tops, start_top - 1))
        end_index = bisect.bisect_left(abs_tops, end_top - 1) if end_top != float("inf") else len(all_words)
        row_words = all_words[start_index:end_index]
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
    method_priority = {"pdfminer-geometry": 0, "geometry": 1, "regex": 2, "table-1-unjam": 3, "table-2-unjam": 4, "table-1": 5, "table-2": 6}
    candidate_list = sorted(candidates, key=lambda row: (method_priority.get(row.method, 99), row.page_number))

    for candidate in candidate_list:
        parsed_questions = coerce_row(candidate.cells)
        if not parsed_questions:
            detected = tuple(extract_question_ids(" ".join(clean_cell(cell) for cell in candidate.cells), full_only=True))
            if detected and candidate.method != "regex":
                stats.issues.append(ParseIssue(candidate.page_number, candidate.method, "row had IDs but missing question/answer cells", detected))
            continue
        for question in parsed_questions:
            if question.external_id in parsed_by_id:
                stats.duplicate_ids.add(question.external_id)
                continue
            parsed_by_id[question.external_id] = question
            stats.detected_ids.add(question.external_id)
            stats.record_parsed(candidate.method)
    return sorted(parsed_by_id.values(), key=lambda question: (question.source_row_number or 10**9, question.external_id))


def audit_sequential_index(stats: ParseStats, parsed_questions: Sequence[ParsedQuestion]) -> None:
    numbers = sorted({question.source_row_number for question in parsed_questions if question.source_row_number is not None})
    if not numbers:
        return
    expected = set(range(1, max(numbers) + 1))
    stats.sequential_gaps = sorted(expected - set(numbers))
    if stats.sequential_gaps:
        stats.issues.append(ParseIssue(0, "audit", "missing L.p. sequential indices after extraction"))


def parse_pdf(pdf_path: Path) -> tuple[list[ParsedQuestion], ParseStats]:
    stats = ParseStats()
    # Primary pass: pdfminer line geometry is substantially faster and less
    # prone to table-row jamming than pdfplumber's table extractor.  Every full
    # question ID becomes a hard row anchor here.
    text_pages, pdfminer_lines, page_width = extract_pdfminer_pages(pdf_path, stats)
    pdfminer_rows = extract_pdfminer_geometry_rows(pdfminer_lines, page_width, stats)
    regex_rows = extract_regex_rows(text_pages, stats)

    # Keep the slower pdfplumber table/word passes as rescue strategies only if
    # the anchor-driven text layer is absent or clearly unusable.
    rescue_rows: list[ExtractedRow] = []
    if not pdfminer_rows:
        table_rows = extract_table_rows(pdf_path, stats)
        geometry_rows = extract_geometry_rows(pdf_path, stats)
        rescue_rows = [*geometry_rows, *table_rows]

    questions = merge_candidates([*pdfminer_rows, *regex_rows, *rescue_rows], stats)
    audit_sequential_index(stats, questions)
    return questions, stats


def print_validation_log(stats: ParseStats, parsed_questions: Sequence[ParsedQuestion]) -> None:
    parsed_ids = {question.external_id for question in parsed_questions}
    missing_detected_ids = sorted(stats.detected_ids - parsed_ids)
    issue_pages = sorted({issue.page_number for issue in stats.issues if issue.page_number})

    print("Validation log:")
    print(f"  Total pages scanned: {stats.pages_scanned}")
    print(f"  Total lines/rows scanned: {stats.total_scanned} ({stats.text_lines_scanned} text lines, {stats.rows_scanned} table rows)")
    print(f"  Total distinct full question IDs detected: {len(stats.detected_ids)}")
    print(f"  Total questions successfully parsed: {len(parsed_questions)}")
    print(f"  Parsed by method: {dict(sorted(stats.parsed_by_method.items()))}")
    print(f"  Duplicate IDs ignored: {sorted(stats.duplicate_ids) if stats.duplicate_ids else 'none'}")
    print(f"  Skipped/detected IDs not parsed: {missing_detected_ids if missing_detected_ids else 'none'}")
    print(f"  Missing sequential L.p. indices: {stats.sequential_gaps if stats.sequential_gaps else 'none'}")
    print(f"  Pages with extraction issues: {issue_pages if issue_pages else 'none'}")
    if stats.issues:
        print("  Issue details:")
        for issue in stats.issues[:100]:
            ids = f" ids={list(issue.detected_ids)}" if issue.detected_ids else ""
            page = f"page {issue.page_number}" if issue.page_number else "global"
            print(f"    - {page} [{issue.method}]: {issue.reason}{ids}")
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
        help="Write output even when detected question IDs or sequential indices could not be reconstructed",
    )
    args = parser.parse_args()

    if not args.input.exists():
        parser.error(f"Input PDF not found: {args.input}")

    questions, stats = parse_pdf(args.input)
    print_validation_log(stats, questions)
    if not questions:
        raise SystemExit("No questions parsed. Check PDF extraction settings or source format.")

    missing_detected_ids = sorted(stats.detected_ids - {question.external_id for question in questions})
    if (missing_detected_ids or stats.sequential_gaps) and not args.allow_audit_gaps:
        raise SystemExit(
            "Refusing to write incomplete questions.json because the extraction audit found gaps. "
            f"Missing IDs: {missing_detected_ids}. Missing L.p. indices: {stats.sequential_gaps}. "
            "Re-run with --allow-audit-gaps only for manual debugging."
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
