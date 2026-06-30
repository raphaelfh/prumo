/**
 * Render-contract tests for ``ExtractionFormView``.
 *
 * Pins the BUG #7 fix: the parent prediction_models entity_type's own
 * fields are rendered when a model is active. Before the fix the form
 * iterated only ``studyLevelSections`` (root entities ≠ prediction_models)
 * and ``modelChildSections`` (children of prediction_models), so any
 * field attached to the parent itself — including the CHARMS defaults
 * ``model_name`` and ``modelling_method`` — silently disappeared from the
 * UI. These specs lock the contract per slice.
 */

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

vi.mock('@/hooks/extraction/useModelExtraction', () => ({
  useModelExtraction: () => ({ extractModels: vi.fn(), loading: false }),
}));

vi.mock('@/hooks/extraction/useBatchSectionExtractionChunked', () => ({
  useBatchSectionExtractionChunked: () => ({
    extractAllSections: vi.fn(),
    loading: false,
    progress: null,
  }),
}));

vi.mock('@/hooks/extraction/useBatchAllModelsSectionsExtraction', () => ({
  useBatchAllModelsSectionsExtraction: () => ({
    extractAllSectionsForAllModels: vi.fn(),
    loading: false,
    progress: null,
  }),
}));

// SectionAccordion is the component-under-render; mock it to a thin
// observer so we can assert exactly which entity_type / instances / fields
// each accordion got.
vi.mock('@/components/extraction/SectionAccordion', () => ({
  SectionAccordion: (props: any) => (
    <div
      data-testid={`section-${props.entityType.name}`}
      data-instance-ids={props.instances.map((i: any) => i.id).join(',')}
      data-parent-instance-id={props.parentInstanceId ?? ''}
      data-field-names={props.fields.map((f: any) => f.name).join(',')}
      // Surfaces the loading signal that reaches the accordion. When the memo
      // bails out, this child is NOT re-rendered, so the attribute keeps its
      // stale value — exactly the stuck-spinner symptom.
      data-ai-loading={String(
        props.isActionLoading?.(props.instances[0]?.id, props.fields[0]?.id) ?? null,
      )}
    />
  ),
}));

vi.mock('@/components/extraction/hierarchy/ModelSelector', () => ({
  ModelSelector: () => <div data-testid="model-selector" />,
}));

vi.mock('@/components/extraction/BatchExtractionProgress', () => ({
  BatchExtractionProgress: () => null,
}));

vi.mock('@/components/extraction/BatchAllModelsSectionsProgress', () => ({
  BatchAllModelsSectionsProgress: () => null,
}));

vi.mock('@/components/ui/separator', () => ({
  Separator: () => <hr />,
}));

vi.mock('@/hooks/extraction/useActiveSection', () => ({
  useActiveSection: () => ({ activeId: null, registerSection: vi.fn(), scrollToSection: vi.fn() }),
  pickMostVisible: vi.fn(),
}));

vi.mock('@/components/extraction/SectionNavRail', () => ({
  default: (props: any) => (
    <nav aria-label="sectionNavAria" className={props.collapsed ? 'w-11' : ''}>
      {props.items.map((item: any) => (
        <button key={item.id} type="button" onClick={() => props.onSelect(item.id)}>
          {!props.collapsed && item.label}
        </button>
      ))}
    </nav>
  ),
}));

import { ExtractionFormView } from '@/components/extraction/ExtractionFormView';

const MODEL_PARENT = {
  id: 'pred-et',
  name: 'prediction_models',
  label: 'Prediction Models',
  cardinality: 'many',
  parent_entity_type_id: null,
  fields: [
    {
      id: 'f-name',
      name: 'model_name',
      label: 'Model Name',
      field_type: 'text',
      is_required: true,
      entity_type_id: 'pred-et',
    },
    {
      id: 'f-method',
      name: 'modelling_method',
      label: 'Modelling Method',
      field_type: 'select',
      is_required: true,
      entity_type_id: 'pred-et',
    },
  ],
} as any;

const CHILD_SECTION = {
  id: 'sd-et',
  name: 'source_of_data',
  label: 'Source of Data',
  cardinality: 'one',
  parent_entity_type_id: 'pred-et',
  fields: [
    {
      id: 'f-source',
      name: 'source',
      label: 'Source',
      field_type: 'select',
      is_required: true,
      entity_type_id: 'sd-et',
    },
  ],
} as any;

const STUDY_SECTION = {
  id: 'study-et',
  name: 'study_metadata',
  label: 'Study Metadata',
  cardinality: 'one',
  parent_entity_type_id: null,
  fields: [
    {
      id: 'f-doi',
      name: 'doi',
      label: 'DOI',
      field_type: 'text',
      is_required: false,
      entity_type_id: 'study-et',
    },
  ],
} as any;

function baseProps(overrides: Partial<any> = {}) {
  return {
    studyLevelSections: [],
    modelParentEntityType: undefined,
    modelChildSections: [],
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
    onRefreshModels: vi.fn().mockResolvedValue(undefined),
    onRefreshInstances: vi.fn().mockResolvedValue(undefined),
    getInstancesForModel: vi.fn(() => []),
    handleAddInstance: vi.fn(),
    handleRemoveInstance: vi.fn(),
    projectId: 'p',
    articleId: 'a',
    templateId: 't',
    modelsLoading: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ExtractionFormView → study-level sections', () => {
  it('renders one accordion per study-level section', () => {
    render(
      <ExtractionFormView
        {...baseProps({ studyLevelSections: [STUDY_SECTION] })}
      />,
    );
    expect(screen.getByTestId('section-study_metadata')).toBeInTheDocument();
  });

  it('does not render the model selector when modelParentEntityType is absent', () => {
    render(
      <ExtractionFormView
        {...baseProps({ studyLevelSections: [STUDY_SECTION] })}
      />,
    );
    expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument();
  });

  it('filters study instances by entity_type_id', () => {
    const instances = [
      { id: 'inst-1', entity_type_id: 'study-et', label: 'A' },
      { id: 'inst-2', entity_type_id: 'other-et', label: 'B' },
    ] as any[];
    render(
      <ExtractionFormView
        {...baseProps({ studyLevelSections: [STUDY_SECTION], instances })}
      />,
    );
    const sec = screen.getByTestId('section-study_metadata');
    expect(sec.getAttribute('data-instance-ids')).toBe('inst-1');
  });
});

describe('ExtractionFormView → model parent (BUG #7 regression)', () => {
  it('renders an accordion for the parent prediction_models when active model is set', () => {
    const instances = [
      { id: 'model-1', entity_type_id: 'pred-et', label: 'Logistic' },
    ] as any[];
    render(
      <ExtractionFormView
        {...baseProps({
          modelParentEntityType: MODEL_PARENT,
          instances,
          activeModelId: 'model-1',
          models: [{ instanceId: 'model-1', modelName: 'Logistic' }],
        })}
      />,
    );
    expect(screen.getByTestId('section-prediction_models')).toBeInTheDocument();
  });

  it('passes the parent fields (model_name, modelling_method) to the accordion', () => {
    const instances = [
      { id: 'model-1', entity_type_id: 'pred-et', label: 'Logistic' },
    ] as any[];
    render(
      <ExtractionFormView
        {...baseProps({
          modelParentEntityType: MODEL_PARENT,
          instances,
          activeModelId: 'model-1',
          models: [{ instanceId: 'model-1', modelName: 'Logistic' }],
        })}
      />,
    );
    const fields = screen
      .getByTestId('section-prediction_models')
      .getAttribute('data-field-names');
    expect(fields).toBe('model_name,modelling_method');
  });

  it('binds the parent accordion to the active model instance', () => {
    const instances = [
      { id: 'model-1', entity_type_id: 'pred-et', label: 'Logistic' },
      { id: 'model-2', entity_type_id: 'pred-et', label: 'XGBoost' },
    ] as any[];
    render(
      <ExtractionFormView
        {...baseProps({
          modelParentEntityType: MODEL_PARENT,
          instances,
          activeModelId: 'model-2',
          models: [
            { instanceId: 'model-1', modelName: 'Logistic' },
            { instanceId: 'model-2', modelName: 'XGBoost' },
          ],
        })}
      />,
    );
    const ids = screen
      .getByTestId('section-prediction_models')
      .getAttribute('data-instance-ids');
    expect(ids).toBe('model-2');
  });

  it('does not render the parent accordion when modelParentEntityType has no fields', () => {
    const emptyParent = { ...MODEL_PARENT, fields: [] };
    render(
      <ExtractionFormView
        {...baseProps({
          modelParentEntityType: emptyParent,
          instances: [{ id: 'model-1', entity_type_id: 'pred-et', label: 'L' }],
          activeModelId: 'model-1',
          models: [{ instanceId: 'model-1', modelName: 'L' }],
        })}
      />,
    );
    expect(screen.queryByTestId('section-prediction_models')).not.toBeInTheDocument();
  });

  it('does not render the parent accordion when there is no active model', () => {
    render(
      <ExtractionFormView
        {...baseProps({
          modelParentEntityType: MODEL_PARENT,
          activeModelId: null,
          models: [],
          instances: [],
        })}
      />,
    );
    expect(screen.queryByTestId('section-prediction_models')).not.toBeInTheDocument();
  });
});

describe('ExtractionFormView → model child sections', () => {
  it('renders one accordion per child section under the active model', () => {
    const instances = [
      { id: 'model-1', entity_type_id: 'pred-et', label: 'L' },
      { id: 'sd-inst', entity_type_id: 'sd-et', parent_instance_id: 'model-1' },
    ] as any[];
    const getInstancesForModel = vi.fn(() => [instances[1]]);
    render(
      <ExtractionFormView
        {...baseProps({
          modelParentEntityType: MODEL_PARENT,
          modelChildSections: [CHILD_SECTION],
          instances,
          activeModelId: 'model-1',
          models: [{ instanceId: 'model-1', modelName: 'L' }],
          getInstancesForModel,
        })}
      />,
    );
    expect(screen.getByTestId('section-source_of_data')).toBeInTheDocument();
    expect(getInstancesForModel).toHaveBeenCalledWith('sd-et', 'model-1');
  });

  it('passes the active model id as parentInstanceId to each child accordion', () => {
    const instances = [
      { id: 'model-1', entity_type_id: 'pred-et', label: 'L' },
    ] as any[];
    render(
      <ExtractionFormView
        {...baseProps({
          modelParentEntityType: MODEL_PARENT,
          modelChildSections: [CHILD_SECTION],
          instances,
          activeModelId: 'model-1',
          models: [{ instanceId: 'model-1', modelName: 'L' }],
        })}
      />,
    );
    const parentAttr = screen
      .getByTestId('section-source_of_data')
      .getAttribute('data-parent-instance-id');
    expect(parentAttr).toBe('model-1');
  });

  it('does not render child sections when there is no active model', () => {
    render(
      <ExtractionFormView
        {...baseProps({
          modelParentEntityType: MODEL_PARENT,
          modelChildSections: [CHILD_SECTION],
          activeModelId: null,
          models: [],
        })}
      />,
    );
    expect(screen.queryByTestId('section-source_of_data')).not.toBeInTheDocument();
  });

  it('still shows the model selector with no active model so the user can add one', () => {
    render(
      <ExtractionFormView
        {...baseProps({
          modelParentEntityType: MODEL_PARENT,
          activeModelId: null,
          models: [],
        })}
      />,
    );
    expect(screen.getByTestId('model-selector')).toBeInTheDocument();
  });
});

describe('ExtractionFormView memo comparator — accept spinner propagation', () => {
  // Regression for the stuck AI-accept spinner. After an accept resolves,
  // `clearLoading` flips `isActionLoading` true → false while every other prop
  // (values, instances, aiSuggestions, sections, models) keeps its reference.
  // If the comparator ignores `isActionLoading`, the memo bails out, the child
  // accordion (and the FieldInput below it) is never reconciled, and the spinner
  // spins forever. FieldInput's OWN comparator can't help — it never runs
  // because this parent gate swallows the update first.
  it('re-renders children when only isActionLoading clears (no other prop change)', () => {
    const instances = [
      { id: 'study-inst', entity_type_id: 'study-et', label: 'Study' },
    ] as any[];
    // Stable shared refs: the ONLY thing that differs between the two renders
    // is the isActionLoading closure, mirroring clearLoading after an accept.
    const stable = baseProps({
      studyLevelSections: [STUDY_SECTION],
      instances,
      aiSuggestions: {
        'study-inst_f-doi': {
          id: 's1',
          status: 'pending',
          value: 'x',
          confidence: 0.9,
        },
      },
    });

    const { rerender } = render(
      <ExtractionFormView {...stable} isActionLoading={() => 'accept'} />,
    );
    expect(
      screen.getByTestId('section-study_metadata').getAttribute('data-ai-loading'),
    ).toBe('accept');

    rerender(<ExtractionFormView {...stable} isActionLoading={() => null} />);

    expect(
      screen.getByTestId('section-study_metadata').getAttribute('data-ai-loading'),
    ).toBe('null');
  });
});

describe('ExtractionFormView → combined render order', () => {
  it('renders study-level → model-parent → model-child for a full CHARMS shape', () => {
    const instances = [
      { id: 'study-inst', entity_type_id: 'study-et', label: 'Study' },
      { id: 'model-1', entity_type_id: 'pred-et', label: 'L' },
    ] as any[];
    render(
      <ExtractionFormView
        {...baseProps({
          studyLevelSections: [STUDY_SECTION],
          modelParentEntityType: MODEL_PARENT,
          modelChildSections: [CHILD_SECTION],
          instances,
          activeModelId: 'model-1',
          models: [{ instanceId: 'model-1', modelName: 'L' }],
        })}
      />,
    );
    expect(screen.getByTestId('section-study_metadata')).toBeInTheDocument();
    expect(screen.getByTestId('section-prediction_models')).toBeInTheDocument();
    expect(screen.getByTestId('section-source_of_data')).toBeInTheDocument();
  });
});

function renderFormView(overrides: Partial<any> = {}) {
  return render(
    <ExtractionFormView
      {...baseProps({ studyLevelSections: [STUDY_SECTION], ...overrides })}
    />,
  );
}

describe('ExtractionFormView → section nav rail', () => {
  it('renders a section nav rail with a row per study section', () => {
    renderFormView();
    const nav = screen.getByRole('navigation', { name: 'sectionNavAria' });
    expect(within(nav).getAllByRole('button').length).toBeGreaterThan(0);
  });
});

describe('ExtractionFormView → showPDF collapses the section rail', () => {
  it('shows section labels when showPDF=false and hides them when rerendered with showPDF=true', () => {
    // Use STABLE object references for every prop the comparator checks so the
    // ONLY change between the two renders is showPDF.  If the comparator omits
    // showPDF it returns true (skip), the rail never gets the new prop, and the
    // label stays visible — failing the second assertion.
    const stableSections = [STUDY_SECTION];
    const stableInstances: any[] = [];
    const stableValues = {};
    const stableModels: any[] = [];
    const stableAiSuggestions = {};
    const stableHandlers = {
      updateValue: vi.fn(),
      acceptSuggestion: vi.fn(),
      selectSuggestion: vi.fn(),
      rejectSuggestion: vi.fn(),
      setActiveModelId: vi.fn(),
      onAddModel: vi.fn(),
      onRemoveModel: vi.fn(),
      onRefreshModels: vi.fn().mockResolvedValue(undefined),
      onRefreshInstances: vi.fn().mockResolvedValue(undefined),
      getInstancesForModel: vi.fn(() => [] as any[]),
      handleAddInstance: vi.fn(),
      handleRemoveInstance: vi.fn(),
    };

    const sharedProps = {
      studyLevelSections: stableSections,
      modelParentEntityType: undefined as any,
      modelChildSections: stableModels,
      instances: stableInstances,
      values: stableValues,
      aiSuggestions: stableAiSuggestions,
      models: stableModels,
      activeModelId: null as string | null,
      projectId: 'p',
      articleId: 'a',
      templateId: 't',
      modelsLoading: false,
      ...stableHandlers,
    };

    const { rerender } = render(
      <ExtractionFormView {...sharedProps} showPDF={false} />,
    );

    // Expanded: the section label text is visible inside the nav
    const nav = screen.getByRole('navigation', { name: 'sectionNavAria' });
    expect(within(nav).getByText(STUDY_SECTION.label)).toBeInTheDocument();
    expect(nav).not.toHaveClass('w-11');

    // Rerender with showPDF=true — all other prop references are identical so
    // the comparator's existing terms all return true.  Without the showPDF
    // term the comparator returns true (bail), the rail never collapses, and
    // the label text remains visible → test fails RED.  After the fix the
    // comparator correctly returns false → re-render → rail collapses.
    rerender(<ExtractionFormView {...sharedProps} showPDF={true} />);

    expect(within(nav).queryByText(STUDY_SECTION.label)).not.toBeInTheDocument();
    expect(nav).toHaveClass('w-11');
  });
});
