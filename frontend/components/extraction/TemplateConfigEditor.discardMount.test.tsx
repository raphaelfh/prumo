/**
 * The Discard result pane must survive the refetch the discard itself
 * triggers (B-9c2 review fix).
 *
 * `TemplateDiscardDialog` awaits `invalidateAfterDiscard()` BEFORE it can
 * switch to the `result` phase, and it is mounted inside
 * `TemplateConfigPublishControls`, which the editor renders only in its
 * success branch. So an editor that unmounts that branch on any query error
 * destroys the kept-node report of a discard that already COMMITTED — and
 * the report has no other surface.
 *
 * Unlike the sibling TemplateConfigEditor.test.tsx, this file runs the real
 * publish controls and the real dialog, so the unmount is observed
 * end-to-end rather than through a stand-in.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

/** PostgREST stub for the REAL useTemplateEntityTypes. */
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
  discardTemplateDraft: vi.fn(),
  updateEntityTypeLabel: vi.fn(),
  // Only ever reached through `instanceof` on a FAILED discard, which this
  // file never produces — the binding just has to exist.
  TemplateDiscardRefusal: class TemplateDiscardRefusal extends Error {},
}));
vi.mock('@/services/extractionFieldService', () => ({
  validateFieldImpact: vi.fn(),
  deleteField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useTemplateRepublish', () => ({
  useTemplateConfigCaches: vi.fn(),
  useTemplateRepublish: vi.fn(() => ({republish: vi.fn()})),
}));
vi.mock('@/hooks/extraction/useTemplateConfigStatus', () => ({
  useTemplateConfigStatus: vi.fn(),
}));
vi.mock('@/hooks/extraction/useTemplateInstruction', () => ({
  useTemplateInstruction: vi.fn(() => ({data: undefined})),
}));
vi.mock('@/hooks/extraction/useDeleteTemplateField', () => ({
  useDeleteTemplateField: vi.fn(() => ({mutate: vi.fn(), isPending: false})),
}));
// Siblings with their own data paths — not what this file is pinning.
vi.mock('@/components/extraction/TemplateInstructionRow', () => ({
  TemplateInstructionRow: () => null,
}));
vi.mock('@/components/extraction/template-config/TemplateConfigGridPanel', () => ({
  TemplateConfigGridPanel: () => 'grid-panel',
}));
vi.mock('./dialogs', () => ({
  AddSectionDialog: () => null,
  ImportTemplateDialog: () => null,
}));

import {TooltipProvider} from '@/components/ui/tooltip';
import {useTemplateConfigStatus} from '@/hooks/extraction/useTemplateConfigStatus';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {templateEntityTypesKeys} from '@/lib/query-keys/extraction';
import {discardTemplateDraft} from '@/services/templateService';

import {TemplateConfigEditor} from './TemplateConfigEditor';

const ROW_A = {
  id: 'sec',
  name: 'sec_a',
  label: 'Section A',
  description: null,
  role: 'study_section',
  cardinality: 'one',
  parent_entity_type_id: null,
  entry_label: null,
  sort_order: 1,
  fields: [],
};

const KEPT = {
  node_id: 'f-weight',
  node_kind: 'field',
  label: 'Weight',
  reason: 'has_recorded_data',
};

let queryClient: QueryClient;

function renderEditor() {
  queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <TemplateConfigEditor projectId="p1" templateId="t1" />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  pgrst.fail = false;
  pgrst.rows = [ROW_A];
  vi.mocked(useTemplateConfigStatus).mockReturnValue({
    data: {
      has_pending_changes: true,
      discard_available: true,
      active_version: 3,
      pending_change_count: 2,
    },
  } as never);
  vi.mocked(useTemplateConfigCaches).mockReturnValue({
    invalidateStructure: vi.fn(async () => {}),
    invalidateAll: vi.fn(async () => {}),
    invalidateAfterImport: vi.fn(async () => {}),
    // The production refresh, minus the instruction key: a REAL invalidation
    // of the structure key, so the dialog awaits an actual refetch.
    invalidateAfterDiscard: async () => {
      await queryClient.invalidateQueries({
        queryKey: templateEntityTypesKeys.byTemplate('t1'),
      });
    },
  });
  vi.mocked(discardTemplateDraft).mockImplementation(async () => {
    // The write COMMITTED; it is the follow-up read that dies.
    pgrst.fail = true;
    return {ok: true, data: {kept: [KEPT]}} as never;
  });
});

describe('TemplateConfigEditor — the Discard result survives a failed post-discard refetch', () => {
  it('reports the kept nodes even though the structure refetch failed', async () => {
    renderEditor();

    await userEvent.click(
      await screen.findByRole('button', {name: 'discardButtonAria'}),
    );
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(
      within(dialog).getByRole('button', {name: 'discardConfirmAction'}),
    );

    // The discard ran and kept a node: that report is the ONLY place the
    // user learns the template is still a draft.
    expect(await screen.findByText('discardResultTitle')).toBeInTheDocument();

    // The failed refetch reaches the editor one notifyManager macrotask
    // later — the banner is its visible reaction, and the moment the old
    // build swapped the whole tab (dialog host included) for the error card.
    await screen.findByTestId('template-config-refresh-failed');

    expect(screen.getByText('discardResultTitle')).toBeInTheDocument();
    expect(screen.getByText('discardResultStillDraft')).toBeInTheDocument();
    expect(screen.getByText('Weight')).toBeInTheDocument();
    // …and the tab behind it kept its cached structure.
    expect(screen.queryByText('sectionsLoadFailedTitle')).toBeNull();
    expect(screen.getByText('grid-panel')).toBeInTheDocument();
  });
});
