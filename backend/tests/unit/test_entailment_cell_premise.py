from types import SimpleNamespace

from app.llm.entailment import GateSpec, _build_premise


def _block(page, idx, text, bt):
    return SimpleNamespace(page_number=page, block_index=idx, text=text, block_type=bt)


def _pos(page, block_ids):
    """A PositionV1-shaped anchor carrying the per-page block_index ids it matched."""
    rng = SimpleNamespace(page=page)
    return SimpleNamespace(anchor=SimpleNamespace(range=rng, block_ids=block_ids))


def test_table_cell_premise_is_cell_only():
    # neighbouring cells must NOT leak into the premise for a table_cell citation
    blocks = [
        _block(1, 0, "11.8", "table_cell"),
        _block(1, 1, "999", "table_cell"),
    ]
    spec = GateSpec(
        field_label="EPV",
        value_str="11.8",
        quote="11.8",
        pos=_pos(1, [0]),
        anchor_blocks=blocks,
    )
    assert _build_premise(spec) == "11.8"


def test_prose_premise_keeps_neighbours():
    blocks = [
        _block(1, 0, "Intro.", "paragraph"),
        _block(1, 1, "The EPV was 4.6.", "paragraph"),
        _block(1, 2, "Outro.", "paragraph"),
    ]
    spec = GateSpec(
        field_label="EPV",
        value_str="4.6",
        quote="The EPV was 4.6.",
        pos=_pos(1, [1]),
        anchor_blocks=blocks,
    )
    premise = _build_premise(spec)
    assert "Intro." in premise and "Outro." in premise  # prose keeps the window


def test_prose_premise_spans_two_blocks():
    # A quote whose char range spans TWO blocks: no single block fully contains
    # it, so the old single-containment scan found nothing and silently degraded
    # to the bare quote (dropping all neighbouring context, biasing the judge
    # toward weak/unsupported). Building the window from the anchor's block_ids
    # surfaces the cited blocks PLUS one neighbour on each side.
    blocks = [
        _block(1, 0, "Methods.", "paragraph"),
        _block(1, 1, "Patients received drug A", "paragraph"),
        _block(1, 2, "at 10 mg once daily.", "paragraph"),
        _block(1, 3, "Results follow.", "paragraph"),
    ]
    spec = GateSpec(
        field_label="Dose",
        value_str="10 mg once daily",
        quote="Patients received drug A at 10 mg once daily.",
        pos=_pos(1, [1, 2]),  # spans block_index 1 AND 2
        anchor_blocks=blocks,
    )
    premise = _build_premise(spec)
    # Both cited blocks present (the old scan returned only the bare quote)...
    assert "Patients received drug A" in premise
    assert "at 10 mg once daily." in premise
    # ...plus one neighbour block on each side — the context the judge needs.
    assert "Methods." in premise
    assert "Results follow." in premise


def test_premise_falls_back_to_quote_when_block_ids_empty():
    # No resolvable block_ids → degrade to the raw evidence quote.
    blocks = [_block(1, 0, "Some prose.", "paragraph")]
    spec = GateSpec(
        field_label="X",
        value_str="v",
        quote="verbatim quote",
        pos=_pos(1, []),
        anchor_blocks=blocks,
    )
    assert _build_premise(spec) == "verbatim quote"
