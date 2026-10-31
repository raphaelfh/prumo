---
status: draft
last_reviewed: 2026-10-31
owner: '@raphaelfh'
---

# Screening workspace S3 — full text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional full-text phase to screening: a manager turns it on in Settings and sends title/abstract includes and maybes to it; reviewers screen each report beside its PDF (include, exclude with exactly one reason, or "report not retrieved"); PRISMA gains the reports box.

**Architecture:** No new table or column: one migration widens two CHECKs (`phase` gains `full_text`, `decision` gains `not_retrieved`). The `phase` already on `screening_assignments` is threaded through every read, and each phase reads its own reviewer count from `projects.settings.screening`. The S1 records read gains `phase=full_text`; the S1 workspace, list and panel are generalized by `phase`, and the full-text panel renders the PDF (docked strip, or `RunSplitShell` when maximized).

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + Pydantic v2, pytest on real Postgres; React 19 (React Compiler) + TanStack Query + react-router, Vitest + MSW + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-screening-workspace-design.md` — slice S3 only: §7, the S3 rows of §4.1 (nested `RunSplitShell`, its `⇧⌘\` fix), §4.2 ("K to full text", "Send N to full text", PDF column/filter), §4.3 "Not retrieved", §4.4 Not retrieved panel, §4.5 FT keymap, §4.6 S3 states, §5 PDF-attach invalidation, §6.1/§6.2/§6.4/§6.5 S3 rows, §9 S3a1/S3a2/S3b, S3 gates, S3 E2E + seed, S3 acceptance rows. **Base:** S1 (`docs/superpowers/plans/2026-10-30-screening-workspace-s1.md`) — this plan names S1's files, symbols and tests by that plan's Interfaces; S1 is being built in parallel, and Phase B re-checks this plan against S1's merged code before any task starts.

**Scope:** 12 tasks, one PR to `dev`, title `feat(screening): full-text phase — PDF screening, not retrieved, PRISMA reports`. One migration.

## Task graph

| Task | Spec row | Depends on | Runs in parallel with |
| --- | --- | --- | --- |
| 1 Migration + phase plumbing (backend) | S3a1 | S1 merged | 2 |
| 2 Shell + PDF primitives (frontend) | S3b | S1 merged | 1, 3–6 |
| 3 Config + full-text enroll (backend) | S3a1 | 1 | 2 |
| 4 Full-text decision rules (backend) | S3a2 | 3 | 2 |
| 5 Full-text records read + seed (backend) | S3a2 | 4 | 2 |
| 6 PRISMA reports box (backend + rename) | S3a2 | 5 | 2 |
| 7 Vocabulary, keymap, decision buttons, errors (frontend) | S3b | 2, 6 | — |
| 8 Full-text panel (frontend) | S3b | 7 | — |
| 9 Full-text workspace, switcher, Send to full text (frontend) | S3b | 8 | — |
| 10 Settings (FT) + PRISMA panel (frontend) | S3b | 9 | — |
| 11 E2E full-text step + fixtures | S3b | 10 | — |
| 12 Slice verification + design review | all | 1–11 | — |

Parallel groups: **G1** {1, 2} → **G2** {3} → **G3** {4} → **G4** {5} → **G5** {6} → **G6** {7} → **G7** {8} → **G8** {9} → **G9** {10} → **G10** {11} → **G11** {12}. Task 2 touches no backend file and no generated type, so it runs any time before Task 7. Backend tasks 1, 3–6 are sequential: each edits `backend/app/schemas/screening.py` or `endpoints/screening.py` and regenerates `frontend/types/api/*`. Frontend tasks 7–11 are sequential: each edits `frontend/lib/copy/screening.ts`. Task 6 edits frontend files only for the `refactor(prisma)` rename (`PrismaCountsPanel.tsx`, its test, the copy key) and runs before Task 7.

## Global Constraints

- **Worktree.** `WT=/Users/raphaelfedericcihaddad/PycharmProjects/prumo/.claude/worktrees/screening-workspace-s3` (branch `screening-workspace-s3`). Every command uses absolute paths or `git -C "$WT"`; never touch the main checkout, never `git switch`/`checkout`, never bare `git stash`. After each task, `git -C "$WT" status --short` shows only that task's files.
- **Precondition (S1).** `test -f "$WT/frontend/components/screening/TitleAbstractWorkspace.tsx" && grep -q "def records" "$WT/backend/app/services/screening_review_service.py"`. If either fails, stop: S1 is not merged into this branch.
- **English only** — code, comments, commits, copy keys and copy.
- **Migration.** Exactly one, Task 1. Revision id `0095_screening_full_text` (≤ 32 chars), `down_revision = "0094_screening_v1"` — **provisional**: at merge time it takes the next free number against `origin/dev`'s head (S2 also adds one; the second to merge re-parents) and `expected_head` in `backend/tests/integration/test_migration_roundtrip.py` moves with it; when re-parented, the revision id, the file name, the roundtrip test's name and its downgrade target (`0094_screening_v1` → the new parent) move too, or the test silently downgrades through the other slice's migration. SHORT constraint names (`phase`, `decision`) per `.claude/rules/backend.md`; check the DDL with `alembic upgrade 0094_screening_v1:head --sql`. `alembic check` → "No new upgrade operations detected".
- **Ownership (BOLA).** Scope predicate in the WHERE clause; assignment-to-article joins through `ARTICLE_STILL_IN_PROJECT`; an assignment by id only through `load_assignment_for_member` → `ScreeningAssignmentRef`. No new guard: FT enroll derives its ids from the project's own TA snapshots. Gate: `check_scope_guards.py`.
- **Blind review.** No FT payload carries a peer's value or reason before an outcome. At FT, differing exclusion reasons are a conflict and read exactly like any other conflict (`waiting`/`in_review` to everyone but an unseated arbitrator). `ta_*` fields are the TA outcome, which exists before any FT assignment.
- **Envelope / errors.** `ApiResponse.success(model, trace_id=…)`; state refusals are `ScreeningStateError` (409) with an `ApiErrorCode`; a request-shape refusal is 422 `VALIDATION_ERROR` from the Pydantic model.
- **Generated types.** After any public schema or route `responses` edit: `cd "$WT" && npm run generate:api-types`, commit `frontend/types/api/openapi.json` + `schema.d.ts`. Never hand-edit. Only Tasks 1, 3, 4, 5, 6 regenerate.
- **Frontend data path.** component → hook → `services/screeningService.ts` → `apiClient`; keys only from `lib/query-keys/screening.ts` (and `articleKeys` for article files); copy through `t('screening', key)`, `{{x}}` filled with `.replace`. Gates: `check_react_query_keys.py`, `check_frontend_data_path.py`, `check_copy_keys.py`.
- **React Compiler** (`panicThreshold: 'all_errors'`): no ref read/write during render; no `try/finally` in a component/hook body; reset on prop change with the previous-value-in-state pattern; read subscriptions where consumed.
- **Keyboard.** New bindings through `useKeyboardShortcuts` (input + dialog guards). The screening shell owns `⇧⌘\` and Escape; a nested `RunSplitShell` registers neither.
- **Post-edit hook** strips unused imports: add an import in the same edit as its first use.
- **No dead code.** `npm run deadcode` and `npm run deadcode:production` at zero from Task 9 on (earlier frontend tasks may leave a not-yet-wired export, noted in the task); copy keys live; vulture green (`cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec`).
- **File size.** `check_file_size.py` exits 0 (800-line soft ceiling for new files).
- **Commands.** Frontend from `$WT` (never `cd frontend`): `npm run test:run -- <paths>`, `npm run typecheck`, `npm run lint`, `npx eslint <files>`, `npm run deadcode`, `npm run deadcode:production`, `npm run generate:api-types`. No `npx` on PATH → `~/.local/bin/mise exec node@24 -- <cmd>`. No `node_modules` → `npm ci` (never a symlink). Backend: one file `cd "$WT/backend" && uv run pytest tests/integration/test_x.py -x -q`; `make -C "$WT" lint-backend`. Fitness: `cd "$WT/backend" && uv run --frozen python ../scripts/fitness/<check>.py` (system `python3` is 3.9 and crashes).
- **Backend integration DB (port 55433, this slice's).** `docker run -d --name prumo-s3-pg -p 55433:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres postgres:17` (reuse if running); `CREATE DATABASE postgres_test_s3`; `$WT/backend/.env` with fake values only (`DATABASE_URL=postgresql://postgres:postgres@localhost:55433/postgres_test_s3`, `SUPABASE_URL=http://localhost:54321`, `SUPABASE_SERVICE_ROLE_KEY=stub-service-role`, `SUPABASE_ENV=local`, `OPENAI_API_KEY=sk-test-not-real`); from `$WT/backend`: `uv sync --frozen --extra dev`, `psql postgresql://postgres:postgres@localhost:55433/postgres_test_s3 -f tests/integration/supabase_stub.sql`, `uv run alembic upgrade head`, `uv run python -m app.seed`. Never `make db-fresh`/`reset-db`. `docker` may need the unsandboxed retry.
- **Handler coverage.** Every new or changed endpoint branch also gets a direct-call unit test of `fn.__wrapped__` with patched collaborators (`tests/unit/test_screening_review_unit.py` precedent).
- **Commits:** conventional, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Two FT reviewers both exclude, with different reasons.** It is a conflict; both reviewers read `waiting`, a non-seated reviewer `in_review`, only an unseated arbitrator `conflict`, and no payload carries the peer's reason — Task 5 `test_full_text_records_role_matrix`.
2. **A manager clicks "Send N to full text" while another manager turns full text off (or a second send runs).** The send and the config change serialize on the project row; the late send gets 409 `SCREENING_NOT_CONFIGURED`, a concurrent second send enrolls 0 with `already_enrolled = N` — Task 3 `test_full_text_enroll_and_config_serialize`, `test_two_sends_enroll_once`; the UI toasts the mapped 409 and refetches — Task 9 `toasts a refused send and refetches the config`.
3. **Turning full text off once a report was sent.** `PUT` with `full_text_reviewer_count: null` → 409 `SCREENING_CONFIG_FROZEN`; the Phases radio and FT count are disabled with the lock hint — Task 3 `test_full_text_count_locks_once_sent`, Task 10 `locks the phase radio once a report was sent`.
4. **`⇧⌘\`, Escape and `⌘F` while the maximized panel shows the PDF.** The outer shell restores (one step per press); the nested `RunSplitShell` does nothing; `⌘F` reaches the PDF viewer, not the hidden list's search — Task 9 `outer ⇧⌘\ and Escape win over the nested PDF split, one step per press` and `list shortcuts are off while maximized`; Task 2 `nested: registers neither the chord nor Escape`.
5. **A reviewer attaches the missing PDF from the FT panel.** Without a reload the row's PDF column reads "Attached" and the panel shows the PDF — Task 8 `attaching a PDF refreshes the row and the panel`.

## Spec reconciliation and rulings (focused gate, 2026-10-31)

The focused gate (one `Explore` seat; §7, S3 rows of §9, §4.1 nested parts; checked against `33d62402` and the S1 plan) found no contradiction with the spec, 44 items of drift or silence. Every item is ruled here from the spec, the S1 plan or AGENTS.md; none needed the owner. Format: `Ruling: <what> — <why> — <cost if wrong>`. Items marked *no drift* are omitted (models `:31,:34,:50,:60`; `expected_head :1335` = `0094_screening_v1`; error-code locations; `useRunReader`/`usePdfPanel`/`createViewerStore`/`RunPdfContent` locations; `protocol_exclusion_reasons :197-216`).

1. Ruling: `SCREENING_PHASE` consumers include S1's `record_rows` — the spec predates it — a missed consumer fails import, caught by tests.
2. Ruling: downgrade deletes `not_retrieved` arbitrations, then decisions, then `full_text` assignments (cascade takes their rows), then narrows the CHECKs; the append-only trigger allows the table owner — spec §7.1 — wrong order fails the CHECK re-add; the roundtrip test seeds both kinds.
3. Ruling: `reviewer_count_of(settings, phase)` takes `phase` as a **required** argument and every caller passes one, including `ScreeningConfigService.read`/`set_*` and `test_screening_config_unit.py` — a default would let an FT path silently use the TA count — none.
4. Ruling: `reviewer_count_of`, `ScreeningRoles`, `screening_roles` and `SCREENING_SETTINGS_KEY` move to a new leaf module `backend/app/services/screening_settings.py` — config service must call `assignment_states` (FT ready count, FT enroll), and `screening_review_service` already imports the config service: a module-level cycle — import churn only.
5. Ruling: by-id paths (`get_assignment`, `decide`, `arbitrate`, `_read`) take the phase from `ScreeningAssignmentRef.phase` (it validates `from_attributes`); without it every FT assignment is a 404 — spec §7.1 — none.
6. Ruling: `ScreeningAssignmentRef.phase` is required (no default); the two unit tests that build a Ref add `phase="title_abstract"` — spec §7.1 — none.
7. Ruling: `project_has_decision` is narrowed to TA (join on phase) and a new `has_assignment(project_id, phase)` drives the FT lock; a moved article's FT assignment still locks (mirrors the TA lock, which counts moved articles) — spec §6.1 — a manager cannot turn FT off after moving every FT article out; acceptable.
8. Ruling: an FT count change or removal once locked → 409 `SCREENING_CONFIG_FROZEN` (existing code) — spec §4.6 names it for Settings — none.
9. Ruling: `PUT /screening/config` keeps `reviewer_count` required; `full_text_reviewer_count` absent = unchanged, `null` = off, `1–3` = on, told apart with `model_fields_set` — spec §6.4 — the Settings form always sends the TA count, so nothing breaks.
10. Ruling: FT enroll takes `projects.lock_for_update(project_id)` before deriving candidates — §7.2 "read under the same lock"; it also serializes with the config PUT (same lock) — none.
11. Ruling: FT candidates come from the TA snapshots (`assignment_states(phase=TA)`): outcome `include` or `maybe`, article has no FT assignment — spec §7.2; inherits S2's removal predicate through `live_assignments` whichever slice merges second — none.
12. Ruling: `GET /screening/records?phase=full_text` with full text off → 409 `SCREENING_NOT_CONFIGURED`; FT rows are FT assignments only (no anti-join, no Not enrolled rows) — the UI gates on config and never issues it — none.
13. Ruling: `ScreeningRecordStatus` and `record_status` gain `not_retrieved` (outcome decision `not_retrieved`); FT status views are All, To screen, Waiting, In review, Conflict, Included, Excluded, Not retrieved; TA views keep S1's set (no Not retrieved); Maybe and Not enrolled are not FT views — §4.3 vocabulary — none.
14. Ruling: FT role-matrix integration test (incl. a reason-only conflict), `ta_*` null at TA, 20-field contract test — Review Focus 1 — none.
15. Ruling: `refactor(prisma)` also renames the private helper `_not_retrieved` → `_records_not_found` and covers the consumers the spec missed (`PrismaCountsPanel.tsx`, `PrismaCountsPanel.test.tsx`, `schema.d.ts`, test name `test_deleted_article_is_not_counted_as_not_retrieved`) — §7.4 — none.
16. Ruling: `test_prisma_payload_has_no_pending_or_conflict_field` is rewritten to pin the exact field set with `full_text_in_progress` as the one allowed flag, and still no pending/conflict count — §7.4 names the flag the exception — none.
17. Ruling: the enroll route's `responses` add 409 and 422 — the contract test reads them — none.
18. Ruling: `RunSplitShell` gains `nested?: boolean` (registers neither its chord nor its capture Escape) and its chord matches `code: 'Backslash'`; both test lines (`RunSplitShell.test.tsx:207,209`) move to `code: 'Backslash', key: '|'`. While nested, the screening panel passes `pdfState` (no hardcoded "Hide PDF"/"Show PDF" toggle) — §4.1 — none.
19. Ruling: the outer Escape chain ignores an inner PDF expand (only its toolbar button collapses it); restoring the outer maximize unmounts `RunSplitShell` and drops it — no spec state for it — one extra click.
20. Ruling: the FT panel's PDF predicate is the row's `has_pdf` (MAIN only), matching the list column; `ViewButton` and the files loading/empty/attach block are extracted from `ArticleSidePanel` and exported — §7.3 — a supplement-only article shows "Missing" in both places, consistently.
21. Ruling: attach invalidates `invalidateScreening(qc, projectId)` **and** `articleKeys.files(articleId)` in `ArticleFileUploadDialogNew`'s success path (covers `ArticleSidePanel` and the FT panel) and in `ArticleForm`'s upload — §5 row + the files query does not refetch on its own — none.
22. Ruling: `deleteArticleFile`'s missing screening invalidation is out of scope (the FT UI exposes no delete) — noted for a follow-up — a stale "Attached" for ≤ 5 minutes after a delete from Articles.
23. Ruling: e2e `fixtureArticlePdfKey(articleId)` / `ensureArticlePdfBytes(articleId)` take the article; `resetScreeningProject` sets `eligibility_criteria.exclusion` to a fixed list and inserts a MAIN `article_files` row for the PDF article; `SCREENING_ARTICLES` gains a third article "Gamma" so FT has one report with a PDF and one without — §9 E2E — merge conflict with S2's fixture edit, resolved at merge.
24. Ruling: `seed_screening.build` stays DB-only and inserts the FT records plus a MAIN `ArticleFile` row with a fixed storage key; `main()` uploads the PDF bytes through `create_storage_adapter()` (`app/core/factories.py:18`) after `build` — S1's `build` signature is kept — none.
25. Ruling: the PRISMA method line reads `useScreeningConfig`; while it loads or errors the line is omitted (the counts still render) — §7.4 — none.
26. Ruling: the FT reason picker reuses `DecisionButtons`' existing reasons dialog, not an inline list — S1 keeps the dialog at TA; one picker for both phases (§13 leaves the component split to the builder) — a later inline variant is local.
27. Ruling: switcher gains `{value: 'full_text', label: t('screening','tabFullText')}` between Title/abstract and Settings, with a `SectionViewSwitcher.test.tsx` case — §4 — none.
28. Ruling: progress strip "K to full text →" with K = `config.full_text_ready`, on the TA list only when full text is on and K > 0; the link sets `screeningTab=full_text` and drops `status`/`article` — §4.2 — none. S1's "no full-text segment" test is rewritten to cover both.
29. Ruling: "Start screening" is offered at FT with the TA rule ("you: M left" > 0) — §4.2 does not limit it — none.
30. Ruling: the list's `⌘F` and `f` are disabled while the panel is maximized (`useListKeyboardShortcuts` gains `enabled?: boolean`, default true) so the PDF viewer's `⌘F` wins — the list is hidden then — none.
31. Ruling: "Attach" in the FT panel is hidden for read-only roles (`isReadOnly`) — §4.6 viewer has no writes — none.
32. Ruling: the panel takes `phase` from the workspace and `has_pdf` from the row; the solo rule uses the phase's count (`full_text_reviewer_count` at FT) — §7.1 — none.
33. Ruling: the workspace is generalized, not copied: S1's `TitleAbstractWorkspace` becomes `ScreeningWorkspace({projectId, config, phase})` (git mv; S1's test file follows) — DRY; §13 leaves the split to the builder — a rename diff in the PR.
34. Ruling: states the spec omits are built and tested: FT sub-view 403 → `ErrorState`; Send refused (409) → mapped toast + config refetch; Send with `already_enrolled > 0` still toasts "Sent N to full text" with N = `enrolled`; Settings FT `SCREENING_TOO_FEW_REVIEWERS` → mapped toast; PDF files loading → skeleton (extracted block); attach failure → the dialog's own error — §4.6 spirit — none.
35. Ruling: acceptance rows the spec lacks are added to the owning tasks (FT off / nothing enrolled at FT states, attach invalidation, switcher entry, sent toast, ghost "Report not retrieved" posts `not_retrieved`, Maybe absent at FT, deciding with no PDF, FT note, config `full_text_ready`/`full_text_enrolled`, seed FT content, the PRISMA field-set rewrite) — §9 "each requirement → its test" — none.
36. Ruling: S5 needs from S3 — the row shape stays phase-agnostic (`ta_*` additive), FT status comes from the same `record_status`, and `records(projectId)` (no phase) remains the prefix of both phases — written to `s3-notes.md` in the shared notes folder — none.

**Panel round (ship-panel, 2026-10-31: 4 blocking confirmed, 1 refuted, 15 advisory).** Blocking, revised in the plan:

37. Ruling: the outer `⇧⌘\`/Escape over the nested PDF split is tested with both shells mounted (Task 9 `outer ⇧⌘\ and Escape win over the nested PDF split, one step per press`) — spec §9 FT panel row — none.
38. Ruling: the attach invalidations are tested on the real `ArticleFileUploadDialogNew` (new test file, full and partial success) and in `ArticleForm.stagedFiles.test.tsx` — stale-cache incident class — none.
39. Ruling: `ArticleViewButton` is `ViewButton` moved verbatim (`active, onClick, label, disabled?, title?, describedById?`) — `ArticleSidePanel` must compile with no visible change — none.
40. Ruling: `FullTextRecordView` calls `useIsBelowDesktop`, `usePdfPanel({initialOpen: true, compact})` and the store state unconditionally; the PDF pane is always open and shows the PDF or the missing-PDF body, so attaching while maximized shows the PDF (tested) — rules of hooks / React Compiler — none.

Advisory, adopted: phase typed `AssignmentPhase`/`ScreeningPhase` everywhere (no bare `str`); `enroll_screening.__wrapped__` unit test; the `FOR SHARE`↔`FOR UPDATE` serialization is stated in Task 4 and pinned by `test_title_abstract_re_decide_and_full_text_send_serialize`; the downgrade also deletes rulings whose `selected_decision_id` is a deleted decision; the merge-time re-parent moves the roundtrip test's name and target too; one `has_assignment(…, article_id=None)` instead of two queries; `emptyTitle` dropped; the extracted documents body keeps the spinner and gains a files-read error state; `mainOnly` makes a supplement-only article read "Missing" in both places; tests for the `already_enrolled` toast, the phase's my-decision values and the `not_retrieved` chip; the seed builds its storage adapter from `get_supabase_client()`; an unknown `?status=` for the phase falls back to the role default.

Advisory, ruled not adopted:
41. Ruling: hiding Attach for a viewer stays UI-only — the file-confirm route (`article_files.py:39-55`, `ensure_project_member`) predates S3 and serves Articles; tightening it is its own change — a viewer can attach a PDF through the API, as today. Follow-up noted in the PR.
42. Ruling: PRISMA computes `full_text_ready` through `full_text_candidates` (one more TA `assignment_states` pass, three queries) rather than threading its snapshots — one helper, one derivation; PRISMA is not a hot path — a few ms per PRISMA read.
43. Ruling: refuted finding (FT enroll vs TA re-decide TOCTOU) — the refuters showed the project-row locks already serialize them; Task 4's `test_title_abstract_re_decide_and_full_text_send_serialize` pins it — none.

## Composition with S2 (deduplication)

S2 (`docs/superpowers/plans/2026-10-30-screening-workspace-s2.md`, notes `s2-notes.md`) builds in parallel on S1. Whichever merges second rebases onto the other; Phase B re-checks this section against `origin/dev`.
- S2 adds `~removed_duplicate(Article)` (`app/repositories/duplicate_predicates.py`) to `live_assignments`, `record_rows` and `enroll`. Task 1's phase threading keeps that predicate in all three; FT candidates come from TA snapshots, so a removed duplicate never reaches full text.
- S2's `ScreeningConfigService.enroll` takes the project lock; Ruling 10's `lock_for_update` is the same lock — keep one acquisition.
- S2 replaces PRISMA `imported_not_enrolled` with `other_removed` and rewrites `_pubmed_identified`/`_other_sources`; Task 6 builds on that shape (the TA box stays TA-only).
- S2's `DUPLICATE_HAS_REVIEW_WORK` already counts any `phase != 'title_abstract'` assignment as review work. **S3 owns its test**: when S2 is merged, Task 3 adds `test_duplicate_with_full_text_work_is_refused` to S2's verdict test file (an FT assignment on the record to remove → 409 `DUPLICATE_HAS_REVIEW_WORK`).
- Both slices edit `frontend/lib/copy/screening.ts` (S2 renames `prismaNotEnrolled` → `prismaOtherRemoved`) and `SCREENING_ARTICLES` in `fixture-ids.ts`; conflicts resolve at merge.

---

### Task 1: Migration and phase plumbing (backend, S3a1-1)

**Depends on:** S1 merged. **Parallel with:** Task 2.

**Files:**
- Create: `backend/alembic/versions/0095_screening_full_text.py`
- Modify: `backend/app/models/screening.py` (`SCREENING_PHASE` → `TITLE_ABSTRACT`, `FULL_TEXT`; `_DECISION_CHECK`; phase `CheckConstraint`; model default)
- Create: `backend/app/services/screening_settings.py` (moved from `screening_config_service.py`: `SCREENING_SETTINGS_KEY`, `reviewer_count_of`, `ScreeningRoles`, `screening_roles`)
- Modify: `backend/app/services/screening_config_service.py`, `screening_review_service.py`, `prisma_service.py` (imports; `reviewer_count_of(…, phase)`; `assignment_states(phase=…)`), `backend/app/repositories/screening_repository.py`, `backend/app/schemas/screening.py` (`ScreeningAssignmentRef.phase`), every other importer of the moved names (`grep -rn "screening_config_service import" backend`)
- Modify: `backend/tests/integration/helpers/screening_fixtures.py` (`:22,:83`), `backend/tests/integration/test_migration_roundtrip.py` (`expected_head`; new roundtrip test), `backend/tests/integration/test_screening_schema.py`, `backend/tests/unit/test_screening_config_unit.py`, `test_screening_review_unit.py`, `test_screening_arbitration_unit.py` (Ref literals gain `phase`)

**Interfaces — Produces:**

```python
# models/screening.py
TITLE_ABSTRACT = "title_abstract"
FULL_TEXT = "full_text"
_DECISION_CHECK = "decision IN ('include', 'exclude', 'maybe', 'not_retrieved')"
# CheckConstraint("phase IN ('title_abstract', 'full_text')", name="phase")

# schemas/screening.py
AssignmentPhase = Literal["title_abstract", "full_text"]   # Task 5 folds it into ScreeningPhase and deletes this name
class ScreeningAssignmentRef(BaseModel):  # gains
    phase: AssignmentPhase

# services/screening_settings.py
def reviewer_count_of(settings: Mapping[str, Any] | None, phase: AssignmentPhase) -> int | None:
    """TA → settings.screening.reviewer_count; FT → .full_text_reviewer_count; 1..3 else None."""

# repositories/screening_repository.py
# every `phase` parameter below is typed `AssignmentPhase` (never a bare str)
def live_assignments(project_id: UUID, phase: AssignmentPhase) -> Select[tuple[ScreeningAssignment]]
ScreeningRepository.enroll(*, project_id, enrolled_by, article_ids, phase) -> int
ScreeningRepository.count_enrolled(*, project_id, phase) -> int
ScreeningRepository.live_assignment_ids(*, project_id, phase, assignment_ids=None) -> list[UUID]
ScreeningRepository.project_has_decision(*, project_id) -> bool   # now TA decisions only
ScreeningRepository.has_assignment(*, project_id, phase, article_id: UUID | None = None) -> bool
#   any row in that phase (moved articles included); narrowed to one article when given — Task 4 uses that form
ScreeningRepository.record_rows(*, project_id, phase) -> list[RecordSource]  # S1's; TA behaviour unchanged here

# services/screening_review_service.py
async def assignment_states(db, *, project_id, phase: AssignmentPhase, reviewer_count: int | None,
                            assignment_ids=None) -> dict[UUID, AssignmentSnapshot]
```

Every existing call site passes `TITLE_ABSTRACT` except the by-id paths, which pass `ref.phase` (and `reviewer_count_of(settings, ref.phase)`). `assignments_with_articles` takes `phase` too. No behaviour change at TA: this task is plumbing.

- [ ] **Step 1: Write the failing tests**
  - `test_screening_schema.py` beside `test_decision_value_is_checked` (`:228`): `test_full_text_and_not_retrieved_are_accepted` — insert an assignment with `phase='full_text'`, a decision `not_retrieved` (no reason) and an arbitration `not_retrieved` → no error; `phase='other'` still `IntegrityError`.
  - `test_migration_roundtrip.py`: `expected_head = "0095_screening_full_text"`; `test_0095_screening_full_text_roundtrip` (the `:2791` 0094 shape): upgrade to head, insert a TA assignment with an include decision, an FT assignment with a `not_retrieved` decision, a TA arbitration `not_retrieved`, and an FT arbitration `include` whose `selected_decision_id` is that FT `not_retrieved` decision; downgrade to `0094_screening_v1` → the FT assignment, both `not_retrieved` rows gone, the TA include kept; `phase='full_text'` insert now raises; upgrade again succeeds.
  - `test_screening_config_unit.py`: `test_reviewer_count_of_reads_the_phase_key` parametrized (`ids=`): `({"screening": {"reviewer_count": 2, "full_text_reviewer_count": 1}}, "full_text") → 1`, same with `"title_abstract"` → 2, `({"screening": {"reviewer_count": 2}}, "full_text") → None`, `full_text_reviewer_count: 4` → None, `True` → None. Import from `app.services.screening_settings`.
  - `test_screening_review.py` (integration): `test_full_text_assignment_reads_by_id` — enroll an article at FT through `ScreeningRepository.enroll(phase=FULL_TEXT)` with `full_text_reviewer_count = 2` set by `update_settings_key`; `GET /screening/assignments/{id}` as a reviewer → 200, `status == "awaiting_me"`; with the FT count unset the read still answers 200 (pending everywhere, `_UNCONFIGURED`).
  - `test_screening_config.py`: `test_full_text_decisions_do_not_lock_the_title_abstract_count` — an FT assignment with a decision only → `reviewer_count_locked is False`.

Run: `cd "$WT/backend" && uv run pytest tests/integration/test_screening_schema.py tests/integration/test_migration_roundtrip.py tests/unit/test_screening_config_unit.py tests/integration/test_screening_review.py tests/integration/test_screening_config.py -q`
Expected: FAIL — CHECK violation on `full_text`, head mismatch, `ImportError: screening_settings`, 404 on the FT assignment.

- [ ] **Step 2: Write the migration** — `revision = "0095_screening_full_text"`, `down_revision = "0094_screening_v1"`. Upgrade: drop and re-create `ck_screening_assignments_phase`, `ck_screening_decisions_decision`, `ck_screening_arbitrations_decision` with the widened expressions (SHORT names to `op.create_check_constraint`; raw `ALTER TABLE … DROP CONSTRAINT` for the drop). Downgrade: `DELETE FROM public.screening_arbitrations WHERE decision = 'not_retrieved' OR selected_decision_id IN (SELECT id FROM public.screening_decisions WHERE decision = 'not_retrieved')` (no surviving ruling may point at a deleted decision through the deferred composite FK), then `DELETE FROM public.screening_decisions WHERE decision = 'not_retrieved'`, then `DELETE FROM public.screening_assignments WHERE phase = 'full_text'`, then narrow the three CHECKs. Module docstring states the provisional number (renumbered at merge).

Run: `cd "$WT/backend" && uv run alembic upgrade 0094_screening_v1:head --sql | grep -i constraint`
Expected: DROP/ADD of exactly `ck_screening_assignments_phase`, `ck_screening_decisions_decision`, `ck_screening_arbitrations_decision` (no `ck_ck_` double prefix).

- [ ] **Step 3: Implement** the model, the settings module move (delete the originals in the same edit; re-point importers), the repository/service threading per Interfaces, `Ref.phase`, the fixture constants. `project_has_decision` joins `ScreeningAssignment.phase == TITLE_ABSTRACT`.

- [ ] **Step 4: Run to verify everything passes**

Run: `cd "$WT/backend" && uv run alembic upgrade head && uv run alembic check && uv run pytest tests/unit tests/integration/test_screening_*.py tests/integration/test_prisma_counts.py tests/integration/test_migration_roundtrip.py tests/integration/test_seed_screening.py -q`
Expected: "No new upgrade operations detected"; PASS, `0 failed`.

- [ ] **Step 5: Gates**

Run: `cd "$WT" && npm run generate:api-types && git -C "$WT" diff --stat frontend/types/api` (expected: no change — `Ref` is internal), `make -C "$WT" lint-backend`, from `$WT/backend`: `check_scope_guards.py`, `check_layered_arch.py`, `bash ../scripts/fitness/check_migration_split.sh` (or the path `run_all.sh` uses), vulture.
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git -C "$WT" add backend
git -C "$WT" commit -m "feat(screening): add the full-text phase to the schema and thread phase through screening reads" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shell and PDF primitives (frontend, S3b-1)

**Depends on:** S1 merged. **Parallel with:** Tasks 1, 3–6 (no backend file, no generated type, no `lib/copy/screening.ts`).

**Files:**
- Modify: `frontend/components/runs/RunSplitShell.tsx`, `frontend/components/runs/RunSplitShell.test.tsx` (`:207,:209`)
- Create: `frontend/components/articles/ArticleDocumentsBody.tsx` (extracted from `ArticleSidePanel.tsx`: the files loading `:101-107`, empty state `:108-118`, attach dialog `:124-132`), `frontend/components/articles/ArticleViewButton.tsx` (`ViewButton`, `:137-169`, exported as `ArticleViewButton`)
- Modify: `frontend/components/articles/ArticleSidePanel.tsx` (consumes both; no visible change), `frontend/components/articles/ArticleFileUploadDialogNew.tsx` (success paths invalidate), `frontend/components/articles/ArticleForm.tsx` (upload success `:589` invalidates), `frontend/hooks/extraction/useArticleDocuments.ts` (`filesError`, `refetchFiles`)
- Test: `frontend/components/articles/__tests__/ArticleFileUploadDialogNew.test.tsx` (create), `frontend/test/components/ArticleForm.stagedFiles.test.tsx` (one case)
- Modify: `frontend/hooks/useListKeyboardShortcuts.ts` (+ `enabled`), `frontend/hooks/useListKeyboardShortcuts.test.ts` (S1's file)
- Test: `frontend/components/articles/__tests__/ArticleDocumentsBody.test.tsx` (create), existing `ArticleSidePanel` tests stay green

**Interfaces — Produces:**

```ts
// RunSplitShell.tsx
interface RunSplitShellProps { /* … */
  /** Rendered inside another shell that owns ⇧⌘\ and Escape: register neither. */
  nested?: boolean;
}
// chord binding: {type: 'chord', key: '\\', code: 'Backslash', mod: true, shift: true, …}

// ArticleDocumentsBody.tsx — the ArticleSidePanel block moved verbatim (spinner + `panelDocumentLoading`
// while files load; `panelNoDocument*` empty state; the attach dialog), plus a files-read error state
export function ArticleDocumentsBody(props: {
  projectId: string;
  articleId: string;
  canAttach: boolean;            // false → empty state without the attach action
  mainOnly?: boolean;            // true (FT panel): only `file_role === 'MAIN'` files count, matching `has_pdf`
  children: (files: ArticleFileListItem[]) => ReactNode; // rendered once (MAIN) files exist
}): JSX.Element;

// ArticleViewButton.tsx — ViewButton (`ArticleSidePanel.tsx:137-169`) moved verbatim, same props
export function ArticleViewButton(props: {
  active: boolean; onClick: () => void; label: string;
  disabled?: boolean; title?: string; describedById?: string;
}): JSX.Element;

// useArticleDocuments gains: filesError: boolean; refetchFiles: () => void  (from filesQuery.isError / refetch)

// useListKeyboardShortcuts
enabled?: boolean; // default true; false registers no listener
```

`ArticleDocumentsBody` with `filesError` → `ErrorState` with retry (`refetchFiles`) instead of the empty state (a failed files read must not read as "no PDF"). `ArticleFileUploadDialogNew`, in both success branches (partial `:350-353` and full `:356`): `void invalidateScreening(queryClient, projectId)` and `void queryClient.invalidateQueries({queryKey: articleKeys.files(articleId)})`, before `onFileUploaded?.()`. `ArticleForm` the same after its upload (`:589`).

- [ ] **Step 1: Write the failing tests**
  - `RunSplitShell.test.tsx`: rewrite `:207,:209` to `fireEvent.keyDown(window, {key: '|', code: 'Backslash', metaKey: true, shiftKey: true})` → expands; add `nested: registers neither the chord nor Escape` (render with `nested` and `initialPdfOpen`, fire the chord → not expanded; expand through the toolbar button, fire Escape → still expanded).
  - `ArticleDocumentsBody.test.tsx` (mocked `useArticleDocuments`): `shows the loading spinner while files load`; `shows an error with retry when the files read fails` (retry calls `refetchFiles`; no Attach button); `shows the empty state with Attach when canAttach`; `hides Attach when not canAttach`; `renders children with the files`; `mainOnly ignores a supplement-only article` (one `SUPPLEMENT` file → empty state).
  - Create `frontend/components/articles/__tests__/ArticleFileUploadDialogNew.test.tsx` — render the **real** dialog in a `QueryClientProvider`, `vi.mock('@/services/articlesService')` so `uploadArticleFile` resolves ok (and, for the partial case, ok for one file and an error for the other); select files through the file input and submit: `invalidates the screening family and the article files after an upload` and `… after a partial upload` (spy `invalidateQueries` called with `{queryKey: ['screening','project',projectId]}` and `{queryKey: articleKeys.files(articleId)}`; `onFileUploaded` called).
  - `frontend/test/components/ArticleForm.stagedFiles.test.tsx`: `invalidates the screening family and the article files after a staged upload` (same two assertions; the file already mocks `uploadArticleFile`).
  - `useListKeyboardShortcuts.test.ts`: `registers nothing when disabled` (⌘F → search not focused, `f` → popover setter not called).
  - `ArticleSidePanel` existing suites: unchanged and green (it now renders `ArticleViewButton` and `ArticleDocumentsBody`, no `mainOnly`).

Run: `npm run test:run -- frontend/components/runs/RunSplitShell.test.tsx frontend/components/articles frontend/hooks/useListKeyboardShortcuts.test.ts`
Expected: FAIL — chord on `code`, `nested`, unresolved `ArticleDocumentsBody`, `enabled`.

- [ ] **Step 2: Implement** per Interfaces (move code out of `ArticleSidePanel.tsx` in the same edit; no copy-key change — reuse the existing article copy keys).

- [ ] **Step 3: Run to verify it passes**, then `npm run test:run -- frontend/components frontend/hooks frontend/test && npm run typecheck && npx eslint <touched files>`
Expected: PASS, exit 0. (`ArticleViewButton` and `nested` gain a screening consumer in Task 8; knip is gated from Task 9.)

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/components/runs frontend/components/articles frontend/hooks/useListKeyboardShortcuts.ts frontend/hooks/useListKeyboardShortcuts.test.ts frontend/hooks/extraction/useArticleDocuments.ts frontend/test/components/ArticleForm.stagedFiles.test.tsx
git -C "$WT" commit -m "feat(articles): extract the documents body, nested RunSplitShell, refresh screening on attach" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Config and full-text enroll (backend, S3a1-2)

**Depends on:** Task 1. **Parallel with:** Task 2.

**Files:**
- Modify: `backend/app/schemas/screening.py` (`ScreeningConfigRead`, `ScreeningConfigUpdate`, `ScreeningEnrollRequest`)
- Modify: `backend/app/services/screening_config_service.py` (`read`, `set_reviewer_count` → `set_config`, `enroll`)
- Modify: `backend/app/services/screening_review_service.py` (add `full_text_candidates`)
- Modify: `backend/app/api/v1/endpoints/screening.py` (PUT config calls `set_config`; enroll passes `phase`, `responses` gain 409 + 422; PUT 409 description names the FT lock)
- Test: `backend/tests/integration/test_screening_config.py`, `backend/tests/integration/test_screening_concurrency.py`, `backend/tests/unit/test_screening_config_unit.py`
- Regenerate: `frontend/types/api/*`; Modify: any frontend test fixture building `ScreeningConfigRead` literally (typecheck lists them; add the four FT fields with `null`/`false`/`0`)

**Interfaces — Produces:**

```python
class ScreeningConfigRead(BaseModel):  # gains
    full_text_reviewer_count: int | None   # None = title/abstract only
    full_text_count_locked: bool           # an FT assignment exists
    full_text_ready: int                   # TA include/maybe with no FT assignment (0 when TA unconfigured)
    full_text_enrolled: int                # live FT assignments

class ScreeningConfigUpdate(BaseModel):  # extra="forbid"
    reviewer_count: int = Field(ge=1, le=3)
    full_text_reviewer_count: int | None = Field(default=None, ge=1, le=3)  # absent = unchanged; null = off

class ScreeningEnrollRequest(BaseModel):  # gains
    phase: Literal["title_abstract", "full_text"] = "title_abstract"
    # model_validator: phase == "full_text" and article_ids is not None → ValueError (422 VALIDATION_ERROR)

# screening_review_service.py
async def full_text_candidates(db: AsyncSession, *, project_id: UUID, ta_reviewer_count: int | None) -> list[UUID]:
    """Article ids whose TA outcome is include or maybe and that have no FT assignment, in TA queue order."""

# screening_config_service.py
async def set_config(self, project_id: UUID, viewer_id: UUID, body: ScreeningConfigUpdate) -> ScreeningConfigRead
async def enroll(self, project_id: UUID, enrolled_by: UUID, article_ids: list[UUID] | None,
                 phase: AssignmentPhase = TITLE_ABSTRACT) -> ScreeningEnrollResult
```

Rules (§6.1, §7.2):
- `set_config` locks the project row (as today). TA count: today's rule (`SCREENING_CONFIG_FROZEN` if changed after a TA decision; `SCREENING_TOO_FEW_REVIEWERS` above `reviewer_capable`). FT, only when `"full_text_reviewer_count" in body.model_fields_set`: a change (value → other value, value → null, null → value) when `has_assignment(phase=FULL_TEXT)` → `SCREENING_CONFIG_FROZEN` ("Full-text reviewers cannot change once a record was sent to full text."); a value above `reviewer_capable` → `SCREENING_TOO_FEW_REVIEWERS`; `null` removes the key. One `update_settings_key` merge writes both keys.
- FT enroll: `projects.lock_for_update(project_id)` first; FT count `None` → `SCREENING_NOT_CONFIGURED`; `load_exclusion_reasons` empty → `SCREENING_REASON_REQUIRED` ("Add exclusion reasons to the protocol before sending records to full text."); candidates = `full_text_candidates(...)` under the lock; `enrolled = repo.enroll(article_ids=candidates, phase=FULL_TEXT)` (`ON CONFLICT DO NOTHING`); `already_enrolled = len(candidates) - enrolled`. N = 0 → 200 `{enrolled: 0, already_enrolled: 0}`. `SCREENING_REASON_REQUIRED` is added to `ApiErrorCode` in this task (Task 4 reuses it).

- [ ] **Step 1: Write the failing tests** (`test_screening_config.py`, reuse its helpers and `screening_fixtures`)
  - `test_put_full_text_count_absent_null_value` — PUT `{reviewer_count: 2}` leaves an existing FT count; `{…, full_text_reviewer_count: 2}` sets it (read shows 2); `{…, full_text_reviewer_count: null}` removes it (read `None`, key absent from `projects.settings`).
  - `test_full_text_count_too_few_reviewers` — FT 3 with 2 capable → 409 `SCREENING_TOO_FEW_REVIEWERS`.
  - `test_full_text_count_locks_once_sent` — after one FT enroll: `full_text_count_locked is True`; PUT FT 1 → 409 `SCREENING_CONFIG_FROZEN`; PUT FT null → 409 same; PUT same value → 200.
  - `test_ta_lock_ignores_full_text_decisions` (TA count changeable while only FT decisions exist — Task 1's case through the PUT).
  - `test_config_ready_and_enrolled` — TA rc 2: r1 both include, r2 both maybe, r3 both exclude, r4 pending, r5 conflict → `full_text_ready == 2`, `full_text_enrolled == 0`; after FT enroll → `0` and `2`.
  - `test_full_text_enroll_derives_include_and_maybe` — same fixture → `{enrolled: 2, already_enrolled: 0}`; FT assignments exist for r1, r2 only; second call → `{0, 0}`; the TA PRISMA box (`GET /prisma`) equals its value before the send.
  - `test_full_text_enroll_refusals` — FT off → 409 `SCREENING_NOT_CONFIGURED`; no protocol reasons → 409 `SCREENING_REASON_REQUIRED`; body `{phase: "full_text", article_ids: [x]}` → 422 `VALIDATION_ERROR`; a reviewer → 403.
  - `test_screening_concurrency.py` (real commits): `test_two_sends_enroll_once` — two sessions run FT enroll concurrently → results `{2,0}` and `{0,2}` (either order), 2 FT rows; `test_full_text_enroll_and_config_serialize` — session A holds `lock_for_update` on the project and turns FT off, session B's send parks on the lock (poll `pg_locks WHERE NOT granted` as S1's solo race does), A commits → B raises `SCREENING_NOT_CONFIGURED`, 0 FT rows.
  - Only if S2 is merged (`test -f "$WT/backend/app/repositories/duplicate_predicates.py"`): `test_duplicate_with_full_text_work_is_refused` in S2's duplicate-verdict integration file — an article with an FT assignment posted as the removed side → 409 `DUPLICATE_HAS_REVIEW_WORK`.
  - `test_screening_config_unit.py`: `test_enroll_request_refuses_ids_at_full_text` (ValidationError), `test_put_handler_passes_the_body` (`put_screening_config.__wrapped__` with `set_config` patched, awaited with the body); `test_enroll_handler_passes_the_phase` (`enroll_screening.__wrapped__` with `ScreeningConfigService.enroll` patched: body `{phase: 'full_text'}` → awaited with `(PROJECT, CALLER, None, 'full_text')`; no body → `(PROJECT, CALLER, None, 'title_abstract')`).

Run: `cd "$WT/backend" && uv run pytest tests/integration/test_screening_config.py tests/integration/test_screening_concurrency.py tests/unit/test_screening_config_unit.py -q`
Expected: FAIL — unknown field `full_text_reviewer_count`, `KeyError: full_text_ready`, enroll ignores `phase`.

- [ ] **Step 2: Implement** per Interfaces and Rules.

- [ ] **Step 3: Run to verify it passes**, then `cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_screening_*.py -q`
Expected: PASS.

- [ ] **Step 4: Regenerate and gates**

Run: `cd "$WT" && npm run generate:api-types && npm run typecheck` (fix only literal `ScreeningConfigRead` fixtures), `make -C "$WT" lint-backend`, `check_scope_guards.py`, `check_api_response_envelope.py`, vulture.
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git -C "$WT" add backend frontend/types/api frontend
git -C "$WT" commit -m "feat(screening): full-text setting with its lock and the send-to-full-text enroll" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Full-text decision rules (backend, S3a2-1)

**Depends on:** Task 3.

**Files:**
- Modify: `backend/app/schemas/screening.py` (`ScreeningDecisionValue` += `"not_retrieved"`; module docstring "Title/abstract and full-text screening: …")
- Modify: `backend/app/schemas/common.py` (`ApiErrorCode` += `SCREENING_PHASE_ADVANCED`, `SCREENING_DECISION_NOT_IN_PHASE`)
- Modify: `backend/app/services/screening_outcome.py` (`derive_state(…, reasons_must_match: bool = False)`)
- Modify: `backend/app/services/screening_review_service.py` (`decide`, `arbitrate`, `assignment_states` passes `reasons_must_match=(phase == FULL_TEXT)`)
- Modify: `backend/app/api/v1/endpoints/screening.py` (decide/arbitrate 409 descriptions name the new codes)
- Test: `backend/tests/unit/test_screening_outcome.py`, `backend/tests/integration/test_screening_review.py`, `test_screening_arbitration.py`, `test_screening_concurrency.py`
- Regenerate: `frontend/types/api/*`

**Interfaces — Produces:**

```python
def derive_state(reviewer_count, decisions, ruling, reasons_must_match: bool = False) -> AssignmentState
#   reasons_must_match and len({d.exclusion_reason for d in decisions}) > 1 → _CONFLICT (after the values check)

# uses Task 1's has_assignment(project_id=…, phase=FULL_TEXT, article_id=…)

def _check_decision_for_phase(phase: AssignmentPhase, decision: str, exclusion_reason: str | None) -> None
#   TA + not_retrieved → SCREENING_DECISION_NOT_IN_PHASE; FT + maybe → same;
#   FT + exclude + no reason → SCREENING_REASON_REQUIRED
```

Rules (§6.3, §7.3), all read **after** `lock_assignment`. **Lock dependency:** the FT-assignment check is race-free only because `decide`/`arbitrate` hold the project row `FOR SHARE` (`settings_for_share`) from before `lock_assignment` until commit, and FT enroll takes the same row `FOR UPDATE` (Task 3): a send and a TA re-decide/re-ruling serialize. Keep `settings_for_share` as the first read; say so in a comment at the check.
- `decide`: `_check_decision_for_phase(ref.phase, …)` first (before the reason-in-protocol check). S1's solo re-decide branch at TA: if `has_assignment(project_id=ref.project_id, phase=FULL_TEXT, article_id=ref.article_id)` → `SCREENING_PHASE_ADVANCED` ("This article is already in full-text screening."), checked before the ruling/`DECISION_FINAL` checks. The solo branch applies at FT with `full_text_reviewer_count == 1` (no FT advance check).
- `arbitrate`: TA and the article has an FT assignment → `SCREENING_PHASE_ADVANCED`. Override path: `_check_decision_for_phase(ref.phase, body.decision, body.exclusion_reason)`; adopt path needs no check (the adopted decision passed it). Guard: allowed when in conflict, when arbitrated (today), **or** when `ref.phase == FULL_TEXT` and `outcome.decision == "not_retrieved"` ("PDF found later"); still never by a seated arbitrator.

- [ ] **Step 1: Write the failing tests**
  - `test_screening_outcome.py`: `test_reasons_must_match` parametrized — two excludes "A"/"B" with `True` → conflict; with `False` → decided, `reasons_differ`; `not_retrieved` vs `include` → conflict; two `not_retrieved` → decided `not_retrieved`.
  - `test_screening_review.py` (FT fixture: FT count 2, protocol reasons `["Wrong population", "Wrong outcome"]`, an FT assignment):
    `test_full_text_refuses_maybe` (409 `SCREENING_DECISION_NOT_IN_PHASE`); `test_title_abstract_refuses_not_retrieved` (same code); `test_full_text_exclude_needs_a_reason` (409 `SCREENING_REASON_REQUIRED`); `test_full_text_not_retrieved_takes_no_reason` (200; rows show `not_retrieved`, reason null); `test_full_text_note_is_kept` (`rationale` stored); `test_full_text_differing_reasons_conflict` (A exclude "Wrong population", B exclude "Wrong outcome" → assignment read as a third reviewer `awaiting_others`, as an unseated manager `conflict`); `test_full_text_uses_its_own_count` (TA rc 2, FT rc 1: one FT decision → outcome `solo`; a second reviewer → `SCREENING_REVIEWER_CAP`; the FT solo reviewer re-decides → 200); `test_title_abstract_re_decide_after_full_text_is_refused` (TA rc 1, R includes, FT enroll, R posts exclude → 409 `SCREENING_PHASE_ADVANCED`).
  - `test_screening_arbitration.py`: the three phase refusals on the override path (maybe at FT, not_retrieved at TA, FT exclude without reason); `test_title_abstract_ruling_after_full_text_is_refused` (TA conflict ruled, FT enroll, re-ruling → `SCREENING_PHASE_ADVANCED`); `test_pdf_found_later` (FT rc 2, both `not_retrieved` → decided; unseated MANAGER rules include → 200, outcome `arbitrated` include; a seated arbitrator → `ScreeningSelfArbitrationError` 409 as today); `test_not_retrieved_vs_include_is_ruled_like_a_conflict`.
  - `test_screening_concurrency.py`: `test_title_abstract_re_decide_and_full_text_send_serialize` — TA rc 1, R includes; session A starts FT enroll and holds the project `FOR UPDATE`; session B's TA re-decide (exclude) parks on the `FOR SHARE` (poll `pg_locks WHERE NOT granted`); A commits → B raises `SCREENING_PHASE_ADVANCED`, R's current decision is still include.

Run: `cd "$WT/backend" && uv run pytest tests/unit/test_screening_outcome.py tests/integration/test_screening_review.py tests/integration/test_screening_arbitration.py tests/integration/test_screening_concurrency.py -q`
Expected: FAIL — 422 on `not_retrieved`, 200 where 409s are expected.

- [ ] **Step 2: Implement** per Interfaces and Rules; reword the `derive_state` docstring to mention `reasons_must_match` ("at full text, differing exclusion reasons are a conflict").

- [ ] **Step 3: Run to verify it passes**, then the whole screening suite: `cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_screening_*.py tests/integration/test_prisma_counts.py -q`
Expected: PASS.

- [ ] **Step 4: Regenerate and gates** — `npm run generate:api-types && npm run typecheck`, `make -C "$WT" lint-backend`, `check_scope_guards.py`, `check_api_response_envelope.py`, vulture. Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git -C "$WT" add backend frontend/types/api
git -C "$WT" commit -m "feat(screening): full-text decision rules, not retrieved, and the phase-advanced refusal" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Full-text records read and seed (backend, S3a2-2)

**Depends on:** Task 4.

**Files:**
- Modify: `backend/app/schemas/screening.py` (`ScreeningPhase = Literal["title_abstract", "full_text"]`; every `AssignmentPhase` use replaced by it and `AssignmentPhase` deleted; `ScreeningRecordStatus` += `"not_retrieved"`; `ScreeningRecordRow` += `ta_*`)
- Modify: `backend/app/services/screening_outcome.py` (`record_status`), `screening_review_service.py` (`records`), `backend/app/repositories/screening_repository.py` (`record_rows` FT branch)
- Modify: `backend/app/seed_screening.py`
- Test: `backend/tests/integration/test_screening_records.py`, `backend/tests/unit/test_screening_records_unit.py`, `backend/tests/unit/test_screening_outcome.py`, `backend/tests/integration/test_seed_screening.py`, `backend/tests/unit/test_seed_screening.py`
- Regenerate: `frontend/types/api/*`; Modify: frontend fixtures that build `ScreeningRecordRow` literally (add the three `ta_*` as `null`) — typecheck lists them

**Interfaces — Produces:**

```python
ScreeningPhase = Literal["title_abstract", "full_text"]
ScreeningRecordStatus = Literal["not_enrolled", "to_screen", "waiting", "in_review", "conflict",
                                "included", "excluded", "maybe", "not_retrieved"]
class ScreeningRecordRow(BaseModel):  # S1's 17 fields + (full-text rows only; null at title/abstract)
    ta_outcome: ScreeningDecisionValue | None
    ta_outcome_kind: ScreeningOutcomeKind | None
    ta_reviewer_count: int | None
```

Rules: `records(phase=FULL_TEXT)`: FT count `None` → 409 `SCREENING_NOT_CONFIGURED`; rows = live FT assignments only (`record_rows` inner-joins at FT; the TA anti-join is unchanged), in FT queue order; statuses from FT snapshots (`reasons_must_match`); `reviewer_count` = FT count; `ta_*` from one TA `assignment_states` call keyed by article id, `ta_reviewer_count` = TA count. `record_status`: outcome `not_retrieved` → `"not_retrieved"`.

Seed (Ruling 24): `build` turns FT on (`full_text_reviewer_count: 2`), adds two more both-include TA records, FT-enrolls the three include records through `ScreeningConfigService.enroll(phase=FULL_TEXT)` (so the seed exercises the real path), r1 excludes one FT record "Wrong outcome", and inserts one MAIN `ArticleFile` (`file_type="pdf"`, `storage_key=SEED_PDF_KEY = f"{project_id}/{article_id}/seed-screening.pdf"`) on another; `main()` after commit uploads `SEED_PDF_BYTES` (a minimal one-page PDF literal in the module) through `create_storage_adapter(get_supabase_client())` (`app/core/factories.py:18`, `app/core/deps.py:76`; the local Supabase URL and service key from `backend/.env`) to that key. TA counts S1's test asserts stay true (`exactly 2 not_enrolled`).

- [ ] **Step 1: Write the failing tests**
  - `test_screening_records_unit.py`: `test_record_row_has_exactly_the_wire_fields` → the 20 names; `test_records_handler_passes_full_text`.
  - `test_screening_outcome.py`: `test_record_status` gains `decided not_retrieved → not_retrieved`.
  - `test_screening_records.py`: flip S1's `test_records_phase_is_required_and_closed` (`phase=full_text` → 409 when FT off, 200 when on; `phase=other` → 422); `test_full_text_records_role_matrix` — FT rc 2, reviewers A, B, C, consensus K, viewer V, MANAGER: F1 (A exclude "Wrong population", B exclude "Wrong outcome" → reason conflict), F2 (A include), F3 (A, B `not_retrieved`), F4 not decided; assert per caller A: waiting/waiting/not_retrieved/to_screen; C: in_review/to_screen/not_retrieved/to_screen; K and MANAGER: conflict/to_screen/not_retrieved/to_screen; V: in_review/in_review/not_retrieved/in_review; A's F1 `my_exclusion_reason == "Wrong population"`, `outcome_exclusion_reason is None`; no row anywhere carries "Wrong outcome" for A or C; every row has the 20 keys. `test_full_text_rows_are_full_text_assignments_only` (TA-only and not-enrolled articles absent; `queue_rank` 0..n-1); `test_full_text_rows_carry_the_title_abstract_outcome` (`ta_outcome == "include"`, `ta_outcome_kind == "consensus"`, `ta_reviewer_count == 2`; an arbitrated maybe → `"maybe"`, `"arbitrated"`); `test_title_abstract_rows_have_no_ta_fields` (all three null); `test_full_text_has_pdf`.
  - `test_seed_screening.py` (integration): the existing case gains — the FT records read as manager has 3 rows; the record with r1's exclude reads `to_screen` to the manager (FT rc 2, one decision) and `waiting` to r1; exactly one row has `has_pdf`; config `full_text_enrolled == 3`. Unit: `test_main_uploads_the_seed_pdf_after_commit` (patch `get_supabase_client` and `create_storage_adapter` → `upload` awaited once with `SEED_PDF_KEY` after `build`; not called when `build` raises).

Run: `cd "$WT/backend" && uv run pytest tests/unit/test_screening_records_unit.py tests/unit/test_screening_outcome.py tests/integration/test_screening_records.py tests/integration/test_seed_screening.py tests/unit/test_seed_screening.py -q`
Expected: FAIL — 422 on `phase=full_text`, 17 fields, missing seed FT rows.

- [ ] **Step 2: Implement** per Interfaces and Rules.

- [ ] **Step 3: Run to verify it passes**, then `cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_screening_*.py tests/integration/test_seed_screening.py -q`
Expected: PASS.

- [ ] **Step 4: Regenerate and gates** — `npm run generate:api-types && npm run typecheck` (fix only literal row fixtures), `make -C "$WT" lint-backend`, `check_scope_guards.py`, `check_layered_arch.py`, vulture. Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git -C "$WT" add backend frontend/types/api frontend
git -C "$WT" commit -m "feat(screening): full-text records read and a full-text record in the local seed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: PRISMA reports box (backend + rename, S3a2-3)

**Depends on:** Task 5.

**Files:**
- Modify: `backend/app/schemas/prisma.py`, `backend/app/services/prisma_service.py`
- Modify (rename commit): `frontend/components/prisma/PrismaCountsPanel.tsx` (`:75`), `frontend/components/prisma/__tests__/PrismaCountsPanel.test.tsx` or its actual path (`:33,:47`), `frontend/lib/copy/screening.ts` (`prismaNotRetrieved` → `prismaRecordsNotFound`, `:128`)
- Test: `backend/tests/unit/test_prisma_endpoint_unit.py` (`:27`), `backend/tests/unit/test_prisma_screening_box.py` (`:54`, `:59`), `backend/tests/integration/test_prisma_counts.py` (`:78,135,157,179,192`)
- Regenerate: `frontend/types/api/*`

**Interfaces — Produces:**

```python
class PrismaCountsRead(BaseModel):
    # renamed: not_retrieved → records_not_found
    ta_included: int
    ta_maybe: int
    reports_not_retrieved: int | None        # None when full text is off (every reports_* and the flag)
    reports_assessed: int | None             # FT include + exclude outcomes
    reports_excluded_by_reason: list[PrismaReasonCount] | None
    reports_included: int | None
    full_text_in_progress: bool | None

@dataclass(frozen=True)
class ReportsBox:
    not_retrieved: int; assessed: int; excluded_by_reason: dict[str, int]; included: int; without_outcome: int
def reports_box(states: Sequence[AssignmentState]) -> ReportsBox
```

Rules (§7.4): the TA box is computed from TA snapshots only (`assignment_states(phase=TITLE_ABSTRACT)`), so it is unchanged by any FT row; `ta_included`/`ta_maybe` = TA outcomes include / maybe. FT on: FT snapshots with the FT count; `full_text_in_progress = reports_box.without_outcome > 0 or full_text_ready > 0` (reuse `full_text_candidates`); invariant `sought_for_retrieval == not_retrieved + assessed + without_outcome + ready`. FT off: every `reports_*` and the flag `None`. Docstring of `schemas/prisma.py` (`:1-5`): the one exception is `full_text_in_progress`, which merges pending and conflict and is never split.

- [ ] **Step 1 (sibling commit first): `refactor(prisma)` rename** — rename the wire field, `_not_retrieved` → `_records_not_found`, the copy key, the panel row and every listed test (incl. renaming `test_deleted_article_is_not_counted_as_not_retrieved` → `…_as_not_found`). Run `cd "$WT/backend" && uv run pytest tests/unit/test_prisma_*.py tests/integration/test_prisma_counts.py -q && cd "$WT" && npm run generate:api-types && npm run typecheck && npm run test:run -- frontend/components/prisma` and `check_copy_keys.py` → PASS / exit 0.

```bash
git -C "$WT" add backend frontend/types/api frontend/components/prisma frontend/lib/copy/screening.ts
git -C "$WT" commit -m "refactor(prisma): rename not_retrieved to records_not_found" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Write the failing tests**
  - `test_prisma_screening_box.py`: rewrite `:54` as `test_prisma_payload_has_one_in_progress_flag_and_no_pending_or_conflict_count` (exact field set; `full_text_in_progress` the only flag; no field named `*pending*`/`*conflict*`); `test_reports_box_arithmetic` — FT states: 2 include, 1 exclude "Wrong outcome", 1 `not_retrieved`, 1 pending, 1 conflict → `not_retrieved 1, assessed 3, excluded_by_reason {"Wrong outcome": 1}, included 2, without_outcome 2`.
  - `test_prisma_counts.py`: `test_reports_box_adds_up_while_in_progress` (TA: 4 include/maybe outcomes, 3 sent; FT: 1 decided include, 1 `not_retrieved`, 1 pending → `full_text_in_progress is True`, `sought_for_retrieval == 1 + 1 + 1 + 1`); `test_reports_box_adds_up_when_done` (all sent and decided → flag False, `sought == not_retrieved + assessed`); `test_flag_true_while_unsent_include_exists` (every FT record decided, one TA include unsent → True); `test_full_text_off_payload` (`reports_*` and flag `None`; `ta_included`/`ta_maybe` set); `test_title_abstract_box_ignores_full_text_rows` (same TA box before and after FT decisions).
  - `test_prisma_endpoint_unit.py`: the handler returns the new fields (patched service).

Run: `cd "$WT/backend" && uv run pytest tests/unit/test_prisma_*.py tests/integration/test_prisma_counts.py -q`
Expected: FAIL — unknown fields.

- [ ] **Step 3: Implement** per Interfaces and Rules.

- [ ] **Step 4: Run to verify it passes**, regenerate, `npm run typecheck` (the panel ignores the new fields until Task 10), `make -C "$WT" lint-backend`, vulture. Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git -C "$WT" add backend frontend/types/api
git -C "$WT" commit -m "feat(prisma): the full-text reports box and title/abstract include and maybe counts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Vocabulary, keymap, decision buttons, error map (frontend, S3b-2)

**Depends on:** Tasks 2, 6 (types).

**Files:**
- Modify: `frontend/lib/screening/records.ts`, `records.test.ts` (S1's)
- Modify: `frontend/lib/screening/keymap.ts`, `keymap.test.ts`
- Modify: `frontend/components/screening/DecisionButtons.tsx`, `__tests__/DecisionButtons.test.tsx`
- Modify: `frontend/lib/screening/errors.ts`, its test (`errors.test.ts`; create if absent)
- Modify: `frontend/components/screening/RecordStatusChip.tsx` (`RECORD_STATUS_LABEL.not_retrieved`)
- Modify: `frontend/lib/copy/screening.ts`

**Interfaces — Produces:**

```ts
// records.ts
export function statusViewsFor(phase: ScreeningPhase): readonly StatusView[];
//   TA = S1's STATUS_VIEWS; FT = all, to_screen, waiting, in_review, conflict, included, excluded, not_retrieved
//   (STATUS_VIEWS is replaced by this; its S1 consumers switch)
export type RecordFilterId = /* S1's */ | 'pdf';           // values 'attached' | 'missing' (FT only)
//   sortRecords status order gains not_retrieved after excluded; progress().decided counts not_retrieved;
export function myDecisionValuesFor(phase: ScreeningPhase): readonly string[]; // TA include/exclude/maybe/none; FT include/exclude/not_retrieved/none
export const EXCLUDED_REPORT_CSV_COLUMNS = ['title','first_author','publication_year','journal_title','pmid','doi','outcome_exclusion_reason'] as const;
export function excludedReportsCsv(rows: ScreeningRecordRow[]): string; // status 'excluded' only; built on S1's CSV writer (`recordsToCsv`'s quoting + its CSV-injection guard, Task 6 of S1) — no second writer
// RECORD_CSV_COLUMNS: the 20 wire fields

// keymap.ts
export function screeningKeyAction(event: KeyEventLike, armed: boolean, phase: ScreeningPhase): ScreeningKeyAction;
//   FT: 1 include; 2 or E arm the reason list; 3 → null; armed: 1–9 pick a reason. No key for not_retrieved.

// DecisionButtons.tsx — phase widened to ScreeningPhase.
//   FT: no Maybe button; Exclude (and 2/E) opens the reasons dialog, a reason is required;
//   a ghost "Report not retrieved" button (no key, no shortcut hint) → onDecide({decision: 'not_retrieved'});
//   an optional note field (rationale) passed with every FT decision.
```

`CODE_TO_KEY` gains `SCREENING_PHASE_ADVANCED` → `errorPhaseAdvanced` "This article is already in full-text screening.", `SCREENING_DECISION_NOT_IN_PHASE` → `errorDecisionNotInPhase` "That decision is not available in this phase.", `SCREENING_REASON_REQUIRED` → `errorReasonRequired` "Pick an exclusion reason." Copy: `statusNotRetrieved` "Not retrieved", `reportNotRetrieved` "Report not retrieved", `decisionNoteLabel` "Note (optional)", `filterPdf` "PDF", `pdfAttached` "Attached", `pdfMissing` "Missing", `exportExcludedReports` "Export excluded reports".

- [ ] **Step 1: Write the failing tests**
  - `records.test.ts`: `statusViewsFor` both phases (FT has `not_retrieved`, no `maybe`/`not_enrolled`; TA unchanged); `filters by PDF attached and missing`; `sorts not_retrieved after excluded`; `counts not_retrieved as decided`; `excludedReportsCsv has one row per excluded report with its reason` (3 rows: excluded "Wrong outcome", included, not_retrieved → header + 1 line ending `,Wrong outcome`); `RECORD_CSV_COLUMNS has the 20 wire fields`; `my decision filter values follow the phase` (FT: include, exclude, not_retrieved, none; TA: include, exclude, maybe, none — exported `myDecisionValuesFor(phase)`).
  - `RecordStatusChip` (S1's list suite or a new `RecordStatusChip.test.tsx`): `labels not_retrieved "Not retrieved"`.
  - `keymap.test.ts`: FT `1` → include; `2` → arm; `e` → arm; `3` → null; armed `2` → reason index 1; TA cases unchanged.
  - `DecisionButtons.test.tsx`: `full text has no Maybe`; `full text Exclude opens the reasons and needs one` (clicking a reason posts `{decision:'exclude', exclusion_reason:…}`); `Report not retrieved posts not_retrieved`; `the note rides along` (type a note, include → `rationale` trimmed); `3 does nothing at full text`.
  - `errors.test.ts`: the three new codes map to their copy.

Run: `npm run test:run -- frontend/lib/screening frontend/components/screening/__tests__/DecisionButtons.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement** per Interfaces; switch S1's `STATUS_VIEWS` consumers to `statusViewsFor(phase)` (the list gets `phase` from its props in Task 9; until then pass `'title_abstract'`).

- [ ] **Step 3: Run to verify it passes**, then `npm run test:run -- frontend/components/screening frontend/lib && npm run typecheck && npx eslint <touched files>` and `check_copy_keys.py`
Expected: PASS, exit 0.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/lib/screening frontend/components/screening frontend/lib/copy/screening.ts
git -C "$WT" commit -m "feat(screening): full-text vocabulary, keymap and decision buttons" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Full-text panel (frontend, S3b-3)

**Depends on:** Task 7.

**Files:**
- Create: `frontend/components/screening/FullTextRecordView.tsx`, `frontend/components/screening/FullTextDecisionPane.tsx`
- Modify: `frontend/components/screening/ScreeningRecordPanel.tsx` (+ `phase`, `maximized`), `AssignmentView.tsx` (solo rule by phase; FT decidable body → `FullTextRecordView`; not-retrieved ruling branch)
- Modify: `frontend/lib/copy/screening.ts`
- Create: `frontend/components/screening/__tests__/FullTextRecordView.test.tsx`; Modify: `__tests__/ScreeningRecordPanel.test.tsx`

**Interfaces — Consumes:** `RunSplitShell` (`nested`, `pdfState`, `viewerStore`), `RunPdfContent({articleId, projectId, store})`, `usePdfPanel`, `createViewerStore` (`@prumo/pdf-viewer`), `useIsBelowDesktop`, `ArticleDocumentsBody`, `ArticleViewButton` (Task 2), `DecisionButtons` FT mode (Task 7), `ConflictRulingForm` (S1).

**Produces:**

```ts
// ScreeningRecordPanel props gain
phase: ScreeningPhase;
maximized: boolean;          // the workspace's controlled shell state

// FullTextRecordView.tsx
export function FullTextRecordView(props: {
  projectId: string;
  row: ScreeningRecordRow;           // has_pdf, ta_* fields
  read: ScreeningAssignmentRead;     // article for the Abstract view
  maximized: boolean;
  readOnly: boolean;                 // isReadOnly(config): no attach
  decisionPane: ReactNode;           // FullTextDecisionPane, or the read-only details
}): JSX.Element;

// FullTextDecisionPane.tsx
export function FullTextDecisionPane(props: {
  row: ScreeningRecordRow; reasons: string[]; busy: boolean;
  recorded?: ScreeningDecisionCreate['decision'] | null;
  onDecide: (body: ScreeningDecisionCreate) => void;
}): JSX.Element;
```

Layout (§7.3):
- Provenance line from `ta_*`: "Included at title/abstract · {{n}} reviewers, {{kind}}" (`taProvenance`; kind label: solo → "one reviewer" variant `taProvenanceSolo` "Included at title/abstract · 1 reviewer"; consensus → "consensus"; arbitrated → "arbitrated"; outcome maybe → "Maybe at title/abstract …").
- **Hooks, unconditional, at the top of `FullTextRecordView`**: `const belowDesktop = useIsBelowDesktop()`; `const pdf = usePdfPanel({initialOpen: true, compact: belowDesktop})` (always open: the PDF pane shows either the PDF or the missing-PDF body, so a PDF attached while maximized appears without reopening anything); the viewer store from `createViewerStore()` kept in state and recreated when `row.article_id` changes (previous-value-in-state pattern). No hook sits inside a layout branch.
- **Docked**: a strip `Abstract | PDF` of `ArticleViewButton`s (labels `viewAbstract`, `viewPdf`); default PDF when `row.has_pdf`, else Abstract. PDF view → `ArticleDocumentsBody` (`mainOnly`, `canAttach = !readOnly`) whose children render `RunPdfContent({articleId, projectId, store})`. Missing PDF → the extracted empty state with attach, plus the decision pane still active with a "No PDF attached" line (`noPdfAttached`).
- **Maximized** (and not below `lg`): `RunSplitShell nested pdfState={pdf} viewerStore={store} formPanel={decision pane + abstract} pdfPanel={<ArticleDocumentsBody mainOnly …>{() => <RunPdfContent … />}</ArticleDocumentsBody>}`.
- **Below `lg`**: never `RunSplitShell` (maximized or not); the strip shows and the PDF view renders the same `ArticleDocumentsBody` + `RunPdfContent` with `pdf` (compact) and the store — not `useRunReader`.
- Status branches (S1's `AssignmentView` order, phase-aware): `awaiting_me` → FT decision pane; solo re-decide when the phase's count is 1 (`config.reviewer_count` at TA, `config.full_text_reviewer_count` at FT); `conflict` → `ConflictRulingForm` (FT reasons); decided with outcome `not_retrieved` and the caller an unseated arbitrator (`config.can_arbitrate && !read.my_decision`) → read-only body + `ConflictRulingForm` (header copy `pdfFoundLater` "PDF found later? Rule on this report."); everyone else → read-only.

Copy: `viewAbstract` "Abstract", `viewPdf` "PDF", `noPdfAttached` "No PDF attached", `taProvenance` "Included at title/abstract · {{n}} reviewers, {{kind}}", `taProvenanceSolo` "Included at title/abstract · 1 reviewer", `taProvenanceMaybe` "Maybe at title/abstract · {{n}} reviewers, {{kind}}", `taKindConsensus` "consensus", `taKindArbitrated` "arbitrated", `pdfFoundLater` (above).

- [ ] **Step 1: Write the failing tests** (`FullTextRecordView.test.tsx`; mock `RunPdfContent` as a stub `data-testid="pdf"` — it pulls pdfjs; MSW for files, assignment, decisions)
  - `defaults to PDF when a file exists`; `defaults to Abstract without one`; `switches between Abstract and PDF`.
  - `shows the missing-PDF state with Attach and keeps deciding allowed` ("No PDF attached" line, Include posts); `hides Attach for a viewer`.
  - `attaching a PDF refreshes the row and the panel` (docked; `vi.mock('@/services/articlesService')` so `uploadArticleFile` resolves ok, drive the real dialog; after the files refetch returns a MAIN file and the rerendered row has `has_pdf: true`, the PDF view renders the `pdf` stub); `attaching while maximized shows the PDF in the split` (same, maximized: the split's PDF pane changes from the missing-PDF body to the `pdf` stub with no click on any PDF toggle).
  - `renders RunSplitShell nested when maximized` (`[data-testid="assessment-shell-form"]` present; firing `⇧⌘\` with `code: 'Backslash'` inside does not expand the inner PDF).
  - `opens the reader below lg without RunSplitShell` (`matchMedia` narrow; PDF view shows `pdf` stub, no `assessment-shell-form`).
  - `shows the TA provenance line` (consensus 2 → "Included at title/abstract · 2 reviewers, consensus"; solo; maybe arbitrated).
  - `ScreeningRecordPanel.test.tsx`: `not retrieved: an unseated arbitrator gets the ruling form`; `not retrieved: a reviewer sees it read-only`; `full text solo re-decide uses the full-text count` (TA rc 2, FT rc 1 → recorded ring at FT); `maps SCREENING_REASON_REQUIRED to its toast`.

Run: `npm run test:run -- frontend/components/screening/__tests__/FullTextRecordView.test.tsx frontend/components/screening/__tests__/ScreeningRecordPanel.test.tsx`
Expected: FAIL — unresolved imports.

- [ ] **Step 2: Implement** per Interfaces and Layout (each file ≤ 300 lines).

- [ ] **Step 3: Run to verify it passes**, then `npm run test:run -- frontend/components/screening && npm run typecheck && npx eslint frontend/components/screening` and `check_copy_keys.py`, `check_button_scale.py`
Expected: PASS, exit 0.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/components/screening frontend/lib/copy/screening.ts
git -C "$WT" commit -m "feat(screening): full-text panel with the PDF beside the decision" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Full-text workspace, switcher, Send to full text (frontend, S3b-4)

**Depends on:** Task 8.

**Files:**
- Rename: `frontend/components/screening/TitleAbstractWorkspace.tsx` → `ScreeningWorkspace.tsx` (`git mv`), its test → `__tests__/ScreeningWorkspace.test.tsx`; Create: `__tests__/FullTextWorkspace.test.tsx`
- Modify: `ScreeningRecordList.tsx`, `ScreeningRecordTable.tsx`, `ScreeningToolbarActions.tsx` (`SendToFullTextButton`, `ExportExcludedReportsButton`), `ScreeningTab.tsx` (routes `full_text`), `frontend/components/layout/sectionViews.ts`, `frontend/components/navigation/SectionViewSwitcher.test.tsx`
- Modify: `frontend/hooks/screening/useScreeningConfig.ts` (`useEnrollArticles` accepts `{phase}`), `frontend/services/screeningService.ts` (`enrollArticles` body type follows the schema)
- Modify: `frontend/lib/copy/screening.ts`, `__tests__/ScreeningRecordList.test.tsx`, `__tests__/ScreeningTab.test.tsx`

**Interfaces — Produces:**

```ts
export function ScreeningWorkspace({projectId, config, phase}: {projectId: string; config: ScreeningConfigRead; phase: ScreeningPhase}): JSX.Element;
// ScreeningRecordListProps gain: phase: ScreeningPhase; maximized: boolean; fullTextReady?: number; onOpenFullText?: () => void
export function SendToFullTextButton({projectId, config}: {projectId: string; config: ScreeningConfigRead}): JSX.Element;
export function ExportExcludedReportsButton({rows}: {rows: ScreeningRecordRow[]}): JSX.Element;
// sectionViews.screening: title_abstract, full_text ("Full text"), settings (managerOnly)
```

Rules:
- `ScreeningTab`: `screeningTab=full_text` → `full_text_reviewer_count === null` → toolbar row + `Notice` "Full-text screening is off" (`ftOffTitle`) with "Open Settings" for a manager (`ftOffManager` "Turn it on in Settings.") or `ftOffMember` "A manager turns it on in Settings."; else `ScreeningWorkspace phase="full_text"`. TA unconfigured behaves as S1 (gate on the config read).
- FT workspace: records `useScreeningRecords(projectId, 'full_text', enabled)`; `config.full_text_enrolled === 0` → "No records in full text yet" (`ftEmptyTitle`) + `SendToFullTextButton` (manager) or `ftEmptyMember` "A manager sends records to full text."; a 403 → `ErrorState`. Toolbar: `SendToFullTextButton` (manager), `ExportExcludedReportsButton` (every member incl. viewer — read-only export), "Start screening" (same rule as TA). No PubMed import and no Enroll at FT.
- `?status=` not in `statusViewsFor(phase)` (the switcher keeps every param when it changes sub-view) → replaced with the role default (`defaultStatusView`), `replace: true`.
- List at FT: status views `statusViewsFor('full_text')`; PDF column (Attached/Missing) and PDF filter (FT only); Reason column on by default (toggle stays); Mine column uses FT `my_decision`. List shortcuts (`⌘F`, `f`) `enabled: !maximized` (Ruling 30).
- TA progress strip: append " · {{k}} to full text →" (`progressToFullText`, a link button) when `config.full_text_reviewer_count !== null && config.full_text_ready > 0`; it sets `screeningTab=full_text` and deletes `status`, `article` (replace: false — it is navigation).
- `SendToFullTextButton` "Send {{n}} to full text" (`sendToFullText`), N = `config.full_text_ready`; disabled + tooltip when FT off (`sendDisabledOff` "Full-text screening is off"), no reasons (`config.exclusion_reasons.length === 0` → `sendDisabledReasons` "Add exclusion reasons to the protocol first"), N = 0 (`sendDisabledNone` "No records are ready for full text"); in flight busy + disabled; success `toast(sentToFullText.replace('{{n}}', enrolled))` "Sent {{n}} to full text"; error → `toast.error(screeningErrorMessage(e))` and the hook's `onSettled` invalidates `screeningKeys.project`.

- [ ] **Step 1: Write the failing tests**
  - `SectionViewSwitcher.test.tsx`: `renders Title/abstract, Full text and Settings for a screening manager`.
  - `ScreeningTab.test.tsx`: `shows "Full-text screening is off" with Open Settings to a manager` / member copy; no records request is sent then.
  - `FullTextWorkspace.test.tsx` (MSW): `shows skeleton rows`, `shows an error with retry`, `shows the 403 error state`; `shows "No records in full text yet" with Send for a manager` / member copy; `lists Not retrieved and hides Maybe and Not enrolled views`; `shows the PDF column and filters missing PDFs`; `shows the Reason column by default`; `Start screening at full text`; `list shortcuts are off while maximized` (maximize, ⌘F → list search not focused); `outer ⇧⌘\ and Escape win over the nested PDF split, one step per press` (real `ListDetailSplitShell` + real `RunSplitShell`, only `RunPdfContent` stubbed; open an FT record with a PDF, "Start screening" → `[data-maximized="true"]` and `assessment-shell-form` present; `keyDown(window, {key:'|', code:'Backslash', metaKey:true, shiftKey:true})` → not maximized, `assessment-shell-form` gone, panel still open; maximize again with the chord; Escape → not maximized, panel open; Escape → panel closed; `?article=` still set; Escape → `?article=` cleared — each press one step); `falls back to the role default for a status the phase lacks` (`?screeningTab=full_text&status=maybe` and `…&status=not_enrolled` → the param is replaced with the role default, e.g. `to_screen` for a reviewer); `Export excluded reports downloads one row per excluded report`; `Send to full text` — `disabled with its tooltip when full text is off`, `… when the protocol has no reasons`, `… when nothing is ready`; `busy while sending`; `toasts "Sent 3 to full text"` (body `{phase:'full_text'}`, no `article_ids`); `toasts the enrolled count when a concurrent send got there first` (response `{enrolled: 1, already_enrolled: 2}` → "Sent 1 to full text"); `toasts a refused send and refetches the config` (409 `SCREENING_REASON_REQUIRED` → mapped toast; `invalidateQueries` called with the project key).
  - `ScreeningRecordList.test.tsx`: rewrite S1's "no full-text segment" as `shows "K to full text →" only when full text is on and K > 0` (link click → `screeningTab=full_text`, no `status`/`article`).
  - `ScreeningWorkspace.test.tsx`: S1's suite unchanged under the new name.

Run: `npm run test:run -- frontend/components/navigation frontend/components/screening`
Expected: FAIL on the new cases.

- [ ] **Step 2: Implement** per Interfaces and Rules (rename first, then edit).

- [ ] **Step 3: Run to verify it passes, then the static set** — `npm run test:run -- frontend/components frontend/hooks frontend/lib frontend/test && npm run typecheck && npm run lint && npm run deadcode && npm run deadcode:production`, from `$WT/backend`: `check_copy_keys.py`, `check_react_query_keys.py`, `check_frontend_data_path.py`, `check_file_size.py`, `check_button_scale.py`
Expected: all exit 0; knip zero both modes.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add -A frontend
git -C "$WT" commit -m "feat(screening): full-text sub-view with Send to full text and the PDF column" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Settings (full text) and the PRISMA panel (frontend, S3b-5)

**Depends on:** Task 9.

**Files:**
- Modify: `frontend/components/screening/ScreeningSettings.tsx`, `__tests__/ScreeningSettings.test.tsx`
- Modify: `frontend/hooks/screening/useScreeningConfig.ts` (`useSetScreeningConfig` body = `ScreeningConfigUpdate`)
- Modify: `frontend/components/prisma/PrismaCountsPanel.tsx` and its test
- Modify: `frontend/lib/copy/screening.ts`

Rules:
- Settings group "Phases" (top): radio "Title/abstract only" (`phaseTaOnly`) / "Title/abstract, then full text" (`phaseTaThenFt`); choosing the second shows "Reviewers per article — full text" (`settingsFtReviewersTitle`, 1–3, options above `reviewer_capable` disabled as for TA, default 2 capped at `reviewer_capable`). Save sends `{reviewer_count, full_text_reviewer_count: <n> | null}`. `full_text_count_locked` → the Phases radio and the FT count are disabled with `FieldHint` "Locked once a record was sent to full text" (`settingsFtLocked`). The TA group is renamed nothing (S1 copy). 409 `SCREENING_CONFIG_FROZEN` / `SCREENING_TOO_FEW_REVIEWERS` → mapped toast + project-key invalidation (S1 path).
- PRISMA panel: rows for `ta_included`, then the reports box when `reports_assessed !== null`: "Reports sought for retrieval" (= `sought_for_retrieval`), "Reports not retrieved", "Reports assessed for eligibility", "Reports excluded" with `reports_excluded_by_reason`, last box "Reports included"; while `full_text_in_progress` the reports box shows "In progress" (`prismaInProgress`) instead of its numbers. FT off (`reports_assessed === null`): no reports box; last box "Records included at title/abstract" (= `ta_included`) and "Maybe (not assessed)" (= `ta_maybe`). Method line (`useScreeningConfig`, omitted while it loads or errors): "{{ta}} independent reviewers at title/abstract, {{ft}} at full text; conflicts resolved by an arbitrator" (`prismaMethodBoth`), or "… at title/abstract; conflicts resolved by an arbitrator" (`prismaMethodTa`), singular `reviewer` when 1 (`prismaMethodOne…` variants — choose keys so no count is spelled out by string concatenation).

- [ ] **Step 1: Write the failing tests**
  - `ScreeningSettings.test.tsx`: `turns full text on with a reviewer count` (PUT body `{reviewer_count: 2, full_text_reviewer_count: 2}`); `turns full text off` (body `full_text_reviewer_count: null`); `locks the phase radio once a report was sent` (both controls disabled, hint shown); `toasts SCREENING_TOO_FEW_REVIEWERS for the full-text count`; `disables full-text options above the capable reviewers`.
  - `PrismaCountsPanel.test.tsx`: `shows "In progress" for the reports box while full text is in progress`; `labels the last box "Reports included"`; `shows the method line from the config` (and omits it while the config loads); `full text off: "Records included at title/abstract" and "Maybe (not assessed)", no reports box`.

Run: `npm run test:run -- frontend/components/screening/__tests__/ScreeningSettings.test.tsx frontend/components/prisma`
Expected: FAIL.

- [ ] **Step 2: Implement** per Rules.

- [ ] **Step 3: Run to verify it passes**, then `npm run test:run -- frontend/components && npm run typecheck && npx eslint <touched files> && npm run deadcode && npm run deadcode:production` and `check_copy_keys.py`, `check_button_scale.py`
Expected: PASS, exit 0.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/components/screening frontend/components/prisma frontend/hooks/screening frontend/lib/copy/screening.ts
git -C "$WT" commit -m "feat(screening): full-text settings and the PRISMA reports box" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: E2E full-text step and fixtures (S3b-6)

**Depends on:** Task 10.

**Files:**
- Modify: `frontend/e2e/_fixtures/article-pdf.ts` (`fixtureArticlePdfKey(articleId)`, `ensureArticlePdfBytes(articleId)`; update existing callers), `frontend/e2e/_fixtures/fixture-ids.ts` (`SCREENING_ARTICLES` + "Gamma"), `frontend/e2e/_fixtures/ensure-fixtures.ts` (provision Gamma), `frontend/e2e/_fixtures/screening.ts` (`resetScreeningProject`: settings reset as today, `eligibility_criteria = {inclusion: ["Adults"], exclusion: ["Wrong population", "Wrong outcome"]}`, re-insert a MAIN `article_files` row for Alpha with `adminInsert('article_files', …)` and `ensureArticlePdfBytes(alphaId)`)
- Modify: `frontend/e2e/flows/screening.ui.e2e.ts`

Flow addition (after S1's TA flow, adjusted for the third article: reviewers include Alpha and Gamma, Beta goes to conflict and is ruled excluded as today): owner opens Settings, picks "Title/abstract, then full text" with 1 full-text reviewer, saves; on Title/abstract the strip shows "2 to full text →"; owner opens Full text, clicks "Send 2 to full text", sees the toast; reviewer B opens Full text, "Start screening" opens Alpha maximized with the PDF (the viewer's first page canvas or text layer visible), presses `2`, picks "Wrong outcome", sees Gamma next with "No PDF attached", clicks "Report not retrieved"; owner's PRISMA shows "Reports not retrieved 1", "Reports excluded 1", "Reports included 0".

- [ ] **Step 1: Update the fixtures and the flow** per above.
- [ ] **Step 2: Typecheck and lint** — `npm run typecheck && npx eslint frontend/e2e` → exit 0.
- [ ] **Step 3: Run** (only if the local stack is up and this tree serves `:8080` — coordinate, it is shared): `npx playwright test frontend/e2e/flows/screening.ui.e2e.ts --project=local-ui` → passed. If the stack is down, say so in the report; CI's Frontend E2E runs it.
- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/e2e
git -C "$WT" commit -m "test(screening): end-to-end full-text step" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Slice verification and design review

**Depends on:** Tasks 1–11. **Files:** none modified; a fix goes back to the owning task's files with its own commit. Throwaway (never committed): `frontend/e2e/flows/__design_review_screening_ft.ui.e2e.ts`, screenshots in the session scratchpad.

- [ ] **Step 1: Full test runs** — `npm run test:run` and `make -C "$WT" test-backend` (against the port-55433 DB). Expected: frontend `0 failed`; backend `N passed`, no `FAILED`/`ERROR`.
- [ ] **Step 2: Every S3 gate** (S1 set + migration): `npm run typecheck`, `npm run lint`, `npm run deadcode`, `npm run deadcode:production`; vulture; from `$WT/backend` `check_copy_keys.py`, `check_react_query_keys.py`, `check_file_size.py`, `check_retired_symbols.py`, `check_scope_guards.py`, `check_button_scale.py`, `check_api_response_envelope.py`, `check_frontend_data_path.py`, `check_layered_arch.py`; `check_migration_split.sh`; `make -C "$WT" lint-backend`; `npm run generate:api-types && git -C "$WT" diff --exit-code frontend/types/api`; `cd "$WT/backend" && uv run alembic check` → "No new upgrade operations detected". Expected: all exit 0.
- [ ] **Step 3: Design review** (`/design-review`) of the Full text sub-view and FT panel: local stack, `make -C "$WT" db-seed-screening` with `--manager-email` = the E2E default user; Vite on port 5183; throwaway spec with `loginViaUi(page)` → seed project `?tab=screening&screeningTab=full_text`, screenshots at 1280×800 and 390×844: FT list (All view, PDF column), a record docked with the PDF view, the same maximized (`RunSplitShell` nested), the missing-PDF record, the not-retrieved arbitrator view, Settings with full text on, PRISMA with the reports box. Fix P0/P1 in the owning files, re-capture; then `rm` the spec, confirm `git -C "$WT" status --short` clean.
- [ ] **Step 4: Branch state and PR notes** — `git -C "$WT" log --oneline origin/dev..HEAD`; the PR body records the migration number taken at merge, the design-review findings, whether the E2E ran locally, and Ruling 22 (file-delete invalidation) as a follow-up.
