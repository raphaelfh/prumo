/**
 * TemplateConfigGridPanel — template focus (spec 2026-09-13 §4.3).
 *
 * The config bar's AI instruction trigger bumps `templateFocusSeq`; a NEW
 * sequence clears the selection and opens the active inspector host, which
 * with nothing selected is the template pane.
 */
import {act, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/templateService', () => ({updateSection: vi.fn()}));
vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('@/hooks/extraction/useTemplateEntityTypes', () => ({
  useTemplateEntityTypes: vi.fn(),
}));
vi.mock('@/hooks/extraction/useUpdateTemplateField', () => ({
  useUpdateTemplateField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useInsertTemplateField', () => ({
  useInsertTemplateField: vi.fn(),
}));
vi.mock('@/hooks/shared/useContainerNarrow', () => ({useContainerNarrow: vi.fn(() => false)}));
vi.mock('./useMoveFieldTo', () => ({useMoveFieldTo: ({tree}: {tree: unknown}) => ({moveFieldTo: () => null, announcement: null, displayTree: tree})}));
vi.mock('sonner', () => ({toast: {error: vi.fn(), success: vi.fn()}}));
vi.mock('@/components/extraction/TemplateInstructionPane', () => ({
  TemplateInstructionPane: ({templateId}: {templateId: string}) => <div data-testid={`instruction-pane-${templateId}`} />,
}));

import {TooltipProvider} from '@/components/ui/tooltip';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useInsertTemplateField} from '@/hooks/extraction/useInsertTemplateField';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';
import {useContainerNarrow} from '@/hooks/shared/useContainerNarrow';
import {stubStructuralHistory} from '@/test/helpers/structuralHistoryStub';

import {TemplateConfigGridPanel} from './TemplateConfigGridPanel';
import type {TemplateSectionActions} from './TemplateGrid';

const field = (id: string, entityTypeId: string, name: string, label: string, sortOrder: number) => ({
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
  onAddPerGroupSection: vi.fn(),
};

function stubInsertQueue() {
  const enqueueInsert = vi.fn(() => ({clientKey: 'pending-1', name: 'peso'}));
  const enqueueUpdate = vi.fn();
  vi.mocked(useInsertTemplateField).mockReturnValue({enqueueInsert, enqueueUpdate});
}

beforeEach(() => {
  vi.clearAllMocks();
  stubInsertQueue();
  vi.mocked(useContainerNarrow).mockReturnValue(false);
});

const entityTypes = [
  {id: 'sec', name: 'sec_a', label: 'Section A', description: null, cardinality: 'one', parent_entity_type_id: null, sort_order: 1, fields: [field('f1', 'sec', 'q1', 'Study design', 1)]},
];

const panel = (seq: number) => (
  <TooltipProvider>
    <TemplateConfigGridPanel
      projectId="p1"
      templateId="t1"
      onDeleteField={vi.fn()}
      history={stubStructuralHistory()}
      sectionActions={sectionActions}
      onAddSection={vi.fn()}
      onAddGroup={vi.fn()}
      instruction={{draft: null, onDraftChange: vi.fn()}}
      templateFocusSeq={seq}
    />
  </TooltipProvider>
);

describe('TemplateConfigGridPanel — template focus', () => {
  beforeEach(() => {
    vi.mocked(useTemplateEntityTypes).mockReturnValue({entityTypes: entityTypes as never, isLoading: false, isPending: false, isError: false, error: null});
    vi.mocked(useUpdateTemplateField).mockReturnValue({mutate: vi.fn(), isPending: false} as unknown as ReturnType<typeof useUpdateTemplateField>);
  });

  it('a new sequence clears the selection and shows the template pane', async () => {
    const {rerender} = render(panel(0));
    await userEvent.click(screen.getByRole('button', {name: 'Study design'}));
    expect(screen.queryByTestId('instruction-pane-t1')).toBeNull();

    rerender(panel(1));
    expect(screen.getByTestId('instruction-pane-t1')).toBeInTheDocument();
  });

  it('opens the narrow sheet host on a new sequence', () => {
    vi.mocked(useContainerNarrow).mockReturnValue(true);
    const {rerender} = render(panel(0));
    expect(screen.queryByTestId('instruction-pane-t1')).toBeNull();
    rerender(panel(1));
    expect(screen.getByTestId('instruction-pane-t1')).toBeInTheDocument();
  });

  it('does not re-open on a rerender with the same sequence', async () => {
    const {rerender} = render(panel(1));
    expect(screen.getByTestId('instruction-pane-t1')).toBeInTheDocument();
    // Esc must start inside the grid (the table itself is not focusable):
    // focusing — not clicking — a cell selects nothing; rung 2 closes the
    // open docked inspector.
    act(() => screen.getByRole('button', {name: 'Study design'}).focus());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('instruction-pane-t1')).toBeNull();

    rerender(panel(1));
    expect(screen.queryByTestId('instruction-pane-t1')).toBeNull();
  });
});
