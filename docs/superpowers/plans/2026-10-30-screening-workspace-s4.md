---
status: draft
last_reviewed: 2026-10-31
owner: '@raphaelfh'
---

# Screening workspace S4 — reading upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the screening panel a better reading surface: a 68ch/15px reading column with a parsed structured abstract, PMID/DOI links, type and non-English language chips, MeSH and keyword lines, the protocol criteria beside the record, reviewer notes visible to the arbitrator, and a `?` popover listing every key.

**Architecture:** Backend adds four already-stored `Article` columns to the `ScreeningArticle` wire schema (no migration, no service change). Frontend adds pure helpers (`lib/screening/abstract.ts`, `recordMeta.ts`) and new components (`StructuredAbstract`, `RecordMeta`, `CriteriaPanel`, `DecisionNote`, `ShortcutsHelp`); S1's `RecordBody`, record panel, ruling form and workspace get only wiring edits, so S3's parallel edits to the same panel merge cleanly.

**Tech Stack:** FastAPI + Pydantic v2, pytest on real Postgres; React 19 (React Compiler) + TanStack Query, react-hook-form + Zod, Vitest + MSW + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-30-screening-workspace-design.md` — slice S4 only: §9 "S4 detail", the S4 slice row and S4 acceptance row, §6.4 row `ScreeningArticle … | S4`, §4.5 `?` row, and the §4.4 conflict view it extends. **Base:** S1 (`docs/superpowers/plans/2026-10-30-screening-workspace-s1.md`) — this plan names S1's files and props (`ScreeningRecordPanel`, `ConflictRulingForm`, `AssignmentView`, `TitleAbstractWorkspace`, `seed_screening`) as they exist after S1 merges.

**Scope:** 7 tasks, one PR to `dev`, title `feat(screening): reading upgrades — structured abstract, criteria, notes, shortcuts`. No migration: all four columns exist on `Article` (`backend/app/models/article.py:67,84,97,99`).

## Task graph

| Task | Depends on | Runs in parallel with |
| --- | --- | --- |
| 1 `ScreeningArticle` fields, seed, types (backend) | S1 merged | 2 |
| 2 Pure helpers: abstract parser, record meta (frontend) | S1 merged | 1 |
| 3 Reading column: `StructuredAbstract`, `RecordMeta`, `RecordBody` (frontend) | 1, 2 | — |
| 4 Criteria rail / disclosure (frontend) | 3 | — |
| 5 Reviewer note + notes in the ruling form (frontend) | 4 | — |
| 6 `?` shortcuts popover (frontend) | 5 | — |
| 7 Slice verification + design review | 1–6 | — |

Parallel groups: **G1** {1, 2} → **G2** {3} → **G3** {4} → **G4** {5} → **G5** {6} → **G6** {7}. Tasks 3–6 are sequential because each edits `frontend/lib/copy/screening.ts` and the panel files. Task 2 touches no copy and no component; Task 1 writes `frontend/types/api/*` and the frontend test fixtures it breaks, and Task 2 writes none of those.

## Spec reconciliation (focused gate, 2026-10-31)

One `Explore` seat checked the S4 parts against the tree and the S1 plan. Confirmed: `ScreeningArticle` (`backend/app/schemas/screening.py:52-64`) is built only through `model_validate(…, from_attributes=True)` in `ScreeningReviewService._read` (`screening_review_service.py:398`) from the full `Article` entity (`screening_repository.py:176-186`), so adding fields needs no query change; `rationale` is stored (`models/screening.py:89`), accepted (`ScreeningDecisionCreate.rationale`, `schemas/screening.py:88`, ≤2000) and returned on `PeerDecisionRead`, which only `reveals_peers` (`screening_outcome.py:114-116`) lets through. Rulings (the spec was silent; cost if wrong in brackets):

1. **Notes = reviewer input + arbitrator display.** No UI writes a reviewer `rationale` today (`DecisionButtons.tsx:28-41`), so display-only would always be empty; §9 says "notes" and §7.3 gives FT an "optional note (`rationale`)". S4 adds an optional note to the TA decision (existing decide field, no new write path) and shows each reviewer's note to the arbitrator in the conflict ruling form only (spec §9 scope; the read-only peer list after an outcome does not show notes). The note is empty per decision; a solo re-decide starts blank. [Drop `DecisionNote` + its test.]
2. **Non-English** = trimmed, lower-cased value not in `{eng, en, english}` and not matching `^en[-_]`; null/empty → no chip. Chip text: a small ISO 639-2 name map (`spa` Spanish, `por` Portuguese, `fre` French, `ger` German, `chi` Chinese, `jpn` Japanese, `ita` Italian, `rus` Russian, `dut` Dutch, `kor` Korean), else the raw trimmed value. PubMed stores ISO 639-2 B codes (`article_source_normalization.py:248`); RIS and the manual form store free text. [Trivial.]
3. **Type chip** hidden for generic journal-article values (`journal article`, `journalarticle`, `jour`, case-insensitive), else shown through `formatZoteroItemTypeForDisplay` (`frontend/lib/zoteroItemTypes.ts:64`). Known limit: PubMed stores the first `PublicationType` only (`_pubmed_article_type`, `:182-186`). [Trivial.]
4. **MeSH / keywords**: null or empty hides the line; all terms, joined with " · ", no truncation.
5. **`parseStructuredAbstract`**: a label is `^([A-Z][A-Z0-9 ,/&()'-]{0,39}):\s+` at the start of a line or paragraph (the PubMed import writes `LABEL: text` paragraphs joined by `\n\n`, `_pubmed_abstract` `:146-154`); ≥ 2 labelled sections, else plain text; a leading unlabelled paragraph is an untitled section; inline labels are not split. `max-w-[68ch]` + `text-[15px]` apply to the reading column (title, byline, meta, abstract), not the decision bar.
6. **Links**: PMID → `https://pubmed.ncbi.nlm.nih.gov/<pmid>/`; DOI through `doiUrl` (`frontend/lib/doi.ts:5`); both `target="_blank" rel="noopener noreferrer"`; each hidden when null.
7. **`?` popover** renders from one list `SHORTCUT_ROWS` inside `ShortcutsHelp.tsx` (display only: the bindings live in S1's hooks and `DecisionButtons`, so no shared registry module — panel advisory), so "lists every key" is testable; `DecisionButtons`' `keyboardHint` line (S1-owned) stays; trigger is an `IconButton` in the TA toolbar; `?` binds as chord `{key: '?', shift: true}` through `useKeyboardShortcuts` (`:96-100` requires the shift flag to match).
8. **Criteria**: `n` = inclusion + exclusion count; hidden at 0; docked → a collapsed "Criteria (n)" disclosure atop the reading column; maximized → a rail, right of the reading column at `lg+` and stacked under it below `lg` (one mount, variant chosen from `maximized` only). Full-text placement is S3's (S3 owns the maximized `RunSplitShell` layout); `CriteriaPanel` is a standalone component S3 can mount. [None to S4.]
9. **Seed**: `seed_screening` gains a PubMed-style structured abstract with MeSH and keywords, a Spanish RCT record, and notes on the conflict record's two decisions, so design review renders every S4 state.

## Global Constraints

- **Worktree.** `WT=/Users/raphaelfedericcihaddad/PycharmProjects/prumo/.claude/worktrees/screening-workspace-s4` (branch `screening-workspace-s4`). Every command uses absolute paths or `git -C "$WT"`; never touch the main checkout, never `git switch`/`checkout`, never bare `git stash`. After each task, `git -C "$WT" status --short` shows only that task's files.
- **Precondition (S1 merged).** `test -f "$WT/frontend/components/screening/ScreeningRecordPanel.tsx" && test -f "$WT/frontend/components/screening/TitleAbstractWorkspace.tsx" && test -f "$WT/backend/app/seed_screening.py"`. If any fails, stop: `origin/dev` with S1 must be merged into the branch first.
- **S1 shipped shapes (pre-checked 2026-10-31 against S1 Tasks 1–6).** `DecisionButtons({reasons, disabled, onDecide(body), phase: 'title_abstract', recorded})` — pressing the recorded value is a no-op; `screeningKeyAction(event, armed, phase)`; `ListDetailSplitShell` controlled `maximized`/`onMaximizedChange`; `useScreeningRecords(projectId, phase, enabled)`; `ScreeningRecordsRead.inclusion_criteria`/`exclusion_reasons`; `createQueryWrapper()` (`frontend/test/helpers/queryClientWrapper.tsx`) for hook/component tests.
- **S1 drift.** Names below come from the S1 plan. If S1's shipped code differs (a prop or file name), adapt to the shipped name and say so in the task report; never re-create an S1 file.
- **Parallel slices.** S2 and S3 edit the same panel in parallel. Keep edits to S1 files to the wiring this plan names; new behaviour goes in the new files.
- **English only** — code, comments, commits, copy keys and copy.
- **No model change ⇒ no migration.** If a task finds it needs one, stop and report.
- **Generated types.** After the schema edit run `npm run generate:api-types` from `$WT`; commit `frontend/types/api/openapi.json` + `schema.d.ts`; never hand-edit. Only Task 1 regenerates.
- **Frontend data path.** No new query, service or endpoint in S4. Copy through `t('screening', key)`; `{{x}}` placeholders filled with `.replace('{{x}}', …)`.
- **Forms.** react-hook-form + Zod for the note (constitution §VI; the `ConflictCard` note precedent, `ConflictsPanel.tsx:30-56`, now in S1's `ConflictRulingForm`).
- **React Compiler** (`panicThreshold: 'all_errors'`): no ref read/write during render; no `try/finally` or `throw` inside `try` in a component/hook body; `useWatch`, never `form.watch()`; read form values in handlers (`getValues`), not during render.
- **Keyboard.** New bindings only through `useKeyboardShortcuts` (input + dialog guards). Decision keys stay in `DecisionButtons`' listener, whose `isTextTarget` (`keymap.ts:22-29`) keeps them inert while typing a note.
- **UI primitives.** Icon-only controls use `IconButton` (`frontend/components/patterns/IconButton.tsx`; gate `check_ui_primitives.py`); disclosure = `frontend/components/ui/collapsible.tsx`; popover = `ui/popover.tsx`; keys = `KbdBadge` (`ui/kbd-badge.tsx`).
- **Post-edit hook** runs `ruff check --fix` / `eslint --fix` and strips unused imports: add an import in the same edit as its first use.
- **No dead code** (CI-gated). Task 2's exports have no production consumer until Task 3 (noted there); from Task 3 on `npm run deadcode` and `npm run deadcode:production` are zero. Every new copy key has a consumer in the task that adds it (`check_copy_keys.py`).
- **Commands.** Frontend from `$WT` (never `cd frontend`): `npm run test:run -- <paths>`, `npm run typecheck`, `npx eslint <files>`, `npm run deadcode`, `npm run deadcode:production`, `npm run generate:api-types`. No `npx` on PATH → `~/.local/bin/mise exec node@24 -- <cmd>`. No `node_modules` in `$WT` → `npm ci` (never symlink). Fitness: `cd "$WT/backend" && uv run --frozen python ../scripts/fitness/<check>.py`.
- **Backend integration DB.** Per-worktree Postgres on port **55434**: `docker run -d --name prumo-s4-pg -p 55434:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres postgres:17` (reuse if running); `$WT/backend/.env` with fake values only (`DATABASE_URL=postgresql://postgres:postgres@localhost:55434/postgres`, `SUPABASE_URL=http://localhost:54321`, `SUPABASE_SERVICE_ROLE_KEY=stub-service-role`, `SUPABASE_ENV=local`, `OPENAI_API_KEY=sk-test-not-real`); from `$WT/backend`: `uv sync --frozen --extra dev`, `psql postgresql://postgres:postgres@localhost:55434/postgres -f tests/integration/supabase_stub.sql`, `uv run alembic upgrade head`, `uv run python -m app.seed`. Never `make db-fresh`/`reset-db`. `docker` may need the unsandboxed retry.
- **Commits:** conventional, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A seated reviewer in a conflict whose peer wrote a note.** The note must not reach them, nor a seated arbitrator (no peer object at all) — Task 1 `test_peer_note_stays_hidden_from_seated_seats`.
2. **Prose that looks like a label** ("Note: …", "HIV: …" alone, "Results: …" mixed case, inline "BACKGROUND: … METHODS: …" in one line). Plain text, not a broken section list — Task 2 parser cases.
3. **Typing a note, then a digit.** The digit goes into the note, not a decision; a click on Include sends the note — Task 5 `typing 1 in the note decides nothing`.
4. **Switching records with a half-written note.** The next record's note starts empty; the text never posts on the wrong assignment — Task 5 `resets the note when the assignment changes`.
5. **`?` while typing in search or with a dialog open.** Nothing opens — Task 6 `? is inert in a text field and under a dialog`.

---

### Task 1: `ScreeningArticle` reading fields, seed, generated types (backend)

**Depends on:** S1 merged. **Parallel with:** Task 2.

**Files:**
- Modify: `backend/app/schemas/screening.py` (`ScreeningArticle`, `:52-64`)
- Create: `backend/tests/unit/test_screening_article_schema.py` (not `test_screening_schema.py` — that name is the DB-schema integration test)
- Modify: `backend/tests/integration/test_screening_review.py`
- Modify: `backend/app/seed_screening.py` (S1)
- Regenerate: `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`
- Modify: every frontend test fixture whose `article` literal stops type-checking (find with `npm run typecheck`; expect S1's `ScreeningRecordPanel.test.tsx`, `ConflictRulingForm.test.tsx`, `AssignmentView.test.tsx`)

**Interfaces:**
- Produces (wire + `ScreeningAssignmentRead['article']` in TS):

```python
# ScreeningArticle gains, after doi:
mesh_terms: list[str] | None
keywords: list[str] | None
article_type: str | None
language: str | None
```

No defaults: like the existing fields they are always serialized from the full `Article`, so the TS contract stays `T | null` (required). Add `mesh_terms=None, keywords=None, article_type=None, language=None` to the explicit unit fixtures (`test_screening_review_unit.py:39-49`, `test_screening_arbitration_unit.py:42-51`). No service, repository or endpoint change.

- [ ] **Step 1: Write the failing tests**
  - `test_screening_article_schema.py::test_screening_article_wire_fields` — `set(ScreeningArticle.model_fields) == {"id", "title", "abstract", "authors", "journal_title", "publication_year", "pmid", "doi", "mesh_terms", "keywords", "article_type", "language"}`; `model_fields["mesh_terms"].annotation == list[str] | None` and the same for `keywords`; `article_type`/`language` annotation `str | None` (precedent `tests/unit/test_project_details_schema.py:47-49`).
  - `test_screening_review.py::test_assignment_read_carries_the_reading_fields` — `_project(rc=1, reviewers=1)`, then `UPDATE public.articles SET mesh_terms = ARRAY['Sepsis','Humans'], keywords = ARRAY['triage'], article_type = 'Randomized Controlled Trial', language = 'spa' WHERE id = :aid AND project_id = :pid` (`.claude/rules/backend.md` § Tests: setup scoped by project); GET the assignment as the reviewer → `article` has exactly those four values.
  - `test_screening_review.py::test_peer_note_stays_hidden_from_seated_seats` — `rc=2`; A (reviewer) posts `{"decision": "include", "rationale": "Adults only"}` (use `_request` directly), B (a `consensus` member, i.e. a seated arbitrator — the `test_screening_arbitration.py` role helper) posts exclude "Not ML" with `"rationale": "Not a model"`; A's and B's views → `peer_decisions == []`; manager (unseated arbitrator) view → each peer's `rationale` equals what that member wrote.
  - `tests/integration/test_seed_screening.py` (S1) `::test_seed_carries_the_reading_states` — after `build`: the article at `_ARTICLES[1]` has an abstract starting `"BACKGROUND:"` and `mesh_terms == ["Sepsis", "Humans", "Adult"]`; `_ARTICLES[3]` has `language == "spa"`; the conflict record's (`_ARTICLES[0]`) two decisions carry the Step 3 rationales (extend the existing `test_seed_builds_a_conflict_the_manager_can_rule` setup or add a sibling test).

Run: `cd "$WT/backend" && uv run pytest tests/unit/test_screening_article_schema.py tests/integration/test_screening_review.py tests/integration/test_seed_screening.py -x -q`
Expected: FAIL — wire-field set, the reading-fields case and the seed case; the note case may already pass (it pins existing behaviour).

- [ ] **Step 2: Implement** the four fields; `npm run generate:api-types`; fix the frontend fixtures `npm run typecheck` reports (add the four fields as `null`).

- [ ] **Step 3: Extend `seed_screening.build`** (Rulings 9; S1 shape: `_ARTICLES` tuples, 0-based, and a `decisions` tuple fed to `add_decision(…, reason, None)`): add a module-level `_READING: dict[int, dict[str, Any]]` merged into the `Article(...)` kwargs by index — index 1 (consensus include): `abstract="BACKGROUND: Sepsis is common.\n\nMETHODS: We randomised 120 adults.\n\nRESULTS: Mortality fell.\n\nCONCLUSIONS: Early triage helps."`, `mesh_terms=["Sepsis", "Humans", "Adult"]`, `keywords=["triage", "emergency"]`, `article_type="Journal Article"`, `language="eng"`; index 3 (one reviewer decided): `article_type="Randomized Controlled Trial"`, `language="spa"`. The `decisions` rows gain a fifth element `rationale` passed as `add_decision`'s last argument: index 0 r1 `"Adults with sepsis, meets inclusion"`, index 0 r2 `"Paediatric cohort"`, every other row `None`. Keep every other S1 seed value.

- [ ] **Step 4: Run to verify it passes**, then `make -C "$WT" lint-backend`, `npm run typecheck`, and `cd "$WT/backend" && uv run pytest tests/unit -q -k screening`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git -C "$WT" add backend/app/schemas/screening.py backend/app/seed_screening.py backend/tests frontend/types/api frontend/components/screening
git -C "$WT" commit -m "feat(screening): carry MeSH, keywords, type and language on the screened article" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure helpers — abstract parser, record meta (frontend)

**Depends on:** S1 merged. **Parallel with:** Task 1 (touches no `frontend/types/api/*`, no copy file, no component).

**Files:**
- Create: `frontend/lib/screening/abstract.ts`, `frontend/lib/screening/abstract.test.ts`
- Create: `frontend/lib/screening/recordMeta.ts`, `frontend/lib/screening/recordMeta.test.ts`

**Interfaces (produces):**

```ts
// abstract.ts
export interface AbstractSection { label: string | null; text: string }
/** null → render the raw abstract as plain text (Rulings 5). */
export function parseStructuredAbstract(raw: string): AbstractSection[] | null;

// recordMeta.ts
export function languageChipLabel(raw: string | null | undefined): string | null;   // null for English/empty (Rulings 2)
export function articleTypeChipLabel(raw: string | null | undefined): string | null; // null for generic journal article (Rulings 3)
export function pubmedUrl(pmid: string | null | undefined): string | null;          // trimmed digits only, else null
```

Knip: these exports gain production consumers in Task 3; `npm run deadcode` is expected to list them until then — say so in the report.

- [ ] **Step 1: Write the failing tests**
  - `abstract.test.ts`: `parses PubMed labelled paragraphs` (the Task 1 seed string → 4 sections `BACKGROUND`/`METHODS`/`RESULTS`/`CONCLUSIONS` with their texts); `keeps a leading unlabelled paragraph as an untitled section`; `accepts labels with spaces, slash, ampersand and digits` (`"METHODS/DESIGN: a\n\nCONCLUSIONS AND RELEVANCE: b"`); `returns null for prose such as "Note: …"` (`"Note: this is prose.\n\nMore prose."`); `returns null for one label only` (`"HIV: a disease."`); `returns null for mixed-case labels` (`"Background: a\n\nMethods: b"`); `returns null for inline labels on one line` (`"BACKGROUND: a. METHODS: b."`); `returns null for a label over 40 characters`; `returns null for empty or whitespace`.
  - `recordMeta.test.ts`: `languageChipLabel` → `null` for `eng`, `EN`, `English`, `en-GB`, `en_US`, `''`, `'  '`, `null`; `'Spanish'` for `spa`; `'Portuguese'` for `por`; `'Deutsch'` stays `'Deutsch'` (raw); `articleTypeChipLabel` → `null` for `Journal Article`, `journalArticle`, `JOUR`, `null`; `'Randomized Controlled Trial'` stays; `'conferencePaper'` → `'Conference Paper'` (through `formatZoteroItemTypeForDisplay`); `pubmedUrl('12345')` → `'https://pubmed.ncbi.nlm.nih.gov/12345/'`, `pubmedUrl(' 12345 ')` same, `pubmedUrl('abc')` → `null`, `pubmedUrl(null)` → `null`.

Run: `npm run test:run -- frontend/lib/screening/abstract.test.ts frontend/lib/screening/recordMeta.test.ts`
Expected: FAIL — unresolved imports.

- [ ] **Step 2: Implement** the three modules. Parser: split on `/\n\s*\n|\n/`, trim, drop empties; match each part against the Rulings 5 regex; structured iff ≥ 2 parts match and every part after the first labelled one is labelled; else `null`.

- [ ] **Step 3: Run to verify it passes**, then `npm run typecheck && npx eslint frontend/lib/screening`
Expected: PASS, exit 0.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/lib/screening/abstract.ts frontend/lib/screening/abstract.test.ts frontend/lib/screening/recordMeta.ts frontend/lib/screening/recordMeta.test.ts
git -C "$WT" commit -m "feat(screening): add the structured-abstract parser and record meta rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Reading column — `StructuredAbstract`, `RecordMeta`, `RecordBody` (frontend)

**Depends on:** Tasks 1, 2.

**Files:**
- Create: `frontend/components/screening/StructuredAbstract.tsx`, `frontend/components/screening/RecordMeta.tsx`
- Modify: `frontend/components/screening/ScreeningParts.tsx` (`RecordAbstract`, `RecordBody`, `:50-74` pre-S1)
- Modify: `frontend/components/screening/ScreeningRecordPanel.tsx` (S1's `NotEnrolledBody`: its PMID/DOI line becomes `<RecordIdentifiers article={…} />` — one-line wiring)
- Modify: `frontend/lib/copy/screening.ts`
- Create: `frontend/components/screening/__tests__/RecordBody.test.tsx`

**Interfaces:**
- Consumes: `parseStructuredAbstract`, `languageChipLabel`, `articleTypeChipLabel`, `pubmedUrl` (Task 2), `doiUrl`, the four `ScreeningArticle` fields (Task 1).
- Produces:

```ts
export function StructuredAbstract({abstract}: {abstract: string}): JSX.Element;
// RecordMeta.tsx
export function RecordIdentifiers({article}: {article: Pick<ScreeningArticle, 'pmid' | 'doi'>}): JSX.Element | null;
export function RecordChips({article}: {article: Pick<ScreeningArticle, 'article_type' | 'language'>}): JSX.Element | null;
export function RecordTerms({article}: {article: Pick<ScreeningArticle, 'mesh_terms' | 'keywords'>}): JSX.Element | null;
```

Layout: `RecordBody`'s `<article>` gets `mx-auto w-full max-w-[68ch] text-[15px]`; order: chips row (`RecordChips`) → title `h2` → byline → `RecordIdentifiers` (`PMID 12345 · DOI 10.x/y`, each a link per Rulings 6, `text-[13px]`) → abstract (`StructuredAbstract` when the parser returns sections, else today's `whitespace-pre-line` paragraph at `leading-relaxed`; `noAbstract` unchanged) → `RecordTerms` (two `text-[13px] text-muted-foreground` lines, "MeSH" and "Keywords" labels). Each labelled section is a `<section>` with an `h3` (`text-[13px] font-semibold uppercase tracking-wide text-muted-foreground`) and a `<p>`; an untitled section is the `<p>` alone. Chips use the existing `Badge` `variant="outline"`. A null `abstract` still shows `RecordTerms`.

Copy keys: `pmidLabel` "PMID", `doiLabel` "DOI", `meshLabel` "MeSH", `keywordsLabel` "Keywords", `languageChipAria` "Language: {{language}}", `typeChipAria` "Article type: {{type}}".

- [ ] **Step 1: Write the failing tests** in `RecordBody.test.tsx`:
  - `renders labelled sections for a structured abstract` (headings `BACKGROUND`…`CONCLUSIONS` by role `heading`, level 3).
  - `renders plain text for prose that looks like a label` (`"Note: x.\n\nMore."` → no level-3 heading, text present).
  - `links PMID and DOI in a new tab` (href `https://pubmed.ncbi.nlm.nih.gov/123/`, `https://doi.org/10.1/x`; `target="_blank"`, `rel` contains `noopener`); `hides an identifier that is null`.
  - `shows a language chip only for a non-English record` (`spa` → "Spanish"; `eng` → none); `shows a type chip unless it is a generic journal article`.
  - `shows MeSH and keyword lines, hidden when empty` (`[]` and `null` → no "MeSH" text).
  - `constrains the reading column to 68ch at 15px` (the `<article>` has classes `max-w-[68ch]` and `text-[15px]`).
  - `shows "No abstract" with terms still listed`.

Run: `npm run test:run -- frontend/components/screening/__tests__/RecordBody.test.tsx`
Expected: FAIL — no headings, links or chips.

- [ ] **Step 2: Implement** the two components, the `RecordBody`/`RecordAbstract` wiring, the `NotEnrolledBody` identifier line, copy keys.

- [ ] **Step 3: Run to verify it passes**, then `npm run test:run -- frontend/components/screening && npm run typecheck && npx eslint frontend/components/screening` and `… check_copy_keys.py`, `… check_button_scale.py`
Expected: PASS, exit 0.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/components/screening frontend/lib/copy/screening.ts
git -C "$WT" commit -m "feat(screening): structured abstract, identifiers, chips and terms in the reading column" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Criteria rail and disclosure (frontend)

**Depends on:** Task 3.

**Files:**
- Create: `frontend/components/screening/CriteriaPanel.tsx`, `frontend/components/screening/__tests__/CriteriaPanel.test.tsx`
- Modify: `frontend/components/screening/ScreeningRecordPanel.tsx` (props + layout wiring), `frontend/components/screening/TitleAbstractWorkspace.tsx` (pass the props)
- Modify: `frontend/lib/copy/screening.ts`
- Modify: `frontend/components/screening/__tests__/ScreeningRecordPanel.test.tsx`, `TitleAbstractWorkspace.test.tsx` (S1)

**Interfaces:**
- Consumes: `ScreeningRecordsRead.inclusion_criteria` / `.exclusion_reasons` (S1 records read top level), the workspace's controlled `maximized` (S1).
- Produces:

```ts
export interface ScreeningCriteria { inclusion: string[]; exclusion: string[] }
export function CriteriaPanel({criteria, variant}: {criteria: ScreeningCriteria; variant: 'rail' | 'disclosure'}): JSX.Element | null; // null when both lists are empty
// ScreeningRecordPanelProps gains:
criteria: ScreeningCriteria;
maximized: boolean;
```

Layout rules (Rulings 8): panel body with a record → when `maximized`: `CriteriaPanel variant="rail"` beside the reading column in a grid (`grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]`; rail right at `lg+`, stacked under the record below `lg`); when docked: `variant="disclosure"` above the reading column. Exactly one variant is mounted. Disclosure: `Collapsible`, closed by default, trigger "Criteria ({{n}})" (`n` = total), content two headed lists. Rail: `aside` with the same two headed lists, always open, sticky top. An empty list's heading is omitted. The placeholder (no row) shows no criteria.

Copy keys: `criteriaToggle` "Criteria ({{n}})", `criteriaInclusion` "Include if", `criteriaExclusion` "Exclude if", `criteriaRailLabel` "Screening criteria".

- [ ] **Step 1: Write the failing tests**
  - `CriteriaPanel.test.tsx`: `disclosure is collapsed and counts every criterion` (2 inclusion + 3 exclusion → button "Criteria (5)", `aria-expanded="false"`, lists hidden; click → both headings and items); `rail lists both groups open` (`complementary` role named "Screening criteria"); `renders nothing with no criteria`; `omits the heading of an empty group`.
  - `ScreeningRecordPanel.test.tsx`: `docked shows the criteria disclosure and no rail` (no `complementary` "Screening criteria"); `maximized shows the rail and no disclosure` (no "Criteria (n)" button).
  - `TitleAbstractWorkspace.test.tsx`: `passes the protocol criteria from the records read to the panel` (records MSW with `inclusion_criteria: ['Adults']`, `exclusion_reasons: ['Not ML']`; open a row → "Criteria (2)"); `passes maximized to the panel` ("Start screening" → `complementary` "Screening criteria" present, no "Criteria (2)" button).

Run: `npm run test:run -- frontend/components/screening/__tests__/CriteriaPanel.test.tsx frontend/components/screening/__tests__/ScreeningRecordPanel.test.tsx frontend/components/screening/__tests__/TitleAbstractWorkspace.test.tsx`
Expected: FAIL — unresolved import; missing props.

- [ ] **Step 2: Implement** `CriteriaPanel`, the panel props and layout, the workspace wiring, copy keys.

- [ ] **Step 3: Run to verify it passes**, then `npm run test:run -- frontend/components/screening && npm run typecheck && npx eslint frontend/components/screening` and `… check_copy_keys.py`
Expected: PASS, exit 0.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/components/screening frontend/lib/copy/screening.ts
git -C "$WT" commit -m "feat(screening): show the protocol criteria as a rail or a disclosure" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reviewer note and notes in the ruling form (frontend)

**Depends on:** Task 4.

**Files:**
- Create: `frontend/components/screening/DecisionNote.tsx`, `frontend/components/screening/__tests__/DecisionNote.test.tsx`
- Modify: `frontend/components/screening/AssignmentView.tsx` (S1: the To screen and solo re-decide branches build the decide body)
- Modify: `frontend/components/screening/ConflictRulingForm.tsx` (S1: each "Reviewer A/B/C" line shows that reviewer's note)
- Modify: `frontend/lib/copy/screening.ts`
- Modify: `frontend/components/screening/__tests__/ScreeningRecordPanel.test.tsx`, `ConflictRulingForm.test.tsx` (S1)

**Interfaces:**
- Consumes: `ScreeningDecisionCreate.rationale` (≤2000, existing), `PeerDecisionRead.rationale`, `DecisionButtons`' `onDecide(body)` (S1).
- Produces:

```ts
export type DecisionNoteForm = UseFormReturn<{note: string}>;
/** RHF + Zod (`z.object({note: z.string().max(2000)})`, the backend's `rationale` cap), default `{note: ''}`. */
export function useDecisionNoteForm(): DecisionNoteForm;
export function DecisionNote({form, disabled}: {form: DecisionNoteForm; disabled?: boolean}): JSX.Element;
```

Rules (Rulings 1): `DecisionNote` is a ghost "Add note" button that reveals a `Textarea` (`maxLength={2000}`, `rows={2}`, label "Note (optional)"; open by default when the form already has text). It renders above `DecisionButtons` in the To screen and solo re-decide branches only (never for viewers, never in the conflict branch — the arbitrator keeps the ruling form's own note). The decide handler (an event handler, never render) reads `form.getValues('note').trim()` and sends `{...body, rationale}` only when it is non-empty; on success `form.reset()`. The form instance lives in the branch component keyed by assignment id (S1 already keys `DecisionButtons` by it), so another record starts blank. Peer notes: in `ConflictRulingForm` under each reviewer's decision line, `text-[13px] text-muted-foreground`, prefixed "Note:" (`peerNote`), hidden when `rationale` is null. The read-only peer list shows no notes (spec §9 scope). The ruling form still hides names only.

Copy keys: `noteAdd` "Add note", `noteLabel` "Note (optional)", `peerNote` "Note: {{note}}".

- [ ] **Step 1: Write the failing tests**
  - `DecisionNote.test.tsx`: `reveals the textarea from Add note`; `caps the note at 2000 characters` (`maxLength` 2000).
  - `ScreeningRecordPanel.test.tsx`: `sends the note with the decision` (type "Adults only", click Include → POST body `{decision: 'include', rationale: 'Adults only'}`); `omits rationale without a note` (body has no `rationale` key); `typing 1 in the note decides nothing` (focus textarea, type `1` → no POST, textarea value `1`); `resets the note when the assignment changes` (type, rerender with another row → empty); `clears the note after a successful decision`; `trims the note and omits a blank one` (`'  x  '` → `rationale: 'x'`; `'   '` → no key); `a viewer sees no note field`; `solo re-decide sends the note` (`reviewer_count: 1`, decided `include` with `outcome.kind: 'solo'` → "Add note" shown, type "Changed view", press Exclude → body `{decision: 'exclude', …, rationale: 'Changed view'}`); `the conflict branch has no reviewer note field` (arbitrator on a `conflict` record → no "Add note"); `a decided record's peer list shows no notes` (`status: 'decided'`, a peer with `rationale: 'Adults only'` → no "Note: Adults only").
  - `ConflictRulingForm.test.tsx`: `shows each reviewer's note under their label` ("Note: Adults only" next to "Reviewer A"; a peer with `rationale: null` shows no "Note:"); names still absent.

Run: `npm run test:run -- frontend/components/screening/__tests__/DecisionNote.test.tsx frontend/components/screening/__tests__/ScreeningRecordPanel.test.tsx frontend/components/screening/__tests__/ConflictRulingForm.test.tsx`
Expected: FAIL — unresolved import; no note in body or form.

- [ ] **Step 2: Implement** `DecisionNote.tsx`, the decide-branch wiring in `AssignmentView`, the peer-note lines, copy keys.

- [ ] **Step 3: Run to verify it passes**, then `npm run test:run -- frontend/components/screening && npm run typecheck && npx eslint frontend/components/screening` and `… check_copy_keys.py`, `… check_button_scale.py`
Expected: PASS, exit 0.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/components/screening frontend/lib/copy/screening.ts
git -C "$WT" commit -m "feat(screening): let reviewers add a note and show it to the arbitrator" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `?` shortcuts popover (frontend)

**Depends on:** Task 5.

**Files:**
- Create: `frontend/components/screening/ShortcutsHelp.tsx`, `frontend/components/screening/__tests__/ShortcutsHelp.test.tsx`
- Modify: `frontend/components/screening/TitleAbstractWorkspace.tsx` (toolbar slot, one line)
- Modify: `frontend/lib/copy/screening.ts`

**Interfaces:**
- Consumes: `useKeyboardShortcuts`, `IconButton`, `Popover`, `KbdBadge`.
- Produces: `export function ShortcutsHelp(): JSX.Element;`

Rules (Rulings 7): `Popover` controlled by local `open`; trigger `IconButton` (`HelpCircle`, label "Keyboard shortcuts"); `useKeyboardShortcuts` binds `{key: '?', shift: true}` → `setOpen(true)` (inert in text fields and under open overlays by the hook's guards); content `PopoverContent align="end" className="w-72 text-[13px]"`, one row per `SHORTCUT_ROWS` entry (a module-level `const` in `ShortcutsHelp.tsx`, not exported; combo → copy key, every spec §4.5 row in table order: `J / K · ↓ / ↑` shortcutMove; `Enter` shortcutOpen; `Esc` shortcutEsc; `X · ⇧-click · ⌘A` shortcutSelect; `⇧⌘\` shortcutMaximize; `⌘⇧B` shortcutPanel; `1 / 2 / 3` shortcutDecide; `E · 1–9` shortcutReason; `⌘F` shortcutSearch; `F` shortcutFilter; `?` shortcutHelp): `KbdBadge` + `t('screening', copyKey)`. Esc closes it as the first link of the shell's chain (Radix `role=dialog`). `keyboardHint` stays (S1's `DecisionButtons` consumer).

Copy keys: `shortcutsTitle` "Keyboard shortcuts", `shortcutsButton` "Keyboard shortcuts"; `shortcutMove` "Move between records", `shortcutOpen` "Open the record", `shortcutEsc` "Close, one layer at a time", `shortcutSelect` "Select a row · a range · all", `shortcutMaximize` "Maximize the panel", `shortcutPanel` "Show or hide the panel", `shortcutDecide` "Include · Exclude · Maybe", `shortcutReason` "Exclude with a reason", `shortcutSearch` "Search", `shortcutFilter` "Filter", `shortcutHelp` "Show this list".

- [ ] **Step 1: Write the failing tests** in `ShortcutsHelp.test.tsx`:
  - `lists every key` — open via the button; the eleven combos and descriptions above are each present (literal list in the test, the spec §4.5 table).
  - `? opens the popover` — `fireEvent.keyDown(window, {key: '?', shiftKey: true})` → dialog visible.
  - `? is inert in a text field and under a dialog` — focus an `<input>` → no dialog; with another `role="dialog"` open → no second dialog.
  - `Escape closes it`.

Run: `npm run test:run -- frontend/components/screening/__tests__/ShortcutsHelp.test.tsx`
Expected: FAIL — unresolved import.

- [ ] **Step 2: Implement** `ShortcutsHelp`, the toolbar slot, copy keys.

- [ ] **Step 3: Run to verify it passes**, then `npm run test:run -- frontend/components/screening frontend/lib/screening && npm run typecheck && npx eslint frontend/components/screening && npm run deadcode && npm run deadcode:production` and `… check_copy_keys.py`, `… check_ui_primitives.py`
Expected: PASS, exit 0; knip zero.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/components/screening frontend/lib/copy/screening.ts
git -C "$WT" commit -m "feat(screening): add the ? keyboard shortcuts popover" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Slice verification and design review

**Depends on:** Tasks 1–6. **Files:** none modified; a fix goes back to the owning task's files with its own commit. Throwaway (never committed): `frontend/e2e/flows/__design_review_screening_s4.ui.e2e.ts`, screenshots in the session scratchpad.

- [ ] **Step 1: Full test runs** — `npm run test:run` and `cd "$WT/backend" && uv run pytest -q`
Expected: frontend `0 failed`; backend `N passed`, no `FAILED`/`ERROR`.

- [ ] **Step 2: Every S4 gate** (spec §9: the S1 set; expected exit 0 each)
  - `npm run typecheck` · `npm run lint` · `npm run deadcode` · `npm run deadcode:production`
  - from `$WT/backend`: `uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec`
  - from `$WT/backend`, `uv run --frozen python ../scripts/fitness/<x>.py` for `check_copy_keys.py`, `check_react_query_keys.py`, `check_file_size.py`, `check_retired_symbols.py`, `check_scope_guards.py`, `check_button_scale.py`, `check_api_response_envelope.py`, `check_frontend_data_path.py`, `check_ui_primitives.py`
  - `make -C "$WT" lint-backend`
  - `npm run generate:api-types && git -C "$WT" diff --exit-code frontend/types/api`
  - `cd "$WT/backend" && uv run alembic check` → "No new upgrade operations detected"

- [ ] **Step 3: Design review (`/design-review`) of the reading panel**
Vite on port **5184**. `make -C "$WT" db-seed-screening` with `--manager-email` = the E2E default user (`frontend/e2e/_fixtures/fixture-ids.ts`). Throwaway spec: `loginViaUi(page)` (`frontend/e2e/_fixtures/auth.ts`), open the seed project's `?tab=screening`, screenshot at 1280×800 and 390×844: the structured-abstract record docked (criteria disclosure closed and open); the same maximized (rail); the Spanish RCT record (chips); the conflict record (ruling form with notes); the `?` popover. Compare per the design-review skill (frontend-ux checklist + Linear references); fix P0/P1 in the owning files; re-capture. `rm` the spec; `git -C "$WT" status --short` clean.

- [ ] **Step 4: Branch state and PR notes** — `git -C "$WT" status --short && git -C "$WT" log --oneline origin/dev..HEAD`
Expected: clean tree; the task commits in order. PR body records the design-review findings, the Rulings 1–9 above, and the known limit "PubMed stores the first publication type only".
