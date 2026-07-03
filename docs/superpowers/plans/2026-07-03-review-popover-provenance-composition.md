---
status: approved
last_reviewed: 2026-07-03
owner: raphael
---

# Review Popover Slimming + Prompt-Composition Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim the AI review popover to decision content with a hard responsive/scroll contract, and replace the misleading "prompt sent" with per-section structured prompt composition surfaced in a centered dialog.

**Architecture:** Backend persists a per-section provenance snapshot (keyed by `entity_type_id` under `run.results["provenance"]["sections"]`) carrying a `prompt_composition` block; the read service resolves each suggestion's section snapshot with legacy-flat fallback. Frontend bounds the popover via Radix available-height, replaces the inline disclosure with a one-line summary row, and adds a `GenerationDetailsDialog` that renders the composition recipe and lazy-loads the stored article markdown via a new endpoint.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async (no schema change — JSONB payload only), Pydantic v2, React 19 + TS strict, TanStack Query, shadcn Dialog/Popover, vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-07-03-review-popover-provenance-composition-design.md`

## Global Constraints

- English only for code, comments, copy keys, commits.
- No SQLAlchemy model change is planned ⇒ no Alembic migration. If any task ends up touching a model, STOP and add the migration + roundtrip head-pin in that same task.
- All user-facing text through `frontend/lib/copy/extraction.ts`; never hardcode strings in components.
- Data flow: component → hook (TanStack Query, keys from `frontend/lib/query-keys/`) → service (`toResult`/`ErrorResult`) → typed `apiClient`. No `fetch()`/`supabase.from` in components.
- React Compiler: no `try/finally` or `throw` in component/hook bodies; IO in services returning `ErrorResult<T>`.
- New endpoints: `ApiResponse` envelope, typed Pydantic response model (never `ApiResponse[dict]`), `ensure_project_member` gate, direct endpoint-coroutine unit test (ASGI diff-cover blind spot).
- Endpoint schema change ⇒ `npm run generate:api-types` and commit `frontend/types/api/{openapi.json,schema.d.ts}`.
- Frontend tooling from repo root; backend commands from `backend/`. Vitest single run: `npm run test:run -- <path>`.
- Icon-only/short-label buttons: shadcn Tooltip + `aria-label`, copy via `lib/copy/`.
- Conventional commits, one commit per task.
- Marker constant: `ARTICLE_MARKDOWN_MARKER = "[[ARTICLE_MARKDOWN]]"` (backend), rendered verbatim in `section_instruction`.

## File Structure

Backend:
- Modify `backend/app/services/extraction_prompt_input.py` — return assembly info (truncated, est_tokens, file_name) alongside text/anchors.
- Modify `backend/app/services/section_extraction_service.py` — build `prompt_composition`, per-section snapshot incl. per-section tokens, persist via new repo method.
- Modify `backend/app/repositories/extraction_run_repository.py` — `merge_provenance_section` (deep merge for one section key).
- Modify `backend/app/services/extraction_suggestion_read_service.py` — resolve per-section snapshot with legacy fallback; `_inject_ran_by_names` walks sections.
- Modify `backend/app/api/v1/endpoints/articles.py` + `backend/app/schemas/article.py` (or the module holding article response schemas) — `GET /{article_id}/content-markdown`.
- Modify `backend/app/services/article_file_service.py` — `get_content_markdown(article_id)`.

Frontend:
- Modify `frontend/types/ai-extraction.ts` — `PromptComposition`, `RunProvenance.promptComposition`.
- Modify `frontend/services/aiSuggestionService.ts` — map `prompt_composition`.
- Modify `frontend/components/extraction/ai/shared/AIPopoverShell.tsx` — flex column + available-height bound.
- Create `frontend/components/extraction/ai/shared/GenerationDetailsDialog.tsx` — params grid + composition recipe + legacy fallback + markdown expand.
- Create `frontend/components/extraction/ai/shared/ProvenanceSummaryRow.tsx` — one-line summary + open-dialog button.
- Delete `frontend/components/extraction/ai/shared/RunProvenanceDisclosure.tsx` (+ test) at the end of Task 10.
- Modify `frontend/components/extraction/ai/AISuggestionReviewPopover.tsx`, `frontend/components/extraction/ai/AISuggestionDisplay.tsx` — wire summary row + dialog, thread `articleId`.
- Modify `frontend/services/articlesService.ts`, `frontend/lib/query-keys/articles.ts`, create `frontend/hooks/useArticleContentMarkdown.ts`.
- Modify `frontend/lib/copy/extraction.ts` — new keys.
- Create `frontend/pages/dev/ReviewPopoverHarness.tsx` + DEV-gated route in `frontend/App.tsx`.

---

### Task 1: Expose assembly info from `build_prompt_input`

**Files:**
- Modify: `backend/app/services/extraction_prompt_input.py`
- Modify: `backend/app/services/section_extraction_service.py:192-204` (`_assemble_prompt_text`)
- Test: `backend/tests/unit/test_extraction_prompt_input.py` (extend existing; create if the module has no unit test)

**Interfaces:**
- Produces: `@dataclass PromptInputInfo(anchor_blocks: list[Any], anchor_file_id: UUID | None, file_name: str | None, truncated: bool, est_tokens: int | None, source: str)` and new return `tuple[str, PromptInputInfo]` from `build_prompt_input`.
- Consumed by Task 3 via `self._prompt_input_info`.

- [ ] **Step 1: Write the failing test** — in the unit test module for `extraction_prompt_input`, add:

```python
@pytest.mark.asyncio
async def test_build_prompt_input_returns_info_with_truncation_fields():
    # Arrange a fake article_files repo whose latest pdf has stored markdown
    # under budget (source == "stored_markdown", truncated False).
    text, info = await build_prompt_input(
        db=AsyncMock(), article_files=fake_repo, storage=AsyncMock(),
        article_id=uuid4(), model="gpt-4o-mini", logger=MagicMock(),
        user_id="u", trace_id="t",
    )
    assert text  # markdown text unchanged
    assert info.truncated is False
    assert info.source == "stored_markdown"
    assert info.file_name == fake_repo_file.original_filename
    assert info.anchor_file_id == fake_repo_file.id
    assert isinstance(info.est_tokens, int)
```

Mirror the existing test setup in that module (fake repo/file objects already exist there; reuse them).

- [ ] **Step 2: Run it — expect FAIL** (`cd backend && uv run pytest tests/unit/test_extraction_prompt_input.py -x -q`): ValueError/TypeError on unpacking (function still returns 3-tuple without info).

- [ ] **Step 3: Implement** — in `extraction_prompt_input.py`, add the dataclass and change the return. The function already computes `source`, `truncated`, `included_blocks`, `est_tokens` for its `extraction.assembly` log line and already holds `main_file`; populate the dataclass from those same locals (both the stored-markdown and budgeted-blocks branches) and return `(text, info)`. Keep the log line unchanged.

```python
@dataclass(frozen=True)
class PromptInputInfo:
    anchor_blocks: list[Any]
    anchor_file_id: UUID | None
    file_name: str | None
    truncated: bool
    est_tokens: int | None
    source: str
```

- [ ] **Step 4: Update the single call site** — `section_extraction_service._assemble_prompt_text` (verify no others: `grep -rn "build_prompt_input" backend/app`):

```python
async def _assemble_prompt_text(self, article_id: UUID, model: str) -> str:
    """Budgeted block-markdown prompt input; stashes assembly info on self."""
    text, info = await build_prompt_input(...same kwargs...)
    self._prompt_input_info = info
    self._run_anchor_blocks = info.anchor_blocks
    self._run_anchor_file_id = info.anchor_file_id
    return text
```

Initialize `self._prompt_input_info: PromptInputInfo | None = None` in `__init__` next to `_run_provenance`.

- [ ] **Step 5: Run the unit module + the section-service unit tests** — `uv run pytest tests/unit/test_extraction_prompt_input.py tests/unit/test_section_extraction_service.py -q`: PASS (fix any unpack sites the grep reveals).

- [ ] **Step 6: Commit** — `git commit -m "feat(extraction): expose prompt-input assembly info (truncated, tokens, file)"`

---

### Task 2: `merge_provenance_section` repository method

**Files:**
- Modify: `backend/app/repositories/extraction_run_repository.py` (after `merge_results`, line ~164)
- Test: `backend/tests/integration/test_extraction_run_repository.py` (extend; if absent, add the test to the integration module that already exercises `merge_results`)

**Interfaces:**
- Produces: `async def merge_provenance_section(self, run_id: UUID, entity_type_id: UUID, snapshot: dict[str, Any]) -> ExtractionRun | None`
- Consumed by Task 3.

- [ ] **Step 1: Failing test** — two sections persisted on one run must both survive (the last-write-wins regression):

```python
@pytest.mark.asyncio
async def test_merge_provenance_section_keeps_sibling_sections(db_session):
    repo = ExtractionRunRepository(db_session)
    run = await _make_run(db_session)  # reuse the module's existing run factory
    et_a, et_b = uuid4(), uuid4()
    await repo.merge_provenance_section(run.id, et_a, {"model": "m-a"})
    await repo.merge_provenance_section(run.id, et_b, {"model": "m-b"})
    updated = await repo.get_by_id(run.id)
    sections = updated.results["provenance"]["sections"]
    assert sections[str(et_a)] == {"model": "m-a"}
    assert sections[str(et_b)] == {"model": "m-b"}
```

- [ ] **Step 2: Run — expect FAIL** (`uv run pytest tests/integration -k merge_provenance_section -q`): AttributeError (method missing).

- [ ] **Step 3: Implement** (mirror `merge_results` docstring style; reassign, don't mutate, so JSONB change-tracking fires):

```python
async def merge_provenance_section(
    self, run_id: UUID, entity_type_id: UUID, snapshot: dict[str, Any]
) -> ExtractionRun | None:
    """Deep-merge one section's provenance snapshot under
    ``results["provenance"]["sections"][entity_type_id]``, preserving sibling
    sections (merge_results is shallow and would clobber them)."""
    run = await self.get_by_id(run_id)
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
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): per-section provenance merge on the run repository"`

---

### Task 3: Build `prompt_composition` + persist per-section snapshots

**Files:**
- Modify: `backend/app/services/section_extraction_service.py` — `_build_run_provenance` (152-175), `_provenance_with_tokens` (177-190), `_extract_with_llm` (1206-1288), `_create_suggestions` provenance choke-point (1575-1581), `extract_for_run` aggregate usage block (~455-536).
- Test: `backend/tests/unit/test_section_extraction_service.py`

**Interfaces:**
- Consumes: `PromptInputInfo` (Task 1), `merge_provenance_section` (Task 2), `section_extraction.render` / `quality_assessment.render`, `build_output_models`.
- Produces: section snapshot shape (spec §1) — flat legacy keys + `tokens` + `prompt_composition{section_name, system_prompt, section_instruction, article_ref{file_id, file_name, truncated, est_tokens?}, fields_requested, llm_calls}` — consumed by Task 4 and (camelCase) Task 6.

- [ ] **Step 1: Failing tests** (extend the existing provenance test group at line ~1118; reuse its service/entity fixtures):

```python
ARTICLE_MARKDOWN_MARKER = "[[ARTICLE_MARKDOWN]]"

def test_build_run_provenance_includes_composition_and_tokens():
    snap = service._build_run_provenance(
        model="gpt-4o-mini", prompt_name="section_extraction",
        prompt_version="v1", prompt_text="SYS",
        usage=LlmUsage(prompt_tokens=10, completion_tokens=5),
        prompt_composition={"section_name": "S", "llm_calls": 1},
    )
    assert snap["tokens"] == {"prompt": 10, "completion": 5, "total": 15}
    assert snap["prompt_composition"]["section_name"] == "S"

@pytest.mark.asyncio
async def test_extract_with_llm_builds_marker_composition(...):
    # run _extract_with_llm with the module's existing extract_structured stub
    ...
    comp = service._run_provenance["prompt_composition"]
    assert ARTICLE_MARKDOWN_MARKER in comp["section_instruction"]
    assert "Article text" in comp["section_instruction"]  # template kept
    assert comp["fields_requested"] == [f.name for f in entity_type.fields]
    assert comp["llm_calls"] == 1
    assert comp["article_ref"]["truncated"] is False

@pytest.mark.asyncio
async def test_create_suggestions_persists_section_scoped_provenance(...):
    # assert the repo mock got merge_provenance_section(run.id, entity_type_id, snapshot)
    # and NOT merge_results with a top-level "provenance" key
```

- [ ] **Step 2: Run — expect FAIL** (`uv run pytest tests/unit/test_section_extraction_service.py -k "composition or section_scoped" -q`).

- [ ] **Step 3: Implement** in `section_extraction_service.py`:

```python
ARTICLE_MARKDOWN_MARKER = "[[ARTICLE_MARKDOWN]]"
```

`_build_run_provenance` gains `usage: LlmUsage | None = None` and `prompt_composition: dict[str, Any] | None = None` kwargs; append to the snapshot:

```python
if usage is not None:
    snapshot["tokens"] = {
        "prompt": usage.prompt_tokens,
        "completion": usage.completion_tokens,
        "total": usage.total_tokens,
    }
if prompt_composition is not None:
    snapshot["prompt_composition"] = prompt_composition
```

In `_extract_with_llm`, after the prompt branch (line ~1254), build the composition (both kinds; `quality_assessment.render` also takes `framework`):

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
article_ref: dict[str, Any] = {}
if info is not None:
    article_ref = {
        "file_id": str(info.anchor_file_id) if info.anchor_file_id else None,
        "file_name": info.file_name,
        "truncated": info.truncated,
    }
    if info.est_tokens is not None:
        article_ref["est_tokens"] = info.est_tokens
prompt_composition = {
    "section_name": entity_name,
    "system_prompt": system_prompt,
    "section_instruction": instruction,
    "article_ref": article_ref,
    "fields_requested": [str(f.name) for f in (getattr(entity_type, "fields", None) or [])],
    "llm_calls": len(output_models),
}
```

At the end of `_extract_with_llm` (line 1282-1287), pass `usage=usage, prompt_composition=prompt_composition` into `_build_run_provenance` (the per-section usage is the loop-accumulated one — already section-scoped here). Keep `prompt_text=system_prompt` for the legacy flat key so older readers stay coherent.

In `_create_suggestions` (1575-1581) replace the choke-point:

```python
provenance = self._run_provenance
if count and provenance is not None:
    await self._runs.merge_provenance_section(run.id, entity_type_id, provenance)
```

Delete `_provenance_with_tokens` and migrate its two remaining callers: `extract_for_run`'s aggregate merge block (~520-536) now relies on each section's own snapshot (remove the run-level aggregate provenance merge; run-aggregate `tokens_*` keys written by `complete_run` are untouched). Update the affected existing tests (`test_extract_for_run_provenance_has_full_token_shape`, `test_provenance_with_tokens_*`) to the new shape — per-section `tokens` replaces run-aggregate token provenance; do not grandfather the old assertions.

- [ ] **Step 4: Run the whole unit module** — `uv run pytest tests/unit/test_section_extraction_service.py -q`: PASS.
- [ ] **Step 5: Integration check** — `uv run pytest tests/integration/test_section_extraction_evidence.py -q` (extraction path still green).
- [ ] **Step 6: Commit** — `git commit -m "feat(extraction): per-section provenance snapshots with prompt composition"`

---

### Task 4: Read-path section resolution + legacy fallback

**Files:**
- Modify: `backend/app/services/extraction_suggestion_read_service.py` — `_load_run_provenance` (85-111), `_inject_ran_by_names` (114-145), `get_suggestion_history` (314-410), `load_suggestions`.
- Test: `backend/tests/integration/test_suggestion_read.py`

**Interfaces:**
- Produces: `def _resolve_section_provenance(provenance: dict[str, Any] | None, entity_type_id: UUID | None) -> dict[str, Any] | None` — history/load items carry the RESOLVED section snapshot (never the `sections` map).

- [ ] **Step 1: Failing tests**:

```python
@pytest.mark.asyncio
async def test_history_resolves_section_scoped_provenance(db_session):
    # seed a run whose results.provenance = {"sections": {str(et_id): {"model": "m-a",
    #   "prompt_composition": {"section_name": "A"}}}} and a proposal on an
    # instance of that entity type → history item provenance.model == "m-a"
    # and history item provenance carries prompt_composition (no "sections" key).

@pytest.mark.asyncio
async def test_history_falls_back_to_legacy_flat_provenance(db_session):
    # run.results.provenance = {"model": "legacy", "prompt_text": "SYS"} (no sections)
    # → item provenance == the flat snapshot unchanged.

@pytest.mark.asyncio
async def test_ran_by_name_resolved_inside_sections(db_session):
    # sections snapshot carries ran_by_user_id of a seeded profile
    # → resolved item provenance has ran_by_name.
```

- [ ] **Step 2: Run — expect FAIL** (`uv run pytest tests/integration/test_suggestion_read.py -k "section_scoped or legacy_flat or inside_sections" -q`).

- [ ] **Step 3: Implement**:

```python
def _resolve_section_provenance(
    provenance: dict[str, Any] | None, entity_type_id: UUID | None
) -> dict[str, Any] | None:
    """Per-section snapshot for sectioned runs; the flat snapshot for legacy
    runs; None when a sectioned run has no snapshot for this entity type."""
    if not provenance:
        return None
    sections = provenance.get("sections")
    if not isinstance(sections, dict):
        return provenance
    return sections.get(str(entity_type_id)) if entity_type_id else None
```

- `_inject_ran_by_names`: collect `ran_by_user_id` from flat snapshots AND every `sections` value; inject `ran_by_name` into both (in place, so resolved references see it).
- `get_suggestion_history`: the instance is already loaded for scope validation (337-339) — take `instance.entity_type_id`, then `provenance=_resolve_section_provenance(prov_by_run.get(p.run_id), instance.entity_type_id)`.
- `load_suggestions`: proposals span instances; build one map `select(ExtractionInstance.id, ExtractionInstance.entity_type_id).where(ExtractionInstance.id.in_(instance_ids))` (skip if the function already loads instances — reuse) and resolve per item the same way.

- [ ] **Step 4: Run the module** — `uv run pytest tests/integration/test_suggestion_read.py -q`: PASS (update `test_load_suggestions_includes_run_provenance` / `test_get_suggestion_history_resolves_ran_by_name` seeds to the sectioned shape where they assert the new behavior; keep one legacy-shape test alive as the fallback guard).
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): resolve per-section provenance on the suggestion read path"`

---

### Task 5: `GET /{article_id}/content-markdown` endpoint

**Files:**
- Modify: `backend/app/api/v1/endpoints/articles.py`
- Modify: `backend/app/services/article_file_service.py`
- Modify: the schemas module where `ArticleFileListItem` lives (add `ArticleContentMarkdownResponse`)
- Test: `backend/tests/unit/test_articles_content_markdown_unit.py` (create), `backend/tests/integration/test_articles_content_markdown.py` (create)
- Modify (generated): `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`

**Interfaces:**
- Produces: `GET /api/v1/articles/{article_id}/content-markdown` → `ApiResponse[ArticleContentMarkdownResponse]` with `{file_id: UUID, file_name: str | None, content_markdown: str | None, content_version: int}`; service `ArticleFileService.get_content_markdown(article_id) -> ArticleFile | None` (latest MAIN pdf). Consumed by Task 9's frontend service.

- [ ] **Step 1: Failing unit test** (direct coroutine — the ASGI blind-spot pattern from `test_form_runs_endpoint_unit.py`):

```python
@pytest.mark.asyncio
async def test_content_markdown_endpoint_gates_membership_and_wraps_envelope():
    aid, pid = uuid4(), uuid4()
    af = MagicMock(id=uuid4(), original_filename="a.pdf",
                   content_markdown="# md", content_version=3)
    with (
        patch(f"{_EP}.get_article_project_id", AsyncMock(return_value=pid)) as gpid,
        patch(f"{_EP}.ensure_project_member", AsyncMock()) as gate,
        patch(f"{_EP}.ArticleFileService") as svc,
    ):
        svc.return_value.get_content_markdown = AsyncMock(return_value=af)
        resp = await get_article_content_markdown(
            article_id=aid, request=MagicMock(), db=AsyncMock(), current_user_sub=uuid4()
        )
    gate.assert_awaited_once()          # BOLA gate before the read
    gpid.assert_awaited_once_with(ANY, aid)
    assert resp.ok is True
    assert resp.data.content_markdown == "# md"

@pytest.mark.asyncio
async def test_content_markdown_endpoint_404s_without_file():
    # service returns None → HTTPException 404
```

- [ ] **Step 2: Run — expect FAIL** (import error: endpoint missing).
- [ ] **Step 3: Implement** — schema:

```python
class ArticleContentMarkdownResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    file_id: UUID
    file_name: str | None
    content_markdown: str | None
    content_version: int
```

Service method (`ArticleFileService`): `get_content_markdown` returns the latest MAIN pdf via the existing `ArticleFileRepository.get_latest_pdf`. Endpoint (mirror `list_article_files`, lines 81-99 — same membership pattern, 404 on missing article/file, `ApiResponse.success`, map `original_filename → file_name`).

- [ ] **Step 4: Failing integration test → PASS** — member GET returns the seeded markdown; non-member (outsider profile from `SEED`) gets 403; article without parsed markdown returns `content_markdown: null`. Run: `uv run pytest tests/integration/test_articles_content_markdown.py -q`.
- [ ] **Step 5: Regenerate types** — from repo root: `npm run generate:api-types`; confirm the new path appears in `frontend/types/api/openapi.json`; commit both generated files with the task.
- [ ] **Step 6: Commit** — `git commit -m "feat(articles): content-markdown read endpoint for provenance dialog"`

---

### Task 6: Frontend types + `mapProvenance` composition mapping

**Files:**
- Modify: `frontend/types/ai-extraction.ts:48-64`
- Modify: `frontend/services/aiSuggestionService.ts:65-98`
- Test: `frontend/test/services/aiSuggestionService.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 8-10):

```typescript
export interface PromptCompositionArticleRef {
  fileId?: string | null;
  fileName?: string | null;
  truncated?: boolean;
  estTokens?: number;
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

- [ ] **Step 1: Failing test** — extend the service test with a raw provenance payload carrying `prompt_composition` (snake_case, nested `article_ref`) and assert the mapped `promptComposition.articleRef.fileName`, `fieldsRequested`, `llmCalls`, and that `prompt_composition` does NOT leak as a passthrough key.
- [ ] **Step 2: Run — expect FAIL** (`npm run test:run -- frontend/test/services/aiSuggestionService.test.ts`).
- [ ] **Step 3: Implement** — destructure `prompt_composition` in `mapProvenance` alongside the other snake_case keys and map:

```typescript
const pc = prompt_composition as Record<string, unknown> | undefined;
if (pc) {
  const ar = (pc['article_ref'] ?? {}) as Record<string, unknown>;
  out.promptComposition = {
    sectionName: pc['section_name'] as string | undefined,
    systemPrompt: pc['system_prompt'] as string | undefined,
    sectionInstruction: pc['section_instruction'] as string | undefined,
    articleRef: {
      fileId: ar['file_id'] as string | null | undefined,
      fileName: ar['file_name'] as string | null | undefined,
      truncated: ar['truncated'] as boolean | undefined,
      estTokens: ar['est_tokens'] as number | undefined,
    },
    fieldsRequested: pc['fields_requested'] as string[] | undefined,
    llmCalls: pc['llm_calls'] as number | undefined,
  };
}
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): map prompt composition provenance in the suggestion service"`

---

### Task 7: `AIPopoverShell` responsive/scroll contract

**Files:**
- Modify: `frontend/components/extraction/ai/shared/AIPopoverShell.tsx:33-51`
- Test: `frontend/components/extraction/ai/shared/AIPopoverShell.test.tsx`

**Interfaces:** shell props unchanged.

- [ ] **Step 1: Failing test** — assert the content element's class list includes the available-height bound and flex column, and the body is the single scroll region:

```typescript
it('bounds the popover to the radix available height with one scroll region', () => {
  // render as today; then:
  const content = ...; // existing test's content query
  expect(content.className).toContain('var(--radix-popover-content-available-height)');
  expect(content.className).toContain('flex-col');
  const body = screen.getByText('BODY').parentElement!;
  expect(body.className).toContain('overflow-y-auto');
  expect(body.className).toContain('min-h-0');
});
```

- [ ] **Step 2: Run — expect FAIL** (`npm run test:run -- frontend/components/extraction/ai/shared/AIPopoverShell.test.tsx`).
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

(The old `max-h-[min(70vh,32rem)]` on the body goes away — the bound now lives on the content.)

- [ ] **Step 4: Run shell tests — PASS.** Also run the review popover test file to catch layout assumptions.
- [ ] **Step 5: Commit** — `git commit -m "fix(extraction): bound the AI popover to the viewport with a single scroll region"`

---

### Task 8: `GenerationDetailsDialog` + `ProvenanceSummaryRow` + copy keys

**Files:**
- Create: `frontend/components/extraction/ai/shared/GenerationDetailsDialog.tsx`
- Create: `frontend/components/extraction/ai/shared/ProvenanceSummaryRow.tsx`
- Modify: `frontend/lib/copy/extraction.ts`
- Test: `frontend/components/extraction/ai/shared/GenerationDetailsDialog.test.tsx` (create)

**Interfaces:**

```typescript
// ProvenanceSummaryRow
interface ProvenanceSummaryRowProps {
  provenance: RunProvenance;
  onOpenDetails: () => void;
}
// GenerationDetailsDialog (markdown expand wired in Task 9; this task renders
// everything except the fetch, behind an `articleId?: string` prop)
interface GenerationDetailsDialogProps {
  provenance: RunProvenance;
  articleId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

New copy keys (English, flat namespace, names exact — later tasks use them): `generationTitle`, `generationContextRanBy`, `generationParamsHeading`, `generationCompositionHeading`, `generationSystemPrompt`, `generationSectionInstruction`, `generationArticleInserted`, `generationArticleTokens`, `generationArticleTruncated`, `generationViewTextSent`, `generationHideTextSent`, `generationFieldsRequested`, `generationSplitCalls`, `generationShowAll`, `generationLegacyPrompt`, `generationClose`.

- [ ] **Step 1: Failing tests**:

```typescript
const provenance: RunProvenance = {
  model: 'gpt-4o-mini', provider: 'openai', temperature: 0.1,
  tokensPrompt: 23710, tokensCompletion: 970, tokensTotal: 24680,
  ranByName: 'raphael', promptVersion: '0b5b7ef9ab73',
  promptComposition: {
    sectionName: 'Source of Data',
    systemPrompt: 'SYS PROMPT TEXT',
    sectionInstruction: 'Extract...\nArticle text:\n[[ARTICLE_MARKDOWN]]',
    articleRef: {fileName: 'teste3.pdf', truncated: false, estTokens: 23000},
    fieldsRequested: ['data_source'],
    llmCalls: 2,
  },
};
it('renders params grid, composition recipe and split-calls note', ...);
it('falls back to flat rows + raw prompt text for legacy provenance', () => {
  // provenance without promptComposition but with promptText → legacy code block
});
it('summary row shows model · tokens and opens details', async () => {
  // ProvenanceSummaryRow: onOpenDetails called on click; text matches
});
```

- [ ] **Step 2: Run — expect FAIL** (files missing).
- [ ] **Step 3: Implement.** `ProvenanceSummaryRow`: one flex line — muted `{model} · {tokensTotal.toLocaleString()} tokens` summary (reuse the `provenanceTokensSummary` copy) + ghost Button (`generationTitle` label, `ArrowUpRight` icon) calling `onOpenDetails`. `GenerationDetailsDialog`: shadcn `Dialog`/`DialogContent` with `className="flex max-h-[85dvh] w-[min(36rem,calc(100vw-2rem))] flex-col gap-0 p-0"`; `DialogHeader` (title + context line: `promptComposition?.sectionName`, timestamp is NOT in provenance — omit, use `ranByName` only) `shrink-0`; body `min-h-0 flex-1 overflow-y-auto px-5 py-4`. Sections:
  1. Params grid: keep a local `SCALAR_FIELDS` registry (port the scalar entries of `PROVENANCE_REGISTRY` minus `promptText`; same label copy keys; generic rows for unknown keys, suppress `ranByUserId`, `promptComposition`).
  2. Composition recipe (only when `promptComposition`): numbered rows — system prompt (2-line `line-clamp-2` preview, `generationShowAll` toggle expands in-flow, copy via `useCopyToClipboard`), section instruction (`<pre className="whitespace-pre-wrap break-words ...">`), article chip (fileName, `generationArticleTokens` with `estTokens.toLocaleString()`, `generationArticleTruncated` badge when truncated; expand button placeholder disabled until Task 9 unless `articleId` present), requested fields as chips + `generationSplitCalls` note when `llmCalls > 1`.
  3. Token metric row (3 mini cards, `tokensPrompt/Completion/Total`).
  4. Legacy fallback: no `promptComposition` → scalar rows + `promptText` in the existing bounded `<pre>` pattern with copy.
  All buttons: Tooltip + aria-label; all text via `t('extraction', ...)`.
- [ ] **Step 4: Run — PASS** (`npm run test:run -- frontend/components/extraction/ai/shared/GenerationDetailsDialog.test.tsx`).
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): generation details dialog with prompt composition recipe"`

---

### Task 9: Stored-markdown lazy fetch (service + hook + dialog expand)

**Files:**
- Modify: `frontend/services/articlesService.ts`
- Modify: `frontend/lib/query-keys/articles.ts`
- Create: `frontend/hooks/useArticleContentMarkdown.ts`
- Modify: `frontend/components/extraction/ai/shared/GenerationDetailsDialog.tsx`
- Test: `frontend/test/hooks/useArticleContentMarkdown.test.tsx` (create), extend `GenerationDetailsDialog.test.tsx`

**Interfaces:**

```typescript
// articlesService
export interface ArticleContentMarkdown {
  fileId: string; fileName: string | null;
  contentMarkdown: string | null; contentVersion: number;
}
getArticleContentMarkdown(articleId: string): Promise<ErrorResult<ArticleContentMarkdown>>
// query key
articleKeys.contentMarkdown = (articleId: string) =>
  [...articleKeys.all, 'content-markdown', articleId] as const;
// hook
useArticleContentMarkdown(articleId: string | undefined, opts: {enabled: boolean})
```

- [ ] **Step 1: Failing tests** — hook test (vi.mock the service): enabled=false → no call; enabled=true → data mapped; service error → `isError`. Dialog test: clicking `generationViewTextSent` renders the markdown block (mock hook), error state renders inline retry.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — service via `toResult(apiClient(...))` mapping the snake_case payload (`file_id → fileId`, etc.); hook wraps `useQuery({queryKey: articleKeys.contentMarkdown(articleId!), enabled: opts.enabled && !!articleId, queryFn})` where `queryFn` unwraps `ErrorResult` (throw inside queryFn is fine — it's not a component/hook body `try`). Dialog: local `showText` state; expanded block `max-h-[40vh] overflow-auto` `<pre>` + copy button + truncated note (`generationArticleTruncated`) + loading skeleton + inline error with retry (`refetch`).
- [ ] **Step 4: Run — PASS** (`npm run test:run -- frontend/test/hooks/useArticleContentMarkdown.test.tsx frontend/components/extraction/ai/shared/GenerationDetailsDialog.test.tsx`).
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): lazy stored-markdown view inside the generation dialog"`

---

### Task 10: Wire the popover + inline card; delete `RunProvenanceDisclosure`

**Files:**
- Modify: `frontend/components/extraction/ai/AISuggestionReviewPopover.tsx`
- Modify: `frontend/components/extraction/ai/AISuggestionDisplay.tsx`
- Modify: every `AISuggestionReviewPopover`/`AISuggestionDisplay` call site to thread `articleId` (find them: `grep -rn "AISuggestionReviewPopover\|<AISuggestionDisplay" frontend --include="*.tsx" -l`)
- Delete: `frontend/components/extraction/ai/shared/RunProvenanceDisclosure.tsx`, `frontend/components/extraction/ai/shared/RunProvenanceDisclosure.test.tsx`
- Test: existing popover/display test files

**Interfaces:**
- `AISuggestionReviewPopoverProps` and `AISuggestionDisplay` props gain `articleId: string`.
- Dialog state lives in the popover root (one dialog instance, `activeProvenance: RunProvenance | null`); opening details **closes the popover** (`setOpen(false)`) and opens the dialog — a Radix dialog portal outside the popover would dismiss it anyway; make it deliberate.

- [ ] **Step 1: Failing tests** — popover test: selected version renders `ProvenanceSummaryRow` (not the old toggle), no `<pre>` in the popover body; clicking the summary button closes the popover and mounts the dialog with that version's provenance. Display test: inline card same swap.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — in `VersionRow`, replace `{version.provenance && <RunProvenanceDisclosure .../>}` with `{version.provenance && <ProvenanceSummaryRow provenance={version.provenance} onOpenDetails={() => onOpenDetails(version.provenance!)} />}`; thread `onOpenDetails` up to the popover root, which renders `<GenerationDetailsDialog provenance={activeProvenance} articleId={articleId} open={...} onOpenChange={...}/>` as a sibling of `<Popover>`. Same pattern in `AISuggestionDisplay`. Update call sites to pass `articleId` (they already hold it — the history fetch is article-scoped). Then delete `RunProvenanceDisclosure.tsx` + its test; `grep -rn "RunProvenanceDisclosure" frontend` must return nothing.
- [ ] **Step 4: Run the extraction-ai test files + typecheck** — `npm run test:run -- frontend/components/extraction/ai && npx tsc -p tsconfig.app.json --noEmit`: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): route provenance through the generation dialog; drop inline disclosure"`

---

### Task 11: DEV harness + responsiveness stress verification

**Files:**
- Create: `frontend/pages/dev/ReviewPopoverHarness.tsx`
- Modify: `frontend/App.tsx` (DEV-gated lazy route `/dev/review-harness`)
- Verify: preview tooling (no unit test for the harness itself)

**Interfaces:** none produced — the harness imports the popover + dialog with in-memory fixtures (no network: `getHistory` resolves a local array).

- [ ] **Step 1: Build the harness** — route registered only when `import.meta.env.DEV` (lazy import so the prod bundle is unaffected). Fixtures: 12 versions across 3 runs; one value that is a 300-char unbroken token; a 6-paragraph rationale; 4-citation evidence; provenance with a 4k-char system prompt, `fieldsRequested` of 14 names, `llmCalls: 3`, `truncated: true`; one legacy flat provenance version; triggers pinned near the bottom AND top of the viewport (two instances) to stress both flip directions.
- [ ] **Step 2: Stress matrix with preview tooling** — `preview_start`, then for each of 360×640, 768×1024, 1280×800, 1280×500 (plus `colorScheme: dark` on one pass): open both popover instances and the dialog, `preview_inspect` bounding boxes — popover height ≤ viewport height, `document.documentElement.scrollWidth <= innerWidth` (no horizontal overflow), footer visible while the body scrolls. Fix at the source and re-check on any failure. (Scroll/observer glue is asserted in unit tests, not the preview — preview Chrome lacks IntersectionObserver.)
- [ ] **Step 3: `/design-review` pass** on the harness route against the Plane/Linear target; apply prioritized diffs.
- [ ] **Step 4: Commit** — `git commit -m "feat(dev): review popover stress harness + responsive verification"`

---

### Task 12: Full gate

- [ ] **Step 1:** `.markdownlintignore` — add one line: `docs/superpowers/plans/2026-07-03-review-popover-provenance-composition.md` (docs-ci requirement).
- [ ] **Step 2:** `make quality-scan` from repo root (lint + typecheck + tests + fitness) — read the output; any red blocks the ship.
- [ ] **Step 3:** `make test-backend` (needs local Supabase up: `make start` if down; run from a clean state — check `backend/.env` exists in the worktree, copy from the main checkout if missing).
- [ ] **Step 4:** `npm run test:run` full + `npm run lint`.
- [ ] **Step 5:** Commit any stragglers; plan complete.

## Self-Review Notes

- Spec coverage: §1 → Tasks 1-3; read path → Task 4; §2 → Task 7; §3 → Tasks 8, 10; §4 → Tasks 5, 9; §5 → every task's test steps + Tasks 11-12. Timestamp in the dialog context line is dropped (provenance carries no timestamp; the popover's run-group header already shows it) — deliberate deviation, noted for review.
- Type consistency: `PromptInputInfo` (T1) consumed in T3; snapshot snake_case keys (T3) consumed by `_resolve_section_provenance` (T4) and `mapProvenance` (T6); `PromptComposition` camelCase (T6) consumed by T8-9; `articleId` threading (T10) matches T8's dialog prop.
- No placeholders: every code step carries concrete code or an exact edit instruction anchored to line numbers.
