---
status: draft
last_reviewed: 2026-07-02
owner: '@raphaelfh'
---

# Finalized Run Read-Only Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A finalized (Published) run renders read-only on both session screens, showing the published values, with a visible "published — read-only" banner and a Reopen button; UI editability and autosave persistence are driven by one shared predicate.

**Architecture:** A tiny `editability` helper (`editable ⇔ stage === 'extract'`) shared by autosave and a new `RunEditability` React context; interactive leaf components (FieldInput, suggestion chrome, add/remove controls, section AI-extract, nav-rail footer) consume the context with an editable default. A new published-values resolution path hydrates the form from `runDetail.published_states` at `finalized` (extraction via `useExtractedValues`, QA via its inline hydration), preserving ADR-0016 marker envelopes so dispositions render as labels. Backend endpoints unchanged; one DB-integrity migration (published-state instance FK CASCADE → RESTRICT, panel security finding) plus missing 400-on-finalized test coverage.

**Tech Stack:** React 19 + TS strict, React Compiler (`panicThreshold: all_errors`), vitest + RTL (jsdom), TanStack Query, in-house copy at `frontend/lib/copy/`, pytest (backend integration).

Spec: `docs/superpowers/specs/2026-07-02-finalized-run-read-only-design.md`.

## Global Constraints

- Repo worktree: `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/jovial-colden-df8903` — run all commands from this root (frontend tooling runs from repo root; there is no `frontend/package.json`).
- English only; ALL user-facing strings through `frontend/lib/copy/` (`t(ns, key)`, manual `.replace('{{x}}', …)` interpolation).
- React Compiler: no `try/finally` or `throw` inside `try` in component/hook bodies. The compiler runs in vitest too — a non-compiling component fails tests.
- `ExtractionFormView` and `FieldInput` have custom memo comparators. Context consumption bypasses memo (context updates always re-render consumers) — this is WHY we use context, not new props. Do NOT add new props to those components for editability.
- Frontend tests: `npx vitest run <file>` for a single file; full suite `npm run test:run` (NEVER plain `npm test` — watch mode hangs).
- Backend tests: `cd backend && uv run pytest <file> -x` (needs local Supabase Docker; never run two backend suites concurrently — advisory lock).
- Conventional commits. ONE Alembic migration (Task 9b: FK flip; revision id ≤ 32 chars, literal constraint names via raw SQL). No API/Pydantic schema changes ⇒ no `npm run generate:api-types` needed.
- Most component tests mock copy as `vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }))` — queries then match copy KEYS. Screen-level tests use REAL copy.

---

### Task 1: `editability` helper + unify both autosave predicates (behavior-neutral)

**Files:**
- Create: `frontend/lib/runs/editability.ts`
- Create: `frontend/test/lib/editability.test.ts`
- Modify: `frontend/pages/ExtractionFullScreen.tsx:379-380` (autosave `enabled`)
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx:247-254` (autosave `enabled`)

**Interfaces:**
- Produces: `isRunEditable(stage: string | null | undefined): boolean` — the single export (a `reason` vocabulary was dropped in panel review: no consumer branches on it; the banner keys off `finalized` directly). Later tasks import from `@/lib/runs/editability`.

- [ ] **Step 1: Write the failing test**

`frontend/test/lib/editability.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { isRunEditable } from '@/lib/runs/editability';

describe('isRunEditable', () => {
  it('is true only for the extract stage', () => {
    expect(isRunEditable('extract')).toBe(true);
    for (const stage of ['finalized', 'consensus', 'pending', 'cancelled', null, undefined]) {
      expect(isRunEditable(stage)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/test/lib/editability.test.ts`
Expected: FAIL — cannot resolve `@/lib/runs/editability`.

- [ ] **Step 3: Write the implementation**

`frontend/lib/runs/editability.ts`:

```ts
/**
 * Single editability invariant (spec 2026-07-02 D1): the form is editable
 * exactly when autosave persists — both derive from this predicate so the
 * UI can never accept input the backend will drop. Absent/unknown stages
 * (still loading, cancelled) are read-only.
 */
export function isRunEditable(stage: string | null | undefined): boolean {
  return stage === 'extract';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/test/lib/editability.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Switch both autosave `enabled` predicates to the helper**

`frontend/pages/ExtractionFullScreen.tsx` — add import `import { isRunEditable } from '@/lib/runs/editability';` and change (current lines 379-380):

```tsx
    enabled:
      !!activeRunId && !loading && valuesInitialized && isRunEditable(stage),
```

`frontend/pages/QualityAssessmentFullScreen.tsx` — add the same import and change (current lines ~252-253; anchor on the `enabled:` content, not the line number):

```tsx
      enabled:
        !!session && !!runDetail && isRunEditable(runDetail.run.stage),
```

Both are behavior-identical (`stage === 'extract'` ⇔ `isRunEditable(stage)`; QA's `runDetail` null-guard is preserved).

- [ ] **Step 6: Run the guard-adjacent suites to prove neutrality**

Run: `npx vitest run frontend/test/hooks/useAutoSaveProposals.test.tsx frontend/test/QualityAssessmentFullScreen.test.tsx`
Expected: PASS, no changes needed in those files.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/runs/editability.ts frontend/test/lib/editability.test.ts frontend/pages/ExtractionFullScreen.tsx frontend/pages/QualityAssessmentFullScreen.tsx
git commit -m "refactor(runs): single editability predicate shared by both autosave gates"
```

---

### Task 2: `RunEditability` context

**Files:**
- Create: `frontend/components/runs/RunEditabilityContext.tsx`
- Create: `frontend/components/runs/RunEditabilityContext.test.tsx`

**Interfaces:**
- Consumes: `isRunEditable` from Task 1.
- Produces: `RunEditabilityProvider({ stage, children })`; `useRunEditability(): RunEditabilityValue` where `RunEditabilityValue = { readOnly: boolean }`. **Default (no provider) is editable** — safe for every existing FieldInput consumer and test.

- [ ] **Step 1: Write the failing test**

`frontend/components/runs/RunEditabilityContext.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  RunEditabilityProvider,
  useRunEditability,
} from './RunEditabilityContext';

function Probe() {
  const { readOnly } = useRunEditability();
  return <div data-testid="probe" data-readonly={String(readOnly)} />;
}

describe('RunEditability context', () => {
  it('defaults to editable without a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveAttribute('data-readonly', 'false');
  });

  it('is editable for the extract stage', () => {
    render(
      <RunEditabilityProvider stage="extract">
        <Probe />
      </RunEditabilityProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveAttribute('data-readonly', 'false');
  });

  it.each([['finalized'], ['consensus'], ['pending'], [null]])(
    'is read-only for stage=%s',
    (stage) => {
      render(
        <RunEditabilityProvider stage={stage as string | null}>
          <Probe />
        </RunEditabilityProvider>,
      );
      expect(screen.getByTestId('probe')).toHaveAttribute('data-readonly', 'true');
    },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/components/runs/RunEditabilityContext.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`frontend/components/runs/RunEditabilityContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react';

import { isRunEditable } from '@/lib/runs/editability';

export interface RunEditabilityValue {
  readOnly: boolean;
}

// Editable default: a FieldInput rendered outside any provider (tests,
// dev harness) behaves exactly as before.
const EDITABLE: RunEditabilityValue = { readOnly: false };
const READ_ONLY: RunEditabilityValue = { readOnly: true };

const RunEditabilityCtx = createContext<RunEditabilityValue>(EDITABLE);

export function RunEditabilityProvider({
  stage,
  children,
}: {
  stage: string | null | undefined;
  children: ReactNode;
}) {
  const value = isRunEditable(stage) ? EDITABLE : READ_ONLY;
  return <RunEditabilityCtx.Provider value={value}>{children}</RunEditabilityCtx.Provider>;
}

export function useRunEditability(): RunEditabilityValue {
  return useContext(RunEditabilityCtx);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/components/runs/RunEditabilityContext.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/RunEditabilityContext.tsx frontend/components/runs/RunEditabilityContext.test.tsx
git commit -m "feat(runs): RunEditability context with editable default"
```

---

### Task 3: `publishedStatesToValuesMap` helper

**Files:**
- Create: `frontend/lib/extraction/publishedValues.ts`
- Create: `frontend/test/lib/publishedValues.test.ts`

**Interfaces:**
- Consumes: `PublishedStateResponse` from `@/hooks/runs/types` (`{ id, run_id, instance_id, field_id, value: Record<string, unknown>, published_at, published_by, version }`); `valueAbsentReason` + `unwrapValueEnvelope` from `@/lib/extraction/valueSemantics`; `extractValueFromDb` from `@/lib/validations/selectOther`. (Do NOT import from `@/services/` — lib never depends on services in this repo, and the services module drags the supabase client into env-less unit tests.)
- Produces: `publishedStatesToValuesMap(rows): Record<string, unknown>` keyed `${instance_id}_${field_id}` — the exact key shape both screens' values maps use.

- [ ] **Step 1: Write the failing test**

`frontend/test/lib/publishedValues.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { publishedStatesToValuesMap } from '@/lib/extraction/publishedValues';
import type { PublishedStateResponse } from '@/hooks/runs/types';

function row(over: Partial<PublishedStateResponse>): PublishedStateResponse {
  return {
    id: 'ps1',
    run_id: 'r1',
    instance_id: 'i1',
    field_id: 'f1',
    value: { value: 'x' },
    published_at: '2026-07-01T00:00:00Z',
    published_by: 'u1',
    version: 1,
    ...over,
  };
}

describe('publishedStatesToValuesMap', () => {
  it('returns an empty map for undefined/empty rows', () => {
    expect(publishedStatesToValuesMap(undefined)).toEqual({});
    expect(publishedStatesToValuesMap([])).toEqual({});
  });

  it('unwraps a plain envelope to the scalar', () => {
    const map = publishedStatesToValuesMap([row({ value: { value: 'RCT registry' } })]);
    expect(map['i1_f1']).toBe('RCT registry');
  });

  it('preserves an ADR-0016 marker envelope verbatim (FieldInput renders the label)', () => {
    const marker = { value: null, absent_reason: 'no_information' };
    const map = publishedStatesToValuesMap([row({ value: marker })]);
    expect(map['i1_f1']).toEqual(marker);
  });

  it('keeps units from a double-wrapped envelope (the only unit shape writers produce)', () => {
    const map = publishedStatesToValuesMap([
      row({ value: { value: { value: 12, unit: 'weeks' } } }),
    ]);
    expect(map['i1_f1']).toEqual({ value: 12, unit: 'weeks' });
  });

  it('keys by instance and field', () => {
    const map = publishedStatesToValuesMap([
      row({ instance_id: 'iA', field_id: 'fA', value: { value: 1 } }),
      row({ instance_id: 'iB', field_id: 'fB', value: { value: 2 } }),
    ]);
    expect(Object.keys(map).sort()).toEqual(['iA_fA', 'iB_fB']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/test/lib/publishedValues.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`frontend/lib/extraction/publishedValues.ts`:

```ts
import { extractValueFromDb } from '@/lib/validations/selectOther';
import {
  unwrapValueEnvelope,
  valueAbsentReason,
} from '@/lib/extraction/valueSemantics';
import type { PublishedStateResponse } from '@/hooks/runs/types';

/**
 * Resolve `runDetail.published_states` into the `${instanceId}_${fieldId}`
 * values map both session forms consume (spec 2026-07-02 D3). Published-only,
 * no reviewer-state fallback: a coord without a published row stays absent.
 *
 * Marker envelopes (`{value: null, absent_reason}`) are preserved verbatim —
 * FieldInput derives the disposition label from the raw envelope, and the
 * generic unwrap would collapse the marker to null.
 *
 * Unit handling mirrors the reviewer-state loop in useExtractedValues: every
 * writer publishes units double-wrapped ({value:{value,unit}}), so one peel
 * exposes the {value,unit} inner envelope for the unit sniff.
 */
export function publishedStatesToValuesMap(
  rows: readonly PublishedStateResponse[] | undefined,
): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const row of rows ?? []) {
    const key = `${row.instance_id}_${row.field_id}`;
    const raw: unknown = row.value;
    if (valueAbsentReason(raw) !== null) {
      map[key] = raw;
      continue;
    }
    const unwrapped = unwrapValueEnvelope(raw) ?? null;
    const unit =
      typeof unwrapped === 'object' && unwrapped !== null && 'unit' in unwrapped
        ? ((unwrapped as { unit: string | null }).unit ?? null)
        : null;
    map[key] = extractValueFromDb({ value: unwrapped, unit });
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/test/lib/publishedValues.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/extraction/publishedValues.ts frontend/test/lib/publishedValues.test.ts
git commit -m "feat(extraction): published_states → form values map helper (marker-preserving)"
```

---

### Task 4: `useExtractedValues` published path + extraction screen wiring

**Files:**
- Modify: `frontend/hooks/extraction/useExtractedValues.ts` (props at 52-78, path selectors at 95-114, `doLoad` at ~193-272)
- Modify: `frontend/pages/ExtractionFullScreen.tsx:207-217` (hook call site)
- Test: `frontend/test/hooks/useExtractedValues.test.tsx` (extend)

**Interfaces:**
- Consumes: `publishedStatesToValuesMap` (Task 3).
- Produces: new optional hook prop `publishedStates?: PublishedStateResponse[]`. At `stage === 'finalized'` the hook hydrates ONLY from it; `currentValues` is no longer read at finalized.

- [ ] **Step 1: Write the failing tests** (append a suite to `frontend/test/hooks/useExtractedValues.test.tsx`, reusing the file's existing mock preamble — the published helper lives in `lib/` and touches no mocked service module, so no new mocks are needed. Also update the test file's own header comment, which still documents the retired "finalized resolves from reviewer-states" semantics):

```tsx
describe('finalized stage — published values', () => {
  const published = [
    {
      id: 'ps1', run_id: 'run-1', instance_id: 'i1', field_id: 'f1',
      value: { value: 'published-A' },
      published_at: '', published_by: 'u9', version: 1,
    },
    {
      id: 'ps2', run_id: 'run-1', instance_id: 'i1', field_id: 'f2',
      value: { value: null, absent_reason: 'no_information' },
      published_at: '', published_by: 'u9', version: 1,
    },
  ];

  it('hydrates from published_states and ignores currentValues', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        runId: 'run-1',
        stage: 'finalized',
        kind: 'extraction',
        currentUserId: 'user-1',
        currentValues: [
          { instance_id: 'i1', field_id: 'f1', value: { value: 'MY-DRAFT' }, decision: 'edit' },
          { instance_id: 'i1', field_id: 'f9', value: { value: 'DRAFT-ONLY' }, decision: 'edit' },
        ],
        publishedStates: published as never,
      }),
    );
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['i1_f1']).toBe('published-A');
    // Draft-only coord does NOT leak into a published view:
    expect(result.current.values['i1_f9']).toBeUndefined();
  });

  it('preserves the marker envelope for published abstentions', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        runId: 'run-1',
        stage: 'finalized',
        kind: 'extraction',
        currentUserId: 'user-1',
        publishedStates: published as never,
      }),
    );
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['i1_f2']).toEqual({ value: null, absent_reason: 'no_information' });
  });

  it('REPLACES pre-finalize values when the same run flips to finalized in-session', async () => {
    // The manager finalizes from consensus WITHOUT leaving the page
    // (handleApproveFinalize → refetchRun + refreshValues): the runId is
    // unchanged, so the hydration must replace, not merge — otherwise the
    // stale reviewer-state value survives under the Published banner.
    const { result, rerender } = renderHook(
      ({ stage, publishedStates }: { stage: string; publishedStates?: unknown }) =>
        useExtractedValues({
          runId: 'run-1',
          stage,
          kind: 'extraction',
          currentUserId: 'user-1',
          currentValues: [
            { instance_id: 'i1', field_id: 'f1', value: { value: 'MY-DRAFT' }, decision: 'edit' },
          ],
          publishedStates: publishedStates as never,
        }),
      { initialProps: { stage: 'consensus' } },
    );
    await waitFor(() => expect(result.current.values['i1_f1']).toBe('MY-DRAFT'));

    rerender({ stage: 'finalized', publishedStates: published });
    await waitFor(() => expect(result.current.values['i1_f1']).toBe('published-A'));
    // The draft-only coord from the consensus hydration is gone too:
    expect(result.current.values['i1_f9']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run frontend/test/hooks/useExtractedValues.test.tsx`
Expected: new suite FAILS (`i1_f1` is `'MY-DRAFT'` — reviewer-state path still wins); existing suites PASS.

- [ ] **Step 3: Implement the published path**

In `frontend/hooks/extraction/useExtractedValues.ts`:

1. Add the helper import, and EXTEND the existing type import in place (the file already has `import type { ProposalRecordResponse, RunViewCurrentValue } from '@/hooks/runs/types';` at ~line 41 — add `PublishedStateResponse` to that line; a second import statement from the same module is a duplicate-identifier TS error):

```ts
import { publishedStatesToValuesMap } from '@/lib/extraction/publishedValues';
import type { ProposalRecordResponse, PublishedStateResponse, RunViewCurrentValue } from '@/hooks/runs/types';
```

2. Add to `UseExtractedValuesProps` (after `currentValues`):

```ts
  /**
   * Published rows from the run view. At ``stage === 'finalized'`` the form
   * hydrates ONLY from these (spec 2026-07-02 D3) — published truth, not the
   * viewer's decision stream.
   */
  publishedStates?: PublishedStateResponse[];
```

3. Destructure it: `const { runId, stage, kind, proposals, currentValues, publishedStates, currentUserId, enabled = true } = props;`

4. In `doLoad`, insert BEFORE the `usesProposalsPath` branch. CRITICAL: the branch must REPLACE the values map, not merge. `applyLoadedValues` merges when `hydratedRunIdRef.current === runId` (`mergeValuesById` keeps every existing key), so an in-session finalize (same runId, stage consensus → finalized via `handleApproveFinalize`) would keep stale reviewer-state values under the Published banner. Reset the hydration marker first so `applyLoadedValues` takes its replace path, and keep an identity guard so refetch churn with unchanged content doesn't re-render the tree:

```ts
        if (stage === 'finalized') {
          // Published truth only — no reviewer-state fallback. A coord
          // without a published row renders empty (it was never published).
          const publishedMap = publishedStatesToValuesMap(publishedStates);
          setValues((prev) =>
            JSON.stringify(prev) === JSON.stringify(publishedMap) ? prev : publishedMap,
          );
          setLoadedValues((prev) =>
            JSON.stringify(prev) === JSON.stringify(publishedMap) ? prev : publishedMap,
          );
          hydratedRunIdRef.current = runId;
          setInitialized(true);
          return;
        }
```

(This bypasses `applyLoadedValues` deliberately: published hydration is a full replacement — local-edits-win merging is an editable-form concern and there are no local edits on a read-only run. The JSON-equality guards mirror the existing `setLoadedValues` identity check at lines 173-175.)

5. Remove `stage === 'finalized'` from `usesReviewerStatePath` and update its comment:

```ts
// Read-path selectors for the collapsed ``extract`` stage. Extraction writes
// per-user decisions (reviewer-states); QA writes shared proposals. consensus
// resolves from reviewer-states; finalized resolves from published_states
// (dedicated branch in ``doLoad``).
function usesReviewerStatePath(
  stage: string | null | undefined,
  kind: string | null | undefined,
): boolean {
  return (
    stage === 'consensus' ||
    (stage === 'extract' && kind === 'extraction')
  );
}
```

(The `useEffect` deps are `[enabled, loadValues]` and the React Compiler tracks `loadValues`'s real captures — `publishedStates` joins the closure automatically; no manual dep edit.)

Also update the now-stale doc comments in the SAME commit: the file-header docblock ("consensus/finalized always use reviewer-states"), the `kind` prop doc (lines ~56-60), and the `currentValues` prop doc — all three must say finalized resolves from `published_states`.

6. Wire the call site, `frontend/pages/ExtractionFullScreen.tsx` (~line 209):

```tsx
  } = useExtractedValues({
    runId: activeRunId,
    stage,
    kind: 'extraction',
    proposals,
    currentValues: runDetail?.current_values,
    publishedStates: runDetail?.published_states,
    currentUserId,
    enabled: !!activeRunId,
  });
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run frontend/test/hooks/useExtractedValues.test.tsx`
Expected: ALL suites PASS (including pre-existing finalized-era tests, if any asserted reviewer-state at finalized — update those to the new published semantics; the spec makes published the correct source).

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/extraction/useExtractedValues.ts frontend/pages/ExtractionFullScreen.tsx frontend/test/hooks/useExtractedValues.test.tsx
git commit -m "feat(extraction): finalized runs hydrate the form from published_states"
```

---

### Task 5: QA finalized hydration from published_states

**Files:**
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx` (hydration-during-render at ~190-219; autosave baseline at ~230-245)
- Test: `frontend/test/QualityAssessmentFullScreen.test.tsx` (extend)

**Interfaces:**
- Consumes: `publishedStatesToValuesMap` (Task 3).

- [ ] **Step 1: Write the failing screen test** (extend `frontend/test/QualityAssessmentFullScreen.test.tsx`; clone the existing run-view apiClient fixture into a finalized variant. IMPORTANT — verified fixture facts this test must fit: the fixture's fields are Radix SELECTs (`'Appropriate data sources?'` with allowed values `['Y','PY','PN','N','NI','NA']`), FieldInput labels have no `htmlFor`, so `findByLabelText`/`toHaveValue` CANNOT work. Publish an ALLOWED code and assert the rendered select-trigger text within the domain):

```tsx
it('finalized: form shows published values, not latest proposals', async () => {
  // Fixture variant: run.stage = 'finalized'; proposals keep one stale row
  // { instance_id: 'inst-1', field_id: 'f-1', proposed_value: { value: 'PY' } };
  // published_states: [{ id: 'ps-1', run_id: 'run-1', instance_id: 'inst-1',
  //   field_id: 'f-1', value: { value: 'Y' }, published_at: '', published_by: 'u9', version: 1 }].
  renderPage();
  const domain = await screen.findByTestId('qa-domains');
  // Published code renders on the select trigger; the stale proposal does not.
  expect(await within(domain).findByText('Y')).toBeInTheDocument();
  expect(within(domain).queryByText('PY')).not.toBeInTheDocument();
});
```

(Match the fixture's real instance/field ids and testids — read the file's existing run-view mock first; if the domain container testid differs, anchor `within()` on the testid the fixture actually renders. If 'Y' collides with other trigger text, switch the published code to a fixture-unique allowed value like 'NA'.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run frontend/test/QualityAssessmentFullScreen.test.tsx`
Expected: new test FAILS — input shows `draft-proposal`.

- [ ] **Step 3: Implement**

In `QualityAssessmentFullScreen.tsx` add `import { publishedStatesToValuesMap } from '@/lib/extraction/publishedValues';` and change the hydration block:

```tsx
  const [prevRunDetail, setPrevRunDetail] = useState(runDetail);
  if (runDetail !== prevRunDetail) {
    setPrevRunDetail(runDetail);
    if (runDetail) {
      if (runDetail.run.stage === "finalized") {
        // Published truth replaces any local/proposal state (spec D3).
        setValues(publishedStatesToValuesMap(runDetail.published_states));
      } else {
        const latestByCoord = new Map<string, unknown>();
        // ... (existing proposal loop, unchanged) ...
        setValues((prev) => { /* existing merge, unchanged */ });
      }
    }
  }
```

Leave the autosave baseline (`loadedValuesMap`) untouched — autosave is disabled at finalized by the Task 1 gate, so a finalized-aware baseline would be dead code (panel YAGNI finding).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run frontend/test/QualityAssessmentFullScreen.test.tsx`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/QualityAssessmentFullScreen.tsx frontend/test/QualityAssessmentFullScreen.test.tsx
git commit -m "feat(qa): finalized assessments hydrate the form from published_states"
```

---

### Task 6: FieldInput + suggestion chrome consume the context

**Files:**
- Modify: `frontend/components/extraction/FieldInput.tsx` (destructure at 73; `renderInput()` disabled sites at 207, 222, 259, 270, 303, 319, 329, 361, 372, 384, 397; disposition `disabled` at ~533; badge at 479-484; suggestion strip at 546-560)
- Modify: `frontend/components/extraction/ai/AISuggestionReviewPopover.tsx` ("Use this version" at ~141, Clear at ~275-282)
- Create: `frontend/components/extraction/FieldInput.readonly.test.tsx`

**Interfaces:**
- Consumes: `useRunEditability` (Task 2).
- Produces: under a read-only provider, EVERY FieldInput variant is disabled, the disposition buttons are disabled, the AI badge + inline suggestion strip do not render; the History popover still opens but exposes no "use"/"clear" actions.

- [ ] **Step 1: Write the failing test**

`frontend/components/extraction/FieldInput.readonly.test.tsx` (mirror the setup of the colocated `FieldInput.test.tsx` — copy mock, `TooltipProvider`, `makeField` factory):

```tsx
import { render as rtlRender, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { FieldInput } from './FieldInput';
import { RunEditabilityProvider } from '@/components/runs/RunEditabilityContext';
import type { ExtractionField } from '@/types/extraction';
import type { AISuggestion } from '@/types/ai-extraction';

function makeField(over: Partial<ExtractionField>): ExtractionField {
  return {
    id: 'f1', entity_type_id: 'et', name: 'x', label: 'X', description: null,
    field_type: 'text', is_required: false, validation_schema: null, allowed_values: null,
    unit: null, allowed_units: null, llm_description: null, sort_order: 0, created_at: '',
    ...over,
  };
}

const PENDING_SUGGESTION = {
  id: 'p1', status: 'pending', value: 'suggested', confidence: 0.9,
} as unknown as AISuggestion;

function renderReadOnly(ui: React.ReactElement) {
  return rtlRender(
    <TooltipProvider>
      <RunEditabilityProvider stage="finalized">{ui}</RunEditabilityProvider>
    </TooltipProvider>,
  );
}

describe('FieldInput under a read-only run', () => {
  it('disables the text input', () => {
    renderReadOnly(
      <FieldInput field={makeField({})} instanceId="i1" value="v" onChange={vi.fn()} projectId="p1" />,
    );
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('disables the disposition buttons', () => {
    renderReadOnly(
      <FieldInput field={makeField({})} instanceId="i1" value="" onChange={vi.fn()} projectId="p1" />,
    );
    expect(screen.getByRole('button', { name: 'dispositionNoInformation' })).toBeDisabled();
  });

  it('renders a published marker as an active (but disabled) disposition', () => {
    renderReadOnly(
      <FieldInput
        field={makeField({})} instanceId="i1"
        value={{ value: null, absent_reason: 'no_information' }}
        onChange={vi.fn()} projectId="p1"
      />,
    );
    const btn = screen.getByRole('button', { name: 'dispositionNoInformation' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toBeDisabled();
  });

  it('hides the pending-suggestion strip and badge', () => {
    // Content-based assertion with a positive control: 'ai-suggestion-display'
    // has NO testid in the repo (verified) — a testid query would pass
    // vacuously both before and after the fix.
    renderReadOnly(
      <FieldInput
        field={makeField({})} instanceId="i1" value="" onChange={vi.fn()} projectId="p1"
        aiSuggestion={PENDING_SUGGESTION} onAcceptAI={vi.fn()} onRejectAI={vi.fn()}
      />,
    );
    expect(screen.queryByText('suggested')).not.toBeInTheDocument();
  });

  it('positive control: the strip DOES render without a provider', () => {
    rtlRender(
      <TooltipProvider>
        <FieldInput
          field={makeField({})} instanceId="i1" value="" onChange={vi.fn()} projectId="p1"
          aiSuggestion={PENDING_SUGGESTION} onAcceptAI={vi.fn()} onRejectAI={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText('suggested')).toBeInTheDocument();
  });

  it('stays editable without a provider (default)', () => {
    rtlRender(
      <TooltipProvider>
        <FieldInput field={makeField({})} instanceId="i1" value="v" onChange={vi.fn()} projectId="p1" />
      </TooltipProvider>,
    );
    expect(screen.getByRole('textbox')).toBeEnabled();
  });
});
```

(The positive control proves the read-only assertion is non-vacuous: same props, provider on/off, strip present/absent. If the raw string renders differently — e.g. via AISuggestionValue formatting — pin whatever text the positive control finds.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run frontend/components/extraction/FieldInput.readonly.test.tsx`
Expected: FAIL — inputs enabled, suggestion strip present.

- [ ] **Step 3: Implement in FieldInput**

```tsx
import { useRunEditability } from '@/components/runs/RunEditabilityContext';
// inside the component body, after destructuring props:
  const { readOnly } = useRunEditability();
  const inputDisabled = disabled || readOnly;
```

Then replace every `disabled={disabled}` inside `renderInput()` and the disposition block with `disabled={inputDisabled}`, and gate the AI chrome:

```tsx
        {!readOnly && aiSuggestion && (aiSuggestion.status === 'pending' || aiSuggestion.status === 'accepted') && (
          <AISuggestionBadge suggestion={aiSuggestion} />
        )}
...
        {!readOnly && shouldShowSuggestion && (
          <AISuggestionDisplay ... />
        )}
```

(Keep the History icon / `AISuggestionReviewPopover` trigger rendered — audit trail stays.)

- [ ] **Step 4: Implement in AISuggestionReviewPopover**

```tsx
import { useRunEditability } from '@/components/runs/RunEditabilityContext';
```

NOTE: the "Use this version" button (~line 141) lives inside the file-local `VersionRow` subcomponent, not the exported popover body — consume the hook in BOTH places (context crosses Radix portals fine), or call it once in `VersionRow` and once in the popover body:

- `VersionRow`: `const { readOnly } = useRunEditability();` → render the "Use this version" button only when `!readOnly` (an `isSelected` version keeps its chip).
- Popover body: `const { readOnly } = useRunEditability();` → Clear button gate (~line 275-282) changes from `onClear ? (...)` to `onClear && !readOnly ? (...)`.

Add a read-only popover test to the new `FieldInput.readonly.test.tsx` (do NOT mock the popover there): render FieldInput read-only with `getSuggestionsHistory` resolving one non-selected version, open the popover (click the History-icon trigger), then `expect(screen.queryByText('reviewUseThisVersion')).not.toBeInTheDocument()` (copy is key-mocked) with a positive control in the editable render.

- [ ] **Step 5: Run the new + adjacent suites**

Run: `npx vitest run frontend/components/extraction/FieldInput.readonly.test.tsx frontend/components/extraction/FieldInput.test.tsx frontend/components/extraction/FieldInput.review.test.tsx frontend/components/extraction/FieldInput.memo.test.tsx frontend/test/FieldInput.density.test.tsx`
Expected: ALL PASS (existing tests run without a provider → editable default keeps them green).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/extraction/FieldInput.tsx frontend/components/extraction/ai/AISuggestionReviewPopover.tsx frontend/components/extraction/FieldInput.readonly.test.tsx
git commit -m "feat(extraction): FieldInput + review popover honor RunEditability (read-only)"
```

---

### Task 7: remaining form-tree affordances consume the context

**Files:**
- Modify: `frontend/components/extraction/ai/shared/SectionAIExtractButton.tsx`
- Modify: `frontend/components/extraction/SectionAccordion.tsx` (empty-state add button ~163-175; below-cards add button ~202-213)
- Modify: `frontend/components/extraction/InstanceCard.tsx` (remove button ~150-159; label editing ~104-146)
- Modify: `frontend/components/extraction/hierarchy/ModelSelector.tsx` (add-model ~214-223 and empty-state ~155-158; remove-model ~245-255; AI extract dropdown ~177-213; per-model Sparkles ~275-306)
- Modify: `frontend/components/extraction/SectionNavRail.tsx` (footer ~65-74)
- Create: `frontend/components/extraction/SectionAccordion.readonly.test.tsx`
- Modify: `frontend/components/assessment/QASectionAccordion.test.tsx` (extend)

**Interfaces:**
- Consumes: `useRunEditability` (Task 2).
- Produces: when read-only — `SectionAIExtractButton` renders `null`; add-instance / remove-instance / add-model / remove-model / model-extract controls do not render; instance-label editing is view-only; the nav-rail keeps navigation but drops the progress footer.

- [ ] **Step 1: Write the failing tests**

`frontend/components/extraction/SectionAccordion.readonly.test.tsx` (mirror `frontend/test/SectionAccordion.flat.test.tsx` setup — supabase + copy mocks, `QueryClientProvider` wrapper — and wrap in `RunEditabilityProvider stage="finalized"`):

```tsx
// setup identical to SectionAccordion.flat.test.tsx (mocks + Wrapper + entityType/field factories)

it('read-only: hides the section AI-extract button and the add-instance button', () => {
  render(
    <Wrapper>
      <RunEditabilityProvider stage="finalized">
        <SectionAccordion
          entityType={{ ...entityType, cardinality: 'many' }}
          instances={[]}
          fields={[]}
          values={{}}
          onValueChange={vi.fn()}
          onAddInstance={vi.fn()}
          projectId="p" articleId="a" templateId="t"
        />
      </RunEditabilityProvider>
    </Wrapper>,
  );
  expect(screen.queryByTestId('section-ai-extract-et1')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /sectionAddInstance/ })).not.toBeInTheDocument();
});

it('read-only: InstanceCard hides remove and add-below-cards controls', () => {
  // One instance so InstanceCard actually mounts (empty instances would make
  // the InstanceCard gates unexercised — panel coverage finding).
  render(
    <Wrapper>
      <RunEditabilityProvider stage="finalized">
        <SectionAccordion
          entityType={{ ...entityType, cardinality: 'many' }}
          instances={[{ id: 'i1', entity_type_id: 'et1', article_id: 'a', template_id: 't', label: null, metadata: {}, created_at: '' } as never]}
          fields={[]}
          values={{}}
          onValueChange={vi.fn()}
          onAddInstance={vi.fn()}
          onRemoveInstance={vi.fn()}
          projectId="p" articleId="a" templateId="t"
        />
      </RunEditabilityProvider>
    </Wrapper>,
  );
  expect(screen.queryByRole('button', { name: /addInstanceLabel/ })).not.toBeInTheDocument();
  // InstanceCard's remove (Trash2) button is icon-only; assert no destructive button renders:
  expect(document.querySelector('[class*="text-destructive"]')).toBeNull();
});
```

Also add a small read-only case to `ModelSelector` (new colocated `frontend/components/extraction/hierarchy/ModelSelector.readonly.test.tsx`, minimal render with one model): assert the add-model button (`modelAddManuallyTitle` key), remove-model button, and AI-extract dropdown are absent under `RunEditabilityProvider stage="finalized"`, present without the provider (positive control).

Extend `frontend/components/assessment/QASectionAccordion.test.tsx` (NOTE: the file passes props INLINE — there is no `baseProps` object; extract the existing inline props into a local `const baseProps` first, keeping the existing editable test green):

```tsx
it('read-only: hides the per-domain AI-extract button', () => {
  render(
    <RunEditabilityProvider stage="finalized">
      <QASectionAccordion {...baseProps} />
    </RunEditabilityProvider>,
  );
  expect(screen.queryByTestId('section-ai-extract-qa-dom')).not.toBeInTheDocument();
});
```

(The existing test already asserts the button EXISTS in the editable case — that is the positive control.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run frontend/components/extraction/SectionAccordion.readonly.test.tsx frontend/components/assessment/QASectionAccordion.test.tsx`
Expected: new tests FAIL (buttons render).

- [ ] **Step 3: Implement**

`SectionAIExtractButton.tsx` — RULES OF HOOKS (panel blocking finding): the component calls `useSectionExtraction(...)` at ~line 46; an early return ABOVE it makes that hook conditional → eslint error, React Compiler panic (fails vitest), and a real "rendered fewer hooks" crash when `readOnly` flips on a mounted tree (stage starts null). The bail goes AFTER all hooks:

```tsx
  const { readOnly } = useRunEditability();
  const { extractSection, loading } = useSectionExtraction({ onSuccess }); // existing hook, unchanged
  if (readOnly) return null;
  // ...existing handleClick + JSX unchanged...
```

`SectionAccordion.tsx` — `const { readOnly } = useRunEditability();`; gate both add-instance renders with `!readOnly &&` (`{isMultiple && !readOnly && props.onAddInstance && (...)}` and `{!readOnly && props.onAddInstance && (...)}`).

`InstanceCard.tsx` — `const { readOnly } = useRunEditability();`; remove button gate becomes `{!readOnly && canRemove && onRemove && (...)}`; label editing: suppress the edit affordance when readOnly (render the plain label; do not enter edit mode).

`ModelSelector.tsx` — `const { readOnly } = useRunEditability();`; gate add-model (both sites), remove-model, the AI-extract dropdown, and the per-model extract button with `!readOnly &&`.

`SectionNavRail.tsx` — `const { readOnly } = useRunEditability();`; footer gate becomes `{!collapsed && !readOnly && (...)}` (dots + navigation stay).

- [ ] **Step 4: Run to verify pass + adjacent suites**

Run: `npx vitest run frontend/components/extraction/SectionAccordion.readonly.test.tsx frontend/components/assessment/QASectionAccordion.test.tsx frontend/test/SectionAccordion.flat.test.tsx frontend/test/ExtractionFormView.test.tsx`
Expected: ALL PASS (ExtractionFormView.test.tsx mocks SectionNavRail/SectionAccordion, unaffected).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/extraction/ai/shared/SectionAIExtractButton.tsx frontend/components/extraction/SectionAccordion.tsx frontend/components/extraction/InstanceCard.tsx frontend/components/extraction/hierarchy/ModelSelector.tsx frontend/components/extraction/SectionNavRail.tsx frontend/components/extraction/SectionAccordion.readonly.test.tsx frontend/components/assessment/QASectionAccordion.test.tsx
git commit -m "feat(extraction): form-tree affordances honor RunEditability"
```

---

### Task 8: screen wiring — providers, published banner, copy migration

**Files:**
- Modify: `frontend/lib/copy/runs.ts` (new keys)
- Modify: `frontend/components/runs/HITLStatusBadges.tsx` (hardcoded strings → copy; this file is touched anyway — clean it)
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (provider mount ~1115-1180; sub-header ~1102-1112; `aiPendingCount` pass-through ~1246)
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx` (provider mount around `formPanel`; new sub-header; `AIActions` gates ~634-639; `RunSplitShell` call ~789-797)
- Test: `frontend/test/QualityAssessmentFullScreen.test.tsx` (extend)

**Interfaces:**
- Consumes: `RunEditabilityProvider` (Task 2), `isRunEditable` (Task 1), `HITLStatusBadges` / `HITLReopenButton` (existing).
- Produces: both screens mount the provider around their left-panel content; a finalized run shows the sub-header banner: Published badge + `publishedReadOnlyNotice` + Reopen button.

- [ ] **Step 1: Add copy keys** (`frontend/lib/copy/runs.ts`, inside the existing object):

```ts
  published: 'Published',
  publishedReadOnlyNotice: 'Published values — read-only. Reopen to edit.',
  reopenForRevision: 'Reopen for revision',
  reopening: 'Reopening…',
  revisionDerivedFrom: 'Derived from a previous version',
```

(`revisionDerivedFrom` deliberately drops the "run {{id}}" wording — the run-vocabulary rule bans the entity noun in user-facing copy, and a raw UUID in a tooltip helps nobody; clean-in-touched-code.)

- [ ] **Step 2: Migrate `HITLStatusBadges.tsx` to copy** — add `import { t } from '@/lib/copy';`; replace `Published` → `{t('runs', 'published')}`, `Revision` → `{t('runs', 'revision')}` (key exists), `title={...}` → `title={t('runs', 'revisionDerivedFrom')}`, and in `HITLReopenButton`: `{reopening ? t('runs', 'reopening') : t('runs', 'reopenForRevision')}`.

- [ ] **Step 3: Write the failing QA screen test** (extend `frontend/test/QualityAssessmentFullScreen.test.tsx` — REAL copy in this file):

```tsx
it('finalized: shows the published banner with a reopen button, hides edit chrome', async () => {
  renderPage(); // with the finalized run-view fixture from Task 5
  expect(await screen.findByTestId('qa-finalized-badge')).toBeInTheDocument();
  expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  expect(screen.getByTestId('qa-reopen-button')).toBeInTheDocument();
  // Header AI-extract stays hidden (existing behavior, now via isRunEditable):
  expect(screen.queryByRole('button', { name: /extract with ai/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run frontend/test/QualityAssessmentFullScreen.test.tsx`
Expected: FAILS — no `qa-finalized-badge` (QA renders no sub-header today).

- [ ] **Step 5: Implement — QA screen**

```tsx
import { RunEditabilityProvider } from '@/components/runs/RunEditabilityContext';
import { HITLReopenButton, HITLStatusBadges } from '@/components/runs/HITLStatusBadges';
import { isRunEditable } from '@/lib/runs/editability'; // already imported in Task 1
```

Sub-header (place next to the existing `finalized` const):

```tsx
  const qaSubHeader =
    parentRunId || finalized ? (
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs">
        <HITLStatusBadges kind="qa" finalized={finalized} parentRunId={parentRunId} />
        {finalized && (
          <>
            <span className="text-muted-foreground">{t('runs', 'publishedReadOnlyNotice')}</span>
            <HITLReopenButton
              kind="qa"
              visible
              onClick={() => void handleReopen()}
              reopening={reopening}
            />
          </>
        )}
      </div>
    ) : null;
```

Pass it: `<RunSplitShell ... subHeader={qaSubHeader} ... />`.

Provider mount — wrap the form panel content:

```tsx
  const formPanel = (
    <RunEditabilityProvider stage={runDetail?.run.stage ?? null}>
      <div className="space-y-3 p-4" data-testid="qa-form-panel">
        ...existing content unchanged...
      </div>
    </RunEditabilityProvider>
  );
```

Header AIActions:

```tsx
          <RunHeader.AIActions
            pendingCount={finalized ? 0 : countActionableSuggestions(aiSuggestions)}
            canExtract={!!(session && runDetail && isRunEditable(runDetail.run.stage))}
            extracting={extractingAI}
            onExtract={onExtractWithAI}
          />
```

(Note: `canExtract` was `session && !finalized` — it wrongly allowed `consensus`; `isRunEditable` closes that. The pending pill is zeroed at finalized — a published run advertises no actionable suggestions.)

- [ ] **Step 6: Implement — extraction screen**

Provider mount (around the left-panel branches, ~line 1115):

```tsx
  const extractionFormPanel = (
    <RunEditabilityProvider stage={stage}>
      {inConsensusStage && runDetail ? (
        ...existing ConsensusPanel branch unchanged...
      ) : (
        ...existing ExtractionFormPanel branch unchanged...
      )}
    </RunEditabilityProvider>
  );
```

(ConsensusPanel renders only ui-primitives — no context consumers — so the wrap is safe and defensively covers future changes; verified 2026-07-02.)

Sub-header (~1102-1112) becomes:

```tsx
  const extractionSubHeader =
    parentRunId || isFinalized || (!activeRunId && finalizedRun) ? (
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs">
        <HITLStatusBadges
          kind="extraction"
          finalized={isFinalized || (!activeRunId && !!finalizedRun)}
          parentRunId={parentRunId}
        />
        {(isFinalized || (!activeRunId && !!finalizedRun)) && (
          <>
            <span className="text-muted-foreground">{t('runs', 'publishedReadOnlyNotice')}</span>
            <HITLReopenButton
              kind="extraction"
              visible={canReopen}
              onClick={() => void handleReopen()}
              reopening={reopening}
            />
          </>
        )}
      </div>
    ) : null;
```

(`import { HITLReopenButton } from '@/components/runs/HITLStatusBadges';` — extend the existing import. The header-menu Reopen item stays.)

Pending pill zeroing (~line 1246): pass `aiPendingCount={isFinalized ? 0 : aiPendingCount}` to `ExtractionHeader`.

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run frontend/test/QualityAssessmentFullScreen.test.tsx frontend/test/copyRuns.test.ts frontend/test/copy-run-vocabulary.test.ts`
Expected: ALL PASS (copy tests still green with the new keys — they ban the "Run" noun in `consensus/extraction/qa` namespaces; the new keys live in `runs`, and `revisionDerivedFrom` uses "run" deliberately in the shared namespace, matching the existing `runs.ts` precedent).

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/copy/runs.ts frontend/components/runs/HITLStatusBadges.tsx frontend/pages/ExtractionFullScreen.tsx frontend/pages/QualityAssessmentFullScreen.tsx frontend/test/QualityAssessmentFullScreen.test.tsx
git commit -m "feat(runs): published read-only banner + editability providers on both screens"
```

---

### Task 9: extraction screen-level read-only test

**Files:**
- Create: `frontend/test/ExtractionFullScreen.readonly.test.tsx`

**Interfaces:**
- Consumes: everything shipped in Tasks 1-8. This is the end-to-end jsdom proof for THE reported bug: a Published extraction run must render read-only with published values.

- [ ] **Step 1: Build the harness by cloning `frontend/test/QualityAssessmentFullScreen.test.tsx`** (the canonical screen harness). Keep its blocks, adapted:

- `vi.mock('sonner')`, `vi.mock('@/hooks/useCurrentUser', ...)`, comparison-permissions mock, the supabase chainable-builder mock, and the **verbatim `@prumo/pdf-viewer` mock** (PrumoPdfViewer stub + REAL `createViewerStore`/`subscribeReaderLocate` from `@/pdf-viewer/core` — the barrel crashes jsdom).
- URL-keyed `vi.mock('@/integrations/api', ...)` apiClient returning:
  - `POST /api/v1/hitl/sessions` → session `{ run_id: 'run-1', ... }` (mirror the QA harness shape, `kind: 'extraction'`),
  - `/api/v1/runs/run-1/view` → run-view envelope with `run: { stage: 'finalized', ... }`, `entity_types` (one study section with one required text field), `instances` (one), `proposals: []`, `decisions: []`, `consensus_decisions: []`, `current_values: [{ instance_id: 'i1', field_id: 'f1', value: { value: 'MY-DRAFT' }, decision: 'edit' }]`, `published_states: [{ id: 'ps1', run_id: 'run-1', instance_id: 'i1', field_id: 'f1', value: { value: 'published-final' }, published_at: '', published_by: 'u9', version: 1 }]`,
  - `/api/v1/articles/a1/finalized-run` → `{ id: 'run-1', stage: 'finalized', status: 'completed', template_id: 'tpl-1' }`,
  - `[]` / empty objects for `/files`, `/text-blocks`, `/suggestions`, and any other GET the render surfaces (MSW's `onUnhandledRequest: 'error'` + the apiClient mock make every missing route fail loudly — add routes until render settles; do NOT silence with a catch-all success that hides real regressions).
- Route: render at `/projects/p1/extraction/a1` with `<Route path="/projects/:projectId/extraction/:articleId" element={<SidebarProvider><ExtractionFullScreen /></SidebarProvider>} />` (wrap in the same `QueryClientProvider` + `MemoryRouter` helper; add the `RunRoute`-equivalent providers only if render errors demand them).

- [ ] **Step 2: Write the assertions**

```tsx
it('published run renders read-only with published values', async () => {
  renderPage();
  // Published value, not the viewer draft:
  const input = await screen.findByDisplayValue('published-final');
  expect(input).toBeDisabled();
  expect(screen.queryByDisplayValue('MY-DRAFT')).not.toBeInTheDocument();
  // Banner + reopen:
  expect(screen.getByTestId('extraction-finalized-badge')).toBeInTheDocument();
  expect(screen.getByTestId('extraction-reopen-button')).toBeInTheDocument();
  expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  // No fill-completion CTA:
  expect(screen.queryByText(/required left/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run until green**

Run: `npx vitest run frontend/test/ExtractionFullScreen.readonly.test.tsx`
Expected: PASS. If the screen renders a loading gate forever, check the session mock resolves and `useFinalizedExtractionRun`'s endpoint is mocked; every missing mock announces itself via the apiClient mock's URL switch falling through.

- [ ] **Step 4: Commit**

```bash
git add frontend/test/ExtractionFullScreen.readonly.test.tsx
git commit -m "test(extraction): screen-level read-only proof for published runs"
```

---

### Task 9b: backend — protect published rows from CASCADE deletion (spec D5.1)

**Files:**
- Modify: `backend/app/models/extraction_workflow.py` (~line 385: `instance_id` FK `ondelete="CASCADE"` → `"RESTRICT"`)
- Create: `backend/alembic/versions/0040_published_state_restrict.py`
- Test: `backend/tests/integration/test_extraction_runs_endpoints.py` (or the lifecycle service test file — wherever `_force_finalize`-style helpers land in Task 10; one pin test)

**Interfaces:**
- Produces: DB-level guarantee that `extraction_instances` rows referenced by any `extraction_published_states` row cannot be deleted (the PostgREST-direct delete path can no longer destroy the canonical published record — panel security finding: RLS DELETE has no stage predicate and the CASCADE silently removed published rows, violating the `advance_stage` ≥1-published invariant and constitution §IX).

Background (verified in panel review): `frontend/services/extractionInstanceService.ts` deletes instances via PostgREST (`deleteOne('extraction_instances', ...)`), bypassing every API stage guard; `baseline_v1.sql:2015` ships `extraction_published_states_instance_id_fkey ... ON DELETE CASCADE`. Deleting a never-published instance still works after this change; deleting a published one now fails at the DB.

- [ ] **Step 1: Write the failing test** (integration; uses the same force-finalize + publish helpers as Task 10 — order Task 10's helper first if executing sequentially, or inline the publish via the consensus path):

```python
@pytest.mark.asyncio
async def test_instance_delete_with_published_rows_is_blocked(db_session):
    """D5.1: an instance referenced by extraction_published_states cannot be
    deleted — the FK is RESTRICT so the PostgREST-direct delete path cannot
    destroy the canonical published record."""
    # Arrange: any run with one published row for SEED.primary_instance
    # (reuse the run+consensus publish flow from
    # test_run_lifecycle_service.py::test_pending_extract_consensus_finalized_path,
    # or insert an extraction_published_states row with raw SQL).
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text("DELETE FROM public.extraction_instances WHERE id = :iid"),
            {"iid": str(SEED.primary_instance)},
        )
    await db_session.rollback()
```

(Import `IntegrityError` from `sqlalchemy.exc` and `text` from `sqlalchemy` atomically with the test. Note: the SAVEPOINT-isolated `db_session` rolls back cleanly after the expected failure.)

- [ ] **Step 2: Run to verify it FAILS on current schema** (delete succeeds via CASCADE):

Run: `cd backend && uv run pytest tests/integration/ -x -k instance_delete_with_published`
Expected: FAIL — no IntegrityError raised (CASCADE deletes the published rows silently). This proves the hole.

- [ ] **Step 3: Flip the model FK**

`backend/app/models/extraction_workflow.py` (~line 385):

```python
    instance_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_instances.id", ondelete="RESTRICT"),
        nullable=False,
    )
```

- [ ] **Step 4: Write the migration** (revision id 29 chars ≤ 32; the baseline FK name is a POSTGRES-DEFAULT literal name, so use raw SQL with the literal name — `op.create_foreign_key` would route through the naming convention and mangle it, breaking downgrade; see `reference_alembic_constraint_naming_convention`):

`backend/alembic/versions/0040_published_state_restrict.py`:

```python
"""Protect published rows: instance FK CASCADE -> RESTRICT.

An extraction_instances DELETE arrives PostgREST-direct (no API stage
guard); with CASCADE it silently destroyed extraction_published_states
rows — the canonical published record — and could leave a FINALIZED run
with zero published rows (advance_stage invariant, constitution §IX).

Revision ID: 0040_published_state_restrict
Revises: 0039_absent_reason_backfill
"""

from alembic import op

revision = "0040_published_state_restrict"
down_revision = "0039_absent_reason_backfill"
branch_labels = None
depends_on = None

_FK = "extraction_published_states_instance_id_fkey"
_TABLE = "public.extraction_published_states"


def upgrade() -> None:
    op.execute(f'ALTER TABLE {_TABLE} DROP CONSTRAINT "{_FK}"')
    op.execute(
        f'ALTER TABLE {_TABLE} ADD CONSTRAINT "{_FK}" '
        'FOREIGN KEY ("instance_id") REFERENCES "public"."extraction_instances"("id") '
        "ON DELETE RESTRICT"
    )


def downgrade() -> None:
    op.execute(f'ALTER TABLE {_TABLE} DROP CONSTRAINT "{_FK}"')
    op.execute(
        f'ALTER TABLE {_TABLE} ADD CONSTRAINT "{_FK}" '
        'FOREIGN KEY ("instance_id") REFERENCES "public"."extraction_instances"("id") '
        "ON DELETE CASCADE"
    )
```

- [ ] **Step 5: Verify offline SQL both directions + apply locally**

Run: `cd backend && uv run alembic upgrade 0039_absent_reason_backfill:0040_published_state_restrict --sql && uv run alembic downgrade 0040_published_state_restrict:0039_absent_reason_backfill --sql`
Expected: both render the two ALTERs with the literal constraint name, no naming-convention mangling.
Then: `cd backend && uv run alembic upgrade head` (local Supabase up).

- [ ] **Step 6: Run the test to verify it passes + the roundtrip stays green**

Run: `cd backend && uv run pytest tests/integration/ -x -k "instance_delete_with_published or migration_roundtrip"`
Expected: PASS (the roundtrip's `downgrade -1 → upgrade head` now exercises 0040's downgrade/upgrade).

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/extraction_workflow.py backend/alembic/versions/0040_published_state_restrict.py backend/tests/integration/
git commit -m "fix(extraction): RESTRICT published-state instance FK — PostgREST delete can no longer destroy published records"
```

---

### Task 10: backend — finalized-run write rejection coverage (400s)

**Files:**
- Modify: `backend/tests/integration/test_extraction_runs_endpoints.py` (append tests; reuse the file's `auth_as_profile` fixture, `SEED`, and `_advance` helper)

**Interfaces:**
- Consumes: existing guards only — NO production code changes. `POST /api/v1/runs/{id}/proposals`, `/decisions`, `/consensus` must 400 on a finalized run.

- [ ] **Step 1: Write the failing-or-passing tests** (they should PASS immediately — this is coverage verification; if any FAILS, that is a real guard hole → STOP and report before "fixing" anything):

```python
async def _force_finalize(db_session, run_id) -> None:
    """Force stage=finalized via SQL (bypasses the publish invariant — guard
    tests only need the stage). expire_all() deterministically invalidates
    the identity-map instance loaded by earlier requests: db_client SHARES
    this session (conftest dependency override) and load_run_for_update's
    plain select().with_for_update() does NOT repopulate a cached instance,
    so without the expire the guards can read the stale 'extract' stage
    (GC-timing dependent — see test_run_lifecycle_service.py:419-424)."""
    await db_session.execute(
        text(
            "UPDATE public.extraction_runs "
            "SET stage = 'finalized', status = 'completed' WHERE id = :rid"
        ),
        {"rid": str(run_id)},
    )
    await db_session.flush()
    db_session.expire_all()


@pytest.mark.asyncio
async def test_proposal_on_finalized_run_returns_400(
    db_client, db_session, auth_as_profile
):
    run_id = await _create_run_via_api(db_client)  # file's existing helper (adapt its kwargs from neighboring tests)
    await _advance(db_client, run_id, "extract")
    await _force_finalize(db_session, run_id)
    resp = await db_client.post(
        f"/api/v1/runs/{run_id}/proposals",
        json={
            "instance_id": str(SEED.primary_instance),
            "field_id": str(SEED.primary_field),
            "source": "ai",
            "proposed_value": {"value": "late write"},
        },
    )
    assert resp.status_code == 400
    assert "stage" in resp.json()["error"]["message"].lower()


@pytest.mark.asyncio
async def test_decision_on_finalized_run_returns_400(
    db_client, db_session, auth_as_profile
):
    run_id = await _create_run_via_api(db_client)
    await _advance(db_client, run_id, "extract")
    await _force_finalize(db_session, run_id)
    resp = await db_client.post(
        f"/api/v1/runs/{run_id}/decisions",
        json={
            "instance_id": str(SEED.primary_instance),
            "field_id": str(SEED.primary_field),
            "decision": "edit",
            "value": {"value": "late edit"},
        },
    )
    assert resp.status_code == 400
    assert "stage" in resp.json()["error"]["message"].lower()


@pytest.mark.asyncio
async def test_consensus_on_finalized_run_returns_400(
    db_client, db_session, auth_as_profile
):
    run_id = await _create_run_via_api(db_client)
    await _advance(db_client, run_id, "extract")
    await _force_finalize(db_session, run_id)
    resp = await db_client.post(
        f"/api/v1/runs/{run_id}/consensus",
        json={
            "instance_id": str(SEED.primary_instance),
            "field_id": str(SEED.primary_field),
            "mode": "manual_override",
            "value": {"value": "late consensus"},
            "rationale": "should be rejected",
        },
    )
    assert resp.status_code == 400
```

Adapt helper names/payload shapes to the file's existing `_create_run`/`_advance` helpers and request schemas (read the neighboring tests in that file first; e.g. the consensus body must match `record_consensus`'s endpoint schema — copy from `test_full_lifecycle_create_to_finalized`). Land imports (`text` from sqlalchemy) atomically with the code that uses them — the PostToolUse ruff hook strips unused imports from partial edits.

- [ ] **Step 2: Run**

Run: `cd backend && uv run pytest tests/integration/test_extraction_runs_endpoints.py -x -k finalized`
Expected: 3 PASS (guards already exist — this pins them). Any FAIL = real backend hole: HALT, report, do not patch silently.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/integration/test_extraction_runs_endpoints.py
git commit -m "test(backend): pin 400-on-finalized for proposals/decisions/consensus writes"
```

---

### Task 11: full-suite verification

- [ ] **Step 1:** `npm run test:run` — expected: PASS (all frontend suites, including every pre-existing test — the editable default keeps unwrapped components green).
- [ ] **Step 2:** `npm run lint` — expected: clean.
- [ ] **Step 3:** `cd backend && uv run pytest` (local Supabase up; single instance) — expected: PASS.
- [ ] **Step 4:** No commit — this gate feeds Phase 4 (`make quality-scan`) of the ship pipeline.

---

## Self-review notes (spec coverage)

- Spec D1 → Task 1. D2 → Tasks 2, 6, 7, 8 (consumer audit realized as: FieldInput variants + disposition buttons, AI badge/strip/popover actions, section AI-extract, add/remove instance, add/remove model + model-extract, instance-label editing, nav-rail footer, header pending pill). D3 → Tasks 3, 4 (extraction), 5 (QA). D4 → Tasks 6, 7, 8. D5.1 → Task 9b (FK migration). D5.2 → Task 10 (tests only).
- Panel review 2026-07-02: 6 unique blocking findings fixed in this revision (rules-of-hooks bail placement, finalized replace-not-merge, lib→services inversion, CASCADE integrity hole → Task 9b, force-finalize expire_all, QA/FieldInput test assertions made non-vacuous) + YAGNI trims (no reason vocabulary, no phantom unit shape, no dead QA baseline branch).
- Edge cases: `pending`/null stage → read-only reason 'pending', no banner (banner keys off `finalized`); consensus → provider wraps ConsensusPanel defensively (no consumers inside, verified); reopen flips stage via session refetch → provider re-derives (no new wiring); no-provider default → editable (Task 2 + Task 6 tests).
- Deliberate scope notes: `AIAcceptRejectButtons.tsx` is confirmed dead code — flag in the PR, do not delete here. `SaveSlot` hiding already exists on both screens (no change). `batchAccept` has no rendering surface on either screen — nothing to hide; its abstention safeguard is untouched.
