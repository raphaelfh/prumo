/**
 * The outline rail's collapse wiring (the left twin of the inspector
 * toggle). Its own file: TemplateConfigGridPanel.test.tsx already sits at
 * the file-size ratchet's cap.
 */
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// Same module-tree isolation as TemplateConfigGridPanel.test.tsx: the
// panel mounts TemplateInspector, whose section pane reaches
// templateService -> apiClient -> the supabase client, which throws on
// import when env is absent (CI).
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
vi.mock('@/hooks/shared/useContainerNarrow', () => ({
  useContainerNarrow: vi.fn(() => false),
}));
vi.mock('./useMoveFieldTo', () => ({
  useMoveFieldTo: ({tree}: {tree: unknown}) => ({
    moveFieldTo: () => null,
    announcement: null,
    displayTree: tree,
  }),
}));
vi.mock('@/services/extractionFieldService', () => ({validateFieldImpact: vi.fn()}));
vi.mock('sonner', () => ({toast: {error: vi.fn(), success: vi.fn()}}));

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

import {TooltipProvider} from '@/components/ui/tooltip';
import {useInsertTemplateField} from '@/hooks/extraction/useInsertTemplateField';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';

import {TemplateConfigGridPanel} from './TemplateConfigGridPanel';
import type {TemplateSectionActions} from './TemplateGrid';
import {stubStructuralHistory} from '@/test/helpers/structuralHistoryStub';

const sectionActions: TemplateSectionActions = {
  onCommitRename: vi.fn(),
  onDelete: vi.fn(),
  onAddPerModelSection: vi.fn(),
};

const field = (id: string, entityTypeId: string, label: string, sortOrder: number) => ({
  id,
  entity_type_id: entityTypeId,
  name: id,
  label,
  description: null,
  field_type: 'text',
  is_required: false,
  allowed_values: null,
  llm_description: null,
  sort_order: sortOrder,
});

/** A root section, plus a repeating group with one per-model child — the
 * child is what a rail click must be able to reach through a collapse. */
const entityTypes = [
  {
    id: 'sec',
    name: 'sec_a',
    label: 'Section A',
    description: null,
    role: 'study_section',
    cardinality: 'one',
    parent_entity_type_id: null,
    sort_order: 1,
    fields: [field('f1', 'sec', 'Study design', 1)],
  },
  {
    id: 'grp',
    name: 'models',
    label: 'Prediction Models',
    description: null,
    role: 'model_container',
    cardinality: 'many',
    parent_entity_type_id: null,
    sort_order: 2,
    entry_label: 'model',
    fields: [field('f2', 'grp', 'Model name', 1)],
  },
  {
    id: 'kid',
    name: 'performance',
    label: 'Model Performance',
    description: null,
    role: 'study_section',
    cardinality: 'one',
    parent_entity_type_id: 'grp',
    sort_order: 1,
    fields: [field('f3', 'kid', 'C-statistic', 1)],
  },
];

// Selecting a SECTION mounts SectionInspectorForm, whose immediate-commit
// mutation needs a client (a field selection does not — which is why the
// sibling panel suite gets away without one).
const panel = () => (
  <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
  <TooltipProvider>
    <TemplateConfigGridPanel
      projectId="p1"
      templateId="t1"
      onDeleteField={vi.fn()}
        history={stubStructuralHistory()}
      sectionActions={sectionActions}
      onAddSection={vi.fn()}
      onAddGroup={vi.fn()}
    />
  </TooltipProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useInsertTemplateField).mockReturnValue({
    enqueueInsert: vi.fn(() => ({clientKey: 'pending-1', name: 'q'})),
    enqueueUpdate: vi.fn(),
  } as unknown as ReturnType<typeof useInsertTemplateField>);
  vi.mocked(useTemplateEntityTypes).mockReturnValue({
    entityTypes: entityTypes as never,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
  });
  vi.mocked(useUpdateTemplateField).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateTemplateField>);
});

describe('TemplateConfigGridPanel — outline rail collapse', () => {
  it('the toolbar toggle unmounts and remounts the rail, and reports its state', async () => {
    render(panel());

    const toggle = screen.getByRole('button', {name: 'gridOutlineToggle'});
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('navigation', {name: 'configHeaderTitle'})).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('navigation', {name: 'configHeaderTitle'})).toBeNull();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('navigation', {name: 'configHeaderTitle'})).toBeInTheDocument();
  });

  it('collapsing the rail leaves the grid and the inspector untouched', async () => {
    render(panel());

    await userEvent.click(screen.getByRole('button', {name: 'gridOutlineToggle'}));

    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Study design'})).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: 'inspectorToggle'}),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('TemplateConfigGridPanel — rail click reveals the section', () => {
  /**
   * jsdom has no layout: every rect is 0, so the panel's already-in-view
   * early-out would swallow every case. Put the scroller at 100..400 and
   * every row at 500..530 — below the fold, so a reveal is warranted and
   * lands at 500 - 100 - 8 = 392.
   */
  const EXPECTED_TOP = 392;
  function stubLayout() {
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo as unknown as Element['scrollTo'];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return this.tagName === 'TR'
          ? ({top: 500, bottom: 530} as DOMRect)
          : ({top: 100, bottom: 400} as DOMRect);
      },
    );
    return scrollTo;
  }

  it('leaves the grid alone when the section is already on screen', async () => {
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo as unknown as Element['scrollTo'];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        // Row fully inside the scroller's box.
        return this.tagName === 'TR'
          ? ({top: 150, bottom: 180} as DOMRect)
          : ({top: 100, bottom: 400} as DOMRect);
      },
    );
    render(panel());

    await userEvent.click(
      within(screen.getByRole('navigation', {name: 'configHeaderTitle'})).getByRole(
        'button',
        {name: /Section A/},
      ),
    );

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls the grid to the clicked section', async () => {
    const scrollTo = stubLayout();
    render(panel());

    await userEvent.click(
      within(screen.getByRole('navigation', {name: 'configHeaderTitle'})).getByRole(
        'button',
        {name: /Section A/},
      ),
    );

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({top: EXPECTED_TOP}));
  });

  it('still selects the section — the reveal is additive, not a replacement', async () => {
    stubLayout();
    render(panel());

    await userEvent.click(
      within(screen.getByRole('navigation', {name: 'configHeaderTitle'})).getByRole(
        'button',
        {name: /Prediction Models/},
      ),
    );

    expect(screen.getByTestId('template-inspector')).toBeInTheDocument();
  });

  it('opens a collapsed group so its per-model child has a row to scroll to', async () => {
    const scrollTo = stubLayout();
    render(panel());

    // Collapse the group: its child header and rows leave the grid.
    await userEvent.click(
      screen.getByRole('button', {name: /gridCollapseSection — Prediction Models/}),
    );
    expect(screen.queryByRole('button', {name: 'C-statistic'})).toBeNull();
    scrollTo.mockClear();

    await userEvent.click(
      within(screen.getByRole('navigation', {name: 'configHeaderTitle'})).getByRole(
        'button',
        {name: /Model Performance/},
      ),
    );

    // The group re-opened, and the now-mounted child row was scrolled to.
    expect(screen.getByRole('button', {name: 'C-statistic'})).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({top: EXPECTED_TOP}));
  });
});
