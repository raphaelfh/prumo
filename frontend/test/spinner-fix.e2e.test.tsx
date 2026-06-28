/**
 * END-TO-END regressions for the stuck AI-action spinner.
 *
 * The bug: accepting an AI suggestion left the accept spinner spinning forever.
 * Root cause: ExtractionFormView's memo comparator omitted `isActionLoading`,
 * so the post-click `clearLoading` re-render was swallowed before it reached
 * FieldInput. (FieldInput's own comparator already handled it — the gate above
 * it did not.)
 *
 * Each test renders the REAL component chain with the REAL `useAISuggestions`
 * hook (so the real `clearLoading` microtask runs), clicks the REAL accept /
 * reject button, and asserts the spinner clears (`Loader2` -> `Check`) instead
 * of sticking. Only network / extraction side-effects are mocked.
 *
 * Render paths covered:
 *  - extraction, study-level:  ExtractionFormView(memo gate) -> SectionAccordion -> InstanceCard -> FieldInput
 *  - extraction, model-child:  ExtractionFormView(memo gate) -> ModelSection -> SectionAccordion -> FieldInput
 *  - quality assessment:       QASectionAccordion -> FieldInput
 *
 * NOTE on the QA path: it bypasses ExtractionFormView entirely, so the fix under
 * test is NOT on its render path — it is protected by FieldInput's own
 * comparator (QASectionAccordion is unmemoized). The QA case is pinned here to
 * guard that independently. Reverting the ExtractionFormView fix turns the two
 * extraction cases red while the QA case stays green — which is the proof the
 * fix is specific to the extraction gate.
 */

import { useState, type ReactElement } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AISuggestion } from '@/types/ai-extraction';

// Reconfigured per test (each render path keys its suggestion differently).
const { loadSuggestionsMock } = vi.hoisted(() => ({ loadSuggestionsMock: vi.fn() }));

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/hooks/extraction/useJustUpdatedValue', () => ({ useJustUpdatedValue: () => false }));

// ExtractionFormView / SectionAccordion side-effect hooks — no-ops in tests.
vi.mock('@/hooks/extraction/useModelExtraction', () => ({
  useModelExtraction: () => ({ extractModels: vi.fn(), loading: false }),
}));
vi.mock('@/hooks/extraction/useBatchSectionExtractionChunked', () => ({
  useBatchSectionExtractionChunked: () => ({ extractAllSections: vi.fn(), loading: false, progress: null }),
}));
vi.mock('@/hooks/extraction/useBatchAllModelsSectionsExtraction', () => ({
  useBatchAllModelsSectionsExtraction: () => ({ extractAllSectionsForAllModels: vi.fn(), loading: false, progress: null }),
}));
vi.mock('@/hooks/extraction/useSectionExtraction', () => ({
  useSectionExtraction: () => ({ extractSection: vi.fn(), loading: false, error: null }),
}));

// Services the tree imports at module load. Stubbed so nothing hits the network
// (and so the Supabase client doesn't throw on missing env vars).
vi.mock('@/services/extractionInstanceService', () => ({
  updateInstanceLabel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/authService', () => ({
  getRequiredUserId: vi.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
}));
vi.mock('@/integrations/supabase/client', () => {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (cb: (r: { data: never[]; error: null }) => unknown) =>
      Promise.resolve(cb({ data: [], error: null })),
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      from: () => builder,
    },
  };
});
vi.mock('@/services/aiSuggestionService', () => ({
  AISuggestionService: {
    getArticleInstanceIds: vi.fn().mockResolvedValue([]),
    loadSuggestions: loadSuggestionsMock,
    getHistory: vi.fn().mockResolvedValue([]),
  },
}));

import { useAISuggestions } from '@/hooks/extraction/ai/useAISuggestions';
import { ExtractionFormView } from '@/components/extraction/ExtractionFormView';
import { QASectionAccordion } from '@/components/assessment/QASectionAccordion';
import { TooltipProvider } from '@/components/ui/tooltip';

// =================== shared helpers ===================

function makeSuggestion(overrides: Partial<AISuggestion> = {}): AISuggestion {
  return {
    id: 'sugg-1',
    runId: 'r',
    value: 'Consecutive patients',
    confidence: 0.9,
    reasoning: '',
    status: 'pending',
    timestamp: new Date('2020-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Make the mocked loader return one pending suggestion at `key`. */
function stubSuggestion(key: string, value: string): void {
  loadSuggestionsMock.mockResolvedValue({
    suggestions: { [key]: makeSuggestion({ id: `sugg-${key}`, value }) },
    count: 1,
  });
}

// AISuggestionActions renders the accept/reject controls with these classes;
// centralized here so a styling change touches one place, not five tests.
const acceptButton = (c: HTMLElement) => c.querySelector('button.text-success') as HTMLElement | null;
const rejectButton = (c: HTMLElement) => c.querySelector('button.text-destructive') as HTMLElement | null;
const spinner = (c: HTMLElement) => c.querySelector('.animate-spin');
const acceptedRing = (c: HTMLElement) => c.querySelector('button.ring-success');
const rejectedRing = (c: HTMLElement) => c.querySelector('button.ring-destructive');

const renderHarness = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

/** Radix Accordion can render collapsed in jsdom even with defaultOpen. */
function expandRadixIfClosed(container: HTMLElement): void {
  if (!container.querySelector('[data-state="closed"][role="region"]')) return;
  const trigger = container.querySelector('button[aria-expanded="false"]') as HTMLElement | null;
  if (trigger) fireEvent.click(trigger);
}

/** Page-level form-state store; onSuggestion* callbacks write through it. */
function useFormValues() {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const fill = (instanceId: string, fieldId: string, value: unknown) => {
    const key = `${instanceId}_${fieldId}`;
    setValues((prev) => ({ ...prev, [key]: value }));
  };
  return { values, fill };
}

// =================== fixtures ===================

const STUDY_SECTION = {
  id: 'study-et',
  name: 'study_metadata',
  label: 'Participants',
  cardinality: 'one',
  parent_entity_type_id: null,
  fields: [
    { id: 'f-doi', name: 'recruitment_method', label: 'Recruitment Method', field_type: 'text', is_required: true, entity_type_id: 'study-et' },
  ],
} as any;

const MODEL_PARENT = {
  id: 'pred-et',
  name: 'prediction_models',
  label: 'Prediction Models',
  cardinality: 'many',
  parent_entity_type_id: null,
  fields: [
    { id: 'f-name', name: 'model_name', label: 'Model Name', field_type: 'text', is_required: true, entity_type_id: 'pred-et' },
  ],
} as any;

const CHILD_SECTION = {
  id: 'sd-et',
  name: 'source_of_data',
  label: 'Source of Data',
  cardinality: 'one',
  parent_entity_type_id: 'pred-et',
  fields: [
    { id: 'f-source', name: 'source', label: 'Source', field_type: 'text', is_required: true, entity_type_id: 'sd-et' },
  ],
} as any;

const MODEL_INSTANCE = { id: 'model-1', entity_type_id: 'pred-et', label: 'Logistic' } as any;
const CHILD_INSTANCE = { id: 'child-inst', entity_type_id: 'sd-et', parent_instance_id: 'model-1', label: 'Source' } as any;

const QA_DOMAIN = {
  entityType: {
    id: 'qa-dom',
    template_id: 't',
    name: 'qa_domain_one',
    label: 'Patient Selection',
    description: null,
    parent_entity_type_id: null,
    cardinality: 'one',
    role: 'study_section',
    sort_order: 0,
    is_required: true,
    created_at: '2020-01-01T00:00:00Z',
  },
  // A signaling field (name not in the summary set) so the accordion renders it
  // as a FieldInput row carrying the AI accept/reject controls.
  fields: [
    { id: 'f-doi', entity_type_id: 'qa-dom', name: 'signaling_q1', label: 'Was a consecutive sample enrolled?', description: null, field_type: 'text', is_required: true, validation_schema: null, allowed_values: null, unit: null, allowed_units: null, llm_description: null, sort_order: 0, created_at: '2020-01-01T00:00:00Z' },
  ],
} as any;

// =================== harnesses ===================

// The ~15 structural props ExtractionFormView needs but the spinner tests don't
// vary. Data + hook wiring is layered on top per scenario.
function baseExtractionProps() {
  return {
    studyLevelSections: [],
    modelParentEntityType: undefined,
    modelChildSections: [],
    instances: [],
    models: [],
    activeModelId: null,
    setActiveModelId: vi.fn(),
    onAddModel: vi.fn(),
    onRemoveModel: vi.fn(),
    onRefreshModels: vi.fn().mockResolvedValue(undefined),
    onRefreshInstances: vi.fn().mockResolvedValue(undefined),
    getInstancesForModel: () => [],
    handleAddInstance: vi.fn(),
    handleRemoveInstance: vi.fn(),
    projectId: 'p',
    articleId: 'a',
    templateId: 't',
    runId: 'r',
    modelsLoading: false,
  };
}

interface ExtractionHarnessConfig {
  studyLevelSections?: unknown[];
  modelParentEntityType?: unknown;
  modelChildSections?: unknown[];
  instances: unknown[];
  instanceIds: string[];
  activeModelId?: string | null;
  models?: { instanceId: string; modelName: string }[];
  getInstancesForModel?: (entityTypeId: string, modelId: string) => unknown[];
}

function ExtractionHarness(cfg: ExtractionHarnessConfig) {
  const { values, fill } = useFormValues();
  const hook = useAISuggestions({
    articleId: 'a',
    projectId: 'p',
    enabled: true,
    runId: 'r',
    instanceIds: cfg.instanceIds,
    acceptStrategy: 'human-proposal',
    onSuggestionAccepted: (i, f, v) => fill(i, f, v),
    onSuggestionRejected: (i, f) => fill(i, f, null),
  });

  return (
    <ExtractionFormView
      {...(baseExtractionProps() as any)}
      studyLevelSections={(cfg.studyLevelSections ?? []) as any}
      modelParentEntityType={cfg.modelParentEntityType as any}
      modelChildSections={(cfg.modelChildSections ?? []) as any}
      instances={cfg.instances as any}
      activeModelId={cfg.activeModelId ?? null}
      models={cfg.models ?? []}
      getInstancesForModel={(cfg.getInstancesForModel ?? (() => [])) as any}
      values={values as any}
      updateValue={fill}
      aiSuggestions={hook.suggestions}
      acceptSuggestion={hook.acceptSuggestion}
      rejectSuggestion={hook.rejectSuggestion}
      getSuggestionsHistory={hook.getSuggestionsHistory}
      isActionLoading={hook.isActionLoading}
    />
  );
}

function QAHarness() {
  const { values, fill } = useFormValues();
  const hook = useAISuggestions({
    articleId: 'a',
    projectId: 'p',
    enabled: true,
    runId: 'r',
    instanceIds: ['inst-1'],
    acceptStrategy: 'human-proposal',
    onSuggestionAccepted: (i, f, v) => fill(i, f, v),
    onSuggestionRejected: (i, f) => fill(i, f, null),
  });

  // QA page keys the per-domain values map by FIELD id (see
  // QualityAssessmentFullScreen `valuesForDomain`); mirror that shape.
  const fieldId: string = QA_DOMAIN.fields[0].id;
  const coordKey = `inst-1_${fieldId}`;
  const valuesForDomain: Record<string, unknown> = {};
  if (coordKey in values) valuesForDomain[fieldId] = values[coordKey];

  return (
    <QASectionAccordion
      domain={QA_DOMAIN}
      values={valuesForDomain}
      onValueChange={(fid, value) => fill('inst-1', fid, value)}
      projectId="p"
      articleId="a"
      templateId="t"
      defaultOpen
      instanceId="inst-1"
      aiSuggestions={hook.suggestions}
      onAcceptAI={hook.acceptSuggestion}
      onRejectAI={hook.rejectSuggestion}
      getSuggestionsHistory={hook.getSuggestionsHistory}
      isAIActionLoading={hook.isActionLoading}
    />
  );
}

// =================== tests ===================

beforeEach(() => loadSuggestionsMock.mockReset());

describe('AI-action spinner — extraction study-level path', () => {
  type Case = [
    label: 'accept' | 'reject',
    getButton: (c: HTMLElement) => HTMLElement | null,
    getRing: (c: HTMLElement) => Element | null,
  ];
  const cases: Case[] = [
    ['accept', acceptButton, acceptedRing],
    ['reject', rejectButton, rejectedRing],
  ];

  it.each(cases)('clears the spinner after %s (real tree + real hook)', async (_label, getButton, getRing) => {
    stubSuggestion('inst-1_f-doi', 'Consecutive patients');
    const { container } = renderHarness(
      <ExtractionHarness
        studyLevelSections={[STUDY_SECTION]}
        instances={[{ id: 'inst-1', entity_type_id: 'study-et', label: 'Study' }]}
        instanceIds={['inst-1']}
      />,
    );

    await waitFor(() => expect(getButton(container)).toBeTruthy());
    expect(screen.getByText('Consecutive patients')).toBeInTheDocument();
    expect(spinner(container)).toBeNull();

    fireEvent.click(getButton(container)!);

    // Under the bug the ExtractionFormView memo swallowed the post-click
    // clearLoading and `.animate-spin` stuck forever.
    await waitFor(() => expect(spinner(container)).toBeNull());
    // The action registered (ring appears) — proves FieldInput re-rendered,
    // not just that the spinner never showed.
    await waitFor(() => expect(getRing(container)).toBeTruthy());
  });
});

describe('AI-accept spinner — extraction model-child path', () => {
  it('clears the spinner after accepting a child-field suggestion', async () => {
    stubSuggestion('child-inst_f-source', 'Registry');
    const { container } = renderHarness(
      <ExtractionHarness
        modelParentEntityType={MODEL_PARENT}
        modelChildSections={[CHILD_SECTION]}
        instances={[MODEL_INSTANCE, CHILD_INSTANCE]}
        instanceIds={['child-inst']}
        activeModelId="model-1"
        models={[{ instanceId: 'model-1', modelName: 'Logistic' }]}
        getInstancesForModel={(e, m) => (e === 'sd-et' && m === 'model-1' ? [CHILD_INSTANCE] : [])}
      />,
    );

    await waitFor(() => expect(acceptButton(container)).toBeTruthy());
    expect(screen.getByText('Registry')).toBeInTheDocument();
    expect(spinner(container)).toBeNull();

    fireEvent.click(acceptButton(container)!);

    await waitFor(() => expect(spinner(container)).toBeNull());
    await waitFor(() => expect(acceptedRing(container)).toBeTruthy());
  });
});

describe('AI-accept spinner — quality-assessment path', () => {
  // QASectionAccordion bypasses ExtractionFormView, so the gate fix is not on
  // this path; it is protected by FieldInput's comparator and pinned here
  // independently (stays green even with the ExtractionFormView fix reverted).
  it('clears the spinner after accepting (QASectionAccordion + real hook)', async () => {
    stubSuggestion('inst-1_f-doi', 'Consecutive patients');
    const { container } = renderHarness(<QAHarness />);

    await waitFor(() => {
      expandRadixIfClosed(container);
      expect(acceptButton(container)).toBeTruthy();
    });
    expect(screen.getByText('Consecutive patients')).toBeInTheDocument();
    expect(spinner(container)).toBeNull();

    fireEvent.click(acceptButton(container)!);

    await waitFor(() => expect(spinner(container)).toBeNull());
    await waitFor(() => expect(acceptedRing(container)).toBeTruthy());
  });
});
