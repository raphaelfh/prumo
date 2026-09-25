import re

import pytest

from app.services.template_field_naming import derive_field_name

_FIELD_NAME = re.compile(r"^[a-z][a-z0-9_]*$")


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("Número de pacientes", "numero_de_pacientes"),  # accents stripped (NFD)
        ("Ação", "acao"),
        ("  Age (years)  ", "age_years"),  # trim + collapse
        ("1st author", "field_1st_author"),  # digit-leading
        ("", "field"),
        ("!!!", "field"),
        ("a", "a_field"),  # 1 char padded to >= 2
        ("x" * 60, "x" * 46),  # cut to 46
        ("a" * 45 + " b", "a" * 45),  # cut, then trailing "_" stripped
    ],
)
def test_derive_matches_the_ui_slug(label: str, expected: str) -> None:
    assert derive_field_name(label, set()) == expected
    assert _FIELD_NAME.match(expected) and 2 <= len(expected) <= 50


def test_collision_suffixes_past_every_taken_name() -> None:
    assert derive_field_name("Age", {"age"}) == "age_2"
    assert derive_field_name("Age", {"age", "age_2"}) == "age_3"
    assert len(derive_field_name("x" * 60, {"x" * 46})) <= 50
