from app.llm.value_support import is_numeric_like, numeric_value_supported


def test_percent_forms_match():
    assert numeric_value_supported("12.5%", "reduced HbA1c by 12.5 percent at week 12")
    assert numeric_value_supported("0.125", "a fraction of 12.5%")
    assert not numeric_value_supported("13.0%", "reduced by 12.5%")


def test_is_numeric_like():
    assert is_numeric_like("12.5%")
    assert not is_numeric_like("metformin")


def test_thousands_separator_integer_matches():
    # Reported bug: a US thousands-grouped source number ("24,077") must
    # support an integer value 24077 (both directions).
    assert numeric_value_supported(
        "24077",
        "We identify a total of 24,077 cancer patients eligible for the study",
    )
    assert numeric_value_supported("24,077", "the cohort had 24077 patients")


def test_grouping_plus_decimal_matches():
    # Mixed grouping + decimal: comma groups, dot is the decimal point.
    assert numeric_value_supported("1,234.5", "a mean of 1234.5 person-years")
    assert numeric_value_supported("1234.5", "reported as 1,234.5 overall")


def test_percent_fraction_still_matches():
    # The %<->fraction path must keep working after the grouping change.
    assert numeric_value_supported("0.125", "a fraction of 12.5%")


def test_real_decimal_not_confused_with_grouping():
    # "11.8" is a genuine decimal; it must NOT spuriously match 118.
    assert numeric_value_supported("11.8", "increased by 11.8 points")
    assert not numeric_value_supported("11.8", "a total of 118 events")


def test_comma_decimal_not_misread_as_grouping():
    # Locale comma-decimal ("11,8" == 11.8) must read as a decimal, not 118.
    assert numeric_value_supported("11,8", "increased by 11.8 points")
    assert not numeric_value_supported("11,8", "a total of 118 events")
