---
status: draft
last_reviewed: 2026-10-25
owner: '@raphaelfh'
---

# Server-driven project article list — design

> Issue #1054: a project with more than 1,000 articles shows only the newest
> 1,000 in the Articles tab, and the counter reads "1000 of 1000". The cause is
> one unpaged PostgREST read, but the bug is a class, not a line: the browser
> holds every article of a project and does search, filters, facets, sort,
> select-all, export and delete over that array. This spec moves the article
> list behind a typed, paged, server-side read so the tab works at the scale of
> large systematic reviews (tens of thousands of records), and deletes the
> client-side paths it replaces.

## 1. Intent

Systematic reviews routinely start from 5,000–50,000 records. The screening
work (#1053) imports up to 10,000 PMIDs per PubMed run, and the first real
project (LabMIMIC, 1,976 records) already crossed the cap. The Articles tab is
where a reviewer finds, checks, exports and removes records; it must show every
record, count them correctly, and stay fast at that scale.

**Success:** a 50,000-article project opens its Articles tab in about the time a
100-article project does today; the counter shows the real totals; search,
filters, sort, select-all, export and bulk delete cover every matching record;
and no `articles` / `article_files` table read or write in the Articles tab or
its side panel goes around the typed API (file **bytes** still go browser →
Storage directly; their registration already goes through the API).

## 2. Evidence (dev @ 01c4f83, 2026-10-24)

| Fact | Where |
| --- | --- |
| Articles tab reads the whole list in one `supabase.from('articles')` select, no `.range()`, no count | `frontend/services/projectsService.ts:106` (`loadProjectArticles`), called from `pages/ProjectView.tsx:154` |
| PostgREST caps a response at `max-rows` (1,000 hosted; `supabase/config.toml` sets none, so local is 1,000 too) | — |
| The same cap was already fixed for two other surfaces with a paging helper; the Articles tab was missed | `articlesService.ts:408` `selectAllProjectArticles` (worklist, QA/extraction dashboards, HITL table) |
| Open PR #1055 adds a **second**, independent paging loop for the tab (ordering `id` desc where the helper orders `id` asc) | PR #1055 |
| The PDF badge/filter sends **every** article id in one `.in('article_id', ids)` GET: ~37 bytes per UUID, ~73 KB of URL at 1,976 articles, and its response is capped at 1,000 rows too. Errors are swallowed ("best-effort") | `ArticlesList.tsx:291-308`, `articlesService.ts:305` |
| Search (title, abstract, authors, journal, keywords, MeSH, DOI, PMID, PMCID), 8 panel filters, 4 facets, 6 sort keys, select-all and export ids are all computed over the in-memory array | `ArticlesList.tsx:392-660` |
| The list select carries every JSONB column (`source_payload`, `sync_conflict_log`, `registration`, `funding`) and full abstracts for every row; `source_payload` holds the whole source record | `projectsService.ts:88`; `models/article.py:107-108,115,127` |
| The table renders every row (no virtualization); `@tanstack/react-virtual` is already a dependency | `ArticlesList.tsx:763`, `package.json` |
| The list is `useState` + manual reload callbacks, not TanStack Query | `ProjectView.tsx:27,151-162` |
| The direct read is grandfathered debt in the data-path ratchet (constitution §VI) | `scripts/fitness/check_frontend_data_path.baseline`: `projectsService.ts\|articles:1`, `articlesService.ts\|articles:6`, `articlesService.ts\|article_files:7` |
| **Delete loses PDFs for non-managers.** `deleteArticle` and `bulkDeleteArticles` remove storage objects first (policy: any project **member**), then delete rows with no `.select()` (RLS `articles_delete`: **manager** only). For a reviewer, the rows silently survive with `{error: null}`, the PDFs are gone, and the UI toasts success. The delete controls are not role-gated | `articlesService.ts:353-378,466-490`; `alembic/versions/0003_storage_object_policies.py:70`; baseline `articles_delete` policy |
| A keyset-paged article read already exists server-side, for MCP agents (`title, id` cursor; `query`, `has_pdf`, `has_text`) | `services/article_list_read_service.py:list_project_articles` |
| No `GET /api/v1/projects/{id}/articles` exists (#1054's "possible fix" points at a line that is the suggestions-history endpoint) | `api/v1/endpoints/articles.py` |

## 3. Goals, non-goals, anti-goals

**Goals**

1. One typed, paged, server-side read for a project's article list; the tab
   never holds more than the pages the user has scrolled through.
2. Real totals: the project's article count and the count matching the
   current search/filters, from the server.
3. Search, filters, facets and sort run in Postgres, with the same meaning
   they have today (parity, §6.3).
4. Select-all means "every article matching the current query", and export
   and bulk delete act on that set server-side, without shipping id lists
   through URLs.
5. Delete goes through a typed endpoint that refuses non-managers (403) before
   touching storage, and removes rows and files in an order that can never
   leave a live row without its file.
6. Every project-article list read in the browser (Articles tab, worklist,
   extraction and QA dashboards, HITL table) uses the typed API; the client
   paging helper, `loadProjectArticles`, `fetchArticleIdsWithMainFile` and the
   client delete paths are deleted, and the §VI baseline shrinks.
7. Measured performance at 50,000 articles (§8).
8. Article writes and detail reads leave PostgREST (§7.5, ruled 2026-10-25):
   RIS import becomes one server-side import, article create/update and the
   detail read become typed endpoints, and the `article_files` reads and
   single-file delete move to the API.

**Non-goals**

- Server-side paging for the extraction/QA dashboards, HITL table and
  worklist. They keep receiving the full (slim) list, now via the API. Once
  screening lands, those surfaces work on included records (typically tens to
  hundreds), so their scale is bounded by screening, not by imports.
- Relevance-ranked or full-text (stemmed) search. Search stays
  case-insensitive substring, as today.
- New filters, new columns, saved views, or filter state in the URL.
- Changing who may delete (managers, as RLS already says) or what a delete
  cascades to.
- The MCP `list_articles` tool keeps its own response shape and caps (§6.2
  says what is shared).

**Anti-goals** (failure even if it "works")

- A second paging loop or a raised `max-rows`: both only move the cliff.
- A second implementation of the article filter/selection predicate (one for
  the list, another for export/delete). The predicate that decides what the
  user sees is the one that decides what gets exported or deleted.
- Select-all that silently means "the loaded rows".
- Any surface that counts articles from an array length.

## 4. Approaches considered

| | Approach | Trade-off | Verdict |
| --- | --- | --- | --- |
| A | Keep the full list in the browser, hardened: one shared paging loader, slim projection, virtualized table, PDF flag in the row | Smallest change, instant client filtering. Load time and memory grow linearly; abstract search needs every abstract in memory (tens of MB at 20k); still a direct Supabase read (§VI); practical ceiling ~20k | Rejected: moves the cliff |
| **B** | **Server-driven list: typed keyset-paged endpoint with server search/filters/sort/counts, facets endpoint, filter-based selection for export/delete, `useInfiniteQuery` + virtualized table** | Larger (backend + frontend); each filter change is a round-trip (debounced) | **Chosen** (2026-10-24): no ceiling, one read path, one ownership predicate, fixes the whole class |
| C | Hybrid: browser downloads a slim index of all ids, fetches details per viewport | Two sources of truth for what the list contains — the exact drift §VI exists to prevent | Rejected |

PR #1055 is a stopgap for production (LabMIMIC). Recommendation on it is in
§10; this design deletes whatever loop it adds.

## 5. Architecture overview

```
ArticlesList (virtualized)          export / delete dialogs
   │ useArticleListQuery (infinite)    │ useBulkDeleteArticles / export mutation
   │ useArticleFacetQuery (lazy)       │
   ▼                                   ▼
articleListService (apiClient) ── typed requests, ErrorResult<T>
   │
   ▼
GET  /api/v1/projects/{id}/articles          (page + totals)
GET  /api/v1/projects/{id}/articles/facets   (one facet, optional prefix)
POST /api/v1/projects/{id}/articles/delete   (selection → delete)
POST /api/v1/articles-export                 (selection replaces article_ids)
   │  membership: is_project_member (404) / is_project_manager (403)
   ▼
article_list_service  ── ONE filter builder: ArticleListQuery → WHERE (project_id first)
   ├─ list page (keyset on (sort_key, id))      ├─ counts (total, matched)
   ├─ facets                                    └─ resolve_selection(selection) → ids
```

## 6. Backend

### 6.1 The query model (one schema, shared by every endpoint)

`ArticleListQuery` (Pydantic, published in OpenAPI):

| Field | Meaning (parity with `ArticlesList.tsx` today) |
| --- | --- |
| `q` | Case-insensitive substring over title, abstract, any author, journal, any keyword, any MeSH term, DOI, PMID, PMCID. Literal: `%`, `_`, `\` escaped (reuse `_escape_ilike` by moving it to a shared util) |
| `title`, `authors`, `journal` | Case-insensitive substring on that field (`authors`: any element) |
| `year_min`, `year_max` | Inclusive range on `publication_year`; an article with no year is excluded when either bound is set |
| `keywords[]` | Article has **any** of the given keywords, compared exactly after trimming each stored keyword (`ArticlesList.tsx:575-583`) |
| `has_pdf` | `true` / `false` / absent. "Has PDF" = an `article_files` row with `file_role = 'MAIN'` (today's meaning; not the MCP tool's "any `%pdf%` file") |
| `sources[]` | `coalesce(upper(ingestion_source), 'MANUAL')` in the set (today's fallback) |
| `sync_states[]` | `coalesce(sync_state, 'active')` in the set |
| `sort` | `title` \| `authors` \| `journal` \| `year` \| `has_pdf` \| `created_at`; default `year` |
| `direction` | `asc` \| `desc`; default `desc` |

The filter builder is a single function in a new `app/services/article_list_service.py`
that turns `(project_id, ArticleListQuery)` into a SQLAlchemy `WHERE`, with
`Article.project_id == project_id` always the first predicate. Every endpoint
in this spec calls it; nothing else builds an article-list predicate. If the
scope-guard gate needs to know about it, it is added to the enumerated guard
list in `.claude/rules/backend.md` in the same PR.

**Sort keys** reproduce today's client comparisons as SQL expressions, with
`Article.id` as the final tie-break in the same direction:

| `sort` | Key |
| --- | --- |
| `title` | `lower(coalesce(title, ''))` |
| `authors` | `lower(coalesce(array_to_string(authors, ', '), ''))` |
| `journal` | `lower(coalesce(journal_title, ''))` |
| `year` | `coalesce(publication_year, 0)` |
| `has_pdf` | the `EXISTS(MAIN file)` expression as int |
| `created_at` | `created_at` |

Coalescing to a non-null key is deliberate: it matches today's order and makes
the keyset tuple comparison valid without `NULLS LAST` special cases. The
same-direction `id` tie-break keeps the keyset predicate a single row-tuple
comparison `(sort_key, id) < (:k, :id)` (or `>`), which one composite index can
serve. *Design call:* this flips today's `created_at desc, id asc` within a run
of equal timestamps to `id desc` for every consumer (§7.4). Ids are random
UUIDs, so neither order means anything to a user; the pager tests that pin
`id asc` are updated, not worked around.

### 6.2 `GET /api/v1/projects/{project_id}/articles`

- Auth: `is_project_member` false → 404 (no existence oracle, as
  `project_details.py`).
- Params: `ArticleListQuery` fields as query params, `cursor`, `limit`
  (1–500, default 100).
- Keyset pagination on `(sort_key, id)` via `app/utils/opaque_cursor`. The
  cursor encodes `[sort, direction, sort_key_value, id]`; a cursor whose
  `sort`/`direction` differ from the request is a 422. No `OFFSET`: a
  concurrent import cannot shift or duplicate rows across pages.
- Response `ApiResponse[ArticleListPage]`:
  - `items: list[ArticleListRow]`
  - `next_cursor: str | None`
  - `total: int` — all articles in the project
  - `matched: int` — articles matching the query (equals `total` with no
    filters)
- `ArticleListRow`: every column the table can display today
  (`ARTICLES_DATA_COLUMN_DEFS` + the core columns), with three server-side
  caps: `abstract` cut to ~500 chars (`text_caps`, plus `abstract_truncated`),
  and `source_payload` / `sync_conflict_log` sent as **text previews**
  (`source_payload_preview`, `sync_conflict_log_preview`: compact JSON cut to
  the 80 chars the cell shows today, computed in SQL so the full document never
  leaves Postgres). `registration` and `funding` are small and go as-is.
  *Design call:* the list keeps every column it has today; no column loses its
  only UI.
- Shared with the MCP read: the escape util and, if it reads cleanly, the
  `has_pdf` expression. `list_project_articles` keeps its own shape and
  `(title, id)` order; it is not rewritten in this work.
- Counts run as two `count(*)` queries on the same builder (project-scoped;
  cheap at 50k), **only on the first page** (no `cursor`); later pages return
  `total`/`matched` as `null` and the client keeps the first page's values.
  Not cached.

### 6.3 `GET /api/v1/projects/{project_id}/articles/facets`

- Auth as 6.2. Params: `field` = `year` \| `journal` \| `authors` \|
  `keywords` \| `sources` \| `sync_states`; optional `prefix`
  (case-insensitive, for the typeahead in the keyword filter); `limit`
  (1–200, default 50).
- Returns `[{value, count}]` over the **whole project** (today's facets ignore
  the active filters; keep that). Order: `year` by value desc, others by count
  desc then value.
- Loaded lazily when the filter popover opens, one facet per request, cached
  per `(project, field, prefix)`.

### 6.4 Selection, export and delete

`ArticleSelection` (one schema):

```
{ "mode": "ids",    "ids": [uuid, ...] }                      # ≤ 10,000 ids (POST body)
{ "mode": "query",  "query": ArticleListQuery, "exclude_ids": [uuid, ...] }
```

`resolve_selection(db, project_id, selection) -> list[UUID]` lives in
`article_list_service`: `ids` mode goes through `owned_articles` (THE
article-in-project guard, unchanged); `query` mode runs the 6.1 builder
minus `exclude_ids`. It is the only way export and delete turn a selection
into ids.

**Export** — `ExportRequest.article_ids` is replaced by
`selection: ArticleSelection` (`project_id` stays in the body and is the
scope `resolve_selection` uses). The endpoint resolves it before its existing
logic (sync path ≤ 50 metadata-only articles, Celery path otherwise). The
frontend is the only caller; types are regenerated in the same PR. Export keeps
its current error contract (HTTP 200 envelopes: `FORBIDDEN` for a non-member,
`VALIDATION_ERROR` for an empty selection, pinned by
`test_articles_export_endpoint.py` and `test_membership_guards.py`); changing
it is out of scope. Export needs no drift guard: it is non-destructive and its
file lists what it exported.

**Delete** — new `POST /api/v1/projects/{project_id}/articles/delete`, body
`{selection: ArticleSelection, expected_count: int}`:

1. Non-member → 404; member who is not a manager → **403, before anything is
   touched**.
2. Resolve the selection. If the resolved count ≠ `expected_count` → **409**
   with the current count, nothing deleted. A `query` selection is evaluated
   when the request runs, so an import or edit after the user confirmed could
   otherwise delete rows they never saw. The client sends the count it showed
   in the confirm dialog (`matched − |exclude_ids|`, or `ids.length`); on 409
   the dialog shows the new count and asks again. Collect the
   `article_files.storage_key`s.
3. Delete the article rows in one transaction (existing FK cascades apply,
   unchanged), commit.
4. After commit, remove storage objects through the backend storage adapter,
   batched; failures are logged with the keys and do not fail the request.
   An orphan object is recoverable garbage; a live row whose PDF is gone is
   data loss — this order is the point.
5. Response: `{deleted: int, storage_failures: int}`.

The builder measures this at 5,000 and 20,000 articles with files (§8). If a
20,000-article delete misses the budget, the request becomes a Celery job on
an existing queue with the same contract plus a status read — the builder
decides with the measurement, and records it in the plan.

Single-article delete uses the same endpoint (`ids` mode, one id).

### 6.5 Performance and indexes

No index is added up front. The builder seeds a 50,000-article project
(realistic abstracts, ~10% with a MAIN file) and measures every query shape
in §8 with `EXPLAIN ANALYZE`. Only a shape that misses its budget gets an
index, in an Alembic migration, with the before/after plan in the PR. The
expected candidate is substring search over abstracts (`pg_trgm` is installed;
`idx_articles_trgm_title` exists). Any composite index for a sort key must
lead with `project_id`.

## 7. Frontend

### 7.1 Data path

- `frontend/services/articleListService.ts` (apiClient, `ErrorResult<T>`):
  `fetchArticlePage`, `fetchArticleFacet`, `deleteArticles(selection)`, and
  `fetchAllProjectArticles` (loops `fetchArticlePage` with `sort=created_at
  desc`, `limit=500`, until `next_cursor` is null; for the slim consumers in
  7.4). Types come from `schema.d.ts`.
- Query keys (`lib/query-keys/articles.ts`):
  `articleKeys.list(projectId, query)`, `articleKeys.facet(projectId, field,
  prefix)`, all under a `articleKeys.project(projectId)` family. The existing
  `byProject` key becomes the slim full-list key under the same family.
- Hooks: `useArticleListQuery` (`useInfiniteQuery`, `placeholderData:
  keepPreviousData` so the table doesn't blank between keystrokes),
  `useArticleFacetQuery`, `useDeleteArticles` (mutation).
- **Invalidation:** every article writer invalidates
  `articleKeys.project(projectId)`: RIS/Zotero/PubMed import completion,
  article create/update in the side panel, file upload/delete (changes
  `has_pdf`), and delete. This also fixes the stale-worklist note in
  `useProjectArticlesQuery.ts` ("no article writer invalidates this key").

### 7.2 Articles tab

- `ProjectView` stops owning articles (`articles` state, `loadArticles`, the
  generation counter for articles) — `ArticlesList` takes `projectId` and
  reads through the hook. Import dialogs and the side panel's `onComplete`
  invalidate instead of calling a reload callback.
- Search input debounced (~250 ms); filters and sort map 1:1 onto
  `ArticleListQuery`; filter UI and semantics unchanged.
- Table and mobile card list virtualized with `@tanstack/react-virtual`;
  the next page is fetched when the viewport nears the end of loaded rows.
- Counter: `matched` of `total` (copy key via `lib/copy`), never an array
  length. Empty state keyed on `total === 0`; "no matches" on `matched === 0`.
- Selection: header checkbox selects the loaded rows; when every loaded row is
  selected and `matched` > loaded, a bar offers "Select all {matched} matching
  articles" → `query` mode (subsequent unchecks go to `exclude_ids`). Changing
  search/filters clears a `query`-mode selection. Bulk actions show the
  resolved count from the selection, not the loaded-row count.
- Delete controls render only for managers (`useProjectMemberRole`); the
  endpoint enforces it regardless.
- `ArticlesList.tsx` is 1,291 lines; the builder may split it (data hook,
  toolbar, table body, selection bar) as part of this change.

### 7.3 Deletions (same PRs as their replacements)

`loadProjectArticles` + `PROJECT_ARTICLES_SELECT`, `fetchArticleIdsWithMainFile`,
`deleteArticle`, `bulkDeleteArticles`, `selectAllProjectArticles`,
`loadExtractionTableArticles`, `fetchProjectArticles`, the client-side
filter/sort/facet code in `ArticlesList.tsx`. Tighten `check_frontend_data_path.baseline`;
`knip` both modes at zero; copy keys removed through the copy-key gate.

### 7.4 Slim full-list consumers

`useProjectArticlesQuery` (worklist, ⌘K, run-screen pager, QA and extraction
dashboards), `HITLArticleTable` and `ArticleExtractionTable` all read through
`useProjectArticlesQuery` → `fetchAllProjectArticles`. The two components that
call a service from an effect today move onto the shared hook. Order is
`created_at desc, id desc` (§6.1 design call; today's helper uses `id asc`,
`articlesService.ts:418-419`, and `frontend/test/services/articlesService.test.ts:236-239`
pins it — that test and any pager fixture relying on it are updated).

### 7.5 Article writes and detail reads (scope ruled 2026-10-25)

Ruling: the remaining direct `articles` / `article_files` table access in the
tab moves to typed endpoints in this work. What moves, and the shape each
takes. The backend half of each item reuses the guards above:
`is_project_member` / `is_project_manager` for the project, `owned_article` /
`owned_article_file` for ids.

| Today (frontend) | Becomes | Notes |
| --- | --- | --- |
| `RISImportDialog.handleImport`: one browser `insert` per record, sequential, failures counted client-side (`RISImportDialog.tsx:79-117`) | **Server-side RIS import.** Browser parses (keep `lib/risParser.ts`) or uploads the file; one request creates the rows | Must not reinvent import: build on the canonical-identity import path #1053 introduces for PubMed (sync run + one sync event per record, PMID → DOI → URL identity, idempotent). That also makes PRISMA's identified/duplicates lines count RIS records correctly. **Design this item only after #1053 merges**, against its merged shape; size (sync vs Celery on `imports`) follows the PubMed endpoint |
| `insertArticle`, `updateArticle` (`articlesService.ts:97-135`) | `POST /api/v1/projects/{id}/articles`, `PATCH /api/v1/articles/{article_id}` | Member-level today (RLS `articles_insert` / `articles_update` = `is_project_member`); keep that. Update must refuse a missing/foreign article with one 404 (`owned_article`). Decide whether update carries optimistic concurrency (`row_version` exists on the table) — the builder checks how `project_details` does `expected` and mirrors it if the form can race |
| `fetchArticle` (`select('*')`, `articlesService.ts:140`) | `GET /api/v1/articles/{article_id}` | Full record incl. JSONB (the side panel is where full payloads belong) |
| `fetchArticleFiles`, `fetchMainFileInfo`, `fetchArticlePdfSignedUrl` (`articlesService.ts:168,238,325`) | `GET /api/v1/articles/{article_id}/files` already exists (`article_files.py:81`) — reuse it; signed URL via a backend endpoint | Check whether the existing files list returns what the three callers need before adding anything |
| `deleteArticleFile` (`articlesService.ts:205-225`): storage first, then row, unchecked | `DELETE /api/v1/article-files/{article_file_id}` | Same order rule as §6.4: row first, commit, then storage best-effort. Same role as today's RLS for `article_files` delete (builder reads the policy) |

Deleted with their replacements: `insertArticle`, `updateArticle`,
`fetchArticle`, `fetchArticleFiles`, `fetchMainFileInfo`,
`fetchArticlePdfSignedUrl`, `deleteArticleFile`, the RIS insert loop; the
`articlesService.ts|articles`, `articlesService.ts|article_files` and
`RISImportDialog.tsx|articles` baseline lines go to zero (or to whatever
non-tab reads remain, each named in the PR).

## 8. Performance budgets (verified, not assumed)

On a seeded 50,000-article project, local stack, warm cache:

| Shape | p95 budget |
| --- | --- |
| First page (default sort, no filters) incl. both counts | 300 ms |
| First page with `q` (3+ chars, matches abstracts) | 500 ms |
| Next page (any sort) | 150 ms |
| One facet (keywords, no prefix) | 300 ms |
| Delete 5,000 selected articles with files (request) | builder measures; see 6.4 |
| Slim full list (`fetchAllProjectArticles`, 50k → 100 pages of 500, counts skipped after page 1) | ≤ 5 s end to end; recorded, not a merge gate — these surfaces narrow to included records once screening lands (§3 non-goals) |

Frontend: Articles tab at 50k shows the first rows within 1 s of the API
response and scrolls without dropped frames (virtualized). The builder
records the numbers in the PR.

## 9. Testing

**Backend (integration, real Postgres)**

- Over 1,000 articles: pages concatenate to every article exactly once, for
  every sort key and direction, including a run of ≥ 1,500 rows sharing one
  `created_at` (the batch-import shape from #1053).
- A row inserted between two page reads neither duplicates nor shifts rows.
- `total`/`matched` correct with and without each filter.
- Each filter and `q` matches the client semantics it replaces (table-driven,
  one case per field; `%`/`_` literal).
- Cursor from another sort → 422.
- Authorization: non-member 404 on the three new endpoints (export keeps its
  `FORBIDDEN` envelope); member 403 on delete
  **and storage untouched**; `ids` selection containing a foreign article →
  the `owned_articles` error, nothing deleted or exported.
- `expected_count` mismatch → 409, nothing deleted.
- Delete order: rows gone after commit; a storage failure leaves no live row
  and is reported in `storage_failures`.
- Export with `query` selection exports exactly the matched set minus
  `exclude_ids`.

**Frontend (Vitest + MSW)**

- Counter renders `matched of total` from the response (2,500 of 2,500;
  12 of 2,500).
- Scrolling fetches the next page; a search change resets to page 1.
- "Select all N matching" switches to `query` mode; export/delete send the
  selection, not ids.
- Delete controls hidden for a reviewer.
- Writers invalidate `articleKeys.project`.

**E2E** — extend `articles.e2e.ts` with > 1,000 articles **seeded server-side**
by the E2E fixture (not a RIS import: RIS inserts one row per request from the
browser), check the counter and that the oldest record is reachable by search.

## 10. Rollout

Order, each a PR into `dev`:

0. **Stopgap (optional, today):** merge #1055 for LabMIMIC, ideally changed to
   call the existing `selectAllProjectArticles` instead of adding a loop.
   Deleted again by PR 2.
1. **Delete safety (small, ship first):** the delete endpoint (6.4) +
   frontend routed through it + role-gated controls. Stops the PDF loss now,
   independent of the list work.
2. **Backend list read:** query model, list + facets endpoints, perf seed and
   measurements, any index migration.
3. **Frontend Articles tab:** hooks, virtualized list, selection model,
   export `selection`, deletions in 7.3 for the tab.
4. **Slim consumers:** 7.4, delete the remaining client helpers, tighten the
   §VI baseline.
5. **Article detail + writes:** 7.5 create/update/detail/files endpoints and
   single-file delete; frontend side panel onto them.
6. **RIS import server-side:** 7.5 first row, after #1053 merges, on its
   import path.

Sequence against #1053 (screening): it touches `ArticlesList.tsx` (PubMed
source option) and `ProjectView.tsx`. Start PR 3 after #1053 merges and carry
its `PUBMED` source value into `sources[]`.

## 11. Decided, and left to the builder

**Decided:** approach B; keyset (not offset) paging; server-side
search/filters/sort/counts with today's semantics; facets over the whole
project; filter-based selection shared by export and delete; delete rows
before storage; manager-only delete enforced server-side; slim consumers move
to the API but stay full-list.

**Calls made in this design (review these):**

- Substring search, not full-text — parity first; ranking is a separate
  product decision.
- Every list column stays; `source_payload` / `sync_conflict_log` become
  server-computed 80-char previews; abstract capped in list rows.
- Same-direction `id` tie-break everywhere (flips the pager's order inside a
  same-timestamp batch from `id asc` to `id desc`).
- Delete carries `expected_count` (409 on drift); export does not.
- Export keeps its HTTP-200 error envelopes.
- Counts only on the first page.
- Facets stay project-wide (ignore active filters), as today.
- No index without a measurement.

**Left to the builder:** module/function names; whether `ArticlesList.tsx`
is split; the exact debounce and page-size tuning; whether delete needs a
Celery job (by measurement, 6.4); how much of the MCP read's SQL is shared.
