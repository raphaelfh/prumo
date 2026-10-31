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
- The sub-views are static: no counts, never hidden. A sub-view that does not
  apply explains itself in its empty state (for example "Full-text screening
  is off" + a Settings link for managers).
- The PRISMA tab is unchanged except for §7.4 and §8.4.
- `?assignment=<id>` (`ScreeningTab.tsx:72-77`) is dropped in favor of
  `?article=<id>`; its test (`ScreeningTab.test.tsx:395`) migrates.
- **"Import from PubMed"** (today in `ScreeningHeader.tsx:95-99`, every member)
  moves to the Title/abstract toolbar, every member. "Enroll all"
  (`EnrollAllButton`) moves to the same toolbar (manager) and to the "nothing
  enrolled" empty state.
- **First run**: a manager whose screening is not set up lands on Settings; a
  member sees the "not set up" empty state.

### 4.1 Shared shell

Extract `ListDetailSplitShell` from `frontend/components/articles/ArticlesSplitShell.tsx`.
It keeps the resizable list/panel split (55/45, the same mins and max), `⌘⇧B`
panel toggle, vertical orientation below `lg`, and the Topbar
`PanelToggleButton`. It adds **maximize** (`⇧⌘\`, the
`frontend/components/runs/RunSplitShell.tsx` pattern): the list hides and the
panel takes the full width. `Esc` leaves maximize, then closes the panel, then
clears the selection. Articles moves onto the shell with no visible change.
The article-specific pieces (dirty-discard dialog, `ArticleSidePanel`, copy
keys, ids) stay in `ArticlesSplitShell` as the caller. Maximize and the Esc
chain are opt-in props (`maximizable`, `escapeCloses`); **Articles opts out of
both in S0**, so it really has no visible change (`ArticleFieldRow.tsx:241`
keeps Escape for reverting an edit, and closing still goes through the dirty
guard `requestCollapse`). Screening opts in. Esc never fires while focus is
in a text field. When the maximized screening panel renders `RunSplitShell`
(§7.3), the outer shell owns `⇧⌘\` and Esc: `RunSplitShell` gets a prop that
disables its own chord and capture-phase Escape (`RunSplitShell.tsx:62`,
`:78-88`) while nested. The panel's open
state stays local and the URL owns selection, as in Articles (side-panel spec
§7): `?article=<id>` selects a row in any screening sub-view.

### 4.2 List (title/abstract and full text)

Built from `frontend/components/shared/list/*`, not from `ArticlesList.tsx`.

- **Status views**: a segmented control with counts (same visual as
  `SectionViewSwitcher`), URL `?status=`. A view with 0 stays visible but
  muted, except Conflict and Not enrolled, which hide at 0.
- **Default view by role**: reviewer → To screen; arbitrator who is not a
  reviewer → Conflict when > 0, else All; manager or viewer → All.
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
  switches to the Full text sub-view.
- **Toolbar actions**: "Enroll N new" (manager, TA); "Send N to full text"
  (manager, FT; §7.2); "▶ Start screening" (primary; only when "you: M left"
  > 0; selects the first To screen row in queue order and maximizes).
- **Bulk actions** (selection replaces `ListCount` as in Articles): Enroll
  selected (manager, TA) and Export selected (CSV, client-side). Nothing else.

### 4.3 Status vocabulary (one set of copy keys, all sub-views)

Verbs on buttons, participles on chips.

| Chip | Meaning (from `caller_status` / derived) |
| --- | --- |
| To screen | the caller holds or can take a seat and has not decided |
| Waiting for others | the caller decided; no outcome yet |
| In review | caller is not seated and not an unseated arbitrator; no outcome yet |
| Conflict | unseated arbitrator only (`screening_outcome.py:107-111`) |
| Included · Excluded · Maybe | outcome (small icon when arbitrated) |
| Not retrieved | FT outcome `not_retrieved` |
| Not enrolled | TA, article has no TA assignment and is not a removed duplicate |

A removed duplicate (S2) is **not** a row in the Title/abstract or Full text
lists and counts in none of their views, the progress strip, or "Enroll N
new". It appears only in the Duplicates sub-view (Resolved) and, in S5, on the
Articles list as "Duplicate".

"In review" for an unseated non-arbitrator implies all seats are filled
without an outcome, i.e. a conflict. This is accepted: that person holds no
seat, so it leaks no peer decision to anyone who must still decide.

### 4.4 Side panel content

- **To screen**: `RecordBody` + `DecisionButtons` pinned at the bottom (reused).
  After a decision the row stays with its new chip, the cursor moves to the
  next To screen row **in queue order**, the live-region announcement is kept,
  and the next two `GET /screening/assignments/{id}` are prefetched.
- **Waiting / In review / decided**: the `AssignmentView` body, read-only,
  showing exactly what the server returns. Its back button is removed.
- **Solo phase, decided by the caller**: the decision buttons stay active with
  the recorded-choice ring on the current decision; pressing another value
  re-decides (§6.3). A toast confirms "Changed to Exclude".
- **Conflict** (arbitrator): the ruling form extracted from `ConflictsPanel`'s
  `ConflictCard` (adopt a reviewer's decision or override, with a note).
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
has no dialog guard.

| Key | Action |
| --- | --- |
| j / k, ↓ / ↑ | move the row cursor; the panel follows when open |
| Enter | open the panel |
| Esc | leave maximize → close panel → clear selection |
| x · ⇧-click · ⌘A | toggle row · range · select visible (existing) |
| `⇧⌘\` | maximize / restore the panel |
| 1 / 2 / 3, E, 1–9 | decide (only while the panel shows a decidable record); `screeningKeyAction(event, armed, phase)` in `frontend/lib/screening/keymap.ts` |
| ? | popover listing every key (S4) |

TA: `1` include, `2` exclude now, `3` maybe, `E` arms the reason list, then
`1–9` picks a reason. FT: `1` include, `2` or `E` arm the reason list (a reason
is required), `3` does nothing. Moving the cursor writes nothing.

**Signature change**: `screeningKeyAction(event, reasonsOpen)` becomes
`screeningKeyAction(event, armed, phase)`; the `ScreeningKeyAction` type gains
no `not_retrieved` case ("Report not retrieved" has no key).

### 4.6 States every sub-view handles

Loading (skeleton rows, the `HITLArticleTable` pattern, not a spinner) · error
(`ErrorState` with retry) · not set up (manager: link to Settings; member: who
sets it up) · nothing enrolled · empty filter result · a status view with 0 ·
viewer (read-only: no decision buttons, no toolbar writes) · 403/404 on a
deep-linked `?article=` (clear the param and toast "This article is not in this
phase") · non-manager on a managerOnly sub-view (redirect, §4) · `GET
/duplicates` or Settings write refused 403 (`ErrorState` "Only project
managers can do this") · narrow width (`ListRowCard`, panel stacks
vertically).

**Size target** (my call): projects up to **5,000 articles** in one phase with
client-side filter/sort and no virtualization. S1's plan includes a measured
render check at 5,000 rows (mount + one status-view switch + one decision
refetch); if it exceeds 200 ms on the CI runner, S1 adds row windowing to
the list before shipping. Above 5,000 is a known limit, recorded in the PR.

## 5. One read model

`GET /api/v1/projects/{project_id}/screening/records?phase=title_abstract|full_text`
(S1 ships `title_abstract`; S3 adds `full_text`; S5 makes `phase` optional).

- Guard `require_project_scope`; ownership predicate in the WHERE clause
  (`.claude/rules/backend.md` § Ownership guards); rate limit 60/min.
- No abstracts in the payload (the panel reads `GET /screening/assignments/{id}`).
- Row: `article_id, assignment_id (nullable), queue_rank, title, first_author,
  publication_year, journal_title, pmid, doi, ingestion_source, has_pdf, status,
  my_decision, my_exclusion_reason, outcome, outcome_exclusion_reason,
  outcome_kind`. `status` uses the §4.3 vocabulary, derived through
  `assignment_states` + `caller_status` (`backend/app/services/screening_outcome.py`).
  `outcome*` fields are present only when the record has an outcome.
- Top level: `reviewer_count` (for the phase), `inclusion_criteria`,
  `exclusion_reasons`. Add `protocol_inclusion_criteria` next to
  `protocol_exclusion_reasons` in `backend/app/services/project_ai_context.py`.
- TA rows include not-enrolled articles (anti-join). `has_pdf` = `EXISTS
  article_files WHERE file_role = 'MAIN'`.
- It replaces `GET /screening/queue` and `GET /screening/conflicts`. Both are
  deleted with their schemas, `_awaiting` and `count_awaiting_me`; tighten the
  vulture baseline; regenerate `frontend/types/api/schema.d.ts`.
- Fix the stale md5 comment in `backend/app/repositories/screening_repository.py`
  (≈`:52-54`): `md5(assignment.id)` gives every reviewer the same order. Sibling
  `refactor(screening)` commit.

**Query keys** (`frontend/lib/query-keys/screening.ts`): remove `queue` and
`conflicts`; add `records(projectId, phase)` and `duplicates(projectId)`.
Must pass `check_react_query_keys`.

**Query invalidation**:

| Mutation | Invalidates |
| --- | --- |
| decide · arbitrate · enroll (either phase) | `records(phase)`, `assignment(id)`, `config`, `prisma` |
| duplicate verdicts | `duplicates`, `records(title_abstract)`, `config`, `prisma` |
| import (PubMed, RIS, Zotero) · article delete | `records` (all phases), `duplicates`, `config`, `prisma` |
| article metadata edit (`ArticleForm`) | `records` (all phases), `duplicates` |
| PDF attach (`uploadArticleFile`, `articlesService.ts:270`) | `records(full_text)` |

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
  One list serves both phases.

The `ScreeningHeader` chips are deleted.

### 6.3 Solo re-decide (R3)

`decide` accepts a new decision from a reviewer who already decided **only
when** the phase's reviewer count is 1, the assignment has no arbitration row,
and (TA only) the article has no FT assignment. It appends a new
`screening_decisions` row; the latest row per (assignment, reviewer) is
already the current one. Otherwise the existing `SCREENING_DECISION_FINAL`
409 stands. In dual review the refusal does not depend on peers, so it leaks
nothing. A TA re-decide refused because an FT row exists returns
`SCREENING_PHASE_ADVANCED`.

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

| Code | When | Copy (en) |
| --- | --- | --- |
| `SCREENING_PHASE_ADVANCED` | TA re-decide or re-ruling once an FT assignment exists | "This article is already in full-text screening." |
| `SCREENING_DECISION_NOT_IN_PHASE` | `maybe` at FT, `not_retrieved` at TA | "That decision is not available in this phase." |
| `SCREENING_REASON_REQUIRED` | FT exclude without a reason | "Pick an exclusion reason." |
| `DUPLICATE_HAS_REVIEW_WORK` | §8.3 | "This record already has full-text or extraction work, so keep it instead." |
| `DUPLICATE_KEPT_IS_REMOVED` | §8.3 | "The record you chose to keep was already removed as a duplicate." |

The two `DUPLICATE_*` codes map in a new `frontend/lib/duplicates/errors.ts`.

## 7. Full text (S3)

### 7.1 Schema

Migration `00xx_screening_full_text` (next free number after 0094; whichever
of this and slice B's `0095_screening_ai` lands second rebases and recreates
the CHECKs from the then-current definition):

- `screening_assignments` phase CHECK → `('title_abstract','full_text')`.
- `_DECISION_CHECK` on `screening_decisions` and `screening_arbitrations` →
  adds `'not_retrieved'`.
- Downgrade deletes `full_text` rows and `not_retrieved` rows; the roundtrip
  test asserts it.

No new table, no new column. Replace the `SCREENING_PHASE` constant with
`TITLE_ABSTRACT` / `FULL_TEXT` and thread `phase` through `live_assignments`,
`enroll`, `count_enrolled`, `current_decisions` / `latest_rulings`,
`assignment_states` and the PRISMA joins. `count_enrolled` used for
`duplicates_removed` is TA-only.

**Per-phase reviewer count in the services**: `ScreeningAssignmentRef`
(`schemas/screening.py` ≈`:180-193`) gains `phase`. `reviewer_count_of(settings)`
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
`enrolled: 0`.

### 7.3 Deciding

- Decision values at FT: `include`, `exclude` (exactly one reason, required),
  `not_retrieved` (no reason). `maybe` is refused at FT
  (`SCREENING_DECISION_NOT_IN_PHASE`); an FT exclude without a reason is
  refused (`SCREENING_REASON_REQUIRED`). Same validation in `arbitrate`.
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
`schemas/prisma.py:36`); no second field. New fields: `reports_not_retrieved`,
`reports_assessed` (FT include + exclude outcomes), `reports_excluded_by_reason`,
`reports_included`, and one boolean `full_text_in_progress` (true while any
FT record has no outcome — pending and conflict together, never told apart).
Update the `backend/app/schemas/prisma.py:3` docstring ("Deliberately no
pending or in-conflict count") to say this one flag is the exception.

`PrismaCountsPanel` shows "In progress" for the FT box while
`full_text_in_progress`, labels the last box "Reports included", and adds a
method line derived from config ("2 independent reviewers at title/abstract,
2 at full text; conflicts resolved by an arbitrator").

**Full text off** (my call): every FT field is `null`, the panel hides the
reports box, and the last box reads "Records included at title/abstract"
(= TA include outcomes). Maybe outcomes are shown as "Maybe (not assessed)"
in that case so nothing is silently dropped.

Sibling `refactor(prisma)`: rename the wire field `not_retrieved` →
`records_not_found` so it cannot be confused with the FT box. Consumers:
`prisma_service.py`, `schemas/prisma.py`, `PrismaCountsPanel.tsx` and its
test, the copy key `prismaNotRetrieved` (`frontend/lib/copy/screening.ts:128`,
renamed `prismaRecordsNotFound`), `backend/tests/unit/test_prisma_endpoint_unit.py:27`,
`backend/tests/unit/test_prisma_screening_box.py:59`,
`backend/tests/integration/test_prisma_counts.py` (`:78,135,157,179,192`),
`openapi.json`, `schema.d.ts`.

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
extend that test to cover this table). Same append-only trigger, `deny_all` policy and REVOKE as
`0094_screening_v1.py`. The current state of an unordered pair is its latest
row. `cleared` returns the pair to open; it is what Undo writes.

### 8.2 Candidates (derived per request, `duplicate_repository.py`)

- **Exact**: PMID equal; or DOI equal (`doi_match_key`) **and** normalized
  titles equal.
- **Likely**: normalized title (≥ 20 characters) and year equal.
- **Possible**: DOI equal, titles differ (chip "Same DOI, different title").
- **Vetoes**: differing non-null DOIs never pair; differing non-null journals
  demote to Possible; a record whose `article_type` (free text,
  `article_source_normalization.py:182-185`) contains, case-insensitively,
  `congress`, `conference`, `meeting` or `protocol` (covers PubMed `Congress`,
  `Clinical Trial Protocol`, Zotero `conferencePaper`), or equals a RIS `TY`
  tag `CONF`, `CPAPER` or `ABST` (stored raw, `frontend/lib/risParser.ts:204`),
  is never Likely or
  Exact by title — only by PMID.
- Pairs whose latest verdict is `duplicate` or `distinct` are dropped. A record
  already removed never pairs again.

### 8.3 Endpoints and rules

- Module names: endpoints `backend/app/api/v1/endpoints/duplicates.py`
  (registered in `api/v1/router.py`), service `services/duplicate_service.py`,
  repository `repositories/duplicate_repository.py`, schemas
  `schemas/duplicates.py`, model `models/article_duplicate.py`. Guard
  `Depends(require_project_manager)` on both routes, as
  `endpoints/screening.py:63`/`:87`; rate limits `60/minute` (GET) and
  `10/minute` (POST).
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
- `POST /projects/{id}/duplicates/verdicts` (manager), batch ≤ 500, one
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
- Removal is derived, never a delete: `live_assignments` and the enroll source
  add `NOT EXISTS removed_duplicate(article)`, including when `article_ids` are
  passed explicitly. Removed records leave every screening list and every
  PRISMA box except "duplicates removed"; their TA decision rows stay as audit. Undo/restore brings them back with no
  re-enroll.

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
map to "Records removed for other reasons". So identified =
duplicates_removed + other_removed + screened, and the existing no-clamp
invariant holds.

Formulas (let `total` = project articles, `removed` = articles whose latest
verdict as `article_id` is `duplicate`, `enrolled` = TA live assignments,
which already exclude removed):

| Field | Today | Now |
| --- | --- | --- |
| `identified` / `identified_total` | PubMed PMIDs and other sources, **enrolled articles only** (`_pubmed_identified`, `_other_sources`) | the same two functions over **all project articles**: `_pubmed_identified` = distinct PMIDs found by PubMed imports whose article is in the project; `_other_sources` = every project article not matched by a PubMed sync event, grouped by `ingestion_source` (so a PubMed-sourced article with no sync event is still counted once) |
| `duplicates_removed` (`prisma_service.py:161`) | `identified_total - enrolled` | `identified_total - total + removed` (import-time merges + reviewed duplicates; ≥ 0 because every article is counted at least once) |
| new `other_removed` | — | `total - enrolled - removed` |
| `imported_not_enrolled` (`prisma_service.py:163`) | `total_articles - enrolled` | replaced by `other_removed` (deleted). Consumers: `PrismaCountsPanel.tsx:76`, `:113-116`; `PrismaCountsPanel.test.tsx:34,48`; `frontend/e2e/flows/screening.ui.e2e.ts:45,158`; `test_prisma_counts.py:79,176,207-208,282`; `test_prisma_endpoint_unit.py:28`; `test_prisma_screening_box.py:60` |
| `not_enrolled` (`screening_config_service.py:82`) and the enroll candidate count `count_project_articles` (`:126`) | `total - enrolled` | `total - enrolled - removed` |

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
`phase`; minimal edit to `ArticlesList.tsx`.

**Task split** (for the plan; each brief ≤ ~300 lines): S1 = S1a backend
(records read, solo re-decide, endpoint/schema deletions, test migration) +
S1b frontend (list, panel states, conflict form, Settings, keyboard, E2E);
S2 = S2a backend (migration, model, candidates repository, verdicts service
and endpoints, PRISMA formulas, records/enroll exclusion) + S2b frontend
(Duplicates sub-view, compare panel, dialogs, Undo, errors map, copy, E2E
step); S3 = S3a backend (migration, phase threading, error codes, PRISMA box) + S3b
frontend (FT list, panel with PDF, Settings radio, PRISMA panel). A slice
still ships as one PR.

**Deleted or moved code** (S1):

- Files: `ScreeningQueue.tsx`, `ScreeningHeader.tsx` (whole file; its
  PubMed button and `EnrollAllButton` move per §4), `ArbitratorWorkspace`,
  the `ConflictsPanel` list wrapper (its `ConflictCard` ruling form is
  extracted and kept), `useScreeningQueue` (keep `useDecide`),
  `useScreeningConflicts` (keep `useArbitrate`). `ScreeningConfigForm` moves
  into the Settings sub-view.
- Tests: `ScreeningQueue.test.tsx`, `ConflictsPanel.test.tsx`,
  `useScreeningQueue.test.tsx` are rewritten against the new components, not
  just deleted.
- Also `frontend/hooks/screening/__tests__/screeningQueries.remount.test.tsx`
  (mocks both fetches `:15-24`, imports `useScreeningConflicts` `:31`;
  rewritten) and the "Back to screening" assertion in `ScreeningTab.test.tsx`
  (≈`:400`).
- `frontend/services/screeningService.ts`: `fetchScreeningQueue` (`:102`),
  `fetchConflicts` (`:133`), the `ScreeningQueueRead` / `ScreeningConflictsRead`
  aliases (`:19`, `:22`); add `fetchScreeningRecords`.
- `scripts/fitness/check_retired_symbols.py` `RETIRED` gains
  `/screening/queue`, `/screening/conflicts`, `ScreeningQueueRead`,
  `ScreeningConflictsRead`.
- Backend: `GET /screening/queue`, `GET /screening/conflicts`,
  `ScreeningQueueItem/Read`, `ScreeningConflictItem/Read`, `_awaiting`,
  `count_awaiting_me`.
- Query keys `screeningKeys.queue/conflicts`; stale copy keys (`tabQueue`,
  `tabConflictsCount`, `summaryEnrolled`, `summaryReviewers`, …).
- Gates the PR passes: knip (both modes), vulture (tightened),
  `check_copy_keys.py`, `check_react_query_keys`, `check_file_size`,
  `check_retired_symbols`, `check_scope_guards.py`, `check_button_scale.py`.

**E2E and seed data** (never in migrations):

- `frontend/e2e/flows/screening.ui.e2e.ts` is rewritten in S1. Today it calls
  `/screening/queue` (`:114`), clicks the "Conflicts (1)" tab (`:126`) and
  "Use {name}'s decision" (`:128`); the new flow triages from the list and
  rules with "Reviewer A/B" labels.
- `frontend/e2e/_fixtures/screening.ts` gains a duplicate pair (S2) and
  full-text records with and without a PDF (S3). The E2E gains a dedup step
  (S2) and a full-text step (S3).
- A new `backend/app/seed_screening.py` (following `seed_probast_ai.py`;
  `seed.py` is at its `check_file_size` baseline, 3,249/3,250) holds a small
  screening fixture (one enrolled project with a conflict, a duplicate pair,
  and a full-text record with a PDF), called from `seed.py` with a one-line
  import, so `design-review` can render every sub-view locally.

### Acceptance tests (each requirement → its test)

| Requirement | Test |
| --- | --- |
| Shell extraction is invisible | existing `ArticlesSplitShell*.test.tsx` green; new unit tests for maximize, Esc chain, below-`lg` orientation |
| Records read is blind-safe | integration per role (seated reviewer, unseated reviewer, seated/unseated arbitrator, viewer, manager): `conflict` only for an unseated arbitrator; no peer values in the payload; an article moved to another project drops out |
| Not-enrolled rows and counts | integration: anti-join rows; status-view counts match Vitest fixture |
| Keyboard guards | Vitest: keys inert in a text field and under a dialog; auto-advance picks the next To screen in queue order |
| Solo re-decide | integration: solo re-decide appends and changes the outcome; refused after arbitration; refused (`SCREENING_PHASE_ADVANCED`) once FT exists; dual review still `SCREENING_DECISION_FINAL` |
| Per-phase reviewer counts | integration: TA lock ignores FT decisions; FT count locks once an FT assignment exists; removing it refused then |
| Old endpoints gone | shipped `test_screening_review.py`, `test_screening_arbitration.py`, hook/component tests and `frontend/e2e/flows/screening.ui.e2e.ts` migrated to the new read, not deleted |
| §4.6 states | Vitest per sub-view: loading skeleton, error + retry, not set up (manager → Settings, member copy), nothing enrolled, empty filter, viewer read-only, deep-link 403/404 toast, non-manager redirect from `duplicates`/`settings`, narrow width renders `ListRowCard` |
| Settings sub-view | Vitest: phase radio, both counts, lock hints; integration: PUT with key absent / `null` / value |
| Query invalidation | Vitest: each §5 mutation invalidates its listed keys |
| Size target | Vitest/bench: 5,000-row render check (§4.6), number recorded in the PR |
| "Enroll anyway?" | Vitest: dialog shows while open pairs exist, not otherwise |
| FT panel | Vitest: PDF default when a file exists; missing-PDF state with attach; below-`lg` reader opens; nested shortcuts — outer `⇧⌘\`/Esc win |
| CSV export | Vitest: FT-excluded export has one row per report with its reason |
| PRISMA rename and FT off | unit: `records_not_found` on the wire; FT-off payload has `null` FT fields and the "Records included at title/abstract" label |
| Keep-the-other merge | integration: warning data present; kept record auto-enrolled at TA when the removed one was |
| S5 column | Vitest: each stage chip; integration: no-phase records read stays blind-safe (role matrix reused) |
| FT enroll | integration: derives include+maybe only; idempotent; TA PRISMA box unchanged after FT enroll |
| FT decision rules | integration: maybe refused; exclude without reason refused; differing reasons → conflict; `not_retrieved` vs include → conflict; `not_retrieved` reopen path |
| FT PRISMA | unit: arithmetic incl. the in-progress state |
| Migrations | roundtrip tests for both migrations; append-only trigger test for dedup |
| Dedup tiers | integration: each tier and each veto; `distinct` suppresses; `cleared` reopens; each 409; foreign article id refused; moved article ignored |
| Dedup removal derived | integration: enroll skips removed (explicit ids too); restore restores the assignment; PRISMA arithmetic before/after a merge |
| Dedup performance | integration at ~10k articles; threshold measured, recorded in the PR |
| Reading upgrades | unit: `parseStructuredAbstract` (prose such as "Note: …" must not match); schema contract test |
| Reviewer labels | Vitest: conflict ruling form shows "Reviewer A/B", no names; other states show names |
| Switcher default | `SectionViewSwitcher.test.tsx`: `defaultValue` highlights Title/abstract with Duplicates first; `viewsScreeningAria` label |
| Default status view by role | Vitest: reviewer → To screen; non-reviewing arbitrator → Conflict/All; manager/viewer → All |
| Removed duplicates hidden | integration: absent from records rows and the not-enrolled anti-join; config `not_enrolled = total - enrolled - removed` |
| TA re-ruling after FT | integration: `arbitrate` on TA refused with `SCREENING_PHASE_ADVANCED` once an FT assignment exists |
| FT enroll refusals | integration: full text off → `SCREENING_NOT_CONFIGURED`; no reasons → `SCREENING_REASON_REQUIRED`; `article_ids` with `phase=full_text` → 422 |
| Per-phase count resolution | integration: an FT assignment uses `full_text_reviewer_count` for cap, outcome and solo re-decide |
| Not retrieved panel | Vitest: unseated arbitrator gets the ruling form; others read-only |
| Error maps | `errors.test.ts`: new `CODE_TO_KEY` entries in `lib/screening/errors.ts` and `lib/duplicates/errors.ts` |
| Dedup dialogs | Vitest: "Accept N exact" `AlertDialog`; Undo posts `cleared` |
| Dedup basis | integration: client cannot set `basis`; server records the recomputed tier |
| Send to full text | Vitest: disabled for N = 0, FT off, no reasons, each with its tooltip |
| Design | `design-review` at desktop and narrow width for every new sub-view |

## 10. Slice B (AI pre-screen) compatibility

The AI column and rail section are reserved, not built. Suggestions key on
`assignment_id`, so they are phase-aware without change. `ai_visible` stays in
`settings.screening`. Slice B's migration and this design's full-text
migration coordinate by number only (§7.1).

## 11. Amendments to v1

| v1 | Now |
| --- | --- |
| §2 "Not in v1: full-text phase" | Full text is S3. Unpaywall stays out. |
| §2 "Not in v1: fuzzy dedup" / §3 dedup row | Exact + title/year dedup with a review step is S2; trigram tiers stay out. |
| §3 settings `{reviewer_count, ai_visible}` | adds `full_text_reviewer_count` (§6.1). |
| §7 / §13.5 "a decision is final" | final in dual review; solo phases may re-decide (§6.3). |
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

## 13. Calls left to the builder

- Exact component split inside `frontend/components/screening/` and the
  shell's prop names.
- Skeleton row count, toast wording within the §4.3 vocabulary.
- Index choices for the dedup candidate query, guided by the 10k test.
- Whether "Export selected" includes the abstract.
