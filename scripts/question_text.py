# PilotReady
# Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
#
# NOTE: licensing stub - to be reviewed/refined later.

"""Text clean-up for questions extracted from the PPL(A) PDF.

The source bank was exported from a web system into a spreadsheet and then to
PDF, and it carries the scars of every hop:

* HTML entities and tags printed literally (``&alpha;``, ``&lt; sup &gt;``),
* CSV-style doubled quotes (``""N""``),
* characters the export could not encode, replaced by ``?`` (``m/s?``, ``?C``),
* compound words split by the table's line wrapping (``lotniczo- lekarskie``),
* stray spaces around punctuation (``14 dni .``) and doubled punctuation.

Everything here is a pure function with no PDF dependency so it can be unit
tested and reused by the validator. The only markup that survives clean-up is
``<sub>…</sub>`` / ``<sup>…</sup>``, which the frontend renders safely.
"""

from __future__ import annotations

import html
import re
from typing import Sequence

LETTERS = "A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż"

# --------------------------------------------------------------------------- #
# Curated fixes for typos that exist in the source itself
# --------------------------------------------------------------------------- #
# Applied after the generic rules, as plain substring replacements. Keep this
# list short and obvious: only fragments that are never valid Polish, so a
# replacement cannot change the meaning of a question.
SOURCE_TYPO_FIXES: tuple[tuple[str, str], ...] = (
    ("wysokościomi erz", "wysokościomierz"),
    ("prędkoś cią", "prędkością"),
    ("zezwolenia w łaściwego", "zezwolenia właściwego"),
    ("tlenuw tkankach", "tlenu w tkankach"),
    ("/10 0m", "/100 m"),
    ("ośi O", "osi O"),
    ("RAamp;", "RA"),
)

_TAG_RE = re.compile(r"<\s*(/?)\s*(sub|sup)\s*>", re.IGNORECASE)
_TAG_BODY_RE = re.compile(r"<(sub|sup)>\s*(.*?)\s*</\1>")
_DEGREE_SUP_RE = re.compile(r"<sup>[°oO?º]</sup>")

# Units whose exponent was lost in the export and replaced by "?".
_LOST_EXPONENTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"m/s\?"), "m/s²"),
    (re.compile(r"kg/m\?"), "kg/m³"),
    (re.compile(r"N/m\?"), "N/m²"),
    (re.compile(r"(?<=\d )(c?m)\?(?=\s)"), r"\1³"),
)


def decode_markup(text: str) -> str:
    """Decode HTML entities and normalize the few tags the source uses."""

    text = html.unescape(text)
    text = _TAG_RE.sub(lambda match: f"<{match.group(1)}{match.group(2).lower()}>", text)
    text = _TAG_BODY_RE.sub(lambda match: f"<{match.group(1)}>{match.group(2)}</{match.group(1)}>", text)
    # "V <sub>NE</sub>" -> "V<sub>NE</sub>": an index belongs to its symbol.
    text = re.sub(rf"(?<=[{LETTERS}0-9]) +(?=<su[bp]>)", "", text)
    return text


def repair_lost_characters(text: str) -> str:
    """Restore characters the export degraded: degree signs and exponents."""

    text = _DEGREE_SUP_RE.sub("°", text)
    text = re.sub(r"(?<![{0}0-9])\?C\b".format(LETTERS), "°C", text)
    text = re.sub(r"°\s+C\b", "°C", text)
    for pattern, replacement in _LOST_EXPONENTS:
        text = pattern.sub(replacement, text)
    return text


def tidy_punctuation(text: str) -> str:
    """Fix spacing and doubling around punctuation without touching content."""

    # CSV-escaped quotes: ""N"" -> "N".
    text = text.replace('""', '"')

    # "( z rosyjska" -> "(z rosyjska", "tekst )" -> "tekst)".
    text = re.sub(r"\(\s+(?=\S)", "(", text)
    text = re.sub(r"(?<=\S)\s+\)", ")", text)

    # "14 dni ." -> "14 dni.", "lotem :" -> "lotem:". A colon followed by a
    # number is a scale or a division ("1 : 500 000", "(m × 3) : 10") and keeps
    # its spacing, and so do "..." blanks to fill in.
    text = re.sub(r" : (?=\d)", "\u0000", text)
    text = re.sub(rf"(?<=[{LETTERS}0-9\)\"”’%°>]) +([,.;:?!])(?=\s|$|[\)\"”])", r"\1", text)
    text = text.replace("\u0000", " : ")

    # "fałszywe,a tłusty" -> "fałszywe, a tłusty" (letters only, so decimals
    # like "1013,25" are never touched).
    text = re.sub(rf"(?<=[{LETTERS}]{{2}}),(?=[{LETTERS}]{{1}})", ", ", text)

    # Doubled / contradictory sentence endings.
    text = re.sub(r",\.", ".", text)
    text = re.sub(r"(?<!\.)\.\.(?!\.)", ".", text)
    text = re.sub(r"([:?])\s*\.$", r"\1", text)
    return text


def normalize_text(value: object) -> str:
    """Return clean, display-ready text for a question or an answer."""

    if value is None:
        return ""
    text = str(value).replace(" ", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = decode_markup(text)
    text = repair_lost_characters(text)
    text = tidy_punctuation(text)
    for wrong, right in SOURCE_TYPO_FIXES:
        text = text.replace(wrong, right)
    return re.sub(r"\s+", " ", text).strip()


# --------------------------------------------------------------------------- #
# Joining the visual lines of one table cell
# --------------------------------------------------------------------------- #
_COMPOUND_STEM_RE = re.compile(rf"^[{LETTERS}]{{3,}}o$")
_ACRONYM_RE = re.compile(r"^[A-Z]{2,}$")
_CASE_ENDING_RE = re.compile(r"^[a-ząęóy]{1,3}[.,;:?!]?$")
_LETTER_CHAIN_RE = re.compile(r"^[a-z](?:-[a-z])*$")


def _joins_without_space(stem: str, following: str) -> bool:
    """Decide whether ``stem-`` + line break + ``following`` is one word."""

    if not following:
        return False
    # Polish compound adjectives: "lotniczo-" + "lekarskie", "giętno-" + "skrętne".
    if _COMPOUND_STEM_RE.match(stem) and following[0].islower() and following[0].isalpha():
        return True
    # Declined acronyms: "VOR-" + "a".
    if _ACRONYM_RE.match(stem) and _CASE_ENDING_RE.match(following):
        return True
    # Axis lists: "x-y-" + "z."
    if _LETTER_CHAIN_RE.match(stem) and re.match(r"^[a-z]\W*$", following):
        return True
    return False


def join_cell_lines(lines: Sequence[str]) -> str:
    """Join the wrapped lines of a cell into one string.

    Lines are normally joined with a space. When a line ends in a hyphen that
    is part of a compound word, the wrap is undone instead, so
    ``["badania lotniczo-", "lekarskie"]`` becomes ``"badania lotniczo-lekarskie"``
    rather than ``"badania lotniczo- lekarskie"``. A hyphen used as a dash
    (``"masa ciała-"`` / ``"jednostka"``) keeps its space.
    """

    result = ""
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if not result:
            result = line
            continue
        last_word = result.rsplit(" ", 1)[-1]
        first_word = line.split(" ", 1)[0]
        if len(last_word) > 1 and last_word.endswith("-") and _joins_without_space(last_word[:-1].lstrip("(„\"'"), first_word):
            result += line
        else:
            result += " " + line
    return result
