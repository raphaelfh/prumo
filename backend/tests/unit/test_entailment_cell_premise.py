from types import SimpleNamespace

from app.llm.entailment import GateSpec, _build_premise


def _block(page, idx, text, bt, cs, ce):
    return SimpleNamespace(
        page_number=page,
        block_index=idx,
        text=text,
        block_type=bt,
        char_start=cs,
        char_end=ce,
    )


def _pos(page, cs, ce):
    rng = SimpleNamespace(page=page, char_start=cs, char_end=ce)
    return SimpleNamespace(anchor=SimpleNamespace(range=rng))


def test_table_cell_premise_is_cell_only():
    # neighbouring cells must NOT leak into the premise for a table_cell citation
    blocks = [
        _block(1, 0, "11.8", "table_cell", 0, 4),
        _block(1, 1, "999", "table_cell", 5, 8),
    ]
    spec = GateSpec(
        field_label="EPV", value_str="11.8", quote="11.8", pos=_pos(1, 0, 4), anchor_blocks=blocks
    )
    assert _build_premise(spec) == "11.8"


def test_prose_premise_keeps_neighbours():
    blocks = [
        _block(1, 0, "Intro.", "paragraph", 0, 6),
        _block(1, 1, "The EPV was 4.6.", "paragraph", 7, 23),
        _block(1, 2, "Outro.", "paragraph", 24, 30),
    ]
    spec = GateSpec(
        field_label="EPV",
        value_str="4.6",
        quote="The EPV was 4.6.",
        pos=_pos(1, 7, 23),
        anchor_blocks=blocks,
    )
    premise = _build_premise(spec)
    assert "Intro." in premise and "Outro." in premise  # prose keeps the window
