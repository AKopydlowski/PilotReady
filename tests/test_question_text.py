# PilotReady
# Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Unit tests for the question text clean-up. Every case is a real string
from the PPL(A) source bank."""

from __future__ import annotations

import pytest

from question_text import join_cell_lines, normalize_text


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # HTML entities printed literally by the export.
        ("Kiedy kąt natarcia śmigła &alpha;=0° ?", "Kiedy kąt natarcia śmigła α=0°?"),
        ("&rho;o = 1,2255 kg/m?.", "ρo = 1,2255 kg/m³."),
        ("Współczynnik M&amp;S", "Współczynnik M&S"),
        ("dla &alpha;&lt;0 przesuwa się", "dla α<0 przesuwa się"),
        # Escaped tags with stray spaces collapse to clean sub/sup markup.
        ("V &lt; sub &gt; NE &lt; /sub &gt;", "V<sub>NE</sub>"),
        ("V &lt;sub &gt; RAamp; &lt; /sub &gt;", "V<sub>RA</sub>"),
        ("zwiększanie ‘C<sub>x</sub>’", "zwiększanie ‘C<sub>x</sub>’"),
        # Degree signs in every broken form the source uses.
        ("t = +15 &lt; sup &gt; o&lt; /sup &gt; C", "t = +15°C"),
        ("Celsiusza (&lt; sup&gt;?&lt; / sup&gt; C) i temperatury", "Celsiusza (°C) i temperatury"),
        ("Ochładza się o 1<sup>°</sup> C/100 m", "Ochładza się o 1°C/100 m"),
        ("temp. otoczenia ( ?C).", "temp. otoczenia (°C)."),
        # Exponents replaced by "?".
        ("g = 9,81 m/s? zaś R", "g = 9,81 m/s² zaś R"),
        ("po = 101325 N/m? = 1013,25 hPa", "po = 101325 N/m² = 1013,25 hPa"),
        ("Ciężar 1 m? powietrza.", "Ciężar 1 m³ powietrza."),
        # CSV-escaped quotes.
        ('literą ""N""?', 'literą "N"?'),
        # Spacing before punctuation.
        ("14 dni .", "14 dni."),
        ("Choroba powietrzna :", "Choroba powietrzna:"),
        ("w niekontrolowanym ?", "w niekontrolowanym?"),
        ("prawa państwa , w którym", "prawa państwa, w którym"),
        ("- stałej ; - obojętnej; - chwiejnej", "- stałej; - obojętnej; - chwiejnej"),
        ("Panel ( z rosyjska SPU).", "Panel (z rosyjska SPU)."),
        ("jest fałszywe,a tłusty posiłek", "jest fałszywe, a tłusty posiłek"),
        # Doubled sentence endings.
        ("poziom lotu..", "poziom lotu."),
        ("danym lotniskiem,.", "danym lotniskiem."),
        ("Co to jest V<sub>X</sub>:.", "Co to jest V<sub>X</sub>:"),
        # Curated source typos.
        ("Do pracy radiowysokościomi erza wykorzystano :", "Do pracy radiowysokościomierza wykorzystano:"),
        ("mniejszy od 0,2<sup>°</sup>C/10 0m", "mniejszy od 0,2°C/100 m"),
        ("ośi OZ› i ośi OY›", "osi OZ› i osi OY›"),
    ],
)
def test_normalize_text_repairs_source_defects(raw: str, expected: str) -> None:
    assert normalize_text(raw) == expected


@pytest.mark.parametrize(
    "text",
    [
        "W skali 1 : 500 000",
        "(m × 3) : 10",
        "System GPS działa w paśmie ... na zasadzie ... .",
        "Ciśnienie 1013,25 hPa",
        "15°C / 29.92 in.Hg / 1013 kg/m3 / 1.98°C na 1000 ft.",
        "Czy może przyjmować wartość zerową? Jeżeli tak, to kiedy?",
        "Tak- szczególnie w górach",
        "0<n<1",
    ],
)
def test_normalize_text_leaves_valid_text_alone(text: str) -> None:
    assert normalize_text(text) == text


def test_normalize_text_is_idempotent() -> None:
    raw = 'V &lt; sub &gt; NE &lt; /sub &gt; wynosi 9,81 m/s? , czyli ""dużo"" .'
    once = normalize_text(raw)
    assert normalize_text(once) == once


def test_normalize_text_handles_empty_values() -> None:
    assert normalize_text(None) == ""
    assert normalize_text("    ") == ""


@pytest.mark.parametrize(
    ("lines", "expected"),
    [
        # Compound adjectives split by the cell wrap are glued back together.
        (["Kto podlega badaniom lotniczo-", "lekarskim?"], "Kto podlega badaniom lotniczo-lekarskim?"),
        (["układu sercowo-", "naczyniowego"], "układu sercowo-naczyniowego"),
        (["połączenie skrzydło-", "kadłub"], "połączenie skrzydło-kadłub"),
        (["radial VOR-", "a wynosi"], "radial VOR-a wynosi"),
        (["osi współrzędnych x-y-", "z. Jakie"], "osi współrzędnych x-y-z. Jakie"),
        # A hyphen used as a dash keeps its space.
        (["masa ciała-", "jednostka masy"], "masa ciała- jednostka masy"),
        (["kilo-", "(k)."], "kilo- (k)."),
        (["osi ciała mostek-", "kręgosłup"], "osi ciała mostek- kręgosłup"),
        # Ordinary wraps are joined with a single space.
        (["Dowódca statku", "powietrznego."], "Dowódca statku powietrznego."),
        (["", "  Tylko jedna linia  ", ""], "Tylko jedna linia"),
    ],
)
def test_join_cell_lines(lines: list[str], expected: str) -> None:
    assert join_cell_lines(lines) == expected
