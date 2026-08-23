import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
// The container has fields, so InstanceCard mounts field rows; the field
// editor itself is out of scope here.
vi.mock('@/components/extraction/FieldInput', () => ({
  default: () => <div data-testid="field-input" />,
}));

import { ModelSection } from '@/components/extraction/ModelSection';
import type {
  ExtractionEntityTypeWithFields,
  ExtractionInstance,
} from '@/types/extraction';

/**
 * The repeating group has exactly ONE management surface: the
 * ModelSelector (dedicated dialogs create the parent + singleton
 * children on the backend, and gate removal on the whole subtree's
 * data). Rendering the container through the generic SectionAccordion
 * used to add a second surface — an "Add {label}" button that created
 * nameless models with no singleton children, and a one-click trash
 * that deleted the active model without the subtree data check.
 *
 * Runs against the REAL copy module so the two add buttons resolve to
 * distinct accessible names ("Add Prediction Models" vs "Add Final
 * Predictors").
 */

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const containerType: ExtractionEntityTypeWithFields = {
  id: 'et-container',
  template_id: 't',
  name: 'prediction_models',
  label: 'Prediction Models',
  description: null,
  parent_entity_type_id: null,
  cardinality: 'many',
  role: 'model_container',
  sort_order: 0,
  is_required: false,
  entry_label: 'model',
  created_at: '',
  fields: [
    {
      id: 'f-model-name',
      entity_type_id: 'et-container',
      name: 'model_name',
      label: 'Model Name',
      description: null,
      field_type: 'text',
      is_required: true,
      validation_schema: null,
      allowed_values: null,
      unit: null,
      allowed_units: null,
      llm_description: null,
      sort_order: 0,
      created_at: '',
    },
  ],
};

const childType: ExtractionEntityTypeWithFields = {
  id: 'et-child',
  template_id: 't',
  name: 'final_predictors',
  label: 'Final Predictors',
  description: null,
  parent_entity_type_id: 'et-container',
  cardinality: 'many',
  role: 'model_section',
  sort_order: 1,
  is_required: false,
  entry_label: null,
  created_at: '',
  fields: [],
};

const modelInstance = {
  id: 'm1',
  project_id: 'p',
  article_id: 'a',
  template_id: 't',
  entity_type_id: 'et-container',
  parent_instance_id: null,
  label: 'Model A',
  sort_order: 0,
  metadata: {},
  created_by: 'u',
  created_at: '',
  updated_at: '',
} satisfies ExtractionInstance;

const childInstance = {
  ...modelInstance,
  id: 'fp1',
  entity_type_id: 'et-child',
  parent_instance_id: 'm1',
  label: 'Model A - Final Predictors 1',
} satisfies ExtractionInstance;

const instances = [modelInstance, childInstance];

type ModelSectionProps = Parameters<typeof ModelSection>[0];

function renderModelSection(overrides: Partial<ModelSectionProps> = {}) {
  return render(
    <ModelSection
      modelContainer={containerType}
      modelChildren={[childType]}
      instances={instances}
      activeModelId="m1"
      setActiveModelId={vi.fn()}
      models={[{ instanceId: 'm1', modelName: 'Model A' }]}
      modelsLoading={false}
      onAddModel={vi.fn()}
      onRemoveModel={vi.fn()}
      values={{}}
      updateValue={vi.fn()}
      aiSuggestions={{}}
      acceptSuggestion={vi.fn()}
      selectSuggestion={vi.fn()}
      rejectSuggestion={vi.fn()}
      getInstancesForModel={(entityTypeId, modelId) =>
        instances.filter(
          (i) => i.entity_type_id === entityTypeId && i.parent_instance_id === modelId,
        )
      }
      handleAddInstance={vi.fn()}
      handleRemoveInstance={vi.fn()}
      projectId="p"
      articleId="a"
      templateId="t"
      onExtractModels={vi.fn()}
      extractingModels={false}
      extractingAllSections={false}
      extractionProgress={null}
      onExtractAllSectionsForAllModels={vi.fn()}
      extractingAllSectionsForAllModels={false}
      allModelsProgress={null}
      {...overrides}
    />,
    { wrapper: Wrapper },
  );
}

describe('ModelSection container accordion', () => {
  it('offers no generic add-instance button for the container (models are added via the selector)', () => {
    renderModelSection();
    expect(
      screen.queryByRole('button', { name: 'Add Prediction Models' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the generic add-instance button on repeatable child sections', () => {
    renderModelSection();
    expect(
      screen.getByRole('button', { name: 'Add Final Predictors' }),
    ).toBeInTheDocument();
  });

  it('shows the total entry count on the container badge, not the active-only count', () => {
    renderModelSection({
      models: [
        { instanceId: 'm1', modelName: 'Model A' },
        { instanceId: 'm2', modelName: 'Model B' },
      ],
    });
    expect(screen.getByText('Multiple (2)')).toBeInTheDocument();
  });

  it('offers no per-card trash for the container instance (removal goes through the selector)', () => {
    renderModelSection();
    // Destructive-styled census: the ModelSelector's remove-active button
    // and the child InstanceCard's trash — and nothing else. A third one
    // is the container card's trash (deletes the model + subtree in one
    // click without the subtree data check).
    expect(document.querySelectorAll('button.text-destructive')).toHaveLength(2);
  });
});
