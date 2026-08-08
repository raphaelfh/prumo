/**
 * B-6 T5: single-slot Undo on structural moves (panel decision 1).
 *
 * NEW file by design (decision 10) — the panel test file sits at its
 * file-size ratchet ceiling. Two layers:
 *
 * 1. Hook contract (renderHook harness): the toast arms only AFTER
 *    `settled` resolves true, under ONE fixed toast id (same-id push
 *    REPLACES the live toast — the single-slot dismiss); the Undo click
 *    re-dispatches through the RAW dispatcher with the gesture-time
 *    `from` slot and the field re-resolved BY ID from the LATEST tree;
 *    an undo arms no second Undo toast; a field deleted meanwhile
 *    downgrades the click to a gentle info toast.
 * 2. Panel wiring: BOTH chokepoints (⌘⇧ chord and the inspector Section
 *    combobox) dispatch through the wrapper, and a full undo round-trip
 *    re-enters the real serialized dispatcher (inverse renumber write +
 *    the SAME live region announcing — no double-announce).
 *
 * Copy is deliberately NOT mocked — the tests pin the real strings.
 */
import {act, fireEvent, render, renderHook, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {error: vi.fn(), success: vi.fn(), info: vi.fn()}),
}));
vi.mock('@/hooks/extraction/useTemplateEntityTypes', () => ({
  useTemplateEntityTypes: vi.fn(),
}));
vi.mock('@/hooks/extraction/useUpdateTemplateField', () => ({
  useUpdateTemplateField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useInsertTemplateField', () => ({
  useInsertTemplateField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useMoveTemplateField', () => ({
  useMoveTemplateField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useReorderTemplateFields', () => ({
  useReorderTemplateFields: vi.fn(),
}));
vi.mock('@/hooks/extraction/useTemplateRepublish', () => ({
  useTemplateConfigCaches: vi.fn(),
}));
vi.mock('@/hooks/shared/useContainerNarrow', () => ({
  useContainerNarrow: vi.fn(() => false),
}));
vi.mock('@/services/extractionFieldService', () => ({
  validateFieldImpact: vi.fn(),
}));

import {toast} from 'sonner';

import {TooltipProvider} from '@/components/ui/tooltip';
import {useInsertTemplateField} from '@/hooks/extraction/useInsertTemplateField';
import {useMoveTemplateField} from '@/hooks/extraction/useMoveTemplateField';
import {useReorderTemplateFields} from '@/hooks/extraction/useReorderTemplateFields';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';

import {TemplateConfigGridPanel} from './TemplateConfigGridPanel';
import type {TemplateSectionActions} from './TemplateGrid';
import {buildTemplateTree, findField, type GridSection} from './templateTree';
import type {FieldMoveRecord} from './useMoveFieldTo';
import {STRUCTURAL_UNDO_TOAST_ID, useStructuralUndo} from './useStructuralUndo';

const field = (
  id: string,
  entityTypeId: string,
  name: string,
  label: string,
  sortOrder: number,
) => ({
  id,
  entity_type_id: entityTypeId,
  name,
  label,
  description: null,
  field_type: 'text',
  is_required: false,
  allowed_values: null,
  llm_description: null,
  sort_order: sortOrder,
});

const sections = [
  {id: 'sec1', name: 'basics', label: 'Basics', sort_order: 1},
  {id: 'sec2', name: 'outcomes', label: 'Outcomes', sort_order: 2},
];

const treeOf = (fields: ReturnType<typeof field>[]) =>
  buildTemplateTree(sections, fields);

const baseFields = [
  field('f1', 'sec1', 'k_alpha', 'Alpha', 1),
  field('f2', 'sec1', 'k_beta', 'Beta', 2),
  field('f3', 'sec1', 'k_gamma', 'Gamma', 3),
  field('f4', 'sec2', 'k_delta', 'Delta', 1),
];

const mustField = (tree: GridSection[], id: string) => {
  const found = findField(tree, id);
  if (!found) throw new Error(`test tree is missing field ${id}`);
  return found;
};

/** The toast mock's nth call, with the action narrowed for clicking. */
const toastCall = (index = 0) => {
  const call = vi.mocked(toast).mock.calls[index] as unknown as [
    string,
    {id?: string; duration?: number; action?: {label: string; onClick: (event: unknown) => void}},
  ];
  return {message: call[0], data: call[1]};
};

const clickUndo = (index = 0) => {
  const {data} = toastCall(index);
  if (!data.action) throw new Error('toast call carries no action');
  act(() => data.action?.onClick({}));
};

/** Flush pending microtasks (settled chains). */
const flush = () => act(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Layer 1 — hook contract (renderHook + a mocked dispatcher)
// ---------------------------------------------------------------------------

const record = (ok: boolean, from = {sectionId: 'sec1', index: 1}): FieldMoveRecord => ({
  from,
  to: {sectionId: 'sec2', index: 1},
  settled: Promise.resolve(ok),
});

function renderUndo(dispatcher: (
  field: ReturnType<typeof mustField>,
  toSectionId: string,
  toIndex: number,
) => FieldMoveRecord | null) {
  return renderHook(
    ({tree}: {tree: GridSection[]}) => useStructuralUndo({tree, moveFieldTo: dispatcher}),
    {initialProps: {tree: treeOf(baseFields)}},
  );
}

describe('useStructuralUndo — hook contract', () => {
  it('arms the 6s single-slot toast only AFTER settled resolves true', async () => {
    const dispatcher = vi.fn(() => record(true));
    const {result} = renderUndo(dispatcher);
    const beta = mustField(treeOf(baseFields), 'f2');
    const returned = result.current.moveFieldWithUndo(beta, 'sec2', 1);
    expect(returned).not.toBeNull(); // the record passes through to callers
    expect(toast).not.toHaveBeenCalled(); // never before the write lands
    await flush();
    expect(toast).toHaveBeenCalledTimes(1);
    const {message, data} = toastCall();
    expect(message).toBe('Moved Beta');
    expect(data.id).toBe(STRUCTURAL_UNDO_TOAST_ID);
    expect(data.duration).toBe(6000);
    expect(data.action?.label).toBe('Undo');
  });

  it('a failed write (settled=false) arms NO undo toast — the hooks own the error', async () => {
    const dispatcher = vi.fn(() => record(false));
    const {result} = renderUndo(dispatcher);
    result.current.moveFieldWithUndo(mustField(treeOf(baseFields), 'f2'), 'sec2', 1);
    await flush();
    expect(toast).not.toHaveBeenCalled();
  });

  it('a NEW structural mutation replaces the live toast — same slot id both times', async () => {
    const dispatcher = vi.fn(() => record(true));
    const {result} = renderUndo(dispatcher);
    result.current.moveFieldWithUndo(mustField(treeOf(baseFields), 'f2'), 'sec2', 1);
    await flush();
    result.current.moveFieldWithUndo(mustField(treeOf(baseFields), 'f3'), 'sec2', 0);
    await flush();
    expect(toast).toHaveBeenCalledTimes(2);
    expect(toastCall(0).data.id).toBe(STRUCTURAL_UNDO_TOAST_ID);
    expect(toastCall(1).data.id).toBe(STRUCTURAL_UNDO_TOAST_ID);
  });

  it('undo re-dispatches the RAW dispatcher: from-slot + the CURRENT field by id, no second toast', async () => {
    const dispatcher = vi.fn(() => record(true, {sectionId: 'sec1', index: 1}));
    const {result, rerender} = renderUndo(dispatcher);
    result.current.moveFieldWithUndo(mustField(treeOf(baseFields), 'f2'), 'sec2', 1);
    await flush();
    // The tree refetched meanwhile: same id, DIFFERENT object (renamed).
    const renamed = baseFields.map((f) =>
      f.id === 'f2' ? {...f, label: 'Beta v2'} : f,
    );
    rerender({tree: treeOf(renamed)});
    clickUndo();
    expect(dispatcher).toHaveBeenCalledTimes(2);
    // exactIndex: the restore lands at the CAPTURED slot even when the
    // destination collapsed meanwhile (no append-to-end on undo).
    expect(dispatcher).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({id: 'f2', label: 'Beta v2'}),
      'sec1',
      1,
      {exactIndex: true},
    );
    await flush();
    // An undo is not a new undoable: the revert armed NO fresh toast.
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('undo of a field deleted meanwhile downgrades to a gentle info toast', async () => {
    const dispatcher = vi.fn(() => record(true));
    const {result, rerender} = renderUndo(dispatcher);
    result.current.moveFieldWithUndo(mustField(treeOf(baseFields), 'f2'), 'sec2', 1);
    await flush();
    rerender({tree: treeOf(baseFields.filter((f) => f.id !== 'f2'))});
    clickUndo();
    expect(dispatcher).toHaveBeenCalledTimes(1); // no write dispatched
    expect(toast.info).toHaveBeenCalledWith(
      'This field no longer exists — nothing to undo',
    );
    expect(toast).toHaveBeenCalledTimes(1); // and no new undo toast either
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — panel wiring (both chokepoints + a full undo round-trip)
// ---------------------------------------------------------------------------

const entityTypesOf = (fields: ReturnType<typeof field>[]) =>
  sections.map((section) => ({
    ...section,
    description: null,
    role: 'study_section',
    cardinality: 'one',
    parent_entity_type_id: null,
    fields: fields.filter((f) => f.entity_type_id === section.id),
  }));

const sectionActions: TemplateSectionActions = {
  onCommitRename: vi.fn(),
  onDelete: vi.fn(),
  onAddPerModelSection: vi.fn(),
};

/** DOM .focus() runs the grid's focusin sync — act-wrap outside userEvent. */
const focusEl = (el: HTMLElement) => act(() => el.focus());

const chord = (el: Element, key: 'ArrowUp' | 'ArrowDown') =>
  fireEvent.keyDown(el, {key, shiftKey: true, metaKey: true});

let currentEntityTypes: ReturnType<typeof entityTypesOf>;
let moveMutateAsync: ReturnType<typeof vi.fn>;
let reorderMutateAsync: ReturnType<typeof vi.fn>;

beforeEach(() => {
  currentEntityTypes = entityTypesOf(baseFields);
  moveMutateAsync = vi.fn(async () => ({}) as never);
  reorderMutateAsync = vi.fn(async () => undefined);
  vi.mocked(useMoveTemplateField).mockReturnValue({
    mutateAsync: moveMutateAsync,
  } as unknown as ReturnType<typeof useMoveTemplateField>);
  vi.mocked(useReorderTemplateFields).mockReturnValue({
    mutateAsync: reorderMutateAsync,
  } as unknown as ReturnType<typeof useReorderTemplateFields>);
  vi.mocked(useTemplateConfigCaches).mockReturnValue({
    invalidateStructure: vi.fn(async () => undefined),
    invalidateAll: vi.fn(async () => undefined),
    invalidateAfterImport: vi.fn(async () => undefined),
  });
  // Implementation (not value): the round-trip test refetches a MOVED
  // order after the write, exactly like the real invalidation would.
  vi.mocked(useTemplateEntityTypes).mockImplementation(
    () =>
      ({
        entityTypes: currentEntityTypes as never,
        isLoading: false,
        isError: false,
        error: null,
      }) as unknown as ReturnType<typeof useTemplateEntityTypes>,
  );
  vi.mocked(useUpdateTemplateField).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateTemplateField>);
  vi.mocked(useInsertTemplateField).mockReturnValue({
    enqueueInsert: vi.fn(() => ({clientKey: 'pending-1', name: 'x'})),
    enqueueUpdate: vi.fn(),
  } as unknown as ReturnType<typeof useInsertTemplateField>);
});

function renderPanel() {
  // dnd-kit's DndContext (T6) contributes its own role="status" live
  // region portaled to document.body — panel-region queries scope to
  // the render container.
  return render(
    <TooltipProvider>
      <TemplateConfigGridPanel
        projectId="p1"
        templateId="t1"
        onDeleteField={vi.fn()}
        sectionActions={sectionActions}
        onAddSection={vi.fn()}
        onAddGroup={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe('TemplateConfigGridPanel — undo wiring', () => {
  it('the chord chokepoint arms the undo toast on success', async () => {
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown');
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toastCall().message).toBe('Moved Beta');
    expect(toastCall().data.id).toBe(STRUCTURAL_UNDO_TOAST_ID);
  });

  it('the combobox chokepoint arms the same single-slot toast', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', {name: 'Beta'}));
    await user.selectOptions(screen.getByLabelText('Section'), 'sec2');
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toastCall().message).toBe('Moved Beta');
    expect(toastCall().data.id).toBe(STRUCTURAL_UNDO_TOAST_ID);
  });

  it('a failed write arms no undo toast', async () => {
    reorderMutateAsync.mockRejectedValueOnce(new Error('rls said no'));
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown');
    await flush();
    expect(toast).not.toHaveBeenCalled();
  });

  it('undo into a meanwhile-collapsed source restores the CAPTURED index — never append-to-end', async () => {
    const user = userEvent.setup();
    // The cross-section move "lands": Beta leaves Basics for Outcomes' end.
    moveMutateAsync.mockImplementationOnce(async () => {
      currentEntityTypes = entityTypesOf([
        field('f1', 'sec1', 'k_alpha', 'Alpha', 1),
        field('f3', 'sec1', 'k_gamma', 'Gamma', 2),
        field('f4', 'sec2', 'k_delta', 'Delta', 1),
        field('f2', 'sec2', 'k_beta', 'Beta', 2),
      ]);
      return {} as never;
    });
    renderPanel();
    await user.click(screen.getByRole('button', {name: 'Beta'}));
    await user.selectOptions(screen.getByLabelText('Section'), 'sec2');
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    // The SOURCE section collapses before the user reaches for Undo.
    await user.click(screen.getByRole('button', {name: /Collapse section — Basics/}));
    clickUndo();
    await waitFor(() => expect(moveMutateAsync).toHaveBeenCalledTimes(2));
    // from = {sec1, index 1}: the restore lands at sort_order 2 — the
    // collapsed-destination append (sort_order 3) must NOT apply to undo.
    expect(moveMutateAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        fieldId: 'f2',
        entityTypeId: 'sec1',
        sortOrder: 2,
      }),
    );
  });

  it('undo round-trip: the inverse write re-enters the dispatcher and announces — no new toast', async () => {
    // The chord's renumber "lands": the refetched order is [A, C, B].
    reorderMutateAsync.mockImplementationOnce(async () => {
      currentEntityTypes = entityTypesOf([
        field('f1', 'sec1', 'k_alpha', 'Alpha', 1),
        field('f3', 'sec1', 'k_gamma', 'Gamma', 2),
        field('f2', 'sec1', 'k_beta', 'Beta', 3),
        field('f4', 'sec2', 'k_delta', 'Delta', 1),
      ]);
    });
    const {container} = renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown');
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    // The announcement re-render served the refetched (moved) tree.
    await waitFor(() =>
      expect(within(container).getByRole('status')).toHaveTextContent(
        'Moved Beta to Basics, position 3 of 3',
      ),
    );
    clickUndo();
    await waitFor(() => expect(reorderMutateAsync).toHaveBeenCalledTimes(2));
    // Inverse planned from the LATEST order [A,C,B]: back to [A,B,C].
    expect(reorderMutateAsync).toHaveBeenNthCalledWith(2, {
      updates: [
        {id: 'f1', sort_order: 1},
        {id: 'f2', sort_order: 2},
        {id: 'f3', sort_order: 3},
      ],
    });
    expect(moveMutateAsync).not.toHaveBeenCalled();
    // The undo announces through the SAME single live region (an undo is
    // a move — it rides the dispatcher's announcement, nothing doubles).
    await waitFor(() =>
      expect(within(container).getByRole('status')).toHaveTextContent(
        'Moved Beta to Basics, position 2 of 3',
      ),
    );
    expect(within(container).getAllByRole('status')).toHaveLength(1);
    // And it armed NO fresh undo toast — an undo is not a new undoable.
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
