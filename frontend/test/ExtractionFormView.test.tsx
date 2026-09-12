/**
 * Render-contract tests for `ExtractionFormView`.
 *
 * Scope after trees B3: this component partitions ROOTS and hosts the
 * `EntryFormProvider`. Everything inside a group — the selector, the group's
 * own fields bound to the active entry, the children, the recursion — is
 * `EntrySection`'s contract, tested in
 * `components/extraction/entries/EntrySection.test.tsx`.
 *
 * What left this file, and where it went:
 * - the model-parent and model-child blocks (10 specs), including the BUG #7
 *   fix that a group's OWN fields must render → `EntrySection.test.tsx`;
 * - the two memo-comparator specs → deleted with the comparator. They pinned
 *   that a rebuilt `models` array of the same length still re-rendered the
 *   selector — a property of `useModelManagement`'s load. There is no load
 *   and no comparator now, so there is nothing left to pin.
 */

import {act, render, screen, within} from '@testing-library/react';
import {createRef} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {SectionNavHandle} from '@/components/runs/SectionNavLayout';

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: null}})}},
}));

// Thin observers, so each assertion names exactly what a child received.
vi.mock('@/components/extraction/SectionAccordion', () => ({
  SectionAccordion: (props: any) => (
    <div
      data-testid={`section-${props.entityType.name}`}
      data-instance-ids={props.instances.map((i: any) => i.id).join(',')}
      data-parent-instance-id={props.parentInstanceId ?? ''}
      data-field-names={props.fields.map((f: any) => f.name).join(',')}
    />
  ),
}));

vi.mock('@/components/extraction/entries/EntrySection', () => ({
  EntrySection: (props: any) => (
    <div
      data-testid={`entry-section-${props.group.name}`}
      data-parent-instance-id={props.parentInstanceId ?? ''}
    />
  ),
}));

import {ExtractionFormView} from '@/components/extraction/ExtractionFormView';

const STUDY = {
  id: 'study-et',
  name: 'study_metadata',
  label: 'Study Metadata',
  cardinality: 'one',
  parent_entity_type_id: null,
  sort_order: 0,
  fields: [{id: 'f1', name: 'title', label: 'Title', field_type: 'text'}],
} as any;

const SECOND_STUDY = {
  ...STUDY,
  id: 'study2-et',
  name: 'participants',
  label: 'Participants',
  sort_order: 2,
};

const GROUP = {
  id: 'group-et',
  name: 'prediction_models',
  label: 'Prediction Models',
  cardinality: 'many',
  parent_entity_type_id: null,
  entry_label: 'model',
  sort_order: 1,
  fields: [],
} as any;

const CHILD = {
  ...STUDY,
  id: 'child-et',
  name: 'model_development',
  parent_entity_type_id: 'group-et',
  sort_order: 3,
};

function baseProps(overrides: Partial<any> = {}) {
  return {
    entityTypes: [],
    studyLevelSections: [],
    modelParentEntityType: undefined,
    modelChildSections: [],
    activeEntries: {},
    setActiveEntry: vi.fn(),
    handleOpenRenameDialog: vi.fn(),
    instances: [],
    values: {},
    updateValue: vi.fn(),
    aiSuggestions: {},
    acceptSuggestion: vi.fn(),
    selectSuggestion: vi.fn(),
    rejectSuggestion: vi.fn(),
    models: [],
    activeModelId: null,
    setActiveModelId: vi.fn(),
    onAddModel: vi.fn(),
    onRemoveModel: vi.fn(),
    onRefreshModels: vi.fn(async () => {}),
    onRefreshInstances: vi.fn(async () => {}),
    getInstancesForModel: vi.fn(() => []),
    handleAddInstance: vi.fn(),
    handleRemoveInstance: vi.fn(),
    projectId: 'p1',
    articleId: 'a1',
    templateId: 't1',
    modelsLoading: false,
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ExtractionFormView → root partitioning', () => {
  it('renders an accordion for each singleton root', () => {
    render(<ExtractionFormView {...baseProps({entityTypes: [STUDY, SECOND_STUDY]})} />);

    expect(screen.getByTestId('section-study_metadata')).toBeInTheDocument();
    expect(screen.getByTestId('section-participants')).toBeInTheDocument();
  });

  it('hands a repeating root to EntrySection, not to an accordion', () => {
    render(<ExtractionFormView {...baseProps({entityTypes: [STUDY, GROUP]})} />);

    // Positive AND negative: a component that rendered nothing for groups
    // would pass the negative on its own.
    expect(screen.getByTestId('entry-section-prediction_models')).toBeInTheDocument();
    expect(screen.queryByTestId('section-prediction_models')).not.toBeInTheDocument();
  });

  it('gives a root group a null parent', () => {
    render(<ExtractionFormView {...baseProps({entityTypes: [GROUP]})} />);

    expect(screen.getByTestId('entry-section-prediction_models')).toHaveAttribute(
      'data-parent-instance-id',
      '',
    );
  });

  it('never renders a nested section at the root', () => {
    // CHILD has a parent, so only its group may render it — as part of that
    // subtree, never here.
    render(<ExtractionFormView {...baseProps({entityTypes: [STUDY, GROUP, CHILD]})} />);

    expect(screen.queryByTestId('section-model_development')).not.toBeInTheDocument();
  });

  it("filters a singleton root's instances by entity type", () => {
    const instances = [
      {id: 'i1', entity_type_id: 'study-et', parent_instance_id: null},
      {id: 'i2', entity_type_id: 'other-et', parent_instance_id: null},
    ];
    render(<ExtractionFormView {...baseProps({entityTypes: [STUDY], instances})} />);

    expect(screen.getByTestId('section-study_metadata')).toHaveAttribute('data-instance-ids', 'i1');
  });

  it('renders roots in the order given', () => {
    const {container} = render(
      <ExtractionFormView {...baseProps({entityTypes: [STUDY, GROUP, SECOND_STUDY]})} />,
    );
    const ids = Array.from(container.querySelectorAll('[data-testid]'))
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => id?.startsWith('section-') || id?.startsWith('entry-section-'));

    expect(ids).toEqual([
      'section-study_metadata',
      'entry-section-prediction_models',
      'section-participants',
    ]);
  });
});

describe('ExtractionFormView → section nav rail', () => {
  it('renders a rail row per root section', () => {
    render(<ExtractionFormView {...baseProps({entityTypes: [STUDY, SECOND_STUDY]})} />);

    const rail = screen.getByRole('navigation');
    expect(within(rail).getByText('Study Metadata')).toBeInTheDocument();
    expect(within(rail).getByText('Participants')).toBeInTheDocument();
  });
});

describe('ExtractionFormView → section nav handle', () => {
  it("hands the page the layout's revealSection, which scrolls to the registered section", () => {
    // jsdom has no scrollIntoView; the section registry calls it on the wrapper.
    Element.prototype.scrollIntoView = vi.fn();
    const nav = createRef<SectionNavHandle>();
    render(<ExtractionFormView {...baseProps({entityTypes: [STUDY, SECOND_STUDY], sectionNavRef: nav})} />);
    expect(nav.current).not.toBeNull();

    act(() => nav.current?.revealSection('study2-et'));

    const wrapper = screen.getByTestId('section-participants').parentElement;
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts).toContain(wrapper);
  });
});
