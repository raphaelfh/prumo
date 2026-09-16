import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import {describe, expect, it, vi} from 'vitest';

// The batch bar renders RunAIBatchDialog, which pulls in the typed api
// client, which imports the supabase client at module load. With no
// VITE_ env in the CI vitest job that throws `supabaseUrl is required`.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: null}})}},
}));

const role = {current: {role: 'reviewer', isManager: false, loading: false}};
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: () => role.current,
}));

import {BatchSelectionBar} from '@/components/extraction/batch/BatchSelectionBar';

const base = {
  projectId: 'p1',
  templateId: 't1',
  onClear: vi.fn(),
  activeBatch: null,
  onViewBatch: vi.fn(),
};

function ids(n: number) {
  return new Set(Array.from({length: n}, (_, i) => `a${i}`));
}

function renderWithClient(node: ReactElement) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

describe('BatchSelectionBar', () => {
  it('renders nothing with no selection', () => {
    const {container} = renderWithClient(<BatchSelectionBar {...base} selectedIds={ids(0)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers Run AI for a reviewer with a selection', async () => {
    renderWithClient(<BatchSelectionBar {...base} selectedIds={ids(3)} />);
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Run AI'})).toBeEnabled();
  });

  it('disables Run AI above 100 selected', () => {
    renderWithClient(<BatchSelectionBar {...base} selectedIds={ids(101)} />);
    expect(screen.getByRole('button', {name: 'Run AI'})).toBeDisabled();
  });

  it('hides Run AI from a viewer', () => {
    role.current = {role: 'viewer', isManager: false, loading: false};
    renderWithClient(<BatchSelectionBar {...base} selectedIds={ids(3)} />);
    expect(screen.queryByRole('button', {name: 'Run AI'})).not.toBeInTheDocument();
    role.current = {role: 'reviewer', isManager: false, loading: false};
  });

  it('shows the running chip and View while a batch is active', async () => {
    const activeBatch = {
      id: 'b1',
      counts: {total: 11, queued: 4, running: 0, done: 7, done_with_issues: 0,
        needs_attention: 0, skipped: 0, not_run: 0},
    } as never;
    const onViewBatch = vi.fn();
    renderWithClient(
      <BatchSelectionBar {...base} selectedIds={ids(3)} activeBatch={activeBatch}
        onViewBatch={onViewBatch} />,
    );
    expect(screen.getByText('AI running · 7/11')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'View'}));
    expect(onViewBatch).toHaveBeenCalledWith('b1');
  });
});
