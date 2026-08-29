"""Drift guard for the frontend's ``prumo-template@1`` authoring guidance.

The import dialog ships two things users copy into an AI assistant: a worked
example file and a prose list of the format rules. Both are hand-written in
the frontend, and both restate constraints that live in
``app.schemas.template_portable``. Nothing imports them, so if the schema
tightens they rot SILENTLY — a user pastes the prompt, the assistant emits a
document the server then rejects.

Two assertions close that gap:

1. The example validates against ``PortableTemplate``. This is the real
   cross-language contract — if it stops importing, CI goes red instead of a
   user discovering it.
2. The prose rules still name every field type and every cap the schema
   enforces. Re-typed numbers are the drift surface that a byte-comparison
   between the prompt and the example cannot see (the prompt embeds the
   example via ``?raw``, so those two are identical by construction).

If the guidance moves out of ``frontend/lib/copy/templateConfig.ts``, update
``COPY_FILE``.
"""

from __future__ import annotations

from pathlib import Path
from typing import get_args

import pytest

from app.schemas.template_portable import (
    MAX_FIELDS_PER_SECTION,
    MAX_SECTIONS_PER_LEVEL,
    MAX_TOTAL_FIELDS,
    PortableTemplate,
)
from app.schemas.template_structure import FieldType

# ``__file__`` -> backend/tests/unit/test_template_portable_example_drift.py
# parents[0] = unit/, [1] = tests/, [2] = backend/, [3] = repo root
REPO_ROOT = Path(__file__).resolve().parents[3]
EXAMPLE_FILE = REPO_ROOT / "frontend" / "lib" / "templateImport" / "exampleTemplate.json"
COPY_FILE = REPO_ROOT / "frontend" / "lib" / "copy" / "templateConfig.ts"


def test_example_template_imports_against_the_real_schema() -> None:
    """The shipped example is a document the server would actually accept."""
    assert EXAMPLE_FILE.is_file(), f"missing authoring example: {EXAMPLE_FILE}"

    template = PortableTemplate.model_validate_json(EXAMPLE_FILE.read_text("utf-8"))

    # The example earns its place by teaching BOTH structural concepts; a
    # flat one-section file would validate while demonstrating nothing.
    assert any(s.group for s in template.sections), "example must show a repeating group"
    assert any(child for s in template.sections for child in s.sections), (
        "example must show a section nested inside the group"
    )


@pytest.mark.parametrize("field_type", get_args(FieldType))
def test_guidance_names_every_field_type(field_type: str) -> None:
    """A type the schema accepts but the guidance omits is invisible to users."""
    assert COPY_FILE.is_file(), f"missing guidance copy: {COPY_FILE}"
    assert field_type in COPY_FILE.read_text("utf-8"), (
        f"field type {field_type!r} is accepted by FieldType but never named in "
        f"{COPY_FILE.name} — the authoring guidance is incomplete."
    )


@pytest.mark.parametrize(
    "cap",
    [MAX_SECTIONS_PER_LEVEL, MAX_FIELDS_PER_SECTION, MAX_TOTAL_FIELDS],
)
def test_guidance_quotes_the_real_caps(cap: int) -> None:
    """The caps are re-typed prose; assert they still match the schema."""
    assert COPY_FILE.is_file(), f"missing guidance copy: {COPY_FILE}"
    assert str(cap) in COPY_FILE.read_text("utf-8"), (
        f"cap {cap} changed in template_portable.py but the authoring guidance "
        f"in {COPY_FILE.name} still quotes the old number."
    )
