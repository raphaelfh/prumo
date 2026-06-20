---
status: planned
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

# Markdown view and markdown-anchored citations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Decision record: ADR 0013 (this plan **refines** it — see Goal). **Depends on** `docs/superpowers/plans/2026-06-20-dual-path-parse-at-ingest.md` — that plan populates `article_text_blocks` (LlamaParse cloud default / self-hosted PHI); this plan consumes them.

**Goal:** Render the article's blocks into one canonical **Markdown** projection
that is BOTH the surface the AI reads for extraction AND the surface shown in the
PDF-viewer's markdown/reader toggle; anchor every AI citation **in the markdown**
(primary, robust, parser-independent) with a SOURCE-MAP that also projects the
citation onto the PDF canvas bbox (secondary, precision tracking the parser
tier); and light up the highlight in both the markdown view and the canvas.

**Architecture:** A pure `render_blocks_to_markdown(blocks) -> (markdown,
source_map)` lives beside `concat_page_text` in
`app/infrastructure/parsing/base.py`. It REUSES the existing `_render_table`
from `extraction_block_assembler.py` so the prompt's tables and the viewer's
tables are byte-identical. While rendering, it emits a `SourceSpan` for every
verbatim prose/cell run: `{md_start, md_end, page_number, block_index,
char_start, char_end, bbox}`. Markdown syntax bytes (`##`, `|`, `-`, list
bullets) belong to NO span — so a quote that contains syntax simply will not
match, and the AI quotes prose. The extraction prompt is sourced from this
markdown (retiring `MAX_PDF_CHARS = 15_000`); evidence is anchored by finding the
AI quote in the markdown (a normalized substring), recording the markdown range
(primary, drives the markdown-view highlight) and resolving the source-map →
block bbox union (secondary, drives the canvas highlight). The viewer's `reader`
mode renders the same sanitized markdown via `react-markdown` + `remark-gfm` +
`rehype-sanitize`. This **refines ADR 0013**, which currently makes markdown
offset-less and highlight canvas-only (ADR 0013 §"Highlight limitation"): this
plan supersedes that one limitation by giving the markdown its own
char-range anchor while keeping blocks the bbox/offset source of truth.

**Tech Stack:** Python 3.11 + FastAPI + SQLAlchemy 2.0 async; pure functions in
`app/infrastructure/parsing/`; `nh3` server-side sanitize; pytest integration vs
local Supabase (`db_session_real`, project-scoped fixtures); React 19 +
`react-markdown` + `remark-gfm` + `rehype-sanitize` + `@tailwindcss/typography`
(already installed); pdf.js viewer (`useCitationHighlight`, `CitationOverlay`,
`CitationLiveRegion` already exist); TanStack Query + Zustand; vitest + MSW v2 +
`axe`. Suggested branch: `feat/markdown-view-and-citations`.

## Global Constraints

Every task's requirements implicitly include this section (verbatim binding
rules from the constitution + `.claude/rules/`):

- **Four-layer flow** `api → services → repositories → models`; endpoints never
  touch the DB or return ORM rows; services never import `api`; repositories hold
  no business logic (CI: `scripts/fitness/check_layered_arch.py`).
- Repositories `flush()`, **never** `commit()`.
- **Alembic owns the app schema** (revision id **≤ 32 chars**). This plan needs
  **NO migration** (free tier is on-demand, no stored column) — if any task ever
  reaches for one, STOP and flag it; the enriched-tier column is out of scope.
- RLS via `is_project_member()`; **`ensure_project_member()` on every
  project-scoped endpoint** (BOLA is a recurring incident class here).
- **Typed Pydantic responses** — never `ApiResponse[dict[str, Any]]` for a new
  model; errors expose `error.message`, not FastAPI's `detail`.
- `ExtractionEvidence.position` is canonical `PositionV1` JSONB and must
  round-trip `parse_position` + camelCase out of `citation_read_service.py`.
- **API-Contract gate:** any endpoint/schema change regenerates
  `frontend/types/api/` via `scripts/generate_api_types.sh` (`npm run
  generate:api-types`); the `api-contract` CI job fails on an uncommitted diff.
- **React Compiler `panicThreshold: 'all_errors'`** — NO `try/finally` (or
  `throw` inside `try`) in component/hook bodies; IO lives in
  `frontend/services/` returning `ErrorResult<T>` (`toResult`). Use
  `.then/.catch`.
- **`typecheck` (tsc) is a separate CI gate from vitest** — every FE task ends
  with `npm run typecheck`. No `any`. Import wire shapes from
  `frontend/types/api/schema.d.ts`, do not hand-mirror.
- Backend calls go through `apiClient` (`frontend/integrations/api/client.ts`);
  no new `supabase.from(...)` reads, no `fetch()` in services. TanStack keys come
  from the factories in `frontend/lib/query-keys/`.
- All user-facing strings go through `frontend/lib/copy/` (in-house i18n).
- **English only** for code, comments, commits, docs, copy keys.
- TDD per task; verify with `make test-backend` / `npm run test:run` /
  `npm run typecheck`.

---

## Phases

- **Phase 1 — `render_blocks_to_markdown` + source-map** (pure renderer beside
  `concat_page_text`; reuse `_render_table`; `SourceSpan` invariant).
- **Phase 2 — markdown-anchored citation schema + anchorer** (new
  `MarkdownCitationAnchor`; `parse_position` + FE `citation.ts` learn it;
  `evidence_anchor_service` gains a markdown-aware anchor builder that returns the
  markdown range + the source-map → bbox projection).
- **Phase 3 — AI extraction reads markdown** (source the three prompt sites from
  the renderer; anchor evidence via the Phase-2 markdown anchorer; `READ_FROM_BLOCKS`
  flag + lazy `pypdf`/`MAX_PDF_CHARS` fallback; remove `MAX_PDF_CHARS` once unreferenced).
- **Phase 4 — markdown API endpoint** (`GET /api/v1/article-files/{id}/markdown`,
  free tier, BOLA-safe, typed; `nh3` server-side sanitize; FE deps).
- **Phase 5 — Reader → markdown view** (repoint `Reader.tsx` to sanitized
  markdown; wire the fetch into `ExtractionPDFPanel` + `QualityAssessmentFullScreen`).
- **Phase 6 — highlight in both surfaces** (markdown-range highlight in the
  rendered markdown; canvas projection via the source-map `rect`; reader↔canvas
  sync; a11y).
- **Phase 7 — no-legacy cleanup + `/simplify`**.

## File map

| File | Responsibility | Change |
| --- | --- | --- |
| `backend/app/infrastructure/parsing/base.py` | renderer + source-map | New: `SourceSpan` dataclass + `render_blocks_to_markdown(blocks) -> tuple[str, list[SourceSpan]]`, beside `concat_page_text`; imports `_render_table` |
| `backend/app/services/extraction_block_assembler.py` | table serializer | Export `_render_table` for reuse (rename to public `render_table` or import the private symbol) — one table codepath |
| `backend/app/schemas/extraction.py` | citation schema | New `MarkdownRange` + `MarkdownCitationAnchor` (`kind='markdown'`); add to `CitationAnchor` union; `parse_position` already validates via the union |
| `backend/app/services/evidence_anchor_service.py` | grounding | New `match_in_markdown(quote, markdown, source_map)` + `build_markdown_anchor(...)`; reuses `_normalize`/`_normalize_with_index_map` + `_bbox_union` |
| `backend/app/services/section_extraction_service.py` | extraction | Source prompt from `render_blocks_to_markdown`; anchor via `build_markdown_anchor`; `READ_FROM_BLOCKS` + lazy fallback |
| `backend/app/llm/prompts/__init__.py` (+ `section_extraction`, `quality_assessment`, `model_identification`) | prompts | Remove `MAX_PDF_CHARS` prefix-cut; accept the markdown text; keep `content_version` |
| `backend/app/core/config.py` | settings | `READ_FROM_BLOCKS: bool` flag + markdown budget (chars) |
| `backend/app/llm/validators.py` | read model | `anchor_kind` / `evidence_is_grounded` learn `"markdown"` |
| `backend/app/services/citation_read_service.py` | read model | Surface the `markdown` kind (derives from `anchor.kind` — no recompute) |
| `backend/app/services/article_markdown_read_service.py` | markdown read | New: project-id lookup + on-demand `render_blocks_to_markdown` + `nh3` sanitize → typed payload (mirrors `article_text_block_read_service`) |
| `backend/app/api/v1/endpoints/article_text_blocks.py` | endpoint | Add `GET /{article_file_id}/markdown` (BOLA-safe, typed `ArticleMarkdownResponse`) |
| `backend/pyproject.toml` | deps | Add `nh3` |
| `package.json` | deps | Add `react-markdown` + `remark-gfm` + `rehype-sanitize` |
| `frontend/pdf-viewer/core/citation.ts` | anchor types | Add `MarkdownCitationAnchor` to `CitationAnchor` union + `MarkdownRange` |
| `frontend/hooks/extraction/useArticleMarkdown.ts` | data | New: typed fetch of `GET …/markdown` (mirrors `useArticleTextBlocks`) |
| `frontend/lib/query-keys/articles.ts` | keys | Add `markdown(articleFileId)` |
| `frontend/pdf-viewer/primitives/Reader.tsx` | viewer | Render sanitized markdown via `react-markdown` (retire flat per-block dump) |
| `frontend/pdf-viewer/PrumoPdfViewer.tsx` | viewer | Accept `readerMarkdown` + `readerLoading`; pass to `Reader`; highlight the markdown range |
| `frontend/components/extraction/ExtractionPDFPanel.tsx` | wiring | Fetch markdown + thread `readerMarkdown` |
| `frontend/pages/QualityAssessmentFullScreen.tsx` | wiring | Fetch markdown + thread `readerMarkdown` |
| `frontend/hooks/extraction/useCitationHighlight.ts` | highlight | Handle `markdown` kind: drive the markdown-range highlight + canvas overlay via `rect` |
| `frontend/lib/copy/extraction.ts` | copy | Markdown-view copy keys |
| `docs/adr/0013-dual-tier-markdown-representation.md` | docs | Note: §"Highlight limitation" refined — markdown now carries a char-range anchor |

---

## Phase 1 — `render_blocks_to_markdown` + source-map

### Task 1.1: `SourceSpan` + `render_blocks_to_markdown` (pure renderer)

**Files:**
- Modify: `backend/app/infrastructure/parsing/base.py`
- Modify: `backend/app/services/extraction_block_assembler.py` (export the table renderer)
- Test: `backend/tests/unit/test_render_blocks_to_markdown.py`

**Interfaces:**
- Consumes: `ParsedBlock`, `concat_page_text`, `assign_char_offsets_to_blocks`
  (already in `base.py`); `_render_table(cell_texts: list[str]) -> str` from
  `extraction_block_assembler.py`.
- Produces:
  ```python
  @dataclass(frozen=True)
  class SourceSpan:
      md_start: int        # inclusive offset into the markdown string
      md_end: int          # exclusive
      page_number: int     # 1-indexed
      block_index: int     # 0-indexed reading-order position on the page
      char_start: int      # offset into concat_page_text[page] (block coord space)
      char_end: int
      bbox: dict[str, float]  # {"x","y","width","height"} PDF user space

  def render_blocks_to_markdown(
      blocks: Sequence[_Block],
  ) -> tuple[str, list[SourceSpan]]: ...
  ```
  A `SourceSpan` is emitted for every verbatim **prose** block (its text copied
  into the markdown unchanged) and for every **table cell** text run. Markdown
  syntax bytes (`## `, the `\n`, the pipe table scaffolding, list `- `) belong to
  NO span. Invariant: for every span `s`, `markdown[s.md_start:s.md_end]` equals
  the block's own text (a prose block) or the cell text (a `table_cell`).

- [ ] **Step 1: Make the table renderer reusable.** In
  `extraction_block_assembler.py`, expose the existing private `_render_table`
  for import (keep its behaviour byte-identical — it is the ONE table codepath
  per ADR 0013 §Decision Outcome). Add at module top, after `_render_table` is
  defined:

  ```python
  # Public alias so render_blocks_to_markdown and the assembler share ONE
  # table-serialization codepath (ADR 0013: prompt tables == viewer tables).
  render_table = _render_table
  ```

- [ ] **Step 2: Write the failing unit test.**

  ```python
  # backend/tests/unit/test_render_blocks_to_markdown.py
  from app.infrastructure.parsing.base import (
      ParsedBlock,
      SourceSpan,
      render_blocks_to_markdown,
  )


  def _block(page, idx, text, btype, bbox=None):
      return ParsedBlock(
          page_number=page, block_index=idx, text=text,
          char_start=0, char_end=0,
          bbox=bbox or {"x": 1.0, "y": 2.0, "width": 3.0, "height": 4.0},
          block_type=btype,
      )


  def test_markdown_headings_lists_and_reading_order():
      blocks = [
          _block(1, 0, "Methods", "heading"),
          _block(1, 1, "We enrolled 200 patients.", "paragraph"),
          _block(1, 2, "Primary endpoint", "list_item"),
      ]
      md, _ = render_blocks_to_markdown(blocks)
      assert "## Methods" in md
      assert "We enrolled 200 patients." in md
      assert "- Primary endpoint" in md
      # reading order preserved
      assert md.index("Methods") < md.index("200 patients") < md.index("Primary endpoint")


  def test_table_cells_reuse_render_table():
      from app.services.extraction_block_assembler import render_table
      cells = [_block(1, i, t, "table_cell") for i, t in enumerate(
          ["Arm", "N", "Drug", "100"])]
      md, _ = render_blocks_to_markdown(cells)
      assert render_table(["Arm", "N", "Drug", "100"]) in md


  def test_source_span_invariant_prose_equals_substring():
      blocks = [
          _block(1, 0, "Background", "heading"),
          _block(1, 1, "The trial ran for 12 weeks.", "paragraph"),
      ]
      md, spans = render_blocks_to_markdown(blocks)
      prose = [s for s in spans if md[s.md_start:s.md_end] == "The trial ran for 12 weeks."]
      assert len(prose) == 1
      s = prose[0]
      assert s.page_number == 1 and s.block_index == 1
      assert s.bbox == {"x": 1.0, "y": 2.0, "width": 3.0, "height": 4.0}
      # the heading text is NOT a prose span (it is markdown syntax `## Background`)
      assert all(md[sp.md_start:sp.md_end] != "Background" for sp in spans)


  def test_markdown_syntax_bytes_covered_by_no_span():
      blocks = [_block(1, 0, "Results", "heading"),
                _block(1, 1, "p < 0.05", "paragraph")]
      md, spans = render_blocks_to_markdown(blocks)
      # every "## " marker offset is outside every span
      marker = md.index("## ")
      for off in range(marker, marker + 3):
          assert all(not (s.md_start <= off < s.md_end) for s in spans)


  def test_empty_blocks_returns_empty():
      assert render_blocks_to_markdown([]) == ("", [])
  ```

- [ ] **Step 3: Run → fails.**
  `cd backend && uv run pytest tests/unit/test_render_blocks_to_markdown.py -v`
  Expected: FAIL with `ImportError: cannot import name 'SourceSpan'` /
  `render_blocks_to_markdown`.

- [ ] **Step 4: Implement** in `base.py`. Sort into reading order
  (`page_number` asc, `block_index` asc); build local `ParsedBlock` copies and
  call `assign_char_offsets_to_blocks` on the copies (NEVER mutate ORM inputs —
  same pattern as `assemble`), then `concat_page_text` for the canonical
  per-page surface. Walk blocks: a `heading` emits `## {text}\n` (no span — it is
  syntax); a `list_item` emits `- {text}\n` and records a `SourceSpan` over the
  `{text}` substring only; a `paragraph`/`figure_caption`/`header`/`footer` emits
  the prose sourced from `page_texts[page][cs:ce]` and records a `SourceSpan` over
  it; a contiguous `table_cell` run on one page is rendered with
  `render_table(run_texts)` and records one `SourceSpan` per cell over each cell's
  literal text within the rendered table (find each cell text once, left-to-right,
  via a forward cursor so repeated values map to distinct positions). Track a
  running `md_len` cursor as each part is appended so `md_start`/`md_end` are
  absolute markdown offsets. Join parts with `\n` between blocks and `\n\n`
  between sections; compute span offsets against the FINAL joined string (append
  to a list, track cumulative length). Return `(markdown, spans)`.

- [ ] **Step 5: Run → passes.**
  `cd backend && uv run pytest tests/unit/test_render_blocks_to_markdown.py -v` →
  PASS.

- [ ] **Step 6: Commit.**
  ```bash
  git add backend/app/infrastructure/parsing/base.py \
          backend/app/services/extraction_block_assembler.py \
          backend/tests/unit/test_render_blocks_to_markdown.py
  git commit -m "feat(parsing): render_blocks_to_markdown + source-map (reuse render_table)"
  ```

---

## Phase 2 — markdown-anchored citation schema + anchorer

### Task 2.1: `MarkdownCitationAnchor` schema (backend + frontend mirror)

**Files:**
- Modify: `backend/app/schemas/extraction.py`
- Modify: `frontend/pdf-viewer/core/citation.ts`
- Modify: `backend/app/llm/validators.py`
- Test: `backend/tests/unit/test_markdown_citation_anchor.py`

**Interfaces:**
- Produces (backend, `extraction.py`):
  ```python
  class MarkdownRange(BaseModel):
      start: int = Field(..., ge=0)
      end: int = Field(..., ge=0)
      model_config = ConfigDict(populate_by_name=True)

      @model_validator(mode="after")
      def _range_valid(self) -> "MarkdownRange":
          if self.end < self.start:
              raise ValueError("end must be >= start")
          return self

  class MarkdownCitationAnchor(BaseModel):
      kind: Literal["markdown"]
      range: MarkdownRange                  # offsets into the markdown projection
      quote: str
      page: int | None = Field(default=None, ge=1)   # PDF page (projection)
      rect: PDFRect | None = None                     # PDF bbox (projection)
      model_config = ConfigDict(populate_by_name=True)
  ```
  `CitationAnchor = Annotated[TextCitationAnchor | RegionCitationAnchor |
  HybridCitationAnchor | MarkdownCitationAnchor, Field(discriminator="kind")]`.
- Produces (frontend, `citation.ts`):
  ```ts
  export interface MarkdownRange { start: number; end: number; }
  export interface MarkdownCitationAnchor {
    kind: 'markdown';
    range: MarkdownRange;
    quote: string;
    /** 1-indexed PDF page (projection), when block bbox is available. */
    page?: number;
    /** PDF bbox (projection), when available. */
    rect?: PDFRect;
  }
  ```
  added to the `CitationAnchor` union.

- [ ] **Step 1: Write the failing unit test.**

  ```python
  # backend/tests/unit/test_markdown_citation_anchor.py
  from app.schemas.extraction import (
      MarkdownCitationAnchor, MarkdownRange, PDFRect, PositionV1, parse_position,
  )


  def test_markdown_anchor_round_trips_camel_case():
      pos = PositionV1(
          version=1,
          anchor=MarkdownCitationAnchor(
              kind="markdown",
              range=MarkdownRange(start=10, end=42),
              quote="200 patients",
              page=3,
              rect=PDFRect(x=1.0, y=2.0, width=3.0, height=4.0),
          ),
      )
      raw = pos.model_dump(by_alias=True, mode="json")
      assert raw["anchor"]["kind"] == "markdown"
      assert raw["anchor"]["range"] == {"start": 10, "end": 42}
      back = parse_position(raw)
      assert back is not None and back.anchor.kind == "markdown"
      assert back.anchor.range.end == 42


  def test_markdown_anchor_rect_optional():
      pos = PositionV1(
          version=1,
          anchor=MarkdownCitationAnchor(
              kind="markdown", range=MarkdownRange(start=0, end=5), quote="hello"),
      )
      assert parse_position(pos.model_dump(by_alias=True, mode="json")) is not None


  def test_range_end_before_start_rejected():
      import pytest
      from pydantic import ValidationError
      with pytest.raises(ValidationError):
          MarkdownRange(start=5, end=2)
  ```

- [ ] **Step 2: Run → fails.**
  `cd backend && uv run pytest tests/unit/test_markdown_citation_anchor.py -v`
  Expected: FAIL `cannot import name 'MarkdownCitationAnchor'`.

- [ ] **Step 3: Implement** the `MarkdownRange` + `MarkdownCitationAnchor` models
  in `extraction.py` (just before the `CitationAnchor` union) and add the variant
  to the union. Teach `validators.py`: widen `anchor_kind`'s return type to
  `Literal["text", "region", "hybrid", "markdown"] | None` (it already reads
  `parsed.anchor.kind`, so the only change is the type annotation);
  `evidence_is_grounded` needs no change (any valid `PositionV1` is grounded).
  Mirror the types in `citation.ts`.

- [ ] **Step 4: Run → passes.**
  `cd backend && uv run pytest tests/unit/test_markdown_citation_anchor.py -v` →
  PASS, then `npm run typecheck`.

- [ ] **Step 5: Regenerate API types** (the schema is reachable from the citations
  endpoint payload):
  ```bash
  npm run generate:api-types
  ```
  Commit the `frontend/types/api/` diff with the change.

- [ ] **Step 6: Commit.**
  ```bash
  git add backend/app/schemas/extraction.py backend/app/llm/validators.py \
          frontend/pdf-viewer/core/citation.ts frontend/types/api/ \
          backend/tests/unit/test_markdown_citation_anchor.py
  git commit -m "feat(extraction): MarkdownCitationAnchor schema (backend + FE mirror)"
  ```

### Task 2.2: markdown anchorer (`match_in_markdown` + `build_markdown_anchor`)

**Files:**
- Modify: `backend/app/services/evidence_anchor_service.py`
- Test: `backend/tests/unit/test_markdown_anchorer.py`

**Interfaces:**
- Consumes: `SourceSpan` + `render_blocks_to_markdown` (Task 1.1);
  `MarkdownCitationAnchor`, `MarkdownRange`, `PDFRect`, `PositionV1` (Task 2.1);
  the existing `_normalize`, `_normalize_with_index_map`, `_resolve_original_span`,
  `_bbox_union` in this module.
- Produces:
  ```python
  @dataclass(frozen=True)
  class MarkdownAnchorMatch:
      md_start: int          # offset into the markdown
      md_end: int
      page: int | None       # resolved from overlapping source spans (None if none)
      rect: dict[str, float] | None   # bbox union over overlapping spans, or None

  def match_in_markdown(
      quote: str,
      markdown: str,
      source_map: Sequence[SourceSpan],
      *,
      fuzz_threshold: float = DEFAULT_FUZZ_THRESHOLD,
  ) -> MarkdownAnchorMatch | None: ...

  def build_markdown_anchor(
      quote: str,
      markdown: str,
      source_map: Sequence[SourceSpan],
      *,
      fuzz_threshold: float = DEFAULT_FUZZ_THRESHOLD,
  ) -> PositionV1 | None: ...
  ```

- [ ] **Step 1: Write the failing unit test.**

  ```python
  # backend/tests/unit/test_markdown_anchorer.py
  from app.infrastructure.parsing.base import ParsedBlock, render_blocks_to_markdown
  from app.services.evidence_anchor_service import (
      build_markdown_anchor, match_in_markdown,
  )


  def _block(page, idx, text, btype, bbox=None):
      return ParsedBlock(
          page_number=page, block_index=idx, text=text, char_start=0, char_end=0,
          bbox=bbox or {"x": 10.0, "y": 20.0, "width": 30.0, "height": 5.0},
          block_type=btype,
      )


  def test_prose_quote_anchors_to_markdown_range_and_bbox():
      blocks = [
          _block(1, 0, "Methods", "heading"),
          _block(1, 1, "We enrolled 200 patients over 12 weeks.", "paragraph"),
      ]
      md, smap = render_blocks_to_markdown(blocks)
      m = match_in_markdown("enrolled 200 patients", md, smap)
      assert m is not None
      assert md[m.md_start:m.md_end] == "enrolled 200 patients"
      assert m.page == 1
      assert m.rect == {"x": 10.0, "y": 20.0, "width": 30.0, "height": 5.0}


  def test_table_cell_quote_anchors_with_bbox():
      cells = [
          _block(1, 0, "Arm", "table_cell", {"x": 0.0, "y": 0.0, "width": 5.0, "height": 2.0}),
          _block(1, 1, "200", "table_cell", {"x": 5.0, "y": 0.0, "width": 5.0, "height": 2.0}),
      ]
      md, smap = render_blocks_to_markdown(cells)
      m = match_in_markdown("200", md, smap)
      assert m is not None and m.rect is not None and m.page == 1


  def test_absent_quote_returns_none():
      blocks = [_block(1, 0, "The sky is blue.", "paragraph")]
      md, smap = render_blocks_to_markdown(blocks)
      assert match_in_markdown("quantum chromodynamics", md, smap) is None


  def test_quote_with_markdown_syntax_does_not_match():
      # A quote that includes table pipe scaffolding is not prose → no span covers it.
      cells = [_block(1, i, t, "table_cell") for i, t in enumerate(["A", "B"])]
      md, smap = render_blocks_to_markdown(cells)
      assert match_in_markdown("| A | B |", md, smap) is None


  def test_build_markdown_anchor_emits_position_v1():
      blocks = [_block(2, 0, "Survival improved by 30%.", "paragraph")]
      md, smap = render_blocks_to_markdown(blocks)
      pos = build_markdown_anchor("Survival improved by 30%", md, smap)
      assert pos is not None and pos.anchor.kind == "markdown"
      assert pos.anchor.quote == "Survival improved by 30%"
      assert pos.anchor.page == 2 and pos.anchor.rect is not None


  def test_build_markdown_anchor_absent_returns_none():
      md, smap = render_blocks_to_markdown([_block(1, 0, "x", "paragraph")])
      assert build_markdown_anchor("not here", md, smap) is None
  ```

- [ ] **Step 2: Run → fails.**
  `cd backend && uv run pytest tests/unit/test_markdown_anchorer.py -v`
  Expected: FAIL `cannot import name 'match_in_markdown'`.

- [ ] **Step 3: Implement.** `match_in_markdown` normalizes the markdown with
  `_normalize_with_index_map` and the quote with `_normalize` (reusing this
  module's helpers), runs `_best_exact` then `_best_fuzzy` (when
  `fuzz_threshold < 1.0`), maps the normalized span back to original markdown
  offsets via `_resolve_original_span`, and returns `None` when no representable
  span exists. Then resolve overlapping `SourceSpan`s: every span `s` with
  `s.md_start < md_end and s.md_end > md_start`. If none overlap (the match landed
  purely on markdown syntax), return `None`. `page` = the page of the
  earliest-overlapping span; `rect` = `_bbox_union` over the overlapping spans'
  `bbox` (build throwaway objects exposing a `.bbox` attr, or inline the union —
  reuse `_bbox_union` by wrapping each span in a tiny `ParsedBlock` with the
  span's bbox). `build_markdown_anchor` calls `match_in_markdown`, returns `None`
  on miss, else `PositionV1(version=1, anchor=MarkdownCitationAnchor(kind="markdown",
  range=MarkdownRange(start=m.md_start, end=m.md_end), quote=quote, page=m.page,
  rect=PDFRect(**m.rect) if m.rect else None))`. Pure — no DB, no IO.

- [ ] **Step 4: Run → passes.**
  `cd backend && uv run pytest tests/unit/test_markdown_anchorer.py -v` → PASS.

- [ ] **Step 5: Commit.**
  ```bash
  git add backend/app/services/evidence_anchor_service.py \
          backend/tests/unit/test_markdown_anchorer.py
  git commit -m "feat(extraction): markdown quote anchorer (range + source-map bbox projection)"
  ```

---

## Phase 3 — AI extraction reads markdown (retire the 15k truncation)

### Task 3.1: `READ_FROM_BLOCKS` flag + markdown budget

**Files:**
- Modify: `backend/app/core/config.py`
- Test: `backend/tests/unit/test_config_read_from_blocks.py`

**Interfaces:**
- Produces: `settings.READ_FROM_BLOCKS: bool` (default `True`) and
  `settings.MARKDOWN_PROMPT_BUDGET_CHARS: int` (default `120_000` — generous; the
  budget exists only to bound a pathological document, the 15k blind cut is gone).

- [ ] **Step 1: Failing test.**
  ```python
  # backend/tests/unit/test_config_read_from_blocks.py
  from app.core.config import settings
  def test_read_from_blocks_defaults_true():
      assert settings.READ_FROM_BLOCKS is True
  def test_markdown_budget_present():
      assert settings.MARKDOWN_PROMPT_BUDGET_CHARS >= 50_000
  ```
- [ ] **Step 2: Run → fails.**
  `cd backend && uv run pytest tests/unit/test_config_read_from_blocks.py -v`.
- [ ] **Step 3: Implement.** Add both fields to the `Settings` class in
  `config.py` under a `# =================== PARSING ===================`
  section (env-overridable, like `OPENAI_*`).
- [ ] **Step 4: Run → passes.** Commit
  `feat(config): READ_FROM_BLOCKS flag + markdown prompt budget`.

### Task 3.2: Source the three prompt sites from markdown + anchor evidence

**Files:**
- Modify: `backend/app/services/section_extraction_service.py`
- Modify: `backend/app/llm/prompts/__init__.py`,
  `backend/app/llm/prompts/section_extraction.py`,
  `backend/app/llm/prompts/quality_assessment.py`,
  `backend/app/llm/prompts/model_identification.py`
- Test: `backend/tests/integration/test_extraction_reads_markdown.py`

**Interfaces:**
- Consumes: `render_blocks_to_markdown` (Task 1.1), `build_markdown_anchor`
  (Task 2.2), `settings.READ_FROM_BLOCKS` / `MARKDOWN_PROMPT_BUDGET_CHARS`
  (Task 3.1), `ArticleTextBlockRepository.list_ordered_for_file`,
  `ArticleFileRepository.get_latest_pdf` (called via `self._article_files`,
  both already used at the position write site, lines 1231-1236).
- Produces: the prompt text is the markdown projection (≤ budget); each
  field's evidence is anchored with `build_markdown_anchor(quote, markdown,
  source_map)` instead of `build_anchor(quote, blocks)`.

- [ ] **Step 1: Write the failing integration test** (`db_session_real`,
  project-scoped fixtures). Seed an `ArticleFile` with blocks whose text contains
  a known value well past 15,000 chars; run the section-extraction path with
  `READ_FROM_BLOCKS=True`; assert (a) the prompt passed to the model contains the
  post-15k value (capture via a fake provider / spy), (b) `MAX_PDF_CHARS` is NOT
  applied (the full markdown, ≤ budget, reaches the prompt), (c) the persisted
  `ExtractionEvidence.position` for a cited value parses to a
  `MarkdownCitationAnchor` via `parse_position` and round-trips camelCase out of
  `citation_read_service.list_article_citations` with `anchorKind == "markdown"`.

  ```python
  # backend/tests/integration/test_extraction_reads_markdown.py (sketch)
  async def test_prompt_sourced_from_markdown_past_15k(db_session_real, seed_project):
      # ... seed blocks: filler paragraphs + a block at offset > 15_000 containing
      #     "SENTINEL_VALUE = 42" ...
      prompt = await _run_and_capture_prompt(...)
      assert "SENTINEL_VALUE = 42" in prompt

  async def test_evidence_persisted_as_markdown_anchor(db_session_real, seed_project):
      citations = await list_article_citations(db_session_real, article_id)
      cited = [c for c in citations if c["anchorKind"] == "markdown"]
      assert cited and cited[0]["anchor"]["range"]["end"] > cited[0]["anchor"]["range"]["start"]
  ```

- [ ] **Step 2: Run → fails.**
  `make test-backend` (or `cd backend && uv run pytest
  tests/integration/test_extraction_reads_markdown.py -v`).

- [ ] **Step 3: Implement.** In `section_extraction_service.py`: fetch the main
  PDF's blocks ONCE per run via `ArticleTextBlockRepository.list_ordered_for_file`
  (the `_anchor_blocks` fetch at line 1234 already does this — hoist it so the
  prompt step and the anchor step share it). When `settings.READ_FROM_BLOCKS` and
  blocks exist: `markdown, source_map = render_blocks_to_markdown(blocks)`;
  truncate `markdown` to `MARKDOWN_PROMPT_BUDGET_CHARS` only as a guard; pass
  `article_text=markdown` to the three render sites (currently `article_text=pdf_text`
  at lines 1081/1091, plus the model-identification and quality-assessment
  renders). At the evidence write site (lines 1290-1311) replace
  `build_anchor(_quote, _anchor_blocks)` with
  `build_markdown_anchor(_quote, markdown, source_map)`; derive `_page_num` from
  `_pos.anchor.page` (now `MarkdownCitationAnchor.page`, may be `None` — fall back
  to `evidence_meta.get("page_number")`). In the three prompt templates
  (`section_extraction.py:42`, `quality_assessment.py:57`,
  `model_identification.py:47`) replace `article_text[:MAX_PDF_CHARS]` with
  `article_text`. Keep `content_version` hashing.

- [ ] **Step 4: Run → passes.** `make test-backend`. Commit
  `feat(extraction): source prompts from markdown projection + markdown-anchored evidence`.

### Task 3.3: Lazy `pypdf` / `MAX_PDF_CHARS` fallback + telemetry, then retire the constant

**Files:**
- Modify: `backend/app/services/section_extraction_service.py`
- Modify: `backend/app/llm/prompts/__init__.py` (remove `MAX_PDF_CHARS`)
- Test: `backend/tests/integration/test_extraction_markdown_fallback.py`

- [ ] **Step 1: Failing test.** With `READ_FROM_BLOCKS=True` but NO blocks for the
  article, extraction falls back to today's `PDFProcessor.extract_text()` path and
  still runs to completion (no exception); a structlog field
  `extraction.text_source = blocks_markdown | pdf_fallback` records which path
  ran. With blocks present it uses markdown.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** the fallback branch: when `not _anchor_blocks`, keep
  `pdf_text = await self.pdf_processor.extract_text(pdf_data)` and source the
  prompt from `pdf_text` (no anchor write — leaves `position={}` as today). Log
  `text_source` + char/block counts on the run. Once the markdown path is the
  default and the fallback no longer references `MAX_PDF_CHARS` (the templates
  stopped slicing in Task 3.2), delete `MAX_PDF_CHARS` from
  `llm/prompts/__init__.py` and grep-assert zero references.
- [ ] **Step 4: Run → passes.** `make test-backend`; `grep -rn MAX_PDF_CHARS
  backend/app` returns nothing. Commit
  `feat(extraction): lazy pypdf fallback + text-source telemetry, retire MAX_PDF_CHARS`.

---

## Phase 4 — markdown API endpoint

### Task 4.1: `article_markdown_read_service` (on-demand render + sanitize)

**Files:**
- Create: `backend/app/services/article_markdown_read_service.py`
- Modify: `backend/pyproject.toml` (add `nh3`)
- Test: `backend/tests/unit/test_article_markdown_read_service.py`

**Interfaces:**
- Consumes: `ArticleTextBlockRepository.list_ordered_for_file`,
  `render_blocks_to_markdown` (Task 1.1), `get_article_file_project_id` (already
  in `article_text_block_read_service.py` — import + reuse, do NOT duplicate).
- Produces:
  ```python
  async def render_article_markdown(db: AsyncSession, article_file_id: UUID) -> str: ...
  ```
  returns the **sanitized** markdown string (nh3 over the rendered markdown,
  allowlist denies `<script>`/`<iframe>`/event-handler attrs/`javascript:` URLs —
  per ADR 0013). Empty string when the file has no blocks (the endpoint surfaces
  that as an empty payload, not a 404 — mirrors the text-blocks `[]` contract).

- [ ] **Step 1: Failing unit test.** Seed in-memory blocks (the service can take a
  fake repo or hit `db_session_real`); assert the returned markdown contains the
  block prose and that an injected `<script>alert(1)</script>` inside block text is
  stripped/escaped by `nh3`.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.** Add `nh3` to `pyproject.toml` (`uv add nh3` from
  `backend/`). The service fetches ordered blocks, calls
  `render_blocks_to_markdown`, runs the markdown through `nh3.clean(...)` with the
  allowlist, returns the cleaned string.
- [ ] **Step 4: Run → passes.** Commit
  `feat(extraction): article markdown read service (on-demand render + nh3 sanitize)`.

### Task 4.2: `GET /api/v1/article-files/{id}/markdown` endpoint

**Files:**
- Modify: `backend/app/api/v1/endpoints/article_text_blocks.py`
- Modify: `backend/app/schemas/extraction.py` (or a small response schema module)
- Test: `backend/tests/integration/test_article_markdown_endpoint.py`

**Interfaces:**
- Produces: typed `ArticleMarkdownResponse(BaseModel)` with
  `markdown: str` (+ `articleFileId: UUID` alias). Endpoint returns
  `ApiResponse[ArticleMarkdownResponse]`.

- [ ] **Step 1: Failing integration test.** A project member gets `200` with the
  rendered markdown; a **non-member gets `403`** (BOLA); a missing article file
  gets `404`; an article file with no blocks gets `200` with `markdown == ""`.

  ```python
  # backend/tests/integration/test_article_markdown_endpoint.py (sketch)
  async def test_member_gets_markdown(client, member_token, seeded_article_file):
      r = await client.get(f"/api/v1/article-files/{seeded_article_file}/markdown",
                           headers={"Authorization": f"Bearer {member_token}"})
      assert r.status_code == 200
      assert "## " in r.json()["data"]["markdown"] or r.json()["data"]["markdown"] == ""

  async def test_non_member_forbidden(client, outsider_token, seeded_article_file):
      r = await client.get(f"/api/v1/article-files/{seeded_article_file}/markdown",
                           headers={"Authorization": f"Bearer {outsider_token}"})
      assert r.status_code == 403
  ```

- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** the route mirroring `list_article_text_blocks` (lines
  33-50): resolve `project_id` via `get_article_file_project_id`, **call
  `ensure_project_member(db, project_id, current_user_sub)` first**, then
  `render_article_markdown(db, article_file_id)`, return
  `ApiResponse.success(ArticleMarkdownResponse(article_file_id=article_file_id,
  markdown=md), trace_id=_trace(request))`.
- [ ] **Step 4: Run → passes.** `make test-backend`.
- [ ] **Step 5: Regenerate API types.** `npm run generate:api-types`; commit the
  `frontend/types/api/` diff. Commit
  `feat(api): GET article-files/{id}/markdown (free tier, BOLA-safe, typed)`.

---

## Phase 5 — Reader → markdown view

### Task 5.1: Frontend markdown deps + `useArticleMarkdown` hook

**Files:**
- Modify: `package.json`
- Create: `frontend/hooks/extraction/useArticleMarkdown.ts`
- Modify: `frontend/lib/query-keys/articles.ts`
- Test: `frontend/hooks/extraction/__tests__/useArticleMarkdown.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function useArticleMarkdown(
    articleFileId: string | null | undefined,
  ): UseQueryResult<string>;   // returns the markdown string ('' when no blocks)
  ```
  query key from `articleKeys.markdown(articleFileId)`.

- [ ] **Step 1: Add deps.** From the **repo root** (never `cd frontend`):
  ```bash
  npm install react-markdown remark-gfm rehype-sanitize
  ```
- [ ] **Step 2: Add the key factory entry** to
  `frontend/lib/query-keys/articles.ts`:
  ```ts
  markdown: (articleFileId: string) =>
    [...articleKeys.all, 'markdown', articleFileId] as const,
  ```
- [ ] **Step 3: Write the failing hook test** (MSW v2): mock
  `GET /api/v1/article-files/:id/markdown` → `{data:{markdown:'## Hi\n\nbody'}}`;
  assert the hook resolves to `'## Hi\n\nbody'`; assert it is disabled
  (`enabled:false`) when `articleFileId` is null.
- [ ] **Step 4: Run → fails.** `npm run test:run -- useArticleMarkdown`.
- [ ] **Step 5: Implement** the hook mirroring `useArticleTextBlocks` (typed
  `apiClient<ArticleMarkdownResponse>` against the generated schema; return
  `res.markdown ?? ''`).
- [ ] **Step 6: Run → passes** + `npm run typecheck`. Commit
  `feat(extraction): useArticleMarkdown hook + markdown query key + deps`.

### Task 5.2: Repoint `Reader.tsx` to render sanitized markdown

**Files:**
- Modify: `frontend/pdf-viewer/primitives/Reader.tsx`
- Modify: `frontend/pdf-viewer/PrumoPdfViewer.tsx`
- Test: `frontend/pdf-viewer/primitives/__tests__/Reader.test.tsx`

**Interfaces:**
- Produces: `Reader` accepts `markdown: string` (+ `loading`, `emptyState`,
  `className`); renders via `react-markdown` with `remarkPlugins={[remarkGfm]}`
  and `rehypePlugins={[[rehypeSanitize, schema]]}` (strict allowlist — extend
  `defaultSchema` to keep GFM table tags, deny everything else). The old
  `blocks: ReaderTextBlock[]` prop is **removed** (flat per-block dump retired).
- `PrumoPdfViewer` gains `readerMarkdown?: string` + keeps `readerLoading?`,
  drops `readerBlocks`; `ViewerContent` renders `<Reader markdown={readerMarkdown
  ?? ''} loading={readerLoading} />` when `mode === 'reader'`.

- [ ] **Step 1: Write the failing component test.**
  ```tsx
  // renders GFM
  render(<Reader markdown={'## Title\n\n- one\n- two'} />);
  expect(screen.getByRole('heading', {name: 'Title'})).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  // XSS: raw HTML / event handlers do NOT execute or render as live nodes
  render(<Reader markdown={'<img src=x onerror="alert(1)">'} />);
  expect(document.querySelector('img[onerror]')).toBeNull();
  ```
- [ ] **Step 2: Run → fails.** `npm run test:run -- Reader`.
- [ ] **Step 3: Implement** the markdown render (define the sanitize schema in a
  small `frontend/pdf-viewer/primitives/markdownSanitizeSchema.ts`: clone
  `rehype-sanitize`'s `defaultSchema`, allow `table/thead/tbody/tr/th/td`,
  `h1-h6`, `ul/ol/li`, `p`, `strong/em/code/pre`, deny `script/iframe/object`,
  strip all `on*` attrs and `javascript:`/`data:` hrefs). Wrap in a
  `prose prose-sm` (`@tailwindcss/typography`, already installed) container. Update
  `PrumoPdfViewer` prop wiring. NO `try/finally` in the component body.
- [ ] **Step 4: Run → passes** + `npm run typecheck`. Commit
  `feat(pdf-viewer): reader mode renders sanitized markdown (retire flat block dump)`.

### Task 5.3: Wire markdown into `ExtractionPDFPanel` + `QualityAssessmentFullScreen`

**Files:**
- Modify: `frontend/components/extraction/ExtractionPDFPanel.tsx`
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx`
- Test: extend each page's existing component test (or add one) under their
  `__tests__/` dirs.

**Interfaces:**
- Consumes: `useArticleMarkdown` (Task 5.1); both pages already resolve an
  `articleId`. They must resolve the **main PDF article-file id** to fetch
  markdown — reuse whatever id they already pass to `articleFileSource(articleId)`
  for the viewer source (today neither passes `readerBlocks`; this adds
  `readerMarkdown`).

- [ ] **Step 1: Failing component test** (MSW): rendering `ExtractionPDFPanel` and
  toggling the viewer to reader mode shows the markdown from the mocked endpoint;
  same for `QualityAssessmentFullScreen`.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.** In `ExtractionPDFPanel` (currently line 46:
  `<PrumoPdfViewer source={source} store={store} className="h-full" />`) call
  `const {data: md, isLoading} = useArticleMarkdown(articleFileId)` and pass
  `readerMarkdown={md ?? ''} readerLoading={isLoading}`. Same in
  `QualityAssessmentFullScreen` at the `<PrumoPdfViewer …>` site (line 612). No
  `supabase.from`, no `fetch` — `useArticleMarkdown` owns the call.
- [ ] **Step 4: Run → passes** + `npm run typecheck`. Commit
  `feat(extraction): wire markdown reader view into extraction + QA viewers`.

---

## Phase 6 — highlight in both surfaces

### Task 6.1: highlight the markdown range in the rendered markdown

**Files:**
- Modify: `frontend/pdf-viewer/primitives/Reader.tsx`
- Modify: `frontend/pdf-viewer/PrumoPdfViewer.tsx`
- Modify: `frontend/lib/copy/extraction.ts`
- Test: `frontend/pdf-viewer/primitives/__tests__/Reader.highlight.test.tsx`

**Interfaces:**
- Consumes: the active `MarkdownCitationAnchor` (its `range:{start,end}` are
  markdown offsets); the viewer store's active-citation state (already populated
  by `useCitationHighlight`).
- Produces: `Reader` accepts an optional `highlightRange?: {start: number; end:
  number}`; when present, it wraps the substring `markdown[start:end]` in a
  `<mark data-citation-highlight>` and scrolls it into view. Because the markdown
  is rendered through `react-markdown` (offsets are into the *source* string, not
  the DOM), apply the highlight by **splitting the markdown source** at
  `[start,end)` into three `react-markdown` segments OR (simpler, preferred) by
  passing a `rehype`/`remark` step is overkill — instead highlight on the rendered
  output by matching the `quote` text node and wrapping it (the quote is a
  verbatim prose substring per Phase 1). Use the `quote` from the anchor, find the
  first matching text node under the reader root, wrap it in `<mark>`, and
  `scrollIntoView`. No `try/finally`.

- [ ] **Step 1: Failing component test.** Render `Reader` with `markdown` +
  `highlightQuote="200 patients"`; assert a `<mark data-citation-highlight>`
  contains `200 patients` and `scrollIntoView` was called.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** the quote-wrap + scroll in `Reader` (a `useEffect`
  over a ref to the reader root; allowed under `all_errors` — no try/finally);
  thread the active anchor's `quote` from `PrumoPdfViewer` (read the active
  citation from the store) into `Reader` as `highlightQuote`. Add copy keys
  (`markdownHighlightLabel`) to `frontend/lib/copy/extraction.ts`.
- [ ] **Step 4: Run → passes** + `npm run typecheck`. Commit
  `feat(pdf-viewer): highlight cited quote in the markdown reader view`.

### Task 6.2: project the markdown citation onto the canvas + reader↔canvas sync + a11y

**Files:**
- Modify: `frontend/hooks/extraction/useCitationHighlight.ts`
- Modify: `frontend/pdf-viewer/primitives/CitationOverlay.tsx`
- Test: `frontend/hooks/extraction/__tests__/useCitationHighlight.markdown.test.tsx`

**Interfaces:**
- Consumes: `MarkdownCitationAnchor` with optional `page` + `rect`.
- Produces: `useCitationHighlight().highlight(anchor)` handles `kind ===
  'markdown'`: when `rect` + `page` are present it sets the overlay rect (canvas
  mode) and `goToPage(page)` exactly like a `region`/`hybrid` anchor (project via
  `projectPdfRectToCss`); it always drives the markdown-view highlight (reader
  mode) via the `quote`. When `rect`/`page` are absent (self-hosted parser with no
  bbox) the canvas overlay is skipped but the reader highlight + a best-effort
  text-layer search on `quote` still run.

- [ ] **Step 1: Failing test** (vitest + stubbed `usePageHandle`/viewport): a
  `markdown` anchor with `rect`+`page` yields a projected `activeHighlight` rect
  in canvas mode; the same anchor with no `rect` yields `activeHighlight === null`
  but still calls `setSearchMatches` with the quote; toggling `mode` to `reader`
  drops the overlay rect (parity with existing behaviour).
- [ ] **Step 2: Run → fails.** `npm run test:run -- useCitationHighlight`.
- [ ] **Step 3: Implement.** In `useCitationHighlightInner`, treat `kind ===
  'markdown'` with a `rect`/`page` like region/hybrid (return the projected rect
  in canvas mode). In `highlight`, for `kind === 'markdown'` push the anchor into
  the store (`addCitation`/`setActiveCitation`) so `CitationOverlay` and the
  `Reader` highlight both see it, and call `setSearchMatches` with the `quote` for
  the text-layer fallback. `CitationOverlay` already renders region/hybrid rects;
  extend its `isRegionOrHybrid` derivation to also accept a `markdown` anchor that
  carries a `rect` (read `anchor.page` for `markdown`). Reuse the existing
  `CitationLiveRegion` for the aria-live announcement (it already announces jumps
  in both modes — `PrumoPdfViewer.tsx:81`). No `try/finally`.
- [ ] **Step 4: Run → passes** + `npm run typecheck`. Commit
  `feat(pdf-viewer): project markdown citation onto canvas + reader/canvas sync + a11y`.

### Task 6.3: design-review + axe

- [ ] **Step 1:** Run the `design-review` loop (`/design-review` on the extraction
  + QA routes) on the markdown reader + dual-surface highlight — render,
  screenshot, compare to the Plane/Linear target, fix, re-screenshot. No "done"
  claim without it.
- [ ] **Step 2:** Add an `axe` assertion over the rendered markdown surface (no
  new violations) in the `Reader` test. Commit
  `test(pdf-viewer): axe over markdown reader + design-review pass`.

---

## Phase 7 — no-legacy cleanup + `/simplify`

### Task 7.1: confirm-dead gate + remove the retired surfaces

**Files:** `backend/app/services/section_extraction_service.py`,
`frontend/pdf-viewer/primitives/Reader.tsx`, `scripts/fitness/` (an assertion)

- [ ] **Step 1: Grep/fitness-assert** zero references remain to `MAX_PDF_CHARS`
  (Task 3.3 removed it) and zero callers pass `readerBlocks`/`ReaderTextBlock` as
  a render target (Task 5.2 retired the flat dump — `useArticleTextBlocks` may
  still feed the anchor substrate elsewhere, so only the *Reader render path* is
  retired; do NOT delete the hook if other consumers exist — grep first). Add a
  one-line fitness check so `MAX_PDF_CHARS` cannot silently return.
- [ ] **Step 2:** Confirm this plan added **no Alembic migration** (free tier is
  on-demand). If a migration snuck in, STOP — the enriched-tier column is out of
  scope. Commit `test(arch): fitness gate for retired 15k truncation + flat reader dump`.

### Task 7.2: `/simplify` pass over the changed code

- [ ] **Step 1:** Run the `simplify` skill over the changed backend
  (`render_blocks_to_markdown`, the markdown anchorer, the markdown read service +
  endpoint, the extraction prompt-sourcing) and frontend (`Reader`,
  `useArticleMarkdown`, `useCitationHighlight`, the two page wirings). Apply the
  reuse/simplification/altitude fixes it surfaces (e.g. fold any duplicated
  normalize/union logic into the existing helpers; DRY the markdown sanitize
  schema). Re-run `make test-backend` + `npm run test:run` + `npm run typecheck`.
- [ ] **Step 2:** Update ADR 0013: add one line under §"Highlight limitation"
  noting this plan **refines** it — markdown now carries a `MarkdownCitationAnchor`
  char-range (primary highlight), with the source-map projecting to canvas bbox
  (secondary); bump `last_reviewed`. Commit
  `refactor(extraction): /simplify pass + ADR-0013 highlight-limitation refinement`.

---

## Registration (controller handles it — mention)

- Add this plan's path
  (`docs/superpowers/plans/2026-06-20-markdown-view-and-markdown-citations.md`) to
  `.markdownlintignore` (one entry, single source per docs-ci).
- Add new terms to `.github/cspell-words.txt`: `markdown`, `Markdown`, `GFM`,
  `rehype`, `remark`, `sanitize`, `nh3`, `pymupdf`.

---

## Self-Review

- **Spec coverage:**
  - *Markdown-primary + PDF projection citation surface* → Tasks 2.1 (`MarkdownCitationAnchor`),
    2.2 (`match_in_markdown`/`build_markdown_anchor` returning markdown range +
    source-map bbox), 3.2 (persist).
  - *Source-map during rendering* → Task 1.1 (`SourceSpan` +
    `render_blocks_to_markdown`, invariant tests, syntax-bytes-in-no-span test).
  - *Free tier, on-demand, reuse `_render_table`* → Task 1.1 (`render_table`
    alias) + Task 4.1 (on-demand render, no stored column).
  - *Retire the 15k truncation* → Tasks 3.2 (source from markdown) + 3.3 (remove
    `MAX_PDF_CHARS`, lazy `pypdf` fallback under `READ_FROM_BLOCKS`).
  - *Markdown-anchored schema learned by `parse_position` + FE `citation.ts`* →
    Task 2.1.
  - *Markdown API endpoint, BOLA-safe, typed, sanitized* → Tasks 4.1 (`nh3`) +
    4.2 (`ensure_project_member`, typed `ArticleMarkdownResponse`, 403 test).
  - *Reader → markdown view, deps, XSS test* → Tasks 5.1–5.3.
  - *Highlight in both surfaces + sync + a11y* → Tasks 6.1–6.3 (reusing
    `useCitationHighlight`, `CitationOverlay`, `CitationLiveRegion`).
  - *No legacy + `/simplify`* → Tasks 7.1–7.2.
- **Reuse:** writes the existing `PositionV1` contract (adds one variant);
  reuses `concat_page_text` + `assign_char_offsets_to_blocks` + `_render_table` +
  `_normalize`/`_normalize_with_index_map`/`_resolve_original_span`/`_bbox_union`;
  reuses `get_article_file_project_id`, the `article_text_blocks.py` endpoint
  module, `ArticleTextBlockRepository.list_ordered_for_file`,
  `ArticleRepository.get_latest_pdf`; the FE reuses `useCitationHighlight`,
  `CitationOverlay`, `CitationLiveRegion`, `@tailwindcss/typography`, the
  `articleKeys` factory. No new schema column → **no Alembic migration**.
- **Type consistency:** `SourceSpan` (Task 1.1) is consumed unchanged by
  `match_in_markdown`/`build_markdown_anchor` (Task 2.2). `MarkdownRange{start,
  end}` + `MarkdownCitationAnchor{kind,range,quote,page?,rect?}` are identical in
  `extraction.py` (Task 2.1) and `citation.ts` (Task 2.1) and consumed unchanged
  by the FE highlight (Tasks 6.1–6.2). `render_blocks_to_markdown(blocks) ->
  (str, list[SourceSpan])` has the same signature at every call site (Tasks 3.2,
  4.1). `ArticleMarkdownResponse{markdown, articleFileId}` is produced in Task 4.2
  and consumed by `useArticleMarkdown` (Task 5.1).
- **Placeholder scan:** no TBD/TODO; every code step carries real symbol names
  taken from the current `dev` checkout. The one judgment call left to the
  implementer (how the markdown-view highlight wraps the DOM node — source-split
  vs quote-text-node-wrap) is resolved in Task 6.1 to the quote-text-node-wrap
  approach with the rationale (the quote is a verbatim prose substring by Phase 1
  invariant).
- **Open questions for the human:**
  1. **Reader-blocks substrate.** Task 5.2 retires the flat per-block *render*
     but `useArticleTextBlocks` may still feed citation anchoring elsewhere —
     Task 7.1 greps before deleting. If product wants the reader to keep a
     plain-text fallback when markdown fails to load, say so (the plan currently
     renders the EmptyState).
  2. **Page on markdown anchor.** `MarkdownCitationAnchor.page` comes from the
     earliest overlapping source span; for a multi-page prose run this is the
     first page only. Acceptable for highlight (we scroll there); confirm that is
     the desired behaviour vs storing all spanned pages.
