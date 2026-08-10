/**
 * The Publish contract on screen (slice B-9b2b).
 *
 * A sibling of `TemplateConfigDiffSheet.test.tsx`, which owns the READ-ONLY
 * sheet and sits near the 800-line file-size ratchet. This file owns what
 * the sheet does once it stops being read-only: the acknowledgement gate,
 * the contract it submits, and the drift phase that clears every tick.
 *
 * Copy is deliberately NOT mocked — the sentences are the contract.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/templateService', async () => {
  const {templateServiceMock} = await import('./mocks/templateService');
  return templateServiceMock();
});
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {error: vi.fn(), success: vi.fn(), info: vi.fn()}),
}));

import {toast} from 'sonner';

import {TemplateConfigDiffSheet} from '@/components/extraction/template-config/TemplateConfigDiffSheet';
import {extraction, templateConfig} from '@/lib/copy';

import {
  loadTemplateConfigDiff,
  republishTemplateVersion,
} from './mocks/templateService';

type Tier = 'additive' | 'cosmetic' | 'semantic' | 'destructive';

interface RowSeed {
  id: string;
  variant: string;
  tier: Tier;
  label_path?: string[];
  affects_recorded_data?: boolean;
}

function row(seed: RowSeed) {
  return {
    label_path: ['Section A', 'Field X'],
    attribute: null,
    before: null,
    after: null,
    before_opaque_state: null,
    after_opaque_state: null,
    reorder_count: null,
    affects_recorded_data: false,
    ...seed,
  };
}

function diffOk(rows: RowSeed[], fingerprint = 'fp-1') {
  const changes: Record<Tier, ReturnType<typeof row>[]> = {
    additive: [],
    cosmetic: [],
    semantic: [],
    destructive: [],
  };
  for (const seed of rows) changes[seed.tier].push(row(seed));
  return {
    ok: true,
    data: {
      project_template_id: 't1',
      status: 'available',
      changes,
      fingerprint,
    },
  };
}

function renderSheet() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <TemplateConfigDiffSheet projectId="p1" templateId="t1" onClose={vi.fn()} />,
    {wrapper},
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TemplateConfigDiffSheet — the publish contract (B-9b2b)', () => {
  const DESTRUCTIVE: RowSeed[] = [
    {
      id: 'd1',
      variant: 'field_removed',
      tier: 'destructive',
      label_path: ['Section A', 'Doomed field'],
    },
  ];

  it('Publish stays disabled until every destructive row is confirmed', async () => {
    loadTemplateConfigDiff.mockResolvedValue(diffOk(DESTRUCTIVE));
    renderSheet();

    const publish = await screen.findByRole('button', {
      name: extraction.configPublishButton,
    });
    expect(publish).toBeDisabled();

    await userEvent.click(await screen.findByRole('checkbox'));
    await waitFor(() => expect(publish).toBeEnabled());
  });

  it('submits the fingerprint, the ticked rows and the note', async () => {
    loadTemplateConfigDiff.mockResolvedValue(diffOk(DESTRUCTIVE, 'fp-live'));
    republishTemplateVersion.mockResolvedValue({
      ok: true,
      data: {version_id: 'v9', version: 9, changed: true, repinned_run_count: 0},
    });
    renderSheet();

    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.type(
      screen.getByLabelText(templateConfig.publishNoteLabel),
      'because',
    );
    await userEvent.click(
      screen.getByRole('button', {name: extraction.configPublishButton}),
    );

    await waitFor(() => expect(republishTemplateVersion).toHaveBeenCalledTimes(1));
    expect(republishTemplateVersion).toHaveBeenCalledWith('p1', 't1', {
      expected_fingerprint: 'fp-live',
      acknowledged: [{id: 'd1', tier: 'destructive'}],
      note: 'because',
    });
  });

  it('a recompute with a new fingerprint clears every confirmation', async () => {
    // THE bug this slice exists to prevent: ticks that survive a recompute
    // mean the manager confirms a list they never saw. The sheet keys its
    // acknowledgements to the fingerprint they were given for, so a
    // reviewer recording an answer mid-sheet wipes them.
    loadTemplateConfigDiff.mockResolvedValue(diffOk(DESTRUCTIVE, 'fp-old'));
    renderSheet();

    await userEvent.click(await screen.findByRole('checkbox'));
    const publish = screen.getByRole('button', {
      name: extraction.configPublishButton,
    });
    await waitFor(() => expect(publish).toBeEnabled());

    // The same rows, a different projection — a tier escalated elsewhere.
    loadTemplateConfigDiff.mockResolvedValue(diffOk(DESTRUCTIVE, 'fp-new'));
    republishTemplateVersion.mockResolvedValue({ok: false, error: {message: 'drift'}});
    await userEvent.click(publish);

    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
    await waitFor(() =>
      expect(
        screen.getByRole('button', {name: extraction.configPublishButton}),
      ).toBeDisabled(),
    );
  });

  it('tells the manager when a no-op publish dropped their note', async () => {
    loadTemplateConfigDiff.mockResolvedValue(diffOk([]));
    republishTemplateVersion.mockResolvedValue({
      ok: true,
      data: {version_id: 'v1', version: 1, changed: false, repinned_run_count: 0},
    });
    renderSheet();

    await userEvent.type(
      await screen.findByLabelText(templateConfig.publishNoteLabel),
      'nowhere to live',
    );
    await userEvent.click(
      screen.getByRole('button', {name: extraction.configPublishButton}),
    );

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(templateConfig.publishNoteNotRecorded),
    );
  });
});
