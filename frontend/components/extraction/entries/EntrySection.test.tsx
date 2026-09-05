/**
 * EntrySection — recursion, and the compiler hazard it could hide.
 *
 * The fixture mirrors CHARMS: `prediction_models` owns children (selector
 * branch) and recurses into `final_predictors`, which owns none (card
 * branch). A nested group that itself owns children is unrepresentable until
 * migration 0069, so nothing here fabricates one.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {EntryFormProvider, type EntryFormContextValue} from './EntryFormContext';
import {EntrySection} from './EntrySection';
import type {ExtractionEntityTypeWithFields, ExtractionInstance} from '@/types/extraction';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: null}})}},
}));

function et(over: Record<string, unknown>): ExtractionEntityTypeWithFields {
  return {
    id: 'x',
    name: 'x',
    label: 'X',
    cardinality: 'one',
    parent_entity_type_id: null,
    entry_label: null,
    sort_order: 0,
    fields: [],
    ...over,
  } as unknown as ExtractionEntityTypeWithFields;
}

const GROUP = et({
  id: 'et-models',
  name: 'prediction_models',
  label: 'Prediction Models',
  cardinality: 'many',
  entry_label: 'model',
});
const DEV = et({id: 'et-dev', name: 'model_development', label: 'Model Development', parent_entity_type_id: 'et-models'});
const PREDICTORS = et({
  id: 'et-pred',
  name: 'final_predictors',
  label: 'Final Predictors',
  cardinality: 'many',
  entry_label: 'predictor',
  parent_entity_type_id: 'et-models',
});

function inst(id: string, etId: string, parent: string | null, label: string): ExtractionInstance {
  return {
    id,
    entity_type_id: etId,
    parent_instance_id: parent,
    label,
    sort_order: 0,
  } as unknown as ExtractionInstance;
}

// Two models with DIFFERENT, non-empty predictor sets. Equal or empty sets
// would let "switching the model switches the predictors" pass trivially.
const INSTANCES = [
  inst('m-a', 'et-models', null, 'Cox Model'),
  inst('m-b', 'et-models', null, 'XGBoost'),
  inst('d-a', 'et-dev', 'm-a', 'Cox dev'),
  inst('d-b', 'et-dev', 'm-b', 'XGB dev'),
  inst('p-a', 'et-pred', 'm-a', 'Age'),
  inst('p-b', 'et-pred', 'm-b', 'Smoking'),
];

function ctx(over: Partial<EntryFormContextValue> = {}): EntryFormContextValue {
  return {
    projectId: 'p1',
    articleId: 'a1',
    templateId: 't1',
    entityTypes: [GROUP, DEV, PREDICTORS],
    instances: INSTANCES,
    values: {},
    updateValue: vi.fn(),
    aiSuggestions: {},
    acceptSuggestion: vi.fn(),
    rejectSuggestion: vi.fn(),
    selectSuggestion: vi.fn(),
    onAddEntry: vi.fn(),
    onRemoveInstance: vi.fn(),
    onRenameInstance: vi.fn(),
    ...over,
  } as EntryFormContextValue;
}

/** SectionAccordion reaches TanStack Query, so every render needs a client. */
function wrap(value: EntryFormContextValue) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return (
    <QueryClientProvider client={client}>
      <EntryFormProvider value={value}>
        <EntrySection group={GROUP} parentInstanceId={null} />
      </EntryFormProvider>
    </QueryClientProvider>
  );
}

function renderSection(over: Partial<EntryFormContextValue> = {}) {
  return render(wrap(ctx(over)));
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* storage may be blocked */
  }
});

describe('EntrySection — branches', () => {
  it('a group that owns children renders a selector', () => {
    renderSection();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      expect.stringContaining('Cox Model'),
      expect.stringContaining('XGBoost'),
    ]);
  });

  it('recurses into a nested group, which renders cards rather than a selector', () => {
    renderSection();

    // The nested section is present (positive assertion — the absence of a
    // selector alone would also pass on a component that rendered nothing).
    expect(screen.getByText('Final Predictors')).toBeInTheDocument();
    // Exactly one tablist: the outer group's. The nested group owns no
    // children, so it takes the card branch.
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
  });

  it('switching the outer entry switches the nested subtree', async () => {
    renderSection();

    expect(screen.getByText('Age')).toBeInTheDocument();
    expect(screen.queryByText('Smoking')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', {name: /XGBoost/}));

    expect(screen.getByText('Smoking')).toBeInTheDocument();
    expect(screen.queryByText('Age')).not.toBeInTheDocument();
  });

  it('adds a nested entry under the ACTIVE parent, not the first one', async () => {
    const onAddEntry = vi.fn();
    renderSection({onAddEntry});

    await userEvent.click(screen.getByRole('tab', {name: /XGBoost/}));
    const nested = screen.getByText('Final Predictors').closest('[class*="scroll-mt-4"]');
    await userEvent.click(within(nested as HTMLElement).getByRole('button', {name: /add/i}));

    // The old `useAddEntry` resolved the parent as "the first instance of the
    // parent type", so this would have been 'm-a'.
    expect(onAddEntry).toHaveBeenCalledWith('et-pred', 'm-b');
  });
});

describe('EntrySection — React Compiler hazard', () => {
  it('a nested section sees a context change made after mount', async () => {
    // THE guard. Each EntrySection reads the context itself; a version that
    // read it once at the root and passed the value down stops updating
    // behind a memoized ancestor, with no build or type error.
    //
    // Asserting "two sections under different parents show different
    // entries" does NOT catch that — entries come from `parentInstanceId`,
    // a prop, so the broken version passes. What discriminates is a context
    // value CHANGING after mount while group/parentInstanceId stay
    // referentially identical.
    //
    // Scope, honestly: mutation-checked against a FROZEN value (`useState`
    // capturing the context at first render), which is what a memoized
    // ancestor does to a drilled prop — that fails this test and only this
    // test. It does not distinguish "read at consumption" from "drilled but
    // still fresh", because jsdom cannot make the compiler memoize. It
    // catches the hazard's EFFECT, which is the part that would ship.
    const {rerender} = render(wrap(ctx()));

    expect(screen.queryByText('Hypertension')).not.toBeInTheDocument();

    // Same group, same parentInstanceId, new context value: one more nested
    // instance, which only a section reading the context itself can see.
    rerender(
      wrap(ctx({instances: [...INSTANCES, inst('p-a2', 'et-pred', 'm-a', 'Hypertension')]})),
    );

    expect(screen.getByText('Hypertension')).toBeInTheDocument();
  });
});
