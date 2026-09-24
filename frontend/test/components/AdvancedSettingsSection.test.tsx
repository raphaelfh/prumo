/** §7.5: `hasLlamaCloudKey` is true from a project-scope row when the viewer
 * is a manager and from a user-scope row otherwise. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/llmConnectionsService', () => ({
  fetchMyConnections: vi.fn(),
  fetchProjectConnections: vi.fn(),
}));
vi.mock('@/services/projectSettingsService', () => ({deleteProject: vi.fn()}));
vi.mock('@/services/parserSettingsService', () => ({setParserType: vi.fn()}));
vi.mock('react-router', async (importActual) => ({
  ...(await importActual<typeof import('react-router')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('@/contexts/AuthContext', () => ({useAuth: () => ({user: {id: 'u1'}})}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {toast} from 'sonner';
import {fetchMyConnections, fetchProjectConnections} from '@/services/llmConnectionsService';
import {deleteProject} from '@/services/projectSettingsService';
import {ApiError} from '@/integrations/api/client';
import {projectsListKey} from '@/hooks/useProjectsQuery';
import {AdvancedSettingsSection} from '@/components/project/settings/AdvancedSettingsSection';
import {t} from '@/lib/copy';

const LLAMA = {id: 'c1', provider: 'llama_cloud', has_api_key: true} as never;
let invalidateSpy: ReturnType<typeof vi.spyOn>;
const PROJECT = {name: 'p', eligibility_criteria: null, study_design: null, review_keywords: [], settings: {}};

function renderSection(isManager: boolean) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  return render(
    <QueryClientProvider client={client}>
      <AdvancedSettingsSection project={PROJECT} onChange={vi.fn()} projectId="p1" isManager={isManager} />
    </QueryClientProvider>,
  );
}

describe('AdvancedSettingsSection — llama_cloud key from connections', () => {
  it('a manager gets the key from the project-scope row', async () => {
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: true, data: []});
    vi.mocked(fetchProjectConnections).mockResolvedValue({ok: true, data: [LLAMA]});
    renderSection(true);
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
  });

  it('a non-manager gets the key from their own row and never reads the project list', async () => {
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: true, data: [LLAMA]});
    vi.mocked(fetchProjectConnections).mockClear();
    renderSection(false);
    await waitFor(() => expect(screen.getByRole('switch')).toBeDisabled()); // disabled={!isManager} still wins
    const sw = screen.getByRole('switch');
    const hintName = t('common', 'fieldHintAria').replace('{{label}}', t('parsing', 'highQualityLabel'));
    expect(screen.getByRole('button', {name: hintName})).toBeInTheDocument();
    const ids = (sw.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(t('parsing', 'highQualityHint'));
    expect(fetchProjectConnections).not.toHaveBeenCalled();
  });

  it('keeps the needs-key sentence visible under the disabled switch', async () => {
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: true, data: []});
    vi.mocked(fetchProjectConnections).mockResolvedValue({ok: true, data: []});
    renderSection(true);
    const sentence = await screen.findByText(t('parsing', 'highQualityNeedsKey'));
    expect(sentence).toBeVisible();
    expect(sentence).not.toHaveClass('sr-only');
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('switch').getAttribute('aria-describedby')).toContain(sentence.id);
  });

  it('renders one flat group of rows, then a destructive Danger zone', () => {
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: true, data: []});
    renderSection(true);
    const headings = screen.getAllByRole('heading', {level: 2});
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(t('project', 'advancedCardDangerTitle'));
    expect(headings[0]).toHaveClass('text-destructive');
    expect(screen.getByLabelText(t('project', 'advancedAdditionalNotesLabel'))).toHaveAttribute('id', 'eligibility_notes');
    expect(screen.getByRole('button', {name: t('project', 'advancedDeleteProjectButton')})).toBeInTheDocument();
    expect(t('parsing', 'highQualityHint')).toMatch(/Applies to newly ingested PDFs\.$/);
  });
});

describe('AdvancedSettingsSection — delete project through the API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: true, data: []});
    vi.mocked(fetchProjectConnections).mockResolvedValue({ok: true, data: []});
  });

  async function confirmDelete() {
    const user = userEvent.setup();
    renderSection(true);
    await user.click(screen.getByRole('button', {name: t('project', 'advancedDeleteProjectButton')}));
    await user.click(await screen.findByRole('button', {name: t('project', 'advancedConfirmDeleteButton')}));
  }

  it('on success toasts, invalidates the caller\'s project list, then leaves for the hub', async () => {
    vi.mocked(deleteProject).mockResolvedValue({ok: true, data: {id: 'p1'}});
    await confirmDelete();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/'));
    expect(deleteProject).toHaveBeenCalledWith('p1');
    expect(toast.success).toHaveBeenCalledWith(t('project', 'advancedProjectDeleted'));
    expect(invalidateSpy).toHaveBeenCalledWith({queryKey: projectsListKey('u1')});
    expect(invalidateSpy.mock.invocationCallOrder[0]).toBeLessThan(navigateMock.mock.invocationCallOrder[0]);
  });

  it('a 403 shows the check-your-permissions toast and stays', async () => {
    vi.mocked(deleteProject).mockResolvedValue({
      ok: false,
      error: new ApiError('FORBIDDEN', 'Manager role required', 403),
    });
    await confirmDelete();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t('project', 'advancedErrorDeletingMessage')));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('any other error shows the error with its message and stays', async () => {
    vi.mocked(deleteProject).mockResolvedValue({ok: false, error: new Error('boom')});
    await confirmDelete();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(`${t('project', 'advancedErrorDeleting')}: boom`),
    );
    expect(navigateMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
