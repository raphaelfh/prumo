from app.services.exports.extraction.sheet_spec import RESERVED_TITLES, safe_sheet_title


def test_reserved_titles_are_the_spec_list() -> None:
    assert RESERVED_TITLES == (
        "README",
        "Summary",
        "Matrix",
        "Articles",
        "Data",
        "Verification",
        "AI proposals",
        "Appraisal",
        "Codebook",
        "Options",
        "History",
    )


def test_collision_is_case_insensitive_and_suffixed() -> None:
    assert safe_sheet_title("history", RESERVED_TITLES, fallback="T") == "history (2)"
    assert safe_sheet_title("Data", RESERVED_TITLES, fallback="T") == "Data (2)"
    assert safe_sheet_title("data", [*RESERVED_TITLES, "data (2)"], fallback="T") == "data (3)"


def test_forbidden_chars_stripped_and_length_capped() -> None:
    assert safe_sheet_title("Risk: [bias]/*?", (), fallback="T") == "Risk bias"
    long = "x" * 40
    assert safe_sheet_title(long, (), fallback="T") == "x" * 31
    assert safe_sheet_title(long, ("x" * 31,), fallback="T") == "x" * 27 + " (2)"


def test_safe_sheet_title_falls_back_and_strips_apostrophes() -> None:
    assert safe_sheet_title("[]:*?", (), fallback="Table 3") == "Table 3"
    assert safe_sheet_title("'Bias'", (), fallback="T") == "Bias"
    assert safe_sheet_title("a\x0cb", (), fallback="T") == "ab"
    assert safe_sheet_title("a" * 30 + "'b", (), fallback="T") == "a" * 30


def test_deterministic() -> None:
    taken = ("README", "Sec")
    assert (
        safe_sheet_title("Sec", taken, fallback="T")
        == safe_sheet_title("Sec", taken, fallback="T")
        == "Sec (2)"
    )
