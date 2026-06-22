---
status: draft
last_reviewed: 2026-06-22
owner: '@raphaelfh'
---

# Parse-recovery affordance + markdown-reader execution — design

> **Status:** Draft · Date: 2026-06-22 · Deciders: @raphaelfh
> **Relation to existing design:** This spec does **not** introduce a new
> markdown architecture. It (1) records the reconciliation of two reported
> user issues against design that already exists in the repo, (2) decides to
> execute the existing markdown plan in full, and (3) specs the one genuinely
> new piece — a status-aware *parse-recovery affordance* — that no existing
> plan covers.

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
  Docling/opencv crash), so it was the only article showing the button. The
  user re-parsed it → it succeeded today.
- Parsed `block.text` is **Docling markdown** (GFM tables `| … |`, lists,
  inline `<sup>/<sub>`), currently rendered raw via `{block.text}` in a `<p>`
  (`frontend/pdf-viewer/primitives/Reader.tsx:116`) → tables/lists/super-sub
  show as literal source text. `react-markdown` is **not** a dependency.

## Reconciliation with existing repo design

Both issues are already covered by design in the repo. A fresh competing spec
would be wrong; this spec adopts the existing design and fills the one gap.

### Issue 1 — already largely fixed

[`docs/superpowers/plans/2026-06-21-parsing-fix-and-reader-switcher.md`](../plans/2026-06-21-parsing-fix-and-reader-switcher.md)
(status: **in_progress**) diagnosed the identical root cause (its "Root cause
(verified, prod)" section names `teste 2`, the `libxcb` crash, and the never-used
`llama_cloud` key) and **shipped** the fix: parser default → `auto`
(LlamaParse-when-key, Docling fallback), Docling system libs, the
`GET /articles/{id}/files` endpoint, `useArticleDocuments`, and the
`DocumentSwitcher`. That is why parsing works now. Its **Task 7** explicitly
defers *"backfill the 39 legacy `pending` (no auto-sweep exists)"* as a manual
post-deploy step.

**Remaining gap (this spec):** the re-parse affordance is `parse_failed`-only,
so a stuck-`pending` file is a UI dead-end. The 39 backlog has no self-serve
trigger. → The **parse-recovery affordance** below.

### Issue 2 — fully designed, unbuilt → execute in full

[ADR-0013 — dual-tier markdown representation](../../adr/0013-dual-tier-markdown-representation.md)
(proposed) + [`docs/superpowers/plans/2026-06-20-markdown-view-and-markdown-citations.md`](../plans/2026-06-20-markdown-view-and-markdown-citations.md)
(**draft**, 6 phases, not started) already specify the markdown reader **and**
markdown-anchored citations — i.e. both halves of issue 2, including the
"align the reader with the extracted citations" ask (markdown-anchored
citations + highlight in both the reader and the canvas, Phase 6).

**Decision: execute that plan in full** (all 6 phases). An adversarial review
(2026-06-22) confirmed the plan's choices and corrected the design I had
sketched before reading it:

- **`react-markdown` is adequate — yes.** Stack = `react-markdown` +
  `remark-gfm` + `rehype-sanitize`. **No `rehype-raw`** (the markdown is
  server-projected GFM, so there is no author HTML to preserve; the ADR
  explicitly forbids `rehype-raw` without sanitization). **No `remark-breaks`**
  (blocks are joined with `\n\n`; GFM paragraph semantics suffice). My earlier
  `rehype-raw` + `remark-breaks` sketch is **dropped**.
- Defense-in-depth sanitize: server-side `nh3` at the markdown read service +
  `rehype-sanitize` (strict allowlist) at render.
- Rendering is the **server-projected** `render_blocks_to_markdown(blocks)`
  (the same markdown the AI reads), **not** a client-side per-block render of
  raw block text. The flat per-block reader dump is retired (plan Task 5.2).
- **Anchoring is safe** (verifier verdict: *sound*): reader-mode highlight does
  not exist today (highlighting is canvas-only) and copy reads the raw prop, so
  switching the reader to a markdown string breaks nothing; the new highlight is
  quote-based (robust to re-rendering).
- `@tailwindcss/typography` is installed but **not** registered in
  `tailwind.config.ts` `plugins[]`; the plan's `prose prose-sm` requires
  registering it (plan Task 5.2). Compose dense table cells via the markdown
  `components` override to match the extraction table aesthetic.

**No structural change to the existing plan is needed.** Fold in only these
small corrections when executing it:

- Confirm the stack stays `react-markdown + remark-gfm + rehype-sanitize`
  (no `rehype-raw`, no `remark-breaks`) — already what the plan says.
- `npm audit --audit-level=high` after the dep add (the security-audit gate
  fires on `package.json`/lockfile changes) and
  `node scripts/enumerate_compiler_bailouts.mjs` (panicThreshold `all_errors`).
- Add `rehype / remark / sanitize / nh3 / GFM / markdown` to
  `.github/cspell-words.txt` (already in the plan).
- Drive-by cleanup when `AISuggestionEvidence.tsx` is touched: the Portuguese
  comment at line 154 (`{/* Trecho do texto */}`) violates English-only — fix
  it.

(Whether the `AISuggestionEvidence` evidence blockquote *itself* also renders
markdown is a minor optional add; the user's "align with citations" ask is met
by Phase 2 + Phase 6 markdown-anchored citations + dual-surface highlight.)

---

## New design — the parse-recovery affordance (Issue 1)

The one piece no existing plan covers. Manual, status-aware, lives next to the
document switcher, visible in **all** states. (Recovery model and placement were
decided in brainstorming: manual reparse, all states, switcher control only;
in-flight shows "Processing…" + allows a manual retry; no schema-level "stuck"
distinction.)

### Behaviour by `extractionStatus`

| Status | Indicator | Action |
| --- | --- | --- |
| `pending` | `Processing…` (`docStatusPending`) — `Loader2` spin or `bg-warning animate-pulse` dot | **Retry** allowed (covers the stuck case); re-parse is idempotent |
| `parsed` | `Ready` (`docStatusReady`) — `bg-success` dot | quiet **Re-parse** (light, low-emphasis) |
| `parse_failed` | `Parse failed` (`docStatusFailed`) — `bg-destructive` dot | prominent **Retry parse** + `extraction_error` in a Tooltip |
| unknown | muted fallback dot (`bg-muted-foreground/40`) | none |

### Backend (small)

- Add `extraction_error: str | None` to **`ArticleFileListItem`**
  (`backend/app/schemas/article.py:205`) — it currently exposes only
  `extraction_status`; the error string lives only on `ArticleFileResponse`.
  Required for the failed-state tooltip. Populate it in
  `list_files_for_article` (the read path already selects the row).
- `npm run generate:api-types` + commit the regenerated
  `frontend/types/api/schema.d.ts`.
- **No migration** (the `extraction_error` column already exists on the model;
  this only widens a response schema).
- The `POST /article-files/{id}/reparse` endpoint already accepts any status —
  no backend change to recovery itself.

### Frontend

- **Create `frontend/hooks/extraction/useReparseArticleFile.ts`** — a
  `useMutation` modeled on `hooks/runs/useMarkReady.ts`:
  `mutationFn: (articleFileId) => apiClient('/api/v1/article-files/${id}/reparse', {method:'POST'})`;
  `onSuccess`: invalidate **both** `articleKeys.files(articleId)` **and**
  `articleKeys.textBlocks(articleFileId)` (stale-cache incident class — both are
  mandatory); `onError`: `toast.error(error.message || t('pdf','docReparseError'))`.
  This supersedes the existing inline `useState(busy)` + `.then()/.finally()` in
  `ReparseButton` and gives `isPending` for the spinner for free. (Reuses the
  existing `reparseArticleFile` URL; the existing `articlesService.reparseArticleFile`
  ErrorResult function may be retired or kept — pick the mutation-hook path,
  one IO convention.)
- **Build a `ParseStatusControl`** co-located in
  `frontend/components/extraction/DocumentSwitcher.tsx` (sibling export, the way
  `ReparseButton` already is). It reads `selectedFile.extractionStatus` (+ the
  new `extractionError`) from `useArticleDocuments` and renders the dot +
  collapsible label + the contextual action. A `cva` keyed on `status` (mirror
  `frontend/components/layout/HeaderChip.tsx`), using **semantic tokens**
  (`success` / `warning` / `destructive`) — replacing the raw `emerald/amber/red`
  in the current `STATUS_DOT` map. Icon-only actions use `Button size="header-icon"`
  + `aria-label`; the failed tooltip uses the global `TooltipProvider`.
- **Replace the `parse_failed`-only gate** at both mount sites with the new
  control: `ExtractionPDFPanel.tsx:80` and
  `QualityAssessmentFullScreen.tsx` (preserve the QA site's `articleId`
  null-guard). Keep both in sync.
- **Copy:** reuse the existing-but-unused `pdf` keys `docStatusReady` /
  `docStatusPending` (`'Processing…'`) / `docStatusFailed` and
  `docReparse` / `docReparseQueued` / `docReparseError` in
  `frontend/lib/copy/pdf.ts`. Add only an error-tooltip prefix key if needed.
  English-only, via `t('pdf', key)`.
- **Auto-refresh:** `useArticleDocuments` already polls `articleKeys.files`
  every 4s while any file is `pending`; after a re-parse the status flips to
  `pending`, polling resumes, and the reader fills when blocks/markdown land.
  No new polling wiring.

### Out of scope (deferred)

- **Clearing the 39 `pending` backlog** — needs prod/Railway access (currently
  unreachable from this session). Once the affordance ships, each is
  self-serviceable from the UI; or a one-off re-enqueue script can be run
  separately. Explicitly *not* a bulk auto-sweep (user decision).
- No schema-level "stuck vs in-flight" distinction (user decision: treat
  `pending` uniformly, allow manual retry).

## Testing

- **`useReparseArticleFile`** — hook test mirroring
  `frontend/test/hooks-runs.test.tsx`: `vi.mock('@/integrations/api', { apiClient })`,
  `QueryClient` with retries off, `await act(mutateAsync)`, assert
  `apiClient('/api/v1/article-files/${id}/reparse', {method:'POST'})` and that
  both key families are invalidated.
- **`DocumentSwitcher` / `ParseStatusControl`** — extend
  `frontend/test/components/DocumentSwitcher.test.tsx`: each status renders its
  dot/label/action; the failed tooltip shows `extractionError`; the action
  fires the mutation. `vi.mock('@/lib/copy', { t: (_n,k)=>k })`. Keep the test
  env-free (no AuthContext/supabase imports) so it passes in env-less CI.
- **Issue 2 tests** are owned by the existing plan (each phase has failing-test
  steps), including the `Reader` XSS test and the design-review + axe pass.

## Acceptance

- A `pending` or `parse_failed` file shows a clear, status-appropriate re-parse
  action next to the switcher; a successful re-parse transitions the file to
  `parsed` and the reader renders it — no UI dead-end in any state.
- The reader renders sanitized server-projected markdown (GFM tables/lists/
  super-sub) at parity with the extraction table aesthetic, and AI citations are
  anchored in the markdown and highlighted in both the reader and the canvas
  (per the existing markdown plan).
