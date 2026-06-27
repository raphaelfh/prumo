from app.llm.value_support import is_numeric_like, numeric_value_supported


def test_percent_forms_match():
    assert numeric_value_supported("12.5%", "reduced HbA1c by 12.5 percent at week 12")
    assert numeric_value_supported("0.125", "a fraction of 12.5%")
    assert not numeric_value_supported("13.0%", "reduced by 12.5%")


def test_is_numeric_like():
    assert is_numeric_like("12.5%")
    assert not is_numeric_like("metformin")
