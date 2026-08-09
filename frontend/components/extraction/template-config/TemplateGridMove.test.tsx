/**
 * B-6 grid move behavior (T3): the ⌘⇧↑/↓ chord wired end to end.
 *
 * NEW file by design (decision 10) — TemplateGrid.test.tsx and
 * TemplateConfigGridPanel.test.tsx sit at their file-size ratchet
 * ceilings and must not grow. Two layers:
 *
 * 1. Grid contract: the chord dispatches `onMoveField` with the
 *    boundary-aware slot (meta OR ctrl — Ctrl⇧ is the equal-citizen
 *    fallback for browsers/OSes that claim ⌘⇧-arrows), is consumed even
 *    when disallowed (no scroll), and no-ops on filtering/pending rows.
 * 2. Panel dispatcher: `moveFieldTo` serializes structural writes
 *    (panel decision 3), renumbers whole sections, announces through
 *    the surface's first `role="status"` live region, and coalesces
 *    rapid repeats by planning from the latest local order.
 *
 * Copy is deliberately NOT mocked here — the announcement test pins the
 * real interpolated string.
 */
import {act, fireEvent, render, renderHook, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// The panel mounts TemplateInspector, whose section pane reaches
// templateService -> apiClient -> the supabase client, which throws on
// import when env is absent (CI). Mocking the service keeps the module
// tree out of these grid tests.
vi.mock('@/services/templateService', () => ({updateSection: vi.fn()}));
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
// Callable: T5's undo wrapper toasts on every settled move dispatch.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {error: vi.fn(), success: vi.fn(), info: vi.fn()}),
}));

import {MouseSensor, TouchSensor, type DragEndEvent} from '@dnd-kit/core';

import {TooltipProvider} from '@/components/ui/tooltip';
import {useInsertTemplateField} from '@/hooks/extraction/useInsertTemplateField';
import {useMoveTemplateField} from '@/hooks/extraction/useMoveTemplateField';
import {useReorderTemplateFields} from '@/hooks/extraction/useReorderTemplateFields';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';

import {TemplateConfigGridPanel} from './TemplateConfigGridPanel';
import {TemplateGrid, type TemplateSectionActions} from './TemplateGrid';
import {useGridDrag, type GridDragArgs} from './gridDrag';
import {buildTemplateTree} from './templateTree';

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

const sectionActions: TemplateSectionActions = {
  onCommitRename: vi.fn(),
  onDelete: vi.fn(),
  onAddPerModelSection: vi.fn(),
};

/** DOM .focus() runs the grid's focusin sync — act-wrap outside userEvent. */
const focusEl = (el: HTMLElement) => act(() => el.focus());

/** Fire the move chord; returns false when the grid consumed it. */
const chord = (
  el: Element,
  key: 'ArrowUp' | 'ArrowDown',
  mod: {metaKey?: boolean; ctrlKey?: boolean} = {metaKey: true},
) => fireEvent.keyDown(el, {key, shiftKey: true, ...mod});

/** Flush pending microtasks (the dispatcher's promise chain). */
const flush = () => act(async () => {});

// ---------------------------------------------------------------------------
// Layer 1 — grid contract (TemplateGrid + onMoveField mock)
// ---------------------------------------------------------------------------

const gridTree = buildTemplateTree(
  [
    {id: 'sec1', name: 'basics', label: 'Basics', sort_order: 1},
    {id: 'sec2', name: 'outcomes', label: 'Outcomes', sort_order: 2},
  ],
  [
    field('f1', 'sec1', 'k_alpha', 'Alpha', 1),
    field('f2', 'sec1', 'k_beta', 'Beta', 2),
    field('f3', 'sec1', 'k_gamma', 'Gamma', 3),
    field('f4', 'sec2', 'k_delta', 'Delta', 1),
  ],
);

function renderGrid(over: Partial<Parameters<typeof TemplateGrid>[0]> = {}) {
  const props = {
    sections: gridTree,
    selection: null,
    onSelect: vi.fn(),
    onDeleteField: vi.fn(),
    onCommitField: vi.fn(),
    onInsertField: vi.fn(),
    onToggleRequired: vi.fn(),
    onChangeType: vi.fn(),
    onDeepLink: vi.fn(),
    onMoveField: vi.fn(() => null),
    sectionActions,
    onAddSection: vi.fn(),
    onAddGroup: vi.fn(),
    onEscapeEscalate: vi.fn(),
    collapsed: new Set<string>(),
    onToggleCollapse: vi.fn(),
    showKeyColumn: false,
    showOptionsColumn: false,
    isFiltering: false,
    ...over,
  };
  render(
    <TooltipProvider>
      <TemplateGrid {...props} />
    </TooltipProvider>,
  );
  return props;
}

describe('TemplateGrid move chord contract', () => {
  it('⌘⇧↓ dispatches onMoveField with the boundary-aware slot and is consumed', () => {
    const {onMoveField} = renderGrid();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    const notPrevented = chord(beta, 'ArrowDown');
    expect(notPrevented).toBe(false); // never a scroll, never a rove
    expect(onMoveField).toHaveBeenCalledTimes(1);
    expect(onMoveField).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f2'}),
      'sec1',
      2,
    );
  });

  it('Ctrl⇧↓ is an equal citizen (the non-macOS / claimed-chord fallback)', () => {
    const {onMoveField} = renderGrid();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown', {ctrlKey: true});
    expect(onMoveField).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f2'}),
      'sec1',
      2,
    );
  });

  it('⌘⇧↓ from a section last field crosses into the next section first slot', () => {
    const {onMoveField} = renderGrid();
    const gamma = screen.getByRole('button', {name: 'Gamma'});
    focusEl(gamma);
    chord(gamma, 'ArrowDown');
    expect(onMoveField).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f3'}),
      'sec2',
      0,
    );
  });

  it('a template-edge chord is a consumed no-op — no dispatch, no scroll', () => {
    const {onMoveField} = renderGrid();
    const alpha = screen.getByRole('button', {name: 'Alpha'});
    focusEl(alpha);
    const notPrevented = chord(alpha, 'ArrowUp');
    expect(notPrevented).toBe(false);
    expect(onMoveField).not.toHaveBeenCalled();
  });

  it('the chord is disabled while filtering (visible indices lie)', () => {
    const {onMoveField} = renderGrid({isFiltering: true});
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    const notPrevented = chord(beta, 'ArrowDown');
    expect(notPrevented).toBe(false);
    expect(onMoveField).not.toHaveBeenCalled();
  });

  it('the chord is disabled on PENDING rows (no server id to write yet)', () => {
    const {onMoveField} = renderGrid({pendingRowIds: new Set(['f2'])});
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown');
    expect(onMoveField).not.toHaveBeenCalled();
  });

  it('a plain ArrowDown still roves — the modifier fold must not eat it', () => {
    const {onMoveField} = renderGrid();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    fireEvent.keyDown(beta, {key: 'ArrowDown'});
    expect(onMoveField).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', {name: 'Gamma'}));
  });
});

// ---------------------------------------------------------------------------
// T6 — drag handle contract (jsdom half; the gesture itself is the
// real-browser pass)
// ---------------------------------------------------------------------------

describe('TemplateGrid drag handle contract (T6)', () => {
  const handleOfRow = (label: string) => {
    const row = screen
      .getAllByTestId('template-grid-field-row')
      .find((tr) => within(tr).queryByRole('button', {name: label}) !== null);
    if (!row) throw new Error(`no field row labelled ${label}`);
    return row.querySelector('td');
  };
  const allHandles = () =>
    screen.getAllByTestId('template-grid-field-row').map((tr) => tr.querySelector('td'));

  it('the ⠿ handle stays NON-roving: no tabIndex, no role=button injection', () => {
    // useSortable's `attributes` would inject tabIndex=0 + role="button"
    // — a second tab stop that breaks the one-tab-stop invariant. The
    // handle must render as a plain gridcell.
    renderGrid();
    for (const handle of allHandles()) {
      expect(handle).not.toHaveAttribute('tabindex');
      expect(handle).toHaveAttribute('role', 'gridcell');
      expect(handle).not.toHaveAttribute('data-drag-locked');
    }
  });

  it('filtering locks EVERY handle with the clear-search reason', () => {
    renderGrid({isFiltering: true});
    for (const handle of allHandles()) {
      expect(handle).toHaveAttribute('data-drag-locked', 'filtering');
    }
  });

  it('a pending row locks ITS handle only', () => {
    renderGrid({pendingRowIds: new Set(['f2'])});
    expect(handleOfRow('Beta')).toHaveAttribute('data-drag-locked', 'pending');
    expect(handleOfRow('Alpha')).not.toHaveAttribute('data-drag-locked');
  });
});

// ---------------------------------------------------------------------------
// T6 — useGridDrag: sensors + the onDragEnd → dropSlot → onMoveField
// translation, driven with CONSTRUCTED DragEndEvents (no gesture syn-
// thesis — jsdom cannot drag; the browser pass owns the real gesture).
// ---------------------------------------------------------------------------

const dragEnd = (activeId: string, overId: string | null) =>
  ({
    active: {id: activeId},
    over: overId === null ? null : {id: overId},
  }) as unknown as DragEndEvent;

function renderDrag(over: Partial<GridDragArgs> = {}) {
  const onMoveField = vi.fn();
  const {result} = renderHook(() =>
    useGridDrag({
      sections: gridTree,
      collapsed: new Set<string>(),
      isFiltering: false,
      pendingRowIds: new Set<string>(),
      onMoveField,
      ...over,
    }),
  );
  return {result, onMoveField};
}

describe('useGridDrag — drop translation (T6)', () => {
  it('a drop over another row dispatches onMoveField with the resolved slot', () => {
    const {result, onMoveField} = renderDrag();
    act(() => result.current.onDragEnd(dragEnd('f1', 'f3')));
    expect(onMoveField).toHaveBeenCalledTimes(1);
    expect(onMoveField).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
      'sec1',
      2,
    );
  });

  it('a drop on a COLLAPSED section header appends to that section END', () => {
    const {result, onMoveField} = renderDrag({collapsed: new Set(['sec2'])});
    act(() => result.current.onDragEnd(dragEnd('f1', 'sec2')));
    expect(onMoveField).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
      'sec2',
      1,
    );
  });

  it('no-op drops dispatch nothing: outside, own position, filtering, pending', () => {
    const outside = renderDrag();
    act(() => outside.result.current.onDragEnd(dragEnd('f1', null)));
    expect(outside.onMoveField).not.toHaveBeenCalled();

    const own = renderDrag();
    act(() => own.result.current.onDragEnd(dragEnd('f1', 'f1')));
    expect(own.onMoveField).not.toHaveBeenCalled();

    const filtering = renderDrag({isFiltering: true});
    act(() => filtering.result.current.onDragEnd(dragEnd('f1', 'f3')));
    expect(filtering.onMoveField).not.toHaveBeenCalled();

    const pending = renderDrag({pendingRowIds: new Set(['f1'])});
    act(() => pending.result.current.onDragEnd(dragEnd('f1', 'f3')));
    expect(pending.onMoveField).not.toHaveBeenCalled();
  });

  it('sensors: mouse activates at 6px, touch long-presses — and NO KeyboardSensor', () => {
    // KeyboardSensor would fight the grid's roving handler; the a11y
    // paths are the ⌘⇧ chords + the Section combobox (panel decision 5).
    const {result} = renderDrag();
    expect(result.current.sensors.map((s) => s.sensor)).toEqual([
      MouseSensor,
      TouchSensor,
    ]);
    expect(result.current.sensors[0].options).toEqual({
      activationConstraint: {distance: 6},
    });
    expect(result.current.sensors[1].options).toEqual({
      activationConstraint: {delay: 250, tolerance: 8},
    });
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — panel dispatcher (TemplateConfigGridPanel + mocked write hooks)
// ---------------------------------------------------------------------------

const entityTypes = [
  {
    id: 'sec1',
    name: 'basics',
    label: 'Basics',
    description: null,
    role: 'study_section',
    cardinality: 'one',
    parent_entity_type_id: null,
    sort_order: 1,
    fields: [
      field('f1', 'sec1', 'k_alpha', 'Alpha', 1),
      field('f2', 'sec1', 'k_beta', 'Beta', 2),
      field('f3', 'sec1', 'k_gamma', 'Gamma', 3),
    ],
  },
  {
    id: 'sec2',
    name: 'outcomes',
    label: 'Outcomes',
    description: null,
    role: 'study_section',
    cardinality: 'one',
    parent_entity_type_id: null,
    sort_order: 2,
    fields: [field('f4', 'sec2', 'k_delta', 'Delta', 1)],
  },
];

let moveMutateAsync: ReturnType<typeof vi.fn>;
let reorderMutateAsync: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
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
  vi.mocked(useTemplateEntityTypes).mockReturnValue({
    entityTypes: entityTypes as never,
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useTemplateEntityTypes>);
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
  // dnd-kit's DndContext contributes its own role="status" live region
  // (portaled to document.body), so panel-region queries scope to the
  // render container.
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

describe('TemplateConfigGridPanel — moveFieldTo dispatcher', () => {
  it('within-section chord writes ONE whole-section renumber batch (no moveField)', async () => {
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown');
    await flush();
    expect(moveMutateAsync).not.toHaveBeenCalled();
    expect(reorderMutateAsync).toHaveBeenCalledTimes(1);
    expect(reorderMutateAsync).toHaveBeenCalledWith({
      updates: [
        {id: 'f1', sort_order: 1},
        {id: 'f3', sort_order: 2},
        {id: 'f2', sort_order: 3},
      ],
    });
  });

  it('cross-section chord writes moveField (entity + sort) plus both renumbers', async () => {
    renderPanel();
    const gamma = screen.getByRole('button', {name: 'Gamma'});
    focusEl(gamma);
    chord(gamma, 'ArrowDown');
    await flush();
    expect(moveMutateAsync).toHaveBeenCalledTimes(1);
    expect(moveMutateAsync).toHaveBeenCalledWith({
      fieldId: 'f3',
      entityTypeId: 'sec2',
      sortOrder: 1,
    });
    expect(reorderMutateAsync).toHaveBeenCalledWith({
      updates: [
        {id: 'f1', sort_order: 1},
        {id: 'f2', sort_order: 2},
        {id: 'f4', sort_order: 2},
      ],
    });
  });

  it('a template-edge chord writes nothing', async () => {
    renderPanel();
    const alpha = screen.getByRole('button', {name: 'Alpha'});
    focusEl(alpha);
    chord(alpha, 'ArrowUp');
    await flush();
    expect(moveMutateAsync).not.toHaveBeenCalled();
    expect(reorderMutateAsync).not.toHaveBeenCalled();
  });

  it('announces the completed move through the polite live region', async () => {
    const {container} = renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown');
    await waitFor(() =>
      expect(within(container).getByRole('status')).toHaveTextContent(
        'Moved Beta to Basics, position 3 of 3',
      ),
    );
    // The write settled without a data change (mocked static tree): the
    // refocus nudge must keep focus on the moved row, not steal it away.
    await waitFor(() => expect(document.activeElement).toBe(beta));
  });

  it('serializes rapid chords: the second write waits for the first', async () => {
    let releaseFirst!: (value?: unknown) => void;
    reorderMutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown'); // [A,B,C] -> [A,C,B]
    // The order overlay (decision 7) already re-rendered [A,C,B], so the
    // grid asks to move Beta (now last) UP one slot; the dispatcher plans
    // it from the same working order: back to [A,B,C].
    chord(beta, 'ArrowUp');
    await flush();
    expect(reorderMutateAsync).toHaveBeenCalledTimes(1);
    expect(reorderMutateAsync).toHaveBeenNthCalledWith(1, {
      updates: [
        {id: 'f1', sort_order: 1},
        {id: 'f3', sort_order: 2},
        {id: 'f2', sort_order: 3},
      ],
    });
    act(() => releaseFirst());
    await waitFor(() => expect(reorderMutateAsync).toHaveBeenCalledTimes(2));
    expect(reorderMutateAsync).toHaveBeenNthCalledWith(2, {
      updates: [
        {id: 'f1', sort_order: 1},
        {id: 'f2', sort_order: 2},
        {id: 'f3', sort_order: 3},
      ],
    });
  });

  it('combobox path (T4): a pick moves to the END of the destination and announces', async () => {
    const user = userEvent.setup();
    const {container} = renderPanel();
    // Click selects the row; the docked inspector opens on Beta.
    await user.click(screen.getByRole('button', {name: 'Beta'}));
    await user.selectOptions(screen.getByLabelText('Section'), 'sec2');
    await flush();
    // END of Outcomes: one existing field -> toIndex 1, sort_order 2.
    expect(moveMutateAsync).toHaveBeenCalledTimes(1);
    expect(moveMutateAsync).toHaveBeenCalledWith({
      fieldId: 'f2',
      entityTypeId: 'sec2',
      sortOrder: 2,
    });
    expect(reorderMutateAsync).toHaveBeenCalledWith({
      updates: [
        {id: 'f1', sort_order: 1},
        {id: 'f3', sort_order: 2},
        {id: 'f4', sort_order: 1},
      ],
    });
    // The announcement rides the DISPATCHER, so the combobox affordance
    // announces exactly like the chord does.
    await waitFor(() =>
      expect(within(container).getByRole('status')).toHaveTextContent(
        'Moved Beta to Outcomes, position 2 of 2',
      ),
    );
  });

  it('mounts the T1 hooks with invalidateOnSuccess: false — the dispatcher owns invalidation', () => {
    renderPanel();
    expect(vi.mocked(useMoveTemplateField)).toHaveBeenCalledWith('p1', 't1', {
      invalidateOnSuccess: false,
    });
    expect(vi.mocked(useReorderTemplateFields)).toHaveBeenCalledWith('p1', 't1', {
      invalidateOnSuccess: false,
    });
  });

  it('a FAILED write still triggers the structure refetch — a partial batch may have landed', async () => {
    const invalidateStructure = vi.fn(async () => undefined);
    vi.mocked(useTemplateConfigCaches).mockReturnValue({
      invalidateStructure,
      invalidateAll: vi.fn(async () => undefined),
      invalidateAfterImport: vi.fn(async () => undefined),
    });
    reorderMutateAsync.mockRejectedValueOnce(new Error('rls said no'));
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown');
    await flush();
    expect(invalidateStructure).toHaveBeenCalledTimes(1);
  });

  it('a FAILED move still nudges focus back onto the target cell', async () => {
    reorderMutateAsync.mockRejectedValueOnce(new Error('rls said no'));
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown');
    // The failure re-render (the order overlay retiring) drops focus to
    // body — the nudge must run on failure too, not only on success.
    act(() => beta.blur());
    await flush();
    await waitFor(() => expect(document.activeElement).toBe(beta));
  });

  it('a mid-burst failure skips the queued follow-ups; a fresh dispatch runs', async () => {
    let rejectFirst!: (err: Error) => void;
    reorderMutateAsync.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown'); // write #1 (hung, will fail)
    chord(beta, 'ArrowUp'); // queued behind it — premised on #1 landing
    await flush();
    expect(reorderMutateAsync).toHaveBeenCalledTimes(1);
    act(() => rejectFirst(new Error('rls said no')));
    await flush();
    // The queued execute was skipped: its plan assumed the failed write.
    expect(reorderMutateAsync).toHaveBeenCalledTimes(1);
    chord(beta, 'ArrowDown'); // a fresh dispatch AFTER the failure
    await flush();
    expect(reorderMutateAsync).toHaveBeenCalledTimes(2);
  });

  it('a repeat chord continues from the OVERLAID order: Beta crosses into the next section', async () => {
    let releaseFirst!: (value?: unknown) => void;
    reorderMutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown'); // [A,B,C] -> [A,C,B] (B now visibly last)
    // The overlay re-rendered before the repeat, so the second ⌘⇧↓ sees
    // Beta at the section's edge and asks for the NEXT section's first
    // slot — a held-down chord walks the field through the template.
    chord(beta, 'ArrowDown');
    await flush();
    expect(reorderMutateAsync).toHaveBeenCalledTimes(1);
    act(() => releaseFirst());
    await waitFor(() => expect(moveMutateAsync).toHaveBeenCalledTimes(1));
    expect(moveMutateAsync).toHaveBeenCalledWith({
      fieldId: 'f2',
      entityTypeId: 'sec2',
      sortOrder: 1,
    });
    await waitFor(() => expect(reorderMutateAsync).toHaveBeenCalledTimes(2));
    expect(reorderMutateAsync).toHaveBeenNthCalledWith(2, {
      updates: [
        {id: 'f1', sort_order: 1},
        {id: 'f3', sort_order: 2},
        {id: 'f4', sort_order: 2},
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// T6/decision 7 — the optimistic order overlay + the DndContext wrap
// ---------------------------------------------------------------------------

describe('TemplateConfigGridPanel — optimistic order overlay (decision 7)', () => {
  /** Field labels in DOM order — each row's first button is its label. */
  const rowLabels = () =>
    screen
      .getAllByTestId('template-grid-field-row')
      .map((tr) => within(tr).getAllByRole('button')[0].textContent);

  it('a move renders the planned order IMMEDIATELY — no snap-back while the write flies', async () => {
    let releaseFirst!: (value?: unknown) => void;
    reorderMutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown');
    // The overlay renders the planned order on the SAME flush as the
    // dispatch — before any write settles.
    expect(rowLabels()).toEqual(['Alpha', 'Gamma', 'Beta', 'Delta']);
    await flush(); // the serialized chain reaches the (hung) write
    expect(rowLabels()).toEqual(['Alpha', 'Gamma', 'Beta', 'Delta']);
    act(() => releaseFirst());
    await flush();
    // Drain clears the overlay: this suite's cache mock is static, so the
    // order snaps back — proving the overlay never outlives the refetch
    // (at rest the grid always renders server truth).
    expect(rowLabels()).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
  });

  it('a FAILED write clears the overlay at once — back to server truth', async () => {
    reorderMutateAsync.mockRejectedValueOnce(new Error('rls said no'));
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown');
    expect(rowLabels()).toEqual(['Alpha', 'Gamma', 'Beta', 'Delta']);
    await flush();
    expect(rowLabels()).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
  });

  it('mid-flight, the inspector resolves from the overlay: Section shows the NEW section', async () => {
    let release!: (value?: unknown) => void;
    moveMutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', {name: 'Beta'}));
    await user.selectOptions(screen.getByLabelText('Section'), 'sec2');
    // The write is still in flight: the Section select must show the
    // picked destination — never snap back to the old section while the
    // write+refetch window is open.
    expect(screen.getByLabelText('Section')).toHaveValue('sec2');
    act(() => release());
    await flush();
    // Settled against this suite's STATIC cache: back to server truth.
    expect(screen.getByLabelText('Section')).toHaveValue('sec1');
  });

  it('the DndContext wrap keeps the roving invariant: EXACTLY ONE tab stop in the grid', () => {
    const {container} = renderPanel();
    const grid = container.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();
    expect(grid!.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });
});
