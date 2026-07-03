---
status: in-progress
last_reviewed: 2026-07-03
owner: '@raphaelfh'
---

# Consensus-as-Compare-Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The consensus stage renders the side-by-side compare table with
inline resolution (adopt / typed override); the card-based `ConsensusPanel`
and its raw-JSON override die.

**Architecture:** `RunReviewerComparison` gains an optional `resolution` prop
(read-only without it — today's compare). A new pure `FieldValueEditor`
(extracted from `FieldInput`) powers a typed override editor. Pure derivation
(`deriveConsensusResolution`) feeds status buckets + finalize gate from lib.
Zero backend change. Spec:
`docs/superpowers/specs/2026-07-03-consensus-compare-view-design.md`.

**Tech Stack:** React 19 + TS strict, Tailwind/shadcn, TanStack Query,
vitest + Testing Library. React Compiler on (`panicThreshold: all_errors`).

## Global Constraints

- English only — code, comments, copy keys.
- All user-facing text through `frontend/lib/copy/` (`t('consensus', …)` /
  `t('extraction', …)`); icon/short-label buttons get shadcn `Tooltip`
  (`TooltipTrigger asChild`) + `aria-label`.
- React Compiler: no `try/finally` or `throw` inside `try` in component/hook
  bodies; promise-chain form for IO.
- Frontend tooling from the **repo root** (`npm run test:run`, `npm run lint`,
  `npx tsc -p tsconfig.app.json --noEmit`). Never `cd frontend`.
- Preserve test ids used by existing tests: `consensus-accept-{decisionId}`,
  `consensus-override-toggle-{coordKey}`, `consensus-override-submit-{coordKey}`,
  `consensus-resolved-{coordKey}`, `consensus-coord-{coordKey}`,
  `consensus-finalize-button`.
- Coordinate-key contract: peer decisions keyed `${instanceId}::${fieldId}`;
  own/form values keyed `${instanceId}_${fieldId}`.
- **Value-envelope contract** (verified in code 2026-07-03): a reviewer
  decision's `value` column is `{value: X}` or `{value: null, absent_reason:
  code}` (flat marker), where `X` is a scalar, `{value, unit}` (number with
  units), an "other" object, or an array
  (`frontend/services/extractionRunService.ts:169-172`,
  `frontend/hooks/runs/useAutoSaveProposals.ts:203-218`). A `manual_override`
  publish must be shape-identical; markers must NOT be double-wrapped.
- PR slicing: Tasks 1–2 = **PR 1** (pure refactor). Tasks 3–11 = **PR 2**
  (feature). Conventional commits throughout.

---

### Task 1: `FieldValueEditor` — extract the type-dispatch input core

**Files:**
- Create: `frontend/components/extraction/FieldValueEditor.tsx`
- Test: `frontend/components/extraction/FieldValueEditor.test.tsx`

**Interfaces:**
- Consumes: `@/components/ui/*` primitives, `getRelatedUnits`
  (`@/lib/unitConversions`), `extractValue`/`extractUnit`
  (`@/lib/ai-extraction/valueParser`), `t` (`@/lib/copy`),
  `SelectWithOther`/`MultiSelectWithOther` (`@/components/ui/*`).
- Produces (used by Tasks 2 and 6):

```ts
export interface FieldValueEditorField {
  id: string;
  label: string;
  field_type: string;
  allowed_values?: unknown;
  unit?: string | null;
  allowed_units?: string[] | null;
  allow_other?: boolean;
  other_label?: string | null;
  other_placeholder?: string | null;
}
export interface FieldValueEditorProps {
  field: FieldValueEditorField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  /** Extra classes on every input variant (validation emphasis). */
  inputClassName?: string;
  /** Extra classes on the text/textarea variant only (AI-pending parity). */
  textAccentClassName?: string;
}
export function FieldValueEditor(props: FieldValueEditorProps): JSX.Element;
```

Emission contract per `field_type` (identical to today's `FieldInput`):
`text` → string · `number` → string, or `{value, unit}` when units exist ·
`date` → `'YYYY-MM-DD'` string · `select` → string (or other-object via
`SelectWithOther`) · `multiselect` → `string[]` (or other-object via
`MultiSelectWithOther`) · `boolean` → boolean · unknown type → string.

- [ ] **Step 1: Write the failing test**

`frontend/components/extraction/FieldValueEditor.test.tsx` — mirror the
render/interaction patterns already used in
`frontend/components/extraction/FieldInput.test.tsx` (same jsdom + Radix
helpers; copy its select-interaction helper if one exists there):

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FieldValueEditor, type FieldValueEditorField } from './FieldValueEditor';

const base = (over: Partial<FieldValueEditorField>): FieldValueEditorField => ({
  id: 'f1', label: 'Outcome', field_type: 'text', ...over,
});

describe('FieldValueEditor', () => {
  it('text: emits the raw string', () => {
    const onChange = vi.fn();
    render(<FieldValueEditor field={base({})} value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Low' } });
    expect(onChange).toHaveBeenCalledWith('Low');
  });

  it('text: long-form label renders a textarea', () => {
    render(
      <FieldValueEditor field={base({ label: 'Description of methods' })} value="" onChange={() => {}} />,
    );
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
  });

  it('number without units: emits the raw string', () => {
    const onChange = vi.fn();
    render(
      <FieldValueEditor field={base({ field_type: 'number' })} value="" onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith('5');
  });

  it('number with allowed_units: emits {value, unit} with the default unit', () => {
    const onChange = vi.fn();
    render(
      <FieldValueEditor
        field={base({ field_type: 'number', allowed_units: ['mg', 'g'] })}
        value=""
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith({ value: '5', unit: 'mg' });
  });

  it('date: emits the ISO date string', () => {
    const onChange = vi.fn();
    const { container } = render(
      <FieldValueEditor field={base({ field_type: 'date' })} value="" onChange={onChange} />,
    );
    const input = container.querySelector('input[type="date"]')!;
    fireEvent.change(input, { target: { value: '2026-01-02' } });
    expect(onChange).toHaveBeenCalledWith('2026-01-02');
  });

  it('boolean: toggling the switch emits true', () => {
    const onChange = vi.fn();
    render(
      <FieldValueEditor field={base({ field_type: 'boolean' })} value={false} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('multiselect fallback (no allow_other): comma input emits string[]', () => {
    const onChange = vi.fn();
    render(
      <FieldValueEditor field={base({ field_type: 'multiselect' })} value={[]} onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a, b' } });
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  });

  it('select: renders every allowed value as an option', () => {
    render(
      <FieldValueEditor
        field={base({ field_type: 'select', allowed_values: ['Low', 'High'] })}
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('disabled: the input is disabled', () => {
    render(
      <FieldValueEditor field={base({})} value="" onChange={() => {}} disabled />,
    );
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- frontend/components/extraction/FieldValueEditor.test.tsx`
Expected: FAIL — module `./FieldValueEditor` not found.

- [ ] **Step 3: Implement — move the `renderInput()` switch verbatim**

Create `frontend/components/extraction/FieldValueEditor.tsx`. The body of
each `case` is **copied from `FieldInput.tsx` lines 203–424** with these
mechanical substitutions (no behavior edits):

- `displayValue` → `value` (prop) · `handleChange` → `onChange` (prop) ·
  `inputDisabled` → `disabled` (prop).
- `cn(inputHeight, "text-sm", validationError && "border-destructive")` →
  `cn('h-8', 'text-sm', inputClassName)`.
- Text/textarea case additionally appends `textAccentClassName`.
- `field.allowed_values as any[]` casts stay (the prop is `unknown`).

```tsx
/**
 * Pure type-dispatched value editor — the input core of FieldInput, extracted
 * so non-form surfaces (consensus override) can edit a typed value without
 * the AI chrome or the RunEditabilityContext coupling (which is read-only
 * during consensus and would disable a reused FieldInput).
 *
 * Emits exactly what the extraction form emits per field type, so any
 * consumer's payload is shape-identical to a reviewer's decision value.
 */
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SelectWithOther } from '@/components/ui/SelectWithOther';
import { MultiSelectWithOther } from '@/components/ui/MultiSelectWithOther';
import { Switch } from '@/components/ui/switch';
import { getRelatedUnits } from '@/lib/unitConversions';
import { extractUnit, extractValue } from '@/lib/ai-extraction/valueParser';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

export interface FieldValueEditorField { /* as in Interfaces above */ }
export interface FieldValueEditorProps { /* as in Interfaces above */ }

export function FieldValueEditor({
  field, value, onChange, disabled, inputClassName, textAccentClassName,
}: FieldValueEditorProps) {
  switch (field.field_type) {
    /* text / number / date / select / multiselect / boolean / default —
       the six cases from FieldInput.renderInput(), substituted as above.
       (Full bodies land in the commit; they are copies, not new logic.) */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- frontend/components/extraction/FieldValueEditor.test.tsx`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/extraction/FieldValueEditor.tsx frontend/components/extraction/FieldValueEditor.test.tsx
git commit -m "feat(extraction): extract FieldValueEditor from FieldInput's input core"
```

---

### Task 2: `FieldInput` delegates its input rendering (PR 1 gate)

**Files:**
- Modify: `frontend/components/extraction/FieldInput.tsx:202-424` (replace
  `renderInput` switch with delegation)
- Test: existing `frontend/components/extraction/FieldInput{,.memo,.readonly,.review}.test.tsx`

**Interfaces:**
- Consumes: `FieldValueEditor` (Task 1).
- Produces: unchanged `FieldInput` public contract (props, memo comparator,
  default export).

- [ ] **Step 1: Replace the switch with delegation**

In `FieldInput.tsx`, delete the `renderInput` switch body (lines 203–424) and
replace with:

```tsx
import { FieldValueEditor } from './FieldValueEditor';
// …
const renderInput = () => (
  <FieldValueEditor
    field={field}
    value={displayValue}
    onChange={handleChange}
    disabled={inputDisabled}
    inputClassName={cn(validationError && 'border-destructive')}
    textAccentClassName={cn(hasAIPending && 'border-ai/60 bg-ai/5')}
  />
);
```

Remove the imports that only the moved switch used (`SelectWithOther`,
`MultiSelectWithOther`, `Switch`, `getRelatedUnits`, `extractUnit`,
`extractValue`, `Select*` primitives, `Badge`) — keep any still used
elsewhere in the file. One deliberate parity note: the `default:` case now
receives `displayValue` (was raw `value`); `field_type` is a closed enum in
practice, and `displayValue` degrades more gracefully for markers.

- [ ] **Step 2: Run the full FieldInput regression net**

Run: `npm run test:run -- frontend/components/extraction/FieldInput.test.tsx frontend/components/extraction/FieldInput.memo.test.tsx frontend/components/extraction/FieldInput.readonly.test.tsx frontend/components/extraction/FieldInput.review.test.tsx frontend/components/extraction/FieldValueEditor.test.tsx`
Expected: PASS — all five files, zero skips.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run lint`
Expected: exit 0 (no new errors; unused-import errors mean Step 1 cleanup missed one).

- [ ] **Step 4: Commit (PR 1 boundary)**

```bash
git add frontend/components/extraction/FieldInput.tsx
git commit -m "refactor(extraction): FieldInput delegates input rendering to FieldValueEditor"
```

PR 1 = spec + plan docs + Tasks 1–2. Open against `dev` per ship-spec Phase 5.

---

### Task 3: `toConsensusValueEnvelope` — the override payload rule

**Files:**
- Modify: `frontend/lib/extraction/valueSemantics.ts` (append function)
- Test: `frontend/lib/extraction/valueSemantics.test.ts` (append cases)

**Interfaces:**
- Consumes: `valueAbsentReason` (same module).
- Produces (used by Tasks 8–9):

```ts
export function toConsensusValueEnvelope(editorOutput: unknown): Record<string, unknown>;
```

- [ ] **Step 1: Write the failing tests** (append to `valueSemantics.test.ts`)

```ts
import { toConsensusValueEnvelope } from './valueSemantics';

describe('toConsensusValueEnvelope', () => {
  it('wraps a scalar once: the select_existing shape for a text/select value', () => {
    expect(toConsensusValueEnvelope('Low')).toEqual({ value: 'Low' });
  });
  it('wraps a {value, unit} number once (canonical nested envelope)', () => {
    expect(toConsensusValueEnvelope({ value: '5', unit: 'mg' })).toEqual({
      value: { value: '5', unit: 'mg' },
    });
  });
  it('wraps an array once (multiselect)', () => {
    expect(toConsensusValueEnvelope(['a', 'b'])).toEqual({ value: ['a', 'b'] });
  });
  it('passes a disposition marker through FLAT — never double-wrapped', () => {
    expect(
      toConsensusValueEnvelope({ value: null, absent_reason: 'no_information' }),
    ).toEqual({ value: null, absent_reason: 'no_information' });
  });
  it('rejects an out-of-vocabulary reason by wrapping it as an ordinary object', () => {
    expect(toConsensusValueEnvelope({ value: null, absent_reason: 'nope' })).toEqual({
      value: { value: null, absent_reason: 'nope' },
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:run -- frontend/lib/extraction/valueSemantics.test.ts`
Expected: FAIL — `toConsensusValueEnvelope` is not exported.

- [ ] **Step 3: Implement** (append to `valueSemantics.ts`)

```ts
/**
 * Shape a consensus manual-override payload so it is indistinguishable from
 * what `select_existing` would publish for the same logical value: one
 * `{value}` envelope around the form-shaped value, EXCEPT a resolved
 * disposition marker, which is already the flat envelope
 * `{value: null, absent_reason}` and must not be double-wrapped
 * (mirrors `writeRunFieldValue`'s write contract).
 */
export function toConsensusValueEnvelope(editorOutput: unknown): Record<string, unknown> {
  const reason = valueAbsentReason(editorOutput);
  if (reason !== null) return { value: null, absent_reason: reason };
  return { value: editorOutput };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:run -- frontend/lib/extraction/valueSemantics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/extraction/valueSemantics.ts frontend/lib/extraction/valueSemantics.test.ts
git commit -m "feat(extraction): toConsensusValueEnvelope override payload rule"
```

---

### Task 4: `deriveConsensusResolution` — pure status + finalize derivation

**Files:**
- Modify: `frontend/lib/runs/reconciliation.ts` (append)
- Test: `frontend/lib/runs/reconciliation.test.ts` (create or append; check
  for an existing test file first and append if present)

**Interfaces:**
- Consumes: `classifyReconciliation` (same module).
- Produces (used by Tasks 7–9):

```ts
export type CoordStatus =
  | 'conflict' | 'required_gap' | 'single_filler' | 'agreed' | 'resolved';

/** Structural — satisfied by ConsensusDecisionResponse without importing hook types into lib. */
export interface ResolvedConsensusLike {
  instance_id: string;
  field_id: string;
  created_at: string;
  mode: string;
  selected_decision_id?: string | null;
  value: unknown;
  rationale?: string | null;
}

export interface ConsensusResolutionView<C extends ResolvedConsensusLike> {
  resolvedByCoord: Map<string, C>;
  buckets: ReconciliationBuckets;
  statusByCoord: Map<string, CoordStatus>;
  needsAttentionCount: number;
  resolvedCount: number;
  canFinalize: boolean;
}

export function deriveConsensusResolution<C extends ResolvedConsensusLike>(p: {
  consensusDecisions: readonly C[];
  publishedCoords: ReadonlySet<string>;
  divergentCoords: ReadonlySet<string>;
  decisionCountByCoord: ReadonlyMap<string, number>;
  participantCount: number;
  requiredCoords: readonly string[];
  isComplete: boolean;
}): ConsensusResolutionView<C>;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { deriveConsensusResolution } from './reconciliation';

const dec = (coord: string, created_at: string, mode = 'select_existing') => {
  const [instance_id, field_id] = coord.split('::');
  return { instance_id, field_id, created_at, mode, value: { value: 'x' } };
};

const baseParams = {
  consensusDecisions: [] as ReturnType<typeof dec>[],
  publishedCoords: new Set<string>(),
  divergentCoords: new Set<string>(),
  decisionCountByCoord: new Map<string, number>(),
  participantCount: 2,
  requiredCoords: [] as string[],
  isComplete: true,
};

describe('deriveConsensusResolution', () => {
  it('a resolved conflict reports status=resolved (resolution wins over bucket)', () => {
    const v = deriveConsensusResolution({
      ...baseParams,
      divergentCoords: new Set(['i1::f1']),
      decisionCountByCoord: new Map([['i1::f1', 2]]),
      consensusDecisions: [dec('i1::f1', '2026-01-01T00:00:00Z')],
    });
    expect(v.statusByCoord.get('i1::f1')).toBe('resolved');
    expect(v.resolvedCount).toBe(1);
    expect(v.needsAttentionCount).toBe(0);
  });

  it('newest consensus decision wins per coord', () => {
    const v = deriveConsensusResolution({
      ...baseParams,
      divergentCoords: new Set(['i1::f1']),
      decisionCountByCoord: new Map([['i1::f1', 2]]),
      consensusDecisions: [
        dec('i1::f1', '2026-01-01T00:00:00Z', 'select_existing'),
        dec('i1::f1', '2026-01-02T00:00:00Z', 'manual_override'),
      ],
    });
    expect(v.resolvedByCoord.get('i1::f1')!.mode).toBe('manual_override');
  });

  it('unresolved conflict + required gap + single filler count as needs-attention', () => {
    const v = deriveConsensusResolution({
      ...baseParams,
      divergentCoords: new Set(['i1::f1']),
      decisionCountByCoord: new Map([['i1::f1', 2], ['i1::f3', 1]]),
      requiredCoords: ['i1::f2'],
    });
    expect(v.statusByCoord.get('i1::f1')).toBe('conflict');
    expect(v.statusByCoord.get('i1::f2')).toBe('required_gap');
    expect(v.statusByCoord.get('i1::f3')).toBe('single_filler');
    expect(v.needsAttentionCount).toBe(3);
    expect(v.canFinalize).toBe(false);
  });

  it('canFinalize: conflicts resolved + no required gap + complete + >=1 decision', () => {
    const v = deriveConsensusResolution({
      ...baseParams,
      divergentCoords: new Set(['i1::f1']),
      decisionCountByCoord: new Map([['i1::f1', 2]]),
      consensusDecisions: [dec('i1::f1', '2026-01-01T00:00:00Z')],
    });
    expect(v.canFinalize).toBe(true);
  });

  it('canFinalize false when isComplete=false or no consensus decision exists', () => {
    expect(deriveConsensusResolution({ ...baseParams }).canFinalize).toBe(false);
    expect(
      deriveConsensusResolution({
        ...baseParams,
        isComplete: false,
        consensusDecisions: [dec('i1::f9', '2026-01-01T00:00:00Z')],
        decisionCountByCoord: new Map([['i1::f9', 2]]),
      }).canFinalize,
    ).toBe(false);
  });

  it('full agreement is status=agreed and not needs-attention', () => {
    const v = deriveConsensusResolution({
      ...baseParams,
      decisionCountByCoord: new Map([['i1::f1', 2]]),
    });
    expect(v.statusByCoord.get('i1::f1')).toBe('agreed');
    expect(v.needsAttentionCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:run -- frontend/lib/runs/reconciliation.test.ts`
Expected: FAIL — `deriveConsensusResolution` not exported.

- [ ] **Step 3: Implement** (append to `reconciliation.ts`; logic is a pure
  move of `ConsensusPanel.tsx:453-519`)

```ts
export function deriveConsensusResolution<C extends ResolvedConsensusLike>(p: {
  consensusDecisions: readonly C[];
  publishedCoords: ReadonlySet<string>;
  divergentCoords: ReadonlySet<string>;
  decisionCountByCoord: ReadonlyMap<string, number>;
  participantCount: number;
  requiredCoords: readonly string[];
  isComplete: boolean;
}): ConsensusResolutionView<C> {
  // Newest consensus decision wins per coord (append-only aggregate).
  const resolvedByCoord = new Map<string, C>();
  for (const c of p.consensusDecisions) {
    const key = `${c.instance_id}::${c.field_id}`;
    const prev = resolvedByCoord.get(key);
    if (!prev || prev.created_at < c.created_at) resolvedByCoord.set(key, c);
  }

  const buckets = classifyReconciliation({
    divergentCoords: p.divergentCoords,
    decisionCountByCoord: p.decisionCountByCoord,
    participantCount: p.participantCount,
    requiredCoords: p.requiredCoords,
    publishedCoords: p.publishedCoords,
  });

  const statusByCoord = new Map<string, CoordStatus>();
  for (const c of buckets.agreements) statusByCoord.set(c, 'agreed');
  for (const c of buckets.singleFiller) statusByCoord.set(c, 'single_filler');
  for (const c of buckets.requiredGaps) statusByCoord.set(c, 'required_gap');
  for (const c of buckets.conflicts) statusByCoord.set(c, 'conflict');
  for (const c of resolvedByCoord.keys()) statusByCoord.set(c, 'resolved');

  let needsAttentionCount = 0;
  for (const s of statusByCoord.values()) {
    if (s === 'conflict' || s === 'required_gap' || s === 'single_filler') {
      needsAttentionCount += 1;
    }
  }

  const conflictsResolved = buckets.conflicts.every((c) => resolvedByCoord.has(c));
  const canFinalize =
    conflictsResolved &&
    buckets.requiredGaps.length === 0 &&
    p.isComplete &&
    p.consensusDecisions.length > 0;

  return {
    resolvedByCoord,
    buckets,
    statusByCoord,
    needsAttentionCount,
    resolvedCount: resolvedByCoord.size,
    canFinalize,
  };
}
```

(Plus the `CoordStatus` / `ResolvedConsensusLike` / `ConsensusResolutionView`
declarations from the Interfaces block, verbatim.)

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:run -- frontend/lib/runs/reconciliation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/runs/reconciliation.ts frontend/lib/runs/reconciliation.test.ts
git commit -m "feat(runs): deriveConsensusResolution pure status + finalize derivation"
```

---

### Task 5: Copy keys for the resolve-mode table

**Files:**
- Modify: `frontend/lib/copy/consensus.ts`

**Interfaces:**
- Produces keys consumed by Tasks 6–7 (exact names below).

- [ ] **Step 1: Edit keys**

Inside the `--- Runtime divergence-resolution panel ---` block, ADD:

```ts
    // Resolve-mode comparison table (spec 2026-07-03)
    filterAttention: 'Needs attention',
    filterAll: 'All',
    filterResolved: 'Resolved',
    statusConflict: 'Conflict',
    statusAgreed: 'Agreed',
    overrideAction: 'Override',
    overrideValueLabel: 'Custom value',
    consensusColumnLabel: 'Consensus',
    adoptValueAria: 'Publish this reviewer’s value as consensus',
    overrideNoInfoRecorded: '“No information” will be published as the consensus value.',
```

REPLACE the two raw-JSON keys (`panelCustomValueLabel`,
`panelCustomValuePlaceholder`) — delete them in Task 10 once no consumer
remains (ConsensusPanel still reads them until then).

- [ ] **Step 2: Verify copy vocabulary test still passes**

Run: `npm run test:run -- frontend/lib/copy frontend/test/copy-run-vocabulary.test.ts`
Expected: PASS (additive change).

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/copy/consensus.ts
git commit -m "feat(copy): resolve-mode consensus table keys"
```

---

### Task 6: `ConsensusOverrideEditor` — typed override row content

**Files:**
- Create: `frontend/components/runs/ConsensusOverrideEditor.tsx`
- Test: `frontend/components/runs/ConsensusOverrideEditor.test.tsx`

**Interfaces:**
- Consumes: `FieldValueEditor` + `FieldValueEditorField` (Task 1),
  `isValueFilled`/`valueAbsentReason` (`@/lib/extraction/valueSemantics`),
  copy keys (Task 5), shadcn `Button`/`Label`/`Textarea`/`Tooltip`.
- Produces (used by Task 7):

```ts
export interface ConsensusOverrideEditorProps {
  coordKey: string;
  field: FieldValueEditorField;
  disabled: boolean;
  /** Seed for "Change" on a resolved manual_override (form-shaped, already unwrapped). */
  initialValue?: unknown;
  initialRationale?: string;
  onCancel: () => void;
  /** value = form-shaped editor output OR the flat marker envelope. */
  onPublish: (value: unknown, rationale: string) => Promise<void> | void;
}
export function ConsensusOverrideEditor(props: ConsensusOverrideEditorProps): JSX.Element;
```

Behavior: renders `FieldValueEditor` for `field`, a "No information"
disposition toggle (emits `{ value: null, absent_reason: 'no_information' }`,
same shape as `FieldInput.setDisposition`; toggling off clears to `''`), an
optional-rationale `Textarea`, Cancel + Publish. Publish is disabled while
`disabled` or when `!isValueFilled(currentValue)` (a marker counts as
filled). Keeps test ids `consensus-override-{coordKey}` (container) and
`consensus-override-submit-{coordKey}` (publish button).

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConsensusOverrideEditor } from './ConsensusOverrideEditor';

const field = { id: 'f1', label: 'Outcome', field_type: 'text' };

describe('ConsensusOverrideEditor', () => {
  it('publish disabled on empty value, enabled after typing, emits value + rationale', async () => {
    const onPublish = vi.fn();
    render(
      <ConsensusOverrideEditor
        coordKey="i1::f1" field={field} disabled={false}
        onCancel={() => {}} onPublish={onPublish}
      />,
    );
    const submit = screen.getByTestId('consensus-override-submit-i1::f1');
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Low' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onPublish).toHaveBeenCalledWith('Low', '');
  });

  it('rationale is optional and passed through when provided', () => {
    const onPublish = vi.fn();
    render(
      <ConsensusOverrideEditor
        coordKey="i1::f1" field={field} disabled={false}
        onCancel={() => {}} onPublish={onPublish}
      />,
    );
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Low' } });
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'tie-break' } });
    fireEvent.click(screen.getByTestId('consensus-override-submit-i1::f1'));
    expect(onPublish).toHaveBeenCalledWith('Low', 'tie-break');
  });

  it('"No information" toggle publishes the flat marker', () => {
    const onPublish = vi.fn();
    render(
      <ConsensusOverrideEditor
        coordKey="i1::f1" field={field} disabled={false}
        onCancel={() => {}} onPublish={onPublish}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /no information/i }));
    const submit = screen.getByTestId('consensus-override-submit-i1::f1');
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onPublish).toHaveBeenCalledWith(
      { value: null, absent_reason: 'no_information' }, '',
    );
  });

  it('seeds initialValue + initialRationale (Change on a resolved override)', () => {
    render(
      <ConsensusOverrideEditor
        coordKey="i1::f1" field={field} disabled={false}
        initialValue="High" initialRationale="prior"
        onCancel={() => {}} onPublish={() => {}}
      />,
    );
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('High');
    expect(screen.getAllByRole('textbox')[1]).toHaveValue('prior');
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

Run: `npm run test:run -- frontend/components/runs/ConsensusOverrideEditor.test.tsx`

- [ ] **Step 3: Implement**

```tsx
/**
 * Typed consensus override editor — replaces the raw-JSON override box.
 * Emits the FORM-SHAPED value (or the flat "no information" marker); the
 * caller applies toConsensusValueEnvelope before POSTing.
 */
import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldValueEditor, type FieldValueEditorField } from '@/components/extraction/FieldValueEditor';
import { isValueFilled, valueAbsentReason } from '@/lib/extraction/valueSemantics';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

export function ConsensusOverrideEditor({
  coordKey, field, disabled, initialValue, initialRationale, onCancel, onPublish,
}: ConsensusOverrideEditorProps) {
  const [value, setValue] = useState<unknown>(initialValue ?? '');
  const [rationale, setRationale] = useState(initialRationale ?? '');
  const markerActive = valueAbsentReason(value) !== null;

  return (
    <div className="space-y-2 rounded border border-dashed p-3" data-testid={`consensus-override-${coordKey}`}>
      <Label className="text-xs">{t('consensus', 'overrideValueLabel')}</Label>
      <FieldValueEditor
        field={field}
        value={markerActive ? '' : value}
        onChange={setValue}
        disabled={disabled || markerActive}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button" size="sm" variant="ghost" aria-pressed={markerActive}
          disabled={disabled}
          onClick={() =>
            setValue(markerActive ? '' : { value: null, absent_reason: 'no_information' })
          }
          className={cn(
            'h-6 gap-1 px-2 text-xs',
            markerActive
              ? 'text-success ring-1 ring-inset ring-success bg-success/10 hover:bg-success/15 hover:text-success'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {markerActive ? <Check className="h-3 w-3" /> : null}
          {t('extraction', 'dispositionNoInformation')}
        </Button>
        {markerActive ? (
          <span className="text-[11px] text-muted-foreground">
            {t('consensus', 'overrideNoInfoRecorded')}
          </span>
        ) : null}
      </div>
      <Label htmlFor={`override-rationale-${coordKey}`} className="text-xs">
        {t('consensus', 'panelRationaleLabel')}
      </Label>
      <Textarea
        id={`override-rationale-${coordKey}`}
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder={t('consensus', 'panelRationalePlaceholder')}
        rows={2}
        disabled={disabled}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={disabled}>
          {t('consensus', 'cancel')}
        </Button>
        <Button
          size="sm"
          disabled={disabled || !isValueFilled(value)}
          onClick={() => void onPublish(value, rationale.trim())}
          data-testid={`consensus-override-submit-${coordKey}`}
        >
          {t('consensus', 'panelPublishOverride')}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**, then commit:

```bash
git add frontend/components/runs/ConsensusOverrideEditor.tsx frontend/components/runs/ConsensusOverrideEditor.test.tsx
git commit -m "feat(runs): typed ConsensusOverrideEditor (raw-JSON override dies)"
```

---

### Task 7: Resolve mode in `RunReviewerComparison`

**Files:**
- Modify: `frontend/components/runs/RunReviewerComparison.tsx`
- Test: `frontend/test/RunReviewerComparison.resolve.test.tsx` (create)

**Interfaces:**
- Consumes: `deriveConsensusResolution` output types (Task 4),
  `ConsensusOverrideEditor` (Task 6), copy keys (Task 5),
  `absentReasonLabel`/`unwrapValueEnvelope`, `ReviewerDecisionResponse`.
- Produces — extended props (pages use in Tasks 8–9):

```ts
export interface ComparisonField {
  id: string;
  label?: string | null;
  name?: string | null;
  // Editor-relevant template attributes (present when the caller has them;
  // absent ⇒ the override editor falls back to a text input).
  field_type?: string;
  allowed_values?: unknown;
  unit?: string | null;
  allowed_units?: string[] | null;
  allow_other?: boolean;
  other_label?: string | null;
  other_placeholder?: string | null;
}

export interface ComparisonResolution {
  statusByCoord: ReadonlyMap<string, CoordStatus>;
  resolvedByCoord: ReadonlyMap<string, ResolvedConsensusLike>;
  needsAttentionCount: number;
  resolvedCount: number;
  disabled: boolean;
  peersRevealed: boolean;
  onSelectExisting: (p: { instanceId: string; fieldId: string; decisionId: string }) => Promise<void> | void;
  /** value = form-shaped editor output or flat marker (caller envelopes it). */
  onManualOverride: (p: { instanceId: string; fieldId: string; value: unknown; rationale: string }) => Promise<void> | void;
}

export interface RunReviewerComparisonProps {
  /* existing props unchanged, plus: */
  resolution?: ComparisonResolution;
}
```

Behavioral contract (each is a test below):
1. Without `resolution`: rendering is unchanged (including the "You" column).
2. With `resolution`: no "You" column; a trailing "Consensus" column; filter
   chips `Needs attention (n)` / `All` / `Resolved (n)` above the table,
   default **attention**; a row renders under the active filter by its
   status (`attention` = conflict|required_gap|single_filler; `resolved` =
   resolved; `all` = everything, including untouched/agreed).
3. Unresolved actionable rows (or resolved rows in per-row "Change" editing
   state): each non-reject peer cell shows a "Use this value" button
   (`consensus-accept-{decisionId}`) → `onSelectExisting`; the Consensus
   cell shows an Override button (`consensus-override-toggle-{coordKey}`)
   that expands a full-width `ConsensusOverrideEditor` row; publishing calls
   `onManualOverride` and collapses.
4. Resolved rows show the published value (`displayValue` helper), origin
   ("from {reviewer}" only when `peersRevealed`, else "custom value"),
   rationale in a Tooltip, and a "Change" button; test id
   `consensus-resolved-{coordKey}`.
5. Rows carry `data-testid={`consensus-coord-${coordKey}`}` in resolve mode.
6. Attention filter with zero attention rows renders the
   `nothingToReconcile` hint.
7. All controls disable when `resolution.disabled`.

Implementation notes: extract the row into an internal `ComparisonRow`
component holding per-row `useState` (`editing`, `overrideOpen`) — same
pattern as the old `CoordRow`; the filter chip state is one `useState` in
the root. The old `ConsensusPanel.tsx:118-136` display helpers
(`displayDecisionValue`, `reviewerLabel`) move here.

- [ ] **Step 1: Write the failing tests** — `frontend/test/RunReviewerComparison.resolve.test.tsx`
  covering contracts 1–7. Reuse fixture-building patterns from
  `frontend/test/ConsensusPanel.test.tsx:1-105` (decision/consensus factories);
  assert:

```tsx
// Sketch of the assertions (full fixtures mirror ConsensusPanel.test.tsx):
it('read-only mode renders the You column and no chips', …);
it('resolve mode hides You, shows Consensus column and defaults to Needs attention', …);
it('adopt button calls onSelectExisting with the decision id', …);
it('override expands the typed editor and publishes value+rationale', …);
it('resolved row shows published value, provenance gated by peersRevealed, and Change', …);
it('filter chips switch row sets; empty attention shows nothingToReconcile', …);
it('disabled=true disables adopt/override/submit', …);
```

Every `it` body is written out in this step (no sketches in the actual file).

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:run -- frontend/test/RunReviewerComparison.resolve.test.tsx`
Expected: FAIL — `resolution` prop unknown / chips absent.

- [ ] **Step 3: Implement resolve mode** per the contract above. Structure:

```tsx
export function RunReviewerComparison({ …, resolution }: RunReviewerComparisonProps) {
  const [filter, setFilter] = useState<'attention' | 'all' | 'resolved'>('attention');
  // …existing reviewerIds / instancesByEntityType derivation unchanged…
  // In resolve mode, rows flatten to a list first so the filter can decide
  // membership per coordKey via resolution.statusByCoord before rendering.
}
```

Empty-peers guard: in resolve mode do NOT early-return on
`reviewerIds.length === 0` (required gaps must render for a solo run);
keep the early return only when `resolution` is absent.

- [ ] **Step 4: Run the new file + the existing comparison consumers**

Run: `npm run test:run -- frontend/test/RunReviewerComparison.resolve.test.tsx frontend/test/ConsensusPanel.test.tsx`
Expected: PASS (ConsensusPanel untouched so far).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/RunReviewerComparison.tsx frontend/test/RunReviewerComparison.resolve.test.tsx
git commit -m "feat(runs): resolve mode in RunReviewerComparison (filters, adopt, typed override)"
```

---

### Task 8: ExtractionFullScreen mounts the resolve-mode table

**Files:**
- Modify: `frontend/pages/ExtractionFullScreen.tsx:286-300` (override handler)
  and `:1129-1151` (consensus mount)

**Interfaces:**
- Consumes: `deriveConsensusResolution` (Task 4), `toConsensusValueEnvelope`
  (Task 3), extended `RunReviewerComparison` (Task 7).

- [ ] **Step 1: Change the override handler to envelope via the helper**

```tsx
import { toConsensusValueEnvelope } from '@/lib/extraction/valueSemantics';
// handleManualOverride body:
    await consensusMutation.mutateAsync({
      instance_id: params.instanceId,
      field_id: params.fieldId,
      mode: 'manual_override',
      value: toConsensusValueEnvelope(params.value),
      rationale: params.rationale,
    });
```

- [ ] **Step 2: Build the resolution view + swap the mount**

Above the `extractionFormPanelInner` definition:

```tsx
  const resolutionView = deriveConsensusResolution({
    consensusDecisions: runDetail?.consensus_decisions ?? [],
    publishedCoords: new Set(
      (runDetail?.published_states ?? []).map((p) => `${p.instance_id}::${p.field_id}`),
    ),
    divergentCoords: reviewerSummary.divergentCoords,
    decisionCountByCoord: new Map(
      [...reviewerSummary.decisionsByCoord].map(([k, v]) => [k, v.length]),
    ),
    participantCount: reviewerSummary.reviewers.length,
    requiredCoords,
    isComplete,
  });
```

Replace the `ConsensusPanel` branch of `extractionFormPanelInner` with:

```tsx
    inConsensusStage && runDetail ? (
      <div className="h-full min-h-0 overflow-y-auto p-4" data-testid="extraction-consensus-area">
        <RunReviewerComparison
          decisionsByCoord={reviewerSummary.decisionsByCoord}
          entityTypes={entityTypes}
          instances={instances}
          ownValues={values}
          reviewerLabelById={reviewerProfiles.labelById}
          reviewerAvatarById={reviewerProfiles.avatarById}
          resolution={
            permissions.canResolveConflicts
              ? {
                  statusByCoord: resolutionView.statusByCoord,
                  resolvedByCoord: resolutionView.resolvedByCoord,
                  needsAttentionCount: resolutionView.needsAttentionCount,
                  resolvedCount: resolutionView.resolvedCount,
                  disabled: consensusMutation.isPending,
                  peersRevealed: !!runDetail.peers_revealed,
                  onSelectExisting: handleSelectExisting,
                  onManualOverride: handleManualOverride,
                }
              : undefined
          }
        />
      </div>
    ) : ( /* ExtractionFormPanel branch unchanged */ )
```

Remove the now-unused `ConsensusPanel` import. `entityTypes` here is the
run-view snapshot (`RunViewEntityType[]`) whose fields already satisfy the
extended `ComparisonField` (field_type, allowed_values, unit, allowed_units,
allow_other, other_label, other_placeholder) — cast-free structural fit;
verify `allowed_units` typing (`unknown` → `string[] | null`) and add a
narrowing helper if tsc complains.

- [ ] **Step 3: Typecheck + full run-view tests**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run test:run -- frontend/test frontend/components/extraction`
Expected: PASS except `frontend/test/ConsensusPanel.test.tsx` (still green —
panel not deleted yet).

- [ ] **Step 4: Commit**

```bash
git add frontend/pages/ExtractionFullScreen.tsx
git commit -m "feat(extraction): consensus stage renders the resolve-mode compare table"
```

---

### Task 9: QualityAssessmentFullScreen mounts the resolve-mode table

**Files:**
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx:412-426` (override
  handler), `:514-533` (compare mapping gains editor attributes), `:727-743`
  (consensus mount + finalize bar)

**Interfaces:**
- Consumes: same as Task 8 + `buildQaTransition` finalize path unchanged.

- [ ] **Step 0: QA resolve gate — RESOLVED (backend-verified 2026-07-03)**

The consensus endpoint gate is kind-aware
(`backend/app/api/v1/endpoints/extraction_runs.py:363-366`): extraction →
`ensure_project_arbitrator`, **QA → `ensure_project_reviewer`** (reviewer-level
self-publish; viewers excluded). QA today renders `ConsensusPanel`
unconditionally (`showConsensusPanel = ready && inConsensusStage`), so its
controls are already offered to any reviewer with the backend as the real
enforcer. **Decision: pass `resolution` UNCONDITIONALLY for QA** (do not gate
on `canResolveConflicts` — that is arbitrator-scoped and would break the
QA reviewer self-publish flow). This is exact parity with today. Blinding is
safe: reviewer `decisions` are scrubbed per-caller server-side
(`extraction_run_read_service.py:150`) so a blind QA reviewer sees no peer
columns, and `consensus_decisions`/`published_states` are the canonical
post-resolution artifacts the old panel already displayed
(`:156-157`, unscrubbed by design).

- [ ] **Step 1: Override handler envelopes via the helper** (same edit as
  Task 8 Step 1, in `handleManualOverride` at `:412`).

- [ ] **Step 2: Compare mapping carries editor attributes**

```tsx
  const compareEntityTypes: ComparisonEntityType[] = sortedDomains.map(
    (domain) => ({
      id: domain.entityType.id,
      label: domain.entityType.label,
      fields: domain.fields.map((f) => ({
        id: f.id,
        label: f.label,
        field_type: f.field_type,
        allowed_values: f.allowed_values,
        unit: f.unit,
        allowed_units: f.allowed_units,
        allow_other: f.allow_other,
        other_label: f.other_label,
        other_placeholder: f.other_placeholder,
      })),
    }),
  );
```

(If `domain.fields`' type lacks any of these attributes, spread what exists —
the editor's text fallback covers the rest — and record the gap in the
commit message.)

- [ ] **Step 3: Swap the consensus mount + keep the QA finalize bar**

Replace the `ConsensusPanel` block at `:727-743` with:

```tsx
      {showConsensusPanel && runDetail ? (
        <div className="space-y-3" data-testid="qa-consensus-area">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">
              {t('consensus', 'panelResolveTitle')}
            </h2>
            <Button
              size="sm"
              onClick={() => void handleFinalizeFromConsensus()}
              disabled={!qaResolutionView.canFinalize || advanceMutation.isPending}
              data-testid="consensus-finalize-button"
            >
              {advanceMutation.isPending
                ? t('consensus', 'panelFinalizing')
                : t('consensus', 'panelFinalize')}
            </Button>
          </div>
          <RunReviewerComparison
            decisionsByCoord={reviewerSummary.decisionsByCoord}
            entityTypes={compareEntityTypes}
            instances={compareInstances}
            ownValues={values}
            reviewerLabelById={reviewerProfiles.labelById}
            reviewerAvatarById={reviewerProfiles.avatarById}
            resolution={{
              statusByCoord: qaResolutionView.statusByCoord,
              resolvedByCoord: qaResolutionView.resolvedByCoord,
              needsAttentionCount: qaResolutionView.needsAttentionCount,
              resolvedCount: qaResolutionView.resolvedCount,
              disabled: consensusMutation.isPending,
              peersRevealed: !!runDetail.peers_revealed,
              onSelectExisting: handleSelectExisting,
              onManualOverride: handleManualOverride,
            }}
          />
        </div>
      ) : null}
```

with `qaResolutionView` built like Task 8 Step 2 but with
`requiredCoords: []` and `isComplete: qaIsComplete` (QA has no
required-field gate — see `:698-706`).

- [ ] **Step 4: Typecheck + targeted tests**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run test:run -- frontend/test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/QualityAssessmentFullScreen.tsx
git commit -m "feat(qa): consensus stage renders the resolve-mode compare table"
```

---

### Task 10: Delete `ConsensusPanel` + migrate its tests + prune dead copy

**Files:**
- Delete: `frontend/components/runs/ConsensusPanel.tsx`
- Delete: `frontend/test/ConsensusPanel.test.tsx`
- Modify: `frontend/lib/copy/consensus.ts` (remove keys with no remaining
  consumer)
- Test: `frontend/test/RunReviewerComparison.resolve.test.tsx` (extend)

- [ ] **Step 1: Port surviving behaviors before deleting**

Walk `frontend/test/ConsensusPanel.test.tsx`'s `it` blocks; every behavior
that still exists on the new surface must have an equivalent assertion in
`RunReviewerComparison.resolve.test.tsx` (most were written in Task 7 —
verify the marker-vs-value legibility case from `:204-283` and the
`peersRevealed` provenance cases from `:540-596` are covered; add any gaps
now, with real fixtures).

- [ ] **Step 2: Delete the component + its test file**

```bash
git rm frontend/components/runs/ConsensusPanel.tsx frontend/test/ConsensusPanel.test.tsx
```

- [ ] **Step 3: Prune dead copy keys**

Grep each of `panelCustomValueLabel`, `panelCustomValuePlaceholder`,
`panelOverrideWithCustom`, `sectionConflictsTitle`, `sectionConflictsDesc`,
`sectionAttentionTitle`, `sectionAttentionDesc`, `sectionAgreedHintOne`,
`sectionAgreedHintOther`, `panelReviewerDisagreedOne`,
`panelReviewersDisagreedOther`:

```bash
grep -rn "panelCustomValueLabel\|panelCustomValuePlaceholder\|…" frontend --include="*.ts*" | grep -v lib/copy
```

Remove from `frontend/lib/copy/consensus.ts` every key with zero remaining
consumers. Keys still consumed by the new surface (`panelResolveTitle`,
`panelUseThisValue`, `panelRationaleLabel`, `panelRationalePlaceholder`,
`panelPublishOverride`, `panelResolved`, `panelRejected`, `badgeRequiredGap`,
`badgeSingleFiller`, `nothingToReconcile`, `panelFinalize`,
`panelFinalizing`, `resolvedValueLabel`, `resolvedFromReviewer`,
`resolvedCustom`, `resolvedRationaleLabel`, `change`,
`panelReviewerFallback`, finalize-warn keys) stay.

- [ ] **Step 4: Full frontend gate**

Run: `npm run test:run && npm run lint && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS / exit 0 — no dangling imports of ConsensusPanel anywhere
(`grep -rn "ConsensusPanel" frontend` returns nothing).

- [ ] **Step 5: Commit**

```bash
git add -A frontend/lib/copy/consensus.ts
git commit -m "refactor(runs): delete card-based ConsensusPanel (superseded by resolve-mode table)"
```

---

### Task 11: Whole-diff verification (PR 2 gate)

- [ ] **Step 1: Full quality gate, read the output**

Run: `make quality-scan`
Expected: every stage green (lint, typecheck, vitest, architectural fitness —
file-size ratchet may flag `RunReviewerComparison.tsx` growth; if it does,
split `ComparisonRow` into its own file rather than updating the baseline).

- [ ] **Step 2: Visual verification**

Run the `/design-review` loop on the consensus route (dev stack via
`make start`, run in consensus stage with 2 reviewers seeded) — compare
against the Plane/Linear density target; fix and re-screenshot until clean.

- [ ] **Step 3: Commit any review fixes; PR 2 boundary**

PR 2 = Tasks 3–11 → `dev`, opened after PR 1 merges (rebase
`--onto origin/dev` to drop PR 1's squashed commits).
