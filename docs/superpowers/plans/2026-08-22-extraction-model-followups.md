---
status: approved
last_reviewed: 2026-08-22
owner: '@raphaelfh'
---

# Extraction model follow-ups (#659 residuals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four residual defects diagnosed alongside PR #659: manual model creation drops the typed name into the label only; InstanceCard icon buttons are unlabeled; the model-container badge always reads "Multiple (1)"; and the saved active model loses the restore race to the first-model fallback.

**Architecture:** One backend service extension (record initial field values as per-user ReviewerDecisions, mirroring the existing modelling_method path) and three small frontend changes (a11y wrappers on InstanceCard, a truthful count prop on SectionAccordion, and moving active-model preference into `useModelManagement`). No schema, migration, or API-contract change — `proposal_run_id` already exists on the response.

**Tech Stack:** FastAPI + SQLAlchemy async (service layer only), React 19 + shadcn Tooltip, vitest + pytest integration (real local Supabase).

## Global Constraints

- English only for code, comments, commits, copy keys (CLAUDE.md).
- All user-facing text through `frontend/lib/copy/` (`t('extraction', key)` with `{{placeholder}}` interpolation).
- Icon-only buttons: shadcn `Tooltip` with `TooltipTrigger asChild` **and** `aria-label` (`.claude/rules/frontend.md`).
- React Compiler: no `try/finally` or `throw` inside `try` in component/hook bodies.
- No new `supabase.from(...)` reads; no `fetch()`.
- Tests first, RED observed before GREEN, one behavior per test.
- Conventional commits; PR targets `dev`.

## Panel revisions (2026-08-22, folded before execution)

Five-lens adversarial review (layering, security/BOLA, migration-safety,
YAGNI, test-coverage). Verdicts: 4× OK, 1× BLOCKING (security). Folded:

1. **Task 1 (BLOCKING, security):** `POST /api/v1/extraction/models/manual`
   gains `ensure_project_reviewer` after the member check — the plan makes
   ReviewerDecision writes unconditional, and a `viewer` member must not
   author audit-trail rows (mirrors `extraction_runs.py:327`). Endpoint
   test patches + asserts both guards.
2. **Task 1:** record `parent.label` (the uniquified label), not the raw
   `model_label` — the append-only decision value must match every visible
   surface ("Cox Model (2)" case).
3. **Task 1 (hardening):** run lookup also filters
   `ExtractionRun.project_id == project_id`; the recording block is wrapped
   in `try/except InvalidDecisionError: return None` (a mid-flight stage
   advance must not 500 the whole creation); the unreachable
   `not to_record` guard is dropped (empty `IN ()` already returns None).
4. **Task 2:** ONE `TooltipProvider` wrapping the card's action buttons
   (three `Tooltip`s inside), not one provider per button; hoist the
   repeated remove-label `t(...)` into a const; no native `title` attr.
5. **Task 3:** the badge string becomes copy
   (`sectionMultipleBadge: 'Multiple ({{count}})'`) — the line is being
   edited anyway; hardcoded English on it would grandfather a violation.
6. **Task 4:** the two hook tests go into the EXISTING suite
   `frontend/test/hooks/useModelManagement.test.tsx` (15 tests already pin
   the fallback; reuse its harness) — not a new file. The page edit uses
   the prose anchor (`// Restore the active model on load`, actual lines
   647-657; persist effect is 640-645 — the original numeric ranges were
   shifted). The `localStorage.getItem` in `useMemo` is try/catch-guarded
   (SidebarContext precedent) with a comment on mount-snapshot semantics.
7. **Task 4/5 (coverage):** the page→hook wiring line has no automated
   test that would fail if omitted (no frontend diff-cover gate exists);
   Task 5 therefore includes an explicit page-seam verification (extend
   the readonly page-test fixture if cheap, else a live-browser check of
   the restore behavior) before the gate is called green.

## File Structure

- `backend/app/services/model_hierarchy_service.py` — generalize `_record_modelling_method_if_possible` into `_record_initial_field_values` (model_name + modelling_method).
- `backend/tests/integration/test_model_hierarchy_service.py` — add the with-run decision-recording test.
- `frontend/components/extraction/InstanceCard.tsx` — Tooltip + aria-label on trash, save, cancel buttons.
- `frontend/components/extraction/InstanceCard.a11y.test.tsx` — new.
- `frontend/lib/copy/extraction.ts` — three new keys.
- `frontend/components/extraction/SectionAccordion.tsx` — optional `totalInstanceCount` prop feeding the badge.
- `frontend/components/extraction/ModelSection.tsx` — pass `totalInstanceCount={models.length}` on the container accordion.
- `frontend/components/extraction/ModelSection.test.tsx` — badge assertion.
- `frontend/hooks/extraction/useModelManagement.ts` — `initialModelId` preference in the load fallback.
- `frontend/hooks/extraction/useModelManagement.initialModel.test.tsx` — new.
- `frontend/pages/ExtractionFullScreen.tsx` — compute `initialModelId` from localStorage, pass to the hook, delete the racy restore effect.

---

### Task 1: Record model_name (and modelling_method) as initial ReviewerDecisions

**Files:**
- Modify: `backend/app/services/model_hierarchy_service.py:215-263` (`_record_modelling_method_if_possible`)
- Test: `backend/tests/integration/test_model_hierarchy_service.py`

**Interfaces:**
- Consumes: `ExtractionReviewService.record_decision(run_id, instance_id, field_id, reviewer_id, decision, value)`; conftest `open_session(db, project_id=..., article_id=..., template_id=..., user_id=...)` → `HITLSession` with `.run_id`.
- Produces: `_record_initial_field_values(*, article_id, template_id, model_entity_type_id, model_instance_id, user_id, values: dict[str, str | None]) -> UUID | None` (returns the live run id when at least one decision was recorded). `create_model_hierarchy` behavior otherwise unchanged; `ModelHierarchyResult.proposal_run_id` semantics preserved.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.asyncio
async def test_create_model_hierarchy_records_name_and_method_decisions(
    db_session: AsyncSession,
) -> None:
    from app.models.extraction import ExtractionField
    from app.models.extraction_workflow import ExtractionReviewerDecision
    from tests.integration.conftest import open_session

    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    article_id = await _fresh_article(db_session, SEED.secondary_project)

    session = await open_session(
        db_session,
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
    )

    result = await ModelHierarchyService(db_session).create_model_hierarchy(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
        model_name="Cox Model",
        modelling_method="logistic regression",
    )

    assert result.proposal_run_id == session.run_id

    fields = {
        f.name: f.id
        for f in (
            await db_session.execute(
                select(ExtractionField).where(
                    ExtractionField.entity_type_id
                    == (
                        await db_session.execute(
                            select(ExtractionEntityType.id).where(
                                ExtractionEntityType.project_template_id
                                == clone.project_template_id,
                                ExtractionEntityType.role
                                == ExtractionEntityRole.MODEL_CONTAINER.value,
                            )
                        )
                    ).scalar_one(),
                )
            )
        )
        .scalars()
        .all()
    }
    decisions = {
        row.field_id: row.value
        for row in (
            await db_session.execute(
                select(ExtractionReviewerDecision).where(
                    ExtractionReviewerDecision.run_id == session.run_id,
                    ExtractionReviewerDecision.instance_id == result.model_id,
                )
            )
        )
        .scalars()
        .all()
    }
    assert decisions[fields["model_name"]] == {"value": "Cox Model"}
    assert decisions[fields["modelling_method"]] == {"value": "logistic regression"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/integration/test_model_hierarchy_service.py -q`
Expected: FAIL — `KeyError` on `fields["model_name"]` lookup in `decisions` (only the modelling_method decision exists today).

- [ ] **Step 3: Implement — generalize the recorder**

Replace `_record_modelling_method_if_possible` with `_record_initial_field_values` (same file):

```python
    async def _record_initial_field_values(
        self,
        *,
        article_id: UUID,
        template_id: UUID,
        model_entity_type_id: UUID,
        model_instance_id: UUID,
        user_id: UUID,
        values: dict[str, str | None],
    ) -> UUID | None:
        """Record the dialog-provided values as per-user ReviewerDecisions.

        ``values`` maps container field *names* to raw strings; empty/None
        entries and names the template does not carry are skipped. Returns
        the live extract-stage run id when at least one decision landed,
        ``None`` otherwise (no run open, or nothing to record).
        """
        to_record = {name: value for name, value in values.items() if value}
        if not to_record:
            return None

        field_stmt = select(ExtractionField).where(
            ExtractionField.entity_type_id == model_entity_type_id,
            ExtractionField.name.in_(to_record.keys()),
        )
        fields = list((await self.db.execute(field_stmt)).scalars().all())
        if not fields:
            return None

        run_stmt = (
            select(ExtractionRun)
            .where(
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
        # ReviewerDecision (blind-review write defense), not a shared
        # proposal — the form's /decisions path does the same.
        review_service = ExtractionReviewService(self.db)
        for field in fields:
            await review_service.record_decision(
                run_id=run.id,
                instance_id=model_instance_id,
                field_id=field.id,
                reviewer_id=user_id,
                decision="edit",
                value={"value": to_record[field.name]},
            )
        return run.id
```

Call site in `create_model_hierarchy` becomes:

```python
        proposal_run_id = await self._record_initial_field_values(
            article_id=article_id,
            template_id=template_id,
            model_entity_type_id=model_entity_type.id,
            model_instance_id=parent.id,
            user_id=user_id,
            values={
                "model_name": model_label,
                "modelling_method": modelling_method,
            },
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/integration/test_model_hierarchy_service.py tests/integration/test_extraction_endpoints.py -q`
Expected: PASS (both files; the no-run test keeps passing — recorder returns None without a run).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/model_hierarchy_service.py backend/tests/integration/test_model_hierarchy_service.py
git commit -m "fix(extraction): land dialog-typed model_name as the model_name field value"
```

---

### Task 2: Label the InstanceCard icon buttons (trash, save, cancel)

**Files:**
- Modify: `frontend/components/extraction/InstanceCard.tsx` (remove button block, edit-mode save/cancel block)
- Modify: `frontend/lib/copy/extraction.ts` (three keys)
- Test: `frontend/components/extraction/InstanceCard.a11y.test.tsx` (new)

**Interfaces:**
- Consumes: shadcn `Tooltip/TooltipContent/TooltipProvider/TooltipTrigger` from `@/components/ui/tooltip` (pattern: `ModelSelector.tsx:294-323`).
- Produces: copy keys `instanceRemoveAction: 'Remove "{{label}}"'`, `instanceLabelSaveAction: 'Save label'`, `instanceLabelCancelAction: 'Cancel label editing'`.

- [ ] **Step 1: Write the failing test** (real copy module; supabase mocked)

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { InstanceCard } from '@/components/extraction/InstanceCard';

const instance = {
  id: 'i1', entity_type_id: 'et1', article_id: 'a', template_id: 't',
  label: 'Model A', metadata: {}, created_at: '',
};

const baseProps = {
  instance: instance as never,
  index: 1,
  fields: [],
  values: {},
  onValueChange: vi.fn(),
  projectId: 'p',
};

describe('InstanceCard icon-button labels', () => {
  it('names the remove button after the instance label', () => {
    render(<InstanceCard {...baseProps} canRemove onRemove={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Remove "Model A"' }),
    ).toBeInTheDocument();
  });

  it('names the save and cancel buttons in label-edit mode', async () => {
    const user = userEvent.setup();
    render(<InstanceCard {...baseProps} canRemove={false} />);
    await user.click(screen.getByRole('button', { name: /Model A/ }));
    expect(screen.getByRole('button', { name: 'Save label' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Cancel label editing' }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/components/extraction/InstanceCard.a11y.test.tsx`
Expected: FAIL — no accessible names (buttons are bare icons today).

- [ ] **Step 3: Implement**

`frontend/lib/copy/extraction.ts` (inside the extraction namespace, near the other instance keys):

```ts
    instanceRemoveAction: 'Remove "{{label}}"',
    instanceLabelSaveAction: 'Save label',
    instanceLabelCancelAction: 'Cancel label editing',
```

`InstanceCard.tsx` — import tooltip primitives, then wrap the three buttons; remove button becomes:

```tsx
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onRemove}
                    aria-label={t('extraction', 'instanceRemoveAction').replace('{{label}}', savedLabel)}
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('extraction', 'instanceRemoveAction').replace('{{label}}', savedLabel)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
```

Save and cancel get the same wrapper with `aria-label={t('extraction', 'instanceLabelSaveAction')}` / `'instanceLabelCancelAction'` and matching `TooltipContent`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/components/extraction/InstanceCard.a11y.test.tsx frontend/components/extraction/SectionAccordion.readonly.test.tsx frontend/components/extraction/ModelSection.test.tsx`
Expected: PASS (readonly + ModelSection suites still green — the destructive-census selectors keep matching the Button, and no new destructive button appears).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/extraction/InstanceCard.tsx frontend/components/extraction/InstanceCard.a11y.test.tsx frontend/lib/copy/extraction.ts
git commit -m "fix(extraction): label InstanceCard icon buttons (tooltip + aria-label)"
```

---

### Task 3: Truthful entry count on the container badge

**Files:**
- Modify: `frontend/components/extraction/SectionAccordion.tsx:27-51` (props) and the badge at `:125-129`
- Modify: `frontend/components/extraction/ModelSection.tsx` (container `SectionAccordion` call)
- Test: `frontend/components/extraction/ModelSection.test.tsx`

**Interfaces:**
- Produces: `SectionAccordionProps.totalInstanceCount?: number` — badge renders `Multiple ({totalInstanceCount ?? instances.length})`; all other consumers unchanged.

- [ ] **Step 1: Write the failing test** — in `ModelSection.test.tsx`, add a second model to the fixtures **only for this test** (render override) and assert the badge:

```tsx
  it('shows the total entry count on the container badge, not the active-only count', () => {
    renderModelSection({
      models: [
        { instanceId: 'm1', modelName: 'Model A' },
        { instanceId: 'm2', modelName: 'Model B' },
      ],
    });
    expect(screen.getByText('Multiple (2)')).toBeInTheDocument();
  });
```

Refactor `renderModelSection` to accept `overrides: Partial<ModelSectionProps> = {}` spread last into the JSX props (`{...overrides}` via a props object).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/components/extraction/ModelSection.test.tsx`
Expected: FAIL — badge reads `Multiple (1)` (accordion only receives the active instance).

- [ ] **Step 3: Implement**

`SectionAccordion.tsx` props:

```ts
  /**
   * Badge count override for containers that render only the active
   * instance but represent more entries (the model container).
   */
  totalInstanceCount?: number;
```

Badge:

```tsx
                  {isMultiple && (
                    <Badge variant="outline" className="text-xs">
                        Multiple ({props.totalInstanceCount ?? instances.length})
                    </Badge>
                  )}
```

`ModelSection.tsx` container call gains `totalInstanceCount={models.length}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/components/extraction/ModelSection.test.tsx frontend/components/extraction/SectionAccordion.removeGating.test.tsx frontend/components/extraction/SectionAccordion.readonly.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/extraction/SectionAccordion.tsx frontend/components/extraction/ModelSection.tsx frontend/components/extraction/ModelSection.test.tsx
git commit -m "fix(extraction): container badge counts all model entries"
```

---

### Task 4: Active-model restore preference beats the first-model fallback

**Files:**
- Modify: `frontend/hooks/extraction/useModelManagement.ts` (props + fallback in `loadModels`)
- Modify: `frontend/pages/ExtractionFullScreen.tsx:631-648` (compute `initialModelId`, delete the restore effect, keep the persist effect)
- Test: `frontend/hooks/extraction/useModelManagement.initialModel.test.tsx` (new)

**Interfaces:**
- Produces: `UseModelManagementProps.initialModelId?: string | null` — when the current active id is absent from the loaded list, the fallback prefers `initialModelId` (if present in the list) over the first model. Callers that omit it keep today's behavior.

- [ ] **Step 1: Write the failing test**

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/services/extractionInstanceService', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchModelProgress: vi.fn().mockResolvedValue({ completed: 0, total: 0, percentage: 0 }),
}));

import { useModelManagement } from '@/hooks/extraction/useModelManagement';

const modelInstances = [
  { id: 'm1', label: 'Model A', sort_order: 0, created_at: '' },
  { id: 'm2', label: 'Model B', sort_order: 1, created_at: '' },
];

describe('useModelManagement initial model preference', () => {
  it('restores initialModelId instead of falling back to the first model', async () => {
    const { result } = renderHook(() =>
      useModelManagement({
        projectId: 'p', articleId: 'a', templateId: 't',
        modelParentEntityTypeId: 'et-container',
        modelInstances,
        initialModelId: 'm2',
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activeModelId).toBe('m2');
  });

  it('falls back to the first model when initialModelId is not in the list', async () => {
    const { result } = renderHook(() =>
      useModelManagement({
        projectId: 'p', articleId: 'a', templateId: 't',
        modelParentEntityTypeId: 'et-container',
        modelInstances,
        initialModelId: 'gone',
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activeModelId).toBe('m1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/hooks/extraction/useModelManagement.initialModel.test.tsx`
Expected: first test FAILS (`activeModelId === 'm1'`); second passes.

- [ ] **Step 3: Implement**

`useModelManagement.ts`:

```ts
  /**
   * Preferred model to activate when no current selection survives a
   * load (page reload / model removed). The page passes the
   * localStorage-persisted id; the hook applies it only when the id is
   * present in the loaded list, else falls back to the first model.
   */
  initialModelId?: string | null;
```

Destructure `initialModelId = null` and change the fallback inside `loadModels`:

```ts
      if (!hasActiveModel) {
        const preferred =
          initialModelId && modelsWithProgress.some(m => m.instanceId === initialModelId)
            ? initialModelId
            : (modelsWithProgress[0]?.instanceId ?? null);
        setActiveModelId(preferred);
      }
```

`ExtractionFullScreen.tsx`: above the `useModelManagement` call add

```ts
  // Restore preference for the active model (persisted below). Read via
  // useMemo so navigation to another article re-reads the right key.
  const initialModelId = useMemo(
    () => (articleId ? localStorage.getItem(`active-model-${articleId}`) : null),
    [articleId],
  );
```

pass `initialModelId,` into `useModelManagement({...})`, and **delete** the now-dead restore effect (`// Restore the active model on load` block, lines 638-648). Keep the persist effect (631-636).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/hooks/extraction/useModelManagement.initialModel.test.tsx frontend/components/extraction frontend/hooks/extraction`
Expected: PASS (area suite stays green).

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/extraction/useModelManagement.ts frontend/hooks/extraction/useModelManagement.initialModel.test.tsx frontend/pages/ExtractionFullScreen.tsx
git commit -m "fix(extraction): saved active model wins the restore race"
```

---

### Task 5: Whole-diff gate

- [ ] `npx tsc -p tsconfig.app.json --noEmit` — clean.
- [ ] `npx eslint` on every touched file — clean.
- [ ] `cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .` — clean.
- [ ] `make quality-scan` (or its constituent suites when the runner is unavailable in the worktree) — read the output, all green.
- [ ] In-process ASGI endpoint proof (as in #659) — POST `/api/v1/extraction/models/manual` with a live session open → 201 and the model_name decision visible in the run view read path.
