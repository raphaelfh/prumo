---
status: draft
last_reviewed: 2026-06-28
owner: '@raphaelfh'
---

# Citation P3 — Table-Cell Citations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default `PymupdfParser` emit a per-cell table grid so table values get cell-addressed, entailment-verified citations that highlight the exact cited cell — extending the parser in place, no new dependency, no parser swap.

**Architecture:** `fitz.find_tables()` yields per-cell text + bbox + (row, col). `PymupdfParser` emits one `table_cell` `ParsedBlock` per cell carrying the native grid; `ArticleTextBlock` gains nullable `row_index/col_index/row_span/col_span/is_header` columns (Alembic). The single `render_blocks_to_markdown` serializer builds tables from the native grid (legacy heuristic fallback) so the stored `content_markdown` — which is what feeds both the LLM prompt and the reader — gets a correct GFM table. Each `table_cell` already renders as its own `<div data-block-id>` in the reader and `build_anchor` already produces a `HybridCitationAnchor` for non-prose blocks, so cell-level highlight works once cells exist; the entailment gate's premise is tightened to be cell-scoped. The Docling tier adapter is upgraded to lift its real row/col + spans (the source of merged-cell fidelity).

**Tech Stack:** Python 3.11, PyMuPDF (`fitz`, `find_tables`), SQLAlchemy 2.0 async, Alembic, pytest (unit + integration against local Supabase Postgres); frontend React 19 + Vitest (guard test only).

## Global Constraints

- **No new dependency.** Extend the in-place `PymupdfParser`; pymupdf4llm stays deferred (spec §4.7, 2026-06-28 amendment).
- **ADR-0013 single serializer.** Tables render through `render_blocks_to_markdown`; never adopt a parser's own `to_markdown()`. Prose char offsets stay byte-identical between prompt and reader.
- **bbox convention:** match the existing `PymupdfParser` exactly — raw fitz page coords (top-left origin), stored as `{x, y, width, height}`, **no y-flip** (frontend handles it). Do NOT introduce a flip in this plan.
- **Alembic:** app schema only; revision id **≤ 32 chars**; `schema="public"`; new columns **nullable** (legacy blocks pre-date them). Migration touches `article_text_blocks` (extraction-adjacent) ⇒ bump `last_reviewed` (and the migration reference if present) in `docs/reference/extraction-hitl-architecture.md`.
- **Layering:** `api → services → repositories → models`; repositories `flush()` never `commit()`; parser layer has no DB/IO/HTTP.
- **No API-contract change in P3.** The evidence wire (`EvidenceResponse`) is unchanged — the citation anchors to the cell block; the cell's `(row, col)` lives on the block (server-side, for grid rendering + verify). Do **not** run `generate:api-types` (nothing changes) and do not widen the text-blocks read DTO.
- **block_type vocabulary** stays the existing seven (`table_cell` already present); **no `figure` type in P3** (that is P4).
- **English only** for code, comments, copy.
- **One backend test:** `cd backend && make test-backend` (runs against local Supabase Postgres; autouse `SEED` fixture). One frontend test: `npm run test:run -- <path>` from repo root.

## Scope decisions (confirm before executing)

- **DEFERRED — HTML/cell-KV prompt table serialization (spec §4.5).** For the flat-grid default tier (`span=1`) HTML is expressively equivalent to correct-grid GFM; its only edge (merged/multi-row headers) needs Docling spans + the unbuilt §4.11 eval gate. Shipping an un-measured GFM→HTML swap on the common `content_markdown` prompt path carries the same risk class we deferred for pymupdf4llm. P3 delivers table comprehension via **correct native-grid GFM** (flows to prompt + reader through `content_markdown`); HTML/cell-KV joins the gated parser-quality cycle.
- **DEFERRED — surfacing `(row, col)` over the wire / in the popover.** No consumer needs it for P3 (highlight uses `blockIds`; verify reads the block server-side). YAGNI.
- **IN SCOPE:** native cell grid on blocks + migration; `PymupdfParser` table-cell emission; native-grid `_render_table` (+ legacy fallback); cell-scoped entailment premise; Docling row/col/span lift; FE cell-highlight **guard test**; an end-to-end integration test.

---

## File Structure

**Backend — modify:**
- `backend/app/infrastructure/parsing/base.py` — add cell-grid fields to `ParsedBlock` + `BlockLike`; native-grid `_render_table`.
- `backend/app/models/article.py` — add 5 nullable columns to `ArticleTextBlock`.
- `backend/app/repositories/article_text_block_repository.py` — map the 5 new fields on insert.
- `backend/app/infrastructure/parsing/pymupdf_parser.py` — emit `table_cell` blocks via `find_tables`, filter overlapping text blocks, interleave reading order.
- `backend/app/infrastructure/parsing/docling_parser.py` — lift real row/col + spans + header flags.
- `backend/app/llm/entailment.py` — cell-scoped premise in `_build_premise`.

**Backend — create:**
- `backend/alembic/versions/0036_text_block_cell_grid.py` — the migration.
- Unit tests under `backend/tests/unit/`; integration test under `backend/tests/integration/`.

**Docs — modify:**
- `docs/reference/extraction-hitl-architecture.md` — `last_reviewed` bump (+ migration ref if tracked).

**Frontend — create (test only):**
- `frontend/pdf-viewer/primitives/__tests__/tableCellLocate.test.tsx` — guard test that a `table_cell` citation flashes/highlights that cell's div.

---

## Task 1: Cell-grid fields on `ParsedBlock` + `BlockLike`

**Files:**
- Modify: `backend/app/infrastructure/parsing/base.py` (ParsedBlock dataclass ~70-98; BlockLike Protocol ~229-237)
- Test: `backend/tests/unit/test_parsed_block_cell_grid.py`

**Interfaces:**
- Produces: `ParsedBlock` gains optional `row_index: int | None`, `col_index: int | None`, `row_span: int | None`, `col_span: int | None`, `is_header: bool | None` (all default `None`). `BlockLike` Protocol gains the same attributes so `render_blocks_to_markdown` can read them.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_parsed_block_cell_grid.py
from app.infrastructure.parsing.base import ParsedBlock


def test_parsed_block_defaults_cell_grid_to_none():
    b = ParsedBlock(
        page_number=1, block_index=0, text="x", char_start=0, char_end=1,
        bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}, block_type="paragraph",
    )
    assert b.row_index is None and b.col_index is None
    assert b.row_span is None and b.col_span is None and b.is_header is None


def test_parsed_block_accepts_cell_grid():
    b = ParsedBlock(
        page_number=1, block_index=3, text="11.8", char_start=0, char_end=4,
        bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}, block_type="table_cell",
        row_index=1, col_index=2, row_span=1, col_span=1, is_header=False,
    )
    assert (b.row_index, b.col_index, b.row_span, b.col_span, b.is_header) == (1, 2, 1, 1, False)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_parsed_block_cell_grid.py -v`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'row_index'`.

- [ ] **Step 3: Add the fields to `ParsedBlock` and `BlockLike`**

In `ParsedBlock` (after `block_type: str`):

```python
    block_type: str
    # Native table-cell grid (None for non-table blocks / legacy parsers).
    row_index: int | None = None
    col_index: int | None = None
    row_span: int | None = None
    col_span: int | None = None
    is_header: bool | None = None
```

Extend the `BlockLike` Protocol (it currently lists `page_number`, `block_index`, `text`, `block_type`):

```python
@runtime_checkable
class BlockLike(Protocol):
    """Structural type satisfied by both ``ParsedBlock`` and ``ArticleTextBlock``."""

    page_number: int
    block_index: int
    text: str
    block_type: str
    # Optional native cell-grid metadata; absent/None on legacy blocks.
    row_index: int | None
    col_index: int | None
    row_span: int | None
    col_span: int | None
    is_header: bool | None
```

Update the `ParsedBlock` docstring `Attributes:` list to mention the cell-grid fields (one line each).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_parsed_block_cell_grid.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/infrastructure/parsing/base.py backend/tests/unit/test_parsed_block_cell_grid.py
git commit -m "feat(parsing): add native cell-grid fields to ParsedBlock + BlockLike"
```

---

## Task 2: `ArticleTextBlock` columns + Alembic migration

**Files:**
- Modify: `backend/app/models/article.py` (ArticleTextBlock ~258-311)
- Create: `backend/alembic/versions/0036_text_block_cell_grid.py`
- Modify: `docs/reference/extraction-hitl-architecture.md`
- Test: `backend/tests/integration/test_article_text_block_cell_grid.py`

**Interfaces:**
- Produces: `ArticleTextBlock` gains nullable columns `row_index`, `col_index`, `row_span`, `col_span` (Integer) and `is_header` (Boolean). Migration `0036_text_block_cell_grid` (down_revision `0035_evidence_rank`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_article_text_block_cell_grid.py
import pytest
from sqlalchemy import select

from app.models.article import ArticleFile, ArticleTextBlock
from tests.integration.conftest import SEED


@pytest.mark.asyncio
async def test_article_text_block_persists_cell_grid(db_session_real):
    af = ArticleFile(
        article_id=SEED.primary_article,
        storage_key="t/cellgrid.pdf",
        file_type="pdf",
        file_role="MAIN",
    )
    db_session_real.add(af)
    await db_session_real.flush()

    block = ArticleTextBlock(
        article_file_id=af.id, page_number=1, block_index=0, text="11.8",
        char_start=0, char_end=4,
        bbox={"x": 1.0, "y": 2.0, "width": 3.0, "height": 4.0},
        block_type="table_cell",
        row_index=1, col_index=2, row_span=1, col_span=1, is_header=False,
    )
    db_session_real.add(block)
    await db_session_real.flush()

    got = (
        await db_session_real.execute(
            select(ArticleTextBlock).where(ArticleTextBlock.id == block.id)
        )
    ).scalar_one()
    assert (got.row_index, got.col_index, got.row_span, got.col_span, got.is_header) == (
        1, 2, 1, 1, False,
    )
```

> Note: `ArticleFile` required columns are `article_id`, `file_type` (e.g. `"pdf"`), `storage_key`; `file_role` defaults to `MAIN` (uppercase enum). There is **no** `mime_type` column. Confirm against `backend/app/models/article.py` before running. `SEED.primary_article` is provided by the autouse `SEED` fixture in `tests/integration/conftest.py`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_article_text_block_cell_grid.py -v`
Expected: FAIL — attribute/column `row_index` does not exist (model has no such field / column).

- [ ] **Step 3: Add the columns to the model**

In `ArticleTextBlock`, after the `block_type` column:

```python
    # Native table-cell grid (NULL for non-table blocks and legacy parsers).
    row_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    col_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    row_span: Mapped[int | None] = mapped_column(Integer, nullable=True)
    col_span: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_header: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
```

Ensure `Boolean` is imported from `sqlalchemy` at the top of `article.py` (add to the existing `from sqlalchemy import ...` line if missing — land the import in the SAME edit as its first use to satisfy the ruff hook).

- [ ] **Step 4: Hand-write the migration (matches the 0035 template)**

```python
# backend/alembic/versions/0036_text_block_cell_grid.py
"""article_text_blocks native cell grid

Revision ID: 0036_text_block_cell_grid
Revises: 0035_evidence_rank
Create Date: 2026-06-28

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0036_text_block_cell_grid"
down_revision = "0035_evidence_rank"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "article_text_blocks",
        sa.Column("row_index", sa.Integer(), nullable=True),
        schema="public",
    )
    op.add_column(
        "article_text_blocks",
        sa.Column("col_index", sa.Integer(), nullable=True),
        schema="public",
    )
    op.add_column(
        "article_text_blocks",
        sa.Column("row_span", sa.Integer(), nullable=True),
        schema="public",
    )
    op.add_column(
        "article_text_blocks",
        sa.Column("col_span", sa.Integer(), nullable=True),
        schema="public",
    )
    op.add_column(
        "article_text_blocks",
        sa.Column("is_header", sa.Boolean(), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("article_text_blocks", "is_header", schema="public")
    op.drop_column("article_text_blocks", "col_span", schema="public")
    op.drop_column("article_text_blocks", "row_span", schema="public")
    op.drop_column("article_text_blocks", "col_index", schema="public")
    op.drop_column("article_text_blocks", "row_index", schema="public")
```

- [ ] **Step 5: Validate the migration offline both directions + revision-id length**

Run:
```bash
cd backend
python -c "print(len('0036_text_block_cell_grid') <= 32)"   # -> True
uv run alembic upgrade 0035_evidence_rank:0036_text_block_cell_grid --sql | grep -i "ADD COLUMN"
uv run alembic downgrade 0036_text_block_cell_grid:0035_evidence_rank --sql | grep -i "DROP COLUMN"
```
Expected: `True`, then five `ADD COLUMN` lines (row_index/col_index/row_span/col_span/is_header) and five `DROP COLUMN` lines, all on `public.article_text_blocks`.

- [ ] **Step 6: Apply to the local DB and run the integration test**

Run:
```bash
cd backend
uv run alembic upgrade head
uv run pytest tests/integration/test_article_text_block_cell_grid.py -v
```
Expected: `alembic upgrade head` succeeds; test PASSES.

> Local-DB hazard: the local Supabase Postgres is shared across worktrees. If `alembic upgrade head` errors because a sibling branch left a different head, do NOT `reset-db`; verify via the offline `--sql` from Step 5 and run the integration test only after the DB is at this branch's head. See memory `reference_backend_integration_tests_local`.

- [ ] **Step 7: Update the architecture doc**

In `docs/reference/extraction-hitl-architecture.md`: set `last_reviewed: 2026-06-28` in the frontmatter and the matching "Last reviewed" line in the blockquote, AND update the migration-head line (the doc carries `Migration head: 0035_evidence_rank`) to `0036_text_block_cell_grid` — it tracks the global alembic head regardless of which table the migration touches. Locate with `grep -n "Migration head\|last_reviewed\|0035" docs/reference/extraction-hitl-architecture.md`.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/article.py backend/alembic/versions/0036_text_block_cell_grid.py \
        backend/tests/integration/test_article_text_block_cell_grid.py \
        docs/reference/extraction-hitl-architecture.md
git commit -m "feat(parsing): article_text_blocks native cell-grid columns + migration 0036"
```

---

## Task 3: Repository persists the cell-grid fields

**Files:**
- Modify: `backend/app/repositories/article_text_block_repository.py` (`replace_for_file`, the ORM-build list ~65-77)
- Test: `backend/tests/integration/test_article_text_block_repository_cell_grid.py`

**Interfaces:**
- Consumes: `ParsedBlock.row_index/col_index/row_span/col_span/is_header` (Task 1).
- Produces: `replace_for_file` writes those five fields onto each `ArticleTextBlock`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_article_text_block_repository_cell_grid.py
import pytest

from app.infrastructure.parsing.base import ParsedBlock
from app.models.article import ArticleFile
from app.repositories.article_text_block_repository import ArticleTextBlockRepository
from tests.integration.conftest import SEED


@pytest.mark.asyncio
async def test_replace_for_file_persists_cell_grid(db_session_real):
    af = ArticleFile(
        article_id=SEED.primary_article, storage_key="t/repo-cellgrid.pdf",
        file_type="pdf", file_role="MAIN",
    )
    db_session_real.add(af)
    await db_session_real.flush()

    blocks = [
        ParsedBlock(
            page_number=1, block_index=0, text="Header", char_start=0, char_end=6,
            bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}, block_type="table_cell",
            row_index=0, col_index=0, row_span=1, col_span=1, is_header=True,
        ),
        ParsedBlock(
            page_number=1, block_index=1, text="11.8", char_start=7, char_end=11,
            bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}, block_type="table_cell",
            row_index=1, col_index=0, row_span=1, col_span=1, is_header=False,
        ),
    ]
    repo = ArticleTextBlockRepository(db_session_real)
    rows = await repo.replace_for_file(af.id, blocks)

    by_idx = {r.block_index: r for r in rows}
    assert by_idx[0].is_header is True and by_idx[0].row_index == 0
    assert by_idx[1].is_header is False and by_idx[1].row_index == 1 and by_idx[1].col_index == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_article_text_block_repository_cell_grid.py -v`
Expected: FAIL — persisted rows have `row_index is None` / `is_header is None` (repo doesn't map them yet).

- [ ] **Step 3: Map the fields in `replace_for_file`**

In the `orm_rows = [ ArticleTextBlock( ... ) for block in blocks ]` comprehension, add the five fields after `block_type=...`:

```python
                block_type=normalize_block_type(block.block_type),
                row_index=block.row_index,
                col_index=block.col_index,
                row_span=block.row_span,
                col_span=block.col_span,
                is_header=block.is_header,
            )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/integration/test_article_text_block_repository_cell_grid.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/repositories/article_text_block_repository.py \
        backend/tests/integration/test_article_text_block_repository_cell_grid.py
git commit -m "feat(parsing): persist native cell-grid fields in ArticleTextBlockRepository"
```

---

## Task 4: `PymupdfParser` emits `table_cell` blocks via `find_tables`

**Files:**
- Modify: `backend/app/infrastructure/parsing/pymupdf_parser.py`
- Test: `backend/tests/unit/test_pymupdf_parser_tables.py`

**Interfaces:**
- Consumes: `ParsedBlock` cell-grid fields (Task 1).
- Produces:
  - pure helper `build_table_cell_blocks(*, rows: list[list[tuple[str, dict[str, float]]]], header_rows: int, page_number: int, start_index: int) -> list[ParsedBlock]` — row-major cells `(text, bbox)`; skips empty-text cells but they still consume a `(row, col)` slot; sets `row_span=col_span=1`, `is_header = row < header_rows`, `block_type="table_cell"`, `block_index` running from `start_index`.
  - `PymupdfParser.parse` now interleaves text blocks (paragraph/heading) and table cells in reading order, dropping text blocks that fall inside a detected table's bbox.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/test_pymupdf_parser_tables.py
import fitz  # PyMuPDF
import pytest

from app.infrastructure.parsing.pymupdf_parser import (
    PymupdfParser,
    build_table_cell_blocks,
)


def test_build_table_cell_blocks_assigns_grid_and_headers():
    bbox = {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
    rows = [
        [("EPV", bbox), ("Value", bbox)],
        [("ratio", bbox), ("11.8", bbox)],
    ]
    blocks = build_table_cell_blocks(rows=rows, header_rows=1, page_number=2, start_index=5)

    assert [b.block_index for b in blocks] == [5, 6, 7, 8]
    assert all(b.block_type == "table_cell" and b.page_number == 2 for b in blocks)
    header = [b for b in blocks if b.is_header]
    body = [b for b in blocks if not b.is_header]
    assert {(b.text, b.col_index) for b in header} == {("EPV", 0), ("Value", 1)}
    assert {(b.text, b.row_index, b.col_index) for b in body} == {
        ("ratio", 1, 0), ("11.8", 1, 1),
    }
    assert all(b.row_span == 1 and b.col_span == 1 for b in blocks)


def test_build_table_cell_blocks_skips_empty_text_but_keeps_coords():
    bbox = {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
    rows = [[("a", bbox), ("", bbox)], [("", bbox), ("d", bbox)]]
    blocks = build_table_cell_blocks(rows=rows, header_rows=0, page_number=1, start_index=0)
    assert {(b.text, b.row_index, b.col_index) for b in blocks} == {
        ("a", 0, 0), ("d", 1, 1),
    }


def _ruled_table_pdf() -> bytes:
    """A one-page PDF with a 2x2 ruled table find_tables can detect."""
    doc = fitz.open()
    page = doc.new_page(width=300, height=200)
    # outer + inner grid lines (lines strategy needs ruling)
    xs, ys = [40, 160, 280], [40, 90, 140]
    for x in xs:
        page.draw_line((x, ys[0]), (x, ys[-1]))
    for y in ys:
        page.draw_line((xs[0], y), (xs[-1], y))
    page.insert_text((50, 70), "EPV")
    page.insert_text((170, 70), "Value")
    page.insert_text((50, 120), "ratio")
    page.insert_text((170, 120), "11.8")
    out = doc.tobytes()
    doc.close()
    return out


def _plain_text_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=300, height=200)
    page.insert_text((50, 50), "Just a paragraph of body text, no table here.")
    out = doc.tobytes()
    doc.close()
    return out


def test_parse_emits_table_cells_with_grid():
    pdf = _ruled_table_pdf()
    # Prove the fixture is table-detectable first, so a find_tables miss fails
    # loudly here instead of as a confusing empty-set assertion below.
    probe = fitz.open(stream=pdf, filetype="pdf")
    assert list(probe[0].find_tables().tables), "fixture must contain a detectable table"
    probe.close()

    blocks = PymupdfParser().parse(pdf)
    cells = [b for b in blocks if b.block_type == "table_cell"]
    texts = {b.text for b in cells}
    assert {"EPV", "Value", "ratio", "11.8"} <= texts
    # the "11.8" cell carries a concrete (row, col)
    v = next(b for b in cells if b.text == "11.8")
    assert v.row_index is not None and v.col_index is not None
    # char offsets stay consistent with concat_page_text for the cell
    from app.infrastructure.parsing.base import concat_page_text

    page_text = concat_page_text(blocks)[v.page_number]
    assert page_text[v.char_start:v.char_end] == "11.8"
    # no duplicate paragraph block re-emits a table value
    paras = [b for b in blocks if b.block_type != "table_cell"]
    assert all("11.8" not in (p.text or "") for p in paras)


def test_parse_tolerates_find_tables_failure(monkeypatch):
    """A find_tables crash never aborts the parse (text blocks still returned)."""

    def _boom(self, *a, **k):
        raise RuntimeError("find_tables blew up")

    monkeypatch.setattr(fitz.Page, "find_tables", _boom, raising=True)
    blocks = PymupdfParser().parse(_plain_text_pdf())
    assert any(b.block_type in ("paragraph", "heading") for b in blocks)
    assert all(b.block_type != "table_cell" for b in blocks)


def test_parse_skips_table_when_conversion_fails(monkeypatch):
    """A table that fails row conversion is skipped; the parse still succeeds."""
    import app.infrastructure.parsing.pymupdf_parser as mod

    def _boom(table):
        raise ValueError("bad table")

    monkeypatch.setattr(mod, "_table_to_rows", _boom, raising=True)
    blocks = PymupdfParser().parse(_ruled_table_pdf())
    # conversion failed -> no cells, table text NOT dropped (degrades to prose)
    assert all(b.block_type != "table_cell" for b in blocks)
    assert blocks  # parse still produced blocks


def test_table_to_rows_uses_table_bbox_when_cell_rect_missing():
    """A None cell rect falls back to the table-level bbox (no crash)."""
    from app.infrastructure.parsing.pymupdf_parser import _table_to_rows

    class _Row:
        def __init__(self, cells):
            self.cells = cells

    class _Table:
        bbox = (40.0, 40.0, 280.0, 140.0)
        header = None
        rows = [_Row([(40, 40, 160, 90), None])]

        def extract(self):
            return [["A", "B"]]

    rows, _header_rows = _table_to_rows(_Table())
    assert len(rows) == 1 and len(rows[0]) == 2
    # second cell (None rect) uses the table bbox
    assert rows[0][1][1] == {"x": 40.0, "y": 40.0, "width": 240.0, "height": 100.0}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_pymupdf_parser_tables.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_table_cell_blocks'` (and the parse test would fail: no `table_cell` blocks today).

- [ ] **Step 3: Implement the helper + table-aware parse**

Add the pure helper and rewrite `parse` in `pymupdf_parser.py`. Add `from app.infrastructure.parsing.base import ParsedBlock, assign_char_offsets_to_blocks, normalize_block_type` (already imported) and keep `import fitz`.

```python
def _bbox_from_rect(rect: tuple[float, float, float, float]) -> dict[str, float]:
    x0, y0, x1, y1 = rect
    return {"x": float(x0), "y": float(y0), "width": float(x1 - x0), "height": float(y1 - y0)}


def build_table_cell_blocks(
    *,
    rows: list[list[tuple[str, dict[str, float]]]],
    header_rows: int,
    page_number: int,
    start_index: int,
) -> list[ParsedBlock]:
    """Build contiguous ``table_cell`` ParsedBlocks (row-major) from a grid.

    Each cell is ``(text, bbox)``. Empty-text cells are skipped but still
    consume their ``(row, col)`` slot so coordinates stay faithful. fitz emits
    a flat grid, so ``row_span`` / ``col_span`` are always 1 (real spans come
    from the Docling tier). ``is_header`` is True for the first *header_rows*
    rows. ``char_start`` / ``char_end`` are placeholders (0) — the caller runs
    ``assign_char_offsets_to_blocks`` once over the full page.
    """
    blocks: list[ParsedBlock] = []
    idx = start_index
    for r, row in enumerate(rows):
        for c, (text, bbox) in enumerate(row):
            clean = (text or "").strip()
            if not clean:
                continue
            blocks.append(
                ParsedBlock(
                    page_number=page_number,
                    block_index=idx,
                    text=clean,
                    char_start=0,
                    char_end=0,
                    bbox=bbox,
                    block_type=normalize_block_type("table_cell"),
                    row_index=r,
                    col_index=c,
                    row_span=1,
                    col_span=1,
                    is_header=r < header_rows,
                )
            )
            idx += 1
    return blocks


def _rect_overlaps(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    """True if rects ``a`` and ``b`` overlap (fitz coords, x0<x1, y0<y1)."""
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    return not (ax1 <= bx0 or bx1 <= ax0 or ay1 <= by0 or by1 <= ay0)


def _table_to_rows(table) -> tuple[list[list[tuple[str, dict[str, float]]]], int]:
    """Convert a fitz Table to (row-major (text, bbox) grid, header_rows).

    Cell bboxes come from ``table.rows[r].cells`` (a tuple per column, or None
    for a gap); text from ``table.extract()``. When a cell rect is None the
    table-level bbox is used as a fallback so the block still has a box.
    """
    grid = table.extract()  # list[list[str | None]]
    table_bbox = _bbox_from_rect(tuple(table.bbox))
    rows: list[list[tuple[str, dict[str, float]]]] = []
    for r, trow in enumerate(table.rows):
        out_row: list[tuple[str, dict[str, float]]] = []
        cells = list(trow.cells)
        ncols = max(len(cells), len(grid[r]) if r < len(grid) else 0)
        for c in range(ncols):
            text = grid[r][c] if (r < len(grid) and c < len(grid[r])) else ""
            rect = cells[c] if (c < len(cells) and cells[c] is not None) else None
            bbox = _bbox_from_rect(tuple(rect)) if rect is not None else dict(table_bbox)
            out_row.append((text or "", bbox))
        rows.append(out_row)
    # fitz: header.external means the header is a separate row ABOVE table.rows;
    # otherwise the header is row 0 of table.rows. We only mark in-grid headers.
    header = getattr(table, "header", None)
    header_rows = 0 if (header is not None and getattr(header, "external", False)) else (1 if rows else 0)
    return rows, header_rows
```

Now rewrite `PymupdfParser.parse` to interleave text + tables and drop text inside table bboxes:

```python
class PymupdfParser(DocumentParser):
    """DocumentParser implementation backed by PyMuPDF (fitz)."""

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            # Pass 1: per page, defensively convert tables + collect text blocks
            # (dropping text that overlaps a SUCCESSFULLY converted table so the
            # cells own that text). Gather span sizes for the heading heuristic.
            per_page: dict[int, dict[str, Any]] = {}
            all_sizes: list[float] = []

            for page_index in range(doc.page_count):
                page = doc.load_page(page_index)
                page_number = page_index + 1

                try:
                    found = list(page.find_tables().tables)
                except Exception:  # find_tables is best-effort; never fail the parse
                    found = []
                # Convert each table defensively: a malformed table is skipped
                # (its text stays as paragraphs) rather than aborting the parse.
                converted: list[tuple[tuple[float, float, float, float], list[Any], int]] = []
                for table in found:
                    try:
                        rows, header_rows = _table_to_rows(table)
                    except Exception:
                        continue
                    if rows:
                        converted.append((tuple(table.bbox), rows, header_rows))
                table_rects = [rect for rect, _r, _h in converted]

                text_blocks: list[dict[str, Any]] = []
                for block in page.get_text("dict").get("blocks", []):
                    if block.get("type", 0) != 0:  # 0 = text block (images = P4)
                        continue
                    if not _block_text(block):
                        continue
                    if any(_rect_overlaps(tuple(block["bbox"]), tr) for tr in table_rects):
                        continue  # a converted table's cells carry this text
                    text_blocks.append(block)
                    s = _block_max_size(block)
                    if s > 0:
                        all_sizes.append(s)

                per_page[page_number] = {"text": text_blocks, "tables": converted}

            if not all_sizes and not any(p["tables"] for p in per_page.values()):
                raise ValueError("PymupdfParser produced no text blocks")

            median = sorted(all_sizes)[len(all_sizes) // 2] if all_sizes else 0.0

            # Pass 2: interleave text + tables per page in reading order (top-y,
            # then x) and assign a single monotonic block_index per page.
            blocks: list[ParsedBlock] = []
            for page_index in range(doc.page_count):
                page_number = page_index + 1
                data = per_page.get(page_number, {"text": [], "tables": []})

                entries: list[tuple[float, float, str, Any]] = []
                for block in data["text"]:
                    x0, y0, x1, y1 = block["bbox"]
                    entries.append((float(y0), float(x0), "text", block))
                for rect, rows, header_rows in data["tables"]:
                    tx0, ty0, tx1, ty1 = rect
                    entries.append((float(ty0), float(tx0), "table", (rows, header_rows)))
                entries.sort(key=lambda e: (e[0], e[1]))

                idx = 0
                for _y, _x, kind, payload in entries:
                    if kind == "text":
                        text = _block_text(payload)
                        x0, y0, x1, y1 = payload["bbox"]
                        size = _block_max_size(payload)
                        is_heading = (
                            median > 0
                            and size >= median * _HEADING_SIZE_RATIO
                            and len(text) <= _HEADING_MAX_CHARS
                        )
                        blocks.append(
                            ParsedBlock(
                                page_number=page_number,
                                block_index=idx,
                                text=text,
                                char_start=0,
                                char_end=0,
                                bbox={
                                    "x": float(x0), "y": float(y0),
                                    "width": float(x1 - x0), "height": float(y1 - y0),
                                },
                                block_type=normalize_block_type("heading" if is_heading else "paragraph"),
                            )
                        )
                        idx += 1
                    else:  # table
                        rows, header_rows = payload
                        cell_blocks = build_table_cell_blocks(
                            rows=rows, header_rows=header_rows,
                            page_number=page_number, start_index=idx,
                        )
                        blocks.extend(cell_blocks)
                        idx += len(cell_blocks)

            if not blocks:
                raise ValueError("PymupdfParser produced no text blocks")
            return assign_char_offsets_to_blocks(blocks)
        finally:
            doc.close()
```

> Keep `_block_text`, `_block_max_size`, `_HEADING_SIZE_RATIO`, `_HEADING_MAX_CHARS` as-is. Ensure `from typing import Any` is imported (already present). The per-table `try/except` means one malformed table never aborts the parse, and overlapping text is dropped ONLY for tables that converted (no data loss on table-conversion failure).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_pymupdf_parser_tables.py -v`
Expected: PASS (6 passed). If `test_parse_emits_table_cells_with_grid` fails at the fixture pre-assert, widen the ruling (the fixture must have clear grid lines). The `monkeypatch` tests cover the find_tables-raises and table-conversion-fails branches (diff-cover).

- [ ] **Step 5: Guard existing parser behavior**

Run: `cd backend && uv run pytest tests/unit -k pymupdf -v`
Expected: any pre-existing `PymupdfParser` unit tests still PASS (no table in their fixtures ⇒ unchanged output).

- [ ] **Step 6: Commit**

```bash
git add backend/app/infrastructure/parsing/pymupdf_parser.py \
        backend/tests/unit/test_pymupdf_parser_tables.py
git commit -m "feat(parsing): PymupdfParser emits native table_cell grid via find_tables"
```

---

## Task 5: `_render_table` builds from the native grid (legacy fallback)

**Files:**
- Modify: `backend/app/infrastructure/parsing/base.py` (`_render_table` ~254-272 and the coalescing in `render_blocks_to_markdown` ~293-304)
- Test: `backend/tests/unit/test_render_table_grid.py`

**Interfaces:**
- Consumes: `BlockLike` cell-grid attrs (Task 1).
- Produces: `render_blocks_to_markdown` coalesces a run of same-page `table_cell` blocks and renders via the native `(row, col)` grid when every cell carries it; else falls back to the legacy flat-text heuristic. Output stays GFM (reader + `content_markdown` + prompt).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_render_table_grid.py
from app.infrastructure.parsing.base import ParsedBlock, render_blocks_to_markdown


def _cell(idx, r, c, text):
    return ParsedBlock(
        page_number=1, block_index=idx, text=text, char_start=0, char_end=0,
        bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}, block_type="table_cell",
        row_index=r, col_index=c, row_span=1, col_span=1, is_header=(r == 0),
    )


def test_render_table_uses_native_grid():
    # 2 cols x 2 rows; emitted out of column order to prove grid placement wins.
    blocks = [
        _cell(0, 0, 1, "Value"),
        _cell(1, 0, 0, "Metric"),
        _cell(2, 1, 0, "EPV"),
        _cell(3, 1, 1, "11.8"),
    ]
    md = render_blocks_to_markdown(blocks)
    lines = [ln for ln in md.splitlines() if ln.strip()]
    assert lines[0] == "| Metric | Value |"
    assert set(lines[1].replace(" ", "")) <= set("|-")  # separator row
    assert lines[2] == "| EPV | 11.8 |"


def test_render_table_legacy_blocks_use_heuristic():
    # Legacy table_cell blocks (no row/col) still render via the old heuristic.
    legacy = [
        ParsedBlock(page_number=1, block_index=i, text=t, char_start=0, char_end=0,
                    bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
                    block_type="table_cell")
        for i, t in enumerate(["A", "B", "C", "D"])
    ]
    md = render_blocks_to_markdown(legacy)
    assert "|" in md and "A" in md and "D" in md  # produced a GFM table, no crash
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_render_table_grid.py -v`
Expected: FAIL on `test_render_table_uses_native_grid` — current `_render_table` infers columns from flat order, so cell placement ignores `(row, col)` (header line will not equal `| Metric | Value |`).

- [ ] **Step 3: Rename the legacy renderer and add the grid renderer**

In `base.py`, rename the existing `_render_table(cell_texts: list[str])` to `_render_table_legacy(cell_texts: list[str])` (body unchanged). Add a grid-aware renderer + a dispatcher:

```python
def _render_table_from_grid(cells: Sequence[BlockLike]) -> str:
    """Render GFM from cells carrying native (row_index, col_index)."""
    cells = list(cells)
    if not cells:
        return ""
    n_rows = max((c.row_index or 0) for c in cells) + 1
    n_cols = max((c.col_index or 0) for c in cells) + 1
    grid = [["" for _ in range(n_cols)] for _ in range(n_rows)]
    for c in cells:
        grid[c.row_index or 0][c.col_index or 0] = c.text
    widths = [max(len(grid[r][col]) for r in range(n_rows)) for col in range(n_cols)]

    def _fmt(row: list[str]) -> str:
        return "| " + _MD_TABLE_CELL_SEP.join(
            cell.ljust(w) for cell, w in zip(row, widths, strict=True)
        ) + " |"

    rule = "|-" + "-|-".join(_MD_TABLE_RULE_CHAR * w for w in widths) + "-|"
    return "\n".join([_fmt(grid[0]), rule, *(_fmt(grid[r]) for r in range(1, n_rows))])


def _render_table(cells: Sequence[BlockLike]) -> str:
    """Render a contiguous table_cell run as GFM.

    Uses the native (row, col) grid when every cell carries it; otherwise falls
    back to the legacy flat-text column heuristic (legacy / pre-P3 blocks).
    """
    cells = list(cells)
    # BlockLike declares row_index/col_index (Task 1), so direct attribute
    # access is mypy-clean (no getattr-returns-Any noise for the ratchet).
    if cells and all(c.row_index is not None and c.col_index is not None for c in cells):
        return _render_table_from_grid(cells)
    return _render_table_legacy([c.text for c in cells])
```

Update the coalescing loop in `render_blocks_to_markdown` to collect blocks (not just texts) and pass them to `_render_table`:

```python
        if block.block_type == "table_cell":
            page = block.page_number
            run: list[BlockLike] = []
            while (
                i < len(ordered)
                and ordered[i].block_type == "table_cell"
                and ordered[i].page_number == page
            ):
                run.append(ordered[i])
                i += 1
            parts.append(_render_table(run))
            continue
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_render_table_grid.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Guard the existing serializer + assembler tests**

Run: `cd backend && uv run pytest tests/unit -k "render_blocks or assembler" -v`
Expected: existing tests PASS (legacy/no-table cases unchanged; the legacy heuristic path is preserved).

- [ ] **Step 6: Commit**

```bash
git add backend/app/infrastructure/parsing/base.py backend/tests/unit/test_render_table_grid.py
git commit -m "feat(parsing): render GFM tables from native cell grid, legacy heuristic fallback"
```

---

## Task 6: Cell-scoped entailment premise

**Files:**
- Modify: `backend/app/llm/entailment.py` (`_build_premise` ~93-119)
- Test: `backend/tests/unit/test_entailment_cell_premise.py`

**Interfaces:**
- Consumes: `GateSpec.anchor_blocks` carry `ParsedBlock`s with `block_type`.
- Produces: when the cited block is a `table_cell`, `_build_premise` returns just that cell's text (so the deterministic numeric check + judge are cell-scoped — "the cited cell contains the value"), instead of the prose cell+neighbours window.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_entailment_cell_premise.py
from types import SimpleNamespace

from app.llm.entailment import GateSpec, _build_premise


def _block(page, idx, text, bt, cs, ce):
    return SimpleNamespace(
        page_number=page, block_index=idx, text=text, block_type=bt,
        char_start=cs, char_end=ce,
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
    spec = GateSpec(field_label="EPV", value_str="11.8", quote="11.8",
                    pos=_pos(1, 0, 4), anchor_blocks=blocks)
    assert _build_premise(spec) == "11.8"


def test_prose_premise_keeps_neighbours():
    blocks = [
        _block(1, 0, "Intro.", "paragraph", 0, 6),
        _block(1, 1, "The EPV was 4.6.", "paragraph", 7, 23),
        _block(1, 2, "Outro.", "paragraph", 24, 30),
    ]
    spec = GateSpec(field_label="EPV", value_str="4.6", quote="The EPV was 4.6.",
                    pos=_pos(1, 7, 23), anchor_blocks=blocks)
    premise = _build_premise(spec)
    assert "Intro." in premise and "Outro." in premise  # prose keeps the window
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_entailment_cell_premise.py -v`
Expected: FAIL on `test_table_cell_premise_is_cell_only` — current code returns cell + neighbours (`"11.8\n999"`).

- [ ] **Step 3: Make the premise cell-scoped for table cells**

In `_build_premise`, after `cited_idx` is resolved and before building the neighbour window:

```python
        if cited_idx is not None:
            cited = blocks_by_idx[cited_idx]
            # Table cells verify against the cell itself: "the cited cell
            # contains the value." Including neighbour cells would let an
            # adjacent cell's number satisfy the deterministic check.
            if getattr(cited, "block_type", None) == "table_cell":
                return cited.text
            parts = [
                blocks_by_idx[j].text
                for j in (cited_idx - 1, cited_idx, cited_idx + 1)
                if j in blocks_by_idx
            ]
            return "\n".join(parts)
    return spec.quote
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_entailment_cell_premise.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Guard existing entailment tests**

Run: `cd backend && uv run pytest tests/unit -k entailment -v`
Expected: existing entailment tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/llm/entailment.py backend/tests/unit/test_entailment_cell_premise.py
git commit -m "feat(extraction): cell-scoped entailment premise for table-cell citations"
```

---

## Task 7: Docling adapter lifts real row/col + spans + header flags

**Files:**
- Modify: `backend/app/infrastructure/parsing/docling_parser.py` (the `TableItem` cell loop ~116-138)
- Test: `backend/tests/unit/test_docling_cell_fields.py`

**Interfaces:**
- Produces: pure helper `docling_cell_fields(cell) -> dict` returning `{row_index, col_index, row_span, col_span, is_header}` from a docling `TableCell`-like object, used by `DoclingParser.parse` to populate the new `ParsedBlock` cell fields. Per-cell bbox stays the table-level bbox (docling table cells do not expose a reliable own bbox here) — documented limitation.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_docling_cell_fields.py
from types import SimpleNamespace

from app.infrastructure.parsing.docling_parser import docling_cell_fields


def test_docling_cell_fields_maps_offsets_and_spans():
    cell = SimpleNamespace(
        start_row_offset_idx=2, end_row_offset_idx=4,
        start_col_offset_idx=1, end_col_offset_idx=2,
        column_header=False, row_header=False,
    )
    assert docling_cell_fields(cell) == {
        "row_index": 2, "col_index": 1, "row_span": 2, "col_span": 1, "is_header": False,
    }


def test_docling_cell_fields_marks_headers():
    cell = SimpleNamespace(
        start_row_offset_idx=0, end_row_offset_idx=1,
        start_col_offset_idx=0, end_col_offset_idx=1,
        column_header=True, row_header=False,
    )
    assert docling_cell_fields(cell)["is_header"] is True


def test_docling_cell_fields_tolerates_missing_attrs():
    cell = SimpleNamespace()  # nothing
    out = docling_cell_fields(cell)
    assert out == {
        "row_index": None, "col_index": None, "row_span": None, "col_span": None,
        "is_header": None,
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_docling_cell_fields.py -v`
Expected: FAIL — `cannot import name 'docling_cell_fields'`.

- [ ] **Step 3: Add the helper and use it in `parse`**

Add to `docling_parser.py` (module level):

```python
def docling_cell_fields(cell: object) -> dict[str, int | None]:
    """Map a docling TableCell to native cell-grid fields.

    docling exposes start/end row+col offset indices (half-open) plus
    column_header / row_header booleans. Spans derive from the offset deltas.
    Missing attributes degrade to None (older docling versions / odd cells).
    """
    sr = getattr(cell, "start_row_offset_idx", None)
    er = getattr(cell, "end_row_offset_idx", None)
    sc = getattr(cell, "start_col_offset_idx", None)
    ec = getattr(cell, "end_col_offset_idx", None)
    row_span = (er - sr) if (sr is not None and er is not None) else None
    col_span = (ec - sc) if (sc is not None and ec is not None) else None
    is_header = None
    if hasattr(cell, "column_header") or hasattr(cell, "row_header"):
        is_header = bool(getattr(cell, "column_header", False) or getattr(cell, "row_header", False))
    return {
        "row_index": sr,
        "col_index": sc,
        "row_span": row_span,
        "col_span": col_span,
        "is_header": is_header,
    }
```

In the `TableItem` cell loop, pass the fields into the `ParsedBlock`:

```python
                for cell in item.data.table_cells:
                    text = getattr(cell, "text", "").strip()
                    if not text:
                        continue
                    idx = per_page_index.get(page_no, 0)
                    per_page_index[page_no] = idx + 1
                    grid = docling_cell_fields(cell)
                    blocks.append(
                        ParsedBlock(
                            page_number=page_no,
                            block_index=idx,
                            text=text,
                            char_start=0,
                            char_end=0,
                            bbox=dict(bbox),
                            block_type="table_cell",
                            row_index=grid["row_index"],
                            col_index=grid["col_index"],
                            row_span=grid["row_span"],
                            col_span=grid["col_span"],
                            is_header=grid["is_header"],
                        )
                    )
                continue
```

> Confirm the docling `TableCell` attribute names at implement time against the installed `docling_core` (`uv run --with docling python -c "from docling_core.types.doc import TableCell; print([f for f in TableCell.model_fields])"`). The names above (`start_row_offset_idx`, `end_row_offset_idx`, `start_col_offset_idx`, `end_col_offset_idx`, `column_header`, `row_header`) are the documented fields; if any differ, adjust `docling_cell_fields` and its test together.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_docling_cell_fields.py -v`
Expected: PASS (3 passed). (No docling install needed — the helper is pure and the test uses fakes.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/infrastructure/parsing/docling_parser.py backend/tests/unit/test_docling_cell_fields.py
git commit -m "feat(parsing): Docling adapter lifts native row/col + spans + header flags"
```

---

## Task 8: End-to-end integration — table value gets a cell-anchored citation

**Files:**
- Test: `backend/tests/integration/test_table_cell_citation_e2e.py`

**Interfaces:**
- Consumes: `PymupdfParser` (Task 4), `ArticleTextBlockRepository` (Task 3), `build_anchor` (existing), `render_blocks_to_markdown` (Task 5).

This task adds **no production code** — it proves the pieces compose: a parsed table cell is anchored by quote to its own block, and the anchor is a non-prose (hybrid/region) kind carrying the cell's `block_index`.

- [ ] **Step 1: Write the test**

```python
# backend/tests/integration/test_table_cell_citation_e2e.py
import fitz
import pytest

from app.infrastructure.parsing.base import (
    assign_char_offsets_to_blocks,
    concat_page_text,
    render_blocks_to_markdown,
)
from app.infrastructure.parsing.pymupdf_parser import PymupdfParser
from app.services.evidence_anchor_service import build_anchor


def _table_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=300, height=200)
    xs, ys = [40, 160, 280], [40, 90, 140]
    for x in xs:
        page.draw_line((x, ys[0]), (x, ys[-1]))
    for y in ys:
        page.draw_line((xs[0], y), (xs[-1], y))
    page.insert_text((50, 70), "EPV")
    page.insert_text((170, 70), "Value")
    page.insert_text((50, 120), "ratio")
    page.insert_text((170, 120), "11.8")
    out = doc.tobytes()
    doc.close()
    return out


def test_table_value_anchors_to_its_cell_block():
    blocks = PymupdfParser().parse(_table_pdf())
    # the parsed blocks already have offsets (parse calls assign_char_offsets);
    # re-assert the page-text invariant holds for the "11.8" cell.
    page_text = concat_page_text(blocks)[1]
    cell = next(b for b in blocks if b.text == "11.8")
    assert page_text[cell.char_start:cell.char_end] == "11.8"

    pos = build_anchor("11.8", blocks)
    assert pos is not None
    # anchored to the cell's own block_index, on a non-prose anchor kind
    assert cell.block_index in pos.anchor.block_ids
    assert pos.anchor.kind in ("hybrid", "region", "text")

    # the rendered GFM table places the value (grid-correct projection)
    md = render_blocks_to_markdown(blocks)
    assert "11.8" in md and "|" in md
```

> If `build_anchor`'s import path or signature differs, align with `backend/tests/unit/test_evidence_anchor_service.py`. The non-prose detection in `build_anchor` yields `hybrid` for `table_cell` matches; the assertion accepts `text` too in case fitz classifies the single short token leniently.

- [ ] **Step 2: Run the test**

Run: `cd backend && uv run pytest tests/integration/test_table_cell_citation_e2e.py -v`
Expected: PASS. If the anchor kind is unexpectedly `text`, confirm `evidence_anchor_service._PROSE_BLOCK_TYPES` excludes `table_cell` (it should — `table_cell` is non-prose ⇒ hybrid).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/integration/test_table_cell_citation_e2e.py
git commit -m "test(extraction): table value anchors to its own cell block (P3 e2e)"
```

---

## Task 9: Frontend guard — a table-cell citation highlights the cell

**Files:**
- Create: `frontend/pdf-viewer/primitives/__tests__/tableCellLocate.test.tsx`

**Interfaces:**
- Consumes: existing `Reader`, `ViewerProvider`, `locateInReader` store action, per-block `data-block-id` rendering.

No production change is expected — each `table_cell` renders as its own `<div data-block-id>` and the existing locate path flashes/highlights it. This test guards that behavior so a future reader refactor can't silently break cell citations. If the test reveals a real gap (e.g., a short cell value defeats `findBlockForQuote`), fix it minimally in `readerLocate.ts` and note it here.

- [ ] **Step 1: Write the test**

```tsx
// frontend/pdf-viewer/primitives/__tests__/tableCellLocate.test.tsx
import {render, screen, act} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {Reader, type ReaderTextBlock} from '../Reader';
import {ViewerProvider} from '../../core/context';
import {useViewerStoreApi} from '../../core/hooks'; // adjust to the real store-api hook

const CELLS: ReaderTextBlock[] = [
  {id: 'c0', pageNumber: 1, blockIndex: 0, text: 'EPV', blockType: 'table_cell'},
  {id: 'c1', pageNumber: 1, blockIndex: 1, text: 'Value', blockType: 'table_cell'},
  {id: 'c2', pageNumber: 1, blockIndex: 2, text: 'ratio', blockType: 'table_cell'},
  {id: 'c3', pageNumber: 1, blockIndex: 3, text: '11.8', blockType: 'table_cell'},
];

function Harness() {
  const api = useViewerStoreApi();
  // expose a way for the test to dispatch a locate after mount
  (globalThis as Record<string, unknown>).__locate = () =>
    api.getState().actions.locateInReader('11.8', 1, [3]);
  return <Reader blocks={CELLS} />;
}

describe('table cell citation locate', () => {
  it('targets the cited cell block, not the whole table', async () => {
    render(
      <ViewerProvider>
        <Harness />
      </ViewerProvider>,
    );
    // each cell is its own block div
    const cell = document.querySelector('[data-block-id="c3"]');
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute('data-block-type')).toBe('table_cell');

    await act(async () => {
      (globalThis as {__locate?: () => void}).__locate?.();
    });
    // the cited cell receives the flash ring (block-scoped, not the table)
    expect(document.querySelector('[data-block-id="c3"]')?.className).toContain('ring-');
  });
});
```

> The exact store-api hook + provider import names must match the current `frontend/pdf-viewer/core/` exports (the anchor pack shows `ViewerProvider` in `../core/context` and a `useViewerStoreApi*` hook; align imports before running). Per memory `reference_pdf_viewer_barrel_jsdom`, import from `../Reader` / `../../core/...` relative paths — never the `@prumo/pdf-viewer` barrel. If the CSS Custom Highlight API isn't available under jsdom, assert the block-flash ring (as above) rather than `CSS.highlights`.

- [ ] **Step 2: Run the test**

Run (from repo root): `npm run test:run -- frontend/pdf-viewer/primitives/__tests__/tableCellLocate.test.tsx`
Expected: PASS. If it fails because `findBlockForQuote`/`findBlockByIndex` doesn't resolve `[1,[3]]` to `c3`, debug `readerLocate.ts`; the fix (if any) is to ensure block-index `3` on page `1` maps to the `c3` block. Keep production changes minimal.

- [ ] **Step 3: Commit**

```bash
git add frontend/pdf-viewer/primitives/__tests__/tableCellLocate.test.tsx
git commit -m "test(pdf-viewer): guard table-cell citation highlights the cited cell"
```

---

## Self-Review

**Spec coverage (§4.5 / §4.7 / §5 P3):**
- Native cell grid on `ArticleTextBlock` (row/col/spans/is_header + per-cell bbox) → Tasks 1-3. ✅ (per-cell bbox = existing `bbox` column, populated per cell in Task 4.)
- Stop `_infer_column_count` guessing; native grid + legacy fallback → Task 5. ✅
- Cite by `(block_id, row, col)`; verifier checks the cited cell → cell anchors to its block (Task 4/8) + cell-scoped premise (Task 6). ✅
- `pymupdf4llm`-default → **amended to extend `PymupdfParser`** (Task 4); no new dep. ✅ (spec §4.7 amendment)
- Docling tier lifts row/col + spans → Task 7. ✅
- Highlight the cell, not the table → per-block rendering already cell-scoped; guarded by Task 9. ✅
- Serialize tables to the LLM as HTML/cell-KV → **DEFERRED** (Scope decisions) — flat-grid default tier makes it equivalent to correct GFM; needs Docling spans + the §4.11 gate. Flagged for confirmation. ⚠️
- LlamaParse opt-in → unchanged (P4 mentions it; no work here). ✅

**Placeholder scan:** No TBD/TODO; every code step has concrete code; the two "confirm attribute names" notes (docling fields, FE store-hook imports) are verification steps with exact commands, not placeholders.

**Type consistency:** `build_table_cell_blocks` / `_table_to_rows` / `build_anchor` / `_build_premise` / `docling_cell_fields` signatures are used consistently across tasks; `ParsedBlock` cell fields (Task 1) match the `ArticleTextBlock` columns (Task 2), the repo mapping (Task 3), and the `BlockLike`/grid reads (Task 5).

**Risks carried (un-gated):** the find_tables dedup (text-inside-table-bbox filter) and reading-order interleave are the highest-novelty logic — covered by the fixture test (Task 4) and the e2e (Task 8); verify on a real table-rich PDF on prod in the ship phase. Two adjacent tables with no text between them would coalesce in GFM — rare; acceptable for P3.
