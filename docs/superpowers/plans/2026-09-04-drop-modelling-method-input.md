---
status: shipped
last_reviewed: 2026-09-05
owner: '@raphaelfh'
---

# Drop the modelling-method input — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The model container's manual add dialog asks for the key only, like every other repeating section: the backend records one decision (the name, on the entry key), the request schema no longer carries `modellingMethod`, and the container renders the generic `AddEntryDialog` directly — `AddModelDialog`, its five copy keys and the `children` slot it composed through are deleted.

**Architecture:** PR 3 of the entry-group follow-up train ([spec §6](../specs/2026-09-03-entry-group-followup-train-design.md)). The backend change is a subtraction in three layers of the manual path (`CreateModelHierarchyRequest` → `create_manual_model_hierarchy` → `ModelHierarchyService`); the value had no home on the Multimodal lineage and could land off-list on CHARMS, so it is dropped rather than validated. The schema takes `extra="forbid"`, the rule every request-cycle schema in this module already follows (`ModelExtractionRequest`, `InstanceIdentityUpdateRequest`): a stale tab that still sends `modellingMethod` gets a loud 422 instead of silently losing a value it typed, and the new frontend against the old backend is unaffected because the old field was optional. On the frontend the page hands the container's noun, key label and sibling names straight to `AddEntryDialog`; nothing model-specific remains, so the composing component and the slot it needed go.

**Tech Stack:** FastAPI + Pydantic v2, SQLAlchemy 2.0 async, pytest (unit + integration over the local Supabase Postgres); React 19 + Vitest; openapi-typescript via `scripts/generate_api_types.sh`.

**Spec:** [`docs/superpowers/specs/2026-09-03-entry-group-followup-train-design.md`](../specs/2026-09-03-entry-group-followup-train-design.md) §6 (PR 3) and §9 (cleanup gate).

## Global Constraints

- No table, column or migration: the modelling method was a per-user `ReviewerDecision` row on an existing field, never a column.
- `bash scripts/generate_api_types.sh` after the schema change; `frontend/types/api/{openapi.json,schema.d.ts}` committed (CI's `api-contract` job diffs them). Task 3 fails `npm run typecheck` until Task 2 has regenerated them — keep the order.
- Copy: every deleted key leaves `frontend/lib/copy/extraction.ts`; `python3 scripts/fitness/check_copy_keys.py` stays green (shrink-only).
- `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints` at zero findings; no new `knip.jsonc` exception. The vulture baseline never grows (this PR deletes no baselined symbol, so it stays equal); the mypy ratchet and `make lint-backend` green.
- File-size ratchet: `frontend/pages/ExtractionFullScreen.tsx` only shrinks here; `backend/app/services/section_extraction_service.py` is untouched.
- React Compiler: no `try/finally` or `throw` inside component bodies; the dialog keeps its existing `try/catch` around the awaited confirm.
- English only in code, comments, tests and commits. Conventional commits. Backend commands run inside `backend/` with `uv run`; frontend commands from the repo root (the worktree root, never `backend/`). Integration tests need the local Supabase stack at `dev`'s migration head (`0068_seeded_entry_nouns`).
- PR body reports the `model_container` occurrence count under `backend/app/services` (`grep -rn model_container backend/app/services | wc -l`): 23 before this PR (the spec's 26 predates #806).

---

### Task 1: The service records only the name, on the entry key

**Files:**
- Modify: `backend/app/services/model_hierarchy_service.py:55-65` (signature), `:132-144` (call site), `:226-303` (`_record_initial_field_values` → `_record_key_decision`, to the end of the file)
- Test: `backend/tests/integration/test_model_hierarchy_service.py`

**Interfaces:**
- Produces: `ModelHierarchyService.create_model_hierarchy(*, project_id, article_id, template_id, user_id, model_name) -> ModelHierarchyResult` — the `modelling_method` keyword is gone. `ModelHierarchyResult` is unchanged. Task 2's endpoint calls this signature.

- [ ] **Step 1: Write the failing test — a method value is no longer recorded**

The red is behavioural: on the old code, a call that passes `modelling_method` records TWO decisions (the existing test at `:169-201` proves it); the rewritten test passes the same value on the still-existing keyword and asserts that only the name lands. Step 3 removes the keyword from the service and from this call in the same edit. In `backend/tests/integration/test_model_hierarchy_service.py` replace `test_create_model_hierarchy_records_name_and_method_decisions` with:

```python
@pytest.mark.asyncio
async def test_create_model_hierarchy_records_only_the_name_on_the_key(
    db_session: AsyncSession,
) -> None:
    """The dialog asks for the key only (follow-up train §6): exactly one
    decision lands, on the container's entry key, and no field is ever
    picked by name."""
    clone, article_id, session = await _clone_with_open_session(db_session)

    result = await ModelHierarchyService(db_session).create_model_hierarchy(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
        model_name="Cox Model",
        # Step 1 only: the old keyword still exists, and the old code records
        # this value on CHARMS's modelling_method field — the red. Step 3
        # deletes this line together with the keyword.
        modelling_method="logistic regression",
    )

    assert result.proposal_run_id == session.run_id

    fields = await _container_field_ids_by_name(db_session, clone.project_template_id)
    decisions = await _decisions_for(db_session, session.run_id, result.model_id)
    assert decisions == {fields["model_name"]: {"value": "Cox Model"}}
```

Remove `modelling_method=None,` from `test_create_model_hierarchy_creates_parent_and_singleton_children` and from the `partial(...)` in `test_recorded_model_name_matches_the_deduplicated_label`.

In `test_the_name_is_recorded_on_the_entry_key_not_on_a_field_named_model_name`, drop `modelling_method="logistic regression",` from the call and replace ONLY the three `assert` lines at the end (the `fields = ...` and `decisions = ...` lines above them stay) with:

```python
    assert decisions == {fields["mdl_name"]: {"value": "Cox Model"}}
```

Replace `test_a_keyless_container_still_creates_the_model_and_records_no_name` with:

```python
@pytest.mark.asyncio
async def test_a_keyless_container_still_creates_the_model_and_records_nothing(
    db_session: AsyncSession,
) -> None:
    """Without a key there is no field that holds the name: the instance label
    carries it, no decision is recorded, and creation does not refuse (the
    AI path is what refuses a keyless group, not the manual dialog)."""
    clone, article_id, session = await _clone_with_open_session(db_session)
    await _move_container_key(db_session, clone.project_template_id, to_field=None)

    result = await ModelHierarchyService(db_session).create_model_hierarchy(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
        model_name="Cox Model",
    )

    assert result.model_label == "Cox Model"
    assert result.proposal_run_id is None
    assert await _decisions_for(db_session, session.run_id, result.model_id) == {}
```

- [ ] **Step 2: Run the file to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_model_hierarchy_service.py -q`
Expected: `test_create_model_hierarchy_records_only_the_name_on_the_key` FAILS — `decisions` holds a second entry, `{fields["modelling_method"]: {"value": "logistic regression"}}`; the other four PASS (the kwarg was optional).

- [ ] **Step 3: Delete the modelling-method branch**

In `backend/app/services/model_hierarchy_service.py`, remove the `modelling_method: str | None = None,` parameter from `create_model_hierarchy`; in the test file, delete the `modelling_method="logistic regression",` line (and its three-line comment) from `test_create_model_hierarchy_records_only_the_name_on_the_key` — the keyword no longer exists. Change the service's call site to:

```python
        proposal_run_id = await self._record_key_decision(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            model_entity_type_id=model_entity_type.id,
            model_instance_id=parent.id,
            user_id=user_id,
            # parent.label, not the raw input: the label may have been
            # uniquified ("Cox Model (2)") and the append-only decision
            # value must match every visible surface.
            model_label=parent.label,
        )
```

Replace `_record_initial_field_values` (from its `async def` to the end of the file) with:

```python
    async def _record_key_decision(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        model_entity_type_id: UUID,
        model_instance_id: UUID,
        user_id: UUID,
        model_label: str,
    ) -> UUID | None:
        """Record the dialog's one value — the name — as the reviewer's
        decision on the container's entry key.

        The name lands on the field flagged ``is_entity_key`` — the field
        the AI identifies a model by and the add dialog labels its input
        with — never on a field picked by name: CHARMS keys on
        ``model_name``, the Multimodal lineage on ``mdl_name``. A keyless
        container records nothing (the instance label carries the name).
        Returns the live extract-stage run id when the decision landed,
        ``None`` otherwise (no key field, no run open, or the run advanced
        out of extract mid-flight).
        """
        key_stmt = select(ExtractionField).where(
            ExtractionField.entity_type_id == model_entity_type_id,
            ExtractionField.is_entity_key.is_(True),
        )
        key_field = (await self.db.execute(key_stmt)).scalars().first()
        if key_field is None:
            return None

        run_stmt = (
            select(ExtractionRun)
            .where(
                ExtractionRun.project_id == project_id,
                ExtractionRun.article_id == article_id,
                ExtractionRun.template_id == template_id,
                ExtractionRun.kind == TemplateKind.EXTRACTION.value,
                ExtractionRun.stage == ExtractionRunStage.EXTRACT.value,
            )
            .order_by(ExtractionRun.created_at.desc())
            .limit(1)
        )
        run = (await self.db.execute(run_stmt)).scalars().first()
        if run is None:
            return None

        # A human-entered extraction value must land as a per-user
        # ReviewerDecision (blind-review write defense), not a shared proposal —
        # the form's /decisions path does the same. Recording it as a proposal
        # would leak this reviewer's value to peers via the shared proposal track.
        try:
            await ExtractionReviewService(self.db).record_decision(
                run_id=run.id,
                instance_id=model_instance_id,
                field_id=key_field.id,
                reviewer_id=user_id,
                decision="edit",
                value={"value": model_label},
            )
        except InvalidDecisionError:
            # The run advanced out of extract between lookup and record —
            # the model itself was created fine; losing the prefill must
            # not 500 the whole creation.
            return None
        return run.id
```

- [ ] **Step 4: Run the file and the endpoint's service tests**

Run: `cd backend && uv run pytest tests/integration/test_model_hierarchy_service.py tests/integration/test_extraction_endpoints.py -q -k "hierarchy or Hierarchy"`
Expected: PASS; the endpoint's mocked 201 test still passes because it patches the service class.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/model_hierarchy_service.py backend/tests/integration/test_model_hierarchy_service.py
git commit -m "refactor(extraction): the manual model path records the name only, on the entry key"
```

---

### Task 2: The request schema and the endpoint drop the field; contract regenerated

**Files:**
- Modify: `backend/app/schemas/extraction.py:218-227` (`CreateModelHierarchyRequest`), `backend/app/api/v1/endpoints/model_extraction.py:68-82`
- Test: `backend/tests/unit/test_extraction_schemas.py:520-528`, `backend/tests/integration/test_extraction_endpoints.py:331-341` and `:352-358`
- Regenerate: `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`

**Interfaces:**
- Consumes: Task 1's `create_model_hierarchy(..., model_name)` signature.
- Produces: `CreateModelHierarchyRequest` with fields `project_id`, `article_id`, `template_id`, `model_name` only; the generated `components['schemas']['CreateModelHierarchyRequest']` no longer has `modellingMethod`, which is what Task 3's typecheck relies on.

- [ ] **Step 1: Write the failing schema test**

In `backend/tests/unit/test_extraction_schemas.py`, replace `test_create_model_hierarchy_request` with:

```python
    def test_create_model_hierarchy_request_carries_the_name_only(self) -> None:
        """The dialog asks for the key only (follow-up train §6): the schema
        has no ``modelling_method``, and a stale client's ``modellingMethod``
        is refused loudly (``extra="forbid"``, the rule for every
        request-cycle schema in this module) rather than silently dropped."""
        assert "modelling_method" not in CreateModelHierarchyRequest.model_fields
        payload = {
            "projectId": str(uuid4()),
            "articleId": str(uuid4()),
            "templateId": str(uuid4()),
            "modelName": "Cox PH",
        }
        assert CreateModelHierarchyRequest.model_validate(payload).model_name == "Cox PH"
        with pytest.raises(ValidationError, match="modellingMethod"):
            CreateModelHierarchyRequest.model_validate({**payload, "modellingMethod": "cox"})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_extraction_schemas.py -q -k carries_the_name_only`
Expected: FAIL at `assert "modelling_method" not in CreateModelHierarchyRequest.model_fields`.

- [ ] **Step 3: Drop the field and the pass-through**

In `backend/app/schemas/extraction.py` replace the class with:

```python
class CreateModelHierarchyRequest(BaseModel):
    """Request to create one prediction-model hierarchy for an article.

    The dialog asks for the name only; it becomes the instance label and
    the decision on the container's entry key. ``extra="forbid"`` for the
    reason ``ModelExtractionRequest`` gives: this body is validated once,
    in the request cycle, so a stale tab that still sends
    ``modellingMethod`` gets a loud 422 instead of silently losing a value
    it typed.
    """

    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    template_id: UUID = Field(..., alias="templateId")
    model_name: str = Field(..., alias="modelName")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")
```

In `backend/app/api/v1/endpoints/model_extraction.py`, replace the gate comment and the call:

```python
    await ensure_project_member(db, payload.project_id, current_user_sub)
    # Manual creation records a ReviewerDecision (the name, on the
    # container's entry key), so it carries the same reviewer gate as
    # POST /runs/{id}/decisions — a read-only viewer is a member but
    # must not author audit-trail rows.
    await ensure_project_reviewer(db, payload.project_id, current_user_sub)

    try:
        result = await service.create_model_hierarchy(
            project_id=payload.project_id,
            article_id=payload.article_id,
            template_id=payload.template_id,
            user_id=current_user_sub,
            model_name=payload.model_name,
        )
```

In `backend/tests/integration/test_extraction_endpoints.py`, delete the line `"modellingMethod": "logistic regression",` from the 201 payload, and in `test_manual_model_hierarchy_requires_reviewer_gate` change the docstring's parenthetical to `(the name, on the entry key)`.

- [ ] **Step 4: Run the unit and endpoint tests**

Run: `cd backend && uv run pytest tests/unit/test_extraction_schemas.py tests/integration/test_extraction_endpoints.py -q -k "hierarchy or Hierarchy"`
Expected: PASS.

- [ ] **Step 5: Regenerate the contract and read the diff**

Run: `bash scripts/generate_api_types.sh && git diff --stat frontend/types/api/ && grep -n "modellingMethod" frontend/types/api/schema.d.ts`
Expected: both files change; the only remaining `modellingMethod` in `schema.d.ts` is `CreatedModelInfo` (the AI path's result payload, untouched by design).

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/extraction.py backend/app/api/v1/endpoints/model_extraction.py backend/tests/unit/test_extraction_schemas.py backend/tests/integration/test_extraction_endpoints.py frontend/types/api/openapi.json frontend/types/api/schema.d.ts
git commit -m "feat(extraction): the manual model request carries the name only; contract regenerated"
```

---

### Task 3: `useModelManagement.createModel` takes the name only

**Files:**
- Modify: `frontend/hooks/extraction/useModelManagement.ts:65`, `:231-246`
- Test: `frontend/test/hooks/useModelManagement.test.tsx`

**Interfaces:**
- Consumes: the regenerated `ManualModelHierarchyRequest` (no `modellingMethod`).
- Produces: `createModel: (modelName: string) => Promise<CreateModelResult | null>`; Task 4's page handler calls it with one argument.

- [ ] **Step 1: Update the hook tests to the one-argument contract**

In `frontend/test/hooks/useModelManagement.test.tsx`:

Header comment: delete the two bullets `modellingMethod write skipped silently when no active run yet.` and `modellingMethod field absent on the template (custom CHARMS) → skip write, do NOT throw.`

The describe's leading comment becomes:

```ts
  // The hook delegates the full hierarchy creation (parent + sub-section
  // children + the name recorded on the entry key) to the backend endpoint
  // ``POST /api/v1/extraction/models/manual`` exposed via
  // ``createManualModelHierarchy``; the dialog asks for the name only.
```

Every `createModel('X', '')` becomes `createModel('X')` (five sites: `'Whatever'`, `'  LogReg  '`, `'XGBoost'`, `'Foo'`, `'Beta'`). The `toHaveBeenCalledWith` in the delegation test becomes:

```ts
    expect(createManualModelHierarchy).toHaveBeenCalledWith({
      projectId: 'p-1',
      articleId: 'a-1',
      templateId: 't-1',
      modelName: 'LogReg',
    });
```

Delete the whole `it('forwards modelling_method to the backend (no client-side ReviewerDecision write)', ...)` case.

- [ ] **Step 2: Run the file to verify it fails**

Run: `npx vitest run frontend/test/hooks/useModelManagement.test.tsx`
Expected: the delegation test FAILS — the hook still sends `modellingMethod: null`.

- [ ] **Step 3: Drop the second argument**

In `frontend/hooks/extraction/useModelManagement.ts`:

```ts
  createModel: (modelName: string) => Promise<CreateModelResult | null>;
```

and

```ts
    // Create new model (using service - simplified)
  const createModel = async (modelName: string): Promise<CreateModelResult | null> => {
    if (!user || !modelParentEntityTypeId) {
      toast.error(t('extraction', 'modelNotAuthenticatedOrInvalid'));
      return null;
    }

    const result = await createManualModelHierarchy({
      projectId,
      articleId,
      templateId,
      modelName: modelName.trim(),
    }).catch((err: unknown) => {
```

- [ ] **Step 4: Run the file**

Run: `npx vitest run frontend/test/hooks/useModelManagement.test.tsx`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/extraction/useModelManagement.ts frontend/test/hooks/useModelManagement.test.tsx
git commit -m "refactor(extraction): createModel takes the name only"
```

---

### Task 4: The container uses `AddEntryDialog` directly; `AddModelDialog` and its copy go

**Files:**
- Delete: `frontend/components/extraction/hierarchy/AddModelDialog.tsx`, `frontend/components/extraction/hierarchy/index.ts`
- Modify: `frontend/pages/ExtractionFullScreen.tsx:72` (import), `:707-715` (handler), `:1288-1295` (dialog); `frontend/components/extraction/AddEntryDialog.tsx` (header comment, `children` prop and slot, `ReactNode` import); `frontend/lib/copy/extraction.ts:351-359`
- Test: `frontend/components/extraction/AddEntryDialog.test.tsx`, `frontend/components/extraction/hierarchy/entryLabelNoun.test.tsx`

**Interfaces:**
- Consumes: Task 3's `createModel(modelName)`.
- Produces: `AddEntryDialogProps` without `children`; the page's `handleConfirmAddModel(modelName: string)`.

- [ ] **Step 1: Write the failing dialog test**

Append inside `describe('AddEntryDialog', ...)` in `frontend/components/extraction/AddEntryDialog.test.tsx`, spreading the file's shared `base` props the way its siblings do:

```tsx
  it('asks for the key only — one input, on the container like on any group', () => {
    render(
      <AddEntryDialog
        {...base}
        entryLabel="model"
        keyLabel="Model name"
        existingKeys={[]}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByLabelText(/Model name/)).toBeInTheDocument();
  });
```

In `frontend/components/extraction/hierarchy/entryLabelNoun.test.tsx`, delete the `it('AddModelDialog interpolates the noun ...')` case and the `import {AddModelDialog} from './AddModelDialog';` line.

- [ ] **Step 2: Run both files to verify the state**

Run: `npx vitest run frontend/components/extraction/AddEntryDialog.test.tsx frontend/components/extraction/hierarchy/entryLabelNoun.test.tsx`
Expected: the new case PASSES already (the generic dialog has one input); the noun file PASSES. The red for this task is `npm run typecheck`, which fails on `frontend/pages/ExtractionFullScreen.tsx:708` (`createModel` now takes one argument) — run it and quote the error before Step 3.

- [ ] **Step 3: Delete the model dialog and wire the generic one**

`git rm frontend/components/extraction/hierarchy/AddModelDialog.tsx frontend/components/extraction/hierarchy/index.ts`

In `frontend/pages/ExtractionFullScreen.tsx`:

```tsx
import {RemoveModelDialog} from '@/components/extraction/hierarchy/RemoveModelDialog';
```

```tsx
  const handleConfirmAddModel = async (modelName: string) => {
    const result = await createModel(modelName);
    if (result) {
      setShowAddModelDialog(false);
      // Reload the run view (child instances will be included).
      // refreshModels() is NOT called — the createModel hook already updated local state.
      await preserveScroll(refetchRun);
    }
  };
```

```tsx
      {/* Dialogs */}
      <AddEntryDialog
        open={showAddModelDialog}
        entryLabel={modelParentEntityType?.entry_label ?? DEFAULT_ENTRY_NOUN}
        keyLabel={modelKeyField?.label ?? null}
        existingKeys={models.map(m => m.modelName)}
        onConfirm={handleConfirmAddModel}
        onCancel={() => setShowAddModelDialog(false)}
      />
```

In `frontend/components/extraction/AddEntryDialog.tsx`: change the import to `import {useState, type FormEvent} from 'react';`; in the header comment replace `(identity spec §1), now for every repeating section.` with `(identity spec §1), now for every repeating section — the container included, since the follow-up train dropped its one extra input.`; delete the `children?: ReactNode;` prop and its doc comment, the `children,` destructure, and the `{children}` line between the key input block and `<ErrorAlert>`.

In `frontend/lib/copy/extraction.ts` delete the keys `modelDescriptionPlaceholder`, `modelNameLabel`, `modellingMethodLabel`, `modellingMethodOptional`, `modellingMethodHint`, and change the comment `// ModelSelector / AddModelDialog` to `// ModelSelector`.

- [ ] **Step 4: Typecheck, the touched tests, the copy gate**

Run: `npm run typecheck && npx vitest run frontend/components/extraction frontend/test/hooks/useModelManagement.test.tsx frontend/test/ExtractionFormView.test.tsx && python3 scripts/fitness/check_copy_keys.py`
Expected: all exit 0; the copy check reports the shrunk key set with no unreferenced key.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/components/extraction/hierarchy frontend/components/extraction/AddEntryDialog.tsx frontend/components/extraction/AddEntryDialog.test.tsx frontend/pages/ExtractionFullScreen.tsx frontend/lib/copy/extraction.ts
git commit -m "feat(extraction): the container's add dialog is the generic entry dialog; AddModelDialog deleted"
```

---

### Task 5: Gates, spec amendments and plan registration

**Files:**
- Modify: `.markdownlintignore` (this plan), `docs/superpowers/specs/2026-09-03-entry-group-followup-train-design.md` (§6.1 amendments)

- [ ] **Step 1: Register the plan and record the deltas**

Append `docs/superpowers/plans/2026-09-04-drop-modelling-method-input.md` to `.markdownlintignore`.

Add to the spec, after §6:

```markdown
### 6.1 Amendments recorded at execution (2026-09-04)

- The schema takes `extra="forbid"`, as `ModelExtractionRequest` and
  `InstanceIdentityUpdateRequest` do in the same module (validated once,
  in the request cycle): a stale tab that still sends `modellingMethod`
  gets a loud 422 until it reloads, instead of silently losing a value it
  typed. The new frontend against the old backend is unaffected (the old
  field was optional).
- `AddEntryDialog` loses the `children` slot the model dialog composed
  through; the hierarchy barrel goes with its last composed export. The
  page now mounts two `AddEntryDialog`s (the container's and the generic
  `useAddEntry` one) that share literal input ids; a closed Radix dialog
  renders no DOM and the UI never opens both, so the ids never coexist —
  noted in the PR body, resolved for good when the trees spec unifies
  creation.
- `modelNameLabel` was the fifth key only the model dialog read; deleted
  with the four the spec names. The keyless container's input now reads
  "Label", as on every other keyless group.
- The architecture reference carries no row for `/api/v1/extraction/models/manual`
  (the endpoint is described in the `extraction_entity_types` prose,
  which stays true); nothing to change there.
- `model_container` under `backend/app/services`: 23 before and after
  (the spec's 26 predates #806).
```

- [ ] **Step 2: Run every gate and read the output**

```bash
make lint-backend
cd backend && uv run mypy app --ignore-missing-imports > mypy.out || true; uv run python ../scripts/mypy_baseline.py --baseline .mypy_baseline --input mypy.out; cd ..
python3 scripts/vulture_baseline.py
npx knip --no-tag-hints && npx knip --production --no-tag-hints
python3 scripts/fitness/check_copy_keys.py
make test-backend
npm run test:run
npm run typecheck && npm run lint
make quality-scan
grep -rn model_container backend/app/services | wc -l
```

Expected: all exit 0; `make quality-scan` reports every gate `exit=0`; the count prints `23`.

- [ ] **Step 3: Commit**

```bash
git add .markdownlintignore docs/superpowers/plans/2026-09-04-drop-modelling-method-input.md docs/superpowers/specs/2026-09-03-entry-group-followup-train-design.md
git commit -m "docs(specs): record the modelling-method deltas; register the plan"
```
