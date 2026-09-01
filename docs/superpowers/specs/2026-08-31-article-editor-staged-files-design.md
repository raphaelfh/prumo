---
status: draft
last_reviewed: 2026-08-31
owner: '@raphaelfh'
---

# Article editor — retire the legacy routes, attach files before saving

The article editor asks for seven interactions to create one article with a
PDF. Four of them exist only because the form refuses to touch files until the
article row exists. This spec removes that constraint, retires the dead
`/articles/add` and `/articles/:articleId/edit` routes, and makes the step rail
survive a narrow viewport.

## Why now

Two defects surfaced together on 2026-08-31.

The first was a blank page: `/projects/:projectId/articles/add` rendered an
empty document. `ProjectProvider` wrapped a pure-redirect page, and its
URL-sync effect overwrote the redirect that the child had queued in the same
effect flush — child effects run first, and `setSearchParams` resolves against
the pathname captured at render. The route sat on `/articles/add` rendering
`<Navigate>`'s `null` forever. Fixed by unwrapping the two redirect routes.

The second is the cost of the flow that route leads to. It was measured, not
estimated.

## The measured flow

Creating one article with one PDF, today:

| # | Interaction | Why |
|---|---|---|
| 1 | Click **Add article** | opens the sheet |
| 2 | Type the title | the only required field |
| 3 | Click **Create** | `ArticleForm.tsx:515` calls `onDismiss()` — the sheet closes |
| 4 | Find the new row in the list | it is not selected or scrolled to |
| 5 | Click the row | reopens the sheet in `edit` mode |
| 6 | Click **Files** in the step rail | scroll-spy jump |
| 7 | Click **Add files**, pick, upload | the button is `disabled={mode === 'add'}` until now |

Steps 3-6 are pure overhead. They exist because `ArticleFileUploadDialogNew`
needs an `articleId` — `generateStorageKey(projectId, articleId, file.name)`
and `uploadArticleFile({articleId, ...})` both take one — and in `add` mode
there is none.

## Constraints

Both are CI gates. Neither is negotiable, and the first one dictates the
slice order.

**`ArticleForm.tsx` is frozen at 1266 lines.** `check_file_size.baseline:7`,
against a 800-line ceiling. The ratchet is shrink-only: the file may get
smaller, never larger. Any design that adds code to `ArticleForm.tsx` fails
the Architectural Fitness job. Extraction is therefore not a nicety here — it
is what makes the rest of the work legal.

**`insertArticle` discards the created row.** `articlesService.ts:94` returns
`Promise<ErrorResult<void>>` even though it calls `.select()`. Staging files
through a create needs that id back. The function also sits on the legacy
`supabase.from('articles')` path, with two grandfathered entries in
`check_frontend_data_path.baseline` keyed by line number — editing above them
shifts the keys, so the baseline is regenerated in the same commit.

## Slices

Ordered by dependency. Each is independently shippable and independently
green.

### Slice 0 — retire the legacy routes

`ProjectView` is the only caller of `ArticlesList` and always passes
`onOpenAddArticle` (`ProjectView.tsx:209`), so the
`navigate('/projects/:id/articles/add')` fallback at `ArticlesList.tsx:703` is
unreachable. Nothing inside the app reaches either legacy route.

Delete:

- `frontend/pages/AddArticle.tsx`, `frontend/pages/EditArticle.tsx`
- their two `<Route>` blocks and `lazy()` imports in `App.tsx`
- the unreachable `navigate` fallback in `ArticlesList.tsx`
- `errorContextAddArticle` and `errorContextEditArticle` in
  `frontend/lib/copy/common.ts` — used only by those routes, so leaving them
  orphans two keys and fails `check_copy_keys.py`

`?tab=articles&articleEditor=add` on the project URL becomes the canonical
deep link. The sheet is already URL-driven, so nothing loses addressability.

**Accepted cost:** an existing bookmark to `/articles/add` reaches `NotFound`
instead of redirecting. Judged acceptable — the product is pre-release and
the route was never surfaced in the UI.

**Test:** `frontend/test/legacyArticleRoutes.test.tsx` is rewritten to assert
the routes no longer resolve, keeping the real `App` route table as its
subject.

### Slice 1 — extract, so the file can grow elsewhere

Pull two units out of `ArticleForm.tsx`:

- `ArticleFilesSection.tsx` — the files card: list, per-file role badge, size,
  download, delete confirmation, and the empty state
- `ArticleFormSteps.tsx` — the scroll-spy rail and its `scrollToSection`
  behaviour

Each takes an explicit props contract and no longer reads `ArticleForm`'s
internals. `ArticleForm` drops far below its frozen 1266, and the baseline is
tightened in the same PR per the hard rules. The two new components are small
enough to test directly, which is what makes Slice 2's failure paths testable
at all.

No behaviour changes in this slice. It is a pure move, verified by the
existing suite staying green.

### Slice 2 — attach without saving first

`ArticleFileUploadDialogNew` already stages before it uploads: `FileWithRole`
carries `status: 'pending' | 'uploading' | 'completed' | 'error'` and a role
per file. The change is to let that staging happen with no `articleId`.

- In `add` mode the picker is enabled. Chosen files stay client-side as
  `FileWithRole[]` with `status: 'pending'`. Nothing is uploaded, no storage
  key is generated — `generateStorageKey` needs the article id.
- `insertArticle` returns the created article's id
  (`ErrorResult<{id: string}>`), which it already selects and throws away.
- On successful create, the form uploads the staged files against the new id,
  then behaves as `edit` mode on that article.
- The sheet no longer closes on create when files are staged.

Flow becomes: **add → title → drop file → Create.** Four interactions, down
from seven.

**Partial failure is a decision, not an accident.** Creation becomes two
phases: one article row, then N uploads. If the row lands and an upload fails,
the sheet stays open in `edit` mode on the persisted article, with the failed
files listed and retryable. The article is never orphaned and no file is
silently dropped. A failed *create* leaves the staged files in place so the
user can fix the title and retry without re-picking.

**Tests:**

- create with staged files → article created, files uploaded against the
  returned id
- create succeeds, one upload fails → sheet stays open in edit mode, the
  failed file is listed as retryable, the article exists
- create fails → no upload is attempted, staged files survive
- `insertArticle` returns the created id (service-level)

### Slice 3 — the narrow-viewport header and rail

Measured live at 375px in the running app, not inferred from class strings.
Both defects are below `lg`; at 1440px the rail measures
`scrollWidth 223 === clientWidth 223` and the header fits comfortably, so
nothing here changes the desktop layout.

**The rail overflows by 66%.** `aria-label="Form steps"` measures
`scrollWidth 621` inside `clientWidth 374`. Two of the five steps —
Additional information and Files — sit off-screen behind a horizontal
scrollbar. The cause is `whitespace-nowrap lg:whitespace-normal`
(`ArticleForm.tsx:692`) on a strip that only becomes a vertical column at
`lg`.

Fix: below `lg` the rail keeps the icon and folds the label to `sr-only`,
with a tooltip carrying the same copy. Per `.claude/rules/frontend.md` the
fold is `sr-only`, never `hidden` — `hidden` removes the label from the
accessibility tree and the step loses its accessible name.

**The header loses the sheet's title entirely.** At 375px the bar is 374px
wide with `px-6`, and it splits into two groups:

| Group | Width | Flex |
|---|---|---|
| Back + "Add article" + description | 120px | `flex-1 min-w-0` |
| Cancel + Create article | 206px | `shrink-0` |

The actions group never yields, so 55% of the bar goes to two buttons and the
identity group is compressed until the title renders as nothing — the visible
header reads `← Back , F Cancel [Create article]`. A user who deep-links into
`?articleEditor=add` on a phone cannot tell what the sheet is.

Fix: the identity group keeps the title at all widths. The description is what
folds below `sm` (it is redundant with the title), and the actions group stops
being `shrink-0` so it can give ground before the title does.

Both land in `ArticleFormSteps.tsx` and the extracted header from Slice 1, so
neither touches the frozen file.

**Verification:** the `design-review` loop at 375, 768 and 1440. The rail
assertion is measurable rather than visual — `scrollWidth <= clientWidth` for
`[aria-label="Form steps"]` at 375 — and the title must have a non-empty
rendered width at every breakpoint.

## Out of scope

**DOI/PMID auto-fill.** Pasting an identifier and having the record populate
itself would cut more interaction than everything above combined, but there is
no metadata lookup in the backend — no Crossref, PubMed, or Entrez client
anywhere in `backend/app`. That is a feature with its own spec, not an
adjustment to this form.

**The `supabase.from()` read path.** `articlesService.ts` predates the typed
`apiClient` consolidation. Slice 2 regenerates the line-keyed baseline because
it must, but moving article writes onto the typed client is the read-path
consolidation effort, not this one.

## Verification

Per slice: `npm run test:run`, `npm run typecheck`, `npm run lint`, and
`npx knip` in both modes. Slice 1 and 2 additionally re-run
`scripts/fitness/check_file_size.py` and
`scripts/fitness/check_frontend_data_path.py` with `--update-baseline`, and
Slice 0 re-runs `scripts/fitness/check_copy_keys.py`. Slice 3 is verified with
the `design-review` loop at mobile, tablet, and desktop widths — screenshots,
not the diff.
