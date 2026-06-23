---
status: draft
last_reviewed: 2026-06-22
owner: '@raphaelfh'
---

# Parse-recovery affordance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Design record: [`docs/superpowers/specs/2026-06-22-parse-recovery-affordance-and-markdown-execution-design.md`](../specs/2026-06-22-parse-recovery-affordance-and-markdown-execution-design.md) (Workstream A). This plan is **independent** of the markdown plan — it adds NO `react-markdown` dependency.

**Goal:** Make every article file's parse status recoverable from the document
switcher — a status-aware re-parse control visible in all states (pending /
parsed / parse_failed) — and make the parse write concurrency-safe and
non-silently-destructive so a Retry can never duplicate blocks or quietly shift
grounded citation highlights.

**Architecture:** Backend first makes the parse write safe (a UNIQUE constraint
on `article_text_blocks(article_file_id, page_number, block_index)` + a
`pg_advisory_xact_lock` around the delete-then-insert), then widens the file-list
response with `extraction_error`. Frontend adds an additive `useReparseArticleFile`
mutation hook and a `ParseStatusControl` (cva keyed on status, semantic tokens,
an `AlertDialog` confirm for re-parsing an already-parsed file, an error tooltip
for failures), and mounts it in both the extraction and QA PDF panels, replacing
the current `parse_failed`-only `ReparseButton` gate.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + Alembic + Celery (backend);
React 19 + TanStack Query v5 + shadcn/Radix + the in-house `@prumo/pdf-viewer`
and `lib/copy` i18n (frontend); pytest + Vitest.

## Global Constraints

- **English only** for code, comments, docs, copy keys.
- Backend layering `api → services → repositories → models` (CI-enforced).
- `ApiResponse` envelope; read errors via `error.message` (never FastAPI
  `detail`); every project-scoped endpoint checks `ensure_project_member`.
- Frontend data access through the typed `apiClient`
  (`frontend/integrations/api/client.ts`); no new `supabase.from(...)` table
  reads or `fetch()`; TanStack keys from the `articleKeys` factory
  (`frontend/lib/query-keys/articles.ts`).
- No `try/finally` / `throw` in React component or hook bodies (React Compiler
  `panicThreshold: all_errors`); IO lives in services/hooks.
- SQLAlchemy model/DDL change ⇒ Alembic migration (run inside `backend/`);
  Alembic revision id ≤ 32 chars.
- Frontend tooling runs from the **repo root** (no `frontend/package.json`);
  never `cd frontend`.
- After any endpoint/schema change: `npm run generate:api-types` + commit the
  regenerated `frontend/types/api/schema.d.ts`.
- Keep `articlesService.reparseArticleFile` — it has a third caller
  (`ArticleDetailDialog.tsx:348`) out of this plan's scope. The new hook is
  **additive**.

---

## Task 1: UNIQUE constraint on `article_text_blocks` (concurrency safety, 1/2)

**Files:**
- Create: `backend/alembic/versions/0031_unique_article_text_block_idx.py`
- Reference: `backend/alembic/versions/0006_article_text_blocks.py` (the existing
  *non-unique* index name to drop) and `0030_drop_instance_status.py` (current
  head → `down_revision`).
- Test: `backend/tests/integration/test_article_text_block_unique.py`

**Interfaces:**
- Produces: a DB invariant that `(article_file_id, page_number, block_index)` is
  unique, so two concurrent `replace_for_file` inserts fail loudly instead of
  silently duplicating.

- [ ] **Step 1: Confirm the current head and the old index name.**

Run: `cd backend && uv run alembic heads`
Expected: prints `0030 (head)` (or `0030_drop_instance_status`). Use that exact
string as `down_revision`.
Run: `grep -n "create_index" backend/alembic/versions/0006_article_text_blocks.py`
Expected: shows the index name (e.g. `ix_article_text_blocks_file_page_block`).
Note it for Step 3.

- [ ] **Step 2: Write the failing test.**

```python
# backend/tests/integration/test_article_text_block_unique.py
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


@pytest.mark.asyncio
async def test_duplicate_block_index_rejected(db_session_real):
    """After 0031, a duplicate (article_file_id, page, block_index) must fail."""
    # Insert one block, then a duplicate triple — the second must raise.
    insert = text(
        "INSERT INTO article_text_blocks "
        "(id, article_file_id, page_number, block_index, text, char_start, char_end, block_type) "
        "VALUES (gen_random_uuid(), :fid, 1, 0, :t, 0, 1, 'paragraph')"
    )
    fid = "00000000-0000-0000-0000-0000000000aa"
    await db_session_real.execute(insert, {"fid": fid, "t": "a"})
    with pytest.raises(IntegrityError):
        await db_session_real.execute(insert, {"fid": fid, "t": "b"})
        await db_session_real.flush()
```

- [ ] **Step 3: Run → fails** (no unique constraint yet; the second insert succeeds).

Run: `make test-backend` (or `cd backend && uv run pytest tests/integration/test_article_text_block_unique.py -v`)
Expected: FAIL — `DID NOT RAISE IntegrityError`.

- [ ] **Step 4: Write the migration.**

```python
# backend/alembic/versions/0031_unique_article_text_block_idx.py
"""unique (article_file_id, page_number, block_index) on article_text_blocks

Revision ID: 0031_unique_atb_idx
Revises: 0030
Create Date: 2026-06-22
"""
from alembic import op

revision = "0031_unique_atb_idx"
down_revision = "0030"  # confirm against `alembic heads` (Step 1)
branch_labels = None
depends_on = None

_OLD_INDEX = "ix_article_text_blocks_file_page_block"  # from 0006 (Step 1)
_UQ = "uq_article_text_blocks_file_page_block"


def upgrade() -> None:
    # 1. Collapse any pre-existing duplicates (keep one row per triple) so the
    #    constraint can be created. Concurrent parses before this migration may
    #    have produced dups.
    op.execute(
        """
        DELETE FROM article_text_blocks a
        USING article_text_blocks b
        WHERE a.ctid < b.ctid
          AND a.article_file_id = b.article_file_id
          AND a.page_number = b.page_number
          AND a.block_index = b.block_index
        """
    )
    # 2. Replace the non-unique read index with a UNIQUE one (same columns, so
    #    ordered reads keep their index).
    op.drop_index(_OLD_INDEX, table_name="article_text_blocks")
    op.create_index(
        _UQ,
        "article_text_blocks",
        ["article_file_id", "page_number", "block_index"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(_UQ, table_name="article_text_blocks")
    op.create_index(
        _OLD_INDEX,
        "article_text_blocks",
        ["article_file_id", "page_number", "block_index"],
        unique=False,
    )
```

- [ ] **Step 5: Verify the migration applies offline + online.**

Run: `cd backend && uv run alembic upgrade head --sql | tail -30` (offline sanity — no truncation error on the revision id)
Run: `make db-fresh` then `cd backend && uv run alembic current`
Expected: `0031_unique_atb_idx (head)`.

- [ ] **Step 6: Run → passes.**

Run: `cd backend && uv run pytest tests/integration/test_article_text_block_unique.py -v`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add backend/alembic/versions/0031_unique_article_text_block_idx.py backend/tests/integration/test_article_text_block_unique.py
git commit -m "feat(parsing): unique (article_file_id,page,block_index) on article_text_blocks"
```

## Task 2: Advisory lock around the parse write (concurrency safety, 2/2)

**Files:**
- Modify: `backend/app/services/document_parsing_service.py` (in
  `parse_article_file`, immediately before `self._repo.replace_for_file(...)`)
- Test: `backend/tests/integration/test_parse_article_file_lock.py`

**Interfaces:**
- Consumes: the UNIQUE constraint from Task 1.
- Produces: serialized block writes per `article_file_id` — a second parse that
  starts while one holds the lock blocks until the first commits, then re-runs
  the delete-then-insert cleanly (last-writer-wins, single clean set).

- [ ] **Step 1: Write the failing test** (asserts the lock SQL is issued before the write).

```python
# backend/tests/integration/test_parse_article_file_lock.py
import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_parse_acquires_advisory_lock_before_write(seeded_article_file, db_session_real):
    """parse_article_file must take pg_advisory_xact_lock before replace_for_file."""
    from app.services.document_parsing_service import DocumentParsingService

    svc = DocumentParsingService(db_session_real, parser=_StubParser(), storage=_StubStorage())
    calls: list[str] = []
    orig_execute = db_session_real.execute

    async def _spy(stmt, *a, **k):
        calls.append(str(stmt))
        return await orig_execute(stmt, *a, **k)

    with patch.object(db_session_real, "execute", side_effect=_spy):
        await svc.parse_article_file(seeded_article_file.id)

    assert any("pg_advisory_xact_lock" in c for c in calls), "lock not acquired"
```

(Use the project's existing parse-test stubs for `_StubParser`/`_StubStorage` —
mirror `backend/tests/integration/test_parse_article_file_task.py`; if a
`seeded_article_file` fixture does not exist, add one that inserts a `pending`
`ArticleFile` with a fake `storage_key` and have `_StubStorage.download` return
bytes and `_StubParser.parse` return one `ParsedBlock`.)

- [ ] **Step 2: Run → fails.**

Run: `cd backend && uv run pytest tests/integration/test_parse_article_file_lock.py -v`
Expected: FAIL — `lock not acquired`.

- [ ] **Step 3: Implement the lock.** In `parse_article_file`, just before the
  `replace_for_file` call (the persist step), add:

```python
from sqlalchemy import text  # at top of file if not already imported

# Serialize the block write per file so a concurrent Retry cannot interleave
# two delete-then-insert passes. Transaction-scoped: released on commit.
await self.db.execute(
    text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
    {"k": str(article_file_id)},
)
await self._repo.replace_for_file(article_file_id, blocks)
```

- [ ] **Step 4: Run → passes.**

Run: `cd backend && uv run pytest tests/integration/test_parse_article_file_lock.py -v`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add backend/app/services/document_parsing_service.py backend/tests/integration/test_parse_article_file_lock.py
git commit -m "feat(parsing): advisory-lock the block write so concurrent re-parse can't duplicate"
```

## Task 3: Expose `extraction_error` on the file-list response

**Files:**
- Modify: `backend/app/schemas/article.py` (`ArticleFileListItem`, ~line 205)
- Test: `backend/tests/unit/test_article_files_unit.py` (direct endpoint-coroutine
  test — the 80% diff-cover gate does NOT count lines hit only via httpx
  ASGITransport, so an integration test is insufficient)
- Regenerate: `frontend/types/api/schema.d.ts`

**Interfaces:**
- Produces: `ArticleFileListItem.extractionError: str | None` in the
  `GET /api/v1/articles/{id}/files` response. No read-path change — the endpoint
  already does `ArticleFileListItem.model_validate(f)` over full ORM rows, and
  the `extraction_error` column already exists on the model
  (`models/article.py:227`), so the field auto-populates via the alias. No
  migration.

- [ ] **Step 1: Write the failing test** (direct coroutine call, not via the app).

```python
# backend/tests/unit/test_article_files_unit.py  (add to the existing file)
@pytest.mark.asyncio
async def test_list_article_files_includes_extraction_error(monkeypatch):
    """A parse_failed file surfaces its extraction_error in the list item."""
    from app.api.v1.endpoints import article_files as ep

    failed = _FakeArticleFile(  # mirror the fakes already in this test module
        id=uuid4(), file_role="MAIN", extraction_status="parse_failed",
        extraction_error="libxcb.so.1: cannot open shared object file",
    )
    monkeypatch.setattr(ep, "get_article_project_id", _async_return(PROJECT_ID))
    monkeypatch.setattr(ep, "ensure_project_member", _async_noop)
    monkeypatch.setattr(
        ep.ArticleFileService, "list_for_article", _async_return([failed])
    )

    resp = await ep.list_article_files(
        article_id=ARTICLE_ID, request=_FakeRequest(), db=_FakeDb(),
        current_user_sub=USER_ID,
    )
    item = resp.data[0]
    assert item.extraction_error == "libxcb.so.1: cannot open shared object file"
```

(Match the helper/fakes already used in `test_article_files_unit.py`. If the file
does not yet exist, create it mirroring the direct-coroutine pattern from another
`tests/unit/test_*_unit.py` endpoint test.)

- [ ] **Step 2: Run → fails.**

Run: `cd backend && uv run pytest tests/unit/test_article_files_unit.py -k extraction_error -v`
Expected: FAIL — `AttributeError: ... has no attribute 'extraction_error'` (or `None`).

- [ ] **Step 3: Add the field.** In `ArticleFileListItem`:

```python
    extraction_error: str | None = Field(default=None, alias="extractionError")
```

(Place it right after the existing `extraction_status` line; keep the `populate_by_name`/alias config the class already uses.)

- [ ] **Step 4: Run → passes.**

Run: `cd backend && uv run pytest tests/unit/test_article_files_unit.py -k extraction_error -v`
Expected: PASS.

- [ ] **Step 5: Regenerate API types + commit.**

Run (repo root): `npm run generate:api-types`
Expected: `frontend/types/api/schema.d.ts` `ArticleFileListItem` gains
`extractionError?: string | null`.

```bash
git add backend/app/schemas/article.py backend/tests/unit/test_article_files_unit.py frontend/types/api/schema.d.ts
git commit -m "feat(article-files): expose extractionError on the file-list item"
```

## Task 4: `useReparseArticleFile` mutation hook (additive)

**Files:**
- Create: `frontend/hooks/extraction/useReparseArticleFile.ts`
- Test: `frontend/test/hooks/useReparseArticleFile.test.tsx`

**Interfaces:**
- Consumes: `apiClient`, `articleKeys.files` / `articleKeys.textBlocks`.
- Produces: `useReparseArticleFile(articleId: string)` →
  `UseMutationResult<unknown, Error, string>` (the variable is the
  `articleFileId`). `onSuccess` invalidates **both** key families; `onError`
  toasts. Exposes `isPending` for spinner/disable.

- [ ] **Step 1: Write the failing test.**

```tsx
// frontend/test/hooks/useReparseArticleFile.test.tsx
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/integrations/api", () => ({ apiClient: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/copy", () => ({ t: (_n: string, k: string) => k }));

import { apiClient } from "@/integrations/api";
import { useReparseArticleFile } from "@/hooks/extraction/useReparseArticleFile";

function wrap() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, spy };
}

describe("useReparseArticleFile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POSTs reparse and invalidates files + textBlocks", async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { wrapper, spy } = wrap();
    const { result } = renderHook(() => useReparseArticleFile("art-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("file-9");
    });

    expect(apiClient).toHaveBeenCalledWith(
      "/api/v1/article-files/file-9/reparse",
      { method: "POST" },
    );
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys.some((k) => k?.includes("files"))).toBe(true);
    expect(keys.some((k) => k?.includes("text-blocks"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fails.**

Run (repo root): `npm run test:run -- useReparseArticleFile`
Expected: FAIL — cannot resolve `@/hooks/extraction/useReparseArticleFile`.

- [ ] **Step 3: Implement the hook** (mirror `hooks/runs/useMarkReady.ts`).

```tsx
// frontend/hooks/extraction/useReparseArticleFile.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api";
import { t } from "@/lib/copy";
import { articleKeys } from "@/lib/query-keys/articles";

/** Re-enqueue a parse for an ArticleFile and refresh the file list + reader blocks. */
export function useReparseArticleFile(articleId: string) {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, string>({
    mutationFn: (articleFileId) =>
      apiClient(`/api/v1/article-files/${articleFileId}/reparse`, { method: "POST" }),
    onSuccess: (_data, articleFileId) => {
      toast.success(t("pdf", "docReparseQueued"));
      queryClient.invalidateQueries({ queryKey: articleKeys.files(articleId) });
      queryClient.invalidateQueries({ queryKey: articleKeys.textBlocks(articleFileId) });
    },
    onError: (error) => {
      toast.error(error.message || t("pdf", "docReparseError"));
    },
  });
}
```

- [ ] **Step 4: Run → passes** + typecheck.

Run (repo root): `npm run test:run -- useReparseArticleFile && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit.**

```bash
git add frontend/hooks/extraction/useReparseArticleFile.ts frontend/test/hooks/useReparseArticleFile.test.tsx
git commit -m "feat(extraction): add useReparseArticleFile mutation hook"
```

## Task 5: `ParseStatusControl` (status-aware control + confirm + tooltip)

**Files:**
- Modify: `frontend/components/extraction/DocumentSwitcher.tsx` (add a sibling
  export `ParseStatusControl`; convert the raw-color `STATUS_DOT` map to semantic
  tokens via a `cva`)
- Modify: `frontend/lib/copy/pdf.ts` (add `docParseErrorLabel` +
  `docReparseConfirmTitle` / `docReparseConfirmBody` / `docReparseConfirmCta`)
- Verify present: `frontend/components/ui/alert-dialog.tsx` (run
  `npx shadcn@latest add alert-dialog` only if missing — then replace raw colors
  per `ui-styling` before committing)
- Test: `frontend/test/components/DocumentSwitcher.test.tsx`

**Interfaces:**
- Consumes: `useReparseArticleFile` (Task 4); the new `extractionError` field
  (Task 3); copy keys.
- Produces: `<ParseStatusControl articleId={string} file={ArticleFileListItem} />`
  — renders a status dot + label, and a contextual action: `pending` → spinner +
  "Processing…" + a ghost **Retry**; `parsed` → "Ready" + a low-emphasis
  **Re-parse** behind an `AlertDialog` confirm; `parse_failed` → "Parse failed"
  (error in a `Tooltip`) + a prominent **Retry parse**.

- [ ] **Step 1: Add copy keys** to `frontend/lib/copy/pdf.ts` (after the
  `docReparse*` block):

```ts
    docParseErrorLabel: 'Parse error',
    docReparseConfirmTitle: 'Re-parse this document?',
    docReparseConfirmBody:
      'Re-parsing rebuilds the document text. Existing citation highlights for this file may shift and need re-checking.',
    docReparseConfirmCta: 'Re-parse',
```

- [ ] **Step 2: Write the failing test.**

```tsx
// frontend/test/components/DocumentSwitcher.test.tsx  (replace the service mock + add cases)
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/integrations/api", () => ({ apiClient: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/copy", () => ({ t: (_n: string, k: string) => k }));

import { apiClient } from "@/integrations/api";
import { ParseStatusControl } from "@/components/extraction/DocumentSwitcher";

function renderControl(file: { id: string; extractionStatus: string; extractionError?: string | null }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ParseStatusControl articleId="art-1" file={{ originalFilename: "a.pdf", fileRole: "MAIN", ...file } as never} />
    </QueryClientProvider>,
  );
}

describe("ParseStatusControl", () => {
  beforeEach(() => vi.clearAllMocks());

  it("failed: shows the error in a tooltip trigger and a Retry that POSTs", async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValue({});
    renderControl({ id: "f1", extractionStatus: "parse_failed", extractionError: "libxcb.so.1 missing" });
    fireEvent.click(screen.getByRole("button", { name: /docReparse/ }));
    expect(apiClient).toHaveBeenCalledWith("/api/v1/article-files/f1/reparse", { method: "POST" });
  });

  it("parsed: Re-parse opens a confirm dialog before POSTing", async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValue({});
    renderControl({ id: "f2", extractionStatus: "parsed" });
    fireEvent.click(screen.getByRole("button", { name: /docReparse/ }));
    expect(apiClient).not.toHaveBeenCalled();             // confirm first
    fireEvent.click(screen.getByRole("button", { name: /docReparseConfirmCta/ }));
    expect(apiClient).toHaveBeenCalledWith("/api/v1/article-files/f2/reparse", { method: "POST" });
  });

  it("pending: shows Processing and a Retry", () => {
    renderControl({ id: "f3", extractionStatus: "pending" });
    expect(screen.getByText("docStatusPending")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run → fails.**

Run (repo root): `npm run test:run -- DocumentSwitcher`
Expected: FAIL — `ParseStatusControl` is not exported.

- [ ] **Step 4: Implement `ParseStatusControl`** in `DocumentSwitcher.tsx`.
  Replace the raw-color `STATUS_DOT` object with a `cva`, and add the control.
  (Keep the existing `DocumentSwitcher` export and `ReparseButton` for now;
  Task 6 swaps the panel over to `ParseStatusControl`.)

```tsx
import { cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useReparseArticleFile } from "@/hooks/extraction/useReparseArticleFile";
import type { ArticleFileListItem } from "@/services/articleFilesService";

const statusDot = cva("h-1.5 w-1.5 shrink-0 rounded-full", {
  variants: {
    status: {
      parsed: "bg-success",
      pending: "bg-warning animate-pulse",
      parse_failed: "bg-destructive",
      unknown: "bg-muted-foreground/40",
    },
  },
  defaultVariants: { status: "unknown" },
});

type ParseStatus = "parsed" | "pending" | "parse_failed" | "unknown";
function toStatus(s: string): ParseStatus {
  return s === "parsed" || s === "pending" || s === "parse_failed" ? s : "unknown";
}

export interface ParseStatusControlProps {
  articleId: string;
  file: ArticleFileListItem;
}

export function ParseStatusControl({ articleId, file }: ParseStatusControlProps) {
  const status = toStatus(file.extractionStatus);
  const reparse = useReparseArticleFile(articleId);
  const fire = () => reparse.mutate(file.id);

  const label =
    status === "parsed" ? t("pdf", "docStatusReady")
    : status === "pending" ? t("pdf", "docStatusPending")
    : status === "parse_failed" ? t("pdf", "docStatusFailed")
    : "";

  return (
    <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground">
      {status === "pending" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} aria-hidden />
      ) : (
        <span aria-hidden className={statusDot({ status })} />
      )}

      {status === "parse_failed" && file.extractionError ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">{label}</span>
          </TooltipTrigger>
          <TooltipContent>
            {t("pdf", "docParseErrorLabel")}: {file.extractionError}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span>{label}</span>
      )}

      {status === "parsed" ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={reparse.isPending}>
              {t("pdf", "docReparse")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("pdf", "docReparseConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("pdf", "docReparseConfirmBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common", "cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={fire}>{t("pdf", "docReparseConfirmCta")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        (status === "parse_failed" || status === "pending") && (
          <Button
            size="sm"
            variant={status === "parse_failed" ? "outline" : "ghost"}
            className="h-7 text-xs"
            disabled={reparse.isPending}
            onClick={fire}
          >
            {t("pdf", "docReparse")}
          </Button>
        )
      )}
    </div>
  );
}
```

(If `t("common", "cancel")` does not exist, use the existing cancel key in
`lib/copy/common.ts` — grep for it; do not hardcode "Cancel".)

- [ ] **Step 5: Run → passes** + typecheck + compiler check.

Run (repo root): `npm run test:run -- DocumentSwitcher && npm run typecheck`
Run (repo root): `node scripts/enumerate_compiler_bailouts.mjs`
Expected: tests PASS; no new compiler bailouts.

- [ ] **Step 6: Commit.**

```bash
git add frontend/components/extraction/DocumentSwitcher.tsx frontend/lib/copy/pdf.ts frontend/test/components/DocumentSwitcher.test.tsx
git commit -m "feat(extraction): ParseStatusControl — status-aware re-parse with confirm + error tooltip"
```

## Task 6: Mount `ParseStatusControl` in both PDF panels

**Files:**
- Modify: `frontend/components/extraction/ExtractionPDFPanel.tsx` (replace the
  `parse_failed`-only `ReparseButton` gate at ~line 80)
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx` (the matching gate,
  ~line 653)
- Test: extend `frontend/test/components/DocumentSwitcher.test.tsx` or the
  panel's existing test

**Interfaces:**
- Consumes: `ParseStatusControl` (Task 5); `selectedFile` from
  `useArticleDocuments`.

- [ ] **Step 1: Replace the gate in `ExtractionPDFPanel.tsx`.** Swap:

```tsx
{selectedFile?.extractionStatus === 'parse_failed' && (
  <ReparseButton articleFileId={selectedFile.id} articleId={articleId} />
)}
```

with:

```tsx
{selectedFile && (
  <ParseStatusControl articleId={articleId} file={selectedFile} />
)}
```

(Update the import from `DocumentSwitcher` to include `ParseStatusControl`;
remove the now-unused `ReparseButton` import if this was its only panel use —
but keep the `ReparseButton` export in `DocumentSwitcher.tsx` until Step 2
confirms QA no longer references it.)

- [ ] **Step 2: Replace the same gate in `QualityAssessmentFullScreen.tsx`**
  (~line 653) identically. The QA `articleId` is already guaranteed non-null by
  the early return earlier in the component, so pass it directly.

- [ ] **Step 3: Remove the now-dead `ReparseButton`** if no caller remains.

Run (repo root): `grep -rn "ReparseButton" frontend/`
Expected: only its definition remains → delete the `ReparseButton` export from
`DocumentSwitcher.tsx` and any leftover import. If another caller exists, leave it.

- [ ] **Step 4: Run the suite + typecheck.**

Run (repo root): `npm run test:run -- DocumentSwitcher ExtractionPDFPanel && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Visual verify.** Run the `design-review` loop
  (`/design-review` on the extraction route): render → screenshot → compare to
  the Plane/Linear target → confirm the control reads cleanly in pending /
  parsed / failed states (dot color, spinner, tooltip, confirm dialog). Fix and
  re-screenshot before claiming done.

- [ ] **Step 6: Commit.**

```bash
git add frontend/components/extraction/ExtractionPDFPanel.tsx frontend/pages/QualityAssessmentFullScreen.tsx frontend/components/extraction/DocumentSwitcher.tsx
git commit -m "feat(extraction): mount ParseStatusControl in extraction + QA panels (retire parse_failed-only gate)"
```

## Task 7: Full verification + backlog note

- [ ] **Step 1:** `make lint-backend`, `make test-backend` (parsing slices),
  `npm run test:run`, `npm run lint`, `npm run typecheck` — all green.
- [ ] **Step 2:** Confirm `node scripts/enumerate_compiler_bailouts.mjs` shows no
  new bailouts.
- [ ] **Step 3:** Backlog (deferred, user sign-off): after dev→main + Railway
  deploy, the 39 legacy `pending` files are cleared **manually** via the new
  control (open each article → Retry). No backfill script in this plan.

---

## Self-review

- **Spec coverage (Workstream A):** A1 concurrency safety → Tasks 1+2; A2
  parsed-confirm → Task 5; A3 behaviour table → Task 5; A4 schema widen (no
  migration, no read-path change) → Task 3; A5 additive hook + keep service +
  both mount sites + copy → Tasks 4/5/6; A6 tests incl. direct endpoint-coroutine
  → Task 3; A7 independent of Workstream B → no `react-markdown` anywhere. ✓
- **Placeholders:** none — every code step shows code; fixture/import gaps are
  flagged with the exact reference file to mirror.
- **Type consistency:** `useReparseArticleFile(articleId)` mutate variable is the
  `articleFileId` (Task 4) and `ParseStatusControl` calls
  `reparse.mutate(file.id)` (Task 5); `ArticleFileListItem.extractionError`
  (Task 3) is read in Task 5; `articleKeys.files` / `articleKeys.textBlocks`
  used consistently. ✓
- **Migration:** Task 1 is the only DDL; Task 3 explicitly needs none. ✓
