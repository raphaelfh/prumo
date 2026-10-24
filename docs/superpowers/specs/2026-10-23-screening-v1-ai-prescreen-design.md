---
status: approved
last_reviewed: 2026-10-23
owner: '@raphaelfh'
---

# Screening v1: PubMed import, human review, then AI pre-screen — design

> **Status:** Approved, revision 3 (after two reviews on #1048) · Proposed by
> @fabianofilho, approved by @raphaelfh · Narrows
> [`2026-05-03-screening-and-imports-design.md`](2026-05-03-screening-and-imports-design.md)
> (Phase α) and pulls one piece of its Phase β (an AI suggestion per article)
> forward. This document is the complete v1 scope. The 05-03 design is
> background only: nothing in it applies to v1 unless this document names
> it, and §3 lists where v1 departs from it.

## 1. Why now, and the first real dataset

prumo has no screening stage: the sidebar shows `screening` and `prisma` as
`comingSoon` (`frontend/components/layout/sidebarConfig.ts:54`, `:57`).
Reviews screen elsewhere (Rayyan) and re-import the included set, which
breaks the audit trail the rest of prumo keeps.

The first review to run through v1 is a LABDAPS scoping of **MIMIC-IV AND
machine learning** (PubMed, exported 2026-10-21):

| Fact | Value |
| --- | --- |
| Records | 1,976 |
| With DOI / with PMID | 1,959 / 1,976 |
| Publication year | 2026: 791 · 2025: 674 · 2024: 265 · 2023: 144 · ≤2022: 101 · 2027: 1 |
| Columns in the PubMed CSV export | PMID, Title, Authors, Citation, First Author, Journal/Book, Publication Year, Create Date, PMCID, NIHMS ID, DOI |
| **Abstract in the export** | **no** |

The CSV export has no abstract. Screening on titles alone is weak for
humans and for a model, so **import fetches the record from PubMed by
PMID** (E-utilities `efetch`), which also brings MeSH terms, full author
names and publication types.

Success for v1 = this review goes from the PubMed CSV to a PRISMA-ready
title/abstract count inside prumo, with every AI suggestion traceable to the
exact text, criteria and engine it ran under, and with the AI's recall on
this dataset measurable from blind human decisions before anyone leans on it.

## 2. Scope

**Slice A, human only (PR 2):**

1. **Import** a PubMed result set by PMID (CSV upload or pasted PMIDs),
   through the existing canonical-identity import path, deduplicated exactly
   on PMID and normalized DOI.
2. **Title/abstract screening**, solo or dual (2–3 reviewers), unanimous
   consensus, the project's arbitrators for conflicts; reviewers are always
   blind to each other (§7).
3. **PRISMA counts** for the identification and screening boxes.

**Slice B, AI (PR 3):**

1. **AI pre-screen**: per article, a per-criterion verdict with a quote from
   the title/abstract, an overall suggestion and a confidence, or a recorded
   `no_abstract` / `failed` outcome. Always a proposal; a human records every
   decision.
2. **Calibration report**, computed on read from the decisions reviewers
   made with AI hidden, against the AI suggestions for the same records.
3. **AI-use statement** for the methods section, built from stored rows.

**Not in v1:** full-text phase and Unpaywall · fuzzy dedup (it lands with a
second import source) · notes · per-user shortcut preferences · smart filters
· `⌘K` palette entries · Scopus/WoS CSV · RIS through the new path (RIS stays
on its current path) · PDF import · `articles.screening_status` (lands with
extraction gating) · active learning and stop criteria · kappa · MCP tools
for screening · AI auto-exclusion of any kind · a display rule that rewrites
the model's suggestion · `NCBI_API_KEY` · term highlighting · a non-blind
mode · resuming a stalled AI run (cancel and start again) · detecting a
duplicate that a later Zotero or RIS import creates for a PubMed article.

**Anti-goals**

- An AI verdict that changes an outcome without a human decision.
- A suggestion whose input text, prompt, criteria or engine cannot be
  recovered.
- A reviewer able to read a peer's decision, or an AI suggestion while AI is
  hidden, by any path (API or PostgREST) before the assignment has an
  outcome. Arbitrators see the conflicting decisions they resolve.
- A second write path for articles, or an import that rewrites another
  source's provenance.
- Stored state that can be derived: outcomes, run status and PRISMA counts
  are read from rows.

## 3. Where v1 departs from the 05-03 design, and why

| 05-03 says | v1 does | Why |
| --- | --- | --- |
| Postgres enums in a Supabase migration (§4.1) | `text` + `CHECK` in Alembic | AGENTS.md: app schema is Alembic only; 0091–0093 use `CheckConstraint`. |
| `screening_criterion` table + `pico_summary` | **No criteria table.** Criteria come from the stored protocol: PICOTS slot `inclusion[]`/`exclusion[]` and `eligibility_criteria.inclusion[]`/`.exclusion[]` | ADR 0023 already renders these into every AI call (`project_ai_context.render_review_question`). Each run freezes the rendered text (§6.1), so a later protocol edit cannot change what a stored suggestion ran under. |
| `screening_phase_config` table | `projects.settings.screening` = `{reviewer_count, ai_visible}`, written through `ProjectRepository.update_settings_key` | Two flags; `projects.settings` already holds per-project controls (`llm_engine`, `managers_see_reviewers`) behind one row-locked writer. |
| `screening_decision.ai_suggestion_id → ai_suggestions(id)` | FK to `screening_ai_suggestions`, set by the server (slice B) | `ai_suggestions` was dropped (`archive/20260428_0019_drop_ai_suggestions.py`). |
| `ai_usage_log` table | `ai_usage_ledger` (0091) with `pass_kind = 'screen'` | One ledger for all model calls (#1022). |
| `screening_phase_config.arbitrator_id` | No column; arbitration uses `ensure_project_arbitrator` (`is_project_arbitrator`: manager or consensus role) | One definition of "arbitrator". |
| New `/imports/*` module, `ArticleImportService` | PubMed joins the Zotero path: `normalize_pubmed_record` → `CanonicalArticlePayload` → the canonical-identity upsert, one `article_sync_runs` row per import (`source = 'pubmed'`) | The create path and per-import counts already exist. |
| DOI + fuzzy dedup with a review panel, `rapidfuzz` | Exact PMID / normalized DOI only | 1,976/1,976 records carry a PMID and PubMed is the only source. Fuzzy matching lands with the second source, on `pg_trgm` (`idx_articles_trgm_title` exists). |
| `articles.screening_status` + triggers | Not in v1 | Nothing reads it before extraction gating; it duplicates the outcomes. |
| Member-read RLS policies | Backend-only tables (RLS on, `REVOKE ALL FROM anon, authenticated`) | Member-read would reopen the blind-review leak closed by `0025_reviewer_scoped_select_rls`. Every read goes through the API, which applies blind/reveal. |
| One decision row per reviewer, `version` bumps; a stored outcome | INSERT-only decisions and arbitrations; the current decision is the reviewer's latest row; the outcome is derived on read | Constitution §IX: human selections are append-only and switching never rewrites history. Deriving the outcome removes the supersede bookkeeping and the publish race (§7). |
| AI in Phase β | AI in v1, as its own slice after the human-only one | The first dataset has ~2,000 records; the ask is a pre-screen with human review. |
| PubMed query builder | PMID list | The user already has the export; `esearch` can feed the same path later. |

## 4. Import (slice A)

### 4.1 Flow

```
PubMed CSV / pasted PMIDs
  → browser: papaparse, keep the PMID column (≤ 10,000 PMIDs, ≤ 25 MB)
  → POST /api/v1/projects/{project_id}/imports/pubmed  {pmids[], dry_run?}
      dry_run: inline and DB-only (no NCBI call): counts PMIDs already in the
               project, new PMIDs and repeats inside the request; writes nothing
      otherwise: creates the article_sync_runs row, enqueues the import task in
                 app.worker.tasks.import_tasks (as the Zotero import does), and
                 returns the sync run id; the requester polls it through
                 GET /projects/{id}/imports/{sync_run_id}
      task: efetch in batches of 200, serially (≤ 3 req/s, NCBI's limit
            without a key), normalize_pubmed_record → CanonicalArticlePayload,
            then per batch, under the project's import lock, the
            canonical-identity lookup and upsert
```

- **Idempotent, also under concurrency.** Posting the same PMIDs twice
  updates the same articles and inserts nothing new. Each batch's
  lookup-and-upsert runs under `take_advisory_xact_lock(db, project_id,
  PUBMED_IMPORT_LOCK)`, so two overlapping imports serialize instead of both
  inserting the same PMID (`idx_articles_pmid` is not unique, and v1 adds no
  DDL to `articles`).
- One `article_sync_runs` row per non-dry-run call (`source = 'pubmed'`;
  the column is free text, no CHECK to widen), with its counts, and one
  `article_sync_events` row per received PMID: `status` in
  `inserted | updated | duplicate_in_request | not_found | failed`,
  `article_id` when resolved, `event_payload = {pmid}`. PRISMA reads these
  events (§8).
- One path for every size: the task is the only writer.
- Role: project membership, the same check the Zotero import makes (§13,
  decision 4).
- NCBI etiquette: every call sends `tool=prumo` and `email` from a new
  `NCBI_EMAIL` setting (§13, decision 1).

### 4.2 Normalization and identity

- `normalize_pubmed_record` in `services/article_source_normalization.py`
  next to `normalize_zotero_item`, reusing `normalize_doi` and
  `extract_year`. Fields: title, abstract (structured abstracts joined with
  their labels), authors (`Last, Initials`), journal, year/month/day,
  volume, issue, pages, doi, pmid, pmcid, mesh_terms, keywords,
  article_type (first publication type), language;
  `ingestion_source = 'pubmed'`; the raw efetch XML fragment goes to
  `source_payload`.
- `get_by_canonical_identity` gains `pmid` (today it matches
  `zotero_item_key`, `doi` and `url_landing`). Match order: pmid, doi
  (compared as `lower(doi)` against the normalized DOI), url_landing.
- **A match never rewrites another source's provenance.** Today
  `upsert_by_canonical_identity` sets every payload field on a match
  (`article_repository.py`: `for key, value in payload.items(): setattr(...)`).
  The PubMed path uses a fill-only update instead: on a match it writes only
  bibliographic fields that are NULL or blank after trim (abstract,
  mesh_terms, pmid, pmcid, keywords, article_type, language, volume, issue,
  pages) and never `ingestion_source`, `source_payload`, `source_lineage` or
  `zotero_*`. A Zotero article therefore stays in
  `get_zotero_project_articles`, and a RIS article stays counted as RIS
  (§8). The Zotero path keeps its current behaviour, so a later Zotero
  re-sync can rewrite an abstract PubMed filled; accepted for v1, whose
  first dataset is PubMed-only, and harmless to stored suggestions, which
  keep the text they were sent (§5).
- The NCBI client takes an injectable `httpx` transport, so tests use an
  `httpx.MockTransport` over `backend/tests/fixtures/pubmed/`.

## 5. Data model

Two migrations, one per slice: **`0094_screening_v1`** (slice A) and
**`0095_screening_ai`** (slice B). The head on `dev` is
`0093_batch_agent_origin`.

**Every screening table is backend-only**, like `0075`/`0076`/`0091`:
`ENABLE ROW LEVEL SECURITY` and `REVOKE ALL ... FROM anon, authenticated`.
The API is the only reader and applies blind/reveal in the service read
path. `text` + `CHECK` for kinds. `0094` also runs
`REVOKE INSERT, UPDATE, DELETE ON article_sync_runs, article_sync_events
FROM anon, authenticated` (as `0057`/`0077` did for other tables; its
downgrade re-grants them to `authenticated` only): PRISMA counts come from
those rows, nothing in the frontend writes them, and today any member could
insert or delete them through PostgREST.

```text
0094_screening_v1 (slice A)

screening_assignments        an article enrolled in screening
  id, project_id, article_id → articles ON DELETE CASCADE,
  phase ('title_abstract'), enrolled_at (server default now(), so every row
  of one enroll shares it), enrolled_by
  UNIQUE (project_id, article_id, phase)
  queue order: ORDER BY enrolled_at, md5(id::text)   (§6.3)

screening_decisions          INSERT-only; one row per revision
  id, assignment_id → screening_assignments ON DELETE CASCADE,
  reviewer_id, decision ('include'|'exclude'|'maybe'),
  exclusion_reason (one of the protocol's exclusion strings, snapshotted),
  rationale, created_at
  INDEX (assignment_id, reviewer_id, created_at DESC, id DESC)
  current decision = the reviewer's latest row by (created_at, id)

screening_arbitrations       INSERT-only; one row per ruling
  id, assignment_id → screening_assignments ON DELETE CASCADE,
  decision, exclusion_reason, selected_decision_id → screening_decisions
  (NULL when the arbitrator overrides), rationale, decided_by, created_at
  INDEX (assignment_id, created_at DESC, id DESC)
  current ruling = the latest row by (created_at, id)

0095_screening_ai (slice B)

screening_ai_runs            one per AI pre-screen request
  id, project_id, created_by, created_at, cancelled_at,
  engine jsonb NOT NULL   (pinned at start, server-written, §6.1)
  prompt jsonb NOT NULL   (prompt name and version, protocol_revision, the
                           rendered review question, the numbered criteria
                           [{n, kind, text}] and the system prompt; one
                           pydantic model validates it at the write site, as
                           PromptComposition does for extraction)
  assignment_ids uuid[] NOT NULL   (the selection, frozen at start)
  run key = (engine provider + model, prompt version, protocol_revision)

screening_ai_suggestions     INSERT-only; one per (run, assignment)
  id, run_id → screening_ai_runs, assignment_id → screening_assignments
  ON DELETE CASCADE,
  outcome ('ok'|'no_abstract'|'failed'),
  suggestion, criteria jsonb          (NOT NULL iff outcome = 'ok', CHECK)
  confidence, reason                  (NULL unless outcome = 'ok', CHECK)
  error_code                          (NOT NULL iff outcome = 'failed', CHECK)
  input_text (title + abstract exactly as sent; NULL for no_abstract),
  request_id, created_at
  UNIQUE (run_id, assignment_id)
  INDEX (assignment_id, created_at DESC, id DESC)
  current suggestion = the assignment's latest outcome = 'ok' row by
  (created_at, id)

screening_decisions          + ai_suggestion_id → screening_ai_suggestions,
                             + ai_visible_at_decision bool NOT NULL DEFAULT false
screening_arbitrations       + ai_suggestion_id, + ai_visible_at_decision (same)
ai_usage_ledger.pass_kind    CHECK widened with 'screen'; the downgrade
                             deletes 'screen' rows before restoring the CHECK
```

**What the reviewer saw is what is recorded.** The client sends the
`ai_suggestion_id` it displayed (NULL when the panel was hidden or empty).
The server accepts only NULL, or the assignment's current suggestion while
`ai_visible` is on, and sets `ai_visible_at_decision = (ai_suggestion_id IS
NOT NULL)`; the same rule holds for arbitrations. The column defaults to
false, so every slice-A decision counts as made with AI hidden, which is
true. `criteria[]` items are `{n, verdict ('met'|'not_met'|'unclear'),
quote, quote_verified}`, where `n` is the criterion's number in the run's
frozen `prompt`.

Token usage lives in the ledger only (`ai_usage_ledger`, `pass_kind =
'screen'`, `run_id` NULL because that FK points at `extraction_runs`). The
suggestion row keeps `request_id` = the value the ledger stores (the call's
last provider response id, from `usage.request_ids` or `failed_usage`), NULL
when the provider returned none.

**Nothing derivable is stored.** An assignment's state (awaiting me,
awaiting peer, in conflict, decided) and its outcome come from its current
decisions and ruling (§7). A run is active while `cancelled_at` is NULL and
some id in `assignment_ids` that still exists in `screening_assignments`
has no suggestion row in this run; its progress counts only assignments
that still exist. PRISMA counts come from rows (§8).

## 6. AI pre-screen (slice B)

### 6.1 One call per article

- **Engine pinned per run.** `POST .../ai-prescreen` pins the `LlmTarget`
  that `assert_engine_ready` returns for the starting manager: the project
  default, unless that manager has a personal engine, in which case
  `deviation` is recorded, as extraction does. It is written to
  `screening_ai_runs.engine`. Each task step reads that column and resolves
  credentials with `resolve_engine_credentials` as the run's `created_by`,
  as `extraction_tasks` does. No key is stored, and a run never mixes
  engines.
- Calls go through `metered(extract_structured, LedgerSink(...), ctx)` with
  a new prompt `screening_title_abstract`, registered in `llm/pass_kinds.py`
  as `'screen'`.
- Input: the rendered review question frozen in the run's `prompt`, the
  numbered criteria, title and abstract. Nothing else (no journal, no
  authors).
- Output (pydantic): per criterion `{n, verdict, quote}`, overall
  `{suggestion, confidence, reason}`.
- **Quote check:** `quote_verified` is true only when the quote is a
  whitespace-normalized substring of the title or abstract that was sent. An
  unverified quote shows a "verify manually" badge, as extraction does.
- **Display:** the UI shows the model's own suggestion, with the
  per-criterion verdicts and quotes and the "verify manually" badge. No rule
  rewrites it (§13, decision 2).
- **No abstract** → no model call, a row with `outcome = 'no_abstract'`.
  **Call failure** → a row with `outcome = 'failed'` and an `error_code`.
  "No information" is a recorded outcome, never a missing row.

### 6.2 Running a pre-screen

- **Start.** Under `take_advisory_xact_lock(db, project_id,
  SCREENING_AI_RUN_LOCK)`, the endpoint refuses with 409 if the project has
  an active run, runs the engine precheck and queue probe (as
  `ExtractionBatchService.start`), freezes the selection (the enrolled
  assignments without an `ok` suggestion under the same run key, so a new
  run retries earlier `failed` rows and a protocol edit makes every
  assignment eligible again), commits, then kicks the task.
- **Task.** One Celery task per run. Each step takes a per-run session
  advisory lock on a dedicated connection with a bounded wait, as
  `ExtractionBatchDispatcher._batch_lock` does; a step that does not get it
  exits without re-enqueueing. It picks the next chunk of `assignment_ids`
  that still exist and have no row in this run, writes one row each with
  `INSERT ... ON CONFLICT (run_id, assignment_id) DO NOTHING`, committing
  each row right after its call, and re-enqueues itself until none are left
  or the run is cancelled. Guarantee: at most one row per (run, assignment);
  a lost worker repeats at most its in-flight call.
- **Stall.** A run whose chain died stays active; the manager cancels it and
  starts again. The new selection skips assignments that already have an
  `ok` suggestion under the same key, so nothing is paid twice.
- The frontend reads the project's active or latest run and polls it only
  while it is active.

### 6.3 Calibration, computed on read

No gate and no calibration state. Instead:

- The queue serves assignments in `ORDER BY enrolled_at, md5(id::text)`:
  within one enrollment the order is stable and pseudo-random, so the first
  N records any reviewer screens are a random sample of that set; a later
  enrollment queues after it and cannot break the blind prefix.
- While `ai_visible` is false, reviewers decide without seeing suggestions;
  the server records `ai_visible_at_decision = false`.
- `GET /projects/{id}/screening/calibration` takes the **longest prefix of
  the queue order** in which every assignment has an outcome (§7) made with
  AI hidden: its current decisions, or for an arbitrated outcome its ruling,
  carry `ai_visible_at_decision = false`. Using the prefix, not every
  AI-hidden decision, keeps the sample random even though the API lets a
  reviewer decide out of queue order. For **each run key** (§5) it compares
  those outcomes with the key's `ok` suggestion per assignment (at most one:
  a run selects only assignments without one, and a project has one active
  run). Positive = include or maybe. It returns recall and specificity with
  95% Wilson intervals, the number of human includes they rest on, the
  prefix size per enrollment, the disagreements with both sides' reasons,
  and, outside the 2×2, the `no_abstract` and `failed` counts.
- The manager reads that report and then turns `ai_visible` on. prumo does
  not decide a threshold. A change of engine, prompt or protocol is a new
  run key, so there is nothing to reopen.

For scale: pooled LLM sensitivity in a 2025 meta-analysis was 0.812 (95% CI
0.617–0.920) with very high heterogeneity [3], and a 2025 review found the
best approaches near 95–97% recall, none consistently at the 99% its authors
consider necessary to replace a human [4]. A model change is reported to
shift recall [5]. With ~10 human includes in 150 records the interval is
wide, which is why the report always shows the count it rests on.

## 7. Human review (slice A)

- Queue: one article at a time, title + abstract, keys `1` include / `2`
  exclude / `3` maybe / `e` exclude with reason (reasons = the protocol's
  exclusion strings, numbered). The AI panel appears only when `ai_visible`
  is true (slice B).
- `GET .../queue` returns, in queue order with no sort parameter, up to 20
  assignments awaiting the caller: no current decision by the caller, no
  ruling, and fewer than `reviewer_count` distinct reviewers. Awaiting peer
  = the caller has decided and fewer than `reviewer_count` reviewers have. A
  reviewer changes an earlier decision from `GET /screening/assignments/{aid}`,
  not from the queue.
- **Outcome, derived on read** from the assignment's current decisions and
  ruling:
  - a ruling exists → the latest ruling (`arbitrated`). It stands: a
    reviewer's later decision is recorded but does not reopen it; only an
    arbitrator rules again (the arbitrator-only reopen of ADR 0017);
  - else `reviewer_count = 1` and a current decision exists → that decision
    (`solo`);
  - else all `reviewer_count` current decisions exist and have the same
    decision → `consensus` (a consensus exclude whose reasons differ counts
    under "reasons differ" in PRISMA, §8);
  - else all exist and disagree → in conflict, on the conflicts list;
  - else → pending.

  Changing a decision is a new row; the outcome follows from the rows, so
  there is nothing to supersede.
- **Writes are serialized per assignment.** The decision and arbitration
  routes open with `SELECT ... FOR NO KEY UPDATE` on the
  `screening_assignments` row before reading current decisions (it does not
  block the KEY SHARE an FK insert takes). Two reviewers deciding at the
  same moment therefore see each other's row, and the outcome is
  consistent. A new reviewer is refused with 409 once the assignment has
  `reviewer_count` distinct reviewers. An arbitration is accepted only when
  the derived state is in conflict or arbitrated (else 409); it sends the
  ids of the current decisions it ruled on and gets 409 if they changed;
  `selected_decision_id` must be one of them, bound through
  `screening_review_service.owned_decisions` (decision ids in their
  assignment).
- `reviewer_count` is frozen once the project has a decision: `PUT` of a
  different value answers 409. The decision route reads it under
  `SELECT ... FOR SHARE` on the `projects` row, so it serializes with the
  `PUT` (which `update_settings_key` row-locks).
- Blind, always: the read path returns other reviewers' current decisions
  only once the assignment has an outcome, and to arbitrators on conflicts
  (the reveal idea of ADR 0012, applied in the screening read service).

## 8. PRISMA counts (slice A)

Read-only, derived:

Counts cover enrolled articles only; import never enrolls (§9).

- **Identified**, per source:
  - PubMed: distinct PMIDs with a resolved `pubmed` event (`status` in
    `inserted | updated | duplicate_in_request`, `article_id` not NULL)
    whose article is enrolled;
  - other sources: enrolled articles whose source is not `pubmed`, grouped
    by `lower(coalesce(ingestion_source, 'manual'))`. A PubMed import never
    changes an existing article's source (§4.2).
- **Duplicates removed**: identified records minus distinct enrolled
  articles. Checks: a PubMed-only import of 1,976 gives 1,976 identified, 0
  duplicates, 1,976 screened; a PubMed record matching a RIS article gives 2
  identified, 1 duplicate, 1 screened; re-importing the same file changes
  nothing (PMIDs are distinct).
- **Records not retrieved from the source**: PMIDs none of whose `pubmed`
  events resolved, on their own line, never counted as duplicates.
- **Imported but not enrolled**: on its own line.
- **Screened / excluded / sought for retrieval**: derived outcomes at
  title/abstract (excluded with reason counts, plus "reasons differ" for a
  consensus exclude with different reasons; sought = include + maybe).

Shown on the `prisma` tab as numbers; the diagram is v2.

**AI-use statement (slice B).** The same tab renders a copyable methods
paragraph built only from stored rows: engine and model, prompt name and
version, dates of use, purpose (pre-screen suggestion, never applied without
a human decision), reviewers per record and how conflicts were resolved,
and the calibration figures with their intervals and counts. This is what
the Cochrane/Campbell/JBI/CEE position statement asks authors to report [1],
and what the proposed PRISMA-trAIce items on human oversight and performance
cover [2].

## 9. API and guards

All under `/api/v1`, `ApiResponse` envelope.

| Route | Role guard | Binding |
| --- | --- | --- |
| `POST /projects/{id}/imports/pubmed` | `ensure_project_member` (as the Zotero import) | project from path |
| `GET /projects/{id}/imports/{sid}` | `ensure_project_member` | requester-bound `ArticleSyncRunRepository.get_owned_run`, as the Zotero import's `get_owned_sync_run` |
| `GET /projects/{id}/screening/config` | `ensure_project_member` | project from path |
| `PUT /projects/{id}/screening/config` | `ensure_project_manager` | project from path; written through `update_settings_key` |
| `POST /projects/{id}/screening/enroll` | `ensure_project_manager` | body `{article_ids?}` through `article_read_service.owned_articles`; omitted = every project article not yet enrolled; idempotent (`ON CONFLICT DO NOTHING`); returns `{enrolled, already_enrolled}` |
| `GET /projects/{id}/screening/queue` | `ensure_project_reviewer` | project from path |
| `GET /screening/assignments/{aid}` | member of the assignment's project | new by-id guard `api/deps/scope.load_assignment_for_member` (resolves the row, then checks membership on its project, as `load_run_for_member`) |
| `POST /screening/assignments/{aid}/decisions` | `ensure_project_reviewer` on the assignment's project | `load_assignment_for_member`; `ai_suggestion_id` checked against the current suggestion, `ai_visible_at_decision` derived (§5) |
| `GET /projects/{id}/screening/conflicts` | `ensure_project_arbitrator` | project from path |
| `POST /screening/assignments/{aid}/arbitration` | `ensure_project_arbitrator` on the assignment's project | `load_assignment_for_member`; the ruled-on decision ids through `screening_review_service.owned_decisions` |
| `POST /projects/{id}/screening/ai-prescreen` | `ensure_project_manager`, then `assert_engine_ready` | assignment selection bound by project in the WHERE clause |
| `GET /projects/{id}/screening/ai-run` · `POST /projects/{id}/screening/ai-run/cancel` | member · manager | project from path; the active run, else the latest, with derived progress; cancel answers 409 when none is active |
| `GET /projects/{id}/screening/calibration` | `ensure_project_member` | project from path |
| `GET /projects/{id}/prisma` | `ensure_project_member` | project from path |

The two new guards (`load_assignment_for_member`, `owned_decisions`) are
added to `.claude/rules/backend.md` § Ownership guards in the PR that
introduces them, and slice A adds `assignment_id` to `SCOPE_COLUMNS` in
`scripts/fitness/check_scope_guards.py`.

## 10. Frontend

- `screening` and `prisma` tabs lose `comingSoon`.
- Screening tab states: not configured → configure (reviewers) ·
  nothing enrolled → "Import from PubMed" / "Enroll all" · queue · conflicts
  (arbitrators) · done. Slice B adds the AI panel, the "Run AI pre-screen"
  action, the calibration report and the `ai_visible` switch beside it.
- Import dialog: drop the PubMed CSV or paste PMIDs → dry-run counts →
  confirm → progress from the sync run. The articles list source filter
  gains a PubMed option (sources are compared case-insensitively: the
  backend writes `zotero` and `pubmed`, the manual form writes `MANUAL`).
- Copy in `frontend/lib/copy/screening.ts`; hooks under
  `frontend/hooks/screening/`; services in
  `frontend/services/screeningService.ts`; every read through the API.

## 11. Delivery as stacked PRs

1. `docs(specs)`: this document.
2. `feat(screening)`: slice A. Migration `0094`, PubMed import on the
   canonical path, enroll, queue, decisions, conflicts and arbitration, blind
   mode, PRISMA counts, the Screening and PRISMA tabs. Usable on its own as
   human-only screening.
3. `feat(screening)`: slice B. Migration `0095`, the `'screen'` pass kind,
   the prompt, the run task, the AI panel, the calibration report,
   `ai_visible`, the AI-use statement.

## 12. Tests

- **Unit**: PubMed XML → normalized record (fixtures from real efetch
  responses in `backend/tests/fixtures/pubmed/`); identity match order;
  fill-only update on a match (NULL and blank); quote verification; the
  outcome derivation table of §7; the PRISMA checks of §8; Wilson interval;
  the suggestion CHECKs in both directions.
- **Integration** (real local Supabase):
  - import: idempotency; `dry_run` writes nothing and calls no NCBI; two
    concurrent imports of overlapping PMIDs create no duplicate article; a
    PubMed match leaves a Zotero or RIS article's `ingestion_source` and
    `source_payload` unchanged; the sync run counts;
  - review: solo, dual and 3-reviewer outcomes; two reviewers deciding the
    same assignment concurrently still yield a consensus outcome; a reviewer
    beyond `reviewer_count` gets 409; an arbitration on stale decision ids,
    or on an assignment not in conflict, gets 409; a forged
    `selected_decision_id` from another assignment is refused; a reviewer
    change after a ruling leaves the ruling in force; a `reviewer_count`
    change after the first decision gets 409; blind masking in the read
    path; reviewer vs viewer on the decision route; enroll is idempotent;
  - RLS: `has_table_privilege` is false for `anon` and `authenticated` ×
    SELECT/INSERT/UPDATE/DELETE on every screening table, and INSERT/UPDATE/
    DELETE on `article_sync_runs` and `article_sync_events`; a PostgREST
    read of a screening table as `authenticated` fails with permission
    denied (as `test_ai_usage_ledger.py`);
  - PRISMA: `not_found` PMIDs are not duplicates; imported but not enrolled
    articles are not identified; a later enrollment does not shrink the
    calibration prefix;
  - slice B: a duplicated task writes and calls once per assignment; a second
    start while a run is active gets 409; deleting an enrolled article does
    not leave a finished run active; a decision with a suggestion id that is
    not current, or while `ai_visible` is off, is refused; `no_abstract` and
    `failed` rows; the pinned engine and prompt; ledger rows with
    `pass_kind = 'screen'`; the `0095` downgrade.
- **Frontend**: vitest for the queue hook (optimistic advance, rollback),
  the keyboard map and the import dialog counts. One Playwright flow that
  starts at enroll on seeded articles (no NCBI): decide, resolve a conflict,
  read the PRISMA counts.
- **Post-merge validation, not a merge gate**: the 1,976-record MIMIC-IV
  export through import, blind screening of a prefix of the queue, and the
  calibration report, with the numbers posted on the slice-B PR.

## 13. Decisions

Answered in the review of revision 1: fuzzy dedup waits for the second
source and will use `pg_trgm`; RIS stays on its current path.

Decided by the maintainer on 2026-10-23, after the review of revision 2:

1. **NCBI settings.** A new `NCBI_EMAIL` setting, sent with `tool=prumo` on
   every E-utilities call. No `NCBI_API_KEY` in v1: one serial import of
   ~2,000 PMIDs is ~10 `efetch` calls, well inside 3 req/s.
2. **Display rule.** Dropped. The UI shows the model's own suggestion with
   its per-criterion verdicts, quotes and the "verify manually" badge. The
   proposed recall-first rule never showed `include`, showed `exclude` for
   every record of a protocol without inclusion criteria, and would have
   lived twice (UI and calibration report). Calibration already measures the
   raw suggestion's recall before `ai_visible` is turned on.
3. **History shape.** One INSERT-only table per concept (decisions,
   arbitrations), with the current row read as the latest by
   `(created_at, id)` and the outcome derived (§7). This replaces both
   `superseded_by` with a partial unique index (which needed an UPDATE of
   the previous row and could not represent a reopened consensus) and a
   separate states table.
4. **Import role.** Project membership, the same check as the Zotero import.
   With PRISMA derived from resolved events and the sync tables closed to
   client writes, a manager-only import protects nothing the counts depend
   on.

## 14. References

Only sources whose text was opened are cited. RAISE (the Cochrane/Campbell/
JBI/CEE guidance on responsible AI in evidence synthesis) supports the same
validate-and-report principle but its documents were not read for this
design, so it is not cited for any specific claim.

1. Flemyng E, Noel-Storr A, Macura B, et al. Position statement on
   artificial intelligence (AI) use in evidence synthesis across Cochrane,
   the Campbell Collaboration, JBI and the Collaboration for Environmental
   Evidence 2025. *JBI Evid Synth* 2025;23(11):2162-2166.
   doi:10.11124/JBIES-25-00480 — human oversight; transparent reporting of
   tool, version, date and purpose; validate before relying on it.
2. Holst D, Moenck K, Koch J, Schmedemann O, Schüppstuhl T. PRISMA-trAIce
   checklist. *JMIR AI* 2025;4:e80247. doi:10.2196/80247 — a proposed (not
   PRISMA-endorsed) extension; items on human oversight, reference standard
   and AI–human performance.
3. Kim JK, Rickard M, Dangle P, et al. Evaluating large language models for
   title/abstract screening: a systematic review and meta-analysis. *J Med
   Artif Intell* 2025;8:34. doi:10.21037/jmai-24-408 — pooled sensitivity
   0.812 (0.617–0.920), false-positive rate 0.110, I² 91.6–99.7%.
4. Sandner E, Fontana L, Kothari K, et al. Evaluating LLMs for literature
   screening: a systematic review of sensitivity and workload reduction.
   *Proc. DATA* 2025:508-517. doi:10.5220/0013562900003967 — six approaches
   reached ≥95% sensitivity (max 97%), none consistently 99%; workload
   reduction 48–79%.
5. Fagerberg P, Sallander O, Vikhe Patil K, et al. Audited LLM triage for
   systematic review screening in national clinical guideline production.
   *medRxiv* 2026 (preprint, not peer reviewed).
   doi:10.64898/2026.06.02.26354724 — only unanimous AI exclusions across
   repeated runs enter the AI-excluded pool; prospective audit of excluded
   records; revalidate when the model changes.
