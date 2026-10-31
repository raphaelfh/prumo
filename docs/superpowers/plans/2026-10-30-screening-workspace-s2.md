---
status: draft
last_reviewed: 2026-10-31
owner: '@raphaelfh'
---

# Screening workspace S2 — deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers review derived duplicate candidate pairs side by side in a `Duplicates` screening sub-view and keep one; a removed record leaves every screening list and PRISMA box except "duplicates removed", nothing is deleted, and Undo restores it.

**Architecture:** One INSERT-only table `article_duplicate_verdicts` (latest row per unordered pair is its state). Candidates are derived per request: the repository reads one lightweight row per non-removed project article (identifier keys computed in SQL), a pure function pairs them into tiers, and one SQL predicate `removed_duplicate(article)` is threaded into `live_assignments`, the records read, enroll and every count. Frontend adds `?screeningTab=duplicates` on S0's `ListDetailSplitShell`: a pair list with status views and a compare panel, writing verdicts through `POST /duplicates/verdicts`.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + Pydantic v2, pytest on real Postgres; React 19 (React Compiler) + TanStack Query + react-router, Vitest + MSW + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-screening-workspace-design.md` — slice S2 only: §4 (Duplicates sub-view, `defaultValue`, managerOnly redirect), §4.3 (removed-duplicate rule), §4.6 (Duplicates bullets), §5 (`duplicates(projectId)` key, verdict invalidation), §6.4/§6.5 rows tagged S2, §8 in full, §9 task rows S2a1/S2a2/S2b, S2 gates, S2 E2E/seed bullets, S2 acceptance rows. Base: the S1 plan `docs/superpowers/plans/2026-10-30-screening-workspace-s1.md` (S1 is merged before this build starts; its names are this plan's inputs). Spec-gate rulings R1–R20 live in the ledger `.superpowers/sdd/2026-10-30-screening-workspace-s2/progress.md` and are restated where a task needs them.

**Scope:** 9 tasks, one PR to `dev`, title `feat(screening): deduplication — duplicates sub-view and derived removal`. One Alembic migration (number fixed at merge time, below).

## Task graph

| Task | Spec row | Depends on | Runs in parallel with |
| --- | --- | --- | --- |
| 1 Verdict table, model, schema tests (backend) | S2a1 | S1 merged | — |
| 2 Candidates, keep order, `GET /duplicates`, removal predicate (backend) | S2a1 | 1 | — |
| 3 `POST /duplicates/verdicts` (backend) | S2a2 | 2 | — |
| 4 Removal threaded into screening + PRISMA + seed (backend, touches 3 PRISMA frontend files) | S2a2 | 3 | 5 |
| 5 Data layer, errors, switcher, "Enroll anyway?" (frontend) | S2b | 3 | 4 |
| 6 Pair vocabulary + compare panel (frontend) | S2b | 5 | 4 |
| 7 Duplicates workspace (frontend) | S2b | 6 | 4 |
| 8 E2E dedup step + fixtures (frontend) | S2b | 4, 7 | — |
| 9 Slice verification + design review | all | 1–8 | — |

Parallel groups, in order: **G1** {1} → **G2** {2} → **G3** {3} → **G4** {4, 5} → **G5** {6} (4 may still run) → **G6** {7} → **G7** {8} → **G8** {9}. `frontend/types/api/*` is regenerated only by Tasks 1–4 (sequential, backend); frontend tasks never regenerate. Task 4 is the only task that edits `frontend/components/prisma/*`, `frontend/lib/copy/screening.ts` and `frontend/e2e/flows/screening.ui.e2e.ts` before Task 8; Tasks 5–7 never touch those three. Tasks 5–7 are sequential because each edits `frontend/lib/copy/duplicates.ts`.

## Global Constraints

- **Worktree.** `WT=/Users/raphaelfedericcihaddad/PycharmProjects/prumo/.claude/worktrees/screening-workspace-s2` (branch `screening-workspace-s2`). Every command uses absolute paths or `git -C "$WT"`; never touch the main checkout, never `git switch`/`checkout`, never bare `git stash`. After each task `git -C "$WT" status --short` shows only that task's files.
- **Precondition (S1).** `test -f "$WT/frontend/components/screening/TitleAbstractWorkspace.tsx"` and `grep -q "def record_rows" "$WT/backend/app/repositories/screening_repository.py"`. If either fails, stop: `origin/dev` with S1 must be merged into the branch first.
- **English only** — code, comments, commits, copy keys and copy.
- **Migration number.** Built as `0095_article_duplicate_verdicts` (`down_revision = "0094_screening_v1"`). At merge time the orchestrator renumbers to the next free number on `origin/dev` and re-parents onto its head (S3 adds one too); `expected_head` in `backend/tests/integration/test_migration_roundtrip.py` always names this migration's revision. Never apply app DDL through the Supabase MCP.
- **Ownership (BOLA).** Both routes `Depends(require_project_manager)`; every client article id is bound through `owned_articles` (`app/services/article_read_service.py`); every listed pair binds **both** sides with `Article.project_id == project_id` in the WHERE clause; assignment joins use `ARTICLE_STILL_IN_PROJECT`. Gate: `check_scope_guards.py`.
- **Envelope.** `ApiResponse.success(model, trace_id=getattr(request.state, "trace_id", None))`; refusals are `ScreeningStateError` (409) from `app/services/screening_errors.py`. Gate: `check_api_response_envelope.py`.
- **Generated types.** After any public schema or route `responses` edit: `cd "$WT" && npm run generate:api-types`, commit `frontend/types/api/openapi.json` + `schema.d.ts`. Only Tasks 1–4 regenerate.
- **Frontend data path.** component → hook → `services/duplicatesService.ts` → `apiClient`; services return `ErrorResult<T>`; keys only from `lib/query-keys/screening.ts`; copy through `t('duplicates', key)`, `{{x}}` filled with `.replace('{{x}}', …)`. Gates: `check_react_query_keys.py`, `check_frontend_data_path.py`, `check_copy_keys.py`.
- **React Compiler** (`panicThreshold: 'all_errors'`): no ref read/write during render, no `try/finally` and no `throw` inside `try` in a component or hook body, prop-change resets via "previous value in state", `useWatch` never `form.watch()`.
- **Keyboard.** Bindings through `useKeyboardShortcuts` (input + dialog guards); Duplicates uses j/k/Enter/Esc only (no decision keys). The only capture-phase listener is the S0 shell's Escape.
- **Post-edit hook** strips unused imports: add an import in the same edit as its first use.
- **No dead code.** `npm run deadcode` and `npm run deadcode:production` at zero from Task 7 on (Task 5/6 may leave a not-yet-wired export, noted in the task); vulture (`cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec`) green; `check_retired_symbols.py` gains `imported_not_enrolled`, `prismaNotEnrolled` (Task 4).
- **File size.** `check_file_size.py` exits 0 (800-line soft ceiling for new files).
- **Commands.** Frontend from `$WT` (never `cd frontend`): `npm run test:run -- <paths>`, `npm run typecheck`, `npm run lint`, `npx eslint <files>`, `npm run deadcode`, `npm run deadcode:production`, `npm run generate:api-types`; no `npx` on PATH → `~/.local/bin/mise exec node@24 -- <cmd>`; no `node_modules` → `npm ci` (never symlink). Backend: `cd "$WT/backend" && uv run pytest <paths> -q`; `make -C "$WT" lint-backend`; fitness `cd "$WT/backend" && uv run --frozen python ../scripts/fitness/<check>.py`.
- **Backend integration DB.** Container `docker run -d --name prumo-s2-pg -p 55432:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres postgres:17` (reuse if running), database `postgres_test_s2`; `$WT/backend/.env` with fake values only (`DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres_test_s2`, `SUPABASE_URL=http://localhost:54321`, `SUPABASE_SERVICE_ROLE_KEY=stub-service-role`, `SUPABASE_ENV=local`, `OPENAI_API_KEY=sk-test-not-real`); from `$WT/backend`: `uv sync --frozen --extra dev`, `psql postgresql://postgres:postgres@localhost:55432/postgres_test_s2 -f tests/integration/supabase_stub.sql`, `uv run alembic upgrade head`, `uv run python -m app.seed`. After Task 1 adds the migration, `uv run alembic upgrade head` again. Never `make db-fresh`/`reset-db`. `docker` may need the unsandboxed retry.
- **Handler coverage.** Every new endpoint branch also gets a direct-call unit test of `fn.__wrapped__` with patched collaborators (`tests/unit/test_screening_review_unit.py` precedent).
- **Commits:** conventional, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An exact triple A>B>C (pairs AB, AC, BC) and "Accept N exact".** The batch must never contain a pair whose kept side another selected pair removes; Accept writes AB and AC, BC drops out on refetch — Task 6 `selectAcceptableExact skips a pair whose keeper is removed earlier`, Task 3 `test_batch_with_kept_removed_earlier_rolls_back`.
2. **The kept article is moved to another project.** The removed record comes back as a normal article in its project and the pair is not listed (no foreign title leaks) — Task 2 `test_kept_article_moved_revives_and_unlists`.
3. **A removed record that was enrolled.** It vanishes from the records read (not a Not enrolled row), from counts and PRISMA screening, and `GET /screening/assignments/{id}` is 404 — Task 4 `test_removed_record_leaves_the_records_read`, `test_assignment_read_404_on_removed`.
4. **Undo after the removed record got extraction work.** Undo (`cleared`) still writes; a fresh `duplicate` on it is refused — Task 3 `test_undo_allowed_after_extraction_started`.
5. **Two managers merge overlapping pairs at once.** The project lock serializes them; the second sees the first's removal (skip or `DUPLICATE_KEPT_IS_REMOVED`) — Task 3 `test_concurrent_batches_serialize_on_the_project_lock`.

## Open questions (spec silent; ruled, default in brackets — ledger R1–R20)

1. **Records read leak (R1).** S1's `record_rows` outer-joins articles directly, not through `live_assignments`. [`removed_duplicate` added to its WHERE — Task 4.]
2. **Normalization (R7, amended).** [Title normalized in Python: `"".join(c for c in title.casefold() if c.isalnum())`, Likely needs ≥ 20 normalized characters; year non-null and equal; journal compared with the same normalization and the journal veto demotes only title-based (Likely) pairs; PMID equal is Exact regardless of DOI or journal.]
3. **FT half of `DUPLICATE_HAS_REVIEW_WORK` (R11).** No FT assignment can exist until S3 widens the phase CHECK. [The predicate ships now as `ScreeningAssignment.phase != SCREENING_PHASE`; S3 adds its test.]
4. **Selection URL (R12).** A record can be the removed side of two pairs. [`?article=<article_id>&kept=<kept_article_id>`; `kept` absent → the spec's first-open-pair rule.]
5. **"Enroll anyway?" count (R14).** [Fetched on click with `queryClient.fetchQuery`, both "Enroll all articles" and "Enroll N new".]

---

### Task 1: Verdict table, model, schema tests (backend, S2a1-1)

**Depends on:** S1 merged. **Parallel with:** none.

**Files:**
- Create: `backend/alembic/versions/0095_article_duplicate_verdicts.py`, `backend/app/models/article_duplicate.py`
- Modify: `backend/app/models/__init__.py` (import beside the screening models; `__all__`)
- Modify: `backend/tests/integration/test_screening_schema.py` (FK-index test table list; new cases), `backend/tests/integration/test_migration_roundtrip.py` (`expected_head`)

**Interfaces — Produces:**

```python
# app/models/article_duplicate.py
DUPLICATE_VERDICTS = ("duplicate", "distinct", "cleared")
DUPLICATE_BASES = ("pmid", "doi", "title", "manual")
DuplicateVerdictValue = Literal["duplicate", "distinct", "cleared"]
DuplicateBasis = Literal["pmid", "doi", "title", "manual"]

class ArticleDuplicateVerdict(Base, UUIDMixin):
    __tablename__ = "article_duplicate_verdicts"
    project_id: Mapped[UUID]        # FK projects ON DELETE CASCADE
    article_id: Mapped[UUID]        # FK articles ON DELETE CASCADE — removed / judged distinct
    kept_article_id: Mapped[UUID]   # FK articles ON DELETE CASCADE
    verdict: Mapped[str]
    basis: Mapped[str]
    decided_by: Mapped[UUID]        # FK profiles ON DELETE RESTRICT
    created_at: Mapped[datetime]    # server_default=func.clock_timestamp()
```

Migration (copy the 0094 shapes verbatim, `0094_screening_v1.py`): `op.create_table` with the columns above; CHECKs `article_duplicate_verdicts_verdict_check` (`verdict IN ('duplicate','distinct','cleared')`), `..._basis_check`, `..._not_self_check` (`article_id <> kept_article_id`); indexes `ix_article_duplicate_verdicts_project_id`, `..._article_id`, `..._kept_article_id`, `..._decided_by`; the 0094 append-only trigger (`refuse_append_only_change` BEFORE UPDATE OR DELETE, reusing the 0094 function), `ENABLE ROW LEVEL SECURITY`, `deny_all` policy, `REVOKE ALL … FROM authenticated, anon`. Downgrade drops the table. Model `__table_args__` mirrors the CHECKs and indexes so `alembic check` is zero-diff.

- [ ] **Step 1: Write the failing schema tests** in `test_screening_schema.py` (follow the 0094 cases one for one):
  - extend `test_every_foreign_key_leads_an_index`'s regclass list with `'article_duplicate_verdicts'::regclass`;
  - `test_duplicate_verdicts_are_append_only` — insert a row, `UPDATE` and `DELETE` as `authenticated` role each raise (same assertion as the 0094 trigger case);
  - `test_duplicate_verdicts_deny_all_and_revoked` — policy `deny_all` present; `has_table_privilege('authenticated', …, 'SELECT')` false;
  - `test_duplicate_verdict_checks` — parametrized (`ids=`): `verdict='merged'`, `basis='isbn'`, `article_id = kept_article_id` each raise `IntegrityError`;
  - `test_duplicate_verdict_created_at_is_clock_timestamp` — two inserts in one transaction get different `created_at` (0094's `test_timestamp_defaults` pattern);
  - `test_kept_article_delete_revives_the_removed_record` — verdict `duplicate` (B removed, A kept); delete A → no verdict row names B (`SELECT count(*) … WHERE article_id = B` is 0);
  - `test_project_delete_cascades_verdicts` — delete the project through `project_delete_service.delete_project_row` → 0 verdict rows.
- `test_migration_roundtrip.py`: `expected_head = "0095_article_duplicate_verdicts"`.

Run: `cd "$WT/backend" && uv run pytest tests/integration/test_screening_schema.py tests/integration/test_migration_roundtrip.py -q`
Expected: FAIL — relation `article_duplicate_verdicts` does not exist / head mismatch.

- [ ] **Step 2: Implement** the migration, the model and its registration.

- [ ] **Step 3: Verify**

Run: `cd "$WT/backend" && uv run alembic upgrade head && uv run pytest tests/integration/test_screening_schema.py tests/integration/test_migration_roundtrip.py -q && uv run alembic check && bash ../scripts/check_migration_split.sh` (path as in `scripts/fitness/run_all.sh`)
Expected: PASS; `alembic check` "No new upgrade operations detected"; split check exit 0. `check_rls_coverage.py` does not scan this table (it reads `extraction_*`/`project_*` raw SQL); the schema tests are the RLS assurance (R17) — run it anyway, exit 0.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add backend/alembic/versions backend/app/models backend/tests/integration
git -C "$WT" commit -m "feat(screening): add the append-only article duplicate verdicts table" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Candidates, keep order, `GET /duplicates`, removal predicate (backend, S2a1-2)

**Depends on:** Task 1. **Parallel with:** none.

**Files:**
- Create: `backend/app/repositories/duplicate_repository.py`, `backend/app/services/duplicate_candidates.py` (pure), `backend/app/services/duplicate_service.py`, `backend/app/schemas/duplicates.py`, `backend/app/api/v1/endpoints/duplicates.py`
- Modify: `backend/app/api/v1/router.py` (register), `scripts/fitness/check_layered_arch.py` only if the scan flags the new modules
- Create: `backend/tests/unit/test_duplicate_candidates.py`, `backend/tests/unit/test_duplicates_unit.py`, `backend/tests/integration/test_duplicates_read.py`, `backend/tests/integration/test_duplicates_scale.py`
- Regenerate: `frontend/types/api/openapi.json`, `schema.d.ts`

**Interfaces — Produces:**

```python
# repositories/duplicate_repository.py
def removed_duplicate(article: type[Article] | AliasedClass[Article]) -> ColumnElement[bool]:
    """THE removal predicate (§8.3). EXISTS a latest verdict row of an unordered pair containing
    the article with verdict='duplicate', article_id=article.id, project_id=article.project_id,
    AND the kept article is still in article.project_id (R5). Reused everywhere; never re-derived."""

@dataclass(frozen=True)
class CandidateSource:   # one per non-removed project article
    article_id: UUID; title: str; pmid: str | None; doi_key: str | None   # doi_match_key(Article.doi), '' → None
    publication_year: int | None; journal_title: str | None; article_type: str | None
    zotero_item_type: str | None   # Article.source_payload['data']['itemType'].astext
    created_at: datetime

@dataclass(frozen=True)
class LatestVerdict:
    article_id: UUID; kept_article_id: UUID; verdict: str; basis: str
    decided_by: UUID; created_at: datetime

class DuplicateRepository:
    def __init__(self, db: AsyncSession) -> None: ...
    async def candidate_sources(self, *, project_id: UUID) -> list[CandidateSource]   # WHERE project_id AND NOT removed_duplicate(Article)
    async def latest_verdicts(self, *, project_id: UUID) -> list[LatestVerdict]
    #   DISTINCT ON (least(article_id,kept_article_id), greatest(...)) ORDER BY that, created_at DESC, id DESC;
    #   WHERE verdict.project_id = project_id AND both articles' project_id = project_id (joins in WHERE)
    async def compare_fields(self, *, project_id: UUID, article_ids: Sequence[UUID]) -> dict[UUID, CompareSide]
    #   Article columns + authors + ingestion_source + has_pdf (S1's MAIN-file exists(); if it is inline in
    #   record_rows, extract it to a module-level `has_main_pdf(article)` in screening_repository and reuse)
    #   + screening_decisions (current TA decisions: latest per reviewer on the live assignment)
    #   + has_review_work; WHERE Article.project_id == project_id AND Article.id IN ids
    async def has_refusing_work(self, *, article_ids: Sequence[UUID]) -> set[UUID]   # used by Task 3

def review_work(article: type[Article]) -> ColumnElement[bool]   # any TA decision ∨ refusing_work(article)
def refusing_work(article: type[Article]) -> ColumnElement[bool]
#   EXISTS ScreeningAssignment(article, phase != SCREENING_PHASE) ∨ EXISTS ExtractionRun.article_id
#   ∨ EXISTS ExtractionInstance.article_id   (R11; extraction_batch_items do not count)

# services/duplicate_candidates.py (pure, no I/O)
DuplicateTier = Literal["exact", "likely", "possible"]
MatchLabel = Literal["pmid", "doi_title", "title", "doi_only"]
def normalize_title(title: str | None) -> str          # "".join(c for c in title.casefold() if c.isalnum())
def is_conference_like(source: CandidateSource) -> bool
#   article_type casefold contains congress|conference|meeting|protocol, or article_type.strip().upper() in
#   {CONF, CPAPER, ABST}, or zotero_item_type == "conferencePaper"
@dataclass(frozen=True)
class Candidate:
    article_id: UUID; kept_article_id: UUID; tier: DuplicateTier; match_label: MatchLabel; basis: DuplicateBasis
def match(a: CandidateSource, b: CandidateSource) -> tuple[DuplicateTier, MatchLabel, DuplicateBasis] | None
#   pmid equal → exact/pmid/pmid (no veto applies)
#   else both DOIs non-null and differ → None
#   else DOI equal and normalized titles equal → exact/doi_title/doi
#   else DOI equal → possible/doi_only/doi
#   else neither conference-like, normalized titles equal, len ≥ 20, years non-null and equal →
#        likely/title/title, demoted to possible/title/title when both journals non-null and
#        normalize_title(journal) differ
#   else None
def candidate_pairs(sources: Sequence[CandidateSource], closed: set[frozenset[UUID]],
                    rank: Callable[[UUID], tuple]) -> list[Candidate]
#   group by pmid, doi_key, (normalize_title, year) to find pairs in O(n) (never all-pairs);
#   skip pairs in `closed` (latest verdict duplicate|distinct); kept = the side `suggest_kept` picks
def suggest_kept(a: KeepFacts, b: KeepFacts) -> UUID
#   KeepFacts(article_id, has_review_work, has_pdf, has_abstract, has_identifier (pmid or doi), created_at);
#   order: review work → PDF → abstract → identifier → oldest (created_at, then id)

# schemas/duplicates.py
class DuplicateSide(BaseModel):
    article_id: UUID; title: str; authors: list[str]; publication_year: int | None
    journal_title: str | None; doi: str | None; pmid: str | None; ingestion_source: str | None
    has_pdf: bool; has_abstract: bool; screening_decisions: int; has_review_work: bool
class DuplicatePair(BaseModel):
    article_id: UUID; kept_article_id: UUID; tier: DuplicateTier | None   # None for a resolved manual pair
    basis: DuplicateBasis; match_label: MatchLabel | None
    removed: DuplicateSide; kept: DuplicateSide
    verdict: Literal["duplicate", "distinct"] | None = None     # resolved only
    decided_by_name: str | None = None; created_at: datetime | None = None
class DuplicatesRead(BaseModel):
    open: list[DuplicatePair]       # tier (exact, likely, possible) → kept title → (article_id, kept_article_id)
    resolved: list[DuplicatePair]   # latest verdict duplicate|distinct, created_at DESC
```

- `DuplicateService.read(project_id) -> DuplicatesRead`: sources, latest verdicts, candidate pairs, one `compare_fields` call for every id in open ∪ resolved, names via `profile_names`. A resolved pair whose either side is not in the project is not listed (R5).
- Route `GET /api/v1/projects/{project_id}/duplicates` → `ApiResponse[DuplicatesRead]`, `@limiter.limit("60/minute")`, `Depends(require_project_manager)`, `responses={403: {"description": "Only project managers review duplicates"}}`.

- [ ] **Step 1: Write the failing unit tests**
  - `test_duplicate_candidates.py`: `test_normalize_title` (`"Sepsis: a Review." == "sepsis a review"` normalized); `test_match` parametrized (`ids=`) — same PMID different DOI → exact/pmid; DOI + title → exact/doi_title; DOI same, title differs → possible/doi_only; differing DOIs, same title+year → None; title+year (≥ 20 chars) → likely/title; 19-char title → None; one year None → None; journals "JAMA" vs "Lancet" → possible/title; journal None on one side → likely; `article_type="Congress"` → None by title, exact by PMID; `"Clinical Trial Protocol"`, `"CONF"`, `"ABST"`, zotero `conferencePaper` → None by title. `test_candidate_pairs_skips_closed`; `test_candidate_pairs_triple_shares_the_keeper` (A, B, C same PMID, A ranks first → AB, AC kept A; BC kept B). `test_suggest_kept` parametrized over each level deciding alone (review work beats PDF, PDF beats abstract, abstract beats identifier, identifier beats age, older wins at a tie).
  - `test_duplicates_unit.py`: `test_duplicates_handler_returns_the_read` (`get_duplicates.__wrapped__` with patched service); `test_duplicates_route_limit` — `limiter._route_limits["app.api.v1.endpoints.duplicates.get_duplicates"]` → `["60 per 1 minute"]`; `test_duplicate_side_has_the_compare_fields` (`set(DuplicateSide.model_fields)` equals the 12 names).

Run: `cd "$WT/backend" && uv run pytest tests/unit/test_duplicate_candidates.py tests/unit/test_duplicates_unit.py -q`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 2: Implement** `duplicate_candidates.py`, the schemas and the handler; run Step 1 → PASS.

- [ ] **Step 3: Write the failing integration tests** in `test_duplicates_read.py` (reuse `client_as`, `add_member`, `screening_fixtures` builders as `test_screening_records.py` does; insert verdict rows directly with `ArticleDuplicateVerdict`):
  - `test_non_manager_is_403` (reviewer, viewer, non-member).
  - `test_each_tier_is_listed` — one pair per tier → `open` tiers `["exact", "likely", "possible"]` in that order, `match_label`s, compare fields filled (`has_pdf` true only with a `MAIN` file; `screening_decisions` = 2 for an enrolled record with two current decisions; `has_review_work` true with an `ExtractionRun` row).
  - `test_vetoes` — differing DOIs, conference `article_type`, zotero `source_payload={"data": {"itemType": "conferencePaper"}}` → no pair; PMID still pairs a conference record.
  - `test_distinct_suppresses_and_cleared_reopens` — `distinct` row → pair in `resolved` (`verdict == "distinct"`, `decided_by_name`, `created_at`), not in `open`; a later `cleared` row → back in `open`.
  - `test_removed_record_never_pairs_again` — A, B, C same PMID; `duplicate` (B removed, kept A) → `open` holds only A–C; `resolved` holds A–B.
  - `test_moved_article_is_ignored` — B moved to another project after a `duplicate` verdict → in the new project B is a normal article (no pair, not removed: `removed_duplicate` false) and the old project lists no pair with B.
  - `test_kept_article_moved_revives_and_unlists` — `duplicate` (B removed, A kept), then A moved → B is not removed (`select(removed_duplicate(Article)).where(Article.id == B)` false) and `resolved` is empty.
  - `test_foreign_project_articles_never_pair` — same PMID in two projects → no pair.

`test_duplicates_scale.py` (`@pytest.mark.slow` only if the suite has that marker; else plain): 10,000 articles via one `insert(Article)` of dicts, 300 PMID pairs, 300 title pairs → `GET` returns 600 open pairs; `time.perf_counter()` around the request printed (`print(f"duplicates read 10k: {ms:.0f} ms")`) and asserted under 3,000 ms on the local container; the measured number goes in the task report and the PR body (spec §9 "threshold measured"). If over: add an expression index the test shows is needed (§13 builder call) in Task 1's migration file — same PR, not yet merged.

Run: `cd "$WT/backend" && uv run pytest tests/integration/test_duplicates_read.py tests/integration/test_duplicates_scale.py -q -s`
Expected: FAIL — 404 on the route.

- [ ] **Step 4: Implement** the repository, service, route and router registration. Run Step 3 → PASS.

- [ ] **Step 5: Regenerate types, gates**

Run: `cd "$WT" && npm run generate:api-types && npm run typecheck`; `make -C "$WT" lint-backend`; from `$WT/backend`: `check_scope_guards.py`, `check_api_response_envelope.py`, `check_layered_arch.py`, the vulture command.
Expected: all exit 0; `grep -c DuplicatesRead frontend/types/api/schema.d.ts` ≥ 1.

- [ ] **Step 6: Commit**

```bash
git -C "$WT" add backend/app backend/tests frontend/types/api scripts/fitness
git -C "$WT" commit -m "feat(screening): derive duplicate candidates and add the duplicates read" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `POST /duplicates/verdicts` (backend, S2a2-1)

**Depends on:** Task 2. **Parallel with:** none.

**Files:**
- Modify: `backend/app/schemas/duplicates.py`, `backend/app/services/duplicate_service.py`, `backend/app/repositories/duplicate_repository.py`, `backend/app/api/v1/endpoints/duplicates.py`, `backend/app/schemas/common.py` (`ApiErrorCode`)
- Create: `backend/tests/integration/test_duplicate_verdicts.py`; Modify: `backend/tests/unit/test_duplicates_unit.py`, `backend/tests/integration/test_screening_concurrency.py` (one case)
- Regenerate: `frontend/types/api/*`

**Interfaces — Consumes:** Task 2 (`removed_duplicate`, `refusing_work`, `match`, `latest_verdicts`, `ScreeningRepository.enroll`, `ProjectRepository.lock_for_update`).

**Produces:**

```python
class DuplicateVerdictCreate(BaseModel):
    article_id: UUID; kept_article_id: UUID; verdict: DuplicateVerdictValue   # no basis field: extra="forbid"
class DuplicateVerdictsCreate(BaseModel):
    items: list[DuplicateVerdictCreate] = Field(min_length=1, max_length=500)
class DuplicateVerdictsResult(BaseModel):
    written: int; enrolled_kept: int
# ApiErrorCode += DUPLICATE_HAS_REVIEW_WORK, DUPLICATE_KEPT_IS_REMOVED (409 via ScreeningStateError)
async def DuplicateService.write_verdicts(project_id, user_id, items) -> DuplicateVerdictsResult
```

Route `POST /api/v1/projects/{project_id}/duplicates/verdicts`, `@limiter.limit("10/minute")`, `require_project_manager`, `responses={404: "An article is not in this project", 409: "The record to remove has full-text or extraction work, or the record to keep was already removed"}`. `ArticleNotFoundError` → 404 (as `enroll_screening`). Commit once after the service returns.

Rules, in order, one transaction (spec §8.3 + R9):
1. `lock_for_update(project_id)` (missing → 404).
2. `owned_articles` over every `article_id` ∪ `kept_article_id` (one call); `article_id == kept_article_id` → 422 from the schema (`model_validator`).
3. Per item, in request order, reading state that includes this batch's earlier writes (flush before each read):
   - `duplicate`: removed side already removed → skip (not written, not counted); kept side removed → raise `DUPLICATE_KEPT_IS_REMOVED`; removed side in `has_refusing_work` → raise `DUPLICATE_HAS_REVIEW_WORK`; else insert with `basis` from `match(...)` of the two sources (`manual` when `None`); if the removed article has a live TA assignment and the kept one has none → `ScreeningRepository.enroll(article_ids=[kept])`, `enrolled_kept += rows`.
   - `distinct`: insert, basis as above. No review-work check.
   - `cleared`: latest row of the unordered pair is `duplicate`/`distinct` → insert with that row's `basis`; else skip. No review-work check (Undo stays allowed).
4. Any raise rolls back the whole batch (no partial write).

- [ ] **Step 1: Write the failing tests** — `test_duplicate_verdicts.py`:
  - `test_non_manager_is_403`; `test_batch_over_500_is_422` (501 items); `test_basis_field_is_refused_422`; `test_foreign_article_is_404`.
  - `test_duplicate_records_the_recomputed_basis` — PMID pair → row `basis == "pmid"`; unrelated pair → `"manual"`; title pair → `"title"`.
  - `test_duplicate_on_already_removed_is_skipped` — second `duplicate` of B with another keeper → `written == 0`, one live `duplicate` row for B.
  - `test_chain_keeps_the_first_removed` — B removed (kept A); then A removed (kept C) → both removed; clearing the second restores only A.
  - `test_kept_is_removed_is_409` — B removed; `duplicate` (C removed, kept B) → 409 `DUPLICATE_KEPT_IS_REMOVED`.
  - `test_batch_with_kept_removed_earlier_rolls_back` — one batch [AB duplicate, BC duplicate kept B] → 409, zero rows written.
  - `test_review_work_is_409_and_rolls_back` — batch [valid pair, pair whose removed side has an `ExtractionRun`] → 409 `DUPLICATE_HAS_REVIEW_WORK`, zero rows; same with an `ExtractionInstance`. (The FT-assignment half is S3's test; R11.)
  - `test_keep_the_other_enrolls_the_kept` — removed B enrolled at TA with 2 decisions, kept A not enrolled → `enrolled_kept == 1`, A has a TA assignment, B's decision rows still exist; a second call with both enrolled → `enrolled_kept == 0`.
  - `test_cleared_only_after_a_verdict` — `cleared` on an open pair → `written == 0`; after `distinct` → written 1 with the distinct row's basis.
  - `test_undo_allowed_after_extraction_started` — B removed, then an `ExtractionRun` for B, `cleared` → written 1, B not removed; a new `duplicate` on B → 409.
  - `test_written_counts_inserted_rows` — mixed batch (duplicate, distinct, skipped duplicate, cleared) → `written == 3`.
- `test_duplicates_unit.py`: `test_verdicts_route_limit` → `["10 per 1 minute"]`; `test_verdicts_handler_commits_and_returns` (`__wrapped__`, patched service, `db.commit` awaited once); `test_error_codes_exist` (both names in `ApiErrorCode`).
- `test_screening_concurrency.py`: `test_concurrent_batches_serialize_on_the_project_lock` — real commits: session 1 locks the project and writes `duplicate` (B, kept A), a second session posts `duplicate` (A, kept C) through the service and parks on the lock (poll `pg_locks WHERE NOT granted` as S1's race case does); after commit 1, session 2 succeeds and both A and B are removed — then the mirror case (session 2 posts `duplicate` (C, kept B)) → `DUPLICATE_KEPT_IS_REMOVED`.

Run: `cd "$WT/backend" && uv run pytest tests/integration/test_duplicate_verdicts.py tests/unit/test_duplicates_unit.py tests/integration/test_screening_concurrency.py -k "duplicate or verdict or lock" -q`
Expected: FAIL — 405/404 on the route, missing codes.

- [ ] **Step 2: Implement** per Interfaces and Rules. Run Step 1 → PASS.

- [ ] **Step 3: Regenerate types, gates** (same commands as Task 2 Step 5). Expected: exit 0; `grep -c DUPLICATE_KEPT_IS_REMOVED frontend/types/api/schema.d.ts` ≥ 1.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add backend/app backend/tests frontend/types/api
git -C "$WT" commit -m "feat(screening): record duplicate verdicts with derived basis and refusals" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Removal threaded into screening, PRISMA formulas, seed pair (backend + PRISMA frontend, S2a2-2)

**Depends on:** Task 3. **Parallel with:** Task 5 (Task 4 never touches `frontend/lib/copy/duplicates.ts`, `frontend/components/screening/*`, `frontend/hooks/*`, `frontend/services/*`; Task 5 never touches the files below).

**Files:**
- Modify: `backend/app/repositories/screening_repository.py` (`live_assignments`, `enroll`, `count_project_articles` → add `count_removed`, `record_rows`), `backend/app/services/screening_config_service.py` (`read`, `enroll`), `backend/app/services/prisma_service.py`, `backend/app/schemas/prisma.py`, `backend/app/seed_screening.py`
- Modify: `scripts/fitness/check_retired_symbols.py` (`RETIRED` += `imported_not_enrolled`, `prismaNotEnrolled`)
- Modify (frontend, same commit — R3): `frontend/components/prisma/PrismaCountsPanel.tsx`, `frontend/components/prisma/PrismaCountsPanel.test.tsx` (path as in tree), `frontend/lib/copy/screening.ts` (`prismaNotEnrolled` → `prismaOtherRemoved` "Records removed for other reasons"), `frontend/e2e/flows/screening.ui.e2e.ts` (the `imported_not_enrolled` assertions → `other_removed`)
- Test: `backend/tests/integration/test_screening_removal.py` (create), `test_prisma_counts.py`, `test_prisma_endpoint_unit.py`, `test_prisma_screening_box.py`, `test_screening_config.py`, `test_seed_screening.py`
- Regenerate: `frontend/types/api/*`

**Interfaces — Consumes:** `removed_duplicate` (Task 2). **Produces:** `PrismaCountsRead.other_removed: int` (replaces `imported_not_enrolled`); `ScreeningRepository.count_removed(*, project_id) -> int`.

Threading (§8.3, R1):
- `live_assignments(project_id)` adds `.where(~removed_duplicate(Article))` (the `Article` already joined by `ARTICLE_STILL_IN_PROJECT`). Every reader inherits it: `count_enrolled`, `live_assignment_ids`, `assignment_states`, `decide`/`arbitrate`/`GET /screening/assignments/{id}` (404 via the existing `snapshot is None` branch).
- `record_rows` adds `~removed_duplicate(Article)` to its WHERE.
- `enroll` source adds `~removed_duplicate(Article)` (also with explicit `article_ids`).
- `ScreeningConfigService.read`: `not_enrolled = total - enrolled - removed`. `enroll`: `candidates = total - removed` for enroll-all; for explicit ids, `owned_articles` then drop the removed ones (one query) before `candidates = len(ids)`.
- PRISMA (§8.4 table): `_pubmed_identified` = distinct PMIDs of PubMed `_IDENTIFIED_STATUSES` events whose `article_id` is a project article (drop the enrolled join) **plus** PubMed-sourced project articles no PubMed sync event links; `_other_sources` = every project article whose lowered source is not PubMed (drop the enrolled join); `duplicates_removed = identified_total - total + removed`; `other_removed = total - enrolled - removed`. Rewrite the `prisma_counts` docstring invariant ("identified ≥ total − removed while no PMID is linked to two project articles; not clamped").
- Frontend: `PrismaCountsPanel` reads `other_removed` and the `prismaOtherRemoved` label in both the box and the `screened === 0` notice (R20).
- Seed (`build`): add articles #13–#16: #13/#14 same PMID `"39000001"` (open exact pair, both not enrolled), #15/#16 same DOI and title (≥ 20 characters, same year) with a `duplicate` verdict (#16 removed, kept #15, `decided_by=manager_id`, basis `doi`) — so Duplicates shows Open and Resolved. Update the seed docstring ("S2 duplicate pairs").

- [ ] **Step 1: Write the failing tests**
  - `test_screening_removal.py`: `test_removed_record_leaves_the_records_read` (enrolled B removed → no row for B in the records read; a never-enrolled removed C → no Not enrolled row); `test_assignment_read_404_on_removed` (`GET /screening/assignments/{B's}` → 404; `decide` → 404; `arbitrate` on a conflicted removed record → 404); `test_enroll_skips_removed` (enroll-all → B not enrolled, `already_enrolled` excludes it; explicit `article_ids=[B, A]` → only A, `already_enrolled == 0`); `test_restore_restores_the_assignment` (enrolled B removed then `cleared` → B's assignment back in the records read with its decisions, no re-enroll); `test_config_not_enrolled_excludes_removed`; `test_prisma_before_and_after_a_merge` (3 RIS articles, 2 enrolled; merge one enrolled → `identified_total` 3, `duplicates_removed` 1, `other_removed` 1, `screened` 1; identity `identified_total == duplicates_removed + other_removed + screened`).
  - `test_prisma_counts.py`: rewrite the `imported_not_enrolled` assertions (`:79,176,207-208,282`) to `other_removed`; add `test_cross_source_a_pubmed_match_of_a_ris_article` (one article, RIS source, PubMed event `updated` → identified 2, `duplicates_removed` 1), `test_cross_source_b_two_articles_same_pmid` (RIS + PubMed-inserted, same PMID → `duplicates_removed` 0; after a `duplicate` verdict → 1), `test_cross_source_c_pubmed_article_without_event` (counted once).
  - `test_prisma_endpoint_unit.py:28`, `test_prisma_screening_box.py:60`: field rename.
  - `test_seed_screening.py`: as manager the records read's `not_enrolled` count becomes 5 (#11, #12, #13, #14, #15) and #16 is absent; `GET /duplicates` has 1 open, 1 resolved.
  - `PrismaCountsPanel.test.tsx`: fixture `other_removed`; asserts the label "Records removed for other reasons".

Run: `cd "$WT/backend" && uv run pytest tests/integration/test_screening_removal.py tests/integration/test_prisma_counts.py tests/unit/test_prisma_endpoint_unit.py tests/integration/test_prisma_screening_box.py tests/integration/test_seed_screening.py -q` and `cd "$WT" && npm run test:run -- frontend/components/prisma`
Expected: FAIL.

- [ ] **Step 2: Implement** per Threading. Run Step 1 → PASS.

- [ ] **Step 3: Regenerate types and the full affected suites**

Run: `cd "$WT" && npm run generate:api-types && npm run typecheck && npm run test:run -- frontend/components/prisma frontend/components/screening`; `cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_screening_*.py tests/integration/test_prisma_*.py tests/integration/test_duplicate*.py -q`; `make -C "$WT" lint-backend`; fitness `check_scope_guards.py`, `check_retired_symbols.py`, `check_copy_keys.py`, `check_api_response_envelope.py`, vulture.
Expected: all exit 0; `grep -rn "imported_not_enrolled\|prismaNotEnrolled" "$WT/backend/app" "$WT/frontend" --include='*.py' --include='*.ts' --include='*.tsx' | grep -v types/api` prints nothing.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add backend frontend/types/api frontend/components/prisma frontend/lib/copy/screening.ts frontend/e2e/flows/screening.ui.e2e.ts scripts/fitness/check_retired_symbols.py
git -C "$WT" commit -m "feat(screening): hide removed duplicates from screening and count them in PRISMA" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Data layer, errors, switcher, "Enroll anyway?" (frontend, S2b-1)

**Depends on:** Task 3 (types). **Parallel with:** Task 4.

**Files:**
- Modify: `frontend/lib/query-keys/screening.ts` (+ its test), `frontend/components/layout/sectionViews.ts`, `frontend/components/navigation/SectionViewSwitcher.tsx` (+ test), `frontend/components/screening/ScreeningTab.tsx` (+ test), `frontend/components/screening/ScreeningToolbarActions.tsx`, `frontend/components/screening/TitleAbstractWorkspace.tsx` (only the two enroll buttons' wiring) (+ its test), `frontend/lib/copy/index.ts` (register `duplicates`)
- Create: `frontend/services/duplicatesService.ts`, `frontend/hooks/screening/useDuplicates.ts`, `frontend/hooks/screening/__tests__/useDuplicates.test.tsx`, `frontend/lib/duplicates/errors.ts`, `frontend/lib/duplicates/errors.test.ts`, `frontend/lib/copy/duplicates.ts`

**Interfaces — Produces:**

```ts
// lib/query-keys/screening.ts
duplicates: (projectId: string) => [...screeningKeys.project(projectId), 'duplicates'] as const,
// services/duplicatesService.ts
export type DuplicatesRead = components['schemas']['DuplicatesRead'];
export type DuplicatePair = components['schemas']['DuplicatePair'];
export type DuplicateVerdictCreate = components['schemas']['DuplicateVerdictCreate'];
export type DuplicateVerdictsResult = components['schemas']['DuplicateVerdictsResult'];
export function fetchDuplicates(projectId: string): Promise<ErrorResult<DuplicatesRead>>;
export function postDuplicateVerdicts(projectId: string, items: DuplicateVerdictCreate[]): Promise<ErrorResult<DuplicateVerdictsResult>>;
// hooks/screening/useDuplicates.ts
export function duplicatesQueryOptions(projectId: string): QueryOptions;   // used by the hook and fetchQuery
export function useDuplicates(projectId: string, enabled: boolean): UseQueryResult<DuplicatesRead>;
export function useDuplicateVerdicts(projectId: string): UseMutationResult<DuplicateVerdictsResult, ApiError, DuplicateVerdictCreate[]>;
//   onSettled: invalidateScreening(queryClient, projectId)   (S1 helper; covers duplicates, records, config, prisma)
// lib/duplicates/errors.ts
export function duplicatesErrorMessage(error: unknown): string;
//   CODE_TO_KEY {DUPLICATE_HAS_REVIEW_WORK: 'errHasReviewWork', DUPLICATE_KEPT_IS_REMOVED: 'errKeptIsRemoved',
//   VALIDATION_ERROR: 'errGeneric'}; 403 → 'errForbidden'; else 'errGeneric' (same shape as lib/screening/errors.ts)
// sectionViews.ts
export interface SectionView { …; isDefault?: true }
export function defaultSectionView(views: SectionView[]): SectionView;   // views.find(v => v.isDefault) ?? views[0]
// screening: [duplicates (managerOnly), title_abstract (isDefault), settings (managerOnly)]
```

Copy (`duplicates` namespace, this task's keys only): `tabDuplicates` "Duplicates", `errHasReviewWork` "This record already has full-text or extraction work, so keep it instead.", `errKeptIsRemoved` "The record you chose to keep was already removed as a duplicate.", `errForbidden` "Only project managers can do this", `errGeneric` "Something went wrong. Try again.", `enrollAnywayTitle` "Enroll anyway?", `enrollAnywayBody` "{{n}} possible duplicates not reviewed. Enroll anyway?", `enrollAnywayConfirm` "Enroll anyway", `reviewDuplicates` "Review duplicates".

Rules:
- Switcher: `active` falls back to `defaultSectionView(views).value` (not `views[0]`) when the URL has no or an unknown value.
- `ScreeningTab`: the S1 redirect (non-manager deep link after the config read succeeds) covers `duplicates` as well as `settings`; `duplicates` renders a placeholder `null` until Task 7 wires `DuplicatesWorkspace` (no new file here). Switching `screeningTab` drops `article`, `kept` and `status` from the URL (replace) — previous-value-in-state pattern, the write in an effect.
- "Enroll all articles" and "Enroll N new" (manager only): on click, `queryClient.fetchQuery(duplicatesQueryOptions(projectId))`; `open.length > 0` → `AlertDialog` (`enrollAnyway*`, `{{n}}` = `open.length`; buttons "Enroll anyway" → enroll, "Review duplicates" → `screeningTab=duplicates`); `0` → enroll directly; a fetch error → enroll directly (the dedup check is advisory).

- [ ] **Step 1: Write the failing tests**
  - `screening.test.ts` (query keys): `duplicates(p)` = `['screening','project','p','duplicates']` and prefix-matches `project(p)`.
  - `useDuplicates.test.tsx` (MSW): GET returns `data`; `enabled=false` sends nothing; `useDuplicateVerdicts` posts `{items}` and calls `invalidateQueries` with `{queryKey: ['screening','project',p]}`.
  - `errors.test.ts` (new, `lib/duplicates`): each `CODE_TO_KEY` entry maps; 403 → forbidden; unknown → generic.
  - `SectionViewSwitcher.test.tsx`: `highlights Title/abstract by default with Duplicates listed first` (manager: tab order Duplicates, Title/abstract, Settings; no param → Title/abstract `aria-selected`); `hides Duplicates for a member`.
  - `ScreeningTab.test.tsx`: `redirects a member deep-linked to duplicates only after the config resolves`; `never bounces a manager's duplicates deep link`; `drops article, kept and status when the sub-view changes`.
  - `TitleAbstractWorkspace.test.tsx`: `asks "Enroll anyway?" while open pairs exist` (MSW duplicates with 23 open → dialog text "23 possible duplicates not reviewed. Enroll anyway?"; confirm posts enroll); `enrolls without asking when no pair is open`; same two for "Enroll N new".

Run: `npm run test:run -- frontend/lib frontend/hooks/screening frontend/components/navigation frontend/components/screening`
Expected: FAIL.

- [ ] **Step 2: Implement.** Run Step 1 → PASS; `npm run typecheck`, `npx eslint <touched>`, fitness `check_react_query_keys.py`, `check_frontend_data_path.py`, `check_copy_keys.py`, `check_button_scale.py` → exit 0. (`useDuplicates`'s query hook has no production consumer besides `fetchQuery` until Task 7; `deadcode:production` may report `useDuplicates` here — expected, gated from Task 7.)

- [ ] **Step 3: Commit**

```bash
git -C "$WT" add frontend/lib frontend/services/duplicatesService.ts frontend/hooks/screening frontend/components/layout/sectionViews.ts frontend/components/navigation frontend/components/screening
git -C "$WT" commit -m "feat(screening): duplicates data layer, switcher default and enroll-anyway prompt" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Pair vocabulary and compare panel (frontend, S2b-2)

**Depends on:** Task 5. **Parallel with:** Task 4 (if still running).

**Files:**
- Create: `frontend/lib/duplicates/pairs.ts`, `frontend/lib/duplicates/pairs.test.ts`, `frontend/components/screening/duplicates/DuplicateComparePanel.tsx`, `frontend/components/screening/duplicates/__tests__/DuplicateComparePanel.test.tsx`
- Modify: `frontend/lib/copy/duplicates.ts`

**Interfaces — Produces:**

```ts
// lib/duplicates/pairs.ts
export type DuplicateStatusView = 'open' | 'exact' | 'likely' | 'possible' | 'resolved';
export function pairKey(pair: Pick<DuplicatePair,'article_id'|'kept_article_id'>): string; // `${article_id}~${kept_article_id}`
export function pairsInView(data: DuplicatesRead, view: DuplicateStatusView): DuplicatePair[];
export function viewCounts(data: DuplicatesRead): Record<DuplicateStatusView, number>;
export function findSelectedPair(data: DuplicatesRead, articleId: string | null, keptId: string | null): DuplicatePair | null;
//   both ids → that pair (open or resolved); article only → first open pair containing it as either side,
//   in list order, else the first resolved one; none → null
export function selectAcceptableExact(open: DuplicatePair[], max = 500): DuplicatePair[];
//   exact pairs in list order; skip removed.has_review_work; skip if kept_article_id ∈ removedSoFar;
//   skip if article_id ∈ removedSoFar; stop at max (R2)
export const COMPARE_FIELDS: readonly ['title','authors','publication_year','journal_title','doi','pmid','ingestion_source','has_pdf','screening_decisions'];
export function differingFields(pair: DuplicatePair): Set<(typeof COMPARE_FIELDS)[number]>;
//   title/journal compared case- and whitespace-insensitively, authors joined, others strict
// DuplicateComparePanel.tsx
export function DuplicateComparePanel(props: {
  pair: DuplicatePair; busy: boolean;
  onMerge: (removedId: string, keptId: string) => void; onDistinct: () => void; onSkip: () => void; onUndo: () => void;
}): JSX.Element;
```

Panel rules (§8.4): two columns (kept candidate left, the other right) of field rows in `COMPARE_FIELDS` order (labels from copy; source via the existing `prismaSource*` labels on `ingestion_source.toLowerCase() ?? 'manual'` — R19; PDF "Yes/No"; screening work `"{{n}} decisions"`), a dot (`aria-label` "Differs") on each differing row; "Keep" radio per column using the recorded-choice ring class S1 uses for decisions, default `pair.kept_article_id`; warning line when the selected keeper's `screening_decisions` < the other side's: `"{{removed}}'s title/abstract decisions ({{n}}) are set aside; {{kept}} will need screening"` (`{{removed}}`/`{{kept}}` = the two titles truncated to 40 characters); buttons "Merge, keep selected" (primary) · "Not duplicates" · "Skip"; when the record that would be removed `has_review_work` and the keeper does not either, Merge is disabled with tooltip `errHasReviewWork`; both sides with review work → Merge disabled. Resolved pair: fields read-only, a line "Merged by {{name}} · {{date}}" / "Marked not duplicates by …", and one button "Undo". `busy` disables every button.

Copy keys (add only these): `fieldTitle` "Title", `fieldAuthors` "Authors", `fieldYear` "Year", `fieldJournal` "Journal", `fieldDoi` "DOI", `fieldPmid` "PMID", `fieldSource` "Source", `fieldPdf` "PDF", `fieldScreening` "Screening work", `decisionsCount` "{{n}} decisions", `yes` "Yes", `no` "No", `differs` "Differs", `keep` "Keep", `merge` "Merge, keep selected", `notDuplicates` "Not duplicates", `skip` "Skip", `undo` "Undo", `setAsideWarning` (above), `resolvedMerged` "Merged by {{name}} · {{date}}", `resolvedDistinct` "Marked not duplicates by {{name}} · {{date}}".

- [ ] **Step 1: Write the failing tests**
  - `pairs.test.ts`: `pairsInView` per view; `viewCounts`; `findSelectedPair` (both ids; article-only picks the first open pair, either side; falls back to resolved; unknown → null); `selectAcceptableExact skips a pair whose keeper is removed earlier` (triple AB, AC, BC kept A, A, B → [AB, AC]); `skips a chain link` (AB kept A, BC kept B, in that order → [AB]); `skips a removed side with review work`; `caps at 500` (600 exact → 500); `differingFields` (title differing only by case → not differing; year differs → differing).
  - `DuplicateComparePanel.test.tsx`: `defaults Keep to the server's suggestion`; `marks differing fields with a dot`; `shows the set-aside warning when keeping the side with fewer decisions`; `merge posts the selected keeper` (switch the radio → `onMerge(otherId, selectedId)`); `disables Merge when the removed side has review work`; `disables Merge when both sides have review work` (Not duplicates still enabled); `resolved pair shows who decided and Undo`; `busy disables every button`.

Run: `npm run test:run -- frontend/lib/duplicates frontend/components/screening/duplicates`
Expected: FAIL — unresolved imports.

- [ ] **Step 2: Implement.** Run → PASS; `npm run typecheck`, `npx eslint frontend/lib/duplicates frontend/components/screening/duplicates`, `check_copy_keys.py` → exit 0.

- [ ] **Step 3: Commit**

```bash
git -C "$WT" add frontend/lib/duplicates frontend/components/screening/duplicates frontend/lib/copy/duplicates.ts
git -C "$WT" commit -m "feat(screening): duplicate pair vocabulary and compare panel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Duplicates workspace (frontend, S2b-3)

**Depends on:** Task 6. **Parallel with:** Task 4 (if still running).

**Files:**
- Create: `frontend/components/screening/duplicates/DuplicatesWorkspace.tsx`, `frontend/components/screening/duplicates/DuplicatePairList.tsx`, `frontend/components/screening/duplicates/__tests__/DuplicatesWorkspace.test.tsx`
- Modify: `frontend/components/screening/ScreeningTab.tsx` (render `DuplicatesWorkspace` for `duplicates`) (+ one test case), `frontend/lib/copy/duplicates.ts`

**Interfaces — Consumes:** Task 5 hooks/errors, Task 6 functions + panel, S0 `ListDetailSplitShell`, S1's list primitives (`components/shared/list/*` as `ScreeningRecordList` uses them). **Produces:** `DuplicatesWorkspace({projectId}: {projectId: string}): JSX.Element`.

Rules (§8.4, §4.6, R12):
- URL: `?status=` (absent → `open`), `?article=` + `?kept=` (selection, `replace`). Rows are pairs; columns Title (removed side's title, kept title as a muted second line), Match chip (`matchPmid` "PMID", `matchDoiTitle` "DOI + title", `matchTitle` "Same title", `matchDoiOnly` "Same DOI, different title"), Sources (`{{a}} · {{b}}`), Year. Status views Open · Exact · Likely · Possible · Resolved with counts from `viewCounts`.
- Shell: `idPrefix="duplicates-shell"`, `escapeCloses`, not maximizable; j/k move, Enter opens, Esc closes (shell chain), via `useKeyboardShortcuts` — keys ignored while a mutation is pending.
- States: pending → skeleton rows (`aria-busy`); error → `ErrorState` with retry; 403 → `ErrorState` `errForbidden`; empty Open/Exact/Likely/Possible → "No open pairs"; empty Resolved → "No resolved pairs"; selection not found once data loaded → drop `article`/`kept` (replace), no toast.
- Actions (each one `useDuplicateVerdicts` call, busy while pending): Merge → `[{article_id: removed, kept_article_id: kept, verdict: 'duplicate'}]`, then toast "Merged" with action "Undo" (posts `cleared` for the same ids) and select the next open pair in list order; Not duplicates → `distinct`, toast "Marked not duplicates" + Undo; Skip → next open pair, no request; Undo on a resolved pair → `cleared`. Any error → `toast.error(duplicatesErrorMessage(e))` and `invalidateQueries(screeningKeys.duplicates(projectId))`.
- Toolbar: "Accept {{n}} exact" (`n = selectAcceptableExact(open).length`, hidden at 0) → `AlertDialog` "Merge {{n}} exact duplicates?" / "Each keeps the suggested record. Pairs where the record to remove has review work are left out." → posts those pairs as `duplicate` with each pair's suggested keeper; toast "Merged {{n}}".
- The read is enabled always (the tab is manager-only and the backend refuses others); it does not depend on the screening config.

Copy keys (add only these): `matchPmid`, `matchDoiTitle`, `matchTitle`, `matchDoiOnly`, `viewOpen` "Open", `viewExact` "Exact", `viewLikely` "Likely", `viewPossible` "Possible", `viewResolved` "Resolved", `colTitle` "Title", `colMatch` "Match", `colSources` "Sources", `colYear` "Year", `noOpenPairs` "No open pairs", `noResolvedPairs` "No resolved pairs", `merged` "Merged", `markedDistinct` "Marked not duplicates", `acceptExact` "Accept {{n}} exact", `acceptExactTitle` "Merge {{n}} exact duplicates?", `acceptExactBody` (above), `mergedMany` "Merged {{n}}", `panelToggle` "Pair details", `loadError` "Could not load duplicates".

- [ ] **Step 1: Write the failing tests** — `DuplicatesWorkspace.test.tsx` (wrap like `TitleAbstractWorkspace.test.tsx`; MSW GET/POST):
  - States: `shows skeleton rows while loading`; `shows an error with retry`; `shows the manager-only error on 403`; `shows "No open pairs"` for each of Open/Exact/Likely/Possible; `shows "No resolved pairs"`.
  - `lists pairs with their match chip and status-view counts`; `filters by status view`.
  - `opens a pair and writes ?article= and ?kept=`; `selects the first open pair for an ?article= in several pairs`; `drops an ?article= that matches no pair`.
  - `merges, toasts with Undo, and Undo posts cleared` (captured bodies `[{…, verdict:'duplicate'}]` then `[{…, verdict:'cleared'}]`); `marks not duplicates`; `Skip moves to the next open pair without a request`; `Undo on a resolved pair posts cleared`.
  - `Accept N exact asks with min(N, 500) and posts the acceptable pairs` (fixture: triple + one pair with review work → label "Accept 2 exact", body has the 2 pairs).
  - `a refused verdict toasts the mapped copy and refetches` (409 `DUPLICATE_KEPT_IS_REMOVED` → toast "The record you chose to keep was already removed as a duplicate.", second GET observed).
  - `buttons are busy and keys ignored while a verdict is in flight` (pending POST: `j` does not move, Merge disabled).
  - `j/k move, Enter opens, Esc closes`.
  - `ScreeningTab.test.tsx`: `renders the Duplicates sub-view for a manager`.

Run: `npm run test:run -- frontend/components/screening`
Expected: FAIL — unresolved `DuplicatesWorkspace`.

- [ ] **Step 2: Implement** and wire it in `ScreeningTab`.

- [ ] **Step 3: Full frontend static set**

Run: `npm run test:run -- frontend/components frontend/hooks frontend/lib frontend/test && npm run typecheck && npm run lint && npm run deadcode && npm run deadcode:production`; fitness `check_copy_keys.py`, `check_react_query_keys.py`, `check_frontend_data_path.py`, `check_file_size.py`, `check_button_scale.py`.
Expected: all PASS / exit 0; knip zero in both modes.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/components/screening frontend/lib/copy/duplicates.ts
git -C "$WT" commit -m "feat(screening): duplicates sub-view with compare, merge, undo and accept exact" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: E2E dedup step and fixtures (frontend, S2b-4)

**Depends on:** Tasks 4, 7. **Parallel with:** none.

**Files:**
- Modify: `frontend/e2e/_fixtures/fixture-ids.ts` (`SCREENING_ARTICLES`), `frontend/e2e/_fixtures/screening.ts` (`ABSTRACTS`, `resetScreeningProject` insert), `frontend/e2e/_fixtures/ensure-fixtures.ts` (`ensureArticle` gains optional `extra: {pmid?, doi?, publication_year?}`), `frontend/e2e/flows/screening.ui.e2e.ts`

Fixture (R6): `SCREENING_ARTICLES` entries gain optional `pmid`; Alpha gets `pmid: "39999901"`; a third entry `{id: "f00dc63a-6b47-42c3-8a93-af69eb28a1c8", title: "E2E Screening Alpha (duplicate record)", pmid: "39999901"}`. `resetScreeningProject` inserts in array order with `created_at` ascending (explicit timestamps one second apart) so Alpha is the oldest and the suggested keeper; `ABSTRACTS` gains the duplicate's abstract (the same text as Alpha).

Flow (dedup step **before** enroll, so S1's counts keep 2 enrolled): owner opens `?tab=screening&screeningTab=duplicates`, sees one Open pair with chip "PMID", opens it, clicks "Merge, keep selected", sees toast "Merged", clicks "Undo", sees the pair back in Open, merges again; then the S1 flow continues unchanged ("Enroll all articles" now enrolls without the "Enroll anyway?" dialog since no pair is open). PRISMA expectations: `identified_total` counts 3 articles, `duplicates_removed` 1, `other_removed` per state — recompute every PRISMA assertion from the §8.4 formulas and write the numbers in the test with a one-line comment each.

- [ ] **Step 1: Update fixtures and the flow.**
- [ ] **Step 2: Run** (only if the local stack is up — it is shared; coordinate, never reset it): `npx playwright test frontend/e2e/flows/screening.ui.e2e.ts --project=local-ui`
Expected: 2 passed. Stack down → say so in the report; CI's Frontend E2E runs it.
- [ ] **Step 3:** `npx tsc --noEmit -p frontend/e2e` (or the repo's e2e typecheck script if `package.json` names one), `npx eslint frontend/e2e/_fixtures frontend/e2e/flows/screening.ui.e2e.ts` → exit 0.
- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/e2e
git -C "$WT" commit -m "test(screening): e2e dedup step — merge, undo, merge before enroll" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Slice verification and design review

**Depends on:** Tasks 1–8. **Files:** none modified; a fix goes back to the owning task's files with its own commit. Throwaway (never committed): `frontend/e2e/flows/__design_review_duplicates.ui.e2e.ts`, screenshots in the session scratchpad.

- [ ] **Step 1: Every S2 gate.** From `$WT`: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npm run deadcode`, `npm run deadcode:production`; `cd backend && uv run pytest -q`, `make -C "$WT" lint-backend`, `uv run alembic check`; fitness: `check_copy_keys`, `check_react_query_keys`, `check_file_size`, `check_retired_symbols`, `check_scope_guards`, `check_button_scale`, `check_api_response_envelope`, `check_frontend_data_path`, `check_rls_coverage`, `check_layered_arch`, `scripts/check_migration_split.sh`; vulture. Expected: every exit 0. Record the Task 2 10k timing.
- [ ] **Step 2: Design review** (`/design-review` skill): local stack up and `:5182` (`npx vite --port 5182`) serving this tree; `make -C "$WT" db-seed-screening` with `--manager-email` = the E2E default user. Throwaway spec: `loginViaUi(page)` (`frontend/e2e/_fixtures/auth.ts`), open the seed project `?tab=screening&screeningTab=duplicates`, screenshot at 1280×800 and 390×844: Open list (panel closed), the open pair in the compare panel, the Resolved view with its pair, the "Accept N exact" dialog, Title/abstract "Enroll anyway?" dialog. Compare per the skill (frontend-ux checklist + Linear references), fix P0/P1, re-capture; `rm` the spec; `git -C "$WT" status --short` clean.

---

## Self-review notes

- Spec coverage: §8.1 → T1; §8.2 → T2; §8.3 routes/rules/edge cases → T2–T4; §8.4 UX → T5–T7, PRISMA → T4; §4 switcher/redirect → T5; §4.6 Duplicates bullets → T7; §5 key + invalidation → T5; §6.4/§6.5 → T2/T3/T5; S2 E2E + seed → T4/T8; S2 gates → T9; every S2 acceptance row maps to a named test above (perf → T2, error maps → T5).
- Interface names are consistent: `removed_duplicate`, `refusing_work`, `review_work`, `selectAcceptableExact`, `findSelectedPair`, `duplicatesQueryOptions`, `useDuplicateVerdicts`, `defaultSectionView`.
