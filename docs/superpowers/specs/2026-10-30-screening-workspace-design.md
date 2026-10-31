---
status: approved
last_reviewed: 2026-10-30
owner: '@raphaelfh'
---

# Screening workspace: overview, full text and deduplication — design

> **Status:** Approved 2026-10-30 (front direction approved on mockups) ·
> Owner: @raphaelfh · Builds on
> [`2026-10-23-screening-v1-ai-prescreen-design.md`](2026-10-23-screening-v1-ai-prescreen-design.md)
> ("v1"). Where this document and v1 disagree, this one wins; §11 lists every
> amendment. v1's slice B (AI pre-screen) is still approved and unbuilt; nothing
> here forks its shape (§10).

## 1. Intent

Title/abstract screening shipped on 2026-10-25 (`a22c14d3`). Owner feedback on
it, in their words: it is still not easy to see all the articles and the
status of each; the flow should be very easy; the design should fit the rest
of the tool (the Articles section); full text is missing as a phase; there is
no deduplication. Backend and tables must stay lean.

Today's screen is a queue that shows one record at a time. A decided record
disappears (`frontend/components/screening/ScreeningQueue.tsx`), conflicts live
in a separate panel, and no view shows every article with its status. That
"decided records vanish" pattern is the most common user complaint about
Covidence (PMC6587262).

## 2. Goals, non-goals, anti-goals

**Goals**

1. Every article in a phase is a row with its status, in the same list + docked
   side-panel grammar as Articles. Decided rows stay visible and can be
   revisited.
2. Triage stays keyboard-fast: j/k move, `1/2/3` decide, auto-advance to the
   next "To screen" row.
3. Projects choose their phases: **title/abstract only**, or **title/abstract
   then full text**.
4. Full-text screening: read the PDF beside the decision. An exclusion needs
   exactly one reason, and "report not retrieved" is a recorded event.
5. Deduplication before title/abstract: managers review candidate pairs side by
   side and keep one. Nothing is deleted, and PRISMA "duplicates removed" is
   correct.
6. Every new human choice is append-only (constitution §IX).

**Non-goals (this design)**

- Bulk screening decisions of any kind.
- Keyword highlighting (moves to slice B, whose highlighter needs it).
- Fuzzy / trigram dedup tiers, multi-record group merge, metadata merge.
- A "don't screen" or "full text only" phase option. Unset config already means
  "not screening".
- Report ↔ study linking. The final PRISMA box is labelled "Reports included".
- Kappa, per-user shortcut maps, Unpaywall, PRISMA-S database names per import.
- Server-side paging (client-side filter and sort; size target in §4.6).
- Refusing to delete an article that has screening decisions. Owner ruling:
  keep today's behavior (the cascade stays).

**Anti-goals**

- A reviewer learning a peer's decision, or that a conflict exists on a record
  they hold a seat on, by any path (UI copy, 409, payload, PostgREST) before
  the record has an outcome. This includes the refusal of a revision (§6.3).
- A dedup action that deletes an article, a file or a decision.
- A second write path for screening state, or any new direct-PostgREST write.
- Stored state that can be derived: statuses, outcomes, candidate pairs,
  PRISMA counts and full-text eligibility are all read from rows.

## 3. Owner rulings (2026-10-30)

| # | Question | Ruling |
| --- | --- | --- |
| R1 | How do articles reach full text? | **Manager button** "Send N to full text"; N is derived. Not automatic. |
| R2 | Reviewers per article per phase | **Separate count per phase** (`full_text_reviewer_count`). |
| R3 | Fixing a mistaken decision | **Solo phases only** may re-decide (appended row). Dual review stays final. |
| R4 | Include vs maybe between two TA reviewers | **Stays a conflict** (today's rule, `screening_outcome.py:84-86`). |
| R5 | Screening column on the Articles list | **Yes, after full text** (slice S5). |
| R6 | Block deleting an article that has screening decisions | **No**, keep today's behavior. |
| R7 | Layout | **List + side panel** (option A); focus mode = the panel maximized. |

## 4. Shape of the screen

Screening stays a project tab (`?tab=screening`, `ProjectView.tsx`). It gets
Topbar sub-views through `frontend/components/layout/sectionViews.ts`, URL
param `screeningTab`, rendered by
`frontend/components/navigation/SectionViewSwitcher.tsx` (widen its
`extraction || quality` check):

`Duplicates` (managerOnly) · `Title/abstract` (default) · `Full text` ·
`Settings` (managerOnly).

- `SectionViewSwitcher` highlights `views[0]` when the URL has no value
  (`SectionViewSwitcher.tsx:28`). Add an optional `defaultValue` to the
  section config so screening highlights `title_abstract` with Duplicates
  listed first; the page renders the same default.
- Add copy key `viewsScreeningAria` (the switcher falls back to
  `viewsExtractionAria` today, `:37-40`). No `sectionDescriptionKey` for
  screening (the breadcrumb shows none).
- `managerOnly` only hides a tab. A non-manager who deep-links
  `?screeningTab=duplicates|settings` is redirected to `title_abstract`
  (replace) with no toast; the backend still refuses (403) on its own.
  **The redirect waits for the role**: its source is
  `ScreeningConfigRead.can_manage` (`backend/app/schemas/screening.py:16-26`,
  read through `useScreeningConfig`), and it fires only once that query has
  succeeded; while it is pending or errored the page shows the §4.6 loading /
  error state and never redirects (a manager's deep link must not bounce while
  the role loads). The switcher's tab hiding keeps `useProjectMemberRole`
  (`SectionViewSwitcher.tsx:20-23`), which only hides tabs, never navigates.
- **Sub-views per slice**: S1 ships `Title/abstract` + `Settings`; S2 adds
  `Duplicates` (and with it `defaultValue` and the "Duplicates listed first"
  test); S3 adds `Full text`. Within the shipped set the sub-views are static:
  no counts, never hidden. A sub-view that does not apply explains itself in
  its empty state (for example "Full-text screening is off" + a Settings link
  for managers).
- The PRISMA tab is unchanged except for §7.4 and §8.4.
- `?assignment=<id>` (`ScreeningTab.tsx:72-77`) is removed, not redirected: S1
  ignores the param and strips it (replace). Selection is `?article=<id>`; the
  `?assignment=` test (`ScreeningTab.test.tsx:395`) is rewritten against
  `?article=`.
- **"Import from PubMed"** (today in `ScreeningHeader.tsx:95-99`, every member,
  rendered above `NothingEnrolled`, `ScreeningTab.tsx:105-108`) moves to the
  Title/abstract toolbar, every member except a viewer (read-only, §4.6). The
  toolbar always renders, whatever the state below it, including "not set
  up". "Enroll all" (`EnrollAllButton`) moves to the same
  toolbar (manager). **"Nothing enrolled" is not an empty state**: the list
  shows every article as a Not enrolled row (the §5 anti-join) with an "Enroll
  all" call to action above it (manager; members see "A manager enrolls
  articles"). The true empty state ("No articles yet" + the toolbar's import)
  is only for a project with 0 articles.
- **First run**: a manager whose screening is not set up lands on Settings; a
  member sees the "not set up" empty state. Both are decided from the loaded
  config read (`can_manage`, `reviewer_count` null), only after it has
  succeeded, the same gate as the redirect above.

### 4.1 Shared shell

Extract `ListDetailSplitShell` from `frontend/components/articles/ArticlesSplitShell.tsx`.
It keeps the resizable list/panel split (55/45, the same mins and max), `⌘⇧B`
panel toggle, vertical orientation below `lg`, and the Topbar
`PanelToggleButton`. It adds **maximize** (`⇧⌘\`, the
`frontend/components/runs/RunSplitShell.tsx` pattern): the list hides and the
panel takes the full width. The list stays **mounted but hidden** while
maximized, so its state (scroll, filters, checked rows, cursor) survives a
restore. The chord matches `event.code === 'Backslash'`: with Shift held,
`event.key` is `|` on US layouts, and `useKeyboardShortcuts` matches `e.key`
only (`useKeyboardShortcuts.ts:94-97`). `RunSplitShell` has the same latent
bug (`key: "\\"`, `RunSplitShell.tsx:62`; its test fires `key: "\\"` with
`shiftKey`, `RunSplitShell.test.tsx:207`); it is fixed in S3b, where that file
is first touched. Maximize is uncontrolled in S0; S1 adds a controlled
`maximized` / `onMaximizedChange` prop pair so "Start screening" (§4.2) can
maximize the panel. `Esc` undoes one thing per press, in this order:
open popover/menu → maximize → panel → URL selection (`?article=`) → checked
rows. **Mechanism**: the shell's Escape is a capture-phase `window` keydown
listener (the `RunSplitShell.tsx:78-88` precedent), so it runs before the
list's bubble-phase window listener. It yields (returns without
`preventDefault`) while a popover, menu or dialog is open (`isDialogOpen`,
`useKeyboardShortcuts.ts:53`, plus the list's filter-popover state) or while
focus is in a text field; otherwise it undoes the first applicable step,
calls `preventDefault` + `stopPropagation`, and stops. Clearing checked rows
is the **last link of the shell's chain**, not the list's: screening passes
no `deselectAll` to `useListKeyboardShortcuts`, whose Escape branch
(`useListKeyboardShortcuts.ts:53-64`) has no `inInput` guard and would
otherwise clear rows from a text field or race the shell
(`:80-93` registers it in bubble phase). The list's Escape keeps only closing
its filter popover, the first link. S1d also adds an `event.defaultPrevented`
early return to the list hook's Escape branch, so an Escape the shell already
handled never reaches it. One press therefore never does two steps.
Articles moves onto the shell with no visible change.
The article-specific pieces (dirty-discard dialog, `ArticleSidePanel`, copy
keys, ids) stay in `ArticlesSplitShell` as the caller. Maximize and the Esc
chain are opt-in props (`maximizable`, `escapeCloses`); **Articles opts out of
both in S0**, so it really has no visible change (`ArticleFieldRow.tsx:241`
keeps Escape for reverting an edit, and closing still goes through the dirty
guard `requestCollapse`; Articles keeps passing `deselectAll` to the list
hook as today). Screening opts in. Esc never fires while focus is in a text
field. S0's unit test pins the capture-phase ordering (shell listener runs
before a bubble-phase window listener; yields under an open dialog and in a
text field); S1 tests the combined list + shell chain. When the maximized screening panel renders `RunSplitShell`
(§7.3), the outer shell owns `⇧⌘\` and Esc: `RunSplitShell` gets a prop that
disables its own chord and capture-phase Escape (`RunSplitShell.tsx:62`,
`:78-88`) while nested; that prop ships in S3b. The panel's open
state stays local and the URL owns selection, the same model as Articles
(side-panel spec §7) with its own param: Articles selects through
`?articleEditor=edit&articleId=` (`ProjectView.tsx:78-89`, `:225-233`);
screening uses `?article=<id>` in any screening sub-view. `useFeedback.ts:23`
already reads `?article=` to attach feedback to an article; that pickup is
intended.

### 4.2 List (title/abstract and full text)

Built from `frontend/components/shared/list/*`, not from `ArticlesList.tsx`.

- **Status views**: a segmented control with counts (same visual as
  `SectionViewSwitcher`), URL `?status=`. A view with 0 stays visible but
  muted, except Conflict and Not enrolled, which hide at 0.
- **Default view by role**: reviewer → To screen; consensus (an arbitrator;
  every arbitrator also reviews in this tree) → Conflict when > 0, else To
  screen; manager or viewer → All.
- **Search** `ListToolbarSearch` (`⌘F`). **Filter** `FilterButtonWithPopover`
  (`F`): Title, Authors, Journal (text); Year (range); My decision; Exclusion
  reason; Source; PDF (FT). `ActiveFilterChips` below the toolbar.
- **Sort** `ListDisplaySortPopover`: Queue order (default), Title, Year, Status.
  Queue order is the server order. It stays the default because slice B's
  calibration reads the longest queue-order prefix (v1 §6.3).
- **Columns**: checkbox · Title · Year (md+) · Journal (lg+) · Mine (my decision;
  hidden for non-reviewers) · Status · Reason (FT on by default, TA off) ·
  PDF (FT only). No reviewer-count column. Narrow widths use `ResponsiveList`
  → `ListRowCard`.
- **Active row**: the row open in the panel gets the selection tint
  (`bg-muted/60 font-medium`).
- **Progress strip** (one line, h-7, under the toolbar), computed from the
  same payload: "X of N decided · you: M left · K to full text →". The link
  switches to the Full text sub-view. S1 renders only "X of N decided · you:
  M left"; S3 adds the "K to full text →" segment.
- **Toolbar actions**: "Import from PubMed" (every member but a viewer, §4); "Enroll N new"
  (manager, TA); "Send N to full text" (manager, FT; §7.2; S3); "▶ Start
  screening" (primary; only when "you: M left" > 0; selects the first To
  screen row in queue order and maximizes).
- **Bulk actions** (selection replaces `ListCount` as in Articles): Enroll
  selected (manager, TA) and Export selected (CSV, client-side, the row fields
  of §5; no abstract, the records payload has none). Nothing else.

### 4.3 Status vocabulary (one set of copy keys, all sub-views)

Verbs on buttons, participles on chips.

| Chip | Meaning (from `caller_status` / derived) |
| --- | --- |
| To screen | the caller can review, a seat is free and the caller has not decided (`caller_status` = `awaiting_me`) |
| Waiting for others | the caller decided (`snapshot.seats(caller)`); no outcome yet |
| In review | the caller has no decision and is not an unseated arbitrator in conflict; no outcome yet |
| Conflict | unseated arbitrator only (`screening_outcome.py:107-111`) |
| Included · Excluded · Maybe | outcome (small icon when arbitrated) |
| Not retrieved | FT outcome `not_retrieved` |
| Not enrolled | TA, article has no TA assignment and is not a removed duplicate |

A removed duplicate (S2) is **not** a row in the Title/abstract or Full text
lists and counts in none of their views, the progress strip, or "Enroll N
new". It appears only in the Duplicates sub-view (Resolved) and, in S5, on the
Articles list as "Duplicate".

A seat is a decision (`AssignmentSnapshot.seats`,
`screening_review_service.py:96-98`). Waiting for others and In review are
both `caller_status` = `awaiting_others` (`screening_outcome.py:109-111`); the
records read tells them apart with `snapshot.seats(caller)`.

"In review" for an unseated non-arbitrator implies all seats are filled
without an outcome, i.e. a conflict. This is accepted: that person holds no
seat, so it leaks no peer decision to anyone who must still decide.

### 4.4 Side panel content

- **To screen**: `RecordBody` + `DecisionButtons` pinned at the bottom (reused).
  After a decision the row stays with its new chip in the current view, even
  when its new status no longer matches it (session-sticky decided ids),
  until the user changes the view, search or a filter, or reloads; the cursor
  moves to the next To screen row **in queue order**, the live-region
  announcement is kept,
  and the next two `GET /screening/assignments/{id}` are prefetched.
- **Waiting / In review / decided**: the `AssignmentView` body, read-only,
  showing exactly what the server returns. Its back button is removed.
- **Solo phase, decided by the caller**: the decision buttons stay active with
  the recorded-choice ring on the current decision; pressing another value
  re-decides (§6.3). A toast confirms "Changed to Exclude".
- **Conflict** (arbitrator): the ruling form extracted from `ConflictsPanel`'s
  `ConflictCard` (adopt a reviewer's decision or override, with a note).
  `ConflictCard` is typed on `ScreeningConflictsRead['items'][number]`
  (`ConflictsPanel.tsx:24,29`); the extracted form is retyped on
  `ScreeningAssignmentRead` (`peer_decisions`, `exclusion_reasons`).
  **Re-ruling is API-only**: `arbitrate` keeps accepting a new ruling on an
  arbitrated record (`screening_review_service.py:335`), but no UI offers it
  (YAGNI); an arbitrated record shows the read-only body.
  Reviewers are labelled "Reviewer A / B / C", not by name, to reduce
  authority bias; the payload keeps `reviewer_name` (audit, other states) and
  only the conflict ruling form hides it. Every other panel state shows names
  exactly as the server returns them, as today.
- **Not enrolled**: metadata + "Enroll" (manager).
- **Not retrieved** (FT): unseated arbitrator → read-only body + the ruling
  form ("PDF found later", §7.3); everyone else → read-only body.
- **Full text**: §7.3.

### 4.5 Keyboard

All new bindings go through `frontend/hooks/useKeyboardShortcuts.ts` (input
and dialog guards). Do not add bare keys to `useListKeyboardShortcuts`, which
has no dialog guard. **One exception**: the shell's Escape is its own
capture-phase `window` listener (§4.1), because the chain must run before the
list's bubble-phase Escape; it applies the same input and dialog guards by
hand.

| Key | Action |
| --- | --- |
| j / k, ↓ / ↑ | move the row cursor; the panel follows when open |
| Enter | open the panel |
| Esc | popover → maximize → panel → URL selection → checked rows, one per press; shell capture-phase listener owns the chain (§4.1) |
| x · ⇧-click · ⌘A | toggle row · range · select visible. Only ⌘A exists (`useListKeyboardShortcuts.ts:66-78`); `x` and ⇧-click range are new S1 work with their own tests |
| `⇧⌘\` | maximize / restore the panel |
| 1 / 2 / 3, E, 1–9 | decide (only while the panel shows a decidable record); `screeningKeyAction(event, armed, phase)` in `frontend/lib/screening/keymap.ts` |
| ? | popover listing every key (S4) |

TA: `1` include, `2` exclude now, `3` maybe, `E` arms the reason list, then
`1–9` picks a reason. FT: `1` include, `2` or `E` arm the reason list (a reason
is required), `3` does nothing. Moving the cursor writes nothing.

**Signature change**: `screeningKeyAction(event, reasonsOpen)` becomes
`screeningKeyAction(event, armed, phase)` (`keymap.ts:28`); the
`ScreeningKeyAction` type gains no `not_retrieved` case ("Report not
retrieved" has no key). Consumers: `DecisionButtons.tsx` and
`keymap.test.ts`. S1 makes the change with `phase` = `title_abstract` only;
S3 adds the FT branch.

### 4.6 States every sub-view handles

Every sub-view, list level:

- Loading (skeleton rows, the `HITLArticleTable` pattern, not a spinner).
- Error (`ErrorState` with retry).
- Not set up (manager: link to Settings; member: who sets it up). The records
  read returns 409 `SCREENING_NOT_CONFIGURED` here (§5); the UI gates on the
  config read and never issues it.
- 0 articles in the project: the empty state with the toolbar import (§4).
- Nothing enrolled at TA: Not enrolled rows + "Enroll all" call to action (§4).
  Nothing enrolled at FT (S3): "No records in full text yet" + "Send N to full
  text" (manager) or "A manager sends records to full text" (member).
- Empty filter result ("No records match" + clear filters).
- A status view with 0: the view stays visible and muted and its list shows
  "No records in this view"; Conflict and Not enrolled hide at 0 (§4.2).
- Viewer (read-only: no decision buttons, no toolbar writes — no "Import
  from PubMed" either).
- Not set up: the toolbar (import for non-viewers) still renders above the
  notice.
- Non-manager on a managerOnly sub-view (redirect, §4), only after the config
  read (`can_manage`) has loaded; while it loads, the loading state, no
  redirect and no first-run landing on Settings.
- `GET /duplicates` or a Settings write refused 403 (`ErrorState` "Only
  project managers can do this").
- Narrow width (`ListRowCard`, panel stacks vertically).

Panel and selection:

- `GET /screening/assignments/{id}` loading (skeleton body) and error
  (`ErrorState` with retry inside the panel; the list stays usable).
- `?article=<id>` not among the phase's rows (client miss, no request), or a
  403/404 on its assignment, or the selected row dropping out after a refetch
  (removed duplicate, moved article): clear the param (replace) and toast "This
  article is not in this phase". The same toast maps a 404 from `decide` /
  `arbitrate` on a removed record's assignment (§8.3).
- Decide / arbitrate in flight: buttons busy, keys ignored until settled. A
  409 shows the mapped error toast and refetches the records and the
  assignment.
- Settings save pending (controls disabled) and 409
  `SCREENING_CONFIG_FROZEN` (toast + refetch config, the control shows its
  lock hint).
- Duplicates (S2): "No open pairs" empty state on Open/Exact/Likely/Possible;
  a verdict refused with a `DUPLICATE_*` code toasts the mapped copy and
  refetches `duplicates`; `?article=<id>` that is in several pairs selects the
  first open pair containing it in list order (else the first resolved one).
- "Send N to full text" in flight (S3): the button is busy and disabled; on
  success it toasts "Sent N to full text".

**Size target** (my call): projects up to **5,000 articles** in one phase with
client-side filter/sort and no virtualization. S1's plan includes a measured
render check at 5,000 rows (mount + one status-view switch + one decision
refetch); if it exceeds 200 ms on the CI runner, S1 adds row windowing to
the list before shipping. Above 5,000 is a known limit, recorded in the PR.

## 5. One read model

`GET /api/v1/projects/{project_id}/screening/records?phase=title_abstract|full_text`
(S1 ships `title_abstract`; S3 adds `full_text`; S5 makes `phase` optional).

- Guard `require_project_scope`; ownership predicate in the WHERE clause
  (`.claude/rules/backend.md` § Ownership guards); rate limit 120/min (as the
  queue and decide routes, `endpoints/screening.py:114,163`).
- Unconfigured project → 409 `SCREENING_NOT_CONFIGURED`, as the queue does
  today (`screening_review_service.py:193-195`). The UI gates on the config
  read and never calls it then.
- No abstracts in the payload (the panel reads `GET /screening/assignments/{id}`);
  a schema contract test asserts `ScreeningRecordRow` has no abstract field.
- Row: `article_id, assignment_id (nullable), queue_rank, title, first_author,
  publication_year, journal_title, pmid, doi, ingestion_source, has_pdf, status,
  my_decision, my_exclusion_reason, outcome, outcome_exclusion_reason,
  outcome_kind`. `status` uses the §4.3 vocabulary, derived through
  `assignment_states` (`backend/app/services/screening_review_service.py:124`)
  + `caller_status` (`backend/app/services/screening_outcome.py`), split by
  `snapshot.seats(caller)` (§4.3). `outcome*` fields are present only when the
  record has an outcome.
- Top level: `reviewer_count` (for the phase), `inclusion_criteria`,
  `exclusion_reasons`. Add `protocol_inclusion_criteria` next to
  `protocol_exclusion_reasons` (`project_ai_context.py:197`, the only helper
  today) in `backend/app/services/project_ai_context.py`, with a unit test.
- TA rows include not-enrolled articles (anti-join). `has_pdf` = `EXISTS
  article_files WHERE file_role = 'MAIN'`.
- It replaces `GET /screening/queue` and `GET /screening/conflicts`. Both are
  deleted with their schemas and everything only they reach (§9 "Deleted or
  moved code"); vulture stays green; regenerate
  `frontend/types/api/schema.d.ts`.
- Fix the stale md5 comment in `backend/app/repositories/screening_repository.py`
  (≈`:52-54`): `md5(assignment.id)` gives every reviewer the same order. Sibling
  `refactor(screening)` commit.

**Query keys** (`frontend/lib/query-keys/screening.ts`): remove `queue` and
`conflicts`; add `records(projectId, phase?)` = `phase ?
[...project(projectId), 'records', phase] : [...project(projectId),
'records']`. The phase-less form drops the trailing element rather than
carrying `undefined`: TanStack's `partialMatchKey` compares element-wise, so
`[..., 'records', undefined]` would not prefix-match `[..., 'records',
'title_abstract']`. `records(projectId)` is thus the prefix of every phase (a
unit test pins both shapes and the prefix match); and `duplicates(projectId)` = `[...project(projectId),
'duplicates']`. Both sit under `project(projectId)`, so every existing
screening mutation, which invalidates that prefix (`useScreeningConfig.ts:46,60`,
`useScreeningConflicts.ts:47`, `useScreeningQueue.ts:65`,
`usePubmedImport.ts:95`), covers them with no change. Must pass
`check_react_query_keys`.

**Query invalidation**. The app's `staleTime` is 5 minutes (`App.tsx:61`), so
a write path that skips invalidation shows stale rows for that long.

| Write path (call site) | Invalidates |
| --- | --- |
| decide · arbitrate · enroll (either phase) · config PUT · PubMed import (existing hooks above; `useDecide`/`useArbitrate` move per §9) | `project(projectId)` (as today) + `assignment(id)` for decide/arbitrate |
| duplicate verdicts (S2 hook) | `project(projectId)` |
| RIS / Zotero import (`onImportComplete`, `ProjectView.tsx:278-289`, today only `loadArticles`) | `project(projectId)` added |
| article delete (`deleteArticles`, `ArticlesList.tsx:485,514`; no `queryClient` there today) | `project(projectId)` added |
| article create (`insertArticle`, `articlesService.ts:97`) and metadata edit (`updateArticle`, `:118`), both from `ArticleForm` | `project(projectId)` added |
| PDF attach (`uploadArticleFile`, `articlesService.ts:270`) | `project(projectId)` added (S3) |

The non-hook paths call one helper, `invalidateScreening(queryClient,
projectId)`, beside the query keys.

## 6. Configuration and decisions

### 6.1 Settings shape

`projects.settings.screening` (JSONB, written only through
`ProjectRepository.update_settings_key`, row-locked):

```json
{"reviewer_count": 2, "full_text_reviewer_count": 2, "ai_visible": false}
```

- `reviewer_count` (1–3) is the title/abstract count, unchanged.
- `full_text_reviewer_count` (1–3 or absent). **Absent = title/abstract only.**
  Present = full text is on with that many reviewers. No separate boolean.
- `ai_visible` is slice B's key, untouched.
- Locks, per phase: `reviewer_count` locks once any TA decision exists (today's
  `project_has_decision`, narrowed to `phase = title_abstract`);
  `full_text_reviewer_count` locks, and cannot be removed, once any FT
  assignment exists.

### 6.2 Settings sub-view

`SettingsPage / Group / Row` (`frontend/components/settings/`), `max-w-3xl`:

- **Phases**: radio "Title/abstract only" / "Title/abstract, then full text".
- **Reviewers per article — title/abstract** and **— full text** (moved from
  `ScreeningConfigForm`; each disabled with a `FieldHint` once locked).
- **Exclusion reasons**: read-only list from the protocol + "Edit in protocol".
  One list serves both phases. Read from `ScreeningConfigRead.exclusion_reasons`
  (§6.4, S1a), not from the records read, so Settings needs no records fetch.

S1 ships the title/abstract count with its lock hint and the reasons list. S3
adds the Phases radio and the full-text count (and the PUT with the key
absent / `null` / a value).

The `ScreeningHeader` chips are deleted.

### 6.3 Solo re-decide (R3)

`decide` accepts a new decision from a reviewer who already decided **only
when** the phase's reviewer count is 1, the assignment has no arbitration row,
and (TA only) the article has no FT assignment. It appends a new
`screening_decisions` row; the latest row per (assignment, reviewer) is
already the current one. Otherwise the existing `SCREENING_DECISION_FINAL`
409 stands. In dual review the refusal does not depend on peers, so it leaks
nothing. A TA re-decide refused because an FT row exists returns
`SCREENING_PHASE_ADVANCED`; that check and its code ship in S3 (no FT
assignment can exist before it). The decide route's 409 description ("a
decision is final", `endpoints/screening.py:157`) is reworded in S1.

Implementation notes: a re-decide **skips** the `SCREENING_REVIEWER_CAP`
check (`screening_review_service.py:257-260`; with a count of 1 the cap would
refuse it), and the arbitration / FT-assignment checks are read **after**
`lock_assignment`. The `derive_state` docstring ("A reviewer's decision is
final", `screening_outcome.py:76`) is updated.

### 6.4 Wire contract changes (`backend/app/schemas/screening.py`)

| Schema | Change | Slice |
| --- | --- | --- |
| `ScreeningDecisionValue` (`:9`) | add `"not_retrieved"` | S3 |
| `ScreeningConfigUpdate` (`:29-34`, `extra="forbid"`) | add `full_text_reviewer_count: int \| None` (1–3). Key absent = unchanged; `null` = turn full text off (refused once an FT assignment exists). `SCREENING_TOO_FEW_REVIEWERS` applies to both counts. | S3 |
| `ScreeningConfigRead` (`:16-26`) | add `exclusion_reasons: list[str]`, derived through `protocol_exclusion_reasons` (`project_ai_context.py:197-216`; `load_exclusion_reasons` `:213`); read by the Settings sub-view (§6.2) | S1 (S1a) |
| `ScreeningConfigRead` (`:16-26`) | add `full_text_reviewer_count`, `full_text_count_locked`, `full_text_ready`, `full_text_enrolled` | S3 |
| `ScreeningEnrollRequest` (`:37-44`) | add `phase` (default `title_abstract`). With `phase=full_text`, `article_ids` is refused (422, `VALIDATION_ERROR`): the server derives the ids. | S3 |
| new `ScreeningRecordRow` / `ScreeningRecordsRead` | §5 | S1 |
| `ScreeningRecordRow` | add `ta_outcome`, `ta_outcome_kind`, `ta_reviewer_count` (full-text rows only; `null` at TA) | S3 |
| `ScreeningAssignmentRef` | add `phase` (§7.1) | S3 |
| new `DuplicatePair` / `DuplicatesRead` (`backend/app/schemas/duplicates.py`) | §8.3 | S2 |
| new `DuplicateVerdictCreate` / `DuplicateVerdictsCreate` / `DuplicateVerdictsResult` | §8.3 | S2 |
| `ScreeningArticle` (`:52`) | add `mesh_terms`, `keywords`, `article_type`, `language` | S4 |
| removed `ScreeningQueueItem/Read`, `ScreeningConflictItem/Read` | with their endpoints | S1 |

Every public schema edit is followed by `npm run generate:api-types`
(`frontend/types/api/schema.d.ts` and `openapi.json`).

### 6.5 New error codes (`ApiErrorCode`, `backend/app/schemas/common.py:70-78`)

All are 409 via `ScreeningStateError` (`backend/app/services/screening_errors.py`),
matching every existing screening state refusal. Each gets a `CODE_TO_KEY`
entry (`frontend/lib/screening/errors.ts:14-27`) and a copy key.

| Code | When | Copy (en) | Slice |
| --- | --- | --- | --- |
| `SCREENING_PHASE_ADVANCED` | TA re-decide or re-ruling once an FT assignment exists | "This article is already in full-text screening." | S3 |
| `SCREENING_DECISION_NOT_IN_PHASE` | `maybe` at FT, `not_retrieved` at TA | "That decision is not available in this phase." | S3 |
| `SCREENING_REASON_REQUIRED` | FT exclude without a reason; FT enroll with no protocol reasons | "Pick an exclusion reason." | S3 |
| `DUPLICATE_HAS_REVIEW_WORK` | §8.3 | "This record already has full-text or extraction work, so keep it instead." | S2 |
| `DUPLICATE_KEPT_IS_REMOVED` | §8.3 | "The record you chose to keep was already removed as a duplicate." | S2 |

S1 adds no error code.

The two `DUPLICATE_*` codes map in a new `frontend/lib/duplicates/errors.ts`.

## 7. Full text (S3)

### 7.1 Schema

Migration `00xx_screening_full_text`:

- `screening_assignments` phase CHECK → `('title_abstract','full_text')`.
- `_DECISION_CHECK` on `screening_decisions` and `screening_arbitrations` →
  adds `'not_retrieved'`.
- Downgrade deletes `full_text` rows and `not_retrieved` rows; the roundtrip
  test asserts it.
- The model mirrors both CHECKs in the same task, so `alembic check` stays at
  zero diff: `_DECISION_CHECK` (`models/screening.py:34`) and the phase
  `CheckConstraint` (`:60`).

**Migration numbering** (S2, S3 and slice B): none holds a number in advance.
Each takes the next free number when its PR merges to `dev` and sets
`down_revision` to the then-current head (today `0094_screening_v1`,
`0094_screening_v1.py:47`). The same task bumps the head pin
`expected_head` (`backend/tests/integration/test_migration_roundtrip.py:1335`).
A conflict between them is only `down_revision` + that pin: slice B's
migration adds tables and columns and widens `ai_usage_ledger.pass_kind`; it
touches no CHECK this migration changes.

No new table, no new column. Replace the `SCREENING_PHASE` constant
(`models/screening.py:31`) with `TITLE_ABSTRACT` / `FULL_TEXT`; consumers
`screening_repository.py:25,48,82`, the model default (`:50`) and
`backend/tests/integration/helpers/screening_fixtures.py:22,83`. Thread `phase`
through `live_assignments`, `enroll`, `count_enrolled`, `current_decisions` /
`latest_rulings`, `assignment_states` and the PRISMA joins. `count_enrolled`
stays TA-only where it feeds config `not_enrolled` and PRISMA `other_removed`
(§8.4; after S2 it no longer feeds `duplicates_removed`).

**Per-phase reviewer count in the services**: `ScreeningAssignmentRef`
(`schemas/screening.py:175`) gains `phase`. `reviewer_count_of(settings)`
(`screening_config_service.py:34-38`) becomes `reviewer_count_of(settings,
phase)`, returning `full_text_reviewer_count` for `full_text`. Every caller
passes the assignment's phase: `decide` (`screening_review_service.py` ≈`:232`),
`arbitrate` (≈`:315`), `get_assignment` / `_read` (≈`:188-190`), the records
read, and `prisma_service.py` (≈`:154`, once per phase). This count drives
`derive_state`, the reviewer cap and the solo re-decide rule.

### 7.2 Entering full text (R1)

`POST /screening/enroll` gains `phase`. With `phase = full_text` the server
derives the article ids itself: articles whose TA outcome is include or maybe
and that have no FT assignment. Idempotent (`ON CONFLICT DO NOTHING`), one
write path. The toolbar button "Send N to full text" shows N = that derived
count (from config: `full_text_ready`, `full_text_enrolled`). It is disabled
when N = 0, when full text is off, or when the protocol has no exclusion
reasons (tooltip says which). The server refuses the same cases on its own:
full text off → 409 `SCREENING_NOT_CONFIGURED` (existing code); no exclusion
reasons in the protocol → 409 `SCREENING_REASON_REQUIRED`; N = 0 is a 200 with
`enrolled: 0`. With `phase = full_text` the result's `already_enrolled` is
`candidates - enrolled`, where `candidates` is the derived set read under the
same lock, so it is non-zero only when a concurrent send got there first.

### 7.3 Deciding

- Decision values at FT: `include`, `exclude` (exactly one reason, required),
  `not_retrieved` (no reason). `maybe` is refused at FT
  (`SCREENING_DECISION_NOT_IN_PHASE`); an FT exclude without a reason is
  refused (`SCREENING_REASON_REQUIRED`); `not_retrieved` at TA is refused
  (`SCREENING_DECISION_NOT_IN_PHASE`). Same validation in `arbitrate`, each
  with its own integration test.
- Conflict at FT: **signature change** `derive_state(reviewer_count,
  decisions, ruling)` (`screening_outcome.py:69-73`) gains
  `reasons_must_match: bool = False`, passed `True` at FT — differing
  values **or** differing exclusion reasons are a conflict. `not_retrieved` vs
  anything else is a conflict.
- "PDF found later": an unseated arbitrator may rule on an FT record whose
  outcome is `not_retrieved` (narrow exception to the arbitrate guard at
  `screening_review_service.py` ≈`:335`). The ruling is appended.
- A TA re-ruling once the article has an FT assignment → `SCREENING_PHASE_ADVANCED`.

**Panel**: a strip `Abstract | PDF` reusing `ArticleSidePanel`'s `ViewButton`;
defaults to PDF when a file exists. Maximized, the panel renders
`RunSplitShell` with the decision pane left and `RunPdfContent` right. Below
`lg`, the reader opens through `usePdfPanel` + `createViewerStore`, not
`useRunReader` (which force-closes below desktop).

**Decision pane**: TA provenance line ("Included at title/abstract · 2
reviewers, consensus"), fed by `ta_outcome`, `ta_outcome_kind` and
`ta_reviewer_count` on each full-text `ScreeningRecordRow` (§5, §6.4); Include `1`; Exclude `2` → inline reason list (`1–9`);
a ghost "Report not retrieved" button with no key; optional note
(`rationale`). Missing PDF: the empty state extracted from
`ArticleSidePanel.tsx` (≈`:102-113`) with its attach action; deciding stays
allowed with a "No PDF attached" line.

**List extras**: PDF column (Attached / Missing) and a Missing PDF filter;
Reason column on; client-side CSV export of FT-excluded reports with their
reason (PRISMA item 16b).

### 7.4 PRISMA

`backend/app/services/prisma_service.py` gains the reports box. "Reports
sought" reuses the existing `sought_for_retrieval` (TA include + maybe,
`schemas/prisma.py:33`); no second field. New fields: `reports_not_retrieved`,
`reports_assessed` (FT include + exclude outcomes), `reports_excluded_by_reason`,
`reports_included`, `ta_included` and `ta_maybe` (TA include / maybe outcomes,
always present), and one boolean `full_text_in_progress`. The flag is true
while any FT record has no outcome (pending and conflict together, never told
apart) **or** any TA include/maybe has not been sent to full text
(`full_text_ready > 0`, §7.2). So the box always adds up:
`sought_for_retrieval = reports_not_retrieved + reports_assessed + (FT
records without an outcome + unsent)`, and when the flag is false
`sought_for_retrieval = reports_not_retrieved + reports_assessed`. A unit test
asserts both. Update the `backend/app/schemas/prisma.py:3` docstring
("Deliberately no pending or in-conflict count") to say this one flag is the
exception.

`PrismaCountsPanel` shows "In progress" for the FT box while
`full_text_in_progress`, labels the last box "Reports included", and adds a
method line derived from config ("2 independent reviewers at title/abstract,
2 at full text; conflicts resolved by an arbitrator").

**Full text off** (my call): every FT field (`reports_*`,
`full_text_in_progress`) is `null`, the panel hides the reports box, and the
last box reads "Records included at title/abstract" (= `ta_included`). Maybe
outcomes are shown as "Maybe (not assessed)" (= `ta_maybe`) in that case so
nothing is silently dropped.

Sibling `refactor(prisma)`: rename the wire field `not_retrieved` →
`records_not_found` so it cannot be confused with the FT box. Consumers:
`prisma_service.py`, `schemas/prisma.py`, `PrismaCountsPanel.tsx` and its
test, the copy key `prismaNotRetrieved` (`frontend/lib/copy/screening.ts:128`,
renamed `prismaRecordsNotFound`), `backend/tests/unit/test_prisma_endpoint_unit.py:27`,
`backend/tests/unit/test_prisma_screening_box.py:59`,
`backend/tests/integration/test_prisma_counts.py` (`:78,135,157,179,192`),
`frontend/types/api/openapi.json` (`:9176,9193`, regenerated) and
`frontend/types/api/schema.d.ts`.

## 8. Deduplication (S2)

### 8.1 Table

Migration `00xx_article_duplicate_verdicts`. Table
`article_duplicate_verdicts`, INSERT-only:

| Column | Definition |
| --- | --- |
| `id` | uuid PK |
| `project_id` | FK `projects` ON DELETE CASCADE |
| `article_id` | FK `articles` ON DELETE CASCADE — the record removed (or judged distinct) |
| `kept_article_id` | FK `articles` ON DELETE CASCADE |
| `verdict` | CHECK `('duplicate','distinct','cleared')` |
| `basis` | CHECK `('pmid','doi','title','manual')` — snapshot, metadata is mutable |
| `decided_by` | FK `profiles` ON DELETE RESTRICT |
| `created_at` | `clock_timestamp()` |

CHECK `article_id <> kept_article_id`; indexes on `project_id`, `article_id`,
`kept_article_id` and `decided_by` (every FK leads an index, the 0094
convention enforced by `backend/tests/integration/test_screening_schema.py:336-354`;
extend that test's table list to this table). Same append-only trigger,
`deny_all` policy and REVOKE as `0094_screening_v1.py`, each asserted by a
schema test as for 0094. The model `ArticleDuplicateVerdict` is registered in
`backend/app/models/__init__.py` (import beside the screening models, `:65`,
and `__all__`). The current state of an unordered pair is its latest row.
`cleared` returns the pair to open; it is what Undo writes.

`kept_article_id ON DELETE CASCADE` is intended: deleting the kept article
deletes the verdict rows naming it, so the removed record comes back as a
normal article (nothing whose keeper is gone stays hidden). An integration
test asserts the revival.

### 8.2 Candidates (derived per request, `duplicate_repository.py`)

- **Exact**: PMID equal; or DOI equal (`doi_match_key`) **and** normalized
  titles equal.
- **Likely**: normalized title (≥ 20 characters) and year equal.
- **Possible**: DOI equal, titles differ (chip "Same DOI, different title").
- **Vetoes**: differing non-null DOIs never pair; differing non-null journals
  demote to Possible; a record whose `article_type` (free text,
  `article_source_normalization.py:182-185`) contains, case-insensitively,
  `congress`, `conference`, `meeting` or `protocol` (covers PubMed `Congress`,
  `Clinical Trial Protocol`), or equals a RIS `TY` tag `CONF`, `CPAPER` or
  `ABST` (stored raw, `frontend/lib/risParser.ts:204`), or whose Zotero item
  type `source_payload->'data'->>'itemType'` is `conferencePaper` (Zotero
  import never writes `article_type`, `article_source_normalization.py:60-111`;
  `source_payload` is the raw item, `:94`; no import change, no backfill), is
  never Likely or Exact by title — only by PMID.
- Pairs whose latest verdict is `duplicate` or `distinct` are dropped. A record
  already removed never pairs again.

### 8.3 Endpoints and rules

- Module names: endpoints `backend/app/api/v1/endpoints/duplicates.py`
  (registered in `api/v1/router.py`), service `services/duplicate_service.py`,
  repository `repositories/duplicate_repository.py`, schemas
  `schemas/duplicates.py`, model `models/article_duplicate.py`. Guard
  `Depends(require_project_manager)` on both routes, as
  `endpoints/screening.py:69`/`:93`; a non-manager gets 403 on both (tested);
  rate limits `60/minute` (GET) and `10/minute` (POST).
- `GET /projects/{id}/duplicates` (manager) → `DuplicatesRead {open:
  DuplicatePair[], resolved: DuplicatePair[]}`. `DuplicatePair`: `article_id`,
  `kept_article_id` (suggested by the keep order for open pairs; the recorded
  one for resolved), `tier` (`exact|likely|possible`), `basis`, `match_label`,
  and for each side the compare fields (title, authors, year, journal, DOI,
  PMID, `ingestion_source`, `has_pdf`, `has_abstract`, `screening_decisions`
  count, `has_review_work`); resolved pairs add `verdict`, `decided_by_name`,
  `created_at`.
- `POST /projects/{id}/duplicates/verdicts` body `DuplicateVerdictsCreate
  {items: DuplicateVerdictCreate[]}` with `DuplicateVerdictCreate {article_id,
  kept_article_id, verdict}`. **The server derives `basis`** from the
  candidate tier it recomputes for that pair (`manual` only when no tier
  matches); the client never sends it. Response `DuplicateVerdictsResult
  {written: int, enrolled_kept: int}`.
- `POST /projects/{id}/duplicates/verdicts` (manager), batch ≤ 500 (a longer
  `items` list is a 422 `VALIDATION_ERROR` from the schema), one
  transaction: takes the project row lock; binds every id through
  `owned_articles`; refuses a removed record that has an FT assignment or any
  extraction/QA work (`DUPLICATE_HAS_REVIEW_WORK`); refuses a kept record that
  is itself removed (`DUPLICATE_KEPT_IS_REMOVED`). "Extraction/QA work" =
  any row in `extraction_runs` or `extraction_instances` for the article (QA
  runs are extraction runs). "Has review work" in the keep order = any
  screening decision, FT assignment, or that work.
- **Keeping the record with less screening** (manager overrides the default
  keep order, my call): allowed. The compare panel shows a warning line before
  merging ("B's title/abstract decisions (2) are set aside; A will need
  screening"). If the removed record was enrolled at TA and the kept one is
  not, the same transaction enrolls the kept record at TA (one more insert
  through `ScreeningRepository.enroll`, the existing write path). No new
  error code.
- Removal is derived, never a delete. **The predicate**, one SQL expression in
  `duplicate_repository.py` reused everywhere: `removed_duplicate(article)` =
  some unordered pair containing the article has a latest
  `article_duplicate_verdicts` row with `verdict = 'duplicate'`, `article_id =
  article.id` **and `project_id = article.project_id`** (the
  project binding follows `ARTICLE_STILL_IN_PROJECT`,
  `screening_repository.py:35-38`, so a verdict written before an article
  moved projects never hides it in the new one). `live_assignments` and the
  enroll source add `NOT EXISTS removed_duplicate(article)`, including when
  `article_ids` are passed explicitly. Removed records leave every screening
  list and every PRISMA box except "duplicates removed"; their TA decision
  rows stay as audit. Undo/restore brings them back with no re-enroll.
- **Enroll counts** (`screening_config_service.py:120-130`): `candidates`
  becomes `total - removed` for an enroll-all and the owned, non-removed ids
  for explicit `article_ids`, so `already_enrolled = candidates - enrolled`
  never counts a removed record. Explicit ids that are removed duplicates are
  dropped silently (the client cannot select them: they are not rows).
- `decide` / `arbitrate` / `GET /screening/assignments/{id}` on a removed
  record's assignment → 404 (it leaves `live_assignments`;
  `screening_review_service.py:138,240-241`); the UI maps it to the "This
  article is not in this phase" toast (§4.6).

**Verdict edge cases**:

- `duplicate` on an article that is already removed (any pair): the item is
  skipped, not written and not counted in `written`, so one removed article
  has one live `duplicate` verdict and Undo of that pair restores it.
- Chains: removing a record that is the kept side of another pair is allowed;
  the first removed record stays removed (removal is per article). Undo of the
  second verdict restores only the second record.
- "Accept N exact" sends at most 500 pairs (label shows `min(N, 500)`; the
  manager repeats for the rest), and leaves out pairs whose suggested removed
  side has review work. A pair where both sides have review work can only be
  "Not duplicates" or left open.
- One refused item rolls back the whole batch (409 with that item's code);
  the client toasts it and refetches `duplicates`. Integration test.
- Dedup does not gate extraction: work started on a removed record later
  leaves it removed; Undo stays allowed (the review-work check runs only on a
  `duplicate` write).

### 8.4 UX

`Duplicates` sub-view on the same shell. Rows are **pairs** (a group of three
shows as pairs sharing the kept record). Columns: Title, Match chip (`PMID`,
`DOI + title`, `Same title`, `Same DOI, different title`), Sources, Year.
Status views: Open · Exact · Likely · Possible · Resolved.

Compare panel: two columns of field rows (title, authors, year, journal, DOI,
PMID, source, PDF, screening work), differences marked with a dot. A "Keep"
radio uses the recorded-choice ring; default keep order: has review work → has
a PDF → has an abstract → has an identifier → oldest. Buttons: "Merge, keep
selected" · "Not duplicates" · "Skip". Keys: j/k/Enter/Esc only. Toast "Merged
· Undo". "Accept N exact" asks in an `AlertDialog`. While open pairs exist,
"Enroll all" on Title/abstract asks "23 possible duplicates not reviewed.
Enroll anyway?". New copy namespace `duplicates`.

**PRISMA**: "Records identified" counts all project articles (enrolled ∪
removed duplicates ∪ not enrolled) in both `_pubmed_identified` and
`_other_sources`, not only enrolled ones. Not-enrolled, non-duplicate articles
map to "Records removed for other reasons": the copy key `prismaNotEnrolled`
("Imported but not enrolled", `lib/copy/screening.ts:129`; used at
`PrismaCountsPanel.tsx:76,113-116`) is renamed `prismaOtherRemoved` with that
text. So identified = duplicates_removed + other_removed + screened.

The no-clamp invariant (`duplicates_removed ≥ 0`) holds as long as no PMID is
linked by PubMed sync events to two project articles: `articles` has no unique
(project_id, pmid) (`baseline_v1.sql:1415` is a plain partial index;
`models/article.py:91`). A break shows as a negative count, as today (not
clamped). Cross-source cases, each an integration test: (a) a PubMed import
that matches an existing RIS article (sync status `updated`/`unchanged`, one
article) counts under RIS and under PubMed → one import-time duplicate in
`duplicates_removed`; (b) a RIS article and a PubMed-inserted article with the
same PMID (two articles) count once each → 0 until a manager removes one,
then 1 via `removed`; (c) a PubMed-sourced article with no sync event counts
once.

Formulas (let `total` = project articles, `removed` = articles matching
`removed_duplicate` (§8.3), `enrolled` = TA live assignments, which already
exclude removed):

| Field | Today | Now |
| --- | --- | --- |
| `identified` / `identified_total` | PubMed PMIDs and other sources, **enrolled articles only** (`_pubmed_identified`, `_other_sources`) | the same two functions over **all project articles**: `_pubmed_identified` = distinct PMIDs found by PubMed imports whose article is in the project, plus PubMed-sourced project articles that no PubMed sync event links (so they are counted once); `_other_sources` = every project article whose `ingestion_source` is not PubMed, grouped by source (today's rule, without the enrolled join) |
| `duplicates_removed` (`prisma_service.py:161`) | `identified_total - enrolled` | `identified_total - total + removed` (import-time merges + reviewed duplicates; ≥ 0 under the invariant above) |
| new `other_removed` | — | `total - enrolled - removed` |
| `imported_not_enrolled` (`prisma_service.py:163`) | `total_articles - enrolled` | replaced by `other_removed` (deleted). Consumers: `PrismaCountsPanel.tsx:76`, `:113-116`; `PrismaCountsPanel.test.tsx:34,48`; `frontend/e2e/flows/screening.ui.e2e.ts:45,158`; `test_prisma_counts.py:79,176,207-208,282`; `test_prisma_endpoint_unit.py:28`; `test_prisma_screening_box.py:60` |
| `not_enrolled` (`screening_config_service.py:82`) | `total - enrolled` | `total - enrolled - removed` |
| enroll-all `candidates` (`count_project_articles`, `screening_config_service.py:126`) | `total` | `total - removed` (§8.3 Enroll counts) |

## 9. Delivery slices

Each slice ships to prod on its own, in this order. A `/ship-spec` run ships
one slice; basename `2026-10-30-screening-workspace-s<N>`.

| Slice | User-visible outcome | Depends on |
| --- | --- | --- |
| **S0** Shell extraction | none (Articles on `ListDetailSplitShell`, + maximize) | — |
| **S1** Title/abstract workspace | every article with its TA status; list triage; conflicts in the panel; Settings sub-view; solo re-decide | S0 |
| **S2** Deduplication | Duplicates sub-view; correct "duplicates removed" | S1 |
| **S3** Full text | phase option, FT list + PDF, `not_retrieved`, PRISMA reports box | S1 |
| **S4** Reading upgrades | structured abstract, MeSH/keywords/type/language, criteria rail, notes, `?` keys | S1 |
| **S5** Articles column | stage chip per article on the Articles list | S3 |

**S4 detail**: reading column `max-w-[68ch]`, 15px; `parseStructuredAbstract()`
(upper-case labels ≤ 40 characters, plain-text fallback); PMID/DOI as links;
`article_type` and non-English `language` as chips; MeSH and keywords lines;
criteria as a rail when maximized and a "Criteria (n)" disclosure when docked;
note field (`rationale`) shown to arbitrators in the conflict view. Backend:
add `mesh_terms`, `keywords`, `article_type`, `language` to `ScreeningArticle`;
no migration.

**S5 detail**: a "Screening" stage chip on Articles rows (Not enrolled · TA
status · FT status · Included · Excluded · Duplicate) fed by `records` without
`phase`. The chip and its data hook live in their own component
(`ArticleScreeningChip`); `ArticlesList.tsx` (1,312 lines, baseline 1,335)
gets at most the column wiring, within its 23-line headroom.

**Sub-views per slice**: S1 Title/abstract + Settings · S2 + Duplicates
(with `defaultValue` and the Duplicates-first test) · S3 + Full text. S1
omits the progress strip's "K to full text" segment and "Send N to full
text".

**Task split** (for the plan; each brief ≤ ~300 lines). A slice still ships
as one PR.

| Task | Scope |
| --- | --- |
| S1a backend | records read (§5, incl. 409 unconfigured, 120/min, `protocol_inclusion_criteria`); `ScreeningConfigRead.exclusion_reasons` (§6.4) + contract test; solo re-decide (§6.3, TA only); queue/conflicts deletions (service, repository, endpoints, schemas) and unit/integration test migration; decide 409 doc; `RETIRED` symbols; `seed_screening` (conflict fixture); sibling `refactor(screening)` md5 comment |
| S1b frontend | switcher entry + `viewsScreeningAria`; managerOnly redirect and first-run landing gated on the loaded config (§4); list (status views, search/filter/sort, columns, progress strip, toolbar incl. import + Enroll + Start screening via the shell's controlled `maximized` prop (§4.1), bulk Enroll/Export); every §4.6 list-level state; Settings sub-view (TA part, reasons from config); `records` query key (§5 shape + unit test) + every §5 invalidation call site; `?assignment=` removal |
| S1c frontend | every panel state (§4.4, §4.6 panel list); conflict ruling form extracted from `ConflictCard` and retyped on `ScreeningAssignmentRead`; `useDecide`/`useArbitrate` move to `useScreeningMutations.ts`; consumers `AssignmentView.tsx` and `ScreeningParts.tsx` + their tests (`AssignmentView.test.tsx`) |
| S1d frontend | keyboard: keymap signature, `x`, ⇧-click, Esc chain integration (shell + list, §4.1) incl. the `defaultPrevented` guard in `useListKeyboardShortcuts`' Escape branch, auto-advance, prefetch; remaining deletions and test rewrites (`ScreeningTab.test.tsx`, `ScreeningQueue.test.tsx`, `ConflictsPanel.test.tsx`, `useScreeningQueue.test.tsx`, `screeningQueries.remount.test.tsx`); E2E rewrite; 5,000-row render check |
| S2a1 backend | migration + model + registration + schema tests (§8.1); candidates repository (tiers, vetoes incl. Zotero `itemType`) and `GET /duplicates` + schemas |
| S2a2 backend | `POST /duplicates/verdicts` (rules, edge cases, auto-enroll); removal predicate threaded into `live_assignments`, enroll and counts; PRISMA formulas (§8.4); seed duplicate pair |
| S2b frontend | Duplicates sub-view + `defaultValue`; compare panel; dialogs; Undo; `lib/duplicates/errors.ts`; copy (incl. `prismaOtherRemoved`); "Enroll anyway?"; E2E dedup step |
| S3a1 backend | migration + model CHECKs + head pin; `SCREENING_PHASE` split and phase threading; per-phase reviewer count; config (`full_text_reviewer_count`, locks, ready/enrolled); FT enroll |
| S3a2 backend | FT decide/arbitrate rules + S3 error codes; `reasons_must_match`; `SCREENING_PHASE_ADVANCED`; `phase=full_text` records + `ta_*` fields; PRISMA reports box, `ta_included`/`ta_maybe`, `refactor(prisma)` rename; seed FT record with PDF |
| S3b frontend | Full text sub-view (list, PDF column/filter, Reason column, CSV export); panel with PDF + `RunSplitShell` nested-shortcut prop and its `⇧⌘\` chord fixed to `event.code === 'Backslash'` (§4.1); keymap FT branch; Settings radio + FT count; Send to full text; progress strip segment; PRISMA panel; E2E full-text step |

**Deleted or moved code** (S1):

- Frontend files: `ScreeningQueue.tsx`, `ScreeningHeader.tsx` (whole file;
  its PubMed button and `EnrollAllButton` move per §4), the
  `ArbitratorWorkspace` function inside `ScreeningTab.tsx` (`:30`;
  `ScreeningTab.tsx` is rewritten, it imports every deleted piece), the
  `ConflictsPanel` list wrapper (its `ConflictCard` ruling form is extracted,
  retyped per §4.4 and kept), `useScreeningQueue.ts` and
  `useScreeningConflicts.ts`. `useDecide` (`useScreeningQueue.ts:40-68`) and
  `useArbitrate` (`useScreeningConflicts.ts:38`) move to
  `frontend/hooks/screening/useScreeningMutations.ts`; `useDecide`'s
  optimistic update on `screeningKeys.queue` (`:42-63`) is dropped (the
  records refetch and the cursor advance replace it). `ScreeningConfigForm`
  moves into the Settings sub-view.
- Frontend consumers: `AssignmentView.tsx` (imports `useDecide` from the
  deleted hook `:15`; back button `:103-116` and copy key `backToQueue`
  removed; `STATUS_LABEL` `:23-28` maps to the §4.3 keys) and
  `AssignmentView.test.tsx` (`:69-93`); `ScreeningParts.tsx` (`:9,11`, its
  `ScreeningArticle` type re-derived from `ScreeningAssignmentRead`).
- Tests rewritten against the new components, not just deleted:
  `ScreeningQueue.test.tsx`, `ConflictsPanel.test.tsx`,
  `useScreeningQueue.test.tsx`, `ScreeningTab.test.tsx` (mocks both deleted
  routes, `:31-32`; its `?assignment=` test `:395` and "Back to screening"
  assertion ≈`:400`), and
  `frontend/hooks/screening/__tests__/screeningQueries.remount.test.tsx`
  (mocks both fetches `:15-24`, imports `useScreeningConflicts` `:31` and
  `useScreeningQueue` `:33`).
- `frontend/services/screeningService.ts`: `fetchScreeningQueue` (`:102`),
  `fetchConflicts` (`:133`), the `ScreeningQueueRead` / `ScreeningConflictsRead`
  aliases (`:19`, `:22`); add `fetchScreeningRecords`.
- `scripts/fitness/check_retired_symbols.py` `RETIRED` gains word symbols
  (its matcher is `\b<sym>\b`, `:399`, so a path such as `/screening/queue`
  never matches): `fetchScreeningQueue`, `fetchConflicts`,
  `get_screening_queue`, `get_screening_conflicts`, `count_awaiting_me`,
  `queue_page`, `ScreeningQueueItem`, `ScreeningConflictItem`,
  `ScreeningQueueRead`, `ScreeningConflictsRead`.
- Backend: endpoints `get_screening_queue` (`endpoints/screening.py:115`) and
  `get_screening_conflicts` (`:188`); service methods
  `ScreeningReviewService.queue` (`screening_review_service.py:192`) and
  `.conflicts` (`:266`); repository `_awaiting` (`screening_repository.py:188`),
  `queue_page` (`:206`), `count_awaiting_me` (`:219`)
  (`assignments_with_articles` stays: `_read` uses it); schemas
  `ScreeningQueueItem/Read`, `ScreeningConflictItem/Read`. Unit tests
  `test_screening_review_unit.py` (`:25,34,65-66,72,106-111,128-137`) and
  `test_screening_arbitration_unit.py` (`:23,34,60-61,71,136-147`) lose the
  queue/conflicts handler cases; the integration tests migrate (acceptance
  "Old endpoints gone").
- Query keys `screeningKeys.queue/conflicts`; stale copy keys (`tabQueue`,
  `tabConflictsCount`, `summaryEnrolled`, `summaryReviewers`, `backToQueue`, …).

**Gates per slice** (in addition to lint, typecheck and tests):

- S1: knip (both modes), vulture green (the baseline holds none of the
  deleted symbols, so nothing to tighten), `check_copy_keys.py`,
  `check_react_query_keys`, `check_file_size`, `check_retired_symbols`,
  `check_scope_guards.py`, `check_button_scale.py`,
  `check_api_response_envelope.py`, `check_frontend_data_path.py`.
- S2: the S1 set + `check_rls_coverage.py`, `check_migration_split.sh`,
  `alembic check` zero diff.
- S3: the S1 set + `check_migration_split.sh`, `alembic check` zero diff.
- S4, S5: the S1 set.

**E2E and seed data** (never in migrations):

- `frontend/e2e/flows/screening.ui.e2e.ts` is rewritten in S1. Today it calls
  `/screening/queue` (`:114`), clicks the "Conflicts (1)" tab (`:126`) and
  "Use {name}'s decision" (`:128`); the new flow triages from the list and
  rules with "Reviewer A/B" labels.
- S2 (task S2b): a duplicate pair added to `SCREENING_ARTICLES`
  (`frontend/e2e/_fixtures/fixture-ids.ts:76-77`, provisioned by
  `ensure-fixtures.ts:195-200`); the E2E gains a dedup step (merge, Undo).
- S3 (task S3b): full-text records with and without a PDF; the PDF bytes go
  through the `article-pdf.ts` helpers (`fixtureArticlePdfKey` `:48`,
  `ensureArticlePdfBytes` `:58`). `resetScreeningProject`
  (`frontend/e2e/_fixtures/screening.ts:21`) today resets only
  `projects.settings`; it also resets the project's eligibility criteria to a
  fixed exclusion-reason list (the reasons come from
  `protocol_exclusion_reasons`, `project_ai_context.py:197-216`), since Send
  to full text needs reasons. The E2E gains a full-text step: send to full
  text, open the PDF, exclude with a reason.
- **Local seed** `backend/app/seed_screening.py`: local only, never called
  from `seed.py` (which runs on every prod boot, `backend/Dockerfile:100-114`,
  `railway.toml:60`, and sits at its `check_file_size` baseline,
  3,249/3,250). Own entry point `uv run python -m app.seed_screening` and a
  `make db-seed-screening` target. It refuses to run unless the database URL
  points at a local host (`localhost` / `127.0.0.1`); there is no environment
  flag to trust. It creates no auth users: like
  `backend/scripts/mcp_chat_eval/fixture.py`, it uses existing local
  `profiles` (refusing with a clear message when fewer than three exist) and
  uploads its PDF through `create_storage_adapter` (`fixture.py:144`
  pattern). Contents grow per slice: a project with a conflict (S1), a
  duplicate pair (S2), a full-text record with a PDF (S3), so
  `design-review` can render every sub-view locally.

### Acceptance tests (each requirement → its test)

| Slice | Requirement | Test |
| --- | --- | --- |
| S0 | Shell extraction is invisible | existing `ArticlesSplitShell*.test.tsx` green; new unit tests for maximize (chord fires on `code: 'Backslash'` with `key: '|'`; list stays mounted and keeps its state across maximize/restore), Esc chain (one step per press; capture-phase listener runs before a bubble-phase window listener and stops it; yields under an open dialog/popover and in a text field), below-`lg` orientation |
| S1 (S1a) | Records read is blind-safe | integration per role (seated reviewer, unseated reviewer, seated/unseated arbitrator, viewer, manager): `conflict` only for an unseated arbitrator; Waiting vs In review split by seat; no peer values in the payload; an article moved to another project drops out |
| S1 (S1a) | Records read contract | integration: unconfigured project → 409 `SCREENING_NOT_CONFIGURED`; rate limit 120/min declared; `has_pdf` true only with a MAIN file; schema contract: `ScreeningRecordRow` has no abstract field |
| S1 (S1a) | `protocol_inclusion_criteria` | unit beside the `protocol_exclusion_reasons` tests |
| S1 (S1a) | Config carries exclusion reasons | schema contract test: `ScreeningConfigRead` has `exclusion_reasons: list[str]`; integration: equals `protocol_exclusion_reasons` for the project's protocol |
| S1 (S1a) | Not-enrolled rows and counts | integration: anti-join rows; status-view counts match Vitest fixture |
| S1 (S1b) | Toolbar and import move | Vitest: toolbar with "Import from PubMed" renders for every member except a viewer in every state, including nothing enrolled and not set up; a viewer sees no toolbar write; nothing enrolled = Not enrolled rows + "Enroll all" (manager) / member copy; 0 articles = empty state; manager with no config lands on Settings |
| S1 (S1b) | Status views | Vitest: a view with 0 is muted and lists "No records in this view"; Conflict and Not enrolled hidden at 0 |
| S1 (S1b) | List toolbar and columns | Vitest: search, each filter, each sort (Queue order default); Mine column hidden for non-reviewers; progress strip "X of N decided · you: M left" (no FT segment in S1); "Start screening" only when M > 0, selects the first To screen in queue order and maximizes through the shell's controlled `maximized` prop |
| S1 (S1b) | Bulk actions | Vitest: Enroll selected posts the ids (manager only); Export selected CSV has the §5 row fields and no abstract |
| S1 (S1c) | Not enrolled panel | Vitest: manager "Enroll" posts that id; others see metadata only |
| S1 (S1b) | `?assignment=` removed | Vitest: the param is stripped (replace) and nothing opens |
| S1 (S1d) | Keyboard | Vitest: keys inert in a text field and under a dialog; auto-advance picks the next To screen in queue order; the decided row stays in the current view until a view/search/filter change or reload; the next two assignments prefetched; `x` toggles, ⇧-click selects a range; Esc order popover → maximize → panel → selection → checked rows with the list hook mounted (screening passes no `deselectAll`; one step per press; Esc in a text field clears nothing); unit: `useListKeyboardShortcuts` Escape ignores an event with `defaultPrevented` |
| S1 (S1d) | Keymap signature | `keymap.test.ts`: `screeningKeyAction(event, armed, phase)` for TA (S1) and FT (S3); `DecisionButtons` passes the phase |
| S1 (S1a, S1c) | Solo re-decide | integration: solo re-decide appends and changes the outcome; skips the reviewer cap; refused after arbitration; dual review still `SCREENING_DECISION_FINAL`. Vitest: recorded-choice ring and "Changed to Exclude" toast |
| S1 (S1a, S1d) | Old endpoints gone | shipped `test_screening_review.py`, `test_screening_arbitration.py`, hook/component tests and `frontend/e2e/flows/screening.ui.e2e.ts` migrated to the new read, not deleted; `check_retired_symbols` green with the new word symbols |
| S1 (S1b (list), S1c (panel)) | §4.6 states | Vitest per shipped sub-view, one case per bullet of §4.6 (list level and panel) |
| S1 (S1b) | Settings sub-view (TA) | Vitest: TA count, lock hint, reasons list (from `ScreeningConfigRead.exclusion_reasons`) + "Edit in protocol"; save pending; 409 `SCREENING_CONFIG_FROZEN` |
| S1 (S1b) | Records query key | unit: `records(p)` = `[...project(p), 'records']` (no trailing `undefined`), `records(p, 'title_abstract')` appends the phase; `records(p)` prefix-matches every phase |
| S1 (S1b) | Query invalidation | Vitest: each §5 write path (call site listed there) invalidates `screeningKeys.project(projectId)` |
| S1 (S1d) | Size target | Vitest/bench: 5,000-row render check (§4.6), number recorded in the PR |
| S1 (S1c) | Reviewer labels | Vitest: conflict ruling form shows "Reviewer A/B", no names; other states show names |
| S1 (S1b) | Default status view by role | Vitest: reviewer → To screen; consensus → Conflict when > 0, else To screen; manager/viewer → All |
| S1 (S1b) | Switcher | `SectionViewSwitcher.test.tsx`: screening entry with Title/abstract + Settings; `viewsScreeningAria` label. Vitest (page): non-manager deep link to `settings` redirected only after the config read resolves (`can_manage` false); no redirect and no first-run landing while it is pending or errored; manager deep link never bounces |
| S2 | Switcher default | `SectionViewSwitcher.test.tsx`: `defaultValue` highlights Title/abstract with Duplicates listed first |
| S2 | Dedup schema | roundtrip test; append-only trigger, `deny_all`, REVOKE tests; `test_every_foreign_key_leads_an_index` (`test_screening_schema.py:336-354`) extended to `article_duplicate_verdicts`; `kept_article_id` cascade revives the removed record |
| S2 | Dedup access | integration: non-manager 403 on `GET /duplicates` and `POST /duplicates/verdicts`; batch > 500 → 422 |
| S2 | Dedup tiers | integration: each tier and each veto (incl. Zotero `itemType = conferencePaper`); `distinct` suppresses; `cleared` reopens; each 409; foreign article id refused; moved article ignored (project-bound predicate) |
| S2 | Dedup verdict edge cases | integration: `duplicate` on an already-removed article skipped; chain keeps the first removed; one refused item rolls back the batch; decide/arbitrate on a removed record's assignment → 404 |
| S2 | Dedup removal derived | integration: enroll skips removed (explicit ids too); enroll-all `already_enrolled` excludes removed; restore restores the assignment; PRISMA arithmetic before/after a merge |
| S2 | Removed duplicates hidden | integration: absent from records rows and the not-enrolled anti-join; config `not_enrolled = total - enrolled - removed` |
| S2 | Dedup PRISMA | integration: cross-source cases (a)–(c) of §8.4; `other_removed` replaces `imported_not_enrolled`; Vitest: "Records removed for other reasons" label |
| S2 | Keep-the-other merge | integration: warning data present; kept record auto-enrolled at TA when the removed one was. Vitest: set-aside warning line shows |
| S2 | Dedup basis | integration: client cannot set `basis`; server records the recomputed tier |
| S2 | Dedup compare panel | Vitest: default keep order (review work → PDF → abstract → identifier → oldest); difference dots on differing fields |
| S2 | Dedup dialogs | Vitest: "Accept N exact" `AlertDialog` with `min(N, 500)`, excluding pairs with review work on the removed side; Undo posts `cleared` |
| S2 | "Enroll anyway?" | Vitest: dialog shows while open pairs exist, not otherwise |
| S2 | Dedup performance | integration at ~10k articles; threshold measured, recorded in the PR |
| S2, S3 | Error maps | `errors.test.ts`: new `CODE_TO_KEY` entries in `lib/screening/errors.ts` (S3) and `lib/duplicates/errors.ts` (S2) |
| S3 | FT schema | roundtrip test for the FT migration; `test_decision_value_is_checked` (`test_screening_schema.py:228`) accepts `not_retrieved`; `alembic check` zero diff |
| S3 | Settings sub-view (FT) | Vitest: phase radio, FT count, its lock hint; integration: PUT with key absent / `null` / value |
| S3 | Per-phase reviewer counts | integration: TA lock ignores FT decisions; FT count locks once an FT assignment exists; removing it refused then |
| S3 | Per-phase count resolution | integration: an FT assignment uses `full_text_reviewer_count` for cap, outcome and solo re-decide |
| S3 | FT enroll | integration: derives include+maybe only; idempotent; `already_enrolled` semantics; TA PRISMA box unchanged after FT enroll |
| S3 | FT enroll refusals | integration: full text off → `SCREENING_NOT_CONFIGURED`; no reasons → `SCREENING_REASON_REQUIRED`; `article_ids` with `phase=full_text` → 422 |
| S3 | FT decision rules | integration: maybe refused; `not_retrieved` at TA refused (`SCREENING_DECISION_NOT_IN_PHASE`); exclude without reason refused; the same three in `arbitrate`; differing reasons → conflict; `not_retrieved` vs include → conflict; `not_retrieved` reopen path |
| S3 | TA re-decide / re-ruling after FT | integration: TA `decide` and `arbitrate` refused with `SCREENING_PHASE_ADVANCED` once an FT assignment exists |
| S3 | FT panel | Vitest: PDF default when a file exists; missing-PDF state with attach; below-`lg` reader opens; nested shortcuts — outer `⇧⌘\`/Esc win; `RunSplitShell`'s chord fires on `code: 'Backslash'` with `key: '|'`; TA provenance line from `ta_*` fields |
| S3 | FT list extras | Vitest: PDF column and Missing PDF filter; Reason column on; progress strip "K to full text →" segment |
| S3 | Not retrieved panel | Vitest: unseated arbitrator gets the ruling form; others read-only |
| S3 | Send to full text | Vitest: disabled for N = 0, FT off, no reasons, each with its tooltip; in-flight busy state |
| S3 | CSV export | Vitest: FT-excluded export has one row per report with its reason |
| S3 | FT PRISMA | unit: arithmetic incl. the in-progress state; `sought_for_retrieval` adds up with and without the flag; the flag is true while unsent include/maybe exist |
| S3 | PRISMA rename and FT off | unit: `records_not_found` on the wire; FT-off payload has `null` FT fields and `ta_included`/`ta_maybe`. Vitest: `PrismaCountsPanel` "In progress", method line, "Records included at title/abstract", "Maybe (not assessed)" |
| S4 | Reading upgrades | unit: `parseStructuredAbstract` (prose such as "Note: …" must not match); schema contract test; Vitest: `?` popover lists every key |
| S5 | S5 column | Vitest: each stage chip; integration: no-phase records read stays blind-safe (role matrix reused) |
| all | Design | `design-review` at desktop and narrow width for every new sub-view |

## 10. Slice B (AI pre-screen) compatibility

The AI column and rail section are reserved, not built. Suggestions key on
`assignment_id`, so they are phase-aware without change, but slice B
suggests at **title/abstract only**: its suggestion values include `maybe`,
which full text refuses (`SCREENING_DECISION_NOT_IN_PHASE`). `ai_visible` stays
in `settings.screening`. Slice B's migration and this design's migrations
coordinate by number only (§7.1).

## 11. Amendments to v1

| v1 | Now |
| --- | --- |
| §2 "Not in v1: full-text phase" | Full text is S3. Unpaywall stays out. |
| §2 "Not in v1: fuzzy dedup" / §3 dedup row | Exact + title/year dedup with a review step is S2; trigram tiers stay out. |
| §3 settings `{reviewer_count, ai_visible}` | adds `full_text_reviewer_count` (§6.1). |
| §7 / §13.5 "a decision is final" | final in dual review; solo phases may re-decide (§6.3). |
| §5 data model, `screening_decisions` "one row per reviewer (final, §7)" | INSERT-only, append per re-decide: the latest row per (assignment, reviewer) is the current one (§6.3). |
| §5 "`0095_screening_ai` (slice B)" | no number is reserved; slice B takes the next free number when it merges (§7.1). |
| Queue-driven screen, `/queue`, `/conflicts` | list + panel, one `records` read (§5). |

## 12. Calls the designer made (not owner rulings)

- Duplicates listed first in the switcher, Title/abstract the default (§4).
- Removed duplicates are not rows in the screening lists (§4.3).
- Size target 5,000 articles, windowing only if the measured check fails (§4.6).
- Full text off → FT PRISMA fields `null`, "Records included at title/abstract" (§7.4).
- Keeping the record with less screening is allowed, with a warning and an
  auto-enroll of the kept record (§8.3).
- All new error codes are 409 (§6.5); `article_ids` with `phase=full_text` is 422.
- Articles opts out of maximize and the Esc chain (§4.1).
- One protocol exclusion-reason list for both phases; `maybe` not offered at FT.
- No bulk decisions; dedup is pairwise and manager-only; no metadata merge.
- Re-ruling stays API-only (§4.4); "Export selected" carries no abstract (§4.2).
- The records read is 409 when unconfigured and limited to 120/min (§5).
- `kept_article_id` cascade revival is intended (§8.1); the Zotero
  conference veto reads `source_payload` (§8.2).
- Slice B suggests at title/abstract only (§10).
- The screening seed is local-only, never on the prod boot path (§9).

## 13. Calls left to the builder

- Exact component split inside `frontend/components/screening/` and the
  shell's prop names.
- Skeleton row count, toast wording within the §4.3 vocabulary.
- Index choices for the dedup candidate query, guided by the 10k test.
