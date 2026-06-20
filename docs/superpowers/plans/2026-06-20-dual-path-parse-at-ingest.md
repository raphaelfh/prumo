---
status: draft
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

# Dual-path parse at ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Decision records: ADR 0011 (structured PDF parsing at ingest) — split default + fail-closed PHI gate.

**Goal:** At ingest, every newly imported article (any route — Zotero today,
direct-upload and future routes) is parsed into the already-migrated
`article_text_blocks` (bbox + char offsets) by a pluggable `DocumentParser`
selected per-project: a standard self-hosted path (**Docling**) or a
high-quality cloud path (**LlamaParse**, BYOK, activated per-project in
settings), behind a `create_document_parser()` factory with a fail-closed PHI
gate.

**Architecture:** The `DocumentParser` port, the `ParsedBlock` value type,
`DocumentParsingService`, and `ArticleTextBlockRepository` already exist and are
merged (PR #322). This plan supplies the **two concrete adapters** (Docling,
LlamaParse), the **factory + PHI gate** that picks one per project, the
**per-project activation surface** (a `ParserSettingsService` over
`Project.settings['parsing']` plus a manager-only endpoint and a frontend
toggle), the **Celery task** that runs the parse in the worker, and a **single
ingest hook** (`ArticleFileIngestService.enqueue_parse_at_ingest`) called after
every `ArticleFile.create`. The parser is injected into the service exactly as
`StorageAdapter` is; the factory is the single choke point for parser selection
and is the only place the PHI gate runs. This plan **stops at "blocks populated
for every ingested article."** The markdown projection
(`render_blocks_to_markdown`), the markdown view, and citation marking are a
separate plan, `2026-06-20-markdown-view-and-markdown-citations.md` — referenced
here as the follow-up, not implemented.

**Tech Stack:** Python 3.11 + FastAPI + SQLAlchemy 2.0 async + Alembic; Celery +
Redis worker (`worker_session()` NullPool + `run_task()` bridge); two parser
backends — self-hosted **Docling** (`docling` lib: `DocumentConverter`,
torch + models, CPU-first) and cloud **LlamaParse** (`llama-cloud >= 2.1` SDK,
`tier='agentic'`, `granular_bboxes`); BYOK via `APIKeyService` (new `llama_cloud`
provider); per-project activation mirroring `ManagerReviewVisibilityService`;
pytest integration against local Supabase Docker (`db_session_real`,
project-scoped fixtures); vitest for the frontend toggle. Suggested branch:
`feat/dual-path-parse-at-ingest`.

## Global Constraints

These are the project's binding rules. **Every task's requirements implicitly
include this section** (constitution + `.claude/rules/backend.md` +
`.claude/rules/frontend.md`):

- **Four-layer flow:** `api → services → repositories → models`. Endpoints never
  touch the DB or return ORM objects; services never import api or return HTTP
  objects; repositories never contain business logic
  (CI: `scripts/fitness/check_layered_arch.py`).
- **Repositories `flush()`, never `commit()`.** The caller (Celery task /
  endpoint) owns the transaction boundary.
- **The only singleton is `EventBus`.** Do not introduce new module-level
  singletons; parsers are injected, the factory is a plain function.
- **Celery DB tasks use `worker_session()` + `run_task()`** (NullPool engine per
  task; nested `async def run()`; `run_task(run)` bridge) — see
  `app/worker/_session.py` / `app/worker/_runner.py`.
- **Alembic owns the public schema.** From `backend/`:
  `alembic revision --autogenerate -m "..."`. **Revision ids ≤ 32 chars**
  (`alembic_version.version_num` is `varchar(32)`; overflow breaks CI + the
  Railway deploy). Supabase CLI is only for `auth`/`storage`. Never apply
  app-schema DDL through the Supabase MCP.
- **RLS via `is_project_member()`.** New project-scoped reads/writes respect it.
- **Every project-scoped endpoint enforces BOLA** — call `ensure_project_member`
  (or `require_project_manager` for config writes) before touching project data.
- **Typed Pydantic responses** in the `ApiResponse` envelope; errors expose
  `error.message`. Never `ApiResponse[dict[str, Any]]`.
- **API-Contract gate:** any endpoint or Pydantic-schema change must regenerate
  `frontend/types/api/{openapi.json,schema.d.ts}` via
  `scripts/generate_api_types.sh` (`npm run generate:api-types`) and commit the
  diff — CI's `api-contract` job fails otherwise.
- **Integration tests scope by `project_id`** and run against the real local
  Supabase Postgres (RLS / CHECK constraints / deferred triggers are invisible
  to mocks). `make test-backend`; the autouse `SEED` fixture builds the graph.
- **Frontend React-compiler `panicThreshold: 'all_errors'`** — no `try/finally`
  or `throw`-inside-`try` in component/hook bodies; move IO into a
  `frontend/services/` function returning `ErrorResult<T>` or use the typed
  `apiClient`. All user-facing strings go through `frontend/lib/copy/`. Backend
  calls go through `frontend/integrations/api` (no new `supabase.from(...)`).
- **English-only** for code, comments, commits, docs, and copy keys.

---

## Phases

- **Phase 1 — Config + PHI column + factory.** `PARSER_BACKEND`,
  `LLAMA_CLOUD_API_KEY`; `Project.is_phi` (migration, fail-closed default);
  `create_document_parser()` owning the `PARSER_BACKEND` switch + the fail-closed
  PHI gate. (Anthropic provider config is OUT OF SCOPE here — it belongs to the
  separate vision-table-pass / second-provider plan; adding it now would be
  unused config.)
- **Phase 2 — Docling adapter** (standard self-hosted path).
- **Phase 3 — LlamaParse adapter** (high-quality cloud path) + teach
  `APIKeyService` the `llama_cloud` provider.
- **Phase 4 — Per-project activation.** `ParserSettingsService` over
  `Project.settings['parsing']`; manager-only `PUT .../parser-settings`; frontend
  toggle requiring a stored `llama_cloud` BYOK key.
- **Phase 5 — Celery task** `parse_article_file_task`.
- **Phase 6 — Single ingest hook** `ArticleFileIngestService.enqueue_parse_at_ingest`
  for all routes; wire Zotero; a fitness/grep test asserting no bypass.
- **Phase 7 — No-legacy cleanup + `/simplify` pass.**

The markdown projection, markdown view, and citation marking are the **follow-up
plan**: `docs/superpowers/plans/2026-06-20-markdown-view-and-markdown-citations.md`.

## File map

| File | Responsibility | Change |
| --- | --- | --- |
| `backend/app/core/config.py` | settings | Add `PARSER_BACKEND`, `LLAMA_CLOUD_API_KEY` |
| `backend/alembic/versions/0027_project_is_phi.py` | schema | New: add `projects.is_phi BOOLEAN NOT NULL DEFAULT false` (fail-closed: absent = treated as PHI by the gate) |
| `backend/app/models/project.py` | model | Add `is_phi: Mapped[bool]` column |
| `backend/app/core/factories.py` | parser factory | Add `create_document_parser(settings, *, project_is_phi, api_key_service=None)` — owns the `PARSER_BACKEND` switch + fail-closed PHI gate (mirrors `create_storage_adapter`) |
| `backend/app/infrastructure/parsing/docling_parser.py` | parser adapter (standard) | New: `DoclingParser(DocumentParser)` — `DocumentConverter` → items → `ParsedBlock`s |
| `backend/app/infrastructure/parsing/llamaparse_parser.py` | parser adapter (cloud) | New: `LlamaParseParser(DocumentParser)` — `llama_cloud` agentic tier + granular bboxes + Y-flip |
| `backend/app/models/user_api_key.py` | model | Add `"llama_cloud"` to `SUPPORTED_PROVIDERS` + the `CheckConstraint` |
| `backend/alembic/versions/0028_api_key_llama_cloud.py` | schema | New: widen the `user_api_keys_provider_check` CHECK to include `llama_cloud` |
| `backend/app/services/api_key_service.py` | BYOK | Add `_validate_llama_cloud`, the `llama_cloud` case in `_validate_key`, and the `llama_cloud` branch in `_get_global_key` |
| `backend/app/services/parser_settings_service.py` | per-project setting | New: `ParserSettingsService` over `Project.settings['parsing']` (mirrors `ManagerReviewVisibilityService`) |
| `backend/app/schemas/parser_settings.py` | schema | New: `ParserSettingsPayload` + `ParserSettingsRead` |
| `backend/app/api/v1/endpoints/parser_settings.py` | endpoint | New: manager-only `PUT /projects/{project_id}/parser-settings` |
| `backend/app/api/v1/router.py` | wiring | Register `parser_settings.router` under `/projects` |
| `backend/app/worker/tasks/parsing_tasks.py` | async entry | New: `parse_article_file_task` (bind, retries, rate_limit, `worker_session()`) |
| `backend/app/services/article_file_ingest_service.py` | ingest hook | New: `ArticleFileIngestService.enqueue_parse_at_ingest(...)` — the single parse-at-ingest entry for all routes |
| `backend/app/services/zotero_import_service.py` | ingest | Call `enqueue_parse_at_ingest(...)` right after `ArticleFile.create` in `_import_pdf` |
| `backend/tests/fitness/test_article_file_create_uses_hook.py` | fitness | New: grep test — no `ArticleFile(`/`article_files.create` site bypasses the hook |
| `frontend/services/parserSettingsService.ts` | FE IO | New: typed `apiClient` PUT for parser settings |
| `frontend/components/project/settings/HighQualityParsingToggle.tsx` | FE UI | New: per-project toggle requiring a stored `llama_cloud` key |
| `frontend/lib/copy/...` | copy | New copy keys for the toggle label/hint/errors |
| `backend/pyproject.toml` | deps | Add `docling` and `llama-cloud >= 2.1` (lazy-imported in the adapters) |

---

## Phase 1 — Config + PHI column + factory

### Task 1.1: Config fields for parser selection

**Files:**
- Modify: `backend/app/core/config.py:89-92` (after the `OPENAI` section)
- Test: `backend/tests/unit/test_config_parser_fields.py`

**Interfaces:**
- Produces: `settings.PARSER_BACKEND: str` (default `"docling"`) and
  `settings.LLAMA_CLOUD_API_KEY: str | None`. The factory (Task 1.3) reads both;
  `APIKeyService._get_global_key` (Task 3.2) reads `LLAMA_CLOUD_API_KEY`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_config_parser_fields.py
from app.core.config import Settings


def test_parser_defaults():
    s = Settings()  # type: ignore[call-arg]
    assert s.PARSER_BACKEND == "docling"          # standard self-hosted default
    assert s.LLAMA_CLOUD_API_KEY is None          # cloud key optional (BYOK/global)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_config_parser_fields.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'PARSER_BACKEND'`.

- [ ] **Step 3: Add the settings fields**

In `backend/app/core/config.py`, after the `OPENAI` block (line 92), add:

```python
    # =================== PARSING ===================
    # Standard self-hosted parser by default. Per-project activation can
    # request "llamaparse"; the create_document_parser() PHI gate is the
    # final authority (PHI / unknown -> self-hosted, fail-closed).
    PARSER_BACKEND: str = "docling"
    # Optional global LlamaCloud key; per-user BYOK (APIKeyService) takes
    # precedence. Cloud egress -> non-PHI projects only.
    LLAMA_CLOUD_API_KEY: str | None = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_config_parser_fields.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/config.py backend/tests/unit/test_config_parser_fields.py
git commit -m "feat(parsing): config fields for PARSER_BACKEND + LlamaCloud key"
```

### Task 1.2: `Project.is_phi` column + migration (fail-closed default)

**Files:**
- Create: `backend/alembic/versions/0027_project_is_phi.py`
- Modify: `backend/app/models/project.py:75` (next to `is_active`)
- Test: `backend/tests/integration/test_project_is_phi_column.py`

**Interfaces:**
- Produces: `Project.is_phi: Mapped[bool]` (NOT NULL, default `False`). The
  Celery task (Task 5.1) reads it; the factory (Task 1.3) receives it as
  `project_is_phi`. **Fail-closed semantics:** the column default is `False`
  (non-PHI) for *explicitly created* rows, but the **gate** treats a project as
  PHI whenever the cloud path is requested without an explicit non-PHI opt-in —
  the gate, not the column default, is the fail-closed authority (see Task 1.3).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_project_is_phi_column.py
import pytest
from sqlalchemy import select
from app.models.project import Project


@pytest.mark.asyncio
async def test_project_is_phi_defaults_false(db_session_real, seed):
    project_id = seed.project_id
    project = (
        await db_session_real.execute(select(Project).where(Project.id == project_id))
    ).scalar_one()
    assert project.is_phi is False
    project.is_phi = True
    await db_session_real.flush()
    refreshed = (
        await db_session_real.execute(select(Project).where(Project.id == project_id))
    ).scalar_one()
    assert refreshed.is_phi is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_project_is_phi_column.py -v`
Expected: FAIL — `AttributeError`/`UndefinedColumn` (no `is_phi` column).

- [ ] **Step 3: Add the model column**

In `backend/app/models/project.py`, immediately after the `is_active` column
(line 75):

```python
    # PHI policy flag. Default false (non-PHI). The parser factory's fail-closed
    # gate routes PHI projects to the self-hosted parser and never to a cloud
    # backend (ADR-0011). Threaded into create_document_parser() by the parsing
    # Celery task.
    is_phi: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

- [ ] **Step 4: Generate the migration**

```bash
cd backend && uv run alembic revision --autogenerate -m "project is_phi"
```

Rename the generated file to `0027_project_is_phi.py` and set
`revision = "0027_project_is_phi"` (24 chars ≤ 32), `down_revision = "0026_widen_template_snapshot"`.
Confirm the body is exactly the additive column with a server default so
existing rows backfill to non-PHI:

```python
def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("is_phi", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("projects", "is_phi", schema="public")
```

- [ ] **Step 5: Apply and run the test**

```bash
cd backend && uv run alembic upgrade head
uv run pytest tests/integration/test_project_is_phi_column.py -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/project.py backend/alembic/versions/0027_project_is_phi.py backend/tests/integration/test_project_is_phi_column.py
git commit -m "feat(parsing): projects.is_phi column for the fail-closed PHI gate"
```

### Task 1.3: `create_document_parser()` factory + fail-closed PHI gate

**Files:**
- Modify: `backend/app/core/factories.py`
- Test: `backend/tests/unit/test_create_document_parser.py`

**Interfaces:**
- Consumes: `settings.PARSER_BACKEND`, `settings.LLAMA_CLOUD_API_KEY` (Task 1.1);
  `DoclingParser` (Task 2.1) and `LlamaParseParser` (Task 3.1) — **import them
  lazily inside the factory** so a missing heavy dep (torch/docling) or the cloud
  SDK never breaks app import.
- Produces: `create_document_parser(settings, *, project_is_phi: bool, api_key_service: APIKeyService | None = None, llama_cloud_key: str | None = None) -> DocumentParser`.
  The Celery task (Task 5.1) calls it; the per-project parser preference is passed
  by overriding `settings.PARSER_BACKEND` at the call site via the `backend`
  argument (see signature below). **Gate rule:** when the resolved backend is
  `"llamaparse"` AND `project_is_phi` is True → fall back to `DoclingParser`
  (never raise into the user's face; log + degrade). When the resolved backend is
  `"llamaparse"`, `project_is_phi` is False, and no key is available → fall back to
  `DoclingParser`. Otherwise honor the backend.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_create_document_parser.py
from types import SimpleNamespace

import pytest

from app.core.factories import create_document_parser
from app.infrastructure.parsing.docling_parser import DoclingParser
from app.infrastructure.parsing.llamaparse_parser import LlamaParseParser


def _settings(backend="docling", llama_key=None):
    return SimpleNamespace(PARSER_BACKEND=backend, LLAMA_CLOUD_API_KEY=llama_key)


def test_default_backend_is_docling():
    parser = create_document_parser(_settings(), project_is_phi=False)
    assert isinstance(parser, DoclingParser)


def test_phi_project_never_gets_llamaparse():
    # Cloud requested but project is PHI -> fail-closed to self-hosted.
    parser = create_document_parser(
        _settings(backend="llamaparse", llama_key="lc-key"),
        project_is_phi=True,
    )
    assert isinstance(parser, DoclingParser)


def test_non_phi_llamaparse_with_key():
    parser = create_document_parser(
        _settings(backend="llamaparse", llama_key="lc-key"),
        project_is_phi=False,
        llama_cloud_key="lc-key",
    )
    assert isinstance(parser, LlamaParseParser)


def test_llamaparse_without_key_falls_back_to_docling():
    parser = create_document_parser(
        _settings(backend="llamaparse", llama_key=None),
        project_is_phi=False,
        llama_cloud_key=None,
    )
    assert isinstance(parser, DoclingParser)


def test_unknown_backend_falls_back_to_docling():
    parser = create_document_parser(_settings(backend="bogus"), project_is_phi=False)
    assert isinstance(parser, DoclingParser)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_create_document_parser.py -v`
Expected: FAIL — `ImportError: cannot import name 'create_document_parser'`.

- [ ] **Step 3: Implement the factory**

Append to `backend/app/core/factories.py` (keep the existing
`create_storage_adapter`; add the imports at the top of the new block lazily
inside the function body to avoid heavy top-level imports):

```python
from app.core.logging import get_logger

_logger = get_logger(__name__)


def create_document_parser(
    settings,
    *,
    project_is_phi: bool,
    api_key_service=None,  # APIKeyService | None — reserved for BYOK resolution
    llama_cloud_key: str | None = None,
):
    """Build a DocumentParser per PARSER_BACKEND with a fail-closed PHI gate.

    Mirrors create_storage_adapter: a single choke point that owns parser
    selection. The PHI gate is the final authority — PHI / unknown projects
    can never receive a cloud backend.

    Args:
        settings: app settings (PARSER_BACKEND, LLAMA_CLOUD_API_KEY).
        project_is_phi: True when the project handles PHI (fail-closed input).
        api_key_service: optional, reserved for future per-user key resolution.
        llama_cloud_key: resolved LlamaCloud key (BYOK > global), or None.

    Returns:
        A DocumentParser instance. Falls back to the self-hosted DoclingParser
        whenever the cloud path is unavailable or forbidden.
    """
    # Lazy imports: the heavy docling/llama_cloud deps must not load at module
    # import time (app boot, tests that never parse).
    from app.infrastructure.parsing.docling_parser import DoclingParser
    from app.infrastructure.parsing.llamaparse_parser import LlamaParseParser

    backend = (getattr(settings, "PARSER_BACKEND", "docling") or "docling").lower()

    if backend == "llamaparse":
        if project_is_phi:
            _logger.info("parser_gate_phi_forced_self_hosted")
            return DoclingParser()
        key = llama_cloud_key or getattr(settings, "LLAMA_CLOUD_API_KEY", None)
        if not key:
            _logger.warning("parser_gate_llamaparse_no_key_fallback_docling")
            return DoclingParser()
        return LlamaParseParser(api_key=key)

    if backend != "docling":
        _logger.warning("parser_gate_unknown_backend_fallback_docling", backend=backend)

    return DoclingParser()
```

> Note: this task's test imports `DoclingParser` and `LlamaParseParser`, which
> are implemented in Phases 2–3. Implement Task 2.1 (Docling) and Task 3.1
> (LlamaParse) **before** running this task's test green, or stub the two classes
> as `class DoclingParser(DocumentParser): ...` raising `NotImplementedError` in
> `parse` to satisfy the import, then fill them in. The subagent executor runs
> these in order; if running Task 1.3 standalone, do Phase 2 + Phase 3 first.

- [ ] **Step 4: Run test to verify it passes** (after Phases 2–3 land)

Run: `cd backend && uv run pytest tests/unit/test_create_document_parser.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/factories.py backend/tests/unit/test_create_document_parser.py
git commit -m "feat(parsing): create_document_parser factory + fail-closed PHI gate"
```

---

## Phase 2 — Docling adapter (standard self-hosted path)

> **Ops footprint (call out for review):** `docling` is a **new heavy
> dependency** — it pulls `torch` and downloads layout/OCR model weights on first
> use. Weights must load **once** per worker (cold start onto the Railway volume
> / cached in the image), **never per task**. The adapter lazy-imports `docling`
> inside `parse` so app boot and non-parsing tests stay light. CPU-first per
> ADR-0011; a GPU is only added if the Phase-0 bake-off shows MinerU materially
> wins.

### Task 2.1: `DoclingParser` adapter

**Files:**
- Create: `backend/app/infrastructure/parsing/docling_parser.py`
- Modify: `backend/pyproject.toml` (add `docling`)
- Test: `backend/tests/integration/test_docling_parser.py`
- Fixture: `backend/tests/fixtures/parsing/sample_two_page.pdf` (a tiny
  born-digital 2-page PDF; generate once with `reportlab` or commit a small real
  paper excerpt)

**Interfaces:**
- Consumes: `DocumentParser`, `ParsedBlock`, `normalize_block_type`,
  `assign_char_offsets_to_blocks` from `app.infrastructure.parsing.base`.
- Produces: `class DoclingParser(DocumentParser)` with
  `parse(self, pdf_bytes: bytes) -> list[ParsedBlock]`. Blocks carry
  `char_start = char_end = 0` placeholders; `DocumentParsingService` assigns real
  offsets via `assign_char_offsets_to_blocks`.

- [ ] **Step 1: Write the failing integration test**

```python
# backend/tests/integration/test_docling_parser.py
from pathlib import Path

import pytest

from app.infrastructure.parsing.base import BLOCK_TYPES, assign_char_offsets_to_blocks
from app.infrastructure.parsing.docling_parser import DoclingParser

_FIXTURE = Path(__file__).parent.parent / "fixtures" / "parsing" / "sample_two_page.pdf"

pytestmark = pytest.mark.skipif(
    not _is_docling_installed(), reason="docling not installed in this environment"
)


def _is_docling_installed() -> bool:
    import importlib.util
    return importlib.util.find_spec("docling") is not None


def test_docling_parses_blocks_with_valid_invariants():
    blocks = DoclingParser().parse(_FIXTURE.read_bytes())

    assert blocks, "expected at least one block"
    # >= 1 block per page
    pages = {b.page_number for b in blocks}
    assert pages == {1, 2}
    for page in pages:
        assert any(b.page_number == page for b in blocks)

    for b in blocks:
        assert b.page_number >= 1                      # 1-indexed
        assert b.block_type in BLOCK_TYPES             # closed-7 set
        assert set(b.bbox) == {"x", "y", "width", "height"}
        assert b.bbox["width"] >= 0 and b.bbox["height"] >= 0

    # monotonic block_index within each page
    for page in pages:
        idx = [b.block_index for b in blocks if b.page_number == page]
        assert idx == sorted(idx)
        assert idx[0] == 0

    # offset invariant (service computes these; assert the adapter is compatible)
    assign_char_offsets_to_blocks(blocks)
    from app.infrastructure.parsing.base import concat_page_text
    page_text = concat_page_text(blocks)
    for b in blocks:
        assert b.text == page_text[b.page_number][b.char_start:b.char_end]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_docling_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: app.infrastructure.parsing.docling_parser`
(or `skipif` if docling is absent — install it: `uv add docling` in Step 4).

- [ ] **Step 3: Implement the adapter**

```python
# backend/app/infrastructure/parsing/docling_parser.py
"""Docling DocumentParser adapter (standard self-hosted path).

Wraps docling's DocumentConverter. Heavy deps (torch + model weights) are
lazy-imported inside parse() so app boot and non-parsing tests stay light.
Maps docling DocItem labels onto the closed block_type set, reads bbox from
each item's prov, and emits ParsedBlock with char offsets as 0 placeholders
(DocumentParsingService assigns real offsets).
"""

from __future__ import annotations

import tempfile

from app.infrastructure.parsing.base import (
    ParsedBlock,
    normalize_block_type,
)

# docling label.value -> our closed block_type
_LABEL_MAP = {
    "section_header": "heading",
    "title": "heading",
    "list_item": "list_item",
    "caption": "figure_caption",
    "page_header": "header",
    "page_footer": "footer",
    "text": "paragraph",
    "paragraph": "paragraph",
}


class DoclingParser:
    """Self-hosted layout parser. Implements the DocumentParser port."""

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:
        from docling.document_converter import DocumentConverter
        from docling_core.types.doc import TableItem

        # docling reads from a path; write the bytes to a temp file.
        with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
            tmp.write(pdf_bytes)
            tmp.flush()
            doc = DocumentConverter().convert(tmp.name).document

        blocks: list[ParsedBlock] = []
        per_page_index: dict[int, int] = {}

        for item, _level in doc.iterate_items():
            provs = getattr(item, "prov", None) or []
            if not provs:
                continue
            prov = provs[0]
            page_no = int(getattr(prov, "page_no", 1))  # docling is 1-indexed
            bb = prov.bbox

            # bbox -> PDF user space, origin bottom-left, positive extent.
            # docling bbox coords can be top-left; use min/abs to normalise the
            # extent and keep the origin at the lower-left of the rect.
            x = min(bb.l, bb.r)
            y = min(bb.t, bb.b)
            width = abs(bb.r - bb.l)
            height = abs(bb.t - bb.b)
            bbox = {"x": float(x), "y": float(y), "width": float(width), "height": float(height)}

            if isinstance(item, TableItem):
                # Emit one table_cell block per non-empty cell.
                for cell in item.data.table_cells:
                    text = getattr(cell, "text", "").strip()
                    if not text:
                        continue
                    idx = per_page_index.get(page_no, 0)
                    per_page_index[page_no] = idx + 1
                    blocks.append(
                        ParsedBlock(
                            page_number=page_no,
                            block_index=idx,
                            text=text,
                            char_start=0,
                            char_end=0,
                            bbox=bbox,
                            block_type="table_cell",
                        )
                    )
                continue

            text = getattr(item, "text", "").strip()
            if not text:
                continue
            label = getattr(getattr(item, "label", None), "value", "")
            block_type = normalize_block_type(_LABEL_MAP.get(label, "paragraph"))
            idx = per_page_index.get(page_no, 0)
            per_page_index[page_no] = idx + 1
            blocks.append(
                ParsedBlock(
                    page_number=page_no,
                    block_index=idx,
                    text=text,
                    char_start=0,
                    char_end=0,
                    bbox=bbox,
                    block_type=block_type,
                )
            )

        if not blocks:
            raise ValueError("docling produced no text blocks")
        return blocks
```

> The class deliberately does **not** subclass `DocumentParser(ABC)` directly in
> the snippet to keep the import light, but it MUST — add
> `from app.infrastructure.parsing.base import DocumentParser` and
> `class DoclingParser(DocumentParser):` so `isinstance` checks (Task 1.3) and the
> ABC contract hold. (Plan note: the ABC import is cheap; only `docling` itself is
> heavy and stays inside `parse`.)

- [ ] **Step 4: Add the dependency + run the test**

```bash
cd backend && uv add docling
uv run pytest tests/integration/test_docling_parser.py -v
```
Expected: PASS (or `skipif` skip on environments without docling — the CI image
must install docling for this test to exercise; note the skip in the PR).

- [ ] **Step 5: Commit**

```bash
git add backend/app/infrastructure/parsing/docling_parser.py backend/pyproject.toml backend/uv.lock backend/tests/integration/test_docling_parser.py backend/tests/fixtures/parsing/sample_two_page.pdf
git commit -m "feat(parsing): Docling self-hosted DocumentParser adapter"
```

---

## Phase 3 — LlamaParse adapter (high-quality cloud path)

> Cost: agentic tier = 10 credits/page = **$0.0125/page** (~$0.19 per 15-page
> paper). `granular_bboxes` is **not** available on the `fast` tier, so the
> adapter pins `tier='agentic'`. The SDK is `llama-cloud >= 2.1` (the deprecated
> `llama_cloud_services` / `llama-parse` SDK is NOT used). Reuse the call shape +
> mapping logic from `backend/scripts/parsing_bakeoff/parsers.py`
> (`LlamaParseRunner` + `_map_llamaparse_result`) — **one mapper, not two**.

### Task 3.1: `LlamaParseParser` adapter

**Files:**
- Create: `backend/app/infrastructure/parsing/llamaparse_parser.py`
- Modify: `backend/pyproject.toml` (add `llama-cloud >= 2.1`)
- Test: `backend/tests/integration/test_llamaparse_parser.py`

**Interfaces:**
- Consumes: `DocumentParser`, `ParsedBlock`, `normalize_block_type` from
  `app.infrastructure.parsing.base`.
- Produces: `class LlamaParseParser(DocumentParser)`,
  `__init__(self, api_key: str, tier: str = "agentic")`, sync
  `parse(self, pdf_bytes: bytes) -> list[ParsedBlock]`. Blocks carry
  `char_start = char_end = 0` placeholders; bbox is **Y-flipped to bottom-left**
  (`y' = page_height - y - h`); `block_type` via `normalize_block_type`. The
  factory (Task 1.3) instantiates it.

- [ ] **Step 1: Write the failing test (mocked client)**

```python
# backend/tests/integration/test_llamaparse_parser.py
from unittest.mock import MagicMock, patch

from app.infrastructure.parsing.base import (
    BLOCK_TYPES,
    assign_char_offsets_to_blocks,
    concat_page_text,
)
from app.infrastructure.parsing.llamaparse_parser import LlamaParseParser


def _fake_result():
    # Minimal items tree + page sizes mirroring the agentic granular-bbox shape.
    # One heading + one box-less item on page 1 (page_height = 800), top-left origin.
    return MagicMock(
        pages=[MagicMock(page=1, height=800.0, width=600.0)],
        items=[
            MagicMock(type="heading", page=1, value="Results",
                      bbox={"x": 50.0, "y": 100.0, "w": 200.0, "h": 20.0}),
            MagicMock(type="text", page=1, value="A box-less line", bbox=None),
            MagicMock(type="weird_unknown", page=1, value="Mystery",
                      bbox={"x": 10.0, "y": 700.0, "w": 80.0, "h": 12.0}),
        ],
    )


def test_llamaparse_maps_items_to_blocks_with_yflip():
    with patch("llama_cloud.LlamaCloud") as cloud_cls:
        client = cloud_cls.return_value
        client.files.create.return_value = MagicMock(id="file-1")
        client.parsing.parse.return_value = _fake_result()

        blocks = LlamaParseParser(api_key="lc-key").parse(b"%PDF-1.4 fake")

        # the SDK call shape (agentic tier + granular bboxes)
        client.files.create.assert_called_once()
        _, kwargs = client.parsing.parse.call_args
        assert kwargs["tier"] == "agentic"
        assert kwargs["output_options"] == {"granular_bboxes": ["word", "line", "cell"]}
        assert set(kwargs["expand"]) == {"markdown", "items"}

    # block_type mapping: heading->heading, text->paragraph, unknown->paragraph
    by_text = {b.text: b for b in blocks}
    assert by_text["Results"].block_type == "heading"
    assert by_text["A box-less line"].block_type == "paragraph"
    assert by_text["Mystery"].block_type == "paragraph"

    for b in blocks:
        assert b.page_number == 1
        assert b.block_type in BLOCK_TYPES
        assert set(b.bbox) == {"x", "y", "width", "height"}  # never None

    # Y-flip: top-left y=100,h=20 on an 800-tall page -> bottom-left y = 800-100-20 = 680
    assert by_text["Results"].bbox["y"] == 680.0

    # box-less item gets a sentinel covering bbox, not None
    assert by_text["A box-less line"].bbox["width"] >= 0

    # 0-indexed reading-order block_index
    idx = sorted(b.block_index for b in blocks)
    assert idx[0] == 0 and idx == list(range(len(blocks)))

    # offset invariant after the service-side assignment
    assign_char_offsets_to_blocks(blocks)
    page_text = concat_page_text(blocks)
    for b in blocks:
        assert b.text == page_text[b.page_number][b.char_start:b.char_end]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_llamaparse_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: app.infrastructure.parsing.llamaparse_parser`.

- [ ] **Step 3: Implement the adapter**

```python
# backend/app/infrastructure/parsing/llamaparse_parser.py
"""LlamaParse (LlamaCloud) DocumentParser adapter (high-quality cloud path).

Cloud egress -> non-PHI projects only (gated by create_document_parser). Pins
the agentic tier so granular word/line/cell bounding boxes are available, maps
the items tree to ParsedBlock, and Y-FLIPS each bbox from LlamaParse's top-left
origin to PDF user-space bottom-left. Reuses the call shape proven in
scripts/parsing_bakeoff/parsers.py (one mapper, not two).
"""

from __future__ import annotations

import tempfile

from app.infrastructure.parsing.base import (
    DocumentParser,
    ParsedBlock,
    normalize_block_type,
)

# LlamaParse item type -> our closed block_type
_TYPE_MAP = {
    "text": "paragraph",
    "heading": "heading",
    "title": "heading",
    "list": "list_item",
    "list_item": "list_item",
    "table": "table_cell",
    "table_cell": "table_cell",
    "figure_caption": "figure_caption",
    "caption": "figure_caption",
}

# Sentinel for a box-less item: bbox is NOT NULL in the DB, so never emit None.
_SENTINEL_BBOX = {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}


class LlamaParseParser(DocumentParser):
    """High-quality cloud parser. Implements the DocumentParser port."""

    def __init__(self, api_key: str, tier: str = "agentic") -> None:
        self._api_key = api_key
        self._tier = tier

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:
        from llama_cloud import LlamaCloud  # lazy: cloud SDK, not a unit dep

        client = LlamaCloud(api_key=self._api_key)
        with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
            tmp.write(pdf_bytes)
            tmp.flush()
            uploaded = client.files.create(file=tmp.name, purpose="parse")
            result = client.parsing.parse(
                file_id=uploaded.id,
                tier=self._tier,
                version="latest",
                output_options={"granular_bboxes": ["word", "line", "cell"]},
                expand=["markdown", "items"],
            )

        return self._map_result(result)

    @staticmethod
    def _map_result(result) -> list[ParsedBlock]:
        # page_number -> page height (for the Y-flip).
        page_heights: dict[int, float] = {}
        for page in getattr(result, "pages", None) or []:
            page_heights[int(page.page)] = float(getattr(page, "height", 0.0) or 0.0)

        blocks: list[ParsedBlock] = []
        per_page_index: dict[int, int] = {}

        for item in getattr(result, "items", None) or []:
            text = (getattr(item, "value", "") or "").strip()
            if not text:
                continue
            page_no = int(getattr(item, "page", 1))
            block_type = normalize_block_type(_TYPE_MAP.get(getattr(item, "type", ""), "paragraph"))

            raw_box = getattr(item, "bbox", None)
            if raw_box:
                x = float(raw_box["x"])
                y_top = float(raw_box["y"])
                w = float(raw_box["w"])
                h = float(raw_box["h"])
                page_h = page_heights.get(page_no, 0.0)
                # Y-flip: top-left origin -> bottom-left origin.
                y_bottom = page_h - y_top - h if page_h else y_top
                bbox = {"x": x, "y": y_bottom, "width": w, "height": h}
            else:
                bbox = dict(_SENTINEL_BBOX)

            idx = per_page_index.get(page_no, 0)
            per_page_index[page_no] = idx + 1
            blocks.append(
                ParsedBlock(
                    page_number=page_no,
                    block_index=idx,
                    text=text,
                    char_start=0,
                    char_end=0,
                    bbox=bbox,
                    block_type=block_type,
                )
            )

        if not blocks:
            raise ValueError("LlamaParse produced no text blocks")
        return blocks
```

> The test patches `llama_cloud.LlamaCloud`; the adapter constructs
> `LlamaCloud(api_key=...)`. The `block_index` in the test is sequential because
> all fixture items are on page 1; the global 0-indexed assertion holds. If the
> SDK's real field names differ at the live Phase-0 run, fix them **in this one
> mapper and in `scripts/parsing_bakeoff/parsers.py::_map_llamaparse_result`
> together** so the two stay identical.

- [ ] **Step 4: Add the dependency + run the test**

```bash
cd backend && uv add 'llama-cloud>=2.1'
uv run pytest tests/integration/test_llamaparse_parser.py -v
```
Expected: PASS (the test mocks the client; no network/key needed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/infrastructure/parsing/llamaparse_parser.py backend/pyproject.toml backend/uv.lock backend/tests/integration/test_llamaparse_parser.py
git commit -m "feat(parsing): LlamaParse cloud DocumentParser adapter (agentic, granular bbox, Y-flip)"
```

### Task 3.2: Teach `APIKeyService` + `UserAPIKey` the `llama_cloud` provider

**Files:**
- Modify: `backend/app/models/user_api_key.py:24,116-120`
- Create: `backend/alembic/versions/0028_api_key_llama_cloud.py`
- Modify: `backend/app/services/api_key_service.py` (`_get_global_key`,
  `_validate_key`, new `_validate_llama_cloud`)
- Test: `backend/tests/integration/test_api_key_llama_cloud.py`

**Interfaces:**
- Consumes: `settings.LLAMA_CLOUD_API_KEY` (Task 1.1).
- Produces: `APIKeyService.get_key_for_provider("llama_cloud")` resolves a BYOK
  key (default) with fallback to the global key; `save_key(provider="llama_cloud", ...)`
  passes the `SUPPORTED_PROVIDERS` check and the DB CHECK constraint. Phase 4's
  frontend toggle relies on a stored `llama_cloud` key existing.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_api_key_llama_cloud.py
import pytest

from app.models.user_api_key import SUPPORTED_PROVIDERS
from app.services.api_key_service import APIKeyService


def test_llama_cloud_is_a_supported_provider():
    assert "llama_cloud" in SUPPORTED_PROVIDERS


@pytest.mark.asyncio
async def test_save_and_resolve_llama_cloud_key(db_session_real, seed):
    svc = APIKeyService(db_session_real, user_id=seed.user_id)
    await svc.save_key(provider="llama_cloud", api_key="lc-secret", validate=False)
    await db_session_real.flush()
    resolved = await svc.get_key_for_provider("llama_cloud", use_fallback=False)
    assert resolved == "lc-secret"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_api_key_llama_cloud.py -v`
Expected: FAIL — `"llama_cloud" not in SUPPORTED_PROVIDERS` / save_key raises
`Provider 'llama_cloud' is not supported`.

- [ ] **Step 3: Widen the model + add the migration + teach the service**

In `backend/app/models/user_api_key.py`, line 24:

```python
SUPPORTED_PROVIDERS = ("openai", "anthropic", "gemini", "grok", "llama_cloud")
```

And the `CheckConstraint` (line 117-120):

```python
        CheckConstraint(
            "provider IN ('openai', 'anthropic', 'gemini', 'grok', 'llama_cloud')",
            name="user_api_keys_provider_check",
        ),
```

Generate + rename the migration to `0028_api_key_llama_cloud.py`
(`revision = "0028_api_key_llama_cloud"`, 25 chars ≤ 32,
`down_revision = "0027_project_is_phi"`), replacing the CHECK constraint:

```python
def upgrade() -> None:
    op.drop_constraint("user_api_keys_provider_check", "user_api_keys", schema="public")
    op.create_check_constraint(
        "user_api_keys_provider_check",
        "user_api_keys",
        "provider IN ('openai', 'anthropic', 'gemini', 'grok', 'llama_cloud')",
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint("user_api_keys_provider_check", "user_api_keys", schema="public")
    op.create_check_constraint(
        "user_api_keys_provider_check",
        "user_api_keys",
        "provider IN ('openai', 'anthropic', 'gemini', 'grok')",
        schema="public",
    )
```

In `backend/app/services/api_key_service.py`, extend `_get_global_key` (line 242):

```python
        if provider == "openai":
            return settings.OPENAI_API_KEY
        if provider == "llama_cloud":
            return settings.LLAMA_CLOUD_API_KEY
        # Other providers can be added once global keys are configured
        return None
```

Add the `llama_cloud` case to `_validate_key` (after the `grok` branch, line 391):

```python
            elif provider == "llama_cloud":
                return await self._validate_llama_cloud(api_key)
```

And the validator (mirror `_validate_grok`):

```python
    async def _validate_llama_cloud(self, api_key: str) -> dict[str, Any]:
        """Validate a LlamaCloud API key with a lightweight authed GET."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.cloud.llamaindex.ai/api/v1/parsing/supported_file_extensions",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10.0,
            )
            if response.status_code == 200:
                return {"status": "valid", "message": "Valid API key"}
            elif response.status_code in (401, 403):
                return {"status": "invalid", "message": "Invalid API key"}
            elif response.status_code == 429:
                return {"status": "valid", "message": "Valid API key (rate limited)"}
            else:
                return {"status": "invalid", "message": f"Error: {response.status_code}"}
```

- [ ] **Step 4: Apply the migration + run the test**

```bash
cd backend && uv run alembic upgrade head
uv run pytest tests/integration/test_api_key_llama_cloud.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/user_api_key.py backend/alembic/versions/0028_api_key_llama_cloud.py backend/app/services/api_key_service.py backend/tests/integration/test_api_key_llama_cloud.py
git commit -m "feat(parsing): llama_cloud BYOK provider in APIKeyService + CHECK constraint"
```

---

## Phase 4 — Per-project activation

### Task 4.1: `ParserSettingsService` over `Project.settings['parsing']`

**Files:**
- Create: `backend/app/services/parser_settings_service.py`
- Test: `backend/tests/integration/test_parser_settings_service.py`

**Interfaces:**
- Consumes: `ProjectRepository.get_by_id` (the same repo
  `ManagerReviewVisibilityService` uses).
- Produces:
  `ParserSettingsService(db).set_for_project(*, project_id, parser_type) -> dict[str, str]`
  writing `Project.settings["parsing"] = {"type": parser_type}` where
  `parser_type ∈ {"standard", "llamaparse"}`;
  `ParserSettingsService(db).get_for_project(project_id) -> str` returning the
  stored type (default `"standard"`). Raises `ProjectNotFoundError`. The Celery
  task (Task 5.1) reads `get_for_project` to map to `PARSER_BACKEND`
  (`standard → docling`, `llamaparse → llamaparse`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_parser_settings_service.py
import pytest

from app.services.parser_settings_service import (
    ParserSettingsService,
    ProjectNotFoundError,
)


@pytest.mark.asyncio
async def test_default_is_standard(db_session_real, seed):
    svc = ParserSettingsService(db_session_real)
    assert await svc.get_for_project(seed.project_id) == "standard"


@pytest.mark.asyncio
async def test_set_and_get_llamaparse(db_session_real, seed):
    svc = ParserSettingsService(db_session_real)
    merged = await svc.set_for_project(project_id=seed.project_id, parser_type="llamaparse")
    assert merged == {"type": "llamaparse"}
    assert await svc.get_for_project(seed.project_id) == "llamaparse"


@pytest.mark.asyncio
async def test_rejects_unknown_type(db_session_real, seed):
    svc = ParserSettingsService(db_session_real)
    with pytest.raises(ValueError):
        await svc.set_for_project(project_id=seed.project_id, parser_type="bogus")


@pytest.mark.asyncio
async def test_missing_project_raises(db_session_real):
    import uuid
    svc = ParserSettingsService(db_session_real)
    with pytest.raises(ProjectNotFoundError):
        await svc.get_for_project(uuid.uuid4())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_parser_settings_service.py -v`
Expected: FAIL — `ModuleNotFoundError: app.services.parser_settings_service`.

- [ ] **Step 3: Implement the service** (mirror `ManagerReviewVisibilityService`)

```python
# backend/app/services/parser_settings_service.py
"""Service for the per-project parser-backend setting.

Owns the ``parsing`` sub-dict inside ``projects.settings``:
``{"type": "standard" | "llamaparse"}``. Mirrors
ManagerReviewVisibilityService (plain JSONB, reassign-to-track).
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.project_repository import ProjectRepository

_VALID_TYPES = ("standard", "llamaparse")
_DEFAULT_TYPE = "standard"


class ProjectNotFoundError(Exception):
    """Raised when the project row is missing. HTTP translation in the router."""


class ParserSettingsService:
    """Owns the ``parsing`` map inside projects.settings."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._projects = ProjectRepository(db)

    async def get_for_project(self, project_id: UUID) -> str:
        project = await self._projects.get_by_id(project_id)
        if project is None:
            raise ProjectNotFoundError(f"Project {project_id} not found")
        parsing = dict((project.settings or {}).get("parsing") or {})
        ptype = parsing.get("type", _DEFAULT_TYPE)
        return ptype if ptype in _VALID_TYPES else _DEFAULT_TYPE

    async def set_for_project(self, *, project_id: UUID, parser_type: str) -> dict[str, str]:
        if parser_type not in _VALID_TYPES:
            raise ValueError(f"parser_type must be one of {_VALID_TYPES}, got {parser_type!r}")
        project = await self._projects.get_by_id(project_id)
        if project is None:
            raise ProjectNotFoundError(f"Project {project_id} not found")
        # projects.settings is plain JSONB (NOT MutableDict): build a new dict
        # and REASSIGN, or the change is not tracked and never persists.
        settings = dict(project.settings or {})
        settings["parsing"] = {"type": parser_type}
        project.settings = settings  # reassignment -> dirty-tracked
        await self.db.flush()
        return {"type": parser_type}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/integration/test_parser_settings_service.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/parser_settings_service.py backend/tests/integration/test_parser_settings_service.py
git commit -m "feat(parsing): ParserSettingsService over projects.settings['parsing']"
```

### Task 4.2: Manager-only `PUT /projects/{project_id}/parser-settings`

**Files:**
- Create: `backend/app/schemas/parser_settings.py`
- Create: `backend/app/api/v1/endpoints/parser_settings.py`
- Modify: `backend/app/api/v1/router.py:84-89` (register under `/projects`)
- Test: `backend/tests/integration/test_parser_settings_endpoint.py`

**Interfaces:**
- Consumes: `ParserSettingsService` (Task 4.1), `require_project_manager`,
  `ensure_project_member`, `ApiResponse`.
- Produces: `PUT /api/v1/projects/{project_id}/parser-settings` accepting
  `ParserSettingsPayload(type: Literal["standard","llamaparse"])` and returning
  `ApiResponse[ParserSettingsRead]` (`{type: ...}`). The frontend service
  (Task 4.3) calls it.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_parser_settings_endpoint.py
import pytest


@pytest.mark.asyncio
async def test_manager_can_set_parser_type(client, seed_manager_auth):
    project_id = seed_manager_auth.project_id
    resp = await client.put(
        f"/api/v1/projects/{project_id}/parser-settings",
        json={"type": "llamaparse"},
        headers=seed_manager_auth.headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"]["type"] == "llamaparse"


@pytest.mark.asyncio
async def test_reviewer_forbidden(client, seed_reviewer_auth):
    project_id = seed_reviewer_auth.project_id
    resp = await client.put(
        f"/api/v1/projects/{project_id}/parser-settings",
        json={"type": "llamaparse"},
        headers=seed_reviewer_auth.headers,
    )
    assert resp.status_code == 403
```

> Use whatever the project's existing endpoint integration tests use for an
> authed manager / reviewer client — model this test on
> `backend/tests/integration/test_manager_review_visibility*.py` (same
> `require_project_manager` gate, same `ApiResponse` envelope). Reuse its
> fixtures verbatim.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_parser_settings_endpoint.py -v`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Implement schema + endpoint + register**

```python
# backend/app/schemas/parser_settings.py
"""Schemas for the per-project parser-backend setting."""

from typing import Literal

from pydantic import BaseModel

ParserType = Literal["standard", "llamaparse"]


class ParserSettingsPayload(BaseModel):
    type: ParserType


class ParserSettingsRead(BaseModel):
    type: ParserType
```

```python
# backend/app/api/v1/endpoints/parser_settings.py
"""Endpoint for the per-project parser-backend setting."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.parser_settings import ParserSettingsPayload, ParserSettingsRead
from app.services.parser_settings_service import (
    ParserSettingsService,
    ProjectNotFoundError,
)

router = APIRouter()


@router.put("/{project_id}/parser-settings")
async def set_parser_settings(
    project_id: UUID,
    body: ParserSettingsPayload,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[ParserSettingsRead]:
    trace_id = getattr(request.state, "trace_id", None)
    try:
        merged = await ParserSettingsService(db).set_for_project(
            project_id=project_id,
            parser_type=body.type,
        )
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(ParserSettingsRead(**merged), trace_id=trace_id)
```

Register in `backend/app/api/v1/router.py` (add the import to the endpoints
import block, then after the `manager_review_visibility` block, line ~89):

```python
api_router.include_router(
    parser_settings.router,
    prefix="/projects",
    tags=["projects"],
)
```

- [ ] **Step 4: Run test + regenerate the API contract**

```bash
cd backend && uv run pytest tests/integration/test_parser_settings_endpoint.py -v
cd .. && npm run generate:api-types   # API-Contract gate: commit the diff
```
Expected: test PASS; `frontend/types/api/{openapi.json,schema.d.ts}` updated.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/parser_settings.py backend/app/api/v1/endpoints/parser_settings.py backend/app/api/v1/router.py backend/tests/integration/test_parser_settings_endpoint.py frontend/types/api/openapi.json frontend/types/api/schema.d.ts
git commit -m "feat(parsing): manager-only PUT /projects/{id}/parser-settings + API contract"
```

### Task 4.3: Frontend per-project "High-quality parsing" toggle

**Files:**
- Create: `frontend/services/parserSettingsService.ts`
- Create: `frontend/components/project/settings/HighQualityParsingToggle.tsx`
- Modify: `frontend/components/project/settings/AdvancedSettingsSection.tsx`
  (render the toggle in the Advanced tab)
- Modify: `frontend/lib/copy/...` (add copy keys)
- Test: `frontend/test/components/HighQualityParsingToggle.test.tsx`

**Interfaces:**
- Consumes: the typed `apiClient` and the generated
  `components['schemas']['ParserSettingsPayload' | 'ParserSettingsRead']` from
  `frontend/types/api/schema.d.ts` (regenerated in Task 4.2 — do NOT hand-mirror).
- Produces: `setParserType(projectId, type)` service fn; a `HighQualityParsingToggle`
  component that mirrors `ManagerReviewVisibilityToggle` (optimistic Switch,
  render-phase prev-sync, `sonner` toast). When ON it sets `type="llamaparse"`;
  it is **disabled with a hint when no `llama_cloud` BYOK key is stored**
  (mirroring how Zotero/other integrations require credentials first).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/test/components/HighQualityParsingToggle.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HighQualityParsingToggle } from '@/components/project/settings/HighQualityParsingToggle';

vi.mock('@/services/parserSettingsService', () => ({
  setParserType: vi.fn().mockResolvedValue({ type: 'llamaparse' }),
}));

describe('HighQualityParsingToggle', () => {
  it('disables the switch when no llama_cloud key is configured', () => {
    render(
      <HighQualityParsingToggle
        projectId="p1"
        currentType="standard"
        hasLlamaCloudKey={false}
        disabled={false}
      />,
    );
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('enables the switch when a key is present and the user is a manager', () => {
    render(
      <HighQualityParsingToggle
        projectId="p1"
        currentType="standard"
        hasLlamaCloudKey={true}
        disabled={false}
      />,
    );
    expect(screen.getByRole('switch')).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (repo root): `npm run test:run -- HighQualityParsingToggle`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service + component + copy**

```ts
// frontend/services/parserSettingsService.ts
/**
 * Parser-settings service — typed IO for the per-project parser backend.
 * Throws ApiError on failure (the apiClient contract) — callers handle it.
 */
import { apiClient } from '@/integrations/api';
import type { components } from '@/types/api/schema';

type ParserType = components['schemas']['ParserSettingsPayload']['type'];
type ParserSettingsRead = components['schemas']['ParserSettingsRead'];

export function setParserType(
  projectId: string,
  type: ParserType,
): Promise<ParserSettingsRead> {
  const body: components['schemas']['ParserSettingsPayload'] = { type };
  return apiClient<ParserSettingsRead>(
    `/api/v1/projects/${projectId}/parser-settings`,
    { method: 'PUT', body },
  );
}
```

```tsx
// frontend/components/project/settings/HighQualityParsingToggle.tsx
/**
 * Per-project high-quality-parsing toggle (LlamaParse).
 *
 * Manager-only control. When ON, newly ingested PDFs are parsed by the cloud
 * LlamaParse backend (non-PHI projects only — the backend factory fail-closes
 * PHI projects to the self-hosted parser regardless). Requires a stored
 * `llama_cloud` BYOK key, mirroring how other integrations are activated.
 */
import { useState } from 'react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { t } from '@/lib/copy';
import { setParserType } from '@/services/parserSettingsService';

interface HighQualityParsingToggleProps {
  projectId: string;
  currentType: 'standard' | 'llamaparse';
  /** True when the user has a stored llama_cloud BYOK key. */
  hasLlamaCloudKey: boolean;
  /** Disabled unless the viewer is a manager. */
  disabled?: boolean;
}

export function HighQualityParsingToggle({
  projectId,
  currentType,
  hasLlamaCloudKey,
  disabled = false,
}: HighQualityParsingToggleProps) {
  const [checked, setChecked] = useState(currentType === 'llamaparse');
  const [saving, setSaving] = useState(false);

  // render-phase prev-sync (codebase idiom) so a late settings load re-syncs.
  const [prevType, setPrevType] = useState(currentType);
  if (prevType !== currentType) {
    setPrevType(currentType);
    setChecked(currentType === 'llamaparse');
  }

  const onToggle = (next: boolean) => {
    setChecked(next); // optimistic
    setSaving(true);
    setParserType(projectId, next ? 'llamaparse' : 'standard')
      .then(() => toast.success(t('parsing', 'parserSaved')))
      .catch((e: unknown) => {
        setChecked(!next); // revert
        toast.error(e instanceof Error ? e.message : t('parsing', 'parserError'));
      })
      .finally(() => setSaving(false));
  };

  const id = 'high-quality-parsing';
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {t('parsing', 'highQualityLabel')}
        </label>
        <p className="text-xs text-muted-foreground">
          {hasLlamaCloudKey ? t('parsing', 'highQualityHint') : t('parsing', 'highQualityNeedsKey')}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled || saving || !hasLlamaCloudKey}
        onCheckedChange={onToggle}
      />
    </div>
  );
}
```

Add the copy keys under a `parsing` namespace in `frontend/lib/copy/` (match the
existing copy-module structure — e.g. add a `parsing` section with
`highQualityLabel`, `highQualityHint`, `highQualityNeedsKey`, `parserSaved`,
`parserError`). English only.

Render `<HighQualityParsingToggle .../>` inside `AdvancedSettingsSection.tsx`,
passing `currentType` from the loaded project settings, `hasLlamaCloudKey` from
the user's stored-keys query (the same hook the API-keys settings page uses), and
`disabled={!isManager}`.

- [ ] **Step 4: Run test to verify it passes**

Run (repo root): `npm run test:run -- HighQualityParsingToggle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/services/parserSettingsService.ts frontend/components/project/settings/HighQualityParsingToggle.tsx frontend/components/project/settings/AdvancedSettingsSection.tsx frontend/lib/copy frontend/test/components/HighQualityParsingToggle.test.tsx
git commit -m "feat(parsing): per-project high-quality parsing toggle (LlamaParse, BYOK-gated)"
```

---

## Phase 5 — Celery task

### Task 5.1: `parse_article_file_task`

**Files:**
- Create: `backend/app/worker/tasks/parsing_tasks.py`
- Test: `backend/tests/integration/test_parse_article_file_task.py`

**Interfaces:**
- Consumes: `worker_session`, `run_task`, `get_supabase_client`,
  `create_storage_adapter`, `create_document_parser` (Task 1.3),
  `ParserSettingsService.get_for_project` (Task 4.1), `DocumentParsingService`,
  `Project.is_phi` (Task 1.2).
- Produces: `parse_article_file_task.delay(article_file_id, project_id, user_id, trace_id=None)`.
  Loads the `Project` (reads `is_phi`), resolves the per-project parser preference
  (`standard → "docling"`, `llamaparse → "llamaparse"` — overriding
  `settings.PARSER_BACKEND` for this call), resolves the BYOK `llama_cloud` key via
  `APIKeyService`, builds the parser via `create_document_parser`, runs
  `DocumentParsingService(...).parse_article_file(...)`, commits. The ingest hook
  (Task 6.1) enqueues it.

- [ ] **Step 1: Write the failing integration test**

```python
# backend/tests/integration/test_parse_article_file_task.py
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.infrastructure.parsing.base import ParsedBlock
from app.models.article import ArticleFile, ArticleTextBlock


class _FakeParser:
    def parse(self, pdf_bytes: bytes):  # noqa: ARG002
        return [
            ParsedBlock(1, 0, "Hello", 0, 0, {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}, "paragraph"),
        ]


class _BoomParser:
    def parse(self, pdf_bytes: bytes):  # noqa: ARG002
        raise ValueError("parse exploded")


@pytest.mark.asyncio
async def test_task_populates_blocks_and_flips_status(db_session_real, seed_article_file):
    af_id = seed_article_file.article_file_id
    project_id = seed_article_file.project_id
    user_id = seed_article_file.user_id

    with patch("app.core.factories.create_document_parser", return_value=_FakeParser()), \
         patch("app.core.factories.create_storage_adapter") as storage_factory:
        storage_factory.return_value.download.return_value = b"%PDF-1.4 fake"
        # call the task body synchronously via its inner run() (see note)
        from app.worker.tasks.parsing_tasks import _run_parse  # exposed for testing
        await _run_parse(str(af_id), str(project_id), user_id, trace_id="t-1")

    blocks = (
        await db_session_real.execute(
            select(ArticleTextBlock).where(ArticleTextBlock.article_file_id == af_id)
        )
    ).scalars().all()
    assert len(blocks) == 1
    af = (
        await db_session_real.execute(select(ArticleFile).where(ArticleFile.id == af_id))
    ).scalar_one()
    assert af.extraction_status == "parsed"
```

> Expose the inner coroutine as a module-level `async def _run_parse(...)` that
> the Celery task wraps, so the integration test can await it against
> `db_session_real` without Celery's eager mode and without the `worker_session()`
> engine (the test passes the real session through). The `delay`-level task wraps
> `_run_parse` in `worker_session()` + `run_task()` + retry, per the worker
> pattern. The error-path retry → `parse_failed` is covered by a second test that
> patches the parser to `_BoomParser` and asserts the task calls `self.retry` and
> the status lands `parse_failed`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_parse_article_file_task.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the task**

```python
# backend/app/worker/tasks/parsing_tasks.py
"""Parsing Celery task — parse a single ArticleFile at ingest.

Follows the worker pattern: a synchronous Celery entry point wrapping an inner
async coroutine via worker_session() + run_task(). The parser is built by the
create_document_parser() factory, which owns the PARSER_BACKEND switch and the
fail-closed PHI gate.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from celery import Task
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.worker._runner import run_task
from app.worker.celery_app import celery_app


async def _run_parse(
    article_file_id: str,
    project_id: str,
    user_id: str,
    trace_id: str | None,
    db: AsyncSession | None = None,
) -> dict[str, Any]:
    """Resolve the per-project parser and parse one ArticleFile.

    When *db* is provided (tests) it is used directly; otherwise a
    worker_session() is opened and committed here.
    """
    from app.core.config import settings as app_settings
    from app.core.deps import get_supabase_client
    from app.core.factories import create_document_parser, create_storage_adapter
    from app.models.project import Project
    from app.services.api_key_service import APIKeyService
    from app.services.document_parsing_service import DocumentParsingService
    from app.services.parser_settings_service import ParserSettingsService
    from app.worker._session import worker_session

    async def _body(session: AsyncSession) -> dict[str, Any]:
        project = (
            await session.execute(select(Project).where(Project.id == UUID(project_id)))
        ).scalar_one()

        # per-project parser preference -> PARSER_BACKEND value
        pref = await ParserSettingsService(session).get_for_project(UUID(project_id))
        backend = "llamaparse" if pref == "llamaparse" else "docling"

        # BYOK llama_cloud key (default > global); only relevant for llamaparse
        llama_key = None
        if backend == "llamaparse":
            llama_key = await APIKeyService(session, user_id).get_key_for_provider("llama_cloud")

        # override PARSER_BACKEND for this call without mutating global settings
        from types import SimpleNamespace
        call_settings = SimpleNamespace(
            PARSER_BACKEND=backend,
            LLAMA_CLOUD_API_KEY=app_settings.LLAMA_CLOUD_API_KEY,
        )
        parser = create_document_parser(
            call_settings,
            project_is_phi=bool(project.is_phi),
            llama_cloud_key=llama_key,
        )

        supabase = get_supabase_client()
        storage = create_storage_adapter(supabase)
        service = DocumentParsingService(
            db=session,
            user_id=user_id,
            storage=storage,
            parser=parser,
            trace_id=trace_id or "",
        )
        result = await service.parse_article_file(UUID(article_file_id))
        return {
            "block_count": result.block_count,
            "page_count": result.page_count,
            "status": result.status,
        }

    if db is not None:
        return await _body(db)

    async with worker_session() as session:
        try:
            out = await _body(session)
            await session.commit()
            return out
        except Exception:
            await session.rollback()
            raise


@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    rate_limit="10/m",
)
def parse_article_file_task(
    self: Task[Any, Any],
    article_file_id: str,
    project_id: str,
    user_id: str,
    trace_id: str | None = None,
) -> dict[str, Any]:
    """Parse one ArticleFile and persist its text blocks."""

    def run() -> dict[str, Any]:
        return run_task(
            lambda: _run_parse(article_file_id, project_id, user_id, trace_id or self.request.id)
        )

    try:
        return run()
    except Exception as exc:
        self.retry(exc=exc)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/integration/test_parse_article_file_task.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/worker/tasks/parsing_tasks.py backend/tests/integration/test_parse_article_file_task.py
git commit -m "feat(parsing): parse_article_file_task (per-project parser + PHI gate)"
```

---

## Phase 6 — Single ingest hook for all routes

### Task 6.1: `ArticleFileIngestService.enqueue_parse_at_ingest` + Zotero wiring

**Files:**
- Create: `backend/app/services/article_file_ingest_service.py`
- Modify: `backend/app/services/zotero_import_service.py:454` (call the hook
  after `ArticleFile.create`)
- Test: `backend/tests/integration/test_article_file_ingest_service.py`

**Interfaces:**
- Consumes: `parse_article_file_task` (Task 5.1). The service does **not** open a
  session — it is a thin enqueue wrapper so any ingest route can call it after it
  has created the `ArticleFile`.
- Produces:
  `ArticleFileIngestService.enqueue_parse_at_ingest(*, article_file_id, project_id, user_id, trace_id) -> str`
  (returns the Celery task id). Reads nothing from the DB here — the per-project
  parser preference + PHI flag are resolved inside the task (single source of
  truth, Task 5.1), so the hook stays route-agnostic and a future direct-upload
  route reuses it unchanged.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_article_file_ingest_service.py
from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.services.article_file_ingest_service import ArticleFileIngestService


def test_enqueue_parse_at_ingest_dispatches_task():
    af_id, project_id, user_id = uuid4(), uuid4(), str(uuid4())
    with patch(
        "app.services.article_file_ingest_service.parse_article_file_task"
    ) as task:
        task.delay.return_value = MagicMock(id="task-123")
        task_id = ArticleFileIngestService().enqueue_parse_at_ingest(
            article_file_id=af_id,
            project_id=project_id,
            user_id=user_id,
            trace_id="t-1",
        )
    assert task_id == "task-123"
    task.delay.assert_called_once_with(
        article_file_id=str(af_id),
        project_id=str(project_id),
        user_id=user_id,
        trace_id="t-1",
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_article_file_ingest_service.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service + wire Zotero**

```python
# backend/app/services/article_file_ingest_service.py
"""Single parse-at-ingest hook for ALL ingest routes.

Every code path that creates an ArticleFile (Zotero today, direct-upload and
future routes) MUST call enqueue_parse_at_ingest immediately after the row is
created. This is the only sanctioned way to trigger parsing at ingest; the
per-project parser preference and PHI flag are resolved inside the Celery task
(single source of truth), so this hook stays route-agnostic.
"""

from __future__ import annotations

from uuid import UUID

from app.worker.tasks.parsing_tasks import parse_article_file_task


class ArticleFileIngestService:
    """Thin enqueue wrapper — no DB session, route-agnostic."""

    def enqueue_parse_at_ingest(
        self,
        *,
        article_file_id: UUID,
        project_id: UUID,
        user_id: str,
        trace_id: str | None,
    ) -> str:
        """Enqueue parse_article_file_task for a freshly created ArticleFile.

        Returns:
            The Celery task id.
        """
        async_result = parse_article_file_task.delay(
            article_file_id=str(article_file_id),
            project_id=str(project_id),
            user_id=user_id,
            trace_id=trace_id,
        )
        return async_result.id
```

In `backend/app/services/zotero_import_service.py`, immediately after
`await self._article_files.create(article_file)` (line 454):

```python
            await self._article_files.create(article_file)
            # Single parse-at-ingest hook — every ArticleFile-create route uses it.
            ArticleFileIngestService().enqueue_parse_at_ingest(
                article_file_id=article_file.id,
                project_id=project_id,
                user_id=str(self.user_id),
                trace_id=self.trace_id,
            )
            return True
```

Add the import at the top of `zotero_import_service.py`:
`from app.services.article_file_ingest_service import ArticleFileIngestService`.

> `article_file.id` is populated after the repository's `create` flushes. If the
> repo's `create` does not flush, add `await self.db.flush()` before reading
> `article_file.id`. Confirm against `ArticleFileRepository.create`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/integration/test_article_file_ingest_service.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/article_file_ingest_service.py backend/app/services/zotero_import_service.py backend/tests/integration/test_article_file_ingest_service.py
git commit -m "feat(parsing): single parse-at-ingest hook wired into Zotero import"
```

### Task 6.2: Fitness test — no `ArticleFile`-create site bypasses the hook

**Files:**
- Create: `backend/tests/fitness/test_article_file_create_uses_hook.py`

**Interfaces:**
- Consumes: nothing (a source-grep fitness test, like the existing
  `scripts/fitness/` checks).
- Produces: a test that fails if any `app/` file constructs `ArticleFile(` or
  calls `article_files.create` **outside** the sanctioned set
  (`zotero_import_service.py`, the ingest service itself, and the `unit_of_work`
  docstring) without also importing `ArticleFileIngestService`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/fitness/test_article_file_create_uses_hook.py
"""Fitness: every ArticleFile-create site must route through the ingest hook.

Greps app/ for ArticleFile-construction / article_files.create call sites and
asserts none bypass ArticleFileIngestService.enqueue_parse_at_ingest. New ingest
routes added later are caught here.
"""

import re
from pathlib import Path

_APP = Path(__file__).parent.parent.parent / "app"

# Files allowed to create an ArticleFile. Each MUST also enqueue the parse hook
# (or BE the hook). unit_of_work.py only mentions it in a docstring example.
_ALLOWED = {
    "services/zotero_import_service.py",
    "services/article_file_ingest_service.py",
    "repositories/unit_of_work.py",
}

_CREATE_PAT = re.compile(r"\bArticleFile\(|article_files\.create\(")


def _rel(path: Path) -> str:
    return str(path.relative_to(_APP)).replace("\\", "/")


def test_no_articlefile_create_bypasses_the_ingest_hook():
    offenders: list[str] = []
    for py in _APP.rglob("*.py"):
        text = py.read_text(encoding="utf-8")
        if not _CREATE_PAT.search(text):
            continue
        rel = _rel(py)
        if rel in _ALLOWED:
            continue
        offenders.append(rel)
    assert not offenders, (
        "ArticleFile-create site(s) bypass the parse-at-ingest hook: "
        f"{offenders}. Route them through ArticleFileIngestService."
    )
```

- [ ] **Step 2: Run test to verify it passes now**

Run: `cd backend && uv run pytest tests/fitness/test_article_file_create_uses_hook.py -v`
Expected: PASS (the only live create site is Zotero, which is allow-listed).
If it FAILS, an unexpected create site exists — investigate and route it through
the hook rather than widening `_ALLOWED`.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/fitness/test_article_file_create_uses_hook.py
git commit -m "test(parsing): fitness guard — no ArticleFile-create bypasses the ingest hook"
```

---

## Phase 7 — No-legacy cleanup + simplify

### Task 7.1: Sweep for bypasses + dead pre-wiring; run `/simplify`

**Files:**
- Touch: any new/changed backend file in Phases 1–6.

- [ ] **Step 1: Confirm no scattered create sites + no dead stubs**

```bash
cd backend && grep -rn "ArticleFile(\|article_files.create(" app/
```
Expected: only `zotero_import_service.py` and `article_file_ingest_service.py`
(and the `unit_of_work.py` docstring). If a new site appeared, route it through
`ArticleFileIngestService.enqueue_parse_at_ingest`. Remove any temporary stub
(e.g. a placeholder `DoclingParser`/`LlamaParseParser` left from Task 1.3) now
that the real adapters exist.

- [ ] **Step 2: Run the full backend gate**

```bash
make lint-backend
make test-backend
```
Expected: lint clean; all new tests + the suite green. Local Supabase Docker must
be running for the integration tests.

- [ ] **Step 3: Run `/simplify` over the new/changed backend code**

Invoke the `simplify` skill (or `superpowers` simplify) scoped to the files
created/modified in Phases 1–6. Apply the reuse/efficiency/altitude cleanups it
surfaces (e.g. collapsing the two adapters' shared label-map plumbing only if it
does not couple Docling and LlamaParse; tightening the factory; removing any
leftover placeholder). Re-run `make test-backend` after applying.

- [ ] **Step 4: Frontend gate (toggle touched the FE)**

```bash
npm run lint
npm run test:run
```
Expected: clean + green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(parsing): simplify pass over dual-path ingest backbone"
```

---

## Follow-up plan

Everything that *consumes* the blocks this plan produces — the markdown
projection (`render_blocks_to_markdown` beside `concat_page_text`), the markdown
viewer mode, and citation marking (anchoring AI quotes to bboxes + markdown
offsets) — lives in
`docs/superpowers/plans/2026-06-20-markdown-view-and-markdown-citations.md`. That
plan depends on this one having populated `article_text_blocks` for every
ingested article.

---

## Self-Review

- **Spec coverage:** every spec phase maps to a task. Phase 1 config →
  Task 1.1; `Project.is_phi` migration (≤32-char revision) → Task 1.2; factory +
  fail-closed PHI gate → Task 1.3. Docling adapter (with the heavy-dep/lazy-load
  call-out) → Task 2.1. LlamaParse adapter (`agentic` tier, `granular_bboxes`,
  Y-flip, sentinel bbox, `normalize_block_type`) → Task 3.1; `APIKeyService` +
  `SUPPORTED_PROVIDERS` + CHECK constraint + `_validate_llama_cloud` +
  `_get_global_key` → Task 3.2. Per-project `ParserSettingsService` →
  Task 4.1; manager-only `PUT .../parser-settings` (BOLA via
  `require_project_manager`, typed Pydantic, API-contract regen) → Task 4.2;
  frontend BYOK-gated toggle → Task 4.3. Celery `parse_article_file_task`
  (bind/retries/rate_limit, `worker_session`, factory, PHI gate, error→retry→
  `parse_failed`) → Task 5.1. Single ingest hook for all routes + Zotero wiring →
  Task 6.1; grep/fitness no-bypass guard → Task 6.2. No-legacy cleanup +
  `/simplify` → Task 7.1. Markdown/citations explicitly deferred to the follow-up.
- **Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N" — every
  code step shows real code; every command shows the expected result. The one
  forward-reference (Task 1.3 imports the Phase 2/3 adapters) is called out with
  ordering guidance, not left implicit.
- **Type consistency:** `DocumentParser.parse(pdf_bytes) -> list[ParsedBlock]`,
  `ParsedBlock(page_number, block_index, text, char_start, char_end, bbox, block_type)`,
  `normalize_block_type`, `assign_char_offsets_to_blocks`, `concat_page_text`,
  `DocumentParsingService(db, user_id, storage, parser, trace_id).parse_article_file`,
  `DocumentParsingResult(block_count, page_count, status)`,
  `create_storage_adapter`, `require_project_manager`, `ApiResponse.success`,
  `ProjectRepository.get_by_id`, `SUPPORTED_PROVIDERS`,
  `get_key_for_provider("llama_cloud")` — all match the real interfaces read from
  the codebase. `create_document_parser(settings, *, project_is_phi, api_key_service=None, llama_cloud_key=None)`,
  `ParserSettingsService.set_for_project/get_for_project`,
  `parse_article_file_task(article_file_id, project_id, user_id, trace_id)`, and
  `ArticleFileIngestService.enqueue_parse_at_ingest(...)` are used identically in
  every task that references them.
- **Risk/ordering:** Phases 2–3 must land before Task 1.3 goes green (noted
  inline). The factory is the only PHI-gate site; the task resolves PHI + parser
  preference + BYOK key (single source of truth); the hook stays route-agnostic so
  a future upload route reuses it.

## Registration

Add this plan's path to `.markdownlintignore` and any new tech terms (Docling,
LlamaParse, LlamaCloud, PyMuPDF, BYOK, PHI, agentic, granular, bboxes, etc.) to
`.github/cspell-words.txt`. (The controller handles registration; this note is a
reminder.)
