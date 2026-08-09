/**
 * TemplateConfigPublishControls — the B-4 Draft chip + explicit Publish.
 *
 * State matrix (the disabled-on-unknown rule is deliberate: an unknown
 * status must never enable a publish):
 *   pending=true   → warning chip + Publish ENABLED
 *   pending=false  → "Published · vN" chip + Publish DISABLED
 *   version=null   → no version chip (never "vundefined")
 *   loading/error  → no chip + Publish DISABLED
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const loadTemplateConfigStatus = vi.fn();
const republishTemplateVersion = vi.fn();
const discardTemplateDraft = vi.fn();
vi.mock('@/services/templateService', () => {
  // The refusal class is defined INSIDE the factory (the real module pulls
  // in the supabase client). The test imports it back from the mocked
  // module, so `instanceof` in the dialog matches what the test throws.
  class TemplateDiscardRefusal extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly orphans: readonly {nodeId: string | null; label: string}[] = [],
    ) {
      super(message);
      this.name = 'TemplateDiscardRefusal';
    }
  }
  return {
    loadTemplateConfigStatus: (...a: unknown[]) => loadTemplateConfigStatus(...a),
    republishTemplateVersion: (...a: unknown[]) => republishTemplateVersion(...a),
    discardTemplateDraft: (...a: unknown[]) => discardTemplateDraft(...a),
    TemplateDiscardRefusal,
  };
});
const getTemplateInstruction = vi.fn();
vi.mock('@/services/templateInstructionService', () => ({
  getTemplateInstruction: (...a: unknown[]) => getTemplateInstruction(...a),
  updateTemplateInstruction: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: {success: vi.fn(), error: vi.fn()},
}));

import {TemplateConfigPublishControls} from '@/components/extraction/template-config/TemplateConfigPublishControls';
import {TooltipProvider} from '@/components/ui/tooltip';
import {common, templateConfig} from '@/lib/copy';
import {
  TemplateDiscardRefusal,
  type TemplateDiscardRefusalCode,
} from '@/services/templateService';
import {toast} from 'sonner';

function renderControls() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>
      {/* delayDuration 0 so the four-way Discard tooltip is assertable */}
      <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
  return render(
    <TemplateConfigPublishControls projectId="p1" templateId="t1" />,
    {wrapper},
  );
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      project_template_id: 't1',
      has_pending_changes: false,
      active_version: 3,
      // B-9c2: absent on the wire before T1; false is the safe default and
      // keeps every pre-existing case rendering Discard disabled.
      discard_available: false,
      ...overrides,
    },
  };
}

/** A template with an open, discardable draft — the only state that
 * enables the Discard button. */
function discardableStatus(overrides: Record<string, unknown> = {}) {
  return status({
    has_pending_changes: true,
    discard_available: true,
    pending_change_count: 2,
    ...overrides,
  });
}

function discardResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      project_template_id: 't1',
      draft_was_open: true,
      instruction_reset: false,
      created_entity_types: 0,
      created_fields: 0,
      deleted_entity_types: 0,
      deleted_fields: 1,
      updated_entity_types: 0,
      updated_fields: 0,
      kept: [],
      ...overrides,
    },
  };
}

/** The Discard trigger keeps a CONSTANT accessible name so the existing
 * `/publish/i` queries stay unambiguous (its tooltip carries the state). */
const DISCARD_TRIGGER = templateConfig.discardButtonAria;

function discardButton() {
  return screen.getByRole('button', {name: DISCARD_TRIGGER});
}

/** Radix keeps the tooltip on the disabled button's span wrapper. */
async function hoverDiscard() {
  await userEvent.hover(discardButton().parentElement as HTMLElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  getTemplateInstruction.mockResolvedValue({
    project_template_id: 't1',
    llm_template_instruction: null,
    default_instruction: null,
  });
});

describe('TemplateConfigPublishControls', () => {
  it('pending changes → warning chip and Publish enabled', async () => {
    loadTemplateConfigStatus.mockResolvedValue(status({has_pending_changes: true}));
    renderControls();

    expect(await screen.findByText('Unpublished changes')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', {name: /publish/i})).toBeEnabled(),
    );
  });

  it('published → version chip and Publish disabled', async () => {
    loadTemplateConfigStatus.mockResolvedValue(status());
    renderControls();

    expect(await screen.findByText('Published · v3')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /publish/i})).toBeDisabled();
  });

  it('never-published template → no version chip, never "vundefined"', async () => {
    loadTemplateConfigStatus.mockResolvedValue(status({active_version: null}));
    renderControls();

    await waitFor(() =>
      expect(screen.getByRole('button', {name: /publish/i})).toBeDisabled(),
    );
    expect(screen.queryByText(/vundefined/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Published/)).not.toBeInTheDocument();
  });

  it('status still loading → no chip, Publish disabled', () => {
    loadTemplateConfigStatus.mockImplementation(() => new Promise(() => {}));
    renderControls();

    expect(screen.getByRole('button', {name: /publish/i})).toBeDisabled();
    expect(screen.queryByText('Unpublished changes')).not.toBeInTheDocument();
  });

  it('status failed → no chip, Publish disabled', async () => {
    loadTemplateConfigStatus.mockResolvedValue({
      ok: false,
      error: {message: 'boom'},
    });
    renderControls();

    await waitFor(() =>
      expect(screen.getByRole('button', {name: /publish/i})).toBeDisabled(),
    );
    expect(screen.queryByText('Unpublished changes')).not.toBeInTheDocument();
  });

  it('click Publish → one POST, success toast with the version, status refetch', async () => {
    loadTemplateConfigStatus.mockResolvedValue(status({has_pending_changes: true}));
    republishTemplateVersion.mockResolvedValue({
      ok: true,
      data: {version_id: 'v-4', version: 4, changed: true, repinned_run_count: 2},
    });
    renderControls();

    const button = await screen.findByRole('button', {name: /publish/i});
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    expect(republishTemplateVersion).toHaveBeenCalledTimes(1);
    expect(republishTemplateVersion).toHaveBeenCalledWith('p1', 't1');
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('4'),
      ),
    );
    // The publish invalidates config-status — the query refetches.
    await waitFor(() =>
      expect(loadTemplateConfigStatus.mock.calls.length).toBeGreaterThan(1),
    );
  });

  // B-9a / D9 — the server-computed draft change count on the chip.
  it('pending changes with count 1 → singular draft chip', async () => {
    loadTemplateConfigStatus.mockResolvedValue(
      status({has_pending_changes: true, pending_change_count: 1}),
    );
    renderControls();

    expect(await screen.findByText('Draft · 1 change')).toBeInTheDocument();
    expect(screen.queryByText('Unpublished changes')).not.toBeInTheDocument();
  });

  it('pending changes with count 6 → plural draft chip', async () => {
    loadTemplateConfigStatus.mockResolvedValue(
      status({has_pending_changes: true, pending_change_count: 6}),
    );
    renderControls();

    expect(await screen.findByText('Draft · 6 changes')).toBeInTheDocument();
    expect(screen.queryByText('Unpublished changes')).not.toBeInTheDocument();
  });

  it('count 0 (no-op draft) → bare badge, Publish still enabled', async () => {
    loadTemplateConfigStatus.mockResolvedValue(
      status({has_pending_changes: true, pending_change_count: 0}),
    );
    renderControls();

    expect(await screen.findByText('Unpublished changes')).toBeInTheDocument();
    expect(screen.queryByText(/Draft ·/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', {name: /publish/i})).toBeEnabled(),
    );
  });

  it('count null (unreliable baseline) → bare badge', async () => {
    loadTemplateConfigStatus.mockResolvedValue(
      status({has_pending_changes: true, pending_change_count: null}),
    );
    renderControls();

    expect(await screen.findByText('Unpublished changes')).toBeInTheDocument();
    expect(screen.queryByText(/Draft ·/)).not.toBeInTheDocument();
  });

  it('published and clean → version chip, never a draft chip', async () => {
    loadTemplateConfigStatus.mockResolvedValue(status({pending_change_count: 4}));
    renderControls();

    expect(await screen.findByText('Published · v3')).toBeInTheDocument();
    expect(screen.queryByText(/Draft ·/)).not.toBeInTheDocument();
  });

  it('unpublished and clean → no chip at all', async () => {
    loadTemplateConfigStatus.mockResolvedValue(
      status({active_version: null, pending_change_count: null}),
    );
    renderControls();

    await waitFor(() =>
      expect(screen.getByRole('button', {name: /publish/i})).toBeDisabled(),
    );
    expect(screen.queryByText(/Draft ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Published/)).not.toBeInTheDocument();
    expect(screen.queryByText('Unpublished changes')).not.toBeInTheDocument();
  });

  it('publish failure → error toast (from the hook), button re-enabled', async () => {
    loadTemplateConfigStatus.mockResolvedValue(status({has_pending_changes: true}));
    republishTemplateVersion.mockResolvedValue({
      ok: false,
      error: {message: 'locked'},
    });
    renderControls();

    const button = await screen.findByRole('button', {name: /publish/i});
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toBeEnabled());
  });
});

// ---------------------------------------------------------------------------
// B-9c2 T4 — the Discard button (D6) and its four-phase dialog (D4/D5/D9-11).
// ---------------------------------------------------------------------------

/** Open the confirm pane from a discardable status. */
async function openDiscardDialog() {
  await waitFor(() => expect(discardButton()).toBeEnabled());
  await userEvent.click(discardButton());
  return screen.findByText(templateConfig.discardConfirmTitle);
}

describe('TemplateConfigPublishControls — Discard button (D6)', () => {
  it('status still loading → disabled, and the tooltip is the ACTION, never a reason', async () => {
    loadTemplateConfigStatus.mockImplementation(() => new Promise(() => {}));
    renderControls();

    expect(discardButton()).toBeDisabled();
    await hoverDiscard();
    expect(
      (await screen.findAllByText(templateConfig.discardTooltipAction)).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText(templateConfig.discardTooltipNothing),
    ).not.toBeInTheDocument();
  });

  it('no pending changes → disabled, "nothing to discard"', async () => {
    loadTemplateConfigStatus.mockResolvedValue(status({discard_available: true}));
    renderControls();

    await waitFor(() => expect(discardButton()).toBeDisabled());
    await hoverDiscard();
    expect(
      (await screen.findAllByText(templateConfig.discardTooltipNothing)).length,
    ).toBeGreaterThan(0);
  });

  it('pending but nothing published yet → "nothing has been published yet"', async () => {
    loadTemplateConfigStatus.mockResolvedValue(
      status({has_pending_changes: true, discard_available: false, active_version: null}),
    );
    renderControls();

    await waitFor(() => expect(discardButton()).toBeDisabled());
    await hoverDiscard();
    expect(
      (await screen.findAllByText(templateConfig.discardTooltipNeverPublished)).length,
    ).toBeGreaterThan(0);
  });

  it('pending, published, but not restorable → "too old to restore from"', async () => {
    loadTemplateConfigStatus.mockResolvedValue(
      status({has_pending_changes: true, discard_available: false, active_version: 3}),
    );
    renderControls();

    await waitFor(() => expect(discardButton()).toBeDisabled());
    await hoverDiscard();
    expect(
      (await screen.findAllByText(templateConfig.discardTooltipBaselineTooOld)).length,
    ).toBeGreaterThan(0);
  });

  it('discard_available AND pending → enabled, tooltip back to the action', async () => {
    loadTemplateConfigStatus.mockResolvedValue(discardableStatus());
    renderControls();

    await waitFor(() => expect(discardButton()).toBeEnabled());
    await hoverDiscard();
    expect(
      (await screen.findAllByText(templateConfig.discardTooltipAction)).length,
    ).toBeGreaterThan(0);
  });
});

describe('TemplateDiscardDialog — confirm pane (D10/D11)', () => {
  it('names the count and the version it goes back to', async () => {
    loadTemplateConfigStatus.mockResolvedValue(discardableStatus());
    renderControls();
    await openDiscardDialog();

    expect(
      screen.getByText(
        templateConfig.discardConfirmBodyOther.replace('{{n}}', '2').replace('{{v}}', '3'),
      ),
    ).toBeInTheDocument();
  });

  it('no instruction cached → NO instruction warning (D10)', async () => {
    loadTemplateConfigStatus.mockResolvedValue(discardableStatus());
    renderControls();
    await openDiscardDialog();

    expect(
      screen.queryByText(templateConfig.discardConfirmInstruction),
    ).not.toBeInTheDocument();
  });

  it('an instruction is set → the warning appears (D10)', async () => {
    loadTemplateConfigStatus.mockResolvedValue(discardableStatus());
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'Focus on the primary outcome.',
      default_instruction: null,
    });
    renderControls();
    await openDiscardDialog();

    await waitFor(() =>
      expect(
        screen.getByText(templateConfig.discardConfirmInstruction),
      ).toBeInTheDocument(),
    );
  });
});

describe('TemplateDiscardDialog — outcomes', () => {
  it('happy path → one POST without the ack, success toast, dialog closed, caches refreshed', async () => {
    loadTemplateConfigStatus.mockResolvedValue(discardableStatus());
    discardTemplateDraft.mockResolvedValue(discardResult());
    renderControls();
    await openDiscardDialog();
    const statusCallsBefore = loadTemplateConfigStatus.mock.calls.length;
    const instructionCallsBefore = getTemplateInstruction.mock.calls.length;

    await userEvent.click(
      screen.getByRole('button', {name: templateConfig.discardConfirmAction}),
    );

    expect(discardTemplateDraft).toHaveBeenCalledTimes(1);
    expect(discardTemplateDraft).toHaveBeenCalledWith('p1', 't1', {
      acknowledgeOrphans: false,
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(templateConfig.discardSuccessToast),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(templateConfig.discardConfirmTitle),
      ).not.toBeInTheDocument(),
    );
    // invalidateAfterDiscard = structure (config-status) + the instruction.
    await waitFor(() =>
      expect(loadTemplateConfigStatus.mock.calls.length).toBeGreaterThan(
        statusCallsBefore,
      ),
    );
    await waitFor(() =>
      expect(getTemplateInstruction.mock.calls.length).toBeGreaterThan(
        instructionCallsBefore,
      ),
    );
  });

  it('ORPHAN_ACK_REQUIRED → ack pane by label, then a SECOND POST carrying the ack', async () => {
    loadTemplateConfigStatus.mockResolvedValue(discardableStatus());
    discardTemplateDraft
      .mockResolvedValueOnce({
        ok: false,
        error: new TemplateDiscardRefusal(
          'Discarding would remove options ...: Outcomes → Endpoint.',
          'ORPHAN_ACK_REQUIRED',
          [
            {nodeId: 'f-1', label: 'Outcomes → Endpoint'},
            {nodeId: 'f-2', label: 'Outcomes → Follow-up'},
          ],
        ),
      })
      .mockResolvedValueOnce(discardResult());
    renderControls();
    await openDiscardDialog();

    await userEvent.click(
      screen.getByRole('button', {name: templateConfig.discardConfirmAction}),
    );

    expect(await screen.findByText(templateConfig.discardAckTitle)).toBeInTheDocument();
    expect(screen.getByText('Outcomes → Endpoint')).toBeInTheDocument();
    expect(screen.getByText('Outcomes → Follow-up')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', {name: templateConfig.discardAckAction}),
    );

    await waitFor(() => expect(discardTemplateDraft).toHaveBeenCalledTimes(2));
    expect(discardTemplateDraft).toHaveBeenLastCalledWith('p1', 't1', {
      acknowledgeOrphans: true,
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(templateConfig.discardSuccessToast),
    );
  });

  it.each([
    ['NARROW_BASELINE', templateConfig.discardRefusedNarrowBaseline],
    ['CARDINALITY_DOWNGRADE_BLOCKED', templateConfig.discardRefusedCardinality],
    ['CONTAINER_SWAP_UNSUPPORTED', templateConfig.discardRefusedContainerSwap],
    ['DISCARD_RACED', templateConfig.discardRefusedRaced],
  ] as const)(
    '%s → the dialog stays open on LOCAL copy, never the server prose',
    async (code, localCopy) => {
      loadTemplateConfigStatus.mockResolvedValue(discardableStatus());
      discardTemplateDraft.mockResolvedValue({
        ok: false,
        error: new TemplateDiscardRefusal('SERVER PROSE THAT MUST NOT RENDER', code),
      });
      renderControls();
      await openDiscardDialog();

      await userEvent.click(
        screen.getByRole('button', {name: templateConfig.discardConfirmAction}),
      );

      expect(
        await screen.findByText(templateConfig.discardRefusedTitle),
      ).toBeInTheDocument();
      expect(screen.getByText(localCopy)).toBeInTheDocument();
      expect(
        screen.queryByText('SERVER PROSE THAT MUST NOT RENDER'),
      ).not.toBeInTheDocument();
      expect(discardTemplateDraft).toHaveBeenCalledTimes(1);
    },
  );

  it('a 500 is NOT framed as a policy refusal — generic copy, still on confirm', async () => {
    loadTemplateConfigStatus.mockResolvedValue(discardableStatus());
    discardTemplateDraft.mockResolvedValue({
      ok: false,
      error: new Error('Internal Server Error'),
    });
    renderControls();
    await openDiscardDialog();

    await userEvent.click(
      screen.getByRole('button', {name: templateConfig.discardConfirmAction}),
    );

    expect(
      await screen.findByText(templateConfig.discardFailedGeneric),
    ).toBeInTheDocument();
    expect(screen.getByText(templateConfig.discardConfirmTitle)).toBeInTheDocument();
    expect(
      screen.queryByText(templateConfig.discardRefusedTitle),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Internal Server Error')).not.toBeInTheDocument();
  });

  it('an UNKNOWN refusal code also falls to the generic outcome', async () => {
    loadTemplateConfigStatus.mockResolvedValue(discardableStatus());
    discardTemplateDraft.mockResolvedValue({
      ok: false,
      // Deploy skew: a server ahead of this bundle. The cast is the point —
      // TS says impossible, the wire says otherwise.
      error: new TemplateDiscardRefusal(
        'brand new refusal',
        'SOMETHING_NEW' as TemplateDiscardRefusalCode,
      ),
    });
    renderControls();
    await openDiscardDialog();

    await userEvent.click(
      screen.getByRole('button', {name: templateConfig.discardConfirmAction}),
    );

    expect(
      await screen.findByText(templateConfig.discardFailedGeneric),
    ).toBeInTheDocument();
    expect(screen.getByText(templateConfig.discardConfirmTitle)).toBeInTheDocument();
  });

  it('kept nodes → the result pane, and the chip still reads Draft', async () => {
    // The marker survives a partial discard, so the status keeps saying so.
    loadTemplateConfigStatus.mockResolvedValue(discardableStatus());
    discardTemplateDraft.mockResolvedValue(
      discardResult({
        kept: [
          {
            node_id: 'e-1',
            node_kind: 'entity_type',
            label: 'Model performance',
            reason: 'has_recorded_data',
          },
          {
            node_id: 'f-9',
            node_kind: 'field',
            label: 'AUC',
            reason: 'related_to_kept_node',
          },
        ],
      }),
    );
    renderControls();
    await openDiscardDialog();

    await userEvent.click(
      screen.getByRole('button', {name: templateConfig.discardConfirmAction}),
    );

    expect(
      await screen.findByText(templateConfig.discardResultTitle),
    ).toBeInTheDocument();
    expect(screen.getByText('Model performance')).toBeInTheDocument();
    expect(screen.getByText('AUC')).toBeInTheDocument();
    expect(screen.getByText(templateConfig.discardKeptKindSection)).toBeInTheDocument();
    expect(screen.getByText(templateConfig.discardKeptKindField)).toBeInTheDocument();
    expect(
      screen.getByText(templateConfig.discardKeptReasonHasRecordedData, {exact: false}),
    ).toBeInTheDocument();
    expect(
      screen.getByText(templateConfig.discardKeptReasonRelatedToKeptNode, {exact: false}),
    ).toBeInTheDocument();
    // Otherwise the still-lit chip reads as a bug.
    expect(screen.getByText(templateConfig.discardResultStillDraft)).toBeInTheDocument();
    expect(screen.getByText('Draft · 2 changes')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a kept reason outside the generated union still renders an explanation (D9)', async () => {
    loadTemplateConfigStatus.mockResolvedValue(discardableStatus());
    discardTemplateDraft.mockResolvedValue(
      discardResult({
        kept: [
          {
            node_id: 'f-9',
            node_kind: 'field',
            label: 'AUC',
            reason: 'a_reason_from_the_future',
          },
        ],
      }),
    );
    renderControls();
    await openDiscardDialog();

    await userEvent.click(
      screen.getByRole('button', {name: templateConfig.discardConfirmAction}),
    );

    expect(
      await screen.findByText(templateConfig.discardKeptReasonOther, {exact: false}),
    ).toBeInTheDocument();
  });

  it('reopening after a result pane lands back on confirm (mounted per open)', async () => {
    loadTemplateConfigStatus.mockResolvedValue(discardableStatus());
    discardTemplateDraft.mockResolvedValue(
      discardResult({
        kept: [
          {
            node_id: 'f-9',
            node_kind: 'field',
            label: 'AUC',
            reason: 'has_recorded_data',
          },
        ],
      }),
    );
    renderControls();
    await openDiscardDialog();
    await userEvent.click(
      screen.getByRole('button', {name: templateConfig.discardConfirmAction}),
    );
    await screen.findByText(templateConfig.discardResultTitle);

    await userEvent.click(
      screen.getByRole('button', {name: common.close}),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(templateConfig.discardResultTitle),
      ).not.toBeInTheDocument(),
    );

    await userEvent.click(discardButton());

    expect(
      await screen.findByText(templateConfig.discardConfirmTitle),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(templateConfig.discardResultTitle),
    ).not.toBeInTheDocument();
  });
});
