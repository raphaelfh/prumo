---
status: approved
last_reviewed: 2026-09-15
owner: '@raphaelfh'
---

# AI Batch Runs for QA and Extraction Lists — Design Spec

**Date:** 2026-09-15
**Status:** Approved (design approved section by section in chat; written spec reviewed)

## 1. Decision summary

- Both article lists (Quality assessment and Data extraction) let a reviewer
  select articles and run AI on them as one **AI batch**.
- A batch runs **fully server-side**: it keeps going with the browser closed,
  and its status is durable (reloads, other devices, job-result expiry).
- A batch is two backend-only tables (`extraction_batches`,
  `extraction_batch_items`) plus a dispatcher task that keeps at most **2
  articles in flight** and hands each article to the existing
  `run_section_extraction_task` through a durable extraction attempt.
- Every article runs on the **reviewer's own session run**
  (`HITLSessionService.open_or_resume`), never a forked run.
- Status appears in the **notification bell**, one item per batch, with a
  details sheet that says what failed and what to do. Only batches go to the
  bell; Run AI inside an article keeps its in-page status.
- The QA **Active tool** control moves from its own card row into the list
  toolbar, left of search.
- Extraction's in-browser batch loop (`useFullAIExtraction`) and the dead
  progress overlay it fed are removed.

## 2. Problem

- **QA has no selection.** `HITLArticleTable` has no checkbox column and no
  batch action; its keyboard-shortcut wiring passes no-ops.
- **Extraction's batch is fragile and unsafe.** `ArticleExtractionTable`
  loops over selected articles in the browser calling `extractFullAI` without
  a `runId`:
  - the backend creates a fresh run per article — the shadow-run hazard the
    article screen already removed (`ExtractionFullScreen`, comment above
    `useRunAIExtraction`);
  - each article fires one kickoff per section against a per-user limit of
    10 kickoffs/min and 30 status polls/min, so small batches hit 429;
  - it toasts once per article, aborts on the first failure, and dies when
    the page unmounts.
- **The bell cannot show AI work.** `useBackgroundJobs` knows only Zotero
  imports and exports.
- **The Active tool card costs a full row** of chrome above the list.

## 3. Goals and non-goals

### Goals

- Select articles and start AI in one action on both lists.
- Durable, server-side execution with per-article outcomes.
- Fair use of the worker: a batch never starves single Run AI requests.
- Every failure is shown with a reason and a recovery action.
- Active tool inline in the toolbar, clean at desktop, tablet and phone.

### Non-goals

- Managers seeing other reviewers' batches.
- Server push (the bell polls).
- Single-article Run AI in the bell.
- Changing what single-article Run AI extracts.
- An end-to-end test of real AI execution (needs a live LLM).

## 4. Existing foundations reused

| Piece | Where | Role here |
|---|---|---|
| Session open/resume | `HITLSessionService.open_or_resume` | Resolves the article's run and instances as the batch owner |
| Durable attempts | `ExtractionAttemptService.prepare_request`, `extraction_attempts` (0075) | One attempt per article; owner identity and per-call generation snapshots (constitution §IX) |
| AI execution | `run_section_extraction_task` | Unchanged execution, engine freeze, credentials, retries |
| Run-level dispatch | `SectionExtractionService.run_from_request` | Gains one full-pass branch (§7.3) |
| Guards | `ensure_project_reviewer`, `owned_template`, `owned_article` | Kickoff authorization |
| Error codes | `ExtractionErrorCode`, `classify_extraction_error` | Per-article failure reasons |
| Error copy | `frontend/lib/ai-extraction/extractionErrorToast.ts` | Per-code titles reused in the details sheet |
| Selection | `useArticleSelection`, extraction table checkboxes, `ListRowCard` | Shared by both tables |
| Bell | `NotificationCenter`, `useBackgroundJobs`, `useBackgroundJobPolling` | Batch items, unread badge, transition toasts |

## 5. Alternatives considered

| Option | Verdict |
|---|---|
| Browser-driven queue, no backend change | Rejected by the user: a batch must survive closing the browser |
| **A. Durable batch + items, dispatcher, per-article attempts** | **Chosen** |
| B. One orchestrator Celery task, progress in job state | Progress expires after 1h; a worker restart drops the rest; holds 1 of 4 worker slots for the whole batch |
| C. `batch_id` on attempts, sessions opened inline in the POST | Heavy request holding N advisory locks; no home for the extraction full pass |
| Bell also shows single Run AI | Deferred by the user (batches only) |

## 6. Data model — migration `0076_extraction_batches`

Down revision `0075_extraction_attempts`. Both tables follow the attempts
access pattern: `ENABLE ROW LEVEL SECURITY` and
`REVOKE ALL ... FROM anon, authenticated`; only the backend reads or writes.

### 6.1 `extraction_batches`

| Column | Nullable | Notes |
|---|---|---|
| `id` | No | uuid PK |
| `owner_id` | No | FK `profiles` `ON DELETE CASCADE` |
| `project_id` | No | FK `projects` `ON DELETE CASCADE` |
| `template_id` | No | FK `project_extraction_templates` `ON DELETE CASCADE`; the kind comes from the template |
| `skip_articles_with_ai_suggestions` | No | bool, default true |
| `cancelled_at` | Yes | set by cancel |
| `stop_code`, `stop_message` | Yes | set when an engine-class failure stops the batch (§8) |
| `created_at`, `updated_at` | No | `now()` |

No status column: batch state is derived from these fields and its items
(§7.2), so it cannot drift.

Index: `(owner_id, created_at DESC)`.

### 6.2 `extraction_batch_items`

| Column | Nullable | Notes |
|---|---|---|
| `id` | No | uuid PK |
| `batch_id` | No | FK `extraction_batches` `ON DELETE CASCADE` |
| `article_id` | No | FK `articles` `ON DELETE CASCADE` |
| `attempt_id` | Yes | FK `extraction_attempts` `ON DELETE SET NULL` |
| `status` | No | CHECK `queued` / `dispatched` / `skipped` / `failed` / `cancelled` |
| `reason_code` | Yes | skip/cancel reason (§9) |
| `created_at`, `updated_at` | No | `now()` |

`UNIQUE (batch_id, article_id)`; index `(batch_id, status)`.

Once an item is `dispatched`, its reported outcome is its attempt's
(`pending` / `running` / `completed` / `failed` / `cancelled`, plus
`result` and `error_code`). Nothing is written twice.

Cascades are deliberate: a batch must never block deleting a project,
article, tool or user. A dispatched item whose run was deleted (attempt
`SET NULL`) reports `NO_LONGER_AVAILABLE`.

## 7. API — `/api/v1/extraction/batches`

All responses use the `ApiResponse` envelope with typed Pydantic models,
camelCase on the wire. Router mounted beside `/extraction/sections`.

### 7.1 Endpoints

| Method and path | Limit | Behaviour |
|---|---|---|
| `POST /` | 5/min | Start a batch; 202 with `BatchDetail` |
| `GET /?projectId=&active=` | 60/min | Caller's batches of the last 7 days (`projectId` optional, `active=true` = only active); `BatchSummary[]` |
| `GET /{batchId}` | 60/min | `BatchDetail` |
| `POST /{batchId}/cancel` | 20/min | Queued items become `cancelled` (`reason_code=CANCELLED`); in-flight articles finish |
| `POST /{batchId}/resume` | 20/min | Re-kicks the dispatcher; idempotent |

`POST` body: `{ projectId, templateId, articleIds: uuid[], skipArticlesWithAiSuggestions?: boolean = true }`.

Read scope: `owner_id = caller` **in the WHERE clause** and
`public.is_project_member(project_id, caller)`. A foreign or missing batch
answers 404 identically.

### 7.2 Response shapes

`BatchSummary`: `id`, `projectId`, `projectName`, `templateId`,
`templateName`, `kind`, `createdAt`, `finishedAt | null`,
`state` (`active` / `finished` / `stopped` / `cancelled`), `stalled`
(bool), `stopCode | null`, `stopMessage | null`, and `counts`:
`total`, `queued`, `running`, `done`, `doneWithIssues`, `needsAttention`,
`skipped`, `notRun`.

`BatchDetail` adds `items[]`: `articleId`, `title`, `outcome`
(`queued` / `running` / `done` / `done_with_issues` / `needs_attention` /
`skipped` / `not_run`), `reasonCode | null`, `message | null`,
`failedSections | null`, `totalSections | null`.

Derivation:

- `state = active` while any item is `queued` or dispatched with a
  non-terminal attempt, and the batch is neither cancelled nor stopped with
  nothing in flight.
- `finishedAt` = latest item/attempt `updated_at` once not active.
- `stalled` = active and no item or in-flight attempt updated for 15 min.
- `done_with_issues` = attempt completed with `failed_sections > 0`.
- `needs_attention` = item `failed`, or attempt `failed`.
- `not_run` = item `cancelled` (by cancel or engine stop).

### 7.3 Full-pass dispatch branch

`SectionExtractionRequest` with `runId` **and** `extractAllSections=true`
(no `parentInstanceId`, no `entityTypeId`) becomes a new branch in
`run_from_request`: `extract_for_run`, then
`extract_all_sections(parent_instance_id=entry, run_id=run)` for every entry
instance of the run's root repeating groups. The validator already returns
early for `runId`, and no current caller sends that combination (the
per-entry sweep sends `parentInstanceId`, which matches the earlier
branch). Extraction batches use it; QA batches send plain `runId`
(top-level domains), matching QA's Run AI today.

## 8. Worker — dispatcher

`advance_extraction_batch(batch_id)` on the `extractions` queue, no rate
limit (it does no LLM work).

1. Lock the batch row. If `cancelled_at` or `stop_code` is set, mark
   remaining `queued` items `cancelled` and exit.
2. If the last terminal attempt of this batch failed with an engine-class
   code (`MISSING_API_KEY`, `ENGINE_RETIRED`, `LLM_ENDPOINT_UNAVAILABLE`),
   set `stop_code`/`stop_message`, cancel queued items
   (`reason_code=STOPPED_ENGINE_ERROR`), exit.
3. Count in-flight items (dispatched, attempt `pending`/`running`). Claim
   up to `2 − in_flight` queued items (`FOR UPDATE SKIP LOCKED`, oldest
   first).
4. For each claimed item, in its own transaction, run the checks of §9
   (G6–G10). A failing check marks the item `skipped` with its reason.
5. Otherwise: `open_or_resume` as the owner; `prepare_request` with
   `requestId = uuid5(item.id)`, `runId`, `skipFieldsWithHumanProposals=true`,
   and `extractAllSections=true` for extraction templates; set
   `attempt_id`, `status=dispatched`; commit.
6. After commit, enqueue `run_section_extraction_task` with the attempt id,
   `link` and `link_error` both → `advance_extraction_batch(batch_id)`.
7. If step 4 skipped items and capacity remains, loop back to step 3.

Triggers: `POST` (after commit), each attempt's completion or final failure
(link callbacks), and `resume`. A lost callback is caught by `stalled` and
fixed with Resume.

Plan must verify: `link_error` fires once after retries are exhausted (not
per retry) with the task's `max_retries=3`.

## 9. Guardrails

### Before anything is queued (`POST`)

- **G1** Reviewer role (`ensure_project_reviewer`): viewers 403.
- **G2** `owned_template(project_id, template_id)`; foreign or missing →
  the same 400 as a foreign article.
- **G3** Articles via a new plural `owned_articles` in
  `article_read_service`; `owned_article` delegates to it (one predicate,
  `check_scope_guards.py`). Any foreign or missing id → one uniform 400.
- **G4** `articleIds` deduplicated; 1–100 after dedupe, else 422.
- **G5** Engine resolved once (`resolve_engine`, same as single kickoff):
  retired / needs key / endpoint unavailable → 409 with the typed code.
  Queue unavailable → 503. Both before any row is written.
- **G5b** `pg_advisory_xact_lock` on (owner, template), then refuse with 409
  (`AI_BATCH_ALREADY_ACTIVE`, carrying the active batch id) when the caller
  has an active batch for that template.

### Per article, just before it starts (dispatcher step 4)

- **G6** Caller still a reviewer (`SELECT public.is_project_reviewer(...)`,
  the DB function, per backend rules) → else `NO_LONGER_AVAILABLE`.
- **G7** Article and template still exist in the project → else
  `NO_LONGER_AVAILABLE`.
- **G8** Run in `extract` stage → else `RUN_FINALIZED` or `RUN_NOT_EDITABLE`.
- **G9** No `pending`/`running` attempt by the owner on that run updated in
  the last hour (excluding this item's own) → else `AI_ALREADY_RUNNING`.
  The hour bound keeps an attempt orphaned by a lost job from blocking
  forever.
- **G10** When `skip_articles_with_ai_suggestions`: no `source='ai'` proposal
  on the run → else `ALREADY_HAS_AI_SUGGESTIONS`.

### While running

- **G11** At most 2 articles in flight per batch: leaves 2 of 4 worker slots
  for single Run AI and keeps rate-limited jobs from outliving the 1h Redis
  visibility timeout (which would redeliver them).
- **G12** The first engine-class failure stops the batch (§8 step 2).
- **G13** Transient provider errors use the existing 3 retries with backoff;
  the article reads `running` meanwhile.
- **G14** Engine changes mid-batch apply to articles not yet started; each
  proposal records its engine in its generation snapshot.
- **G15** AI only adds proposals; values a person settled are skipped at call
  time and never overwritten.

### Recovery

- **G16** `stalled` after 15 min without progress; Resume re-kicks the
  dispatcher. Idempotent: item row lock, `uuid5` request id, attempt lock.
- **G17** Cascading FKs (§6) so a batch never blocks a delete.
- **G18** Unparsed PDFs parse on demand (`extraction_prompt_input`); only a
  missing PDF fails (`PDF_NOT_FOUND`).

## 10. Failures — what the person sees and does

| # | Situation | Code | Shown as | Action |
|---|---|---|---|---|
| F1 | Missing key / retired model / endpoint down at start | 409 typed | Error toast; nothing queued | **Choose engine** (opens the engine picker) or **Integrations** |
| F2 | Same mid-batch | `STOPPED_ENGINE_ERROR` | Batch "Stopped: engine problem"; rest "Not run" | Fix engine → **Run remaining** |
| F3 | Queue down at start | 503 | Error toast; nothing created | **Try again** |
| F4 | Batch already active for this tool | `AI_BATCH_ALREADY_ACTIVE` | Run AI replaced by "AI running · 7/11 · View" | **View** / **Cancel** |
| F5 | Run finalized | `RUN_FINALIZED` | Skipped: "Finalized, reopen to run AI" | **Open article** |
| F6 | Run in another non-extract stage | `RUN_NOT_EDITABLE` | Skipped: "Not editable right now" | **Open article** |
| F7 | Already has AI suggestions (skip on) | `ALREADY_HAS_AI_SUGGESTIONS` | Skipped | **Run again including these** |
| F8 | Owner already running AI on it | `AI_ALREADY_RUNNING` | Skipped | — |
| F9 | No PDF | `PDF_NOT_FOUND` | Needs attention: "No PDF" | **Open article** |
| F10 | Repeating section without key field | `MISSING_ENTITY_KEY` | Needs attention (existing copy) | Manager fixes template → **Retry failed** |
| F11 | Some sections failed | attempt result | Done with issues: "2 of 9 sections failed" | **Open article** |
| F12 | Other failure after retries | `EXTRACTION_FAILED` | Needs attention: the message | **Retry failed** |
| F13 | No progress for 15 min | `stalled` | Stalled | **Resume** |
| F14 | Cancelled | `CANCELLED` | "Cancelled: 4 done, 7 not run" | **Run remaining** |
| F15 | Role lost, article or tool removed, run deleted | `NO_LONGER_AVAILABLE` | Skipped | — |

**Retry failed** and **Run remaining** reopen the confirm dialog with those
articles and the skip option **off** (a failed article may already hold
partial AI suggestions).

## 11. Frontend

### 11.1 Data path

`component → hook (TanStack Query) → extractionBatchService → apiClient`.
Keys from a new `extractionBatchKeys` factory; the start, cancel and resume
mutations invalidate `extractionBatchKeys.all`. Copy lives in a new
`frontend/lib/copy/` namespace for batches.

### 11.2 Selection (both tables)

- QA gains extraction's checkbox column, header checkbox (visible rows) and
  real select-all / clear shortcuts in `useListKeyboardShortcuts`; below
  `sm` it renders the card list (`ResponsiveList` + `ListRowCard` with a
  leading checkbox), like extraction.
- One shared selection bar replaces the count when ≥ 1 is selected:
  `3 selected · ✨ Run AI · Clear`. It replaces extraction's single-item
  "Actions ▾" menu.
  - More than 100 selected: Run AI disabled, tooltip "Up to 100 articles per run".
  - Viewer: no Run AI.
  - Caller's batch for this tool active: `AI running · 7/11 · View`.

### 11.3 Confirm dialog

`AlertDialog` size `sm` (bottom sheet on phones): "Run AI on 3 articles?",
the engine line from the viewer's engine (model and key scope), "Answers a
person already gave are kept", checkbox "Skip articles that already have AI
suggestions" (on). Footer Cancel / Run AI. On success the selection clears
and a toast "AI started for 3 articles" offers **View**. Start errors map
per F1, F3, F4.

### 11.4 In-table state

The status cell shows a clock (queued) or spinner (running) beside the ring
with a tooltip, from the active batch's detail query (polled while active).
When the `done` or `doneWithIssues` count grows, invalidate
`articleExtractionValuesKeys.all` so rings refresh; the plan identifies the
suggestion query keys to invalidate for an open article screen.

### 11.5 Bell

- A sync hook in `NotificationCenter` loads `GET ?active=` batches on app
  load and upserts each as a `BackgroundJob` of new type `ai-batch`
  (`id = ai-batch-<batchId>`) in `useBackgroundJobs`, so the unread badge,
  dismissal and transition observer keep working. The server stays the
  source of truth.
- Polls one list request every 5 s while any batch is active and the tab is
  visible; otherwise refreshes on focus and after starting a batch.
- Item: "AI assessment · PROBAST+AI" or "AI extraction · CHARMS", project
  name, progress bar `7/11`, **Cancel** while active; when finished, the
  count summary with the icon of the worst outcome.
- Transition toasts (only when observed in-session): success; warning
  "2 need attention" with **Details**; error "Stopped: engine problem" with
  **Choose engine**.

### 11.6 Details sheet

`Sheet` (default width) opened from the bell item, a toast, or View.
Summary counts; articles grouped Needs attention → Skipped → Not run → Done,
each with its reason (per-code titles from `extractionErrorToast` where
mapped) and **Open article**. Footer shows only applicable actions: Cancel,
Resume, Retry failed, Run remaining.

## 12. QA toolbar — Active tool beside search

- The card row is removed; `HITLArticleTable` gains a leading toolbar slot
  and `QualityAssessmentInterface` passes the tool control into it:
  `[🛡 PROBAST+AI ▾] [Search] [Filter] [Display] [Export] [Engine] 11 of 11 articles`.
- Two or more tools: ghost `sm` button (icon, name, chevron) opening the
  existing menu with versions. One tool: same look, no chevron, not
  interactive.
- "Active tool:" label: `sr-only @[48rem]/listbar:not-sr-only`, with
  `@container/listbar` on the toolbar row.
- Name truncates with a tooltip carrying the full name.
- Below `md`: row 1 tool + search (search takes the remaining width), row 2
  the icon controls with count or selection bar right-aligned.
  `ListToolbarSearch` gains a `className` pass-through (it forces
  `w-full` below `md` today).
- The loading skeleton reserves the tool control.
- Unchanged: the dashed empty state when no tool is enabled, the
  `?template=` param, extraction's toolbar.

## 13. Removed

- `ArticleExtractionTable`'s `handleBatchAIExtraction` and its "Actions ▾"
  menu.
- `useFullAIExtraction`, `useTopLevelSectionsExtraction` and their tests.
- `FullAIExtractionProgress`, `BatchAllModelsSectionsProgress`,
  `BatchExtractionProgress`, and `ExtractionFullScreen`'s progress overlay
  (its state is only ever set to `null`, so it never renders).
- Their copy keys (`check_copy_keys.py` ratchet).
- Kept: `useBatchAllModelsSectionsExtraction`,
  `useBatchSectionExtractionChunked` (per-entry actions in the article).

## 14. Tests

### Backend (integration, real Postgres, stubbed LLM)

| Area | Covers |
|---|---|
| Kickoff | G1–G5b: viewer 403; foreign template/article uniform 400; 0 and 101 ids 422; dedupe; engine 409 and queue 503 write nothing; two concurrent POSTs → one 202, one 409 |
| Dispatcher | G6–G12: each skip reason; cap of 2 in flight; engine-class failure stops and cancels the rest; cancel leaves in-flight to finish |
| Recovery | G16: Resume twice → no duplicate attempt; stalled computed at 15 min |
| Reads | Owner-only and member-only list/detail; 7-day window; outcome and count derivation (§7.2) |
| Deletes | G17: deleting project, article, template, run with batch rows succeeds |
| Full pass | §7.3: extraction fills entry child sections; QA stays top-level |
| Access | anon/authenticated cannot select the new tables |

Gates: `alembic check`, `check_scope_guards.py`, `check_layered_arch.py`,
`check_api_response_envelope.py`, vulture, `npm run generate:api-types`.

### Frontend (vitest)

| Area | Covers |
|---|---|
| Selection bar | 0 / n / > 100 / active batch / viewer |
| Confirm dialog | Request payload incl. skip flag; F1, F3, F4 error handling |
| Bell sync | Upsert into the store; one toast per transition; unread; polls only while active and visible |
| Details sheet | Grouping; actions per state; retry builds ids with skip off |
| Table state | Row indicators; ring refresh on completion |
| QA table | Selection; narrow card list |
| Toolbar | Tool control placement; `sr-only` label; single vs switchable |

Visual: `design-review` on the QA list at 1440, 768 and 375 px, light and
dark, with one tool, two tools and a long name.

## 15. Delivery

Three PRs into `dev`, merge-train order:

1. **Toolbar**: Active tool beside search (frontend only).
2. **Backend**: migration 0076, endpoints, dispatcher, full-pass branch,
   tests, API types; `extraction-hitl-architecture.md` gains the tables and
   the migration-head line.
3. **Frontend**: selection, Run AI, confirm, bell, details sheet, table
   state, removal of the old path.

## 16. To verify during planning

- Celery `link` / `link_error` semantics with `self.retry` (§8).
- Which suggestion query keys an open article screen reads (§11.4).
- How `useProjectMemberRole` exposes the viewer role (§11.2).
- Whether disabling a QA tool in Configuration deletes the project template
  or flags it inactive; G7 must treat both as unavailable.
- Copy namespace registration in `frontend/lib/copy/`.
