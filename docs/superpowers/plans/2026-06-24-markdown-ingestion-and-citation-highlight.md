# Stored-markdown ingestion + deterministic citation highlight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse each PDF once into stored blocks + stored markdown, feed that stored markdown directly into the AI prompt, run a simple PyMuPDF parse only when never parsed (persisting it), and make the reader highlight deterministic via persisted block indices — removing the pypdf/dead-column/orphan legacy.

**Architecture:** `article_text_blocks` stays the offset/bbox substrate. A new `article_files.content_markdown` (+ `content_version`) stores the block-projection markdown, written atomically with the blocks in `DocumentParsingService`. A new `PymupdfParser` (base PyMuPDF `fitz`) becomes the free default parser and the only synchronous on-demand parser. `build_prompt_input` reads the stored markdown directly (budget-aware fallback to the section assembler). Evidence anchors persist the matched `block_index` list; the reader locates by `(page, block_index)` first, quote-match second.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0 async, Alembic, pytest (real local Supabase); React 19 + TS strict, TanStack Query, Zustand, vitest, Playwright. New backend dep: `pymupdf` (`fitz`).

## Global Constraints

- English only for code, comments, commits, docs, copy keys.
- Backend layering (CI-enforced): `api → services → repositories → models`; repositories `flush()` never `commit()`; services never commit except the worker/endpoint owners that already do.
- App schema = Alembic only; revision id ≤ 32 chars; any `extraction_*`/article migration bumps the migration-head line + `last_reviewed` in `docs/reference/extraction-hitl-architecture.md`.
- API responses use the `ApiResponse` envelope; errors expose `error.message`. Typed Pydantic response models — never `ApiResponse[dict[str, Any]]`.
- Every project-scoped endpoint checks project membership (BOLA).
- Frontend data path `component → hook → service(apiClient) → backend`; no new `supabase.from(` / `import.meta.env.VITE_API_URL` outside the integration layer (CI-enforced); services return `ErrorResult<T>`, never throw/toast; no `try/finally` in component/hook bodies (React Compiler `panicThreshold: all_errors`).
- All user-facing strings go through `frontend/lib/copy/`.
- After any endpoint/Pydantic change: `npm run generate:api-types` and commit the diff (CI `api-contract`).
- Token budget for AI assembly: `settings.LLM_ASSEMBLY_BUDGET_TOKENS = 96_000`.
- Block-type closed vocabulary (DB CHECK): `paragraph | heading | list_item | table_cell | figure_caption | header | footer`; use `normalize_block_type`.
- Tests run from repo root: backend `make test-backend`; frontend `npm run test:run`; full gate `make quality-scan`. Backend diff-cover ≥ 80% (add endpoint-coroutine unit tests; ASGI integration lines don't register coverage).

---

## File structure

Created:
- `backend/app/infrastructure/parsing/pymupdf_parser.py` — `PymupdfParser(DocumentParser)`.
- `backend/alembic/versions/00NN_article_markdown_columns.py` — additive migration.
- `backend/tests/unit/parsing/test_pymupdf_parser.py`
- `backend/tests/unit/llm/test_prompt_input_source.py`
- `backend/tests/integration/test_on_demand_parse.py`
- `frontend/pdf-viewer/primitives/__tests__/readerLocate.blockindex.test.ts`

Modified (backend): `core/config.py`, `core/factories.py`, `worker/tasks/parsing_tasks.py`, `services/document_parsing_service.py`, `repositories/article_text_block_repository.py` (read of file row), `services/extraction_prompt_input.py`, `llm/assembler.py` (delete `blocks_from_plain_text`), `services/section_extraction_service.py` + `services/model_extraction_service.py` (call-site), `services/evidence_anchor_service.py`, `schemas/extraction.py`, `models/article.py`, delete `services/pdf_processor.py`, delete `services/citation_read_service.py`, `pyproject.toml`.

Modified (frontend): `pdf-viewer/primitives/readerLocate.ts`, `pdf-viewer/primitives/Reader.tsx`, `pdf-viewer/core/store.ts`, `hooks/extraction/useReaderLocate.ts`, the citation-click call site, `services/aiSuggestionService.ts`, evidence type(s); delete unused `projectPdfRectToCss`/`HighlightAnnotation` if dead.

Docs: `docs/adr/0011-*`, `docs/adr/0013-*`, `docs/reference/extraction-hitl-architecture.md`, `docs/reference/observability-extraction.md`, `docs/ROADMAP.md`, `.markdownlintignore` (add this plan path).

---

## Task 1: Data-model migration — add markdown columns, drop dead columns

**Files:**
- Create: `backend/alembic/versions/00NN_article_markdown_columns.py`
- Modify: `backend/app/models/article.py:217-219` (replace `text_raw`/`text_html` with the new columns)
- Modify: `docs/reference/extraction-hitl-architecture.md` (migration-head line + `last_reviewed`)
- Modify: `backend/tests/.../test_migration_roundtrip*` (head-pin + `downgrade -1` parent)

**Interfaces:**
- Produces: `article_files.content_markdown TEXT NULL`, `article_files.content_version INTEGER NOT NULL DEFAULT 0`; `ArticleFile.content_markdown: str | None`, `ArticleFile.content_version: int`.

- [ ] **Step 1: Find the current head and pick a ≤32-char revision id**

Run: `cd backend && uv run alembic heads`
Expected: prints one head, e.g. `0032_optional_rationale (head)`. Use it as `down_revision`. New id: `0033_article_markdown_cols` (27 chars ✓).

- [ ] **Step 2: Write the migration**

Create `backend/alembic/versions/0033_article_markdown_cols.py`:

```python
"""article_files: add content_markdown + content_version; drop dead text_raw/text_html.

Revision ID: 0033_article_markdown_cols
Revises: 0032_optional_rationale
Create Date: 2026-06-24
"""

from alembic import op
import sqlalchemy as sa

revision = "0033_article_markdown_cols"
down_revision = "0032_optional_rationale"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "article_files",
        sa.Column("content_markdown", sa.Text(), nullable=True),
        schema="public",
    )
    op.add_column(
        "article_files",
        sa.Column(
            "content_version",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        schema="public",
    )
    op.drop_column("article_files", "text_raw", schema="public")
    op.drop_column("article_files", "text_html", schema="public")


def downgrade() -> None:
    op.add_column(
        "article_files",
        sa.Column("text_html", sa.Text(), nullable=True),
        schema="public",
    )
    op.add_column(
        "article_files",
        sa.Column("text_raw", sa.Text(), nullable=True),
        schema="public",
    )
    op.drop_column("article_files", "content_version", schema="public")
    op.drop_column("article_files", "content_markdown", schema="public")
```

- [ ] **Step 3: Update the model**

In `backend/app/models/article.py`, replace lines 217-219 (`# Texto extraido` + `text_raw` + `text_html`) with:

```python
    # Stored block-projection markdown (ADR-0013): written atomically with
    # article_text_blocks in DocumentParsingService. content_version bumps on
    # every blocks rewrite so it can never drift from the blocks.
    content_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
```

(`Text` and `Integer` are already imported at `article.py:12`.)

- [ ] **Step 4: Bump the migration-head line + roundtrip guards**

In `docs/reference/extraction-hitl-architecture.md` change the `Migration head:` line to `0033_article_markdown_cols` and `last_reviewed` to `2026-06-24`. In the migration-roundtrip test, bump the pinned head to `0033_article_markdown_cols` and set the `downgrade` target to the explicit parent `0032_optional_rationale` (find via `grep -rn "0032_optional_rationale\|alembic_head\|downgrade" backend/tests`).

- [ ] **Step 5: Apply + verify offline SQL then real upgrade**

Run: `cd backend && uv run alembic upgrade head --sql | tail -40`
Expected: emits `ALTER TABLE public.article_files ADD COLUMN content_markdown ...`, `... content_version ...`, `DROP COLUMN text_raw`, `DROP COLUMN text_html`.
Run: `cd backend && uv run alembic upgrade head && uv run alembic current`
Expected: `0033_article_markdown_cols (head)`.

- [ ] **Step 6: Commit**

```bash
git add backend/alembic/versions/0033_article_markdown_cols.py backend/app/models/article.py docs/reference/extraction-hitl-architecture.md backend/tests
git commit -m "feat(parsing): add article_files.content_markdown + content_version; drop dead text_raw/text_html"
```

---

## Task 2: Persist content_markdown atomically in the parse path

**Files:**
- Modify: `backend/app/services/document_parsing_service.py:144-148`
- Test: `backend/tests/integration/test_document_parsing_service.py` (extend; or create if absent)

**Interfaces:**
- Consumes: `render_blocks_to_markdown` (`app.infrastructure.parsing.base`), the loaded `article_file` row, `replace_for_file`.
- Produces: after a successful parse, `article_file.content_markdown == render_blocks_to_markdown(blocks)` and `article_file.content_version` incremented; same transaction as the blocks.

- [ ] **Step 1: Write the failing integration test**

In `backend/tests/integration/test_document_parsing_service.py` add:

```python
async def test_parse_persists_content_markdown_and_bumps_version(db_session_real, seed):
    from app.infrastructure.parsing.base import ParsedBlock, render_blocks_to_markdown
    from app.services.document_parsing_service import DocumentParsingService

    class _StubParser:
        def parse(self, pdf_bytes: bytes):
            return [
                ParsedBlock(1, 0, "Background", 0, 0, {}, "heading"),
                ParsedBlock(1, 1, "We studied X.", 0, 0, {}, "paragraph"),
            ]

    class _StubStorage:
        async def download(self, bucket, key):
            return b"%PDF-1.4 stub"

    article_file = await _seed_article_file(db_session_real, seed)  # helper in this module
    svc = DocumentParsingService(
        db=db_session_real, user_id=str(seed.user_id),
        storage=_StubStorage(), parser=_StubParser(), trace_id="t",
    )
    before = article_file.content_version

    await svc.parse_article_file(article_file.id)
    await db_session_real.refresh(article_file)

    expected_md = render_blocks_to_markdown([
        ParsedBlock(1, 0, "Background", 0, 0, {}, "heading"),
        ParsedBlock(1, 1, "We studied X.", 0, 0, {}, "paragraph"),
    ])
    assert article_file.content_markdown == expected_md
    assert article_file.content_version == before + 1
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `make test-backend PYTEST_ARGS="-k test_parse_persists_content_markdown -q"`
Expected: FAIL (`content_markdown is None`).

- [ ] **Step 3: Implement**

In `document_parsing_service.py`, import the renderer (extend line 36):

```python
from app.infrastructure.parsing.base import (
    DocumentParser,
    assign_char_offsets_to_blocks,
    render_blocks_to_markdown,
)
```

After `await self._repo.replace_for_file(article_file_id, blocks)` (line 144), before setting status, add:

```python
        # Project the persisted blocks to stored markdown (ADR-0013). Written in
        # the SAME transaction + advisory lock as the blocks, so the markdown can
        # never drift from the blocks. content_version bumps on every rewrite.
        article_file.content_markdown = render_blocks_to_markdown(blocks)
        article_file.content_version = (article_file.content_version or 0) + 1
```

- [ ] **Step 4: Run to confirm it passes**

Run: `make test-backend PYTEST_ARGS="-k test_parse_persists_content_markdown -q"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/document_parsing_service.py backend/tests/integration/test_document_parsing_service.py
git commit -m "feat(parsing): persist content_markdown + bump content_version atomically with blocks"
```

---

## Task 3: PymupdfParser (base PyMuPDF, real bbox)

**Files:**
- Create: `backend/app/infrastructure/parsing/pymupdf_parser.py`
- Test: `backend/tests/unit/parsing/test_pymupdf_parser.py`
- Modify: `backend/pyproject.toml` (add `pymupdf`)

**Interfaces:**
- Produces: `class PymupdfParser(DocumentParser)` with `parse(self, pdf_bytes: bytes) -> list[ParsedBlock]`. Emits per-block `page_number` (1-indexed), `block_index` (0-indexed per page), `text`, real `bbox` `{x,y,width,height}` (PDF points, origin bottom-left), `block_type` in {`heading`,`paragraph`}; raises `ValueError` on zero blocks.

- [ ] **Step 1: Add the dependency**

In `backend/pyproject.toml` dependencies add `"pymupdf>=1.24.0",` (provides `import fitz`). Run: `cd backend && uv sync`.

- [ ] **Step 2: Write the failing test**

Create `backend/tests/unit/parsing/test_pymupdf_parser.py`:

```python
import fitz  # PyMuPDF
import pytest

from app.infrastructure.parsing.base import BLOCK_TYPES
from app.infrastructure.parsing.pymupdf_parser import PymupdfParser


def _one_page_pdf(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text, fontsize=11)
    return doc.tobytes()


def test_parse_returns_blocks_with_bbox_and_offsets_ready():
    pdf = _one_page_pdf("Methods\nWe enrolled 100 patients.")
    blocks = PymupdfParser().parse(pdf)
    assert blocks, "expected at least one block"
    b = blocks[0]
    assert b.page_number == 1
    assert b.block_index == 0
    assert b.block_type in BLOCK_TYPES
    assert set(b.bbox) == {"x", "y", "width", "height"}
    assert "patients" in " ".join(x.text for x in blocks)


def test_parse_raises_on_empty_document():
    doc = fitz.open()
    doc.new_page()  # blank page, no text
    with pytest.raises(ValueError):
        PymupdfParser().parse(doc.tobytes())
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd backend && uv run pytest tests/unit/parsing/test_pymupdf_parser.py -q`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the parser**

Create `backend/app/infrastructure/parsing/pymupdf_parser.py`:

```python
"""Self-hosted simple parser using base PyMuPDF (fitz).

The free default parser (ADR-0011/0013). Extracts per-block text + real bbox via
`page.get_text("dict")`, classifying each block as `heading` (relative font size)
or `paragraph`. Markdown is NOT produced here — the canonical projection is
`render_blocks_to_markdown(blocks)` (one codepath, shared with the reader). Table
reconstruction is out of scope for the simple tier (cells render as paragraph
text); the high-fidelity tiers (LlamaParse / Docling) own structured tables.

No DB / IO / HTTP — pure given the bytes.
"""

from __future__ import annotations

import fitz  # PyMuPDF

from app.infrastructure.parsing.base import (
    ParsedBlock,
    assign_char_offsets_to_blocks,
    normalize_block_type,
)

#: A block whose max span size is >= median * this ratio is treated as a heading.
_HEADING_SIZE_RATIO = 1.25
#: Headings are short; longer lines that happen to be large are still body text.
_HEADING_MAX_CHARS = 120


def _block_text(block: dict) -> str:
    lines = []
    for line in block.get("lines", []):
        spans = [s.get("text", "") for s in line.get("spans", [])]
        joined = "".join(spans).strip()
        if joined:
            lines.append(joined)
    return "\n".join(lines).strip()


def _block_max_size(block: dict) -> float:
    sizes = [
        s.get("size", 0.0)
        for line in block.get("lines", [])
        for s in line.get("spans", [])
    ]
    return max(sizes) if sizes else 0.0


class PymupdfParser:
    """DocumentParser implementation backed by PyMuPDF (fitz)."""

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            raw: list[tuple[int, dict]] = []
            for page_index in range(doc.page_count):
                page = doc.load_page(page_index)
                page_dict = page.get_text("dict")
                for block in page_dict.get("blocks", []):
                    if block.get("type", 0) != 0:  # 0 = text block
                        continue
                    text = _block_text(block)
                    if text:
                        raw.append((page_index + 1, block))
            if not raw:
                raise ValueError("PymupdfParser produced no text blocks")

            sizes = [_block_max_size(b) for _, b in raw if _block_max_size(b) > 0]
            median = sorted(sizes)[len(sizes) // 2] if sizes else 0.0

            blocks: list[ParsedBlock] = []
            per_page_idx: dict[int, int] = {}
            for page_number, block in raw:
                text = _block_text(block)
                x0, y0, x1, y1 = block["bbox"]
                size = _block_max_size(block)
                is_heading = (
                    median > 0
                    and size >= median * _HEADING_SIZE_RATIO
                    and len(text) <= _HEADING_MAX_CHARS
                )
                idx = per_page_idx.get(page_number, 0)
                per_page_idx[page_number] = idx + 1
                blocks.append(
                    ParsedBlock(
                        page_number=page_number,
                        block_index=idx,
                        text=text,
                        char_start=0,
                        char_end=0,
                        bbox={
                            "x": float(x0),
                            "y": float(y0),
                            "width": float(x1 - x0),
                            "height": float(y1 - y0),
                        },
                        block_type=normalize_block_type("heading" if is_heading else "paragraph"),
                    )
                )
            return assign_char_offsets_to_blocks(blocks)
        finally:
            doc.close()
```

- [ ] **Step 5: Run to confirm it passes**

Run: `cd backend && uv run pytest tests/unit/parsing/test_pymupdf_parser.py -q`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/infrastructure/parsing/pymupdf_parser.py backend/tests/unit/parsing/test_pymupdf_parser.py backend/pyproject.toml backend/uv.lock
git commit -m "feat(parsing): add PymupdfParser (base PyMuPDF, real bbox) as the simple parser"
```

---

## Task 4: Make PyMuPDF the free default; Docling opt-in

**Files:**
- Modify: `backend/app/core/config.py` (`PARSER_BACKEND` default → `"pymupdf"`)
- Modify: `backend/app/core/factories.py:56-73`
- Modify: `backend/app/worker/tasks/parsing_tasks.py:47-60`
- Test: `backend/tests/unit/test_parser_factory.py`

**Interfaces:**
- Consumes: `PymupdfParser` (Task 3).
- Produces: `create_document_parser` returns `PymupdfParser` for backend `pymupdf` and as the no-key/unknown fallback; `auto` resolves `llamaparse` only with a key, else `pymupdf`; `docling` only when explicitly selected.

- [ ] **Step 1: Write the failing factory test**

Create `backend/tests/unit/test_parser_factory.py`:

```python
from types import SimpleNamespace

from app.core.factories import create_document_parser
from app.infrastructure.parsing.docling_parser import DoclingParser
from app.infrastructure.parsing.llamaparse_parser import LlamaParseParser
from app.infrastructure.parsing.pymupdf_parser import PymupdfParser


def test_default_backend_is_pymupdf():
    p = create_document_parser(SimpleNamespace(PARSER_BACKEND="pymupdf"))
    assert isinstance(p, PymupdfParser)


def test_llamaparse_without_key_falls_back_to_pymupdf():
    p = create_document_parser(SimpleNamespace(PARSER_BACKEND="llamaparse", LLAMA_CLOUD_API_KEY=None))
    assert isinstance(p, PymupdfParser)


def test_llamaparse_with_key():
    p = create_document_parser(
        SimpleNamespace(PARSER_BACKEND="llamaparse"), llama_cloud_key="k"
    )
    assert isinstance(p, LlamaParseParser)


def test_docling_is_opt_in_only():
    p = create_document_parser(SimpleNamespace(PARSER_BACKEND="docling"))
    assert isinstance(p, DoclingParser)


def test_unknown_backend_falls_back_to_pymupdf():
    p = create_document_parser(SimpleNamespace(PARSER_BACKEND="nope"))
    assert isinstance(p, PymupdfParser)
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && uv run pytest tests/unit/test_parser_factory.py -q`
Expected: FAIL (default returns DoclingParser).

- [ ] **Step 3: Rewrite `create_document_parser` body (factories.py:56-73)**

```python
    # Lazy imports: the heavy docling/llama_cloud deps must not load at module
    # import time. PymupdfParser is light (base fitz) so it can import eagerly,
    # but keep it lazy for symmetry.
    from app.infrastructure.parsing.docling_parser import DoclingParser
    from app.infrastructure.parsing.llamaparse_parser import LlamaParseParser
    from app.infrastructure.parsing.pymupdf_parser import PymupdfParser

    backend = (getattr(settings, "PARSER_BACKEND", "pymupdf") or "pymupdf").lower()

    if backend == "llamaparse":
        key = llama_cloud_key or getattr(settings, "LLAMA_CLOUD_API_KEY", None)
        if not key:
            _logger.warning("parser_gate_llamaparse_no_key_fallback_pymupdf")
            return PymupdfParser()
        return LlamaParseParser(api_key=key)

    if backend == "docling":
        return DoclingParser()

    if backend != "pymupdf":
        _logger.warning("parser_gate_unknown_backend_fallback_pymupdf", backend=backend)

    return PymupdfParser()
```

- [ ] **Step 4: Update config default**

In `backend/app/core/config.py:115` change `PARSER_BACKEND: str = "docling"` → `PARSER_BACKEND: str = "pymupdf"`.

- [ ] **Step 5: Update the worker pref resolution (parsing_tasks.py:47-60)**

Change the `auto` branch so the no-key fallback is `pymupdf`, not `docling`. Locate the block resolving `pref`; the `auto → llamaparse if key else docling` line becomes `auto → llamaparse if key else pymupdf`, and ensure the `SimpleNamespace(PARSER_BACKEND=backend, ...)` passed to `create_document_parser` uses `"pymupdf"` for that fallback. Verify with: `grep -n "docling\|pymupdf\|auto\|PARSER_BACKEND" backend/app/worker/tasks/parsing_tasks.py`.

- [ ] **Step 6: Run factory tests**

Run: `cd backend && uv run pytest tests/unit/test_parser_factory.py -q`
Expected: PASS (5 passed).

- [ ] **Step 7: Commit**

```bash
git add backend/app/core/factories.py backend/app/core/config.py backend/app/worker/tasks/parsing_tasks.py backend/tests/unit/test_parser_factory.py
git commit -m "feat(parsing): PyMuPDF is the free default parser; Docling opt-in only"
```

---

## Task 5: On-demand parse-once helper + remove the pypdf fallback

**Files:**
- Modify: `backend/app/services/extraction_prompt_input.py`
- Modify: `backend/app/llm/assembler.py` (delete `blocks_from_plain_text`)
- Delete: `backend/app/services/pdf_processor.py`
- Modify: `backend/app/services/section_extraction_service.py` + `model_extraction_service.py` (drop the pypdf `pdf_processor`/`get_pdf` wiring into `build_prompt_input`)
- Test: `backend/tests/integration/test_on_demand_parse.py`

**Interfaces:**
- Consumes: `DocumentParsingService` (Task 2), `PymupdfParser` (Task 3), `create_storage_adapter`.
- Produces: `build_prompt_input(*, db, article_files, storage, supabase, article_id, model, logger) -> tuple[str, list, UUID | None]`. New signature drops `pdf_processor`/`get_pdf`; adds `storage`/`supabase` so it can run the on-demand parse. When the main file has no blocks, it parses once with `PymupdfParser` via `DocumentParsingService`, persists blocks + `content_markdown`, and continues.

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/integration/test_on_demand_parse.py`:

```python
async def test_unparsed_article_parses_once_then_reuses(db_session_real, seed, monkeypatch):
    from app.infrastructure.parsing import pymupdf_parser
    from app.services import extraction_prompt_input as epi

    calls = {"n": 0}
    real_parse = pymupdf_parser.PymupdfParser.parse

    def _counting_parse(self, pdf_bytes):
        calls["n"] += 1
        return real_parse(self, pdf_bytes)

    monkeypatch.setattr(pymupdf_parser.PymupdfParser, "parse", _counting_parse)

    article = await _seed_article_with_pdf_file(db_session_real, seed)  # helper

    md1, blocks1, file_id = await epi.build_prompt_input(
        db=db_session_real, article_files=_files(db_session_real),
        storage=_stub_storage(), supabase=_stub_supabase(),
        article_id=article.id, model="gpt-4o-mini", logger=_logger(),
    )
    assert calls["n"] == 1
    assert blocks1 and file_id is not None
    assert md1.strip()

    md2, blocks2, _ = await epi.build_prompt_input(
        db=db_session_real, article_files=_files(db_session_real),
        storage=_stub_storage(), supabase=_stub_supabase(),
        article_id=article.id, model="gpt-4o-mini", logger=_logger(),
    )
    assert calls["n"] == 1  # NOT re-parsed
    assert md2 == md1
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `make test-backend PYTEST_ARGS="-k test_unparsed_article_parses_once -q"`
Expected: FAIL (old signature / pypdf fallback).

- [ ] **Step 3: Rewrite `build_prompt_input`**

Replace `backend/app/services/extraction_prompt_input.py` body with:

```python
"""Build the budgeted block-markdown prompt input for a run.

Reads the STORED content_markdown when it fits the token budget; otherwise falls
back to the section-aware assembler over the persisted blocks (IMRaD whole-section
dropping). When the article was never parsed, runs the simple PymupdfParser ONCE
via DocumentParsingService (persisting blocks + content_markdown) so it is never
re-run and citations/highlights anchor. No unbounded pypdf path remains.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.infrastructure.parsing.pymupdf_parser import PymupdfParser
from app.llm.assembler import assemble_for_model, estimate_tokens
from app.repositories.article_text_block_repository import ArticleTextBlockRepository
from app.services.document_parsing_service import DocumentParsingService


async def build_prompt_input(
    *,
    db: AsyncSession,
    article_files: Any,
    storage: Any,
    article_id: UUID,
    model: str,
    logger: Any,
    user_id: str,
    trace_id: str,
) -> tuple[str, list[Any], UUID | None]:
    """Return ``(markdown, anchor_blocks, anchor_file_id)`` for *article_id*."""
    main_file = await article_files.get_latest_pdf(article_id)
    if main_file is None:
        raise FileNotFoundError(f"No PDF for article {article_id}")

    repo = ArticleTextBlockRepository(db)
    blocks = await repo.list_ordered_for_file(main_file.id)

    if not blocks:
        # On-demand: parse once with the simple parser, persist blocks +
        # content_markdown, then reload. Never re-runs on the next call.
        parsing = DocumentParsingService(
            db=db, user_id=user_id, storage=storage,
            parser=PymupdfParser(), trace_id=trace_id,
        )
        await parsing.parse_article_file(main_file.id)
        await db.refresh(main_file)
        blocks = await repo.list_ordered_for_file(main_file.id)

    stored_md = main_file.content_markdown or ""
    if stored_md and estimate_tokens(stored_md, model) <= settings.LLM_ASSEMBLY_BUDGET_TOKENS:
        text, source = stored_md, "stored_markdown"
        info_truncated, est = False, estimate_tokens(stored_md, model)
        included = len(blocks)
    else:
        text, info = assemble_for_model(
            blocks, model_name=model, budget_tokens=settings.LLM_ASSEMBLY_BUDGET_TOKENS
        )
        source, info_truncated, est, included = (
            "budgeted_blocks", info.truncated, info.est_tokens, info.included_blocks,
        )

    logger.info(
        "extraction.assembly",
        article_id=str(article_id),
        source=source,
        total_blocks=len(blocks),
        included_blocks=included,
        truncated=info_truncated,
        est_tokens=est,
    )
    return text, blocks, main_file.id
```

- [ ] **Step 4: Update the two call sites**

In `section_extraction_service.py` (~line 230) and `model_extraction_service.py` (~line 154) update the `build_prompt_input(...)` call to the new keyword signature: pass `storage=self.storage`, `user_id=self.user_id`, `trace_id=self.trace_id`, drop `pdf_processor=` and `get_pdf=`. Verify with `grep -n "build_prompt_input" backend/app/services/*.py`.

- [ ] **Step 5: Delete the pypdf fallback + processor**

Remove `blocks_from_plain_text` from `backend/app/llm/assembler.py` (the function at lines 366-401 and its `ParsedBlock` import if now unused — keep `ParsedBlock` import only if still referenced). Delete `backend/app/services/pdf_processor.py`. Confirm no references remain: `grep -rn "blocks_from_plain_text\|pdf_processor\|PDFProcessor" backend/app` → expected empty.

- [ ] **Step 6: Run the on-demand + assembler tests**

Run: `make test-backend PYTEST_ARGS="-k 'test_unparsed_article_parses_once or assembler' -q"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/extraction_prompt_input.py backend/app/llm/assembler.py backend/app/services/section_extraction_service.py backend/app/services/model_extraction_service.py backend/tests/integration/test_on_demand_parse.py
git rm backend/app/services/pdf_processor.py
git commit -m "feat(extraction): on-demand PyMuPDF parse-once + ingest stored markdown; remove pypdf fallback"
```

---

## Task 6: Persist block_index list on the evidence anchor

**Files:**
- Modify: `backend/app/schemas/extraction.py:499-530` (add `block_ids` to anchor variants)
- Modify: `backend/app/services/evidence_anchor_service.py` (`build_anchor` populates `block_ids`)
- Test: `backend/tests/unit/test_evidence_anchor_blockids.py`

**Interfaces:**
- Consumes: `AnchorMatch.block_ids` (block_index values, ascending).
- Produces: `TextCitationAnchor.block_ids: list[int]`, `HybridCitationAnchor.block_ids: list[int]`, `RegionCitationAnchor.block_ids: list[int]` (default `[]`), populated by `build_anchor` verbatim from `AnchorMatch.block_ids`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_evidence_anchor_blockids.py`:

```python
from app.infrastructure.parsing.base import ParsedBlock, assign_char_offsets_to_blocks
from app.services.evidence_anchor_service import build_anchor


def test_build_anchor_persists_block_index():
    blocks = assign_char_offsets_to_blocks([
        ParsedBlock(1, 0, "We enrolled 100 patients in the trial.", 0, 0,
                    {"x": 1, "y": 2, "width": 3, "height": 4}, "paragraph"),
    ])
    pos = build_anchor("enrolled 100 patients", blocks)
    assert pos is not None
    assert pos.anchor.block_ids == [0]
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && uv run pytest tests/unit/test_evidence_anchor_blockids.py -q`
Expected: FAIL (`block_ids` attribute missing).

- [ ] **Step 3: Add `block_ids` to the three anchor models**

In `schemas/extraction.py`, add to `TextCitationAnchor`, `RegionCitationAnchor`, and `HybridCitationAnchor` (after their existing fields):

```python
    block_ids: list[int] = Field(
        default_factory=list,
        alias="blockIds",
        description="block_index values (per page) the quote matched; reader highlight key",
    )
```

- [ ] **Step 4: Populate it in `build_anchor`**

In `evidence_anchor_service.py::build_anchor`, where each anchor variant is constructed from the `AnchorMatch`, pass `block_ids=match.block_ids`. Locate the constructions (`TextCitationAnchor(`, `HybridCitationAnchor(`, `RegionCitationAnchor(`) and add `block_ids=match.block_ids` to each (verify lines via `grep -n "CitationAnchor(" backend/app/services/evidence_anchor_service.py`).

- [ ] **Step 5: Run to confirm it passes**

Run: `cd backend && uv run pytest tests/unit/test_evidence_anchor_blockids.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/extraction.py backend/app/services/evidence_anchor_service.py backend/tests/unit/test_evidence_anchor_blockids.py
git commit -m "feat(citations): persist matched block_index list on the evidence anchor"
```

---

## Task 7: Surface blockIds + page in the suggestions/evidence payload

**Files:**
- Modify: the suggestion read service that builds `AISuggestionItem.evidence` (find via `grep -rn "text_content\|evidence" backend/app/services/extraction_suggestion_read_service.py`)
- Test: extend that service's test

**Interfaces:**
- Produces: the evidence object delivered to the client gains `blockIds: list[int]` (from `position.anchor.blockIds`) and keeps `pageNumber`/`textContent`.

- [ ] **Step 1: Write the failing test**

In the suggestion-read-service test, assert that a suggestion whose evidence `position` carries `anchor.blockIds=[2]` is returned with `evidence["blockIds"] == [2]`. (Mirror the existing evidence-shape assertions in that test file.)

- [ ] **Step 2: Run to confirm it fails**

Run: `make test-backend PYTEST_ARGS="-k suggestion_read -q"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `extraction_suggestion_read_service.py`, where the evidence dict is assembled from the `ExtractionEvidence` row, parse `position` via `parse_position(row.position)` and include `blockIds = pos.anchor.block_ids if pos else []`. Add `"blockIds": block_ids` to the evidence dict alongside `pageNumber`/`textContent`.

- [ ] **Step 4: Run to confirm it passes**

Run: `make test-backend PYTEST_ARGS="-k suggestion_read -q"`
Expected: PASS.

- [ ] **Step 5: Regenerate API types + commit**

Run: `npm run generate:api-types`

```bash
git add backend/app/services/extraction_suggestion_read_service.py backend/tests frontend/types/api
git commit -m "feat(citations): expose evidence blockIds in the suggestions payload"
```

---

## Task 8: Frontend — deterministic highlight by (page, block_index)

**Files:**
- Modify: `frontend/pdf-viewer/primitives/readerLocate.ts` (add `findBlockByIndex`, extend `LocatableBlock`)
- Modify: `frontend/pdf-viewer/core/store.ts` (`locateInReader(quote, page, blockIds?)` + `ReaderLocateRequest`)
- Modify: `frontend/pdf-viewer/primitives/Reader.tsx` (prefer index match, then quote)
- Modify: `frontend/hooks/extraction/useReaderLocate.ts` (`locate(quote, page, blockIds?)`)
- Modify: the citation-click call site (find via `grep -rn "\.locate(" frontend`)
- Modify: `frontend/services/aiSuggestionService.ts` + evidence type (carry `blockIds`)
- Test: `frontend/pdf-viewer/primitives/__tests__/readerLocate.blockindex.test.ts`

**Interfaces:**
- Consumes: `evidence.blockIds: number[]` (Task 7).
- Produces: `findBlockByIndex(blocks, page, blockIds) -> string | null`; `locate(quote, page, blockIds?)`.

- [ ] **Step 1: Write the failing test**

Create `frontend/pdf-viewer/primitives/__tests__/readerLocate.blockindex.test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {findBlockByIndex} from '../readerLocate';

const blocks = [
  {id: 'a', pageNumber: 1, blockIndex: 0, text: 'Intro'},
  {id: 'b', pageNumber: 1, blockIndex: 1, text: 'We enrolled 100 patients.'},
  {id: 'c', pageNumber: 2, blockIndex: 0, text: 'Methods'},
];

describe('findBlockByIndex', () => {
  it('returns the id of the first matching (page, blockIndex)', () => {
    expect(findBlockByIndex(blocks, 1, [1])).toBe('b');
  });
  it('returns null when nothing matches', () => {
    expect(findBlockByIndex(blocks, 1, [9])).toBeNull();
  });
  it('returns null on empty blockIds', () => {
    expect(findBlockByIndex(blocks, 1, [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:run -- readerLocate.blockindex`
Expected: FAIL (`findBlockByIndex` not exported).

- [ ] **Step 3: Implement `findBlockByIndex` + extend `LocatableBlock`**

In `readerLocate.ts`, extend the interface and add the matcher:

```ts
export interface LocatableBlock {
  id: string;
  pageNumber: number;
  blockIndex: number;
  text: string;
}

/** Deterministic locate by (page, block_index); the reader's preferred path. */
export function findBlockByIndex(
  blocks: readonly LocatableBlock[],
  page: number | null | undefined,
  blockIds: readonly number[],
): string | null {
  if (!blockIds.length) return null;
  const wanted = new Set(blockIds);
  const hit = blocks.find(
    (b) => (page == null || b.pageNumber === page) && wanted.has(b.blockIndex),
  );
  return hit ? hit.id : null;
}
```

(Keep `findBlockForQuote`; its `LocatableBlock` now also carries `blockIndex` — harmless.)

- [ ] **Step 4: Thread blockIds through the store + reader + hook**

In `store.ts`: extend `ReaderLocateRequest` with `blockIds: number[]` and `locateInReader(quote, page, blockIds = [])`. In `Reader.tsx`'s locate effect, resolve `const id = findBlockByIndex(blocks, req.page, req.blockIds) ?? findBlockForQuote(blocks, req.quote, req.page);` then scroll/flash as today (pass `blockIndex` into the `LocatableBlock[]` it builds from `blocks`). In `useReaderLocate.ts`, change `locate` to `(quote, page, blockIds = []) => storeApi?.getState().actions.locateInReader(quote, page ?? null, blockIds)`.

- [ ] **Step 5: Pass blockIds at the citation-click call site + carry it through the service/type**

In `aiSuggestionService.ts`, map `evidence.blockIds` into the client evidence object (alongside `text`/`pageNumber`). Update the evidence TS type to include `blockIds: number[]`. At the citation-click handler, call `locate(evidence.text, evidence.pageNumber, evidence.blockIds)`.

- [ ] **Step 6: Run reader + service tests**

Run: `npm run test:run -- readerLocate aiSuggestion Reader`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/pdf-viewer frontend/hooks/extraction/useReaderLocate.ts frontend/services/aiSuggestionService.ts frontend/types
git commit -m "feat(reader): deterministic citation highlight by (page, block_index) with quote fallback"
```

---

## Task 9: Remove orphaned/dead code

**Files:**
- Delete: `backend/app/services/citation_read_service.py` (+ its imports in `articles.py:30`, `article_files.py:28`)
- Modify/Delete: `frontend/pdf-viewer/core/coordinates.ts` (`projectPdfRectToCss` if unused), `frontend/types/annotations-new.ts` (`HighlightAnnotation` if unused)
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (remove the stale "proposal"-stage comment, verify line)

- [ ] **Step 1: Confirm each is dead, then delete**

```bash
grep -rn "citation_read_service\|list_article_citations" backend/app
grep -rn "projectPdfRectToCss" frontend
grep -rn "HighlightAnnotation" frontend
grep -rn "proposal" frontend/pages/ExtractionFullScreen.tsx
```
Expected: each shows only the definition + the imports being removed (no live caller). For any that has a live caller, leave it and note it.

- [ ] **Step 2: Delete the orphan service + its dead imports**

```bash
git rm backend/app/services/citation_read_service.py
```
Remove the now-unused `from app.services.citation_read_service import ...` lines in `articles.py` and `article_files.py`. Remove `projectPdfRectToCss`/`HighlightAnnotation` only if Step 1 proved them dead. Remove the stale proposal-stage comment near `ExtractionFullScreen.tsx` (the real stages are `pending/extract/consensus/finalized/cancelled`).

- [ ] **Step 3: Verify nothing broke**

Run: `make lint-backend && npm run lint`
Expected: clean (no unused-import / no-undef).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(cleanup): remove orphaned citation_read_service, dead frontend helpers, stale proposal-stage comment"
```

---

## Task 10: Documentation — remove legacy, state the new behavior

**Files:** `docs/adr/0011-*.md`, `docs/adr/0013-*.md`, `docs/reference/extraction-hitl-architecture.md`, `docs/reference/observability-extraction.md`, `docs/ROADMAP.md`, `.markdownlintignore`

- [ ] **Step 1: ADR-0013** — set `status: accepted`; record that `content_markdown` is **stored** (atomic with blocks, `content_version`) superseding "derive on demand"; PyMuPDF is the free default; highlight is deterministic by `(page, block_index)` (the canvas-only caveat is superseded for the markdown path).
- [ ] **Step 2: ADR-0011** — parser default is `pymupdf`; `auto → LlamaParse if key else pymupdf`; Docling opt-in.
- [ ] **Step 3: `extraction-hitl-architecture.md` §4.2** — extraction input is the stored `content_markdown` (budget fallback to the block assembler); PyMuPDF on-demand parse-once; no pypdf path. (Migration-head line already bumped in Task 1.)
- [ ] **Step 4: `observability-extraction.md`** — document the new `extraction.assembly.source` field (`stored_markdown | budgeted_blocks`).
- [ ] **Step 5: `ROADMAP.md`** — note the shipped stored-markdown ingestion + deterministic highlight.
- [ ] **Step 6: `.markdownlintignore`** — add `docs/superpowers/plans/2026-06-24-markdown-ingestion-and-citation-highlight.md`.
- [ ] **Step 7: Commit**

```bash
git add docs .markdownlintignore
git commit -m "docs: stored-markdown ingestion, PyMuPDF default, deterministic highlight; retire pypdf/derive-on-demand"
```

---

## Task 11: Full verification gate

- [ ] **Step 1: Backend** — `make test-backend` (all green; new tests included). Diff-cover ≥ 80% — if any touched endpoint coroutine is under-covered, add a direct coroutine unit test (ASGI integration lines don't register coverage).
- [ ] **Step 2: Frontend** — `npm run test:run` and `npm run lint`.
- [ ] **Step 3: Types** — `npm run generate:api-types` shows no diff (already committed).
- [ ] **Step 4: Full gate** — `make quality-scan` (lint + typecheck + tests + architectural fitness). Resolve any layering/data-path violations.
- [ ] **Step 5: E2E** — `npm run test:e2e:local` for the citation-highlight flow: upload an unparsed PDF → Run AI → suggestion appears → click its citation → reader scrolls to + flashes the correct block. Add the spec if missing.
- [ ] **Step 6: Commit any test additions**

```bash
git add -A && git commit -m "test: verification gate for stored-markdown ingestion + deterministic highlight"
```

---

## Self-review (completed by plan author)

- **Spec coverage:** §4.1 → Task 1; §4.3 → Task 2; §4.2 → Tasks 3-4; §4.4/4.5 → Task 5; §4.6 → Task 6; §4.7 → Tasks 7-8; §4.8 → Tasks 9-10; §7 testing → woven per task + Task 11. All spec sections map to a task.
- **Type consistency:** `build_anchor`/`AnchorMatch.block_ids` (block_index, `list[int]`) → `*CitationAnchor.block_ids: list[int]` → payload `blockIds: number[]` → `findBlockByIndex(blocks, page, blockIds)`. `build_prompt_input` new signature is used identically at both call sites (Task 5 Step 4). `content_markdown`/`content_version` names consistent across Tasks 1-2 and Task 5.
- **Placeholder scan:** no TBD/TODO; each code step carries real code; mechanical edits give exact `grep` anchors. The one runtime-verified spot (the stale proposal comment line) is gated by a `grep` in Task 9 Step 1.
