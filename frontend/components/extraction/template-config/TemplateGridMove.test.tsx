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
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

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
vi.mock('sonner', () => ({toast: {error: vi.fn(), success: vi.fn()}}));

import {TooltipProvider} from '@/components/ui/tooltip';
import {useInsertTemplateField} from '@/hooks/extraction/useInsertTemplateField';
import {useMoveTemplateField} from '@/hooks/extraction/useMoveTemplateField';
import {useReorderTemplateFields} from '@/hooks/extraction/useReorderTemplateFields';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';

import {TemplateConfigGridPanel} from './TemplateConfigGridPanel';
import {TemplateGrid, type TemplateSectionActions} from './TemplateGrid';
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
  render(
    <TooltipProvider>
      <TemplateConfigGridPanel
        projectId="p1"
        templateId="t1"
        onDeleteField={vi.fn()}
        sectionActions={sectionActions}
        onAddSection={vi.fn()}
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
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chord(beta, 'ArrowDown');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
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
    chord(beta, 'ArrowUp'); // planned from the latest order: [A,C,B] -> [B,A,C]
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
    // Post-first order [A,C,B], Beta to slot 0 -> [B,A,C].
    expect(reorderMutateAsync).toHaveBeenNthCalledWith(2, {
      updates: [
        {id: 'f2', sort_order: 1},
        {id: 'f1', sort_order: 2},
        {id: 'f3', sort_order: 3},
      ],
    });
  });

  it('coalesces a rapid REPEAT: the second identical chord plans to nothing', async () => {
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
    chord(beta, 'ArrowDown'); // [A,B,C] -> [A,C,B] (B now last)
    chord(beta, 'ArrowDown'); // stale grid re-asks for slot 2 — already there
    await flush();
    act(() => releaseFirst());
    await flush();
    expect(reorderMutateAsync).toHaveBeenCalledTimes(1);
    expect(moveMutateAsync).not.toHaveBeenCalled();
  });
});
