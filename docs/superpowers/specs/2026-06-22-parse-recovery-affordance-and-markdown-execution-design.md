---
status: draft
last_reviewed: 2026-06-22
owner: '@raphaelfh'
---

# Parse-recovery affordance + markdown-reader execution — design

> **Status:** Draft · Date: 2026-06-22 · Deciders: @raphaelfh
> **Relation to existing design:** This spec does **not** introduce a new
> markdown architecture. It (1) records the reconciliation of two reported
> user issues against design that already exists in the repo, (2) decides how
> to execute the existing markdown plan, and (3) specs the one genuinely new
> piece — a status-aware *parse-recovery affordance* — that no existing plan
> covers.
> **Revised 2026-06-22** after an adversarial review (verdict: *revise*). The
> two blockers (re-parse concurrency; re-parse corrupting grounded citations)
> and the five majors are addressed below; the affordance and the markdown
> work are now **two independently-shippable workstreams** (A and B).

## The two reported issues

1. **"Why aren't articles parsing, and why did the re-parse button only appear
   on *teste 2*?"**
2. **"The .md viewer can't render all the fields well (want it as good as the
   table view), it should be aligned with how extracted citations are shown —
   and is [`react-markdown`](https://github.com/remarkjs/react-markdown)
   adequate?"**

## Root-cause evidence (production DB, 2026-06-22)

- `article_files`: **39 `pending`, 2 `parsed`, 0 `parse_failed`.**
- The two `parsed` rows were parsed **today**: `teste 2` at 11:16:43 (via a
  re-parse) and `Parse 1` at 11:29:42 (fresh upload, parsed at ingest). The
  worker + parser pipeline is **healthy now**.
- The 39 `pending` rows were uploaded **2026-05-26 / 06-07 / 06-14** (plus one
  `teste` on 06-21) — i.e. *before* the parse-at-ingest pipeline worked. They
  have no enqueued task and nothing backfills them.
- The re-parse button is gated on exactly one condition —
  `selectedFile?.extractionStatus === 'parse_failed'`
  (`frontend/components/extraction/ExtractionPDFPanel.tsx:80`). `teste 2` was
  the **only** file ever in `parse_failed` (verified cause:
  `extraction_error = "libxcb.so.1: cannot open shared object file"`, the
  Docling/opencv crash), so it was the only article showing the button.
- Parsed `block.text` is **Docling markdown** (GFM tables `| … |`, lists,
  inline `<sup>/<sub>`), currently rendered raw via `{block.text}` in a `<p>`
  (`frontend/pdf-viewer/primitives/Reader.tsx:116`) → tables/lists/super-sub
  show as literal source text. `react-markdown` is **not** a dependency.

## Reconciliation with existing repo design

Both issues are already covered by design in the repo. A fresh competing spec
would be wrong; this spec adopts the existing design and fills the one gap.

- **Issue 1** was diagnosed and largely fixed by
  [`docs/superpowers/plans/2026-06-21-parsing-fix-and-reader-switcher.md`](../plans/2026-06-21-parsing-fix-and-reader-switcher.md)
  (status: **in_progress**) — same verified root cause (`teste 2`, the `libxcb`
  crash, the never-used `llama_cloud` key). It shipped the parser-default → `auto`
  fix, the Docling libs, `GET /articles/{id}/files`, `useArticleDocuments`, and
  the `DocumentSwitcher` (that is why parsing works now). Its **Task 7** defers
  the 39-backlog. The remaining UI gap — re-parse is `parse_failed`-only, so a
  stuck-`pending` file is a dead-end — is **Workstream A** below.
- **Issue 2** is fully designed but unbuilt in
  [ADR-0013](../../adr/0013-dual-tier-markdown-representation.md) (proposed) +
  [`docs/superpowers/plans/2026-06-20-markdown-view-and-markdown-citations.md`](../plans/2026-06-20-markdown-view-and-markdown-citations.md)
  (draft, 6 phases, not started). Execute it — **Workstream B** below.

These two workstreams are **independent** and ship separately. Workstream A does
not depend on `react-markdown` or the (still-unbuilt) `render_blocks_to_markdown`;
Workstream B is multi-PR greenfield. The affordance ships first.

---

## Workstream A — parse-recovery affordance (Issue 1, new)

Manual, status-aware re-parse control next to the document switcher, visible in
**all** states (decided in brainstorming: manual reparse, all states, switcher
control only; in-flight shows "Processing…").

> **Adversarial correction:** re-parse is **NOT** "idempotent / safe in all
> states" as originally written. The parse write is destructive (delete-then-
> insert blocks) and not concurrency-safe, and re-parsing a `parsed` file can
> invalidate grounded citations. The affordance therefore needs **backend
> safety work** — it is not frontend-only.

### A1. Concurrency safety (blocker fix — backend)

`ArticleFileService.reparse()` resets `extraction_status='pending'` and enqueues
a fresh task with no in-flight guard; the worker runs `concurrency=4` +
`task_acks_late=True`; `ArticleTextBlockRepository.replace_for_file` is a
non-atomic DELETE-then-bulk-INSERT; and the
`(article_file_id, page_number, block_index)` index (migration 0006) is **plain,
not unique**. Two concurrent parse tasks ⇒ silent **duplicate or lost blocks**,
which corrupts `concat_page_text` char-offset math and the reader order.

**Required:**
- Add a **UNIQUE** constraint on
  `article_text_blocks(article_file_id, page_number, block_index)` (Alembic
  migration; **dedupe any existing duplicate rows first** so the constraint can
  be created). This makes concurrent double-inserts fail loudly instead of
  silently duplicating.
- **Serialize the parse write** with a `pg_advisory_xact_lock` keyed on
  `article_file_id` held across `replace_for_file` in the parse path
  (`DocumentParsingService.parse_article_file` / the worker task), so a Retry on
  an in-flight file cannot interleave two replaces.
- Correct the earlier claim "no backend change to recovery itself" — allowing
  Retry while a parse may be in flight **does** require this backend change.

### A2. Re-parsing a `parsed` file (blocker fix — UX guard)

`extraction_evidence.position` is a **JSONB snapshot** (char range + block_index
+ bbox; `extraction.py:516`), `article_file_id` is `ondelete='SET NULL'` with no
FK to block ids. Re-parsing mints new block ids and possibly different offsets
(esp. across the `auto` LlamaParse↔Docling switch), so it **silently shifts
every previously-grounded citation highlight** on that file — no error surfaces.

**Required:**
- The `parsed`-state action is a **confirm dialog** (`AlertDialog`), not a quiet
  re-parse. The dialog warns that re-parsing rebuilds the document and may shift
  existing citation highlights. (Enhancement, optional: only warn when the file
  has grounded `extraction_evidence` — needs a count/boolean; the floor is
  always-confirm for `parsed`.)
- A proper **re-anchoring** step (re-run `build_anchor` over the new blocks for
  affected evidence) is **out of scope** here and recorded as a follow-up.
- Remove all blanket "idempotent" wording. The only true sense of "idempotent"
  is that re-parse does **not** re-trigger AI extraction (verified:
  `reparse()` → `parse_article_file_task` runs `DocumentParsingService` only).

### A3. Behaviour by `extractionStatus`

| Status | Indicator | Action |
| --- | --- | --- |
| `pending` | `Processing…` (`docStatusPending`) — `Loader2` spin / `bg-warning animate-pulse` dot | **Retry** allowed (covers the stuck case); safe because of A1's lock + UNIQUE constraint |
| `parsed` | `Ready` (`docStatusReady`) — `bg-success` dot | **Re-parse** behind the A2 confirm dialog |
| `parse_failed` | `Parse failed` (`docStatusFailed`) — `bg-destructive` dot | prominent **Retry parse** + `extraction_error` in a Tooltip |
| unknown | muted fallback dot (`bg-muted-foreground/40`) | none |

### A4. Backend (schema + read path)

- Add `extraction_error: str | None` to **`ArticleFileListItem`**
  (`backend/app/schemas/article.py:205`). **No read-path change** —
  `ArticleFileService.list_for_article` returns full ORM rows and the endpoint
  uses `ArticleFileListItem.model_validate(f)`, so the field auto-populates via
  the alias. (Verified: the method is `list_for_article`, not the earlier
  mis-named `list_files_for_article`.)
- **No migration for this field** — the `extraction_error` column already exists
  on the `ArticleFile` model (`models/article.py:227`); this only widens a
  response schema. (The UNIQUE constraint in A1 is a *separate* migration.)
- Not a security leak: the list endpoint is gated by `ensure_project_member`
  identically to the detail endpoint that already returns `extraction_error`
  (adversarial review: unfounded).
- `npm run generate:api-types` + commit the regenerated `schema.d.ts` (additive,
  optional field — no consumer breaks).

### A5. Frontend

- **Create `frontend/hooks/extraction/useReparseArticleFile.ts`** — a
  `useMutation` modeled on `hooks/runs/useMarkReady.ts`:
  `mutationFn: (id) => apiClient('/api/v1/article-files/${id}/reparse', {method:'POST'})`;
  `onSuccess`: invalidate **both** `articleKeys.files(articleId)` **and**
  `articleKeys.textBlocks(articleFileId)` (stale-cache class — both mandatory);
  `onError`: `toast.error(error.message || t('pdf','docReparseError'))`. Gives
  `isPending` for the spinner. **Additive only.**
- **KEEP `articlesService.reparseArticleFile`** — it has a third caller
  (`ArticleDetailDialog.tsx:348`) + a unit test (`articlesService.test.ts:257`)
  outside this scope. A mixed IO convention (ErrorResult service for the dialog,
  `useMutation` for the switcher) is accepted; migrating the dialog is an
  explicit later follow-up, not this spec.
- **Build `ParseStatusControl`** co-located in
  `frontend/components/extraction/DocumentSwitcher.tsx` (sibling export). Reads
  `selectedFile.extractionStatus` + the new `extractionError` from
  `useArticleDocuments`; renders dot + collapsible label + the contextual action
  (with the A2 `AlertDialog` for `parsed`). A `cva` keyed on `status` (mirror
  `frontend/components/layout/HeaderChip.tsx`) using **semantic tokens**
  (`success`/`warning`/`destructive`), replacing the raw `emerald/amber/red`
  `STATUS_DOT`. Icon-only actions use `Button size="header-icon"` + `aria-label`;
  the failed tooltip uses the global `TooltipProvider`.
- **Replace the `parse_failed`-only gate** at **both** mount sites:
  `ExtractionPDFPanel.tsx:80` and `QualityAssessmentFullScreen.tsx` (the QA
  `articleId` early-return at line ~500 already guarantees non-null; keep the
  control consistent across both). No third switcher mount site exists
  (`ArticleDetailDialog` is a separate non-switcher surface, out of scope).
- **Copy** (`frontend/lib/copy/pdf.ts`): reuse the **unused** `docStatusReady` /
  `docStatusPending` (`'Processing…'`) / `docStatusFailed`. `docReparse` /
  `docReparseQueued` / `docReparseError` are **already in use** by the current
  `ReparseButton` — reuse them. Add one tooltip-prefix key
  (`docParseErrorLabel: 'Parse error'`) so the raw `extraction_error` is
  labelled, not shown bare. English-only via `t('pdf', key)`.
- **Auto-refresh:** `useArticleDocuments` already polls `articleKeys.files` every
  4s while any file is `pending`; after a re-parse the status flips to `pending`,
  polling resumes, and the reader fills when blocks land. No new polling wiring.

### A6. Tests

- **`useReparseArticleFile`** — hook test mirroring
  `frontend/test/hooks-runs.test.tsx`: `vi.mock('@/integrations/api',{apiClient})`,
  `QueryClient` retries off, `await act(mutateAsync)`, assert the POST URL and
  that both key families are invalidated.
- **`DocumentSwitcher` / `ParseStatusControl`** — extend
  `frontend/test/components/DocumentSwitcher.test.tsx`: each status renders its
  dot/label/action; the failed tooltip shows `extractionError`; the `parsed`
  confirm dialog appears; the action fires the mutation. **The existing
  `vi.mock('@/services/articlesService')` must change to
  `vi.mock('@/integrations/api',{apiClient})` + a `QueryClientProvider` wrapper**
  (the control now drives a `useMutation`). `vi.mock('@/lib/copy',{t:(_n,k)=>k})`.
  Keep the test env-free (no AuthContext/supabase imports) for env-less CI.
- **Backend (CI gate):** a **direct endpoint-coroutine unit test** for
  `list_article_files` asserting `extraction_error` is serialized for a failed
  file — mirror `test_article_files_unit.py`, NOT only an integration test
  (endpoint lines exercised via httpx ASGITransport do not register coverage, so
  the 80% diff-cover gate fails without a direct coroutine test). Also cover the
  A1 advisory-lock/unique-constraint path.

### A7. Acceptance (Workstream A, self-contained)

- A `pending` or `parse_failed` file shows a clear, status-appropriate re-parse
  action next to the switcher; re-parsing a `parsed` file requires the A2
  confirm. A successful re-parse transitions the file to `parsed` and the reader
  renders it — no UI dead-end in any state.
- Two concurrent parse tasks on one file cannot produce duplicate/lost blocks
  (A1). Re-parsing a `parsed` file never *silently* invalidates citations (A2).
- Ships **independently** of Workstream B (no `react-markdown` dependency).

---

## Workstream B — markdown view + markdown-anchored citations (Issue 2)

**Decision: execute the existing 6-phase plan in full, after amending
ADR-0013** (user decision). `react-markdown` is adequate; the plan's stack is
correct: `react-markdown` + `remark-gfm` + `rehype-sanitize` — **no
`rehype-raw`** (server-projected GFM; the ADR forbids raw without sanitize) and
**no `remark-breaks`** (blocks joined with `\n\n`). Defense-in-depth: server
`nh3` + `rehype-sanitize`. My earlier `rehype-raw` + `remark-breaks` sketch is
**dropped**. Anchoring is safe (adversarial verdict: *sound*) — reader-mode
highlight does not exist today and copy reads the raw prop; the new highlight is
quote-based.

Corrections to fold in while executing the plan:

- **Amend ADR-0013 first.** Plan Phase 3 sets `READ_FROM_BLOCKS` default `True`,
  removes `MAX_PDF_CHARS`, and raises the prompt budget 15k→120k — i.e. markdown
  becomes the **default extraction input**. ADR-0013 currently says blocks stay
  the default ("no two competing extraction inputs by default"). Amend the ADR
  to make markdown the default, recording the **bake-off evidence** that markdown
  beats the block-assembler, and treat the 15k→120k budget change as its **own
  verification** (latency/cost/quality), before/with Phase 3.
- **Stale `readerBlocks` premise (#359).** The plan predates the shipped
  reader-switcher; its claim "neither panel passes `readerBlocks`; this adds
  `readerMarkdown`" is now **false** — both panels already pass `readerBlocks`
  (`ExtractionPDFPanel.tsx:92`, `QualityAssessmentFullScreen.tsx:665`). Plan
  Tasks 5.2/5.3 must **replace** the wired `readerBlocks`/`readerLoading` props,
  not add new ones. `ReaderTextBlock` is a **public viewer-barrel export**
  (removing it is a breaking package API change); keep a **blocks-based fallback
  render** until the markdown endpoint ships and is verified.
- **`prose` vs density.** `@tailwindcss/typography` is installed but **not** in
  `tailwind.config.ts` `plugins[]`; registering it for `prose prose-sm` is
  required, and the dense table cells need a `components` override to match the
  extraction table aesthetic (`ExtractionInterface.tsx:406-448`). Resolve in the
  plan + a `design-review` pass; do not hand-wave.
- Process: `npm audit --audit-level=high` after the dep add (security-audit gate
  fires on lockfile changes); `node scripts/enumerate_compiler_bailouts.mjs`
  (panicThreshold `all_errors`); add `rehype/remark/sanitize/nh3/GFM/markdown` to
  `.github/cspell-words.txt` (already a plan step). Drive-by: fix the Portuguese
  comment at `AISuggestionEvidence.tsx:154` when that file is touched.

### Acceptance (Workstream B)

Owned by the markdown plan's own per-phase acceptance: the reader renders
sanitized server-projected markdown (GFM tables/lists/super-sub) at parity with
the extraction table aesthetic; AI citations are anchored in the markdown and
highlighted in **both** the reader and the canvas; ADR-0013 amended; Phase 3's
extraction-input swap verified by the bake-off.

---

## Out of scope / deferred

- **Clearing the 39 `pending` backlog** — **user sign-off to clear manually via
  the new affordance after deploy** (open each article, click Retry). No backfill
  script; no auto-sweep.
- **Re-anchoring grounded citations after a `parsed` re-parse** (A2) — recorded
  follow-up; the confirm dialog is the interim guard.
- **Migrating `ArticleDetailDialog` to the new mutation hook** — later cleanup;
  `articlesService.reparseArticleFile` is kept.
- No schema-level "stuck vs in-flight" distinction (user decision: treat
  `pending` uniformly, allow guarded manual retry).
