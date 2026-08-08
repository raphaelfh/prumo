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
vi.mock('@/services/templateService', () => ({
  loadTemplateConfigStatus: (...a: unknown[]) => loadTemplateConfigStatus(...a),
  republishTemplateVersion: (...a: unknown[]) => republishTemplateVersion(...a),
}));
vi.mock('sonner', () => ({
  toast: {success: vi.fn(), error: vi.fn()},
}));

import {TemplateConfigPublishControls} from '@/components/extraction/template-config/TemplateConfigPublishControls';
import {TooltipProvider} from '@/components/ui/tooltip';
import {toast} from 'sonner';

function renderControls() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
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
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
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
