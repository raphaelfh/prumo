"""Field ``name`` derivation for agent-created questions — a port of the UI's
``uniqueFieldKey`` (frontend/lib/extraction/slug.ts), so both writers name
fields identically. Output satisfies ``FieldName`` (``^[a-z][a-z0-9_]*$``, 2-50)."""

import re
import unicodedata
from collections.abc import Collection

_FIELD_KEY_BASE_MAX = 46  # room for a "_99" suffix inside the 50-char cap
_COMBINING = re.compile(r"[̀-ͯ]")  # the same range slug.ts strips


def _snake_case(label: str) -> str:
    text = _COMBINING.sub("", unicodedata.normalize("NFD", label.lower()))
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return re.sub(r"_+", "_", text)


def derive_field_name(label: str, taken: Collection[str]) -> str:
    base = _snake_case(label)
    if not re.match(r"^[a-z]", base):
        base = f"field_{base}" if base else "field"
    if len(base) < 2:
        base = f"{base}_field"
    base = base[:_FIELD_KEY_BASE_MAX].rstrip("_")
    if base not in taken:
        return base
    n = 2
    while f"{base}_{n}" in taken:
        n += 1
    return f"{base}_{n}"
