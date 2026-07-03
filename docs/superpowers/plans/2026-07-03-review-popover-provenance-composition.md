---
status: approved
last_reviewed: 2026-07-03
owner: '@raphaelfh'
---

# Review Popover Slimming + Prompt-Composition Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim the AI review popover to decision content with a hard responsive/scroll contract, and replace the misleading "prompt sent" with per-section structured prompt composition surfaced in a centered dialog.

**Architecture:** Backend persists a per-section provenance snapshot (keyed by `entity_type_id` under `run.results["provenance"]["sections"]`, merged atomically under a row lock) carrying a typed `prompt_composition` block; the read service resolves each suggestion's section snapshot with legacy-flat and mixed-era fallbacks. Frontend bounds the popover via Radix available-height, replaces the inline disclosure with a one-line summary row, and adds a `GenerationDetailsDialog` that renders the composition recipe and lazy-loads the stored article markdown via a new rate-limited endpoint.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async (no schema change — JSONB payload only), Pydantic v2, React 19 + TS strict, TanStack Query, shadcn Dialog/Popover, vitest + MSW + pytest.

**Spec:** `docs/superpowers/specs/2026-07-03-review-popover-provenance-composition-design.md`
**Panel review:** 2026-07-03, five lenses; 4 blocking objections folded in (row-lock merge, second `build_prompt_input` call site, MSW coverage for the markdown path, real integration infra for the repo test) plus the advisories noted per task below.

## Global Constraints

- English only for code, comments, copy keys, commits.
- No SQLAlchemy model change is planned ⇒ no Alembic migration. If any task ends up touching a model, STOP and add the migration + roundtrip head-pin in that same task.
- All user-facing text through `frontend/lib/copy/extraction.ts`; never hardcode strings in components.
- Data flow: component → hook (TanStack Query, keys from `frontend/lib/query-keys/`) → service (`toResult`/`ErrorResult`) → typed `apiClient`. No `fetch()`/`supabase.from` in components.
- React Compiler: no `try/finally` or `throw` in component/hook bodies; IO in services returning `ErrorResult<T>`.
- New endpoints: `ApiResponse` envelope, typed Pydantic response model with camelCase aliases + `populate_by_name=True` (constitution §V), `@limiter.limit` (§IV), membership gate BEFORE any data read, direct endpoint-coroutine unit test (ASGI diff-cover blind spot).
- Endpoint schema change ⇒ `npm run generate:api-types` and commit `frontend/types/api/{openapi.json,schema.d.ts}`.
- Frontend tooling from repo root; backend commands from `backend/`. Vitest single run: `npm run test:run -- <path>`.
- Icon-only/short-label buttons: shadcn Tooltip + `aria-label`, copy via `lib/copy/`.
- Conventional commits, one commit per task.
- Marker constant: `ARTICLE_MARKDOWN_MARKER = "[[ARTICLE_MARKDOWN]]"` (backend), rendered verbatim in `section_instruction`.

## Deliberate deviations & accepted residuals (record, don't re-litigate)

1. **Endpoint path**: `GET /api/v1/articles/{article_id}/content-markdown` (article-scoped, project derived from the article row) instead of the spec's `/projects/{project_id}/...` — matches every sibling articles endpoint and eliminates the path-project vs article-project BOLA mismatch class. Spec §4 amended to match.
2. **Dialog context line has no timestamp** — provenance carries none; the popover's run-group header already shows it.
3. **Same-section re-run residual**: re-running AI on the SAME section of the SAME run overwrites that section's snapshot slot, so older versions of that section show the newest section snapshot. Accepted for this PR (the clean fix is an append-only per-section snapshot list resolved by proposal `created_at` — YAGNI until re-runs on one run are a real workflow). Documented in the spec.

## File Structure

Backend:
- Modify `backend/app/services/extraction_prompt_input.py` — return assembly info (truncated, est_tokens, file_name) alongside text.
- Modify `backend/app/services/model_extraction_service.py:154` — second `build_prompt_input` consumer (2-tuple unpack).
- Modify `backend/app/services/section_extraction_service.py` — typed `prompt_composition`, per-section snapshot incl. per-section tokens, persist via new repo method.
- Create `backend/app/schemas/prompt_composition.py` — `PromptComposition` + `PromptCompositionArticleRef` Pydantic models (the typed spine; `.model_dump()` at the single write site).
- Modify `backend/app/repositories/extraction_run_repository.py` — `merge_provenance_section` under `with_for_update()`.
- Modify `backend/app/services/extraction_suggestion_read_service.py` — per-section resolution with legacy + mixed-era fallback; `_inject_ran_by_names` walks sections.
- Modify `backend/app/api/v1/endpoints/articles.py` (+ schema module of `ArticleFileListItem`) — rate-limited `GET /{article_id}/content-markdown` via `_gate_article`.
- Modify `backend/app/services/article_file_service.py` — `get_content_markdown(article_id)`.

Frontend:
- Modify `frontend/types/ai-extraction.ts`, `frontend/services/aiSuggestionService.ts` — `PromptComposition` mapping.
- Modify `frontend/components/extraction/ai/shared/AIPopoverShell.tsx` — flex column + available-height bound.
- Create `frontend/components/extraction/ai/shared/GenerationDetailsDialog.tsx` — params grid + composition recipe + legacy fallback + markdown expand. The one-line summary row is INLINE in the popover (single consumer — no separate file).
- Delete `frontend/components/extraction/ai/shared/RunProvenanceDisclosure.tsx` (+ test) in Task 10, pruning orphaned copy keys.
- Modify `frontend/components/extraction/ai/AISuggestionReviewPopover.tsx` (summary row + dialog); `frontend/components/extraction/ai/AISuggestionDisplay.tsx` gets ONLY `articleId` threaded through its review binding (it renders no provenance itself — verified).
- Modify `frontend/services/articlesService.ts`, `frontend/lib/query-keys/articles.ts`, create `frontend/hooks/useArticleContentMarkdown.ts`.
- Modify `frontend/lib/copy/extraction.ts` — pruned key set (see Task 8).
- Temporary `frontend/pages/dev/ReviewPopoverHarness.tsx` + DEV route — REMOVED after verification (Task 11 teardown step; run-header precedent).

---

### Task 1: Expose assembly info from `build_prompt_input`

**Files:**
- Modify: `backend/app/services/extraction_prompt_input.py`
- Modify: `backend/app/services/section_extraction_service.py:192-204` (`_assemble_prompt_text`)
- Modify: `backend/app/services/model_extraction_service.py:154` (`pdf_text, _, _ = await build_prompt_input(...)` → 2-tuple)
- Test: `backend/tests/unit/test_extraction_prompt_input.py` (extend), `backend/tests/unit/test_model_extraction_service.py:56,~592` (3-tuple mocks → 2-tuple)

**Interfaces:**
- Produces: `@dataclass(frozen=True) PromptInputInfo(anchor_blocks: list[Any], anchor_file_id: UUID | None, file_name: str | None, truncated: bool, est_tokens: int)` and return `tuple[str, PromptInputInfo]`. No `source` field (log-only concern), `est_tokens` non-optional (both branches always compute it).
- Consumed by Task 3 via `self._prompt_input_info`.

- [ ] **Step 1: Write the failing tests** — in `test_extraction_prompt_input.py`:

```python
@pytest.mark.asyncio
async def test_build_prompt_input_returns_info_on_stored_markdown_branch():
    text, info = await build_prompt_input(...)  # reuse the module's fake repo/file setup
    assert info.truncated is False
    assert info.file_name == fake_file.original_filename
    assert info.anchor_file_id == fake_file.id
    assert isinstance(info.est_tokens, int) and info.est_tokens > 0
```

And extend `test_falls_back_to_assembler_when_markdown_over_budget` (line ~115, already stubs `AssemblyInfo(truncated=True)`): assert `info.truncated is True` and `info.est_tokens` mirrors the assembler's estimate (the truncated=True path must be pinned — panel/coverage finding).

- [ ] **Step 2: Run — expect FAIL** (`cd backend && uv run pytest tests/unit/test_extraction_prompt_input.py -q`): unpack errors.
- [ ] **Step 3: Implement** — add the dataclass; populate from the same locals the `extraction.assembly` log already uses in BOTH branches; return `(text, info)`. Keep the log line unchanged.
- [ ] **Step 4: Update BOTH call sites** (`grep -rn "build_prompt_input" backend/app` must list exactly these two):
  - `section_extraction_service._assemble_prompt_text`: stash `self._prompt_input_info = info`, keep `self._run_anchor_blocks = info.anchor_blocks`, `self._run_anchor_file_id = info.anchor_file_id`; init `self._prompt_input_info: PromptInputInfo | None = None` in `__init__`.
  - `model_extraction_service.py:154`: `pdf_text, _ = await build_prompt_input(...)`.
  - Update the 3-tuple `AsyncMock(return_value=("mocked article text", [], None))` mocks in `test_model_extraction_service.py` to `("mocked article text", PromptInputInfo(anchor_blocks=[], anchor_file_id=None, file_name=None, truncated=False, est_tokens=1))` (import it; or a helper `_fake_info()`).
- [ ] **Step 5: Run** `uv run pytest tests/unit/test_extraction_prompt_input.py tests/unit/test_section_extraction_service.py tests/unit/test_model_extraction_service.py -q`: PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(extraction): expose prompt-input assembly info (truncated, tokens, file)"`

---

### Task 2: `merge_provenance_section` — atomic under a row lock

**Files:**
- Modify: `backend/app/repositories/extraction_run_repository.py`
- Test: `backend/tests/integration/test_extraction_run_repository.py` (CREATE — no integration module exists for this repo today; the unit module mocks the session and cannot catch JSONB-tracking bugs)

**Interfaces:**
- Produces: `async def merge_provenance_section(self, run_id: UUID, entity_type_id: UUID, snapshot: dict[str, Any]) -> ExtractionRun | None`

- [ ] **Step 1: Failing tests** — new integration module; seed a real run (reuse the run-creation pattern from `tests/integration/test_suggestion_read.py:119` / `RunLifecycleService.create_run` with `SEED` ids):

```python
@pytest.mark.asyncio
async def test_merge_provenance_section_keeps_sibling_sections(db_session):
    repo = ExtractionRunRepository(db_session)
    run = await _seed_run(db_session)
    et_a, et_b = uuid4(), uuid4()
    await repo.merge_provenance_section(run.id, et_a, {"model": "m-a"})
    await repo.merge_provenance_section(run.id, et_b, {"model": "m-b"})
    db_session.expire_all()  # force a DB re-read: identity-mapped objects would mask a lost JSONB flush
    updated = await repo.get_by_id(run.id)
    sections = updated.results["provenance"]["sections"]
    assert sections[str(et_a)] == {"model": "m-a"}
    assert sections[str(et_b)] == {"model": "m-b"}

@pytest.mark.asyncio
async def test_merge_provenance_section_missing_run_returns_none(db_session):
    assert await ExtractionRunRepository(db_session).merge_provenance_section(uuid4(), uuid4(), {}) is None

@pytest.mark.asyncio
async def test_merge_provenance_section_preserves_flat_legacy_keys(db_session):
    # run.results["provenance"] pre-seeded flat {"model": "legacy"} → after merge,
    # provenance keeps "model" AND gains "sections" (mixed-era shape, Task 4 relies on it)
```

- [ ] **Step 2: Run — expect FAIL** (`uv run pytest tests/integration/test_extraction_run_repository.py -q`; needs local Supabase up).
- [ ] **Step 3: Implement** — read under a row lock so two concurrent Celery section tasks serialize instead of losing the earlier section (panel blocking finding; the sequential test cannot exercise the race — the lock is the guarantee):

```python
async def merge_provenance_section(
    self, run_id: UUID, entity_type_id: UUID, snapshot: dict[str, Any]
) -> ExtractionRun | None:
    """Merge one section's provenance snapshot under
    ``results["provenance"]["sections"][entity_type_id]``.

    Row-locked read-modify-write: concurrent single-section Celery tasks on
    the same run serialize here instead of last-write-wins clobbering each
    other's section (the sequential tests cannot cover that race). Sibling
    sections and legacy flat keys are preserved; reassign (not mutate) so
    SQLAlchemy tracks the JSONB change.
    """
    run = (
        await self.db.execute(
            select(ExtractionRun).where(ExtractionRun.id == run_id).with_for_update()
        )
    ).scalar_one_or_none()
    if run is None:
        return None
    results = {**(run.results or {})}
    provenance = {**(results.get("provenance") or {})}
    sections = {**(provenance.get("sections") or {})}
    sections[str(entity_type_id)] = snapshot
    provenance["sections"] = sections
    results["provenance"] = provenance
    run.results = results
    await self.db.flush()
    return run
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): row-locked per-section provenance merge"`

---

### Task 3: Typed `prompt_composition` + per-section snapshots

**Files:**
- Create: `backend/app/schemas/prompt_composition.py`
- Modify: `backend/app/services/section_extraction_service.py` — `_build_run_provenance` (152-175), `_provenance_with_tokens` (delete, 177-190), `_extract_with_llm` (1206-1288), `_create_suggestions` choke-point (1575-1581), `extract_for_run` aggregate-provenance block (~455-536).
- Test: `backend/tests/unit/test_section_extraction_service.py`

**Interfaces:**
- Produces (the typed spine — single write site, `.model_dump()` into the snapshot; panel constitution advisory):

```python
class PromptCompositionArticleRef(BaseModel):
    file_id: str | None = None
    file_name: str | None = None
    truncated: bool = False
    est_tokens: int | None = None

class PromptComposition(BaseModel):
    section_name: str
    system_prompt: str
    section_instruction: str
    article_ref: PromptCompositionArticleRef
    fields_requested: list[str]
    llm_calls: int
```

- Snapshot shape: legacy flat keys **minus `prompt_text`** (composition carries the system prompt; duplicating it per section serves no reader — panel YAGNI finding) + `tokens{prompt,completion,total}` + `prompt_composition`.
- Consumed by Task 4 (resolution) and Task 6 (camelCase mapping).

- [ ] **Step 1: Failing tests** (extend the provenance group ~1118; the shared fixture at ~1115 must explicitly stub `service._runs.merge_provenance_section = AsyncMock()` — an auto-attribute would mask a typo'd method name):

```python
def test_build_run_provenance_includes_composition_and_tokens():
    snap = service._build_run_provenance(
        model="gpt-4o-mini", prompt_name="section_extraction", prompt_version="v1",
        usage=LlmUsage(prompt_tokens=10, completion_tokens=5),
        prompt_composition=PromptComposition(
            section_name="S", system_prompt="SYS", section_instruction="I",
            article_ref=PromptCompositionArticleRef(), fields_requested=[], llm_calls=1,
        ),
    )
    assert snap["tokens"] == {"prompt": 10, "completion": 5, "total": 15}
    assert snap["prompt_composition"]["section_name"] == "S"
    assert "prompt_text" not in snap

@pytest.mark.asyncio
async def test_extract_with_llm_builds_marker_composition(...):
    comp = service._run_provenance["prompt_composition"]
    assert ARTICLE_MARKDOWN_MARKER in comp["section_instruction"]
    assert comp["fields_requested"] == [f.name for f in entity_type.fields]
    assert comp["llm_calls"] == 1
    assert comp["article_ref"]["truncated"] is False

@pytest.mark.asyncio
async def test_quality_assessment_composition_uses_qa_template(...):
    # kind="quality_assessment", framework="PROBAST" → marker present AND the
    # framework label rendered in section_instruction (QA branch pinned — panel finding)

@pytest.mark.asyncio
async def test_create_suggestions_persists_section_scoped_provenance(...):
    # merge_provenance_section awaited with (run.id, entity_type_id, snapshot);
    # merge_results NOT called with a "provenance" key

@pytest.mark.asyncio
async def test_extract_for_run_each_section_gets_own_snapshot(...):
    # two entity types through extract_for_run (existing multi-section stubs):
    # merge_provenance_section awaited once per entity_type_id and each call's
    # snapshot carries THAT section's name (guards the shared-instance-state
    # cross-attribution hazard on self._run_provenance)
```

Rewrite (not delete) the stale guards: `test_persists_provenance_at_chokepoint_when_llm_ran` (:1118) and `test_skips_provenance_when_no_llm_ran` (:1146) now assert `merge_provenance_section` semantics; `test_extract_for_run_provenance_has_full_token_shape` (:541) asserts per-section `tokens`; `test_build_run_provenance_shape` (:1277) asserts the new shape (no `prompt_text`); delete `test_provenance_with_tokens_*` (:1298, :1319) with their function.

- [ ] **Step 2: Run — expect FAIL** (`uv run pytest tests/unit/test_section_extraction_service.py -k "composition or section_scoped or own_snapshot" -q`).
- [ ] **Step 3: Implement**:

`ARTICLE_MARKDOWN_MARKER = "[[ARTICLE_MARKDOWN]]"` at module top of `section_extraction_service.py`.

`_build_run_provenance(model, prompt_name, prompt_version, usage=None, prompt_composition=None)` — drop the `prompt_text` param; append:

```python
if usage is not None:
    snapshot["tokens"] = {
        "prompt": usage.prompt_tokens,
        "completion": usage.completion_tokens,
        "total": usage.total_tokens,
    }
if prompt_composition is not None:
    snapshot["prompt_composition"] = prompt_composition.model_dump()
```

In `_extract_with_llm` after the prompt branch (~1254):

```python
if kind == "quality_assessment":
    instruction = quality_assessment.render(
        entity_name=entity_name, entity_description=entity_description,
        article_text=ARTICLE_MARKDOWN_MARKER, framework=framework,
        memory_context=memory_context,
    )
else:
    instruction = section_extraction.render(
        entity_name=entity_name, entity_description=entity_description,
        article_text=ARTICLE_MARKDOWN_MARKER, memory_context=memory_context,
    )
info = self._prompt_input_info
composition = PromptComposition(
    section_name=entity_name,
    system_prompt=system_prompt,
    section_instruction=instruction,
    article_ref=PromptCompositionArticleRef(
        file_id=str(info.anchor_file_id) if info and info.anchor_file_id else None,
        file_name=info.file_name if info else None,
        truncated=info.truncated if info else False,
        est_tokens=info.est_tokens if info else None,
    ),
    fields_requested=[str(f.name) for f in (getattr(entity_type, "fields", None) or [])],
    llm_calls=len(output_models),
)
```

End of `_extract_with_llm` (1282-1287): `self._run_provenance = self._build_run_provenance(model=model, prompt_name=prompt_module.NAME, prompt_version=prompt_module.VERSION, usage=usage, prompt_composition=composition)` (the loop-accumulated `usage` is section-scoped here).

`_create_suggestions` choke-point (1575-1581):

```python
provenance = self._run_provenance
if count and provenance is not None:
    await self._runs.merge_provenance_section(run.id, entity_type_id, provenance)
```

Delete `_provenance_with_tokens`; remove `extract_for_run`'s run-level aggregate provenance merge (~520-536) — per-section snapshots carry tokens; run-aggregate `tokens_*` from `complete_run` untouched.

- [ ] **Step 4: Run the whole unit module — PASS.** Then `uv run pytest tests/integration/test_section_extraction_evidence.py -q`.
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): per-section provenance snapshots with typed prompt composition"`

---

### Task 4: Read-path section resolution + legacy & mixed-era fallback

**Files:**
- Modify: `backend/app/services/extraction_suggestion_read_service.py` — `_load_run_provenance` (85-111), `_inject_ran_by_names` (114-145), `get_suggestion_history` (314-410), `load_suggestions`.
- Test: `backend/tests/integration/test_suggestion_read.py`

**Interfaces:**
- Produces: `def _resolve_section_provenance(provenance, entity_type_id) -> dict | None` — items carry the RESOLVED snapshot, never the `sections` map.

- [ ] **Step 1: Failing tests**:

```python
async def test_history_resolves_section_scoped_provenance(db_session): ...
    # sections shape → item provenance == section snapshot, "sections" absent from item

async def test_history_falls_back_to_legacy_flat_provenance(db_session): ...
    # flat shape (no sections) → unchanged passthrough

async def test_mixed_era_run_falls_back_to_flat_for_presection_suggestions(db_session): ...
    # provenance = {"model": "legacy", "prompt_text": "SYS", "sections": {other_et: {...}}}
    # proposal on an entity type NOT in sections → item gets the FLAT snapshot
    # (pre-deploy sections of a live run must not lose their display — panel finding)

async def test_pure_sectioned_run_missing_section_yields_none(db_session): ...
    # provenance = {"sections": {other_et: {...}}} (no flat keys) → provenance is None
    # (never a sibling section's snapshot — the mis-attribution guard)

async def test_ran_by_name_resolved_inside_sections(db_session): ...

async def test_load_suggestions_resolves_sections_via_instance_map(db_session): ...
    # the non-history path resolves per proposal's instance entity type too
```

- [ ] **Step 2: Run — expect FAIL** (`uv run pytest tests/integration/test_suggestion_read.py -k "section or mixed or legacy_flat" -q`).
- [ ] **Step 3: Implement**:

```python
_FLAT_SNAPSHOT_KEYS = ("model", "provider", "prompt_version", "prompt_text")

def _resolve_section_provenance(
    provenance: dict[str, Any] | None, entity_type_id: UUID | None
) -> dict[str, Any] | None:
    """Per-section snapshot for sectioned runs; flat snapshot for legacy runs.
    Mixed-era runs (flat keys + sections on one run) fall back to the flat
    snapshot for sections extracted pre-deploy. A pure-sectioned run with no
    snapshot for this entity type yields None — never a sibling's snapshot."""
    if not provenance:
        return None
    sections = provenance.get("sections")
    if not isinstance(sections, dict):
        return provenance
    snap = sections.get(str(entity_type_id)) if entity_type_id else None
    if snap is not None:
        return snap
    if any(k in provenance for k in _FLAT_SNAPSHOT_KEYS):
        return {k: v for k, v in provenance.items() if k != "sections"}
    return None
```

- `_inject_ran_by_names`: collect `ran_by_user_id` from flat snapshots AND every `sections` value; inject into both (in place — resolved references see it).
- `get_suggestion_history`: instance already loaded for scope validation (337-339) → `_resolve_section_provenance(prov_by_run.get(p.run_id), instance.entity_type_id)`.
- `load_suggestions`: build `instance_id → entity_type_id` map (reuse loaded instances if present, else one `select(ExtractionInstance.id, ExtractionInstance.entity_type_id).where(...in_(instance_ids))`) and resolve per item.

- [ ] **Step 4: Run the module — PASS** (update the two existing provenance tests' seeds where they assert new behavior; keep one legacy-shape test as the fallback guard).
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): resolve per-section provenance on the suggestion read path"`

---

### Task 5: `GET /{article_id}/content-markdown` endpoint

**Files:**
- Modify: `backend/app/api/v1/endpoints/articles.py` (reuse `_gate_article`, lines 49-55)
- Modify: `backend/app/services/article_file_service.py`
- Modify: the schema module holding `ArticleFileListItem` (add `ArticleContentMarkdownResponse`)
- Test: `backend/tests/unit/test_articles_content_markdown_unit.py` (create), `backend/tests/integration/test_articles_content_markdown.py` (create)
- Modify (generated): `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`

**Interfaces:**
- Produces: `GET /api/v1/articles/{article_id}/content-markdown` → `ApiResponse[ArticleContentMarkdownResponse]`; camelCase wire (§V aliases like sibling `ArticleFileListItem`): `{fileName: string | null, contentMarkdown: string | null}` — slim response, no dead fields (panel YAGNI finding). Service: `ArticleFileService.get_content_markdown(article_id) -> ArticleFile | None`.
- Consumed by Task 9 (frontend reads camelCase directly, matching `articlesService`'s existing style).

- [ ] **Step 1: Failing unit tests** (direct coroutine — ASGI blind-spot pattern from `test_form_runs_endpoint_unit.py`; gate ORDER pinned, not just presence — panel security finding):

```python
@pytest.mark.asyncio
async def test_content_markdown_endpoint_gates_then_reads():
    aid = uuid4()
    af = MagicMock(original_filename="a.pdf", content_markdown="# md")
    with (
        patch(f"{_EP}._gate_article", AsyncMock()) as gate,
        patch(f"{_EP}.ArticleFileService") as svc,
    ):
        svc.return_value.get_content_markdown = AsyncMock(return_value=af)
        resp = await get_article_content_markdown(
            article_id=aid, request=MagicMock(), db=AsyncMock(), current_user_sub=uuid4()
        )
    gate.assert_awaited_once()
    assert resp.ok is True
    assert resp.data.content_markdown == "# md"

@pytest.mark.asyncio
async def test_content_markdown_endpoint_denies_before_reading():
    with (
        patch(f"{_EP}._gate_article", AsyncMock(side_effect=HTTPException(status_code=403))),
        patch(f"{_EP}.ArticleFileService") as svc,
    ):
        svc.return_value.get_content_markdown = AsyncMock()
        with pytest.raises(HTTPException):
            await get_article_content_markdown(...)
    svc.return_value.get_content_markdown.assert_not_awaited()  # no cross-project existence oracle

@pytest.mark.asyncio
async def test_content_markdown_endpoint_404s_without_file(): ...
```

- [ ] **Step 2: Run — expect FAIL** (import error).
- [ ] **Step 3: Implement**:

```python
class ArticleContentMarkdownResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    file_name: str | None = Field(default=None, alias="fileName")
    content_markdown: str | None = Field(default=None, alias="contentMarkdown")
```

(Mirror the alias style of `ArticleFileListItem`, `backend/app/schemas/article.py:205-218`.) Service method: latest MAIN pdf via `ArticleFileRepository.get_latest_pdf`. Endpoint: copy the limiter decorator pattern from `backend/app/api/v1/endpoints/articles_export.py:97` (`@limiter.limit(...)`, e.g. `"60/minute"`), `_gate_article` FIRST, then read; 404 when no file; `ApiResponse.success(...)`.

- [ ] **Step 4: Integration test — FAIL then PASS** — member GET returns seeded markdown (camelCase keys on the wire); outsider profile (`SEED.outsider_profile`) → 403; article without parsed markdown → `contentMarkdown: null`. Run: `uv run pytest tests/integration/test_articles_content_markdown.py -q`.
- [ ] **Step 5: Regenerate types** — `npm run generate:api-types`; confirm the path + camelCase properties in `openapi.json`; commit generated files with the task.
- [ ] **Step 6: Commit** — `git commit -m "feat(articles): rate-limited content-markdown read for the provenance dialog"`

---

### Task 6: Frontend types + `mapProvenance` composition mapping

**Files:**
- Modify: `frontend/types/ai-extraction.ts:48-64`
- Modify: `frontend/services/aiSuggestionService.ts:65-98`
- Test: `frontend/test/services/aiSuggestionService.test.ts`

**Interfaces (consumed by Tasks 8-10):**

```typescript
export interface PromptCompositionArticleRef {
  fileId?: string | null;
  fileName?: string | null;
  truncated?: boolean;
  estTokens?: number | null;
}
export interface PromptComposition {
  sectionName?: string;
  systemPrompt?: string;
  sectionInstruction?: string;
  articleRef?: PromptCompositionArticleRef;
  fieldsRequested?: string[];
  llmCalls?: number;
}
// RunProvenance gains: promptComposition?: PromptComposition;
```

(Provenance rides inside the history payload as the raw JSONB dict — snake_case; `mapProvenance` keeps flattening. Only the Task 5 endpoint is camelCase-aliased.)

- [ ] **Step 1: Failing test** — raw payload with `prompt_composition` (snake_case, nested `article_ref`) → assert `promptComposition.articleRef.fileName`, `fieldsRequested`, `llmCalls`, and no `prompt_composition` passthrough key leaks.
- [ ] **Step 2: Run — expect FAIL** (`npm run test:run -- frontend/test/services/aiSuggestionService.test.ts`).
- [ ] **Step 3: Implement** — destructure `prompt_composition` in `mapProvenance`; map exactly as the interface (same shape as the plan's earlier draft: `section_name→sectionName`, `article_ref.{file_id,file_name,truncated,est_tokens}→articleRef.{fileId,fileName,truncated,estTokens}`, `fields_requested→fieldsRequested`, `llm_calls→llmCalls`).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): map prompt composition provenance in the suggestion service"`

---

### Task 7: `AIPopoverShell` responsive/scroll contract

Unchanged from the panel review — identical to the pre-panel draft:

**Files:** `frontend/components/extraction/ai/shared/AIPopoverShell.tsx:33-51` + its test.

- [ ] **Step 1: Failing test** — content class contains `var(--radix-popover-content-available-height)` and `flex-col`; body has `overflow-y-auto` + `min-h-0`; header/footer `shrink-0`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**:

```tsx
<PopoverContent
  align={align}
  side="bottom"
  className={cn(
    'flex max-h-[min(var(--radix-popover-content-available-height),34rem)] w-[min(380px,calc(100vw-1.5rem))] flex-col overflow-hidden p-0',
    className,
  )}
>
  <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">...</div>
  <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
  {footer != null && <div className="shrink-0 border-t">{footer}</div>}
</PopoverContent>
```

- [ ] **Step 4: Run shell + review-popover tests — PASS.**
- [ ] **Step 5: Commit** — `git commit -m "fix(extraction): bound the AI popover to the viewport with a single scroll region"`

---

### Task 8: `GenerationDetailsDialog` + copy keys (pruned set)

**Files:**
- Create: `frontend/components/extraction/ai/shared/GenerationDetailsDialog.tsx`
- Modify: `frontend/lib/copy/extraction.ts`
- Test: `frontend/components/extraction/ai/shared/GenerationDetailsDialog.test.tsx` (create)

**Interfaces:**

```typescript
interface GenerationDetailsDialogProps {
  provenance: RunProvenance;
  articleId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

**Copy keys — each with a stated placement (panel YAGNI finding); reuse `provenanceToggle` ("How this was generated") as BOTH the summary-row button label and the dialog title — no `generationTitle` duplicate, no `generationClose` (shadcn DialogContent ships its own close):**

| key | placement |
|---|---|
| `generationParamsHeading` | params grid section label |
| `generationCompositionHeading` | recipe section label |
| `generationSystemPrompt` | recipe step 1 label |
| `generationSectionInstruction` | recipe step 2 label |
| `generationArticleInserted` | recipe step 3 chip title |
| `generationArticleTokens` | chip meta (`{{n}}` tokens) |
| `generationArticleTruncated` | truncated note/badge + expanded-block note |
| `generationViewTextSent` | chip expand button |
| `generationHideTextSent` | chip collapse button (same toggle) |
| `generationFieldsRequested` | recipe step 4 label (`{{n}}` interpolation) |
| `generationSplitCalls` | step 4 note when `llmCalls > 1` |
| `generationShowAll` | system-prompt expand toggle |
| `generationLegacyPrompt` | legacy-fallback code block label |

Suppress set for generic param rows: `ranByUserId`, `promptComposition`, **`promptText`** (legacy prompt renders ONLY in the legacy code block — never as a generic row; panel finding).

- [ ] **Step 1: Failing tests** — (a) composition fixture renders params grid, 4 recipe steps, split-calls note (`llmCalls: 2`), truncated badge; (b) legacy fixture (flat + `promptText`) renders scalar rows + legacy code block and NO recipe; (c) `promptText` never appears as a generic row.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — shadcn Dialog; `DialogContent className="flex max-h-[85dvh] w-[min(36rem,calc(100vw-2rem))] flex-col gap-0 p-0"`; header `shrink-0` (title = `provenanceToggle`, context = `promptComposition?.sectionName` · `ranByName`); body `min-h-0 flex-1 overflow-y-auto px-5 py-4`. Local `SCALAR_FIELDS` registry ports the scalar entries of the old `PROVENANCE_REGISTRY` (labels reuse existing `provenance*` copy keys) + generic rows for unknown keys minus the suppress set. Recipe only when `promptComposition`; token metric row from `tokensPrompt/Completion/Total`; copy buttons via `useCopyToClipboard` (+ existing `provenanceCopyPrompt`/`provenanceCopied` aria labels); Tooltips + aria-labels on icon buttons. Markdown expand stays a disabled placeholder until Task 9 wires the hook (button hidden when `articleId` absent).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): generation details dialog with prompt composition recipe"`

---

### Task 9: Stored-markdown lazy fetch (service + hook + dialog expand)

**Files:**
- Modify: `frontend/services/articlesService.ts`
- Modify: `frontend/lib/query-keys/articles.ts` (`contentMarkdown: (articleId) => [...articleKeys.all, 'content-markdown', articleId] as const`)
- Create: `frontend/hooks/useArticleContentMarkdown.ts`
- Modify: `frontend/components/extraction/ai/shared/GenerationDetailsDialog.tsx`
- Test: `frontend/test/hooks/useArticleContentMarkdown.test.tsx` (create — MSW-driven), extend the dialog test

**Interfaces:**

```typescript
export interface ArticleContentMarkdown {
  fileName: string | null;
  contentMarkdown: string | null;
}
getArticleContentMarkdown(articleId: string): Promise<ErrorResult<ArticleContentMarkdown>>
useArticleContentMarkdown(articleId: string | undefined, opts: {enabled: boolean})
```

- [ ] **Step 1: Failing tests** — **MSW through the real service** (spec §5 mandate; panel blocking finding — the snake→camel mapping must be executed, not mocked): `server.use(http.get('*/api/v1/articles/:id/content-markdown', ...))` returning the enveloped camelCase payload; hook test asserts (a) `enabled: false` → no request, (b) success → `data.contentMarkdown` populated through the REAL service, (c) 500 → `isError`, refetch retries. Dialog test: clicking `generationViewTextSent` shows the markdown block; error state shows inline retry.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — service via `toResult(apiClient(...))` reading the camelCase payload (`data.fileName`, `data.contentMarkdown` — no mapping layer needed; §V aliases on the wire). Hook: `useQuery({queryKey: articleKeys.contentMarkdown(articleId!), enabled: opts.enabled && !!articleId, queryFn})` unwrapping `ErrorResult`. Dialog: `showText` state; expanded `<pre className="max-h-[40vh] overflow-auto ...">` + copy + truncated note + loading skeleton + inline error with retry (`refetch`).
- [ ] **Step 4: Run — PASS** (`npm run test:run -- frontend/test/hooks/useArticleContentMarkdown.test.tsx frontend/components/extraction/ai/shared/GenerationDetailsDialog.test.tsx`).
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): lazy stored-markdown view inside the generation dialog"`

---

### Task 10: Wire the popover; thread `articleId`; delete `RunProvenanceDisclosure`

**Files:**
- Modify: `frontend/components/extraction/ai/AISuggestionReviewPopover.tsx`
- Modify: `frontend/components/extraction/ai/AISuggestionDisplay.tsx` — **binding only**: add `articleId` to the review binding it forwards; it renders NO provenance itself (verified — panel finding; no inline-card swap, no new surface)
- Modify: call sites threading `articleId` (find: `grep -rn "AISuggestionReviewPopover\|reviewBinding\|AISuggestionReviewBinding" frontend --include="*.tsx"`)
- Delete: `RunProvenanceDisclosure.tsx` + `RunProvenanceDisclosure.test.tsx`
- Modify: `frontend/lib/copy/extraction.ts` — prune orphaned keys (`provenancePromptSent` if unused after the swap; keep `provenanceToggle` — reused as button/dialog title; keep `provenanceCopyPrompt`/`provenanceCopied` — reused by dialog copy buttons; keep scalar label keys — reused by the params grid)
- Test: existing popover test file

**Interfaces:** `AISuggestionReviewPopoverProps` gains `articleId: string`. The summary row is inline JSX in `VersionRow` (single consumer — no new file); dialog state (`activeProvenance: RunProvenance | null`) lives at the popover root; opening details closes the popover (`setOpen(false)`) — a portal'd dialog would dismiss it anyway; make it deliberate.

- [ ] **Step 1: Failing tests** — selected version renders the summary line (`{model} · {tokens}` via `provenanceTokensSummary`) + a `provenanceToggle`-labelled button; no `<pre>` inside the popover body; clicking the button closes the popover and mounts `GenerationDetailsDialog` with that version's provenance.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — replace `{version.provenance && <RunProvenanceDisclosure .../>}` in `VersionRow` with the inline summary row calling `onOpenDetails(version.provenance)`; popover root renders the dialog as a `<Popover>` sibling. Thread `articleId` from call sites (they hold it — history fetches are article-scoped). Delete the disclosure files; `grep -rn "RunProvenanceDisclosure" frontend` returns nothing; prune orphaned copy keys.
- [ ] **Step 4: Run** — `npm run test:run -- frontend/components/extraction/ai && npx tsc -p tsconfig.app.json --noEmit`: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): route provenance through the generation dialog; drop inline disclosure"`

---

### Task 11: Stress harness (temporary) + responsiveness verification + teardown

**Files:**
- Create (temporary): `frontend/pages/dev/ReviewPopoverHarness.tsx` + DEV-gated lazy route in `frontend/App.tsx`
- Teardown: both removed in the final step (spec calls it throwaway; run-header precedent — no harness survives in-tree today)

- [ ] **Step 1: Build the harness** — `import.meta.env.DEV`-gated lazy route `/dev/review-harness`. Fixtures: 12 versions across 3 runs; a 300-char unbroken token value; 6-paragraph rationale; 4-citation evidence; provenance with 4k-char system prompt, 14 `fieldsRequested`, `llmCalls: 3`, `truncated: true`; one legacy flat version; two trigger placements (top + bottom of viewport) to stress both flip directions; `getHistory` resolves a local array (no network).
- [ ] **Step 2: Stress matrix with preview tooling** — `preview_start`; for each of 360×640, 768×1024, 1280×800, 1280×500 (+ one dark pass): open both popovers and the dialog; `preview_inspect` bounding boxes — popover height ≤ viewport, `scrollWidth <= innerWidth`, footer visible while the body scrolls. Fix at the source, re-check. (Scroll/observer glue is unit-tested — preview Chrome lacks IntersectionObserver.)
- [ ] **Step 3: `/design-review` pass** on the harness route; apply prioritized diffs.
- [ ] **Step 4: Teardown** — delete the harness file + route; `grep -rn "review-harness\|ReviewPopoverHarness" frontend` returns nothing.
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): verify popover/dialog responsiveness (harness verified + removed)"`

---

### Task 12: Full gate

- [ ] **Step 1:** `.markdownlintignore` — add one line: `docs/superpowers/plans/2026-07-03-review-popover-provenance-composition.md` (docs-ci requirement).
- [ ] **Step 2:** `make quality-scan` from repo root — read the output; any red blocks the ship.
- [ ] **Step 3:** `make test-backend` (local Supabase up; `backend/.env` copied from the main checkout if missing in the worktree).
- [ ] **Step 4:** `npm run test:run` full + `npm run lint`.
- [ ] **Step 5:** Commit stragglers; plan complete.

## Self-Review Notes

- Spec coverage: §1 → Tasks 1-3 (+ typed spine); read path + mixed-era → Task 4; §2 → Task 7; §3 → Tasks 8, 10; §4 (amended path) → Tasks 5, 9; §5 → per-task tests + Tasks 11-12.
- Deviations + residuals: see the dedicated section above (endpoint path, no dialog timestamp, same-section re-run residual).
- Type consistency: `PromptInputInfo` (T1) → T3; snapshot snake_case (T3) → `_resolve_section_provenance` (T4) → `mapProvenance` (T6) → dialog (T8); camelCase wire only on the T5 endpoint → T9 service; `articleId` threading (T10) matches T8's prop.
