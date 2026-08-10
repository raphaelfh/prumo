/**
 * TemplateConfigEditor — editor-hosted DeleteFieldConfirm (B-5 Task 7).
 *
 * The delete confirm mounts in the EDITOR, outside the grid panel's
 * React subtree: a Radix dialog rendered inside the panel would bubble
 * its dismiss-Esc (portals propagate through the REACT tree) into the
 * panel's `handleEscapeEscalate` and close the inspector as a side
 * effect. These tests pin the hosting, the small dedicated delete
 * mutation path (service + invalidateStructure) and that Esc regression.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// PostgREST stub for the ONE test that runs the REAL useTemplateEntityTypes
// (the invalidation→render path). Hoisted so the module factory below can
// read it lazily, per call.
const pgrst = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  fail: false,
}));

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
// `toast` is CALLABLE as well as a namespace: the B-9d undo arms
// `toast(message, {action})`, which a namespace-only mock cannot receive.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {error: vi.fn(), success: vi.fn(), info: vi.fn()}),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve(
              pgrst.fail
                ? {data: null, error: {message: 'entity types unavailable'}}
                : {data: pgrst.rows, error: null},
            ),
        }),
      }),
    }),
  },
}));
vi.mock('@/services/templateService', () => ({
  updateEntityTypeLabel: vi.fn(),
}));
vi.mock('@/services/extractionFieldService', () => ({
  validateFieldImpact: vi.fn(),
  deleteField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useTemplateRepublish', () => ({
  useTemplateConfigCaches: vi.fn(),
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
vi.mock('@/hooks/shared/useContainerNarrow', () => ({
  useContainerNarrow: vi.fn(() => false),
}));
// Heavy siblings with their own data paths — not under test here.
vi.mock('@/components/extraction/TemplateInstructionRow', () => ({
  TemplateInstructionRow: () => null,
}));
// A text marker, NOT `null`: the Discard dialog is mounted inside these
// controls, so "did the controls survive this re-render" is the observable
// standing in for "did the Discard result pane survive". (The end-to-end
// version, with the real controls and the real dialog, lives in
// TemplateConfigEditor.discardMount.test.tsx.)
vi.mock('@/components/extraction/template-config/TemplateConfigPublishControls', () => ({
  TemplateConfigPublishControls: () => 'publish-controls',
}));
vi.mock('./dialogs', () => ({
  AddSectionDialog: () => null,
  RemoveSectionDialog: () => null,
  ImportTemplateDialog: () => null,
}));

import {TooltipProvider} from '@/components/ui/tooltip';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useInsertTemplateField} from '@/hooks/extraction/useInsertTemplateField';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';
import {templateEntityTypesKeys} from '@/lib/query-keys/extraction';
import {deleteField, validateFieldImpact} from '@/services/extractionFieldService';
import type {FieldValidationResult} from '@/types/extraction';

import {TemplateConfigEditor} from './TemplateConfigEditor';

const SECTION = {
  id: 'sec',
  name: 'sec_a',
  label: 'Section A',
  description: null,
  role: 'study_section',
  cardinality: 'one',
  parent_entity_type_id: null,
  sort_order: 1,
};

const FIELDS = [
  {
    id: 'f1',
    entity_type_id: 'sec',
    name: 'q1',
    label: 'Study design',
    description: null,
    field_type: 'text',
    is_required: false,
    allowed_values: null,
    llm_description: null,
    sort_order: 1,
  },
];

/** PostgREST-shaped rows for the real-hook test (embedded `fields` alias). */
const ROW_A = {...SECTION, entry_label: null, fields: FIELDS};
const ROW_B = {
  id: 'sec-b',
  name: 'sec_b',
  label: 'Section B',
  description: null,
  role: 'study_section',
  cardinality: 'one',
  parent_entity_type_id: null,
  entry_label: null,
  sort_order: 2,
  fields: [],
};

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <TemplateConfigEditor projectId="p1" templateId="t1" />
        </TooltipProvider>
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

const invalidateStructure = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  pgrst.fail = false;
  pgrst.rows = [];
  vi.mocked(useTemplateConfigCaches).mockReturnValue({
    invalidateStructure,
    invalidateAll: vi.fn(async () => {}),
    invalidateAfterDiscard: vi.fn(async () => {}),
    invalidateAfterImport: vi.fn(async () => {}),
  });
  vi.mocked(useTemplateEntityTypes).mockReturnValue({
    entityTypes: [{...SECTION, fields: FIELDS}] as never,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
  } as never);
  vi.mocked(useUpdateTemplateField).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as never);
  vi.mocked(useInsertTemplateField).mockReturnValue({
    enqueueInsert: vi.fn(() => ({clientKey: 'pending-1', name: 'peso'})),
    enqueueUpdate: vi.fn(),
  });
  vi.mocked(validateFieldImpact).mockResolvedValue({
    ok: true,
    data: {
      canDelete: true,
      canUpdate: true,
      canChangeType: true,
      extractedValuesCount: 0,
      affectedArticles: [],
      message: 'safe',
    } satisfies FieldValidationResult,
  });
  vi.mocked(deleteField).mockResolvedValue({ok: true, data: undefined});
});

async function openRowMenuDelete() {
  await userEvent.click(
    screen.getAllByRole('button', {name: /actionsForFieldAria/})[0],
  );
  await userEvent.click(await screen.findByRole('menuitem', {name: /deleteField/}));
}

describe('TemplateConfigEditor — delete-field hosting (B-9d)', () => {
  it('deletes straight from the row menu — no confirmation dialog at all', async () => {
    // B-9d: the Publish ☑ ack (B-9b2b) is the real gate for anything
    // reaching published data, and the grid arms a 6s Undo for the
    // misclick, so the modal was pure friction on a draft edit.
    renderEditor();
    await screen.findByRole('button', {name: 'Study design'});

    await openRowMenuDelete();

    await waitFor(() => expect(deleteField).toHaveBeenCalledWith('p1', 't1', 'f1'));
    await waitFor(() => expect(invalidateStructure).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('does not probe field impact before deleting', async () => {
    // The probe existed to populate the dialog. The DB is the real
    // invariant: six field_id FKs are ON DELETE RESTRICT, and the
    // mutation hook already renders that 23503 as friendly copy.
    renderEditor();
    await screen.findByRole('button', {name: 'Study design'});

    await openRowMenuDelete();

    await waitFor(() => expect(deleteField).toHaveBeenCalled());
    expect(vi.mocked(validateFieldImpact)).not.toHaveBeenCalled();
  });
});

/** Swap the module mock for the REAL hook, so the query (and the PostgREST
 * stub above) drives the render instead of a hand-written return shape. */
async function useRealEntityTypesHook() {
  const actual = await vi.importActual<
    typeof import('@/hooks/extraction/useTemplateEntityTypes')
  >('@/hooks/extraction/useTemplateEntityTypes');
  vi.mocked(useTemplateEntityTypes).mockImplementation(actual.useTemplateEntityTypes);
}

describe('TemplateConfigEditor — entity types come from the query (B-9c2 T3, D8)', () => {
  it('renders the spinner while the query is pending — never the empty state', () => {
    vi.mocked(useTemplateEntityTypes).mockReturnValue({
      entityTypes: [],
      isPending: true,
      isLoading: true,
      isError: false,
      error: null,
    } as never);

    renderEditor();

    expect(screen.getByText('loadingConfiguration')).toBeInTheDocument();
    expect(screen.queryByText('noSectionsConfigured')).toBeNull();
  });

  it('a FAILED entity-types query surfaces the failure and NEVER claims "no sections configured"', async () => {
    // The trap this branch exists for: the hook returns `query.data ?? []`,
    // so a network failure is byte-identical to a template with zero
    // sections. Rendering the empty state here would tell the user their
    // configuration is gone. Driven through the REAL hook so the []-on-error
    // shape is the one under test, not a hand-written stand-in.
    await useRealEntityTypesHook();
    pgrst.fail = true;

    renderEditor();

    expect(await screen.findByText('sectionsLoadFailedTitle')).toBeInTheDocument();
    expect(screen.queryByText('noSectionsConfigured')).toBeNull();

    // …and the failure is recoverable without a page reload: the retry
    // affordance re-invalidates the entity-types key.
    await userEvent.click(screen.getByRole('button', {name: 'tryAgain'}));
    expect(invalidateStructure).toHaveBeenCalled();
  });

  it('a SUCCESSFUL query with zero rows still renders the empty state', async () => {
    // The counterpart that keeps the assertion above honest: "no sections
    // configured" is not dead copy, it is reserved for a real empty result.
    await useRealEntityTypesHook();
    pgrst.rows = [];

    renderEditor();

    expect(await screen.findByText('noSectionsConfigured')).toBeInTheDocument();
    expect(screen.queryByText('sectionsLoadFailedTitle')).toBeNull();
  });

  it('a refetch failure with rows ALREADY cached keeps the tab mounted and says so non-blockingly', async () => {
    // The realistic way into `status: "error"` on this screen is not a first
    // load at all (staleTime 5min, no refetch-on-focus): it is the
    // invalidation every successful mutation performs — rename, add/remove
    // section, delete field, Discard. TanStack v5 flips the status to error
    // while RETAINING the cached rows, so blanking the tab here throws away
    // a structure we still hold, along with the panel's selection/search/
    // collapse state and the host of the Discard result pane.
    await useRealEntityTypesHook();
    pgrst.rows = [ROW_A, ROW_B];

    const {queryClient} = renderEditor();
    expect(await screen.findByText('configSectionsCountOther')).toBeInTheDocument();

    // The mutation already committed; only the follow-up read dies.
    pgrst.fail = true;
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: templateEntityTypesKeys.byTemplate('t1'),
      });
    });

    // The failure IS said — non-blockingly, next to the data it qualifies.
    // (The observer notification is a macrotask, so this is the await that
    // proves the editor has actually reacted to the error state.)
    const banner = await screen.findByTestId('template-config-refresh-failed');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(within(banner).getByText('sectionsRefreshFailedBody')).toBeInTheDocument();

    // The blocking surfaces are both reserved for "we have nothing".
    expect(screen.queryByText('sectionsLoadFailedTitle')).toBeNull();
    expect(screen.queryByText('noSectionsConfigured')).toBeNull();

    // The cached structure is still on screen…
    expect(screen.getByText('configSectionsCountOther')).toBeInTheDocument();
    expect(screen.queryAllByText('Section B').length).toBeGreaterThan(0);
    // …including the command-bar cluster that hosts the Discard dialog.
    expect(screen.getByText('publish-controls')).toBeInTheDocument();

    await userEvent.click(within(banner).getByRole('button', {name: 'tryAgain'}));
    expect(invalidateStructure).toHaveBeenCalled();
  });

  it('the header badge recomputes when templateEntityTypesKeys.byTemplate is invalidated (no hand-refresh)', async () => {
    // The claim the whole migration rests on: deleting the imperative
    // reloads is safe ONLY because every config mutation already
    // invalidates this key, and the query re-renders the header from it.
    await useRealEntityTypesHook();
    pgrst.rows = [ROW_A, ROW_B];

    const {queryClient} = renderEditor();

    // Two sections → the plural count key.
    expect(await screen.findByText('configSectionsCountOther')).toBeInTheDocument();
    expect(screen.queryAllByText('Section B').length).toBeGreaterThan(0);

    // A Discard (or any other mutation) removes a section server-side and
    // invalidates the key — nothing else.
    pgrst.rows = [ROW_A];
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: templateEntityTypesKeys.byTemplate('t1'),
      });
    });

    await waitFor(() =>
      expect(screen.getByText('configSectionsCountOne')).toBeInTheDocument(),
    );
    expect(screen.queryByText('configSectionsCountOther')).toBeNull();
    expect(screen.queryAllByText('Section B')).toHaveLength(0);
  });
});
