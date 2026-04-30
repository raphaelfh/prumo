# PDF Viewer — Database Requirements

> Cross-worktree handoff spec. **Audience:** the agent working on database
> schema changes in `claude/strange-wiles-a189ef`. **Author:** the agent on
> `claude/brave-chaplygin-9e6e73` building the new modular PDF viewer.

## Why this exists

The new `@prumo/pdf-viewer` module (Plans 1 + 1a, both shipped on
`claude/brave-chaplygin-9e6e73`) needs three things from the database to be
useful for AI-grounded extraction. This spec defines those requirements
exactly so a parallel branch can implement them without re-deriving the
contract from the viewer code.

The viewer's runtime types are already locked in at
`frontend/pdf-viewer/core/{coordinates,citation}.ts`. The DB shapes here
mirror those types **field-for-field, including camelCase JSON keys** —
the viewer reads citation rows from the API and renders them directly.
No translation layer.

---

## Summary

| # | Change | Status | Owner | Blocks |
|---|---|---|---|---|
| 1 | New table `article_text_blocks` | **Required** | strange-wiles | Plan 6 (Citation API) |
| 2 | Standardize `extraction_evidence.position` JSONB shape (v1) | **Required** | strange-wiles | Plan 6 (Citation API) |
| 3 | Pydantic validation for the v1 position shape | **Required** | strange-wiles | Plan 6 (Citation API) |
| 4 | Consolidate `article_highlights` / `article_boxes` / `article_annotations` into one W3C-shaped `pdf_annotations` table | **Deferred** | Plan 7 | nothing yet |
| 5 | Add `extraction_evidence.pdf_annotation_id` FK | **Deferred / optional** | Plan 6 stretch | nothing |

The two **Required** rows are the merge-blockers for Plan 6 (Citation API
backend integration). The viewer module on `brave-chaplygin-9e6e73` is
type-only with respect to citations until 1 + 2 land — no runtime code
depends on the schema yet.

---

## 1. New table: `article_text_blocks`

### Why

The PDF viewer's "AI citation" flow is **citation-first**: the AI extraction
pipeline emits citations with `{page, charStart, charEnd, quote}` already
attached, and the viewer renders them directly. To produce those char
ranges and quotes reliably, the AI service needs **pre-indexed text per
page with stable character offsets and bounding boxes** — i.e., the
output of OpenDataLoader-PDF (or equivalent) run once at article ingestion.

`article_files.text_raw` exists but is a single concatenated blob — no
page boundaries, no char offsets, no bboxes. It is insufficient for
grounding citations. We need a structured per-block representation.

### Schema

```sql
CREATE TABLE article_text_blocks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_file_id UUID NOT NULL REFERENCES article_files(id) ON DELETE CASCADE,
    page_number     INTEGER NOT NULL,                  -- 1-indexed
    block_index     INTEGER NOT NULL,                  -- order within page (0-indexed)
    text            TEXT NOT NULL,
    char_start      INTEGER NOT NULL,                  -- offset within page's concatenated text
    char_end        INTEGER NOT NULL,                  -- exclusive
    bbox            JSONB NOT NULL,                    -- {x, y, width, height} in PDF user space points
    block_type      TEXT NOT NULL,                     -- paragraph | heading | list_item | table_cell | figure_caption | header | footer
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT article_text_blocks_page_positive CHECK (page_number >= 1),
    CONSTRAINT article_text_blocks_block_nonneg CHECK (block_index >= 0),
    CONSTRAINT article_text_blocks_char_start_nonneg CHECK (char_start >= 0),
    CONSTRAINT article_text_blocks_char_range_valid CHECK (char_end >= char_start),
    CONSTRAINT article_text_blocks_block_type_valid CHECK (
        block_type IN ('paragraph', 'heading', 'list_item', 'table_cell',
                       'figure_caption', 'header', 'footer')
    )
);

CREATE INDEX idx_article_text_blocks_file_page_block
    ON article_text_blocks (article_file_id, page_number, block_index);

CREATE INDEX idx_article_text_blocks_file_id
    ON article_text_blocks (article_file_id);

-- Optional / Plan 6 follow-up — uncomment if/when lexical search is needed.
-- The viewer doesn't run search against this table; AI extraction does.
-- CREATE INDEX idx_article_text_blocks_text_trgm
--     ON article_text_blocks USING gin (text gin_trgm_ops);
```

### bbox JSONB shape

```json
{"x": 100.5, "y": 200.0, "width": 400.0, "height": 30.0}
```

- Coordinates are in **PDF user space**: origin is bottom-left of the page,
  units are points (1/72 inch).
- Floats. Page sizes typically 100s–1000s of points; rect widths and
  heights are usually 10s–100s.
- This matches the runtime `PDFRect` type at
  `frontend/pdf-viewer/core/coordinates.ts:13–18`.

### Block-type vocabulary

The 7-value enum-like set covers what OpenDataLoader-PDF emits today and
what the viewer might want to render differently in the future (e.g.,
faded headers/footers, distinct figure-caption styling). If
OpenDataLoader-PDF emits a value not in this set, **map it to `paragraph`**
rather than extending the constraint — additions are easy in a follow-up
migration; rejecting writes is hard to roll back.

### SQLAlchemy model

Place in `backend/app/models/article.py` next to `ArticleFile`:

```python
class ArticleTextBlock(Base):
    __tablename__ = 'article_text_blocks'

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    article_file_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('article_files.id', ondelete='CASCADE'),
        nullable=False,
    )
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    block_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    char_start: Mapped[int] = mapped_column(Integer, nullable=False)
    char_end: Mapped[int] = mapped_column(Integer, nullable=False)
    bbox: Mapped[dict] = mapped_column(JSONB, nullable=False)
    block_type: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    article_file: Mapped['ArticleFile'] = relationship(
        back_populates='text_blocks',
    )
```

And on `ArticleFile`:

```python
text_blocks: Mapped[list['ArticleTextBlock']] = relationship(
    back_populates='article_file',
    cascade='all, delete-orphan',
    passive_deletes=True,
)
```

### Pydantic shape (for ingestion service)

```python
from typing import Literal
from pydantic import BaseModel, Field, model_validator

BlockType = Literal[
    'paragraph', 'heading', 'list_item', 'table_cell',
    'figure_caption', 'header', 'footer',
]

class TextBlockBBox(BaseModel):
    x: float
    y: float
    width: float
    height: float

class TextBlockInput(BaseModel):
    """Shape OpenDataLoader-PDF (or equivalent) emits per page block."""
    page_number: int = Field(ge=1)
    block_index: int = Field(ge=0)
    text: str
    char_start: int = Field(ge=0)
    char_end: int
    bbox: TextBlockBBox
    block_type: BlockType

    @model_validator(mode='after')
    def _char_range_valid(self):
        if self.char_end < self.char_start:
            raise ValueError('char_end must be >= char_start')
        return self
```

### Migration ordering hint

The current head migration on `claude/strange-wiles-a189ef` is
`20260428_0017_drop_evidence_legacy_columns.py` (per the schema
inspection done on `brave-chaplygin-9e6e73`). The new
`article_text_blocks` migration should be `0018` or later, sequenced
after any in-flight evidence-evolution migrations. Suggested filename:
`<YYYYMMDD>_0018_create_article_text_blocks.py`.

### Backfill / data lifecycle

- On article ingestion (existing pipeline), run OpenDataLoader-PDF on each
  `article_files.file_role = 'MAIN'` row and insert one
  `article_text_blocks` row per detected block. This is a Plan 6 task,
  not part of this DB spec — the strange-wiles agent only needs to land
  the schema.
- For pre-existing articles already ingested, a one-time backfill job
  is needed. Plan 6 will own it. **Don't write the backfill in this
  branch.**
- `ON DELETE CASCADE` from `article_files` means re-uploading an article
  file (which deletes the old row) cleans up text blocks automatically.
  This is the desired behavior.

---

## 2. Standardize `extraction_evidence.position` JSONB shape (v1)

### Why

`extraction_evidence` already has `article_file_id`, `page_number`,
`position` (JSONB), `text_content`. The shape of `position` is currently
unconstrained — different services may write different keys. The PDF
viewer is about to start consuming citations from this table, and it
needs a stable contract.

This change does **not** alter the table schema. It locks down the JSONB
shape via Pydantic at the service layer and documents v1 as the official
wire format.

### Wire format (v1)

```json
{
  "version": 1,
  "anchor": <CitationAnchor>
}
```

Where `<CitationAnchor>` is one of three discriminated variants (matches
`frontend/pdf-viewer/core/citation.ts:28–58` field-for-field, including
camelCase keys):

#### Text anchor

Used when only the textual range is known (most robust to re-OCR / PDF
re-encoding).

```json
{
  "kind": "text",
  "range": {"page": 5, "charStart": 1234, "charEnd": 1287},
  "quote": "the methodology used was a randomized controlled trial"
}
```

`quote` is optional but **strongly recommended** — without it, the viewer
must look up the text from `article_text_blocks` to render a highlight.

#### Region anchor

Used for figures, tables, image regions, and any non-textual content.

```json
{
  "kind": "region",
  "page": 7,
  "rect": {"x": 100.0, "y": 200.0, "width": 400.0, "height": 200.0}
}
```

`rect` coordinates in PDF user space (origin bottom-left, points).

#### Hybrid anchor (recommended for AI-generated citations)

Both text and bbox plus the canonical quote — maximum resilience.

```json
{
  "kind": "hybrid",
  "range": {"page": 5, "charStart": 1234, "charEnd": 1287},
  "rect": {"x": 100.0, "y": 720.0, "width": 412.0, "height": 14.0},
  "quote": "the methodology used was a randomized controlled trial"
}
```

### `text_content` column behavior

The existing `extraction_evidence.text_content` column should mirror
`anchor.quote` when one is present:

- `kind: 'text'` with quote → `text_content = anchor.quote`
- `kind: 'text'` without quote → `text_content = NULL` (viewer
  resolves text via `article_text_blocks` lookup at render time)
- `kind: 'region'` → `text_content = NULL` (no text)
- `kind: 'hybrid'` → `text_content = anchor.quote` (always present)

This is a denormalization for query convenience (`SELECT text_content
FROM extraction_evidence WHERE …` without JSONB extraction). The service
layer enforces the consistency on write.

### Page-number column behavior

`extraction_evidence.page_number` should mirror the anchor's page:

- `kind: 'text'` → `page_number = anchor.range.page`
- `kind: 'region'` → `page_number = anchor.page`
- `kind: 'hybrid'` → `page_number = anchor.range.page` (range and rect
  agree — service-layer validates)

Same denormalization rationale as `text_content`.

### Why no PostgreSQL CHECK constraint on the JSONB

JSONB CHECK constraints with discriminated unions are fragile and
error-prone (you'd need a long boolean expression with `jsonb_typeof`
calls and `?` operators). Pydantic at the service layer is sufficient —
all writes go through the extraction service. If a stronger guarantee
becomes necessary later (e.g., direct `INSERT` from another tool), add
a CHECK then.

### Pydantic models

Place in `backend/app/schemas/extraction.py` (or wherever extraction
schemas live in the backend tree):

```python
from typing import Annotated, Literal, Optional, Union
from pydantic import BaseModel, ConfigDict, Field

# camelCase JSON keys to mirror the TypeScript runtime types.
class _CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class PDFRect(_CamelModel):
    x: float
    y: float
    width: float
    height: float


class PDFTextRange(_CamelModel):
    page: int = Field(ge=1)
    char_start: int = Field(alias='charStart', ge=0)
    char_end: int = Field(alias='charEnd')


class TextCitationAnchor(_CamelModel):
    kind: Literal['text']
    range: PDFTextRange
    quote: Optional[str] = None


class RegionCitationAnchor(_CamelModel):
    kind: Literal['region']
    page: int = Field(ge=1)
    rect: PDFRect


class HybridCitationAnchor(_CamelModel):
    kind: Literal['hybrid']
    range: PDFTextRange
    rect: PDFRect
    quote: str


CitationAnchor = Annotated[
    Union[TextCitationAnchor, RegionCitationAnchor, HybridCitationAnchor],
    Field(discriminator='kind'),
]


class ExtractionEvidencePosition(_CamelModel):
    """Versioned wire format for extraction_evidence.position JSONB.

    Mirrors the runtime Citation type at
    frontend/pdf-viewer/core/citation.ts. JSON keys are camelCase to avoid
    a translation layer between the database and the viewer.
    """
    version: Literal[1] = 1
    anchor: CitationAnchor

    @classmethod
    def parse_jsonb(cls, raw: dict) -> 'ExtractionEvidencePosition':
        """Validate a raw JSONB value retrieved from the database."""
        return cls.model_validate(raw)
```

### Service-layer integration

Wherever `extraction_evidence` rows are written today (proposal records,
reviewer decisions, consensus decisions — see migrations 0013/0017), the
`position` field should be assigned a serialized `ExtractionEvidencePosition`:

```python
position = ExtractionEvidencePosition(
    anchor=HybridCitationAnchor(
        kind='hybrid',
        range=PDFTextRange(page=5, char_start=1234, char_end=1287),
        rect=PDFRect(x=100.0, y=720.0, width=412.0, height=14.0),
        quote='the methodology used was…',
    ),
)
evidence_row.position = position.model_dump(by_alias=True, mode='json')
evidence_row.page_number = (
    position.anchor.range.page
    if position.anchor.kind in ('text', 'hybrid')
    else position.anchor.page
)
evidence_row.text_content = (
    position.anchor.quote
    if position.anchor.kind in ('text', 'hybrid')
    else None
)
```

`by_alias=True` is required so JSONB keys are written as camelCase
(`charStart`, not `char_start`).

### Backfill of existing rows

- Existing `extraction_evidence` rows from migrations 0013/0017 may have
  old-shape `position` values. **Plan 6 owns** writing a migration that
  parses each row's `position`, normalizes to v1, and updates in place.
- For this DB spec, the strange-wiles agent does **not** need to backfill.
  Just land the new shape contract for new writes; Plan 6 cleans up old
  rows.

---

## 3. Tests

### `article_text_blocks` (must add)

`backend/tests/models/test_article_text_blocks.py`:

- INSERT with all required columns succeeds
- INSERT with `page_number = 0` fails (CHECK constraint)
- INSERT with `char_end < char_start` fails (CHECK constraint)
- INSERT with `block_type = 'whatever'` fails (CHECK constraint)
- DELETE on `article_files` cascades to `article_text_blocks`
- The `ArticleFile.text_blocks` relationship loads the rows in
  `(page_number, block_index)` order

### `ExtractionEvidencePosition` (must add)

`backend/tests/schemas/test_extraction_position.py`:

- Round-trip serialize → parse for each of the three kinds
- `model_dump(by_alias=True)` produces camelCase keys (`charStart`,
  `charEnd`)
- Parsing rejects unknown `kind` values
- Parsing rejects missing required fields per kind (e.g., hybrid without
  `quote`, text without `range`)
- Parsing rejects `range.page = 0` (Field constraint)

---

## 4. DEFERRED: annotation table consolidation (Plan 7)

### Current state

These three tables exist in migrations on `claude/strange-wiles-a189ef`
**but have no SQLAlchemy models yet**:

- `article_highlights` — `(page_number, position JSONB bbox,
  highlighted_text, color, user_id)`
- `article_boxes` — `(page_number, position JSONB, label)`
- `article_annotations` — `(page_number, position JSONB, content,
  user_id)`

### Recommendation for the strange-wiles agent

**Do not add SQLAlchemy models for these three tables yet.** They are
provisional and will be consolidated in Plan 7 into a single
`pdf_annotations` table conforming to the W3C Web Annotation Data Model.

If the schema work in `claude/strange-wiles-a189ef` is far along and
already includes models for these three tables, that's fine — Plan 7
will write a migration that drops/migrates them. But if the models
don't exist yet, save the work.

### Target shape (Plan 7 — for context only, do not implement)

```sql
CREATE TABLE pdf_annotations (
    id              UUID PRIMARY KEY,
    article_file_id UUID NOT NULL REFERENCES article_files(id) ON DELETE CASCADE,
    creator_id      UUID NOT NULL REFERENCES users(id),
    motivation      TEXT NOT NULL,           -- highlighting | commenting | tagging | bookmarking
    body            JSONB NOT NULL,          -- W3C Annotation body[]: textualBody, tags
    selectors       JSONB NOT NULL,          -- [TextQuoteSelector, PDFCoordinateSelector]
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The `selectors` JSONB carries both a W3C `TextQuoteSelector` (for
robustness to re-OCR) and a custom `PDFCoordinateSelector` (for visual
fidelity / non-textual regions). This is the extension proposed in
[CEUR Vol-3743 paper 5](https://ceur-ws.org/Vol-3743/paper5.pdf).

The full Plan 7 spec will be written when schema coordination is settled.

---

## 5. DEFERRED / OPTIONAL: `extraction_evidence.pdf_annotation_id` bridge

If, in Plan 6 or later, a reviewer manually anchors extraction evidence
to a user-created annotation, the cleanest model is an FK on
`extraction_evidence`:

```sql
ALTER TABLE extraction_evidence
    ADD COLUMN pdf_annotation_id UUID REFERENCES pdf_annotations(id);
```

This is a Plan 6 stretch goal. Not required for the viewer's core
citation rendering. **Do not add this column now.**

---

## 6. What the viewer module already has (so the strange-wiles agent has full context)

For reference — the runtime contracts the DB shapes mirror:

| Type / contract | File | Status |
|---|---|---|
| `PDFPoint`, `PDFRect`, `PDFTextRange` | `frontend/pdf-viewer/core/coordinates.ts` | ✅ shipped on brave-chaplygin |
| `PDFSource` discriminated union | `frontend/pdf-viewer/core/source.ts` | ✅ |
| `PDFEngine`, `PDFDocumentHandle`, `PDFPageHandle` | `frontend/pdf-viewer/core/engine.ts` | ✅ (interface only — no engine impl yet) |
| `Citation`, `CitationAnchor`, `TextCitationAnchor`, `RegionCitationAnchor`, `HybridCitationAnchor`, `CitationMetadata`, `CitationStyle` | `frontend/pdf-viewer/core/citation.ts` | ✅ |
| `ViewerState`, `ViewerActions`, `LoadStatus` | `frontend/pdf-viewer/core/state.ts` | ✅ |
| `createViewerStore`, `<ViewerProvider>`, `useViewerStore`, `useViewerStoreApi` | `frontend/pdf-viewer/core/{store.ts, context.tsx}` | ✅ |

The strange-wiles agent does **not** need to read those files to land
the DB work — the JSON shapes in this spec are the canonical contract.
The TS files are the runtime side of the same contract.

---

## 7. Coordination protocol

1. **Land Required changes 1, 2, 3** on `claude/strange-wiles-a189ef`
   when convenient. They are independent of any in-flight work on that
   branch.
2. **Communicate completion** by appending a one-line note to this spec
   doc (or its successor) with the migration revision IDs that
   delivered each item.
3. **Plan 6** on `claude/brave-chaplygin-9e6e73` (Citation API + viewer
   integration) will start once 1, 2, 3 are merged to `dev`.
4. **Plan 7** (annotations consolidation) will be written and executed
   later, after Plan 6 ships and after explicit go-ahead from the user.

If the strange-wiles agent encounters a constraint that makes any of
the Required items difficult, **flag it back to the user** rather than
deviating from the spec — the runtime types are already locked in on
the viewer side.

---

## 8. Out of scope for this spec (for clarity)

- The OpenDataLoader-PDF integration itself (Plan 6 — viewer worktree)
- Any UI for displaying citations or annotations (Plan 3+, Plan 7 —
  viewer worktree)
- Backfill jobs for existing articles (Plan 6)
- Backfill of legacy `extraction_evidence.position` rows (Plan 6)
- The W3C `pdf_annotations` table (Plan 7)
