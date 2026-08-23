// frontend/components/extraction/dialogs/ProjectTemplatesList.test.tsx
/**
 * The list reads the SHARED project-template query, so these render against
 * a real QueryClient with only the services stubbed — that is the only way
 * to pin what the migration is for: one fetch per cache entry, and a write
 * that refreshes the family instead of each caller refreshing its own copy.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {TooltipProvider} from '@/components/ui/tooltip';

const ROWS = [
  {id: 'a', name: 'Current CHARMS', framework: 'CHARMS', is_active: true, created_at: '2026-08-01T00:00:00Z'},
  {id: 'b', name: 'Imported', framework: 'CUSTOM', is_active: false, created_at: '2026-08-20T00:00:00Z'},
];

const fetchProjectTemplates = vi.fn();
vi.mock('@/services/qaTemplateService', () => ({
  fetchProjectTemplates: (...a: unknown[]) => fetchProjectTemplates(...a),
  fetchGlobalTemplates: vi.fn(),
}));
const deleteTemplate = vi.fn();
vi.mock('@/services/templateImportService', () => ({
  deleteTemplate: (...a: unknown[]) => deleteTemplate(...a),
}));
const apiClient = vi.fn();
vi.mock('@/integrations/api', () => ({apiClient: (...a: unknown[]) => apiClient(...a)}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {ProjectTemplatesList} from './ProjectTemplatesList';

function wrapper(client: QueryClient) {
  return ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

function renderList(onSwitched = vi.fn(), client = newClient()) {
  const Wrapper = wrapper(client);
  const view = render(
    <Wrapper>
      <ProjectTemplatesList projectId="p" onSwitched={onSwitched} />
    </Wrapper>,
  );
  return {onSwitched, Wrapper, view};
}

function newClient() {
  return new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
}

describe('ProjectTemplatesList', () => {
  beforeEach(() => {
    fetchProjectTemplates.mockReset();
    fetchProjectTemplates.mockResolvedValue({ok: true, data: ROWS});
    deleteTemplate.mockReset();
    apiClient.mockReset();
    apiClient.mockResolvedValue({project_template_id: 'b', is_active: true});
  });

  it('asks the server only for this project, this kind, including inactive rows', async () => {
    renderList();
    await waitFor(() => expect(fetchProjectTemplates).toHaveBeenCalledWith('p', 'extraction', true));
  });

  it('surfaces a failed list reload instead of hiding it', async () => {
    fetchProjectTemplates.mockResolvedValue({ok: false, error: new Error('Failed to fetch')});
    renderList();
    expect(await screen.findByTestId('project-templates-error')).toHaveTextContent('Failed to fetch');
  });

  it('does not report a switch the server refused', async () => {
    apiClient.mockRejectedValueOnce(new Error('nope'));
    const {onSwitched} = renderList();
    fireEvent.click(await screen.findByTestId('project-template-switch-b'));
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('project-template-switch-b')).toBeEnabled());
    expect(onSwitched).not.toHaveBeenCalled();
  });

  it('marks the active row and offers Switch/Delete only on inactive rows', async () => {
    renderList();
    expect(await screen.findByTestId('project-template-active-a')).toBeInTheDocument();
    expect(screen.queryByTestId('project-template-active-b')).toBeNull();
    expect(screen.queryByTestId('project-template-switch-a')).toBeNull();
    expect(screen.queryByTestId('project-template-delete-a')).toBeNull();
    expect(screen.getByTestId('project-template-switch-b')).toBeInTheDocument();
    expect(screen.getByTestId('project-template-delete-b')).toBeInTheDocument();
  });

  it('Switch PATCHes the template, refreshes the family, then reports the id', async () => {
    const {onSwitched} = renderList();
    fireEvent.click(await screen.findByTestId('project-template-switch-b'));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/api/v1/projects/p/templates/b', {
        method: 'PATCH',
        body: {is_active: true},
      }),
    );
    // The write invalidates the shared query — the list refetches itself
    // rather than the caller refreshing a private copy.
    await waitFor(() => expect(fetchProjectTemplates).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith('b'));
  });

  it('Delete asks for confirmation, then deletes and refreshes the family', async () => {
    deleteTemplate.mockResolvedValueOnce({ok: true, data: undefined});
    renderList();
    fireEvent.click(await screen.findByTestId('project-template-delete-b'));
    expect(deleteTemplate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('project-template-delete-confirm'));
    await waitFor(() => expect(deleteTemplate).toHaveBeenCalledWith('p', 'b'));
    await waitFor(() => expect(fetchProjectTemplates).toHaveBeenCalledTimes(2));
  });

  it('renders a 409 message inline', async () => {
    deleteTemplate.mockResolvedValueOnce({
      ok: false,
      error: new Error('extractions already reference it'),
    });
    renderList();
    fireEvent.click(await screen.findByTestId('project-template-delete-b'));
    fireEvent.click(screen.getByTestId('project-template-delete-confirm'));
    expect(await screen.findByTestId('project-template-delete-error')).toHaveTextContent(
      'extractions already reference it',
    );
  });

  it('reopening the list reads the cache instead of refetching', async () => {
    const client = newClient();
    const first = renderList(vi.fn(), client);
    await screen.findByTestId('project-template-row-a');
    first.view.unmount();

    const {Wrapper} = first;
    render(
      <Wrapper>
        <ProjectTemplatesList projectId="p" onSwitched={vi.fn()} />
      </Wrapper>,
    );
    // Rows are on screen from the cache — no loader, no second request.
    expect(screen.getByTestId('project-template-row-a')).toBeInTheDocument();
    expect(fetchProjectTemplates).toHaveBeenCalledTimes(1);
  });
});
