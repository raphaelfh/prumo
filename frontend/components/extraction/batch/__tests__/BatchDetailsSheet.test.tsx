/**
 * BatchDetailsSheet (spec 2026-09-15 §11.6): groups items by outcome,
 * shows only the applicable footer actions, and Retry failed opens
 * RunAIBatchDialog with the failed ids and the skip checkbox unchecked.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const useBatchDetailMock = vi.fn();
vi.mock('@/hooks/extraction/useExtractionBatches', () => ({
  useBatchDetail: (...args: unknown[]) => useBatchDetailMock(...args),
  useCancelBatch: () => ({mutate: vi.fn(), isPending: false}),
  useResumeBatch: () => ({mutate: vi.fn(), isPending: false}),
}));

let lastDialogProps: Record<string, unknown> | undefined;
vi.mock('@/components/extraction/batch/RunAIBatchDialog', () => ({
  RunAIBatchDialog: (props: Record<string, unknown>) => {
    lastDialogProps = props;
    if (!props.open) return null;
    return <div data-testid="run-ai-batch-dialog" />;
  },
}));

import {BatchDetailsSheet} from '@/components/extraction/batch/BatchDetailsSheet';

function detail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'b1',
    kind: 'extraction',
    project_id: 'p1',
    project_name: 'Project 1',
    template_id: 't1',
    template_name: 'Template 1',
    state: 'active',
    stalled: true,
    stop_code: null,
    stop_message: null,
    created_at: '2026-09-15T00:00:00Z',
    finished_at: null,
    counts: {
      done: 1,
      done_with_issues: 0,
      needs_attention: 1,
      not_run: 1,
      queued: 0,
      running: 0,
      skipped: 1,
      total: 4,
    },
    items: [
      {
        article_id: 'a-done',
        title: 'Done article',
        outcome: 'done',
        reason_code: null,
        message: null,
        failed_sections: null,
        total_sections: null,
      },
      {
        article_id: 'a-needs-attention',
        title: 'Needs attention article',
        outcome: 'needs_attention',
        reason_code: 'PDF_NOT_FOUND',
        message: 'No PDF on file',
        failed_sections: null,
        total_sections: null,
      },
      {
        article_id: 'a-skipped',
        title: 'Skipped article',
        outcome: 'skipped',
        reason_code: 'ALREADY_HAS_AI_SUGGESTIONS',
        message: null,
        failed_sections: null,
        total_sections: null,
      },
      {
        article_id: 'a-not-run',
        title: 'Not run article',
        outcome: 'not_run',
        reason_code: 'STOPPED_ENGINE_ERROR',
        message: null,
        failed_sections: null,
        total_sections: null,
      },
    ],
    ...overrides,
  };
}

describe('BatchDetailsSheet', () => {
  beforeEach(() => {
    lastDialogProps = undefined;
  });

  it('renders the four group headings in order with reason lines and footer actions', () => {
    useBatchDetailMock.mockReturnValue({data: detail()});
    render(<MemoryRouter><BatchDetailsSheet batchId="b1" onOpenChange={vi.fn()} /></MemoryRouter>);

    const headings = screen.getAllByRole('heading', {level: 3}).map((h) => h.textContent);
    expect(headings).toEqual(['Needs attention', 'Skipped', 'Not run', 'Done']);

    expect(screen.getByText('Extraction error')).toBeInTheDocument();
    expect(screen.getByText('Already has AI suggestions')).toBeInTheDocument();
    expect(screen.getByText('Not run — the batch stopped')).toBeInTheDocument();

    expect(screen.getByRole('button', {name: 'Cancel batch'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Resume'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry failed'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Run remaining'})).toBeInTheDocument();
  });

  it('shows no footer action for a finished batch with only done items', () => {
    useBatchDetailMock.mockReturnValue({
      data: detail({
        state: 'finished',
        stalled: false,
        counts: {
          done: 1,
          done_with_issues: 0,
          needs_attention: 0,
          not_run: 0,
          queued: 0,
          running: 0,
          skipped: 0,
          total: 1,
        },
        items: [
          {
            article_id: 'a-done',
            title: 'Done article',
            outcome: 'done',
            reason_code: null,
            message: null,
            failed_sections: null,
            total_sections: null,
          },
        ],
      }),
    });
    render(<MemoryRouter><BatchDetailsSheet batchId="b1" onOpenChange={vi.fn()} /></MemoryRouter>);

    expect(screen.queryByRole('button', {name: 'Cancel batch'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Resume'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Retry failed'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Run remaining'})).not.toBeInTheDocument();
  });

  it('Retry failed opens the dialog with the failed ids and skip unchecked', async () => {
    const user = userEvent.setup();
    useBatchDetailMock.mockReturnValue({data: detail()});
    render(<MemoryRouter><BatchDetailsSheet batchId="b1" onOpenChange={vi.fn()} /></MemoryRouter>);

    await user.click(screen.getByRole('button', {name: 'Retry failed'}));

    expect(lastDialogProps?.open).toBe(true);
    expect(lastDialogProps?.articleIds).toEqual(['a-needs-attention']);
    expect(lastDialogProps?.defaultSkipExisting).toBe(false);
  });
});
