---
status: draft
last_reviewed: 2026-06-28
owner: '@raphaelfh'
---

# Citation P4 — Figures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make figures first-class — a `figure` region block type the default parser emits from PDF image regions — and stop faking text citations for values that have no anchorable text by adding an honest **`ungroundable`** evidence label ("could not be grounded in the document text — human verification required"). Caption citation already works via `figure_caption`.

**Architecture:** Extend the closed block vocabulary with `figure` (+ DB CHECK migration 0037). `PymupdfParser` emits one `figure` `ParsedBlock` (bbox, empty text) per PDF image block, interleaved in reading order. The single `render_blocks_to_markdown` serializer skips `figure` like page chrome (no text to render). When an AI evidence quote does not anchor to any text block (`build_anchor` returns `None`), the suggestion service labels that evidence `ungroundable` instead of running the entailment judge on an unanchored quote. Frontend surfaces a distinct badge. Figure-content extraction (vision) and value→figure-region matching stay deferred.

**Tech Stack:** Python 3.11, PyMuPDF (`fitz`), SQLAlchemy 2.0 async, Alembic, pytest; React 19 + Vitest.

## Global Constraints

- **No new dependency.** Figures come from base fitz `get_text("dict")` image blocks (`type == 1`, which carry a `bbox`).
- **Closed vocabulary + DB CHECK.** Add `figure` to `BLOCK_TYPES` (`base.py`) AND to the `article_text_blocks_block_type_valid` CHECK constraint via **Alembic 0037**. The constraint is a baseline-named literal — drop + recreate with **raw `op.execute`** (NOT `op.create_check_constraint`, which `base.py`'s naming-convention mangles). down_revision = `0036_text_block_cell_grid`; revision id ≤ 32 chars; `public` schema.
- **Migration touches `article_text_blocks`** ⇒ bump `last_reviewed` + the `Migration head:` line in `docs/reference/extraction-hitl-architecture.md` to `0037_...`.
- **`text` is NOT NULL** — figure blocks use `text=""` (empty string is valid; only NULL is rejected). `figure` blocks render to nothing (added to the `render_blocks_to_markdown` skip set).
- **No API-contract change.** `EvidenceResponse.attributionLabel` is already `string | null` in `schema.d.ts` — adding `"ungroundable"` needs **no** `generate:api-types`. The FE `EvidenceCitation` union (hand-maintained) does widen.
- **ADR-0013** single serializer preserved (figure has no text; skip it).
- **Layering:** parser pure (no DB/IO); repository `flush()` not `commit()`.
- **English only.** One backend test: `cd backend && uv run pytest <path>`. One FE test: `/Users/raphael/PycharmProjects/prumo/node_modules/.bin/vitest run <path>` from the worktree root (worktree resolves the parent's node_modules).

## Scope (IN / OUT)

- **IN:** `figure` block type + migration; `PymupdfParser` figure-region emission; Docling `picture`→`figure` map; `ungroundable` label end-to-end (backend set + read + FE badge); confirm caption citation.
- **OUT (deferred):** figure-content/vision extraction; matching a value to a *specific* figure region (no reliable text→figure link without vision); a rich figure render in the reader (figures render empty in the text view; the PDF canvas already shows them); LlamaParse cloud tier (opt-in, not built here).

---

## File Structure

**Backend — modify:** `app/infrastructure/parsing/base.py` (vocab + render skip), `app/infrastructure/parsing/pymupdf_parser.py` (image→figure), `app/infrastructure/parsing/docling_parser.py` (`picture`→`figure`), `app/llm/entailment.py` (`AttributionLabel` += `ungroundable`), `app/services/section_extraction_service.py` (unanchored → `ungroundable`), `docs/reference/extraction-hitl-architecture.md`.
**Backend — create:** `app/alembic/versions/0037_block_type_figure.py`; unit/integration tests.
**Frontend — modify:** `frontend/types/ai-extraction.ts`, `frontend/components/extraction/ai/AISuggestionEvidence.tsx`, `frontend/lib/copy/extraction.ts`.

---

## Task 1: `figure` block type + CHECK migration 0037

**Files:**
- Modify: `backend/app/infrastructure/parsing/base.py` (BLOCK_TYPES ~41-51; render skip ~343)
- Create: `backend/alembic/versions/0037_block_type_figure.py`
- Modify: `docs/reference/extraction-hitl-architecture.md`
- Test: `backend/tests/integration/test_block_type_figure_constraint.py`

**Interfaces:**
- Produces: `"figure"` ∈ `BLOCK_TYPES`; the DB CHECK accepts `figure`; `render_blocks_to_markdown` skips `figure`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_block_type_figure_constraint.py
import pytest

from app.models.article import ArticleFile, ArticleTextBlock
from tests.integration.conftest import SEED


@pytest.mark.asyncio
async def test_figure_block_type_accepted_by_check(db_session_real):
    af = ArticleFile(
        article_id=SEED.primary_article, project_id=SEED.primary_project,
        storage_key="t/fig.pdf", file_type="pdf", file_role="MAIN",
    )
    db_session_real.add(af)
    await db_session_real.flush()

    block = ArticleTextBlock(
        article_file_id=af.id, page_number=1, block_index=0, text="",
        char_start=0, char_end=0,
        bbox={"x": 10.0, "y": 20.0, "width": 100.0, "height": 80.0},
        block_type="figure",
    )
    db_session_real.add(block)
    await db_session_real.flush()  # CHECK would reject 'figure' before 0037
    assert block.id is not None
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_block_type_figure_constraint.py -v`
Expected: FAIL — `CheckViolation` / `IntegrityError` on `article_text_blocks_block_type_valid` (figure not allowed yet). (If the model-level `normalize_block_type` is what rejects it — it does not; `figure` will be added to BLOCK_TYPES in Step 3, but the DB CHECK is the real gate this test targets.)

- [ ] **Step 3: Add `figure` to the vocab + render skip**

In `base.py`, add `"figure"` to the `BLOCK_TYPES` frozenset (after `"figure_caption"`). In `render_blocks_to_markdown`, extend the chrome skip:

```python
        if block.block_type in ("header", "footer", "figure"):
            i += 1
            continue
```

- [ ] **Step 4: Write the migration (raw op.execute, drop + recreate the named CHECK)**

```python
# backend/alembic/versions/0037_block_type_figure.py
"""article_text_blocks block_type: add 'figure'

Revision ID: 0037_block_type_figure
Revises: 0036_text_block_cell_grid
Create Date: 2026-06-28

"""

from alembic import op

revision = "0037_block_type_figure"
down_revision = "0036_text_block_cell_grid"
branch_labels = None
depends_on = None

_CONSTRAINT = "article_text_blocks_block_type_valid"
_TABLE = "public.article_text_blocks"

_TYPES_WITH_FIGURE = (
    "'paragraph', 'heading', 'list_item', 'table_cell', "
    "'figure_caption', 'header', 'footer', 'figure'"
)
_TYPES_BASELINE = (
    "'paragraph', 'heading', 'list_item', 'table_cell', "
    "'figure_caption', 'header', 'footer'"
)


def upgrade() -> None:
    op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT {_CONSTRAINT}")
    op.execute(
        f"ALTER TABLE {_TABLE} ADD CONSTRAINT {_CONSTRAINT} "
        f"CHECK (block_type IN ({_TYPES_WITH_FIGURE}))"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT {_CONSTRAINT}")
    op.execute(
        f"ALTER TABLE {_TABLE} ADD CONSTRAINT {_CONSTRAINT} "
        f"CHECK (block_type IN ({_TYPES_BASELINE}))"
    )
```

> First confirm the exact baseline constraint name + IN-list against `backend/alembic/versions/0006_article_text_blocks.py` (`grep -n "block_type_valid\|block_type IN" backend/alembic/versions/0006_article_text_blocks.py`). Match the name and the existing 7-type list verbatim, then append `'figure'`.

- [ ] **Step 5: Validate offline + apply + run the test**

Run:
```bash
cd backend
python -c "print(len('0037_block_type_figure') <= 32)"   # -> True
uv run alembic upgrade 0036_text_block_cell_grid:0037_block_type_figure --sql | grep -i "CONSTRAINT"
uv run alembic downgrade 0037_block_type_figure:0036_text_block_cell_grid --sql | grep -i "CONSTRAINT"
uv run alembic upgrade head
uv run pytest tests/integration/test_block_type_figure_constraint.py -v
```
Expected: `True`; the offline SQL shows DROP + ADD CONSTRAINT (both directions) on `public.article_text_blocks`; `upgrade head` succeeds; test PASSES.

- [ ] **Step 6: Update the architecture doc**

`docs/reference/extraction-hitl-architecture.md`: bump `last_reviewed` (frontmatter + blockquote) to `2026-06-28` and the `Migration head:` line to `0037_block_type_figure`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/infrastructure/parsing/base.py \
        backend/alembic/versions/0037_block_type_figure.py \
        backend/tests/integration/test_block_type_figure_constraint.py \
        docs/reference/extraction-hitl-architecture.md
git commit -m "feat(parsing): add 'figure' block type + CHECK migration 0037"
```

---

## Task 2: `PymupdfParser` emits `figure` region blocks

**Files:**
- Modify: `backend/app/infrastructure/parsing/pymupdf_parser.py`
- Test: `backend/tests/unit/test_pymupdf_parser_figures.py`

**Interfaces:**
- Consumes: `figure` ∈ BLOCK_TYPES (Task 1).
- Produces: `PymupdfParser.parse` emits one `figure` `ParsedBlock` (`text=""`, the image bbox, `block_type="figure"`) per `get_text("dict")` image block (`type == 1`), interleaved by reading order; cell-grid fields stay `None`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_pymupdf_parser_figures.py
import fitz

from app.infrastructure.parsing.pymupdf_parser import PymupdfParser


def _pdf_with_image() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=300, height=300)
    page.insert_text((40, 40), "A figure follows below.")
    # a small embedded raster image -> a type==1 block
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 40, 30))
    pix.clear_with(128)
    page.insert_image(fitz.Rect(60, 120, 220, 240), pixmap=pix)
    out = doc.tobytes()
    doc.close()
    return out


def test_parse_emits_figure_region_block():
    blocks = PymupdfParser().parse(_pdf_with_image())
    figures = [b for b in blocks if b.block_type == "figure"]
    assert figures, "expected at least one figure region block"
    fig = figures[0]
    assert fig.text == ""
    assert fig.bbox["width"] > 0 and fig.bbox["height"] > 0
    # still produced the page's text
    assert any("figure follows" in (b.text or "") for b in blocks)
    # figure has no cell-grid
    assert fig.row_index is None and fig.col_index is None
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_pymupdf_parser_figures.py -v`
Expected: FAIL — no `figure` blocks (image blocks are skipped today).

- [ ] **Step 3: Collect image blocks + emit figure entries**

In `parse()` pass 1, alongside the text-block loop, collect image blocks per page; in pass 2, add them to `entries` as `"figure"` and emit a `ParsedBlock`. Concretely:

In the pass-1 per-page loop, after building `text_blocks`, add:

```python
                image_blocks: list[dict[str, Any]] = [
                    b
                    for b in page.get_text("dict").get("blocks", [])
                    if b.get("type") == 1 and b.get("bbox")
                ]
                per_page[page_number] = {
                    "text": text_blocks,
                    "tables": converted,
                    "images": image_blocks,
                }
```

(Adjust the existing `per_page[page_number] = {...}` assignment to include `"images"`.) Relax the empty-doc guard to also count images:

```python
            if (
                not all_sizes
                and not any(p["tables"] for p in per_page.values())
                and not any(p["images"] for p in per_page.values())
            ):
                raise ValueError("PymupdfParser produced no text blocks")
```

In pass 2, after adding text + table entries:

```python
                for img in data.get("images", []):
                    ix0, iy0, ix1, iy1 = img["bbox"]
                    entries.append((float(iy0), float(ix0), "figure", img))
                entries.sort(key=lambda e: (e[0], e[1]))
```

And in the entry dispatch, handle the `"figure"` kind:

```python
                    elif kind == "figure":
                        x0, y0, x1, y1 = payload["bbox"]
                        blocks.append(
                            ParsedBlock(
                                page_number=page_number,
                                block_index=idx,
                                text="",
                                char_start=0,
                                char_end=0,
                                bbox={
                                    "x": float(x0), "y": float(y0),
                                    "width": float(x1 - x0), "height": float(y1 - y0),
                                },
                                block_type=normalize_block_type("figure"),
                            )
                        )
                        idx += 1
```

> Keep the existing `"text"` and `"table"` branches. The figure block's empty `text` yields a zero-width char span in `assign_char_offsets_to_blocks` (harmless) and renders to nothing (Task 1 skip).

- [ ] **Step 4: Run — verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_pymupdf_parser_figures.py -v`
Expected: PASS. If `insert_image` doesn't yield a `type==1` block in this PyMuPDF build, confirm via a scratch `print([b['type'] for b in page.get_text('dict')['blocks']])`; adjust the fixture (e.g. a larger image) until an image block appears — do not weaken the assertion.

- [ ] **Step 5: Guard the table + base parser tests (no regression)**

Run: `cd backend && uv run pytest tests/unit -k pymupdf -v`
Expected: all prior pymupdf tests still PASS (text/table behavior unchanged; figures are additive).

- [ ] **Step 6: Commit**

```bash
git add backend/app/infrastructure/parsing/pymupdf_parser.py \
        backend/tests/unit/test_pymupdf_parser_figures.py
git commit -m "feat(parsing): PymupdfParser emits figure region blocks from image regions"
```

---

## Task 3: Docling `picture` → `figure`

**Files:**
- Modify: `backend/app/infrastructure/parsing/docling_parser.py` (`_LABEL_MAP` ~33-42)
- Test: `backend/tests/unit/test_docling_label_map_figure.py`

**Interfaces:**
- Produces: docling `picture` items map to `block_type="figure"` (was normalizing to `paragraph`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_docling_label_map_figure.py
from app.infrastructure.parsing.docling_parser import _LABEL_MAP


def test_picture_maps_to_figure():
    assert _LABEL_MAP.get("picture") == "figure"
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_docling_label_map_figure.py -v`
Expected: FAIL — `_LABEL_MAP.get("picture")` is `None`.

- [ ] **Step 3: Add the mapping**

In `_LABEL_MAP`, add `"picture": "figure",` (and `"image": "figure",` for robustness).

- [ ] **Step 4: Run — verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_docling_label_map_figure.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/infrastructure/parsing/docling_parser.py \
        backend/tests/unit/test_docling_label_map_figure.py
git commit -m "feat(parsing): map docling picture/image labels to figure block type"
```

---

## Task 4: `ungroundable` attribution label (backend)

**Files:**
- Modify: `backend/app/services/section_extraction_service.py` (`_create_suggestions` gate-queue ~1424-1438)
- Test: `backend/tests/integration/test_section_extraction_evidence.py` (extend)

**Interfaces:**
- Consumes: the existing evidence loop where `pos = build_anchor(...)`.
- Produces: when a found value's evidence quote does not anchor (`pos is None`), its `ExtractionEvidence.attribution_label` is set to the string `"ungroundable"` (and it is NOT queued for the entailment judge).
- **Do NOT change `entailment.AttributionLabel`** — that Literal is the *judge's* output type (`entailed`/`weak`/`unsupported`); the judge never emits `ungroundable`. `attribution_label` is a free `Text` column, so setting the raw string is correct and keeps `EntailmentVerdict.label`'s type honest. `citation_read_service` already yields `verified=False` for any non-`entailed` label (no change there).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/integration/test_section_extraction_evidence.py` (mirror the existing setup; stub the gate so anchored rows would be `entailed`, and use an evidence quote that does NOT appear in the parsed blocks so `build_anchor` returns None):

```python
@pytest.mark.asyncio
async def test_unanchored_evidence_is_ungroundable(db_session_real, monkeypatch):
    # gate would label anchored rows "entailed"; the unanchored row must NOT
    # reach the gate and must be labelled "ungroundable" instead.
    async def _stub_gate(specs, *_a, **_kw):
        return ["entailed" for _ in specs]

    monkeypatch.setattr(ses, "run_entailment_gate", _stub_gate)
    monkeypatch.setattr(ses, "build_model", lambda *_a, **_kw: MagicMock())

    service = _make_service(db_session_real)
    run = await _build_run_in_extract(db_session_real)
    # _make_parsed_blocks persists blocks whose text does NOT contain this quote
    extracted = {
        "sample_size": {
            "value": 999, "confidence": 0.9, "reasoning": "from a figure",
            "evidence": [{"text": "a quote absent from the document text", "page_number": 1}],
            "status": "found",
        },
    }
    await service._create_suggestions(
        project_id=SEED.primary_project, article_id=SEED.primary_article,
        entity_type_id=..., parent_instance_id=None, extracted_data=extracted, run=run,
    )
    rows = (await db_session_real.execute(
        select(ExtractionEvidence).where(ExtractionEvidence.run_id == run.id)
    )).scalars().all()
    assert rows and all(r.attribution_label == "ungroundable" for r in rows)
```

> Align the `_make_service`/`_make_parsed_blocks`/`entity_type_id` usage with the existing tests in this file (read them first). The essential bit: the evidence quote must be absent from the parsed-block text so `build_anchor` → None.

- [ ] **Step 2: Run — verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_section_extraction_evidence.py::test_unanchored_evidence_is_ungroundable -v`
Expected: FAIL — the unanchored row currently goes through the (stubbed) gate and is labelled `entailed`, or is `None`.

- [ ] **Step 3: Add the unanchored branch (set the raw string; no Literal change)**

In `_create_suggestions`, change the gate-queue block so unanchored found-value evidence is flagged instead of judged (do NOT modify `entailment.AttributionLabel`):

```python
        # Queue for entailment gate: found fields with ANCHORED evidence only.
        if isinstance(value, dict) and value.get("status") == "found" and quote:
            if pos is not None:
                _gate_specs.append(
                    GateSpec(
                        field_label=field_label_map.get(field_name, field_name),
                        value_str=str(inner_value),
                        quote=quote,
                        pos=pos,
                        anchor_blocks=_anchor_blocks,
                    )
                )
                _gate_rows.append(ev_row)
            else:
                # No text anchor → cannot ground the value in the document
                # (e.g. the value appears only in a figure). Flag for human
                # verification instead of judging an unanchored quote.
                ev_row.attribution_label = "ungroundable"
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd backend && uv run pytest tests/integration/test_section_extraction_evidence.py -v`
Expected: the new test PASSES and the existing evidence tests still PASS (anchored rows still labelled by the gate).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/section_extraction_service.py \
        backend/tests/integration/test_section_extraction_evidence.py
git commit -m "feat(extraction): label unanchored evidence 'ungroundable' (no fabricated citation)"
```

---

## Task 5: Frontend `ungroundable` badge

**Files:**
- Modify: `frontend/types/ai-extraction.ts` (EvidenceCitation union ~35)
- Modify: `frontend/components/extraction/ai/AISuggestionEvidence.tsx` (badge ~66-84)
- Modify: `frontend/lib/copy/extraction.ts` (attribution copy ~851-853)
- Test: `frontend/components/extraction/ai/__tests__/AISuggestionEvidence.ungroundable.test.tsx`

**Interfaces:**
- Consumes: backend now emits `attributionLabel: "ungroundable"`.
- Produces: `EvidenceCitation.attributionLabel` union includes `"ungroundable"`; the citation row renders a distinct "Verify manually" badge + neutral/amber border for it.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/extraction/ai/__tests__/AISuggestionEvidence.ungroundable.test.tsx
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {AISuggestionEvidence} from '../AISuggestionEvidence';
import type {EvidenceCitation} from '../../../../types/ai-extraction';

const ev: EvidenceCitation[] = [
  {text: 'value only in a figure', pageNumber: 3, blockIds: [], attributionLabel: 'ungroundable', rank: 0},
];

describe('AISuggestionEvidence ungroundable', () => {
  it('renders the verify-manually badge for an ungroundable citation', () => {
    render(<AISuggestionEvidence evidence={ev} />);
    expect(screen.getByText(/verify manually/i)).toBeInTheDocument();
  });
});
```

> Confirm the real import paths/props of `AISuggestionEvidence` (relative paths; not the `@prumo/pdf-viewer` barrel). If the copy string differs, match the key you add in Step 3.

- [ ] **Step 2: Run — verify it fails**

Run (worktree root): `/Users/raphael/PycharmProjects/prumo/node_modules/.bin/vitest run frontend/components/extraction/ai/__tests__/AISuggestionEvidence.ungroundable.test.tsx`
Expected: FAIL — no badge copy rendered for `ungroundable`.

- [ ] **Step 3: Add the union value, copy, and badge branch**

`types/ai-extraction.ts`:

```typescript
  attributionLabel?: 'entailed' | 'weak' | 'unsupported' | 'ungroundable' | null;
```

`lib/copy/extraction.ts` (next to the other attribution keys):

```typescript
    attributionUngroundable: 'Verify manually',
```

`AISuggestionEvidence.tsx` — extend the badge mapping so `ungroundable` shows its copy with a cautionary (amber) treatment:

```typescript
  const label = citation.attributionLabel;
  const isEntailed = label === 'entailed';
  const isUngroundable = label === 'ungroundable';
  const isAmber = label === 'weak' || label === 'unsupported' || isUngroundable;

  const badgeCopy = isEntailed
    ? t('extraction', 'attributionEntailed')
    : label === 'weak'
      ? t('extraction', 'attributionWeak')
      : label === 'unsupported'
        ? t('extraction', 'attributionUnsupported')
        : isUngroundable
          ? t('extraction', 'attributionUngroundable')
          : null;

  const borderClass = isEntailed
    ? 'border-l-green-500'
    : isAmber
      ? 'border-l-amber-500'
      : 'border-l-primary/20';
```

- [ ] **Step 4: Run — verify it passes + typecheck + lint**

Run (worktree root):
```bash
/Users/raphael/PycharmProjects/prumo/node_modules/.bin/vitest run frontend/components/extraction/ai/__tests__/AISuggestionEvidence.ungroundable.test.tsx
/Users/raphael/PycharmProjects/prumo/node_modules/.bin/tsc -p tsconfig.app.json --noEmit
/Users/raphael/PycharmProjects/prumo/node_modules/.bin/eslint frontend/components/extraction/ai/AISuggestionEvidence.tsx frontend/types/ai-extraction.ts
```
Expected: test PASS; tsc exit 0; eslint clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/types/ai-extraction.ts frontend/components/extraction/ai/AISuggestionEvidence.tsx \
        frontend/lib/copy/extraction.ts \
        frontend/components/extraction/ai/__tests__/AISuggestionEvidence.ungroundable.test.tsx
git commit -m "feat(extraction): frontend 'Verify manually' badge for ungroundable citations"
```

---

## Self-Review

**Spec coverage (§4.6 / §5 P4):**
- `figure` region block type + CHECK migration → Task 1. ✅
- Parser emits figure regions → Task 2 (PymupdfParser) + Task 3 (Docling). ✅
- Cite the caption → `figure_caption` already in vocab + anchorable (no work needed); confirmed. ✅
- Un-groundable flag instead of a fake text citation → Task 4 (backend) + Task 5 (FE). ✅
- Figure-content vision + value→region matching → deferred (stated). ✅
- LlamaParse opt-in → unchanged. ✅

**Placeholder scan:** the two "confirm exact name/props" notes (0006 constraint, FE import) are verification steps with exact commands. No TBD/TODO.

**Type consistency:** only the FE `EvidenceCitation.attributionLabel` union gains `"ungroundable"`; the backend stores the raw string (free `Text` column) and the judge's `entailment.AttributionLabel` Literal stays the 3 values it actually emits. `verified` stays false for `ungroundable` (citation_read_service: `label == "entailed"`). Migration `0037_block_type_figure` chains from `0036_text_block_cell_grid`. The anchored gate-branch stays covered by the existing `test_section_extraction_evidence.py` tests; the new test covers the unanchored branch.

**Risks:** figure render is empty in the text reader (acceptable; canvas shows figures — deferred polish). `ungroundable` now applies to ANY unanchored found-value quote (figure-only OR fabricated) — both correctly route to human verification; this is more honest than judging an unanchored quote. Verify on a real figure-rich PDF in the ship phase.
